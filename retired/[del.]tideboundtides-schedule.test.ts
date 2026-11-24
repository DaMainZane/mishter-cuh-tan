import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import {
  FLOODED,
  TIDE_DEFAULT_LEVEL,
  TIDE_FIRST_ROUND,
  TIDE_LEVELS,
  TIDE_PERIOD,
  TIDE_SPRING_EVERY,
  applyTides,
  buildTideClusters,
  coastHexIds,
  ensureTides,
  floodDepthAt,
  floodOverlayKind,
  floodPlan,
  floodWarnOverlayKind,
  hexElevation,
  isFloodedAt,
  isPortFlooded,
  isSpringTide,
  tideClientView,
  tideLevelDef,
  tideLevelOf,
  tideStrengthAt,
  tideWarning
} from '../src/packs/tidebound';
import type { TideCluster } from '../src/packs/tidebound';
import { overlayPatternDefsMarkup, overlayVarsCss, renderHexOverlaysMarkup } from '../src/client/render/overlay';
import { resetManifest, setManifest } from '../src/client/visuals';
import { mergeSettings } from '../src/server/lobby';
import { defaultSettings, rulesFromSettings } from '../src/server/runtime';
import { OVERLAY_KINDS, buildTopology, buildVisualManifest, createGame, defsOf, dispatch, makeCtx, ratioFor, registryFor, registryVisualProblems } from '../src/shared';
import type { OverlayKindVisual } from '../src/shared';
import { runProductionPipeline } from '../src/shared/production';
import { getTileState, isHexRobberBlocked, resolveTileStateDef, setTileState } from '../src/shared/tileState';

// T5a: the `flooded` tile state and the seeded per-cluster tide schedule. Tides is a Tidebound addon, so with the DLC (or the addon) off
// nothing is registered and nothing moves; with it on the schedule is a formula of the cluster phase and the round, the clusters come from
// the world seed, and nothing draws from `g.rng`.

const on = { dlc: { tidebound: true } };
const tidesOff = { dlc: { tidebound: true }, addons: { 'tidebound.tides': false } };

/** A disc of land tiles with the given radius (3 gives 37 tiles; the outer ring of 18 is the coast). Every tile is a numbered wood tile. */
function discInits(radius: number): { q: number; r: number; type: string; number: number | null }[] {
  const out: { q: number; r: number; type: string; number: number | null }[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.abs(q + r) > radius) continue;
      out.push({ q, r, type: 'wood', number: 6 });
    }
  }
  return out;
}

function makeGame(rules: Record<string, any> = on, seed = 99, radius = 3) {
  const reg = registryFor(allPacks, rules);
  const board = buildTopology(discInits(radius), {
    isLand: t => !!reg.tiles.get(t)?.land,
    portBlocked: t => !!reg.tiles.get(t)?.noPort,
    waterEdges: true
  });
  const g = createGame(reg, {
    players: [
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' }
    ],
    rules,
    board,
    seed,
    shuffleSeats: false
  });
  g.phase = 'main';
  g.turn = 0;
  return { g, reg, ctx: makeCtx(g, reg) };
}

const ringOf = (g: ReturnType<typeof makeGame>['g'], radius: number): number[] =>
  g.board.hexes.filter(h => Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r)) === radius).map(h => h.id);

const flooded = (g: ReturnType<typeof makeGame>['g'], id: number): boolean => getTileState(g.board.hexes[id])?.id === FLOODED;

/** Is every tile of the cluster reachable from the first one through tiles of the cluster? */
function connected(g: ReturnType<typeof makeGame>['g'], c: TideCluster): boolean {
  const byPos = new Map(c.hexIds.map(id => [`${g.board.hexes[id].q},${g.board.hexes[id].r}`, id]));
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const seen = new Set<number>([c.hexIds[0]]);
  const queue = [c.hexIds[0]];
  for (let i = 0; i < queue.length; i++) {
    const h = g.board.hexes[queue[i]];
    for (const [dq, dr] of dirs) {
      const n = byPos.get(`${h.q + dq},${h.r + dr}`);
      if (n !== undefined && !seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen.size === c.hexIds.length;
}

describe('registration', () => {
  it('with Tidebound on, Tides gives the game its clusters at game start and uses the base flooded state (no silt, robber cannot be moved onto it)', () => {
    const { g, reg } = makeGame(on);
    expect(reg.enabled.has('tidebound.tides')).toBe(true);
    expect(g.ext.tidebound.tides.clusters.length).toBeGreaterThan(0);
    const def = resolveTileStateDef(reg, FLOODED)!;
    expect(def.yieldMultiplier).toBe(0.5);
    expect(def.yieldRound).toBe('ceil');
    expect(def.blocksRobber).toBe(true);
    const hexId = ringOf(g, 3)[0];
    setTileState(g, hexId, { id: FLOODED });
    expect(isHexRobberBlocked(g, reg, hexId)).toBe(true);
  });

  it('with the DLC off, or only the Tides addon off, nothing is registered and no state is made', () => {
    for (const rules of [{}, { dlc: { tidebound: false } }, tidesOff]) {
      const { g, reg } = makeGame(rules);
      expect(reg.enabled.has('tidebound.tides')).toBe(false);
      expect(g.ext.tidebound).toBeUndefined();
      for (let round = 1; round <= 6; round++) {
        g.round = round;
        for (const hook of reg.hooks.onRoundStart) hook(makeCtx(g, reg));
      }
      expect(g.board.hexes.every(h => getTileState(h) === null)).toBe(true);
      expect(g.ext.tidebound).toBeUndefined();
    }
  });
});

describe('clusters', () => {
  it('cover the coast exactly once, leave the inland dry, and are each one connected stretch', () => {
    const { g, reg } = makeGame(on);
    const coast = ringOf(g, 3);
    expect(coastHexIds(g, reg)).toEqual([...coast].sort((a, b) => a - b));
    const clusters = ensureTides(g, reg).clusters;
    const all = clusters.flatMap(c => c.hexIds);
    expect([...all].sort((a, b) => a - b)).toEqual([...coast].sort((a, b) => a - b));
    expect(new Set(all).size).toBe(all.length);
    expect(clusters).toHaveLength(3);
    for (const c of clusters) {
      expect(c.hexIds.length).toBeGreaterThan(0);
      expect(connected(g, c), `cluster ${c.id}`).toBe(true);
      expect([0, 1]).toContain(c.phase);
    }
  });

  it('give each a second ring: inland land that touches the coast, once, never coast itself, never the deep inland', () => {
    const { g, reg } = makeGame(on);
    const clusters = ensureTides(g, reg).clusters;
    const second = ringOf(g, 2);
    const inner = clusters.flatMap(c => c.inner);
    expect([...inner].sort((a, b) => a - b)).toEqual([...second].sort((a, b) => a - b));
    expect(new Set(inner).size).toBe(inner.length);
    expect(inner.some(id => ringOf(g, 3).includes(id))).toBe(false);
    // A small island has no second ring beyond its centre: radius 1 is one ring of coast around one inland tile.
    const small = makeGame(on, 5, 1);
    expect(ensureTides(small.g, small.reg).clusters.flatMap(c => c.inner)).toHaveLength(1);
  });

  it('are the same for the same seed and change with the seed', () => {
    const a = buildTideClusters(makeGame(on, 7).g, makeGame(on, 7).reg);
    const b = buildTideClusters(makeGame(on, 7).g, makeGame(on, 7).reg);
    expect(a).toEqual(b);
    let differs = false;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const other = makeGame(on, seed);
      if (JSON.stringify(buildTideClusters(other.g, other.reg)) !== JSON.stringify(a)) differs = true;
    }
    expect(differs).toBe(true);
  });

  it('give both phases whenever there are two or more clusters, whatever the seed', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const { g, reg } = makeGame(on, seed);
      const phases = new Set(ensureTides(g, reg).clusters.map(c => c.phase));
      expect(phases.size, `seed ${seed}`).toBe(2);
    }
  });

  it('a small island is one cluster, and a hidden coast tile is left out without leaking', () => {
    const small = makeGame(on, 5, 1);
    expect(ensureTides(small.g, small.reg).clusters).toHaveLength(1);

    const { g, reg } = makeGame(on, 5, 3);
    const ring = ringOf(g, 3);
    g.board.hexes[ring[0]].ext.hidden = true;
    delete g.ext.tidebound;
    const ids = ensureTides(g, reg).clusters.flatMap(c => c.hexIds);
    expect(ids).not.toContain(ring[0]);
    expect(ids).toHaveLength(ring.length - 1);
  });
});

describe('the schedule', () => {
  it('is dry before the first tide, then every other round, one phase apart', () => {
    expect(TIDE_PERIOD).toBe(2);
    expect(TIDE_FIRST_ROUND).toBe(2);
    const even: TideCluster = { id: 0, hexIds: [], inner: [], phase: 0 };
    const odd: TideCluster = { id: 1, hexIds: [], inner: [], phase: 1 };
    expect([0, 1].map(r => isFloodedAt(even, r) || isFloodedAt(odd, r))).toEqual([false, false]);
    expect([2, 3, 4, 5, 6].map(r => isFloodedAt(even, r))).toEqual([true, false, true, false, true]);
    expect([2, 3, 4, 5, 6].map(r => isFloodedAt(odd, r))).toEqual([false, true, false, true, false]);
  });

  it('applyTides floods what the water reaches, dries the rest, and touches no deep inland tile', () => {
    const { g, reg, ctx } = makeGame(on);
    const clusters = ensureTides(g, reg).clusters;
    const deep = g.board.hexes.map(h => h.id).filter(id => ringOf(g, 3).includes(id) === false && ringOf(g, 2).includes(id) === false);
    for (let round = 1; round <= 9; round++) {
      g.round = round;
      applyTides(ctx);
      for (const c of clusters) {
        const depth = floodDepthAt(c, round);
        for (const id of c.hexIds) expect(flooded(g, id), `round ${round} cluster ${c.id} coast`).toBe(depth >= 1);
        for (const id of c.inner) expect(flooded(g, id), `round ${round} cluster ${c.id} inner`).toBe(depth >= 2);
      }
      for (const id of deep) expect(getTileState(g.board.hexes[id])).toBeNull();
    }
  });

  it('reports what moved: tileStateChanged per tile, one tideChanged, and a log line when a tide rises', () => {
    const { g, reg, ctx } = makeGame(on);
    g.round = 1;
    expect(applyTides(ctx)).toEqual({ risen: [], fell: [] });
    expect(ctx.events).toHaveLength(0);

    g.round = 2;
    const first = applyTides(ctx);
    expect(first.risen.length).toBeGreaterThan(0);
    expect(first.fell).toEqual([]);
    expect(ctx.events.filter(e => e.type === 'tileStateChanged')).toHaveLength(first.risen.length);
    expect(ctx.events.filter(e => e.type === 'tideChanged')).toEqual([{ type: 'tideChanged', data: { round: 2, spring: false, risen: first.risen, fell: [] } }]);
    expect(g.log.some(l => l.text.includes('The tide rises'))).toBe(true);

    g.round = 3;
    const second = applyTides(ctx);
    expect([...second.fell].sort((a, b) => a - b)).toEqual([...first.risen].sort((a, b) => a - b));

    // Running it again in the same round changes nothing.
    const before = ctx.events.length;
    expect(applyTides(ctx)).toEqual({ risen: [], fell: [] });
    expect(ctx.events).toHaveLength(before);
    expect(reg.enabled.has('tidebound.tides')).toBe(true);
  });

  it('never overwrites another tile state, and never clears one it did not set', () => {
    const { g, reg, ctx } = makeGame(on);
    const clusters = ensureTides(g, reg).clusters;
    const wet = clusters.find(c => isFloodedAt(c, 2))!;
    const dry = clusters.find(c => !isFloodedAt(c, 2))!;
    const barren = wet.hexIds[0];
    const fertile = dry.hexIds[0];
    setTileState(g, barren, { id: 'barren' });
    setTileState(g, fertile, { id: 'fertile' });
    g.round = 2;
    applyTides(ctx);
    expect(getTileState(g.board.hexes[barren])?.id).toBe('barren');
    expect(getTileState(g.board.hexes[fertile])?.id).toBe('fertile');
    expect(wet.hexIds.slice(1).every(id => flooded(g, id))).toBe(true);
    g.round = 3;
    applyTides(ctx);
    expect(getTileState(g.board.hexes[barren])?.id).toBe('barren');
    expect(getTileState(g.board.hexes[fertile])?.id).toBe('fertile');
  });

  it('runs from the round clock: round 2 starts with the right clusters under water', () => {
    const { g, reg } = makeGame(on);
    const clusters = ensureTides(g, reg).clusters;
    expect(g.round).toBe(0);
    for (let i = 0; i < 2; i++) {
      g.phase = 'main';
      const who = g.players[g.turn].id;
      expect(dispatch(g, reg, { type: 'end_turn', playerId: who }).ok).toBe(true);
    }
    expect(g.round).toBe(1);
    expect(g.board.hexes.every(h => getTileState(h) === null)).toBe(true);
    for (let i = 0; i < 2; i++) {
      g.phase = 'main';
      const who = g.players[g.turn].id;
      expect(dispatch(g, reg, { type: 'end_turn', playerId: who }).ok).toBe(true);
    }
    expect(g.round).toBe(2);
    for (const c of clusters) for (const id of c.hexIds) expect(flooded(g, id), `cluster ${c.id}`).toBe(isFloodedAt(c, 2));
  });
});

describe('spring tide (T5b)', () => {
  it('comes every 4th round from the first tide, and floods every cluster two rings deep whatever its phase', () => {
    expect(TIDE_SPRING_EVERY).toBe(4);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 12].map(r => isSpringTide(r))).toEqual([false, false, false, true, false, false, false, true, true]);
    const even: TideCluster = { id: 0, hexIds: [], inner: [], phase: 0 };
    const odd: TideCluster = { id: 1, hexIds: [], inner: [], phase: 1 };
    expect([2, 3, 4, 5].map(r => floodDepthAt(even, r))).toEqual([1, 0, 2, 0]);
    expect([2, 3, 4, 5].map(r => floodDepthAt(odd, r))).toEqual([0, 1, 2, 1]);
  });

  it('on round 4 the whole coast and the ring behind it are under water; on round 5 only the phase that is up stays', () => {
    const { g, reg, ctx } = makeGame(on);
    const clusters = ensureTides(g, reg).clusters;
    for (let round = 1; round <= 4; round++) {
      g.round = round;
      applyTides(ctx);
    }
    for (const c of clusters) {
      for (const id of [...c.hexIds, ...c.inner]) expect(flooded(g, id), `round 4 cluster ${c.id}`).toBe(true);
    }
    expect(g.log.some(l => l.text.includes('Spring tide'))).toBe(true);
    const spring = ctx.events.filter(e => e.type === 'tideChanged').pop()!;
    expect(spring.data.spring).toBe(true);
    expect(spring.data.round).toBe(4);

    g.round = 5;
    applyTides(ctx);
    for (const c of clusters) {
      for (const id of c.inner) expect(flooded(g, id), `round 5 inner ${c.id}`).toBe(false);
      for (const id of c.hexIds) expect(flooded(g, id), `round 5 coast ${c.id}`).toBe(isFloodedAt(c, 5));
    }
    // The centre of the disc is never reached.
    expect(getTileState(g.board.hexes.find(h => h.q === 0 && h.r === 0)!)).toBeNull();
  });

  it('a spring tide does not overwrite another tile state on an inland tile either', () => {
    const { g, reg, ctx } = makeGame(on);
    const inner = ensureTides(g, reg).clusters.flatMap(c => c.inner)[0];
    setTileState(g, inner, { id: 'fertile' });
    g.round = 4;
    applyTides(ctx);
    expect(getTileState(g.board.hexes[inner])?.id).toBe('fertile');
  });

  it('a save made with the T5a data (no second ring) still runs', () => {
    const { g, reg, ctx } = makeGame(on);
    for (const c of ensureTides(g, reg).clusters) delete (c as any).inner;
    g.round = 4;
    expect(() => applyTides(ctx)).not.toThrow();
  });
});

describe('what flooding does', () => {
  it('a flooded tile yields half resources rounded up per building (settlement 1->1, city 2->1, castle 3->2) and a dry one yields full', () => {
    const { g, reg, ctx } = makeGame(on);
    const clusters = ensureTides(g, reg).clusters;
    const wet = g.board.hexes[clusters.find(c => isFloodedAt(c, 2))!.hexIds[0]];
    const dry = g.board.hexes[clusters.find(c => !isFloodedAt(c, 2))!.hexIds[0]];
    // A corner that touches only this tile, so a neighbouring cluster's tile cannot also pay out to the same building.
    const ownCorner = (h: typeof wet) => h.vertexIds.find(v => g.board.vertices[v].hexIds.length === 1)!;
    const wetV = ownCorner(wet);
    const dryV = ownCorner(dry);
    g.board.vertices[wetV].piece = { type: 'city', owner: 'a' };
    g.board.vertices[dryV].piece = { type: 'city', owner: 'b' };
    const woodOf = (id: string) => g.players.find(p => p.id === id)!.resources.wood || 0;

    // Round 1 (dry): both cities produce 2 wood
    runProductionPipeline(ctx, [wet, dry], 6);
    expect([woodOf('a'), woodOf('b')]).toEqual([2, 2]);

    // Round 2 (wet is flooded): city on flooded tile yields ceil(2 * 0.5) = 1; city on dry tile yields 2
    g.round = 2;
    applyTides(ctx);
    runProductionPipeline(ctx, [wet, dry], 6);
    expect([woodOf('a'), woodOf('b')]).toEqual([3, 4]);

    // Settlement on flooded tile yields ceil(1 * 0.5) = 1
    g.board.vertices[wetV].piece = { type: 'settlement', owner: 'a' };
    runProductionPipeline(ctx, [wet], 6);
    expect(woodOf('a')).toBe(4);

    // Castle (produces: 3) on flooded tile yields ceil(3 * 0.5) = 2
    reg.pieces.set('castle', { id: 'castle', name: 'Castle', target: 'vertex', cost: {}, vp: 3, produces: 3, canPlace: () => false });
    g.board.vertices[wetV].piece = { type: 'castle', owner: 'a' };
    runProductionPipeline(ctx, [wet], 6);
    expect(woodOf('a')).toBe(6);

    // Round 3 (wet dries out): castle yields full 3
    g.round = 3;
    applyTides(ctx);
    runProductionPipeline(ctx, [wet], 6);
    expect(woodOf('a')).toBe(9);
  });

  it('the robber stays on a tile that floods (it is not moved, only blocked from being moved onto)', () => {
    const { g, reg, ctx } = makeGame(on);
    const wet = ensureTides(g, reg).clusters.find(c => isFloodedAt(c, 2))!.hexIds[0];
    g.board.robberHexId = wet;
    g.round = 2;
    applyTides(ctx);
    expect(flooded(g, wet)).toBe(true);
    expect(g.board.robberHexId).toBe(wet);
  });
});

describe('seed discipline', () => {
  it('draws nothing from g.rng: not at game start, not over many rounds', () => {
    const withTides = makeGame(on, 123);
    const without = makeGame({}, 123);
    expect(withTides.g.rng.s).toBe(without.g.rng.s);
    for (let round = 1; round <= 12; round++) {
      withTides.g.round = round;
      applyTides(withTides.ctx);
    }
    expect(withTides.g.rng.s).toBe(without.g.rng.s);
  });

  it('the tide state is plain JSON and survives a save and load', () => {
    const { g, reg, ctx } = makeGame(on, 42);
    g.round = 2;
    applyTides(ctx);
    const copy = JSON.parse(JSON.stringify(g));
    expect(copy.ext.tidebound.tides).toEqual(g.ext.tidebound.tides);
    expect(copy.board.hexes.map((h: any) => h.ext.state?.id ?? null)).toEqual(g.board.hexes.map(h => getTileState(h)?.id ?? null));
    // A save made before Tides existed builds its clusters on the first round.
    delete copy.ext.tidebound;
    copy.round = 3;
    applyTides(makeCtx(copy, reg));
    expect(copy.ext.tidebound.tides.clusters).toEqual(g.ext.tidebound.tides.clusters);
  });
});

// T5c: the tide level. Medium is what T5a and T5b built, so every test above runs at Medium. The slider moves how often, how long and how deep.

/** Tiles under water, summed over the first rounds of a flat disc (every tile elevation 1, so only the schedule and the reach matter). */
function floodedTileRounds(level: number, rounds = 12): number {
  const { g, ctx } = makeGame({ ...on, tideLevel: level });
  let n = 0;
  for (let round = 1; round <= rounds; round++) {
    g.round = round;
    applyTides(ctx);
    n += g.board.hexes.filter(h => getTileState(h)?.id === FLOODED).length;
  }
  return n;
}

describe('tide level (T5c)', () => {
  it('has five positions, Medium is the T5a and T5b behaviour, and a higher level is more aggressive in every way', () => {
    expect(TIDE_LEVELS).toHaveLength(5);
    expect(TIDE_DEFAULT_LEVEL).toBe(3);
    const medium = tideLevelDef(3);
    expect(medium.name).toBe('Medium');
    expect([medium.period, medium.duration, medium.springEvery, medium.reach]).toEqual([TIDE_PERIOD, 1, TIDE_SPRING_EVERY, 1]);
    for (let i = 1; i < TIDE_LEVELS.length; i++) {
      const lo = TIDE_LEVELS[i - 1];
      const hi = TIDE_LEVELS[i];
      expect(hi.duration / hi.period, `${hi.name} share of rounds`).toBeGreaterThan(lo.duration / lo.period);
      expect(hi.springEvery).toBeLessThanOrEqual(lo.springEvery);
      expect(hi.reach).toBeGreaterThanOrEqual(lo.reach);
      expect(hi.strength).toBeGreaterThanOrEqual(lo.strength);
      expect(hi.springStrength).toBeGreaterThanOrEqual(lo.springStrength);
    }
    for (const d of TIDE_LEVELS) {
      expect(d.duration).toBeLessThan(d.period);
      expect(d.springStrength).toBeGreaterThan(d.strength);
    }
  });

  it('a bad level is clamped or falls back to Medium, so it can never break a round', () => {
    expect(tideLevelDef(0).name).toBe('Very low');
    expect(tideLevelDef(99).name).toBe('Very high');
    expect(tideLevelDef(2.6).name).toBe('Medium');
    expect(tideLevelDef(Number.NaN).name).toBe('Medium');
    expect(tideLevelOf(makeGame(on).g)).toBe(3);
    expect(tideLevelOf(makeGame({ ...on, tideLevel: 5 }).g)).toBe(5);
    expect(tideLevelOf(makeGame({ ...on, tideLevel: 'x' as any }).g)).toBe(3);
    expect(tideLevelOf(makeGame({ ...on, tideLevel: 40 }).g)).toBe(5);
  });

  it('each phase is flooded for `duration` rounds of every `period`, the two phases are not the same rounds, and round 1 is dry', () => {
    for (let level = 1; level <= 5; level++) {
      const d = tideLevelDef(level);
      const a: TideCluster = { id: 0, hexIds: [], inner: [], phase: 0 };
      const b: TideCluster = { id: 1, hexIds: [], inner: [], phase: 1 };
      expect(isFloodedAt(a, 1, level) || isFloodedAt(b, 1, level), `${d.name} round 1`).toBe(false);
      const roundsOf = (c: TideCluster): number[] => Array.from({ length: 12 }, (_, i) => i + 4).filter(r => isFloodedAt(c, r, level));
      // Rounds 4 to 15: twelve rounds, a whole number of cycles for periods 2, 3 and 4.
      expect(roundsOf(a), `${d.name} phase 0`).toHaveLength((12 * d.duration) / d.period);
      expect(roundsOf(b), `${d.name} phase 1`).toHaveLength((12 * d.duration) / d.period);
      expect(roundsOf(a), `${d.name} phases differ`).not.toEqual(roundsOf(b));
    }
  });

  it('a spring tide comes every `springEvery` rounds of the level and reaches two rings whatever the phase', () => {
    for (let level = 1; level <= 5; level++) {
      const d = tideLevelDef(level);
      const springs = Array.from({ length: 30 }, (_, i) => i + 1).filter(r => isSpringTide(r, level));
      expect(springs, d.name).toEqual(Array.from({ length: 30 }, (_, i) => i + 1).filter(r => r % d.springEvery === 0 && r >= TIDE_FIRST_ROUND));
      for (const phase of [0, 1]) {
        const c: TideCluster = { id: 0, hexIds: [], inner: [], phase };
        for (const r of springs) expect(floodDepthAt(c, r, level), `${d.name} round ${r}`).toBe(2);
      }
    }
  });

  it('a normal tide reaches the level\'s depth: the coast ring up to High, one ring inland as well at Very high', () => {
    const up: TideCluster = { id: 0, hexIds: [], inner: [], phase: 0 };
    for (let level = 1; level <= 5; level++) {
      const d = tideLevelDef(level);
      const normalFlooded = Array.from({ length: 30 }, (_, i) => i + 2).filter(r => isFloodedAt(up, r, level) && !isSpringTide(r, level));
      expect(normalFlooded.length).toBeGreaterThan(0);
      for (const r of normalFlooded) expect(floodDepthAt(up, r, level), `${d.name} round ${r}`).toBe(d.reach);
    }
  });

  it('the level is read from the game rules: Very low floods the least, Very high the most', () => {
    const counts = [1, 2, 3, 4, 5].map(level => floodedTileRounds(level));
    for (let i = 1; i < counts.length; i++) expect(counts[i], `level ${i + 1} floods more than level ${i}`).toBeGreaterThan(counts[i - 1]);
    // No rule at all is Medium.
    expect(floodedTileRounds(3)).toBe(counts[2]);
    const plain = makeGame(on);
    let n = 0;
    for (let round = 1; round <= 12; round++) {
      plain.g.round = round;
      applyTides(plain.ctx);
      n += plain.g.board.hexes.filter(h => getTileState(h)?.id === FLOODED).length;
    }
    expect(n).toBe(counts[2]);
  });

  it('at Very high a normal tide also covers the ring inland; at Medium it does not', () => {
    const high = makeGame({ ...on, tideLevel: 5 });
    const clusters = ensureTides(high.g, high.reg).clusters;
    const round = Array.from({ length: 12 }, (_, i) => i + 2).find(r => !isSpringTide(r, 5) && clusters.some(c => isFloodedAt(c, r, 5)))!;
    high.g.round = round;
    applyTides(high.ctx);
    for (const c of clusters.filter(c => isFloodedAt(c, round, 5))) {
      for (const id of [...c.hexIds, ...c.inner]) expect(flooded(high.g, id), `very high round ${round}`).toBe(true);
    }

    const mid = makeGame(on);
    const midClusters = ensureTides(mid.g, mid.reg).clusters;
    mid.g.round = 2;
    applyTides(mid.ctx);
    for (const c of midClusters) for (const id of c.inner) expect(flooded(mid.g, id)).toBe(false);
  });

  it('the level draws nothing from g.rng, and with Tides off it changes nothing', () => {
    const high = makeGame({ ...on, tideLevel: 5 }, 123);
    const plain = makeGame({}, 123);
    for (let round = 1; round <= 12; round++) {
      high.g.round = round;
      applyTides(high.ctx);
    }
    expect(high.g.rng.s).toBe(plain.g.rng.s);
    for (const rules of [{ tideLevel: 5 }, { dlc: { tidebound: false }, tideLevel: 5 }, { ...tidesOff, tideLevel: 5 }]) {
      const off = makeGame(rules, 123);
      expect(off.g.ext.tidebound).toBeUndefined();
    }
  });

  it('the lobby setting: clamped, kept when missing or bad, and sent as a rule only while Tides is on and off Medium', () => {
    const base = defaultSettings();
    expect(base.tideLevel).toBe(3);
    expect(mergeSettings({ tideLevel: 4 }, base).tideLevel).toBe(4);
    expect(mergeSettings({ tideLevel: 99 }, base).tideLevel).toBe(5);
    expect(mergeSettings({ tideLevel: -3 }, base).tideLevel).toBe(1);
    expect(mergeSettings({ tideLevel: 2.9 }, base).tideLevel).toBe(2);
    const kept = mergeSettings({ tideLevel: 4 }, base);
    expect(mergeSettings({ tideLevel: 'x' }, kept).tideLevel).toBe(4);
    expect(mergeSettings({}, kept).tideLevel).toBe(4);
    expect(mergeSettings({ boardRadius: 3 }, kept).tideLevel).toBe(4);

    const s = { ...base, dlc: { tidebound: true }, tideLevel: 4 };
    expect(rulesFromSettings(s).tideLevel).toBe(4);
    expect(rulesFromSettings({ ...s, tideLevel: 3 }).tideLevel).toBeUndefined();
    expect(rulesFromSettings({ ...s, addons: { 'tidebound.tides': false } }).tideLevel).toBeUndefined();
    expect(rulesFromSettings({ ...s, dlc: {} }).tideLevel).toBeUndefined();
    expect(rulesFromSettings({ ...base, tideLevel: 5 }).tideLevel).toBeUndefined();
    expect('tideLevel' in rulesFromSettings(base)).toBe(false);
  });
});

// T5d: elevation resistance. A tile floods when the tide's strength is at least its elevation (1 to 3, higher is rarer): elevation 1 goes
// under in any tide, elevation 2 needs a spring tide at Medium, elevation 3 needs the strongest tides of High and Very high.

describe('elevation resistance (T5d)', () => {
  it('reads ext.elevation as 1 to 3, and a tile without it counts as 1', () => {
    const { g } = makeGame(on);
    const hex = g.board.hexes[0];
    expect(hexElevation(hex)).toBe(1);
    for (const [value, want] of [[1, 1], [2, 2], [3, 3], [9, 3], [0, 1], [-4, 1], ['x', 1], [null, 1]] as const) {
      hex.ext.elevation = value;
      expect(hexElevation(hex), `elevation ${String(value)}`).toBe(want);
    }
  });

  it('tide strength is the level\'s normal strength, and its spring strength on a spring tide', () => {
    expect([2, 3, 4, 5].map(r => tideStrengthAt(r))).toEqual([1, 1, 2, 1]);
    expect([2, 3, 4, 5].map(r => tideStrengthAt(r, 4))).toEqual([2, 2, 3, 2]);
    expect([2, 6].map(r => tideStrengthAt(r, 1))).toEqual([1, 2]);
  });

  it('at Medium a normal tide leaves elevation 2 and 3 dry, and a spring tide floods elevation 2 but not 3', () => {
    const { g, reg, ctx } = makeGame(on);
    const wet = ensureTides(g, reg).clusters.find(c => isFloodedAt(c, 2))!;
    const [low, mid, high] = [wet.hexIds[0], wet.hexIds[1], wet.hexIds[2]];
    g.board.hexes[mid].ext.elevation = 2;
    g.board.hexes[high].ext.elevation = 3;

    g.round = 2;
    applyTides(ctx);
    expect([flooded(g, low), flooded(g, mid), flooded(g, high)]).toEqual([true, false, false]);
    const first = ctx.events.filter(e => e.type === 'tideChanged').pop()!;
    expect([...first.data.held].sort((a: number, b: number) => a - b)).toEqual([mid, high].sort((a, b) => a - b));
    expect(g.log.some(l => l.text.includes('The tide rises') && l.text.includes('2 higher tiles hold'))).toBe(true);

    g.round = 3;
    applyTides(ctx);
    expect([flooded(g, mid), flooded(g, high)]).toEqual([false, false]);

    g.round = 4;
    applyTides(ctx);
    expect([flooded(g, low), flooded(g, mid), flooded(g, high)]).toEqual([true, true, false]);
  });

  it('at High the spring tide is strong enough for elevation 3', () => {
    const { g, reg, ctx } = makeGame({ ...on, tideLevel: 4 });
    const c = ensureTides(g, reg).clusters[0];
    const top = c.hexIds[0];
    g.board.hexes[top].ext.elevation = 3;
    expect(tideStrengthAt(4, 4)).toBe(3);
    g.round = 4;
    applyTides(ctx);
    expect(flooded(g, top)).toBe(true);
  });

  it('water that is too weak for a tile drains it: a spring tide floods elevation 2, the next normal tide does not keep it flooded', () => {
    const { g, reg, ctx } = makeGame(on);
    const odd = ensureTides(g, reg).clusters.find(c => c.phase === 1)!;
    const id = odd.hexIds[0];
    g.board.hexes[id].ext.elevation = 2;
    expect(isFloodedAt(odd, 5)).toBe(true);
    g.round = 4;
    applyTides(ctx);
    expect(flooded(g, id)).toBe(true);
    g.round = 5;
    const out = applyTides(ctx);
    // The cluster is up in round 5 and the water reaches the tile, but a normal tide (strength 1) cannot hold elevation 2.
    expect(flooded(g, id)).toBe(false);
    expect(out.fell).toContain(id);
    expect(odd.hexIds.slice(1).every(other => flooded(g, other))).toBe(true);
  });

  it('the inland ring resists the same way', () => {
    const { g, reg, ctx } = makeGame(on);
    const clusters = ensureTides(g, reg).clusters;
    const inner = clusters.flatMap(c => c.inner);
    g.board.hexes[inner[0]].ext.elevation = 3;
    g.round = 4;
    applyTides(ctx);
    expect(flooded(g, inner[0])).toBe(false);
    expect(inner.slice(1).every(id => flooded(g, id))).toBe(true);
  });

  it('a tile the tide held back still produces, and a tile it flooded does not', () => {
    const { g, reg, ctx } = makeGame(on);
    const wet = ensureTides(g, reg).clusters.find(c => isFloodedAt(c, 2))!;
    const high = g.board.hexes[wet.hexIds[0]];
    const low = g.board.hexes[wet.hexIds[1]];
    high.ext.elevation = 2;
    const ownCorner = (h: typeof high) => h.vertexIds.find(v => g.board.vertices[v].hexIds.length === 1)!;
    g.board.vertices[ownCorner(high)].piece = { type: 'city', owner: 'a' };
    g.board.vertices[ownCorner(low)].piece = { type: 'city', owner: 'b' };
    g.round = 2;
    applyTides(ctx);
    runProductionPipeline(ctx, [high, low], 6);
    const woodOf = (id: string) => g.players.find(p => p.id === id)!.resources.wood || 0;
    expect([woodOf('a'), woodOf('b')]).toEqual([2, 1]);
  });

  it('elevation never moves a die roll or the seeded clusters', () => {
    const a = makeGame(on, 77);
    const b = makeGame(on, 77);
    for (const h of b.g.board.hexes) h.ext.elevation = 3;
    expect(ensureTides(b.g, b.reg).clusters).toEqual(ensureTides(a.g, a.reg).clusters);
    for (let round = 1; round <= 8; round++) {
      b.g.round = round;
      applyTides(b.ctx);
    }
    expect(b.g.rng.s).toBe(a.g.rng.s);
  });
});

// T5e: ports idle while their land is flooded. (Flooded tiles producing nothing is the production stage's job and was already covered above.)

describe('ports idle while flooded (T5e)', () => {
  /** Player a's settlement on a corner that touches only one tile of a cluster that floods in round 2, with a 2:1 wood port on it. */
  function portSetup() {
    const game = makeGame(on);
    const { g, reg } = game;
    const wet = ensureTides(g, reg).clusters.find(c => isFloodedAt(c, 2))!;
    const hex = g.board.hexes[wet.hexIds[0]];
    const vertexId = hex.vertexIds.find(v => g.board.vertices[v].hexIds.length === 1)!;
    g.board.vertices[vertexId].piece = { type: 'settlement', owner: 'a' };
    g.board.vertices[vertexId].port = 'wood';
    return { ...game, hex, vertexId };
  }

  it('a port on a flooded tile does not trade, and works again when the water drains', () => {
    const { g, reg, ctx, vertexId } = portSetup();
    expect(ratioFor(g, reg, 'a', 'wood')).toBe(2);
    expect(isPortFlooded(g, reg, vertexId)).toBe(false);
    g.round = 2;
    applyTides(ctx);
    expect(isPortFlooded(g, reg, vertexId)).toBe(true);
    expect(ratioFor(g, reg, 'a', 'wood')).toBe(4);
    expect(ratioFor(g, reg, 'a', 'brick')).toBe(4);
    g.round = 3;
    applyTides(ctx);
    expect(isPortFlooded(g, reg, vertexId)).toBe(false);
    expect(ratioFor(g, reg, 'a', 'wood')).toBe(2);
  });

  it('only one idle port is lost: a second port of the same player keeps its ratio', () => {
    const { g, reg, ctx } = portSetup();
    const dry = ensureTides(g, reg).clusters.find(c => !isFloodedAt(c, 2))!;
    const otherHex = g.board.hexes[dry.hexIds[0]];
    const other = otherHex.vertexIds.find(v => g.board.vertices[v].hexIds.length === 1)!;
    g.board.vertices[other].piece = { type: 'settlement', owner: 'a' };
    g.board.vertices[other].port = 'wood';
    g.round = 2;
    applyTides(ctx);
    expect(ratioFor(g, reg, 'a', 'wood')).toBe(2);
  });

  it('a port on a corner between a flooded and a dry tile keeps trading; both flooded stops it', () => {
    const { g, reg } = makeGame(on);
    const vertex = g.board.vertices.find(v => v.hexIds.length === 2)!;
    vertex.piece = { type: 'settlement', owner: 'a' };
    vertex.port = 'wood';
    setTileState(g, vertex.hexIds[0], { id: FLOODED });
    expect(isPortFlooded(g, reg, vertex.id)).toBe(false);
    expect(ratioFor(g, reg, 'a', 'wood')).toBe(2);
    setTileState(g, vertex.hexIds[1], { id: FLOODED });
    expect(isPortFlooded(g, reg, vertex.id)).toBe(true);
    expect(ratioFor(g, reg, 'a', 'wood')).toBe(4);
  });

  it('another tile state does not idle a port, and with Tides off a flooded tile leaves the port alone', () => {
    const on1 = makeGame(on);
    const v1 = on1.g.board.vertices.find(v => v.hexIds.length === 1)!;
    v1.piece = { type: 'settlement', owner: 'a' };
    v1.port = 'wood';
    setTileState(on1.g, v1.hexIds[0], { id: 'barren' });
    expect(ratioFor(on1.g, on1.reg, 'a', 'wood')).toBe(2);

    for (const rules of [{}, tidesOff]) {
      const off = makeGame(rules);
      const v = off.g.board.vertices.find(x => x.hexIds.length === 1)!;
      v.piece = { type: 'settlement', owner: 'a' };
      v.port = 'wood';
      setTileState(off.g, v.hexIds[0], { id: FLOODED });
      expect(ratioFor(off.g, off.reg, 'a', 'wood'), JSON.stringify(rules)).toBe(2);
    }
  });
});

// T6: the client's view of the tides: the warning one turn ahead, flooded and warned overlays, the title card facts and the elevation heat map data.

describe('tide view for the client (T6)', () => {
  it('floodPlan is what applyTides floods, round by round, at every level and with mixed elevations', () => {
    for (let level = 1; level <= 5; level++) {
      const { g, reg, ctx } = makeGame({ ...on, tideLevel: level }, 31);
      const tiles = ensureTides(g, reg).clusters.flatMap(c => [...c.hexIds, ...c.inner]);
      tiles.forEach((id, i) => { g.board.hexes[id].ext.elevation = (i % 3) + 1; });
      for (let round = 1; round <= 12; round++) {
        g.round = round;
        applyTides(ctx);
        const now = g.board.hexes.filter(h => getTileState(h)?.id === FLOODED).map(h => h.id).sort((a, b) => a - b);
        expect(now, `level ${level} round ${round}`).toEqual([...floodPlan(g, round)].sort((a, b) => a - b));
      }
    }
  });

  it('the warning is one turn, not a round: only on the last seat\'s turn, for tiles that are dry now and rise at the next round start', () => {
    const { g, reg, ctx } = makeGame(on);
    g.round = 1;
    g.turn = 0;
    expect(tideWarning(g)).toBeNull();
    g.turn = 1;
    const w = tideWarning(g)!;
    expect(w.round).toBe(2);
    expect(w.spring).toBe(false);
    expect([...w.hexIds].sort((a, b) => a - b)).toEqual([...floodPlan(g, 2)].sort((a, b) => a - b));

    g.round = 2;
    applyTides(ctx);
    const w3 = tideWarning(g)!;
    expect(w3.round).toBe(3);
    expect(w3.hexIds.some(id => flooded(g, id))).toBe(false);
    expect([...w3.hexIds].sort((a, b) => a - b)).toEqual([...floodPlan(g, 3)].sort((a, b) => a - b));

    g.round = 3;
    applyTides(ctx);
    expect(tideWarning(g)!.spring).toBe(true);

    // Nothing before the first tide, in setup, or with Tides off.
    g.round = 0;
    expect(tideWarning(g)).toBeNull();
    g.round = 1;
    g.phase = 'setup_settlement';
    expect(tideWarning(g)).toBeNull();
    g.phase = 'main';
    expect(tideWarning(makeGame({}).g)).toBeNull();
    expect(reg.enabled.has('tidebound.tides')).toBe(true);
  });

  it('a tile that already holds another state is not warned about', () => {
    const { g, reg } = makeGame(on);
    g.round = 1;
    g.turn = 1;
    const target = floodPlan(g, 2)[0];
    setTileState(g, target, { id: 'barren' });
    expect(tideWarning(g)!.hexIds).not.toContain(target);
    expect(reg.enabled.has('tidebound.tides')).toBe(true);
  });

  it('tideClientView: null with Tides off; flood and flood-warn overlays; rose only when something newly went under', () => {
    const off = makeGame({});
    expect(tideClientView(off.g, off.reg)).toBeNull();
    const addonOff = makeGame(tidesOff);
    expect(tideClientView(addonOff.g, addonOff.reg)).toBeNull();

    const { g, reg, ctx } = makeGame(on);
    g.turn = 0;
    g.round = 1;
    applyTides(ctx);
    let view = tideClientView(g, reg)!;
    expect(view.overlays).toEqual({});
    expect(view.tide.rose).toBeNull();
    expect(view.tide.warning).toBeNull();
    expect(view.tide.levelName).toBe('Medium');

    g.turn = 1;
    view = tideClientView(g, reg)!;
    expect(view.tide.warning).toEqual({ round: 2, spring: false, count: floodPlan(g, 2).length });
    expect(Object.values(view.overlays).every(o => o.kind === 'flood-warn')).toBe(true);
    expect(Object.keys(view.overlays)).toHaveLength(floodPlan(g, 2).length);

    g.turn = 0;
    g.round = 2;
    applyTides(ctx);
    view = tideClientView(g, reg)!;
    expect(view.tide.rose).toEqual({ round: 2, spring: false, count: floodPlan(g, 2).length });
    expect(Object.values(view.overlays).every(o => o.kind === 'flood')).toBe(true);
    for (const h of g.board.hexes) expect(view.overlays[h.id]?.kind === 'flood', `hex ${h.id}`).toBe(flooded(g, h.id));

    // On the last seat's turn the flooded tiles keep their tint and the tiles about to rise get the warning.
    g.turn = 1;
    view = tideClientView(g, reg)!;
    const kinds = Object.values(view.overlays).map(o => o.kind);
    expect(kinds).toContain('flood');
    expect(kinds).toContain('flood-warn');

    // Spring tide: the title card counts only the tiles that were not under water the round before.
    g.turn = 0;
    g.round = 3;
    applyTides(ctx);
    g.round = 4;
    applyTides(ctx);
    view = tideClientView(g, reg)!;
    expect(view.tide.rose).toEqual({ round: 4, spring: true, count: floodPlan(g, 4).length - floodPlan(g, 3).length });
  });

  it('elevation data: null when every tile is the same, the heights when they differ, never for fogged tiles; the view is plain JSON', () => {
    const { g, reg, ctx } = makeGame(on);
    expect(tideClientView(g, reg)!.tide.elevation).toBeNull();
    const ring = ringOf(g, 3);
    g.board.hexes[ring[0]].ext.elevation = 3;
    g.board.hexes[ring[1]].ext.elevation = 2;
    let view = tideClientView(g, reg)!;
    expect(view.tide.elevation![ring[0]]).toBe(3);
    expect(view.tide.elevation![ring[1]]).toBe(2);
    expect(view.tide.elevation![ring[2]]).toBe(1);

    // A coast tile (elevation 1) that is under the spring tide in round 4 but hidden by fog shows no overlay and no height.
    g.board.hexes[ring[3]].ext.hidden = true;
    g.round = 4;
    applyTides(ctx);
    expect(flooded(g, ring[3])).toBe(true);
    view = tideClientView(g, reg)!;
    expect(view.tide.elevation![ring[3]]).toBeUndefined();
    expect(view.overlays[ring[3]]).toBeUndefined();
    expect(view.overlays[ring[4]]?.kind).toBe('flood');
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });

  it('the view draws nothing from g.rng and changes no state', () => {
    const a = makeGame(on, 55);
    const b = makeGame(on, 55);
    for (let round = 1; round <= 6; round++) {
      for (const game of [a, b]) {
        game.g.round = round;
        applyTides(game.ctx);
      }
      b.g.turn = 1;
      tideClientView(b.g, b.reg);
      b.g.turn = 0;
    }
    expect(b.g.rng.s).toBe(a.g.rng.s);
    expect(JSON.stringify(b.g.board.hexes)).toBe(JSON.stringify(a.g.board.hexes));
  });
});

describe('manifest overlay kinds flood and flood-warn (R8.8 step 1)', () => {
  it('registers flood and flood-warn in OVERLAY_KINDS only while Tides is on, and passes all manifest checks', () => {
    const { reg } = makeGame(on);
    const map = defsOf<OverlayKindVisual>(reg, OVERLAY_KINDS);
    expect([...map.keys()].sort()).toEqual(['flood', 'flood-warn']);
    expect(map.get('flood')).toEqual(floodOverlayKind);
    expect(map.get('flood-warn')).toEqual(floodWarnOverlayKind);
    expect(floodOverlayKind.label).toBe('Flooded');
    expect(floodWarnOverlayKind.label).toBe('Flood warning');
    expect(floodWarnOverlayKind.pulse).toBe(true);
    expect(registryVisualProblems(reg)).toEqual([]);

    const manifest = buildVisualManifest(reg);
    expect(manifest.overlays).toEqual([floodOverlayKind, floodWarnOverlayKind]);

    for (const rules of [{}, { dlc: { tidebound: false } }, tidesOff]) {
      const offReg = registryFor(allPacks, rules);
      expect(defsOf(offReg, OVERLAY_KINDS).size).toBe(0);
      expect(buildVisualManifest(offReg).overlays).toEqual([]);
    }
  });

  it('client overlay renderer builds flood and flood-warn patterns, theme tokens, labels and pulse from the manifest, and leaves the 5 built-in kinds intact', () => {
    const { reg } = makeGame(on);
    const hexes = [
      { id: 0, type: 'wood', x: 10, y: 20 },
      { id: 1, type: 'brick', x: 50, y: 60 },
      { id: 2, type: 'sheep', x: 90, y: 100 }
    ];
    const poly = (id: number) => `0,0 10,${id}`;
    resetManifest();
    try {
      // Before the manifest arrives: the 5 unbuilt-DLC kinds exist, flood and flood-warn do not.
      const defsBefore = overlayPatternDefsMarkup();
      for (const k of ['wall-incomplete', 'plague', 'wave', 'crack', 'season']) {
        expect(defsBefore).toContain(`id="ov-pat-${k}"`);
      }
      expect(defsBefore).not.toContain('id="ov-pat-flood"');
      expect(defsBefore).not.toContain('id="ov-pat-flood-warn"');
      expect(overlayVarsCss()).toBe('');

      const htmlBefore = renderHexOverlaysMarkup(hexes, poly, {
        0: { kind: 'flood' },
        1: { kind: 'flood-warn' },
        2: { kind: 'plague' }
      });
      expect(htmlBefore).not.toContain('ov-pat-flood');
      expect(htmlBefore).toContain('url(#ov-pat-plague)');

      // After the Tidebound manifest arrives: theme tokens, patterns, labels and pulse are rendered from the manifest.
      setManifest(buildVisualManifest(reg));
      const css = overlayVarsCss();
      expect(css).toContain('--ov-flood-tint:rgba(21, 62, 112, 0.56)');
      expect(css).toContain('--ov-flood-line:rgba(186, 230, 253, 0.92)');
      expect(css).toContain(':root[data-theme="dark"]');
      expect(css).toContain('--ov-flood-warn-tint:rgba(29, 78, 137, 0.34)');

      const defsAfter = overlayPatternDefsMarkup();
      expect(defsAfter).toContain('id="ov-pat-flood"');
      expect(defsAfter).toContain('id="ov-pat-flood-warn"');
      expect(defsAfter).toContain('var(--ov-flood-tint)');
      expect(defsAfter).toContain('var(--ov-flood-warn-line)');
      expect(defsAfter).toContain('style="fill:var(--ov-flood-tint);stroke:none"');
      expect(defsAfter).not.toContain('stroke:var(--ov-flood-line)');

      const htmlAfter = renderHexOverlaysMarkup(hexes, poly, {
        0: { kind: 'flood' },
        1: { kind: 'flood-warn' },
        2: { kind: 'plague' }
      });
      expect(htmlAfter).toContain('fill="url(#ov-pat-flood)"');
      expect(htmlAfter).toContain('fill="url(#ov-pat-flood-warn)"');
      expect(htmlAfter).toContain('fill="url(#ov-pat-plague)"');
      expect(htmlAfter).toContain('>Flooded</text>');
      expect(htmlAfter).toContain('>Flood warning</text>');
      expect(htmlAfter).toContain('class="hex-overlay-item hex-overlay-flood"');
      expect(htmlAfter).toContain('class="hex-overlay-item hex-overlay-flood-warn hex-overlay-pulse"');
    } finally {
      resetManifest();
    }
  });
});

