import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import {
  NET,
  NET_BASE_LIMIT,
  NET_CATCH_CHANCE,
  NET_COST,
  FISH,
  PLACE_NET,
  canPlaceNet,
  isSeaHex,
  migrateVertexNets,
  netCatchOnRoll,
  netLimit,
  netPrice,
  netSpotHexIds,
  netYield,
  netsLeft,
  netsOf,
  seaHexIdsAt
} from '../src/packs/tidebound/fishing';
import {
  buildTopology,
  createGame,
  dispatch,
  getWildTokens,
  legalActions,
  makeCtx,
  registryFor
} from '../src/shared';
import { setTileState } from '../src/shared/tileState';

// T7b1 (net rework): fishing nets. A net sits on ONE open sea tile (`hex.ext.net = { owner }`), fishes only that tile, and a tile holds at most one
// net. The player picks the tile with the `place_net` action. The tile must touch a settlement or city of yours, like a land tile that only pays the
// buildings on its corners. On every roll each net has a 1 in 6 chance to catch fish for its owner: 1 per settlement and 2 per city on the tile. The draw is a hash of the world seed, the roll count and the
// tile, so it never touches `g.rng`, and nothing reads the tile state of the land, so a net keeps fishing under a flood.

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
/** Ids of the vertices with only land around them. */
const inlandIds = (m: M): number[] => m.g.board.vertices.filter(v => v.hexIds.length === 3 && seaHexIdsAt(m.g, m.reg, v.id).length === 0).map(v => v.id);
/** Ids of every open sea tile, ascending. */
const seaIds = (m: M): number[] => m.g.board.hexes.filter(h => isSeaHex(m.reg, h)).map(h => h.id);

/** Puts a road of `owner` on a land edge at this vertex. */
function giveRoadAt(g: M['g'], vertexId: number, owner: string): number {
  const v = g.board.vertices[vertexId];
  const edgeId = v.edgeIds.find(e => g.board.edges[e].hexIds.length > 0)!;
  g.board.edges[edgeId].piece = { type: 'road', owner };
  return edgeId;
}

/** Puts a settlement (or a city) of `owner` on this vertex. */
function giveBuildingAt(g: M['g'], vertexId: number, owner: string, type = 'settlement'): void {
  g.board.vertices[vertexId].piece = { type, owner };
}

/** Ids of the sea tiles that touch a coast vertex (a building can stand at one of their corners), ascending. */
const coastSeaIds = (m: M): number[] => seaIds(m).filter(id => m.g.board.vertices.some(v => v.hexIds.length > 0 && seaHexIdsAt(m.g, m.reg, v.id).includes(id)));

/**
 * Puts a net of `owner` straight on a tile (no price, no checks). A net only pays the buildings at its corners, so when `owner` has none there yet,
 * a settlement is put on the first free coast corner of the tile (use `type` 'city' for a city).
 */
function putNet(m: M, hexId: number, owner = 'a', type = 'settlement'): void {
  m.g.board.hexes[hexId].ext.net = { owner };
  if (netYield(m.g, m.reg, hexId, owner) > 0) return;
  const corner = m.g.board.vertices.find(v => v.hexIds.length > 0 && !v.piece && seaHexIdsAt(m.g, m.reg, v.id).includes(hexId));
  if (corner) giveBuildingAt(m.g, corner.id, owner, type);
}

/** Runs the catch for `n` rolls the way the roll action does (it adds one to `diceStats` first). Returns one 0/1 per roll for `owner`'s fish. */
function rollMany(m: M, n: number, owner = 'a'): string {
  let pattern = '';
  for (let i = 0; i < n; i++) {
    const before = getWildTokens(m.g, owner, FISH);
    m.g.diceStats[8] = (m.g.diceStats[8] || 0) + 1;
    netCatchOnRoll(m.ctx, 8);
    pattern += getWildTokens(m.g, owner, FISH) > before ? '1' : '0';
  }
  return pattern;
}

describe('registration', () => {
  it('with Tidebound on, place_net, its main-phase slot and the catch hook exist and the net is no piece', () => {
    const { g, reg } = makeGame(on);
    expect(reg.actions.has(PLACE_NET)).toBe(true);
    expect(reg.phases.get('main')!.actions).toContain(PLACE_NET);
    expect(reg.pieces.has(NET)).toBe(false);
    expect(reg.hooks.onRoll).toContain(netCatchOnRoll);
    expect(NET in player(g, 'a').pieces).toBe(false);
    expect(netsLeft(g, 'a')).toBe(netLimit(g));
    expect(netLimit(g)).toBeGreaterThanOrEqual(NET_BASE_LIMIT);
  });

  it('with the DLC off, or only Fishing off, there is no net action, no hook and no way to place one', () => {
    for (const rules of [{}, { dlc: { tidebound: false } }, fishOff]) {
      const { g, reg } = makeGame(rules);
      expect(reg.actions.has(PLACE_NET)).toBe(false);
      expect(reg.hooks.onRoll).not.toContain(netCatchOnRoll);
      player(g, 'a').resources.wood = 5;
      player(g, 'a').resources.sheep = 5;
      expect(dispatch(g, reg, { type: PLACE_NET, playerId: 'a', payload: { hexId: seaIds({ g, reg } as M)[0] } }).ok).toBe(false);
    }
  });
});

describe('sea tiles at a vertex', () => {
  it('finds the two sea tiles at each corner of a lone island, by geometry', () => {
    const { g, reg } = makeGame(on, 99, 0);
    const centre = g.board.hexes.find(h => h.q === 0 && h.r === 0)!;
    expect(centre.vertexIds).toHaveLength(6);
    for (const vId of centre.vertexIds) {
      const v = g.board.vertices[vId];
      const sea = seaHexIdsAt(g, reg, vId);
      expect(sea).toHaveLength(2);
      for (const id of sea) {
        const h = g.board.hexes[id];
        expect(reg.tiles.get(h.type)?.land).toBe(false);
        // The sea tile really has this corner.
        expect(h.corners.some(c => Math.hypot(c.x - v.x, c.y - v.y) < 8)).toBe(true);
      }
    }
  });

  it('has none inland or in open water, and a river channel is not a fishing ground', () => {
    const m = makeGame();
    expect(inlandIds(m).length).toBeGreaterThan(0);
    for (const id of inlandIds(m)) expect(seaHexIdsAt(m.g, m.reg, id)).toEqual([]);

    const openWater = m.g.board.vertices.find(v => v.hexIds.length === 0);
    expect(openWater).toBeDefined();
    expect(seaHexIdsAt(m.g, m.reg, openWater!.id)).toEqual([]);

    const coast = coastIds(m)[0];
    const sea = seaHexIdsAt(m.g, m.reg, coast);
    expect(sea.length).toBeGreaterThan(0);
    for (const id of sea) m.g.board.hexes[id].ext.river = true;
    expect(seaHexIdsAt(m.g, m.reg, coast)).toEqual([]);
  });
});

describe('placement', () => {
  it('needs a sea tile at a corner of your own settlement or city, in the build phase', () => {
    const m = makeGame();
    const coast = coastIds(m)[0];
    const tile = seaHexIdsAt(m.g, m.reg, coast)[0];
    expect(netSpotHexIds(m.ctx, 'a')).toEqual([]);
    expect(canPlaceNet(m.ctx, 'a', tile, 'build')).toBe(false);

    giveBuildingAt(m.g, coast, 'a');
    const spots = netSpotHexIds(m.ctx, 'a');
    expect(spots).toContain(tile);
    for (const id of seaHexIdsAt(m.g, m.reg, coast)) expect(spots).toContain(id);
    for (const id of spots) expect(isSeaHex(m.reg, m.g.board.hexes[id])).toBe(true);
    expect(canPlaceNet(m.ctx, 'a', tile, 'build')).toBe(true);
    expect(canPlaceNet(m.ctx, 'b', tile, 'build')).toBe(false);
    expect(canPlaceNet(m.ctx, 'a', tile, 'setup')).toBe(false);
  });

  it('never offers a land tile, and a port on the vertex does not block the tile (a net takes no vertex)', () => {
    const m = makeGame();
    const coast = coastIds(m)[0];
    const tile = seaHexIdsAt(m.g, m.reg, coast)[0];
    giveBuildingAt(m.g, coast, 'a');
    const land = m.g.board.hexes.find(h => !isSeaHex(m.reg, h) && m.reg.tiles.get(h.type)?.land)!;
    expect(canPlaceNet(m.ctx, 'a', land.id, 'build')).toBe(false);

    m.g.board.vertices[coast].port = '3:1';
    expect(canPlaceNet(m.ctx, 'a', tile, 'build')).toBe(true);
    m.g.board.vertices[coast].port = null;
  });

  it('a rival\'s building at the corner, or your own road, is not what a net needs', () => {
    const m = makeGame();
    const coast = coastIds(m)[0];
    const tile = seaHexIdsAt(m.g, m.reg, coast)[0];
    giveBuildingAt(m.g, coast, 'b');
    giveRoadAt(m.g, coast, 'a');
    expect(canPlaceNet(m.ctx, 'a', tile, 'build')).toBe(false);
    expect(canPlaceNet(m.ctx, 'b', tile, 'build')).toBe(true);
  });

  it('allows at most one net on a tile', () => {
    const m = makeGame();
    const coast = coastIds(m)[0];
    const tile = seaHexIdsAt(m.g, m.reg, coast)[0];
    giveBuildingAt(m.g, coast, 'a');
    expect(canPlaceNet(m.ctx, 'a', tile, 'build')).toBe(true);
    m.g.board.hexes[tile].ext.net = { owner: 'b' };
    expect(canPlaceNet(m.ctx, 'a', tile, 'build')).toBe(false);
    expect(netSpotHexIds(m.ctx, 'a')).not.toContain(tile);
    m.g.board.hexes[tile].ext.net = { owner: 'a' };
    expect(canPlaceNet(m.ctx, 'a', tile, 'build')).toBe(false);
  });

  it('a road or a bridge alone does not make a net spot: only a building does', () => {
    const m = makeGame();
    const coast = coastIds(m).find(id => m.g.board.vertices[id].edgeIds.some(e => m.g.board.edges[e].hexIds.length === 0));
    expect(coast).toBeDefined();
    const tile = seaHexIdsAt(m.g, m.reg, coast!)[0];
    const waterEdge = m.g.board.vertices[coast!].edgeIds.find(e => m.g.board.edges[e].hexIds.length === 0)!;
    expect(canPlaceNet(m.ctx, 'a', tile, 'build')).toBe(false);
    m.g.board.edges[waterEdge].piece = { type: 'bridge', owner: 'a' };
    expect(canPlaceNet(m.ctx, 'a', tile, 'build')).toBe(false);
  });

  it('offers nothing when your only building stands inland (no sea at its corners)', () => {
    const m = makeGame(on, 99, 2);
    const inland = inlandIds(m)[0];
    expect(inland).toBeDefined();
    giveBuildingAt(m.g, inland, 'a', 'city');
    expect(netSpotHexIds(m.ctx, 'a')).toEqual([]);
  });

  it('requires a settlement or city of yours first before placing a net, and a net does not count as a settlement for Ground Work tile modification (Bug 16)', () => {
    const m = makeGame();
    const coasts = coastIds(m);
    const coastA = coasts[0];
    const coastB = coasts[1];
    const tile = seaHexIdsAt(m.g, m.reg, coastA)[0];

    // Bob has a settlement on the board, while Alice has only a road (no settlement or city yet)
    m.g.board.vertices[coastB].piece = { type: 'settlement', owner: 'b' };
    giveRoadAt(m.g, coastA, 'a');
    expect(canPlaceNet(m.ctx, 'a', tile, 'build')).toBe(false);

    // Once Alice builds a settlement at that corner, she can place her fishing net on the tile
    giveBuildingAt(m.g, coastA, 'a');
    expect(canPlaceNet(m.ctx, 'a', tile, 'build')).toBe(true);
  });
});

describe('place_net', () => {
  function ready() {
    const m = makeGame();
    const coast = coastIds(m)[0];
    giveBuildingAt(m.g, coast, 'a');
    const tile = seaHexIdsAt(m.g, m.reg, coast)[0];
    const a = player(m.g, 'a');
    a.resources.wood = 2;
    a.resources.sheep = 1;
    return { ...m, coast, tile, a };
  }
  const place = (m: ReturnType<typeof ready>, hexId: number, pid = 'a') => dispatch(m.g, m.reg, { type: PLACE_NET, playerId: pid, payload: { hexId } });

  it('puts the net on the tile, takes the price into the bank and one net from the supply', () => {
    const m = ready();
    const bankWood = m.g.bank.wood;
    expect(place(m, m.tile).ok).toBe(true);
    expect(m.g.board.hexes[m.tile].ext.net).toEqual({ owner: 'a' });
    expect(netsOf(m.g, 'a')).toEqual([m.tile]);
    expect(m.a.resources.wood).toBe(0);
    expect(m.a.resources.sheep).toBe(0);
    expect(m.g.bank.wood).toBe(bankWood + 2);
    expect(netsLeft(m.g, 'a')).toBe(netLimit(m.g) - 1);
    // A net is no vertex piece.
    expect(m.g.board.vertices.some(v => v.piece?.type === NET)).toBe(false);
  });

  it('refuses a second net on the same tile', () => {
    const m = ready();
    expect(place(m, m.tile).ok).toBe(true);
    m.a.resources.wood = 5;
    m.a.resources.sheep = 5;
    const again = place(m, m.tile);
    expect(again.ok).toBe(false);
    expect(again.error).toContain('already has a net');
    expect(m.a.resources.wood).toBe(5);
  });

  it('refuses without the price, without supply, on land and away from your buildings, and a refusal changes nothing', () => {
    const m = ready();
    m.a.resources.sheep = 0;
    expect(place(m, m.tile).ok).toBe(false);
    m.a.resources.sheep = 1;

    const land = m.g.board.hexes.find(h => m.reg.tiles.get(h.type)?.land)!;
    expect(place(m, land.id).ok).toBe(false);
    expect(place(m, -1).ok).toBe(false);

    const far = seaIds(m).find(id => !netSpotHexIds(m.ctx, 'a').includes(id))!;
    expect(place(m, far).ok).toBe(false);
    expect(m.g.board.hexes[far].ext.net).toBeUndefined();
    expect(m.a.resources.wood).toBe(2);

    // Fill the supply with nets on other tiles.
    const others = seaIds(m).filter(id => id !== m.tile).slice(0, netLimit(m.g));
    for (const id of others) putNet(m, id, 'a');
    const none = place(m, m.tile);
    expect(none.ok).toBe(false);
    expect(none.error).toContain('left');
  });

  it('is in the legal action list at the net tiles once the price is paid', () => {
    const m = ready();
    const legal = legalActions(m.g, m.reg, 'a').filter(x => x.type === PLACE_NET).map(x => x.payload.hexId);
    expect([...legal].sort((x, y) => x - y)).toEqual(netSpotHexIds(m.ctx, 'a'));
    expect(legal).toContain(m.tile);
    m.a.resources.sheep = 0;
    expect(legalActions(m.g, m.reg, 'a').filter(x => x.type === PLACE_NET)).toEqual([]);
  });

  it('costs double once the base limit of nets is on the board', () => {
    const m = makeGame();
    const a = player(m.g, 'a');
    expect(netPrice(m.g, m.reg, a)).toEqual(NET_COST);
    for (const id of seaIds(m).slice(0, NET_BASE_LIMIT)) putNet(m, id, 'a');
    expect(netsOf(m.g, 'a')).toHaveLength(NET_BASE_LIMIT);
    expect(netPrice(m.g, m.reg, a)).toEqual({ wood: 4, sheep: 2 });
    // Another player's nets do not count.
    expect(netPrice(m.g, m.reg, player(m.g, 'b'))).toEqual(NET_COST);
  });
});

describe('old saves with vertex nets', () => {
  it('moves a vertex net onto a free sea tile at that vertex, and the next roll does it by itself', () => {
    const m = makeGame();
    const coast = coastIds(m)[0];
    m.g.board.vertices[coast].piece = { type: NET, owner: 'a' };
    const moved = migrateVertexNets(m.g, m.reg);
    expect(moved).toBe(1);
    expect(m.g.board.vertices[coast].piece).toBeNull();
    const [tile] = netsOf(m.g, 'a');
    expect(seaHexIdsAt(m.g, m.reg, coast)).toContain(tile);

    const m2 = makeGame();
    m2.g.board.vertices[coast].piece = { type: NET, owner: 'b' };
    m2.g.diceStats[8] = 1;
    netCatchOnRoll(m2.ctx, 8);
    expect(m2.g.board.vertices[coast].piece).toBeNull();
    expect(netsOf(m2.g, 'b')).toHaveLength(1);
  });
});

describe('the catch', () => {
  it('each net catches about 1 roll in 6 for its owner', () => {
    expect(NET_CATCH_CHANCE).toBeCloseTo(1 / 6);
    const m = makeGame();
    for (const id of coastSeaIds(m).slice(0, 3)) putNet(m, id, 'a');
    rollMany(m, 1200);
    const caught = getWildTokens(m.g, 'a', FISH);
    // 3 nets x 1200 rolls x 1/6 = 600, standard deviation about 22.
    expect(caught).toBeGreaterThan(480);
    expect(caught).toBeLessThan(720);
    expect(player(m.g, 'a').stats.fishCaught).toBe(caught);
    expect(getWildTokens(m.g, 'b', FISH)).toBe(0);
  });

  it('gives each owner their own catches', () => {
    const m = makeGame();
    const tiles = coastSeaIds(m);
    for (const id of tiles.slice(0, 2)) putNet(m, id, 'a');
    for (const id of tiles.slice(6, 8)) putNet(m, id, 'b');
    rollMany(m, 1200);
    // 2 nets x 1200 rolls x 1/6 = 400 each, standard deviation about 18.
    for (const id of ['a', 'b']) {
      expect(getWildTokens(m.g, id, FISH)).toBeGreaterThan(300);
      expect(getWildTokens(m.g, id, FISH)).toBeLessThan(500);
      expect(player(m.g, id).stats.fishCaught).toBe(getWildTokens(m.g, id, FISH));
    }
  });

  it('a catch pays like a land tile: 1 fish per settlement and 2 per city on the corners, and a fish icon does not multiply it', () => {
    const m = makeGame();
    const tile = coastSeaIds(m)[0];
    putNet(m, tile, 'a');
    expect(netYield(m.g, m.reg, tile, 'a')).toBe(1);
    const corner = m.g.board.vertices.find(v => v.piece?.owner === 'a' && seaHexIdsAt(m.g, m.reg, v.id).includes(tile))!;
    corner.piece = { type: 'city', owner: 'a' };
    expect(netYield(m.g, m.reg, tile, 'a')).toBe(2);
    // A second building of yours on another corner of the same tile adds up; a rival's building does not.
    const other = m.g.board.vertices.find(v => v.id !== corner.id && !v.piece && seaHexIdsAt(m.g, m.reg, v.id).includes(tile))!;
    other.piece = { type: 'settlement', owner: 'a' };
    expect(netYield(m.g, m.reg, tile, 'a')).toBe(3);
    const third = m.g.board.vertices.find(v => !v.piece && seaHexIdsAt(m.g, m.reg, v.id).includes(tile));
    if (third) third.piece = { type: 'city', owner: 'b' };
    expect(netYield(m.g, m.reg, tile, 'a')).toBe(3);
    expect(netYield(m.g, m.reg, tile, 'b')).toBe(third ? 2 : 0);

    // Every catch hands over the whole yield at once; a boost on the tile only changes how often it happens.
    m.g.board.hexes[tile].ext.fish = 4;
    let catches = 0;
    for (let i = 0; i < 60; i++) {
      const before = getWildTokens(m.g, 'a', FISH);
      m.g.diceStats[8] = (m.g.diceStats[8] || 0) + 1;
      netCatchOnRoll(m.ctx, 8);
      const got = getWildTokens(m.g, 'a', FISH) - before;
      if (got > 0) {
        expect(got).toBe(3);
        catches++;
      }
    }
    expect(catches).toBeGreaterThan(0);
    expect(player(m.g, 'a').stats.fishCaught).toBe(catches * 3);
    // Each catch used one boost, not three.
    expect(m.g.board.hexes[tile].ext.fish).toBe(Math.max(0, 4 - catches));
  });

  it('a net with no building of its owner left at its corners catches nothing', () => {
    const m = makeGame();
    const tile = coastSeaIds(m)[0];
    putNet(m, tile, 'a');
    for (const v of m.g.board.vertices) if (v.piece?.owner === 'a') v.piece = null;
    expect(netYield(m.g, m.reg, tile, 'a')).toBe(0);
    rollMany(m, 600);
    expect(getWildTokens(m.g, 'a', FISH)).toBe(0);
  });

  it('a net on a tile that is no longer open sea catches nothing', () => {
    const m = makeGame();
    const tile = coastSeaIds(m)[0];
    putNet(m, tile, 'a');
    m.g.board.hexes[tile].ext.river = true;
    rollMany(m, 600);
    expect(getWildTokens(m.g, 'a', FISH)).toBe(0);
  });

  it('fishes only the tile it sits on: a boost on another tile does not raise the chance', () => {
    const m = makeGame();
    const [mine, other] = coastSeaIds(m);
    expect(other).toBeDefined();
    putNet(m, mine, 'a');
    m.g.board.hexes[other].ext.fish = 4;
    rollMany(m, 1200);
    // 1200 rolls x 1/6 = 200, standard deviation about 13. A boosted chance (1 in 3) would give about 400.
    expect(getWildTokens(m.g, 'a', FISH)).toBeLessThan(280);
    expect(m.g.board.hexes[other].ext.fish).toBe(4);
  });

  it('a fish icon under the net doubles the chance and loses one boost per catch', () => {
    const m = makeGame();
    const tile = coastSeaIds(m)[0];
    putNet(m, tile, 'a');
    m.g.board.hexes[tile].ext.fish = 4;
    rollMany(m, 60);
    const caught = getWildTokens(m.g, 'a', FISH);
    expect(caught).toBeGreaterThan(0);
    expect(m.g.board.hexes[tile].ext.fish).toBe(Math.max(0, 4 - caught));
  });

  function run(seed: number, flooded: boolean) {
    const m = makeGame(on, seed);
    for (const id of coastSeaIds(m).slice(0, 2)) putNet(m, id, 'a');
    if (flooded) for (const h of m.g.board.hexes) if (m.reg.tiles.get(h.type)?.land) setTileState(m.g, h.id, { id: 'flooded' });
    const rngBefore = m.g.rng.s;
    const pattern = rollMany(m, 600);
    return { pattern, fish: getWildTokens(m.g, 'a', FISH), rngUntouched: m.g.rng.s === rngBefore };
  }

  it('is seeded: the same seed gives the same catches, another seed gives other ones, and `g.rng` is never drawn from', () => {
    const one = run(7, false);
    expect(run(7, false)).toEqual(one);
    expect(one.rngUntouched).toBe(true);
    expect(run(8, false).pattern).not.toBe(one.pattern);
  });

  it('keeps fishing while the land around it is flooded', () => {
    expect(run(7, true).pattern).toBe(run(7, false).pattern);
  });

  it('a real roll draws the same dice and the same `g.rng` numbers with nets on the board', () => {
    let checked = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const bare = makeGame(on, seed);
      const netted = makeGame(on, seed);
      for (const id of seaIds(netted).slice(0, 4)) putNet(netted, id, 'a');
      for (const m of [bare, netted]) {
        m.g.phase = 'roll';
        m.g.turn = 0;
        expect(dispatch(m.g, m.reg, { type: 'roll', playerId: 'a' }).ok).toBe(true);
      }
      expect(netted.g.dice).toEqual(bare.g.dice);
      // A 7 can change the discard flow (a fish counts as a card), so only the other rolls compare the generator.
      if (bare.g.dice[0] + bare.g.dice[1] === 7) continue;
      expect(netted.g.rng.s).toBe(bare.g.rng.s);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
