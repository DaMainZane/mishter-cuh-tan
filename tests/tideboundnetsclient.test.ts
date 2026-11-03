import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import {
  NET_BOT_MAX,
  PLACE_NET,
  canPlaceNet,
  isSeaHex,
  netBotGoal,
  netLimit,
  netSpotHexIds,
  netSpotsView,
  netViewData,
  netsOf,
  seaHexIdsAt
} from '../src/packs/tidebound/fishing';
import { chooseBotAction } from '../src/server/bots/brain';
import {
  BOT_GOALS,
  buildTopology,
  createGame,
  defsOf,
  legalActions,
  makeCtx,
  registryFor
} from '../src/shared';

// T7b2 (net rework): what the client needs for fishing nets. The server lists the sea TILES a net could go on (`netSpotsView`, sent as `netSpots`
// to the player whose main-phase turn it is), the tiles that carry a player's nets are public (`netTiles`), a net takes no vertex (so a port
// vertex no longer blocks it), and a bot builds a few nets as a side build (`netBotGoal`, action `place_net`).

const on = { dlc: { tidebound: true } };
const fishOff = { dlc: { tidebound: true }, addons: { 'tidebound.fishing': false } };

/** A small island (land within `landRadius` of the centre) inside a ring of sea out to radius 3. */
function islandInits(landRadius: number): { q: number; r: number; type: string; number: number | null }[] {
  const out: { q: number; r: number; type: string; number: number | null }[] = [];
  for (let q = -3; q <= 3; q++) {
    for (let r = -3; r <= 3; r++) {
      if (Math.abs(q + r) > 3) continue;
      const dist = (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
      const land = dist <= landRadius;
      out.push({ q, r, type: land ? 'wood' : 'water', number: land ? 6 : null });
    }
  }
  return out;
}

function makeGame(rules: Record<string, any> = on, seed = 99, landRadius = 1) {
  const reg = registryFor(allPacks, rules);
  const board = buildTopology(islandInits(landRadius), {
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

type M = ReturnType<typeof makeGame>;

const player = (g: M['g'], id: string) => g.players.find(p => p.id === id)!;

/** Ids of the vertices that touch land and sea, ascending. */
const coastIds = (m: M): number[] => m.g.board.vertices.filter(v => v.hexIds.length > 0 && seaHexIdsAt(m.g, m.reg, v.id).length > 0).map(v => v.id);
/** Ids of every open sea tile, ascending. */
const seaIds = (m: M): number[] => m.g.board.hexes.filter(h => isSeaHex(m.reg, h)).map(h => h.id);

/** A net needs a settlement or city of yours at a corner of its tile (it pays like a land tile), so this puts a settlement of `owner` on the vertex. */
function giveRoadAt(g: M['g'], vertexId: number, owner: string): number {
  g.board.vertices[vertexId].piece = { type: 'settlement', owner };
  return vertexId;
}

describe('no net on a vertex, so a port vertex does not block', () => {
  it('still offers the tiles at a port vertex next to your road', () => {
    const m = makeGame();
    const coast = coastIds(m)[0];
    const tile = seaHexIdsAt(m.g, m.reg, coast)[0];
    giveRoadAt(m.g, coast, 'a');
    expect(canPlaceNet(m.ctx, 'a', tile, 'build')).toBe(true);

    m.g.board.vertices[coast].port = '3:1';
    expect(canPlaceNet(m.ctx, 'a', tile, 'build')).toBe(true);
    expect(netSpotsView(m.g, m.reg, player(m.g, 'a'))).toContain(tile);
  });
});

describe('netSpotsView (the client build spots, hex ids)', () => {
  it('lists the tiles canPlaceNet accepts for this player, all open sea', () => {
    const m = makeGame();
    const coast = coastIds(m)[0];
    giveRoadAt(m.g, coast, 'a');
    const spots = netSpotsView(m.g, m.reg, player(m.g, 'a'))!;
    expect(spots.length).toBeGreaterThan(0);
    for (const id of seaHexIdsAt(m.g, m.reg, coast)) expect(spots).toContain(id);
    for (const id of spots) {
      expect(canPlaceNet(m.ctx, 'a', id, 'build')).toBe(true);
      expect(isSeaHex(m.reg, m.g.board.hexes[id])).toBe(true);
    }
    expect(spots).toEqual(netSpotHexIds(m.ctx, 'a'));
    // The same set the place_net action offers once the price is paid.
    const a = player(m.g, 'a');
    a.resources.wood = 2;
    a.resources.sheep = 1;
    const legal = legalActions(m.g, m.reg, 'a').filter(x => x.type === PLACE_NET).map(x => x.payload.hexId);
    expect([...legal].sort((x, y) => x - y)).toEqual([...spots].sort((x, y) => x - y));
  });

  it('leaves out a tile that already carries a net', () => {
    const m = makeGame();
    const coast = coastIds(m)[0];
    giveRoadAt(m.g, coast, 'a');
    const taken = seaHexIdsAt(m.g, m.reg, coast)[0];
    m.g.board.hexes[taken].ext.net = { owner: 'b' };
    expect(netSpotsView(m.g, m.reg, player(m.g, 'a'))).not.toContain(taken);
  });

  it('is empty with no road of yours next to the coast (another player\'s road does not count)', () => {
    const m = makeGame();
    expect(netSpotsView(m.g, m.reg, player(m.g, 'a'))).toEqual([]);
    giveRoadAt(m.g, coastIds(m)[0], 'b');
    expect(netSpotsView(m.g, m.reg, player(m.g, 'a'))).toEqual([]);
  });

  it('is undefined when nets are not in the game, off your turn and outside the main phase', () => {
    for (const rules of [{}, { dlc: { tidebound: false } }, fishOff]) {
      const m = makeGame(rules);
      expect(netSpotsView(m.g, m.reg, player(m.g, 'a'))).toBeUndefined();
    }
    const m = makeGame();
    giveRoadAt(m.g, coastIds(m)[0], 'a');
    // It is a's turn: b gets nothing.
    expect(netSpotsView(m.g, m.reg, player(m.g, 'b'))).toBeUndefined();
    m.g.phase = 'roll';
    expect(netSpotsView(m.g, m.reg, player(m.g, 'a'))).toBeUndefined();
    m.g.phase = 'main';
    expect(netSpotsView(m.g, m.reg, player(m.g, 'a'))).toBeDefined();
  });

  it('is empty when the supply of nets is used up', () => {
    const m = makeGame();
    giveRoadAt(m.g, coastIds(m)[0], 'a');
    const tiles = seaIds(m);
    const far = tiles.slice(-netLimit(m.g));
    expect(far).toHaveLength(netLimit(m.g));
    for (const id of far) m.g.board.hexes[id].ext.net = { owner: 'a' };
    expect(netSpotsView(m.g, m.reg, player(m.g, 'a'))).toEqual([]);
  });
});

describe('netViewData (per-player view fields)', () => {
  const view = (m: M, pid: string, self: boolean) => netViewData.player!(m.g, m.reg, player(m.g, pid), { self } as any) as Record<string, unknown>;

  it('sends netTiles for every viewer, the supply once unlocked, and netSpots and netCost only to yourself', () => {
    const m = makeGame();
    const tiles = seaIds(m);
    m.g.board.hexes[tiles[0]].ext.net = { owner: 'a' };
    m.g.board.hexes[tiles[1]].ext.net = { owner: 'a' };
    giveRoadAt(m.g, coastIds(m)[0], 'a');

    const mine = view(m, 'a', true);
    expect(mine.netTiles).toEqual(netsOf(m.g, 'a'));
    expect(mine.netsLeft).toBe(netLimit(m.g) - 2);
    expect(Array.isArray(mine.netSpots)).toBe(true);
    // The price of the next net: the client reads it for the button, the recipe popup and the afford check (a net is no longer in `pieceCosts`).
    expect(mine.netCost).toEqual({ wood: 2, sheep: 1 });

    const seen = view(m, 'a', false);
    expect(seen.netTiles).toEqual([tiles[0], tiles[1]]);
    expect(seen.netSpots).toBeUndefined();
    expect(seen.netCost).toBeUndefined();

    expect(view(m, 'b', true).netTiles).toBeUndefined();
  });

  it('sends nothing when nets are not in the game', () => {
    for (const rules of [{}, { dlc: { tidebound: false } }, fishOff]) {
      const m = makeGame(rules);
      const v = view(m, 'a', true);
      expect(v.netTiles).toBeUndefined();
      expect(v.netsLeft).toBeUndefined();
      expect(v.netSpots).toBeUndefined();
      expect(v.netCost).toBeUndefined();
    }
  });
});

describe('net bot goal', () => {
  /** A hand big enough for the price (2 wood + 1 sheep) plus 2 spare cards. */
  function richBot(m: M) {
    const a = player(m.g, 'a');
    a.resources.wood = 3;
    a.resources.sheep = 2;
    return a;
  }

  it('is registered with Fishing on and not with the DLC or Fishing off', () => {
    expect(defsOf(makeGame(on).reg, BOT_GOALS).has(netBotGoal.id)).toBe(true);
    for (const rules of [{}, { dlc: { tidebound: false } }, fishOff]) {
      expect(defsOf(makeGame(rules).reg, BOT_GOALS).has(netBotGoal.id)).toBe(false);
    }
  });

  it('offers a net on a legal tile when the hand has the price and 2 cards to spare', () => {
    const m = makeGame();
    giveRoadAt(m.g, coastIds(m)[0], 'a');
    richBot(m);
    const goals = netBotGoal.goals!(m.ctx, 'a');
    expect(goals).toHaveLength(1);
    const act = goals[0].action!;
    expect(act.type).toBe(PLACE_NET);
    expect(canPlaceNet(m.ctx, 'a', act.payload.hexId, 'build')).toBe(true);
    expect(goals[0].cost).toEqual({ wood: 2, sheep: 1 });
  });

  it('offers nothing with just the price, without a spot or at the bot limit', () => {
    const m = makeGame();
    const coast = coastIds(m)[0];
    const a = richBot(m);
    expect(netBotGoal.goals!(m.ctx, 'a')).toEqual([]); // no road yet, so no spot

    giveRoadAt(m.g, coast, 'a');
    a.resources.wood = 2;
    a.resources.sheep = 1;
    expect(netBotGoal.goals!(m.ctx, 'a')).toEqual([]); // price only, nothing spare
    richBot(m);
    expect(netBotGoal.goals!(m.ctx, 'a')).toHaveLength(1);

    const spots = netSpotHexIds(m.ctx, 'a');
    const others = seaIds(m).filter(id => !spots.includes(id)).slice(0, NET_BOT_MAX);
    expect(others).toHaveLength(NET_BOT_MAX);
    for (const id of others) m.g.board.hexes[id].ext.net = { owner: 'a' };
    expect(netBotGoal.goals!(m.ctx, 'a')).toEqual([]);
  });

  it('prefers a tile that holds a fish icon', () => {
    const m = makeGame();
    const ids = coastIds(m);
    const first = ids[0];
    const v0 = m.g.board.vertices[first];
    const far = ids.reduce((best, id) => {
      const v = m.g.board.vertices[id];
      const d = Math.hypot(v.x - v0.x, v.y - v0.y);
      return d > best.d ? { id, d } : best;
    }, { id: first, d: -1 }).id;
    giveRoadAt(m.g, first, 'a');
    giveRoadAt(m.g, far, 'a');
    const near = new Set(seaHexIdsAt(m.g, m.reg, first));
    const fishHex = seaHexIdsAt(m.g, m.reg, far).find(id => !near.has(id));
    expect(fishHex).toBeDefined();
    m.g.board.hexes[fishHex!].ext.fish = 4;
    richBot(m);

    expect(netBotGoal.goals!(m.ctx, 'a')[0].action!.payload.hexId).toBe(fishHex);
  });

  it('the brain really places the net (nothing better to do, a few cards to spare)', () => {
    const m = makeGame();
    giveRoadAt(m.g, coastIds(m)[0], 'a');
    richBot(m);
    const move = chooseBotAction(m.g, m.reg, 'a', () => 0.5);
    expect(move).not.toBeNull();
    expect(move!.type).toBe(PLACE_NET);
    expect(canPlaceNet(m.ctx, 'a', move!.payload.hexId, 'build')).toBe(true);
  });
});
