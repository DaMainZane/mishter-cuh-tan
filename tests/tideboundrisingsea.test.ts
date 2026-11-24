// MODULE: Tidebound T12 unit tests (T12a: coast-inward lowest-elevation-first drowning, derived RNG stream, drowned tile state, port idleness; T12b: standalone or combined with Tides, risingSeaLevel 1-5 settings, and drowned client overlays) | DEPENDS ON: packs/base/constants, packs/index, packs/tidebound/index, server/lobby, server/runtime, shared/index, shared/production, shared/tileState | USED BY: npm test
import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import { CITY, SETTLEMENT } from '../src/packs/base/constants';
import {
  DROWNED,
  FLOODED,
  HARBOR_LEVEL,
  RISING_SEA_CADENCE_ROUNDS,
  RISING_SEA_DEFAULT_LEVEL,
  RISING_SEA_FIRST_ROUND,
  RISING_SEA_LEVELS,
  applyRisingSea,
  applyTides,
  deriveRisingSeaRng,
  drownHex,
  ensureRisingSeaRng,
  ensureTides,
  isDrownedHex,
  isPortDrowned,
  isRisingSeaRound,
  lowestElevationFrontierHexIds,
  pickRisingSeaHex,
  risingSeaConfigOf,
  risingSeaFrontierHexIds,
  risingSeaLevelDef,
  risingSeaLevelOf,
  risingSeaOverlays,
  tideWarning
} from '../src/packs/tidebound';
import { mergeSettings } from '../src/server/lobby';
import { defaultSettings, rulesFromSettings } from '../src/server/runtime';
import {
  PORT_IDLE_CHECKS,
  VIEW_DATA,
  buildTopology,
  createGame,
  defsOf,
  makeCtx,
  mergeViewOverlays,
  ratioFor,
  registryFor
} from '../src/shared';
import { runProductionPipeline } from '../src/shared/production';
import { getTileState, isHexRobberBlocked, setTileState } from '../src/shared/tileState';

// T12 (T12a + T12b): Rising sea — coast-inward drowning of lowest elevation first, derived RNG stream, drowned tile state,
// port idleness, optional standalone/combined operation with Tides, rate settings (1-5), and client overlays.

const ON = { dlc: { tidebound: true } };
const RISING_OFF = { dlc: { tidebound: true }, addons: { 'tidebound.rising_sea': false } };
const TIDES_OFF = { dlc: { tidebound: true }, addons: { 'tidebound.tides': false } };

/**
 * Builds a 7-hex island surrounded by a ring of 12 water hexes:
 * - Hex 0 is the interior center land hex (0, 0), surrounded on all 6 sides by land hexes 1..6.
 * - Hexes 1..6 form the coastal land ring (radius 1), touching the outer water ring (radius 2).
 */
function makeIslandGame(extraRules: Record<string, any> = ON, seed = 4242) {
  const reg = registryFor(allPacks, extraRules);
  const inits: { q: number; r: number; type: string; number: number | null; ext?: Record<string, any> }[] = [
    { q: 0, r: 0, type: 'wheat', number: 6, ext: { elevation: 1 } },
    { q: 1, r: 0, type: 'wood', number: 8, ext: { elevation: 1 } },
    { q: 1, r: -1, type: 'brick', number: 5, ext: { elevation: 1 } },
    { q: 0, r: -1, type: 'sheep', number: 9, ext: { elevation: 2 } },
    { q: -1, r: 0, type: 'ore', number: 10, ext: { elevation: 2 } },
    { q: -1, r: 1, type: 'wood', number: 4, ext: { elevation: 3 } },
    { q: 0, r: 1, type: 'wheat', number: 11, ext: { elevation: 3 } }
  ];
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      if (Math.abs(q + r) > 2) continue;
      const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
      if (dist === 2) inits.push({ q, r, type: 'water', number: null });
    }
  }
  const board = buildTopology(inits, {
    isLand: t => !!reg.tiles.get(t)?.land,
    portBlocked: t => !!reg.tiles.get(t)?.noPort,
    waterEdges: true
  });
  const g = createGame(reg, {
    players: [
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' }
    ],
    rules: extraRules,
    board,
    seed,
    shuffleSeats: false
  });
  g.phase = 'main';
  g.turn = 0;
  return { g, reg, ctx: makeCtx(g, reg) };
}

describe('T12a Rising sea: lowest elevation drowns first', () => {
  it('registers nothing and creates no state when Tidebound or tidebound.rising_sea is off', () => {
    const { g: gOff, reg: regOff, ctx: ctxOff } = makeIslandGame({});
    expect(regOff.enabled.has('tidebound.rising_sea')).toBe(false);
    expect(defsOf(regOff, PORT_IDLE_CHECKS).has('tidebound.rising_sea.drowned')).toBe(false);
    expect(defsOf(regOff, VIEW_DATA).has('tidebound.rising_sea.view')).toBe(false);
    expect(gOff.ext?.tidebound?.risingSeaRng).toBeUndefined();

    const { g: gAddonOff, reg: regAddonOff, ctx: ctxAddonOff } = makeIslandGame(RISING_OFF);
    expect(regAddonOff.enabled.has('tidebound.rising_sea')).toBe(false);
    expect(defsOf(regAddonOff, PORT_IDLE_CHECKS).has('tidebound.rising_sea.drowned')).toBe(false);
    expect(defsOf(regAddonOff, VIEW_DATA).has('tidebound.rising_sea.view')).toBe(false);
    expect(gAddonOff.ext?.tidebound?.risingSeaRng).toBeUndefined();

    // Advancing rounds via onRoundStart hooks whenRising Sea is off never drowns a tile or touches g.rng
    const rngOffBefore = gOff.rng.s;
    const rngAddonBefore = gAddonOff.rng.s;
    for (const r of [1, 2, 3, 4, 5, 6]) {
      gOff.round = r;
      for (const fn of regOff.hooks.onRoundStart) fn(ctxOff);
      gAddonOff.round = r;
      for (const fn of regAddonOff.hooks.onRoundStart) fn(ctxAddonOff);
    }
    expect(gOff.rng.s).toBe(rngOffBefore);
    expect(gAddonOff.rng.s).toBe(rngAddonBefore);
    expect(gOff.board.hexes.some(h => isDrownedHex(h))).toBe(false);
    expect(gAddonOff.board.hexes.some(h => isDrownedHex(h))).toBe(false);
  });

  it('identifies only coast or drowned-adjacent land on the frontier, and advances inward as coast drowns', () => {
    const { g, reg, ctx } = makeIslandGame(ON);
    // Initially, hex 0 is completely surrounded by land hexes 1..6, so only 1..6 are on the coastal frontier
    expect(risingSeaFrontierHexIds(g, reg)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(lowestElevationFrontierHexIds(g, reg)).toEqual([1, 2]);

    // Hidden (fog) land hexes are excluded from the frontier
    g.board.hexes[2].ext.hidden = true;
    expect(lowestElevationFrontierHexIds(g, reg)).toEqual([1]);
    delete g.board.hexes[2].ext.hidden;

    // Once coast hex 1 drowns, interior hex 0 touches drowned hex 1 and enters the frontier
    expect(drownHex(ctx, 1)).toBe(true);
    expect(isDrownedHex(g.board.hexes[1])).toBe(true);
    expect(risingSeaFrontierHexIds(g, reg)).toEqual([0, 2, 3, 4, 5, 6]);
    // Both hex 0 (newly exposed interior, elevation 1) and hex 2 (coast, elevation 1) are now the lowest-elevation frontier
    expect(lowestElevationFrontierHexIds(g, reg)).toEqual([0, 2]);
  });

  it('drowns lowest elevation first (1 before 2 before 3) from the coast inward', () => {
    const { g, reg, ctx } = makeIslandGame(ON, 9001);
    const drownedOrder: { hexId: number; elevation: number }[] = [];

    // Drown all 7 land hexes one by one via pickRisingSeaHex + drownHex
    for (let step = 0; step < 7; step++) {
      const nextId = pickRisingSeaHex(g, reg);
      expect(nextId).not.toBeNull();
      const elev = g.board.hexes[nextId!].ext.elevation;
      expect(drownHex(ctx, nextId!)).toBe(true);
      drownedOrder.push({ hexId: nextId!, elevation: elev });
    }
    expect(pickRisingSeaHex(g, reg)).toBeNull();

    // First 3 drowned tiles must be the 3 elevation-1 tiles (1, 2, and 0 once exposed), then elevation-2 (3, 4), then elevation-3 (5, 6)
    expect(drownedOrder.map(d => d.elevation)).toEqual([1, 1, 1, 2, 2, 3, 3]);
    expect(new Set(drownedOrder.slice(0, 3).map(d => d.hexId))).toEqual(new Set([0, 1, 2]));
    expect(new Set(drownedOrder.slice(3, 5).map(d => d.hexId))).toEqual(new Set([3, 4]));
    expect(new Set(drownedOrder.slice(5, 7).map(d => d.hexId))).toEqual(new Set([5, 6]));
  });

  it('runs on the round-clock schedule, uses an independent derived RNG stream, and never draws from g.rng', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(r => isRisingSeaRound(r))).toEqual([
      false,
      false,
      true,
      false,
      true,
      false,
      true
    ]);
    expect(RISING_SEA_FIRST_ROUND).toBe(3);
    expect(RISING_SEA_CADENCE_ROUNDS).toBe(2);

    const { g, reg, ctx } = makeIslandGame(ON, 777);
    const rngStart = g.rng.s;

    // Rounds 1 and 2: nothing drowns
    for (const r of [1, 2]) {
      g.round = r;
      expect(applyRisingSea(ctx)).toEqual([]);
    }
    expect(g.board.hexes.some(h => isDrownedHex(h))).toBe(false);

    // Round 3: first lowest-elevation coast tile drowns via onRoundStart
    g.round = 3;
    for (const fn of reg.hooks.onRoundStart) fn(ctx);
    const drownedR3 = g.board.hexes.filter(h => isDrownedHex(h)).map(h => h.id);
    expect(drownedR3.length).toBe(1);
    expect([1, 2]).toContain(drownedR3[0]);

    // Round 4 (off-cadence): still 1 drowned tile
    g.round = 4;
    for (const fn of reg.hooks.onRoundStart) fn(ctx);
    expect(g.board.hexes.filter(h => isDrownedHex(h)).map(h => h.id)).toEqual(drownedR3);

    // Round 5: second elevation-1 tile drowns
    g.round = 5;
    for (const fn of reg.hooks.onRoundStart) fn(ctx);
    const drownedR5 = g.board.hexes.filter(h => isDrownedHex(h)).map(h => h.id);
    expect(drownedR5.length).toBe(2);
    expect(drownedR5.every(id => [0, 1, 2].includes(id))).toBe(true);

    // Zero draws from g.rng across all rounds
    expect(g.rng.s).toBe(rngStart);

    // Derived RNG stream is deterministic for the same seed
    const { g: g2, ctx: ctx2 } = makeIslandGame(ON, 777);
    g2.round = 3;
    expect(applyRisingSea(ctx2)).toEqual(drownedR3);
    expect(ensureRisingSeaRng(g2).s).not.toBe(deriveRisingSeaRng(777).s);
  });

  it('drowned tiles permanently block production and robber placement, survive Tides drying, and idle non-harbor ports', () => {
    const { g, reg, ctx } = makeIslandGame(ON, 555);
    const hex1 = g.board.hexes[1]; // wood, number 8

    // Place Alice's settlement and a 2:1 wood port on a coastal vertex touching only hex 1
    const portVertex = g.board.vertices.find(v => v.hexIds.length === 1 && v.hexIds[0] === 1)!;
    expect(portVertex).toBeDefined();
    portVertex.port = 'wood';
    portVertex.piece = { type: SETTLEMENT, owner: 'a' };

    // Before drowning: port gives 2:1 for wood, hex 1 produces wood on an 8, and robber is not blocked by tile state
    expect(isPortDrowned(g, reg, portVertex.id)).toBe(false);
    expect(ratioFor(g, reg, 'a', 'wood')).toBe(2);
    expect(isHexRobberBlocked(g, reg, 1)).toBe(false);

    // Drown hex 1
    expect(drownHex(ctx, 1)).toBe(true);
    expect(getTileState(hex1)).toEqual({ id: DROWNED });
    expect(isHexRobberBlocked(g, reg, 1)).toBe(true);

    // Production on roll 8 yields 0 wood from drowned hex 1
    g.players[0].resources.wood = 0;
    runProductionPipeline(ctx, [hex1], 8);
    expect(g.players[0].resources.wood).toBe(0);

    // Port on drowned hex 1 is now idle (falls back to 4:1 bank trade)
    expect(isPortDrowned(g, reg, portVertex.id)).toBe(true);
    expect(ratioFor(g, reg, 'a', 'wood')).toBe(4);

    // Upgrading the port vertex to a Harbor (level 2 on a city) exempts it from drowning idleness (1:1)
    portVertex.piece = { type: CITY, owner: 'a' };
    g.ext.core = g.ext.core || {};
    g.ext.core.portUpgrades = { [portVertex.id]: { level: HARBOR_LEVEL, by: 'a' } };
    expect(isPortDrowned(g, reg, portVertex.id)).toBe(false);
    expect(ratioFor(g, reg, 'a', 'wood')).toBe(1);

    // Tides never clear a `drowned` tile when the tide goes out, and `drownHex` overwrites `flooded` permanently
    setTileState(g, 2, { id: FLOODED });
    expect(drownHex(ctx, 2)).toBe(true);
    expect(getTileState(g.board.hexes[2])).toEqual({ id: DROWNED });
    for (const r of [2, 3, 4, 5]) {
      g.round = r;
      applyTides(ctx);
      expect(getTileState(g.board.hexes[1])).toEqual({ id: DROWNED });
      expect(getTileState(g.board.hexes[2])).toEqual({ id: DROWNED });
    }
  });
});

describe('T12b Rising sea: optional with Tides, rate settings, and client overlays', () => {
  it('works standalone with Tides off (no dependency on tidebound.tides) and sends drowned overlays', () => {
    const { g, reg, ctx } = makeIslandGame(TIDES_OFF, 314);
    expect(reg.enabled.has('tidebound.rising_sea')).toBe(true);
    expect(reg.enabled.has('tidebound.tides')).toBe(false);

    // Before any tile drowns, risingSeaOverlays is undefined and mergeViewOverlays stays null
    expect(risingSeaOverlays(g, reg)).toBeUndefined();
    expect(mergeViewOverlays(g, reg)).toBeNull();

    // Round 3: Rising sea drowns a lowest-elevation coast tile even with Tides off
    g.round = 3;
    for (const fn of reg.hooks.onRoundStart) fn(ctx);
    const drowned = g.board.hexes.filter(h => isDrownedHex(h)).map(h => h.id);
    expect(drowned).toHaveLength(1);
    expect([1, 2]).toContain(drowned[0]);

    // Client overlays now report the drowned tile with label 'Drowned' (and exclude hidden fog tiles)
    expect(mergeViewOverlays(g, reg)).toEqual({
      [drowned[0]]: { kind: 'flood', label: 'Drowned' }
    });
    g.board.hexes[drowned[0]].ext.hidden = true;
    expect(mergeViewOverlays(g, reg)).toBeNull();
  });

  it('works together with Tides: drowned overlay takes priority over flood, and tideWarning skips drowned tiles', () => {
    const { g, reg, ctx } = makeIslandGame(ON, 314);
    ensureTides(g, reg);

    // Before any tile drowns, risingSeaOverlays returns undefined so Tides owns hexOverlays unchanged
    expect(risingSeaOverlays(g, reg)).toBeUndefined();

    // Drown coast hex 1 and flood coast hex 2
    drownHex(ctx, 1);
    setTileState(g, 2, { id: FLOODED });

    const merged = mergeViewOverlays(g, reg)!;
    expect(merged[1]).toEqual({ kind: 'flood', label: 'Drowned' });
    expect(merged[2]).toEqual({ kind: 'flood' });

    // Last seat's turn before a tide round: tideWarning never includes drowned hex 1
    g.turn = g.players.length - 1;
    g.round = 3;
    const warn = tideWarning(g, reg);
    if (warn) {
      expect(warn.hexIds).not.toContain(1);
    }
  });

  it('defines 5 rate levels (Very slow to Very fast, Medium default), clamps bad values, and scales drowning speed', () => {
    expect(RISING_SEA_LEVELS).toHaveLength(5);
    expect(RISING_SEA_DEFAULT_LEVEL).toBe(3);
    const medium = risingSeaLevelDef(3);
    expect(medium).toEqual({
      name: 'Medium',
      firstRound: RISING_SEA_FIRST_ROUND,
      cadence: RISING_SEA_CADENCE_ROUNDS,
      tilesPerPulse: 1
    });

    // Clamping of out-of-range and non-numeric values
    expect(risingSeaLevelDef(0).name).toBe('Very slow');
    expect(risingSeaLevelDef(99).name).toBe('Very fast');
    expect(risingSeaLevelDef(Number.NaN).name).toBe('Medium');
    expect(risingSeaLevelOf(makeIslandGame(ON).g)).toBe(3);
    expect(risingSeaLevelOf(makeIslandGame({ ...ON, risingSeaLevel: 5 }).g)).toBe(5);
    expect(risingSeaLevelOf(makeIslandGame({ ...ON, risingSeaLevel: -4 }).g)).toBe(1);
    expect(risingSeaLevelOf(makeIslandGame({ ...ON, risingSeaLevel: 'bad' as any }).g)).toBe(3);

    // Count drowned tile-rounds over rounds 1..8 across all 5 levels
    const drownedTileRounds = (level: number): number => {
      const { g, ctx } = makeIslandGame({ ...ON, risingSeaLevel: level }, 808);
      let sum = 0;
      for (let round = 1; round <= 8; round++) {
        g.round = round;
        applyRisingSea(ctx);
        sum += g.board.hexes.filter(h => isDrownedHex(h)).length;
      }
      return sum;
    };
    const counts = [1, 2, 3, 4, 5].map(drownedTileRounds);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i], `level ${i + 1} > level ${i}`).toBeGreaterThan(counts[i - 1]);
    }

    // Direct rule overrides (risingSeaFirstRound, risingSeaCadence, risingSeaTilesPerPulse) also work
    const custom = makeIslandGame({ ...ON, risingSeaFirstRound: 2, risingSeaCadence: 1, risingSeaTilesPerPulse: 2 }, 808);
    expect(risingSeaConfigOf(custom.g)).toMatchObject({ firstRound: 2, cadence: 1, tilesPerPulse: 2 });
    custom.g.round = 2;
    expect(applyRisingSea(custom.ctx)).toHaveLength(2);
  });

  it('clamps and preserves risingSeaLevel in lobby settings, and maps it to rules only when Rising sea is on and off Medium', () => {
    const base = defaultSettings();
    expect(base.risingSeaLevel).toBeUndefined();
    expect(mergeSettings({ risingSeaLevel: 4 }, base).risingSeaLevel).toBe(4);
    expect(mergeSettings({ risingSeaLevel: 99 }, base).risingSeaLevel).toBe(5);
    expect(mergeSettings({ risingSeaLevel: -2 }, base).risingSeaLevel).toBe(1);
    expect(mergeSettings({ risingSeaLevel: 2.2 }, base).risingSeaLevel).toBe(2);

    const kept = mergeSettings({ risingSeaLevel: 5 }, base);
    expect(mergeSettings({ risingSeaLevel: 'bad' }, kept).risingSeaLevel).toBe(5);
    expect(mergeSettings({ boardRadius: 4 }, kept).risingSeaLevel).toBe(5);

    const s = { ...base, dlc: { tidebound: true }, risingSeaLevel: 4 };
    expect(rulesFromSettings(s).risingSeaLevel).toBe(4);
    expect(rulesFromSettings({ ...s, risingSeaLevel: 3 }).risingSeaLevel).toBeUndefined();
    expect(rulesFromSettings({ ...s, addons: { 'tidebound.rising_sea': false } }).risingSeaLevel).toBeUndefined();
    expect(rulesFromSettings({ ...s, dlc: {} }).risingSeaLevel).toBeUndefined();
    expect('risingSeaLevel' in rulesFromSettings(base)).toBe(false);
  });
});
