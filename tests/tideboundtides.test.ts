import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import {
  FLOODED,
  TIDE_DEFAULT_LEVEL,
  TIDE_DURATION_MAX,
  TIDE_DURATION_MIN,
  TIDE_EVENT_ID,
  TIDE_LEVELS,
  applyTides,
  ensureTides,
  floodOverlayKind,
  floodSet,
  floodWarnOverlayKind,
  hexElevation,
  isPortFlooded,
  raiseTide,
  tideClientView,
  tideEventCard,
  tideLevelOf,
  tidePick,
  tideWarning
} from '../src/packs/tidebound';
import type { TideState } from '../src/packs/tidebound';
import { overlayPatternDefsMarkup, overlayVarsCss, renderHexOverlaysMarkup } from '../src/client/render/overlay';
import { resetManifest, setManifest } from '../src/client/visuals';
import { mergeSettings } from '../src/server/lobby';
import { defaultSettings, rulesFromSettings } from '../src/server/runtime';
import {
  OVERLAY_KINDS,
  allEventCards,
  buildTopology,
  buildVisualManifest,
  createGame,
  defsOf,
  ensureEventDeck,
  ensureEventTimeline,
  eventTimeline,
  makeCtx,
  ratioFor,
  registryFor,
  registryVisualProblems
} from '../src/shared';
import type { OverlayKindVisual } from '../src/shared';
import { runProductionPipeline } from '../src/shared/production';
import { getTileState, isHexRobberBlocked, resolveTileStateDef, setTileState } from '../src/shared/tileState';

// Tides as events (2026-11-24). A tide is a card of the Event Deck: it picks a height (1 to 3) and how many rounds it stays (2 to 5). Every land tile
// joined to the coast through tiles no higher than the height floods at once; a tide that comes while one is up raises it by 1 and keeps the longer
// of the two durations; when the rounds are over it retreats. The Tide level slider sets how many tide cards are in the deck. Nothing draws `g.rng`.

const on = { dlc: { tidebound: true }, eventsOn: true };
const tidesOff = { dlc: { tidebound: true }, eventsOn: true, addons: { 'tidebound.tides': false } };

/** A disc of land tiles (radius 3: 37 tiles, the outer ring of 18 is the coast). Every tile is a numbered wood tile. */
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

const ringIdx = (h: { q: number; r: number }) => Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r));

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
  g.round = 1;
  return { g, reg, ctx: makeCtx(g, reg) };
}

type Game = ReturnType<typeof makeGame>['g'];
const ringOf = (g: Game, radius: number): number[] => g.board.hexes.filter(h => ringIdx(h) === radius).map(h => h.id);
const flooded = (g: Game, id: number): boolean => getTileState(g.board.hexes[id])?.id === FLOODED;
const floodedIds = (g: Game): number[] => g.board.hexes.filter(h => getTileState(h)?.id === FLOODED).map(h => h.id);

/**
 * The basin board: coast ring (3) at elevation 1, ring 2 at elevation 2 except one low tile (the channel), ring 1 at elevation 1 (a low basin
 * behind the high ring), the centre at 3. Returns the channel tile and the basin tiles.
 */
function basin(g: Game, withChannel = true): { channel: number; basinIds: number[]; centre: number } {
  for (const h of g.board.hexes) {
    const r = ringIdx(h);
    h.ext.elevation = r === 3 ? 1 : r === 2 ? 2 : r === 1 ? 1 : 3;
  }
  // The channel: the ring-2 tile at (2, -1), next to the ring-1 tile (1, 0) and the coast.
  const channel = g.board.hexes.find(h => h.q === 2 && h.r === -1)!;
  if (withChannel) channel.ext.elevation = 1;
  return { channel: channel.id, basinIds: ringOf(g, 1), centre: g.board.hexes.find(h => ringIdx(h) === 0)!.id };
}

/** Puts a tide (height, until) up directly, as a tide card would, and floods the board for it. */
function tideUp(ctx: ReturnType<typeof makeGame>['ctx'], height: number, untilRound: number): void {
  const st = ensureTides(ctx.g, ctx.reg);
  st.height = height;
  st.untilRound = untilRound;
  applyTides(ctx);
}

/** Makes the next event a tide card firing at `round` (the deck's own timeline). */
function tideNext(g: Game, reg: ReturnType<typeof makeGame>['reg'], round: number): void {
  const st = ensureEventTimeline(g, reg, g.round || 0);
  st.deck[0] = TIDE_EVENT_ID;
  st.rounds![0] = round;
}

describe('registration', () => {
  it('with Tidebound on, the tide is a deck card with the waves icon, as many copies as the Tide level, and it uses the base flooded state', () => {
    const { g, reg } = makeGame(on);
    expect(reg.enabled.has('tidebound.tides')).toBe(true);
    const card = allEventCards(reg).get(TIDE_EVENT_ID)!;
    expect(card).toBe(tideEventCard);
    expect(card.icon).toBe('waves');
    for (let level = 1; level <= 5; level++) {
      const copies = typeof card.copies === 'function' ? card.copies({ ...g, rules: { ...g.rules, tideLevel: level } } as Game) : card.copies;
      expect(copies, `level ${level}`).toBe(level);
    }
    const def = resolveTileStateDef(reg, FLOODED)!;
    expect(def.yieldMultiplier).toBe(0.5);
    expect(def.yieldRound).toBe('ceil');
    expect(def.blocksRobber).toBe(true);
    const hexId = ringOf(g, 3)[0];
    setTileState(g, hexId, { id: FLOODED });
    expect(isHexRobberBlocked(g, reg, hexId)).toBe(true);
  });

  it('the Tide level puts that many tide cards in the shuffled deck', () => {
    for (const level of [1, 3, 5]) {
      const { g, reg } = makeGame({ ...on, tideLevel: level });
      const st = ensureEventDeck(g, reg);
      expect(st.deck.filter(id => id === TIDE_EVENT_ID).length, `level ${level}`).toBe(level);
    }
  });

  it('with the DLC off, or only the Tides addon off, there is no tide card and nothing floods', () => {
    for (const rules of [{ eventsOn: true }, { dlc: { tidebound: false }, eventsOn: true }, tidesOff]) {
      const { g, reg } = makeGame(rules);
      expect(reg.enabled.has('tidebound.tides')).toBe(false);
      expect(allEventCards(reg).has(TIDE_EVENT_ID)).toBe(false);
      for (let round = 1; round <= 30; round++) {
        g.round = round;
        for (const hook of reg.hooks.onRoundStart) hook(makeCtx(g, reg));
      }
      expect(floodedIds(g)).toEqual([]);
      expect(g.ext.tidebound?.tides).toBeUndefined();
    }
  });

  it('with the Event Deck off, Tides is on but no tide ever rises', () => {
    const { g, reg } = makeGame({ dlc: { tidebound: true } });
    expect(reg.enabled.has('tidebound.tides')).toBe(true);
    for (let round = 1; round <= 30; round++) {
      g.round = round;
      for (const hook of reg.hooks.onRoundStart) hook(makeCtx(g, reg));
    }
    expect(floodedIds(g)).toEqual([]);
  });
});

describe('the tide card picks a height and a duration', () => {
  it('height 1 to 3, mostly 1; 2 to 5 rounds; the same for the same seed and round', () => {
    const counts = [0, 0, 0, 0];
    const durations = new Set<number>();
    for (let round = 1; round <= 3000; round++) {
      const p = tidePick(777, round);
      expect(p).toEqual(tidePick(777, round));
      expect(p.height).toBeGreaterThanOrEqual(1);
      expect(p.height).toBeLessThanOrEqual(3);
      expect(p.rounds).toBeGreaterThanOrEqual(TIDE_DURATION_MIN);
      expect(p.rounds).toBeLessThanOrEqual(TIDE_DURATION_MAX);
      counts[p.height]++;
      durations.add(p.rounds);
    }
    expect(counts[1]).toBeGreaterThan(counts[2]);
    expect(counts[2]).toBeGreaterThan(counts[3]);
    expect(counts[3]).toBeGreaterThan(0);
    expect([...durations].sort()).toEqual([2, 3, 4, 5]);
    expect(tidePick(778, 10)).not.toEqual(tidePick(777, 10));
  });
});

describe('where the water goes', () => {
  it('floods every tile joined to the coast through tiles no higher than the height, at once: a low basin 2 tiles in floods through a low channel', () => {
    const { g, reg } = makeGame(on);
    const { channel, basinIds, centre } = basin(g, true);
    const at1 = new Set(floodSet(g, reg, 1));
    for (const id of ringOf(g, 3)) expect(at1.has(id)).toBe(true);
    expect(at1.has(channel)).toBe(true);
    for (const id of basinIds) expect(at1.has(id), `basin ${id}`).toBe(true);
    for (const id of ringOf(g, 2).filter(id => id !== channel)) expect(at1.has(id)).toBe(false);
    expect(at1.has(centre)).toBe(false);

    const at2 = new Set(floodSet(g, reg, 2));
    expect(at2.size).toBe(g.board.hexes.length - 1);
    expect(at2.has(centre)).toBe(false);
    expect(floodSet(g, reg, 3).length).toBe(g.board.hexes.length);
  });

  it('a low basin behind high ground stays dry at height 1 (no low path to the sea)', () => {
    const { g, reg } = makeGame(on);
    const { basinIds } = basin(g, false);
    const at1 = new Set(floodSet(g, reg, 1));
    for (const id of basinIds) expect(at1.has(id)).toBe(false);
    expect([...at1].sort((a, b) => a - b)).toEqual(ringOf(g, 3).sort((a, b) => a - b));
  });

  it('hidden tiles never flood and the water does not pass under them', () => {
    const { g, reg } = makeGame(on);
    const { channel, basinIds } = basin(g, true);
    g.board.hexes[channel].ext.hidden = true;
    const at1 = new Set(floodSet(g, reg, 1));
    expect(at1.has(channel)).toBe(false);
    for (const id of basinIds) expect(at1.has(id)).toBe(false);
  });

  it('a tile without elevation data counts as 1', () => {
    const { g } = makeGame(on);
    const hex = g.board.hexes[0];
    expect(hexElevation(hex)).toBe(1);
    for (const [value, want] of [[1, 1], [2, 2], [3, 3], [9, 3], [0, 1], [-4, 1], ['x', 1], [null, 1]] as const) {
      hex.ext.elevation = value;
      expect(hexElevation(hex), `elevation ${String(value)}`).toBe(want);
    }
  });
});

describe('rising, staying and retreating', () => {
  it('a tide card floods the board at once, logs it, and records the rise for the title card', () => {
    const { g, reg, ctx } = makeGame(on, 4242);
    basin(g, true);
    g.round = 6;
    const events: any[] = [];
    const logs: string[] = [];
    const c = { ...ctx, emit: (type: string, data: any) => events.push({ type, data }), log: (t: string) => logs.push(t) } as typeof ctx;
    raiseTide(c);
    const p = tidePick(g.seed, 6);
    const st = g.ext.tidebound.tides as TideState;
    expect(st.height).toBe(p.height);
    expect(st.untilRound).toBe(6 + p.rounds);
    expect(floodedIds(g).sort((a, b) => a - b)).toEqual(floodSet(g, reg, p.height));
    expect(st.rose).toEqual({ round: 6, height: p.height, untilRound: 6 + p.rounds, count: floodSet(g, reg, p.height).length, stacked: false });
    const changed = events.find(e => e.type === 'tideChanged');
    expect(changed.data).toMatchObject({ round: 6, height: p.height, stacked: false });
    expect(changed.data.risen.length).toBe(floodSet(g, reg, p.height).length);
    expect(logs.some(l => l.includes('tide rises'))).toBe(true);
  });

  it('stays for its rounds and retreats at the round start after the last one', () => {
    const { g, ctx } = makeGame(on);
    g.round = 4;
    tideUp(ctx, 1, 7);
    const wet = floodedIds(g);
    expect(wet.length).toBeGreaterThan(0);
    for (const round of [5, 6]) {
      g.round = round;
      applyTides(ctx);
      expect(floodedIds(g)).toEqual(wet);
    }
    g.round = 7;
    applyTides(ctx);
    expect(floodedIds(g)).toEqual([]);
    expect((g.ext.tidebound.tides as TideState).height).toBe(0);
  });

  it("stacks: tide 1 with 2 rounds left, hit by a tide card of 3 rounds, becomes tide 2 for 3 rounds (the user's example)", () => {
    const { g, reg, ctx } = makeGame(on);
    basin(g, true);
    // Find a round whose card is a 3-round tide.
    let round = 10;
    while (tidePick(g.seed, round).rounds !== 3) round++;
    g.round = round;
    tideUp(ctx, 1, round + 2);
    raiseTide(ctx);
    const st = g.ext.tidebound.tides as TideState;
    expect(st.height).toBe(2);
    expect(st.untilRound).toBe(round + 3);
    expect(st.rose).toMatchObject({ stacked: true, height: 2 });
    expect(floodedIds(g).sort((a, b) => a - b)).toEqual(floodSet(g, reg, 2));
  });

  it('a stacked tide keeps the longer time left, and never rises past 3', () => {
    const { g, ctx } = makeGame(on);
    let round = 10;
    while (tidePick(g.seed, round).rounds !== 2) round++;
    g.round = round;
    tideUp(ctx, 3, round + 4);
    raiseTide(ctx);
    const st = g.ext.tidebound.tides as TideState;
    expect(st.height).toBe(3);
    expect(st.untilRound).toBe(round + 4);
  });

  it('a tide card after the last tide has gone is a fresh tide with its own height', () => {
    const { g, ctx } = makeGame(on);
    g.round = 3;
    tideUp(ctx, 3, 5);
    g.round = 5;
    raiseTide(ctx);
    const p = tidePick(g.seed, 5);
    const st = g.ext.tidebound.tides as TideState;
    expect(st.height).toBe(p.height);
    expect(st.rose?.stacked).toBe(false);
  });

  it('never overwrites another tile state, and never clears one it did not set', () => {
    const { g, ctx } = makeGame(on);
    const coast = ringOf(g, 3);
    setTileState(g, coast[0], { id: 'barren' });
    setTileState(g, coast[1], { id: FLOODED, until: 99 } as any);
    g.round = 2;
    tideUp(ctx, 1, 4);
    expect(getTileState(g.board.hexes[coast[0]])?.id).toBe('barren');
    g.round = 4;
    applyTides(ctx);
    expect(getTileState(g.board.hexes[coast[0]])?.id).toBe('barren');
    // The flood that was there before the tide (another source) is left alone when the tide goes.
    expect(flooded(g, coast[1])).toBe(true);
    expect(flooded(g, coast[2])).toBe(false);
  });

  it('runs from the round clock: the tide card fires on its round and the water goes when its rounds are over', () => {
    const { g, reg } = makeGame(on, 31);
    g.round = 1;
    tideNext(g, reg, 3);
    // Only this one tide in the pile, so no second tide card stacks on it inside the window.
    const deck = ensureEventDeck(g, reg);
    deck.deck = deck.deck.map((id, i) => (i > 0 && id === TIDE_EVENT_ID ? 'base.calm_seas' : id));
    const p = tidePick(g.seed, 3);
    for (let round = 2; round <= 3 + p.rounds; round++) {
      g.round = round;
      for (const hook of reg.hooks.onRoundStart) hook(makeCtx(g, reg));
      const wet = floodedIds(g).length > 0;
      expect(wet, `round ${round}`).toBe(round >= 3 && round < 3 + p.rounds);
    }
  });
});

describe('what flooding does', () => {
  it('a flooded tile yields half resources rounded up per building (settlement 1->1, city 2->1, castle 3->2) and a dry one yields full', () => {
    const { g, reg, ctx } = makeGame(on);
    basin(g, false);
    const wet = g.board.hexes[ringOf(g, 3)[0]];
    const dry = g.board.hexes.find(h => ringIdx(h) === 0)!;
    const ownCorner = (h: typeof wet) => h.vertexIds.find(v => g.board.vertices[v].hexIds.length === 1)!;
    const wetV = ownCorner(wet);
    const dryV = dry.vertexIds[0];
    g.board.vertices[wetV].piece = { type: 'city', owner: 'a' };
    g.board.vertices[dryV].piece = { type: 'city', owner: 'b' };
    const woodOf = (id: string) => g.players.find(p => p.id === id)!.resources.wood || 0;

    runProductionPipeline(ctx, [wet], 6);
    expect(woodOf('a')).toBe(2);

    g.round = 2;
    tideUp(ctx, 1, 4);
    expect(flooded(g, wet.id)).toBe(true);
    expect(flooded(g, dry.id)).toBe(false);
    runProductionPipeline(ctx, [wet, dry], 6);
    expect(woodOf('a')).toBe(3);
    expect(woodOf('b')).toBe(2);

    g.board.vertices[wetV].piece = { type: 'settlement', owner: 'a' };
    runProductionPipeline(ctx, [wet], 6);
    expect(woodOf('a')).toBe(4);

    reg.pieces.set('castle', { id: 'castle', name: 'Castle', target: 'vertex', cost: {}, vp: 3, produces: 3, canPlace: () => false });
    g.board.vertices[wetV].piece = { type: 'castle', owner: 'a' };
    runProductionPipeline(ctx, [wet], 6);
    expect(woodOf('a')).toBe(6);

    g.round = 4;
    applyTides(ctx);
    runProductionPipeline(ctx, [wet], 6);
    expect(woodOf('a')).toBe(9);
  });

  it('the robber stays on a tile that floods', () => {
    const { g, ctx } = makeGame(on);
    const wet = ringOf(g, 3)[0];
    g.board.robberHexId = wet;
    g.round = 2;
    tideUp(ctx, 1, 4);
    expect(flooded(g, wet)).toBe(true);
    expect(g.board.robberHexId).toBe(wet);
  });
});

describe('ports idle while flooded (T5e)', () => {
  /** Player a's settlement on a coast corner that touches only one tile, with a 2:1 wood port. The basin board keeps ring 2 dry at height 1. */
  function portSetup() {
    const game = makeGame(on);
    const { g } = game;
    basin(g, false);
    const hex = g.board.hexes[ringOf(g, 3)[0]];
    const vertexId = hex.vertexIds.find(v => g.board.vertices[v].hexIds.length === 1)!;
    g.board.vertices[vertexId].piece = { type: 'settlement', owner: 'a' };
    g.board.vertices[vertexId].port = 'wood';
    return { ...game, hex, vertexId };
  }

  it('a port on a flooded tile does not trade, and works again when the water drains', () => {
    const { g, reg, ctx, vertexId } = portSetup();
    expect(ratioFor(g, reg, 'a', 'wood')).toBe(2);
    g.round = 2;
    tideUp(ctx, 1, 3);
    expect(isPortFlooded(g, reg, vertexId)).toBe(true);
    expect(ratioFor(g, reg, 'a', 'wood')).toBe(4);
    g.round = 3;
    applyTides(ctx);
    expect(isPortFlooded(g, reg, vertexId)).toBe(false);
    expect(ratioFor(g, reg, 'a', 'wood')).toBe(2);
  });

  it('a port on a corner between a flooded and a dry tile keeps trading; both flooded stops it', () => {
    const { g, reg } = makeGame(on);
    const vertex = g.board.vertices.find(v => v.hexIds.length === 2)!;
    vertex.piece = { type: 'settlement', owner: 'a' };
    vertex.port = 'wood';
    setTileState(g, vertex.hexIds[0], { id: FLOODED });
    expect(isPortFlooded(g, reg, vertex.id)).toBe(false);
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

describe('the timeline, the warning and the client view', () => {
  it('the timeline shows a tide with its height and rounds, and with a tide already up it shows the stacked tide', () => {
    const { g, reg, ctx } = makeGame(on);
    g.round = 2;
    tideNext(g, reg, 5);
    const p = tidePick(g.seed, 5);
    expect(eventTimeline(g, reg)[0]).toMatchObject({ cardId: TIDE_EVENT_ID, icon: 'waves', round: 5, detail: `Tide ${p.height} · ${p.rounds} rounds` });

    tideUp(ctx, 1, 7); // up until round 7: at round 5 it has 2 rounds left
    const stacked = eventTimeline(g, reg)[0].detail;
    expect(stacked).toBe(`Tide 2 · ${Math.max(2, p.rounds)} rounds`);
  });

  it('warns one turn ahead: on the last seat\'s turn before a tide round, for the tiles that will go under', () => {
    const { g, reg } = makeGame(on);
    basin(g, false);
    g.round = 4;
    tideNext(g, reg, 5);
    const p = tidePick(g.seed, 5);
    g.turn = 0;
    expect(tideWarning(g, reg)).toBeNull();
    g.turn = 1;
    const w = tideWarning(g, reg)!;
    expect(w).toMatchObject({ round: 5, height: p.height, rounds: p.rounds });
    expect(w.hexIds.sort((a, b) => a - b)).toEqual(floodSet(g, reg, p.height));
    const view = tideClientView(g, reg)!;
    expect(view.overlays[w.hexIds[0]]).toEqual({ kind: 'flood-warn' });
    expect(view.tide.warning).toMatchObject({ round: 5, height: p.height, count: w.hexIds.length });
  });

  it('no warning when the next round brings no tide, or the tide card is vetoed', () => {
    const { g, reg } = makeGame(on);
    g.round = 4;
    g.turn = 1;
    tideNext(g, reg, 6);
    expect(tideWarning(g, reg)).toBeNull();
    tideNext(g, reg, 5);
    expect(tideWarning(g, reg)).not.toBeNull();
    const st = ensureEventDeck(g, reg);
    st.deck[1] = 'base.festival';
    st.pendingVeto = { cardId: TIDE_EVENT_ID, vetoedBy: 'a', upheldBy: null } as any;
    expect(tideWarning(g, reg)).toBeNull();
  });

  it('the client view: null with Tides off; flood overlays; the tide up and until when; rose only in the round it rose', () => {
    expect(tideClientView(makeGame(tidesOff).g, makeGame(tidesOff).reg)).toBeNull();
    const { g, reg, ctx } = makeGame(on);
    let view = tideClientView(g, reg)!;
    expect(view.tide).toMatchObject({ height: 0, untilRound: null, rose: null, warning: null, levelName: TIDE_LEVELS[TIDE_DEFAULT_LEVEL - 1].name });
    g.round = 6;
    raiseTide(ctx);
    const st = g.ext.tidebound.tides as TideState;
    view = tideClientView(g, reg)!;
    expect(view.tide.height).toBe(st.height);
    expect(view.tide.untilRound).toBe(st.untilRound);
    expect(view.tide.rose).toEqual(st.rose);
    for (const id of floodedIds(g)) expect(view.overlays[id]).toEqual({ kind: 'flood' });
    g.round = 7;
    applyTides(ctx);
    expect(tideClientView(g, reg)!.tide.rose).toBeNull();
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });

  it('elevation data: null when every tile is the same, the heights when they differ, never for fogged tiles', () => {
    const { g, reg } = makeGame(on);
    expect(tideClientView(g, reg)!.tide.elevation).toBeNull();
    const ring = ringOf(g, 3);
    g.board.hexes[ring[0]].ext.elevation = 3;
    g.board.hexes[ring[1]].ext.hidden = true;
    const view = tideClientView(g, reg)!;
    expect(view.tide.elevation![ring[0]]).toBe(3);
    expect(view.tide.elevation![ring[2]]).toBe(1);
    expect(view.tide.elevation![ring[1]]).toBeUndefined();
  });
});

describe('seed discipline and saves', () => {
  it('draws nothing from g.rng over many rounds of events', () => {
    const withTides = makeGame({ ...on, tideLevel: 5 }, 123);
    const without = makeGame({ eventsOn: true }, 123);
    expect(withTides.g.rng.s).toBe(without.g.rng.s);
    for (let round = 1; round <= 40; round++) {
      withTides.g.round = round;
      for (const hook of withTides.reg.hooks.onRoundStart) hook(makeCtx(withTides.g, withTides.reg));
    }
    expect(withTides.g.rng.s).toBe(without.g.rng.s);
  });

  it('the tide state is plain JSON; a save from the old schedule is cleared of its floods on the next round', () => {
    const { g, reg, ctx } = makeGame(on, 42);
    g.round = 2;
    raiseTide(ctx);
    expect(JSON.parse(JSON.stringify(g.ext.tidebound.tides))).toEqual(g.ext.tidebound.tides);

    const old = makeGame(on, 42);
    old.g.ext.tidebound = { tides: { clusters: [{ id: 0, hexIds: ringOf(old.g, 3), inner: [], phase: 0 }] } };
    for (const id of ringOf(old.g, 3)) setTileState(old.g, id, { id: FLOODED });
    old.g.round = 9;
    applyTides(old.ctx);
    expect(floodedIds(old.g)).toEqual([]);
    expect(old.g.ext.tidebound.tides).toMatchObject({ height: 0 });
    void reg;
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

    const s = { ...base, dlc: { tidebound: true }, tideLevel: 4 };
    expect(rulesFromSettings(s).tideLevel).toBe(4);
    expect(rulesFromSettings({ ...s, tideLevel: 3 }).tideLevel).toBeUndefined();
    expect(rulesFromSettings({ ...s, addons: { 'tidebound.tides': false } }).tideLevel).toBeUndefined();
    expect('tideLevel' in rulesFromSettings(base)).toBe(false);
    expect(tideLevelOf({ rules: { tideLevel: 9 } } as any)).toBe(5);
  });
});

describe('manifest overlay kinds flood and flood-warn (R8.8 step 1)', () => {
  it('registers flood and flood-warn in OVERLAY_KINDS only while Tides is on, and passes all manifest checks', () => {
    const { reg } = makeGame(on);
    const map = defsOf<OverlayKindVisual>(reg, OVERLAY_KINDS);
    expect([...map.keys()].sort()).toEqual(['flood', 'flood-warn']);
    expect(map.get('flood')).toEqual(floodOverlayKind);
    expect(map.get('flood-warn')).toEqual(floodWarnOverlayKind);
    expect(registryVisualProblems(reg)).toEqual([]);
    expect(buildVisualManifest(reg).overlays).toEqual([floodOverlayKind, floodWarnOverlayKind]);
    for (const rules of [{}, { dlc: { tidebound: false } }, tidesOff]) {
      const offReg = registryFor(allPacks, rules);
      expect(defsOf(offReg, OVERLAY_KINDS).size).toBe(0);
    }
  });

  it('client overlay renderer builds flood and flood-warn patterns, labels and pulse from the manifest', () => {
    const { reg } = makeGame(on);
    const hexes = [
      { id: 0, type: 'wood', x: 10, y: 20 },
      { id: 1, type: 'brick', x: 50, y: 60 }
    ];
    const poly = (id: number) => `0,0 10,${id}`;
    resetManifest();
    try {
      expect(overlayPatternDefsMarkup()).not.toContain('id="ov-pat-flood"');
      setManifest(buildVisualManifest(reg));
      expect(overlayVarsCss()).toContain('--ov-flood-tint:rgba(21, 62, 112, 0.56)');
      expect(overlayPatternDefsMarkup()).toContain('id="ov-pat-flood-warn"');
      const html = renderHexOverlaysMarkup(hexes, poly, { 0: { kind: 'flood' }, 1: { kind: 'flood-warn' } });
      expect(html).toContain('>Flooded</text>');
      expect(html).toContain('class="hex-overlay-item hex-overlay-flood-warn hex-overlay-pulse"');
    } finally {
      resetManifest();
    }
  });
});
