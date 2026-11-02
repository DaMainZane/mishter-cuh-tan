import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bridgeEdgeMarkup, uiIcon } from '../src/client/icons';
import { allPacks } from '../src/packs';
import { ROAD, SETTLEMENT } from '../src/packs/base/constants';
import { isRoadPiece } from '../src/packs/base/placement';
import {
  BRIDGE,
  BRIDGE_BASE_LIMIT,
  BRIDGE_COST,
  RICKETY,
  RICKETY_COST,
  RICKETY_HEALTH,
  RICKETY_SEVEN_STEP_ID,
  RICKETY_UPGRADE_COST,
  UPGRADE_BRIDGE,
  bridgePiece,
  bridgeUpgradeView,
  bridgesOnBoard,
  ricketyCollapseStep,
  ricketyPiece,
  syncBridgePool
} from '../src/packs/tidebound';
import { chooseBotAction } from '../src/server/bots/brain';
import {
  COST_MODS,
  DURABILITY_DEFS,
  SEVEN_STEPS,
  buildTopology,
  checkAction,
  createGame,
  damagePiece,
  defsOf,
  dispatch,
  getPieceDurability,
  getPublicHistory,
  legalActions,
  makeCtx,
  priceOf,
  registryFor,
  resolveSeven,
  updateAwards
} from '../src/shared';

// T4a (rickety bridge piece, 1 wood, health 1, shared pool, pooled 2x cost, bot build),
// T4b (upgrade to a full bridge, bot upgrade), T4c (view data),
// T4d (collapse on a 7 in Seven Resolver), and T4e (Longest Road recalculation through the change log).

const on = { dlc: { tidebound: true } };
const RICH = { wood: 5, brick: 5, sheep: 5, wheat: 5, ore: 5 };

/** Same 7-hex sea world as tidebound.test.ts: two land hexes (wood, brick) with open water between them. */
function makeSeaGame(extraRules: Record<string, any> = {}) {
  const rules = { ...on, ...extraRules };
  const reg = registryFor(allPacks, rules);
  const board = buildTopology(
    [
      { q: 0, r: 0, type: 'water', number: null },
      { q: 1, r: 0, type: 'wood', number: 6 },
      { q: 1, r: -1, type: 'water', number: null },
      { q: 0, r: -1, type: 'water', number: null },
      { q: -1, r: 0, type: 'brick', number: 8 },
      { q: -1, r: 1, type: 'water', number: null },
      { q: 0, r: 1, type: 'water', number: null }
    ],
    {
      isLand: t => !!reg.tiles.get(t)?.land,
      portBlocked: t => !!reg.tiles.get(t)?.noPort,
      waterEdges: true
    }
  );
  const g = createGame(reg, {
    players: [
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' }
    ],
    rules,
    board,
    seed: 99,
    shuffleSeats: false
  });
  g.phase = 'main';
  g.turn = 0;
  return { g, reg, ctx: makeCtx(g, reg) };
}

/** Alice (player 'a') has a coastal settlement next to an ocean edge, and `nextOcean` continues from the far end of it. */
function scene(extraRules: Record<string, any> = {}) {
  const { g, reg, ctx } = makeSeaGame(extraRules);
  const oceanEdge = g.board.edges.find(
    e => e.hexIds.length === 0 && (g.board.vertices[e.v1].hexIds.length > 0 || g.board.vertices[e.v2].hexIds.length > 0)
  )!;
  const coastVId = g.board.vertices[oceanEdge.v1].hexIds.length > 0 ? oceanEdge.v1 : oceanEdge.v2;
  const seaVId = oceanEdge.v1 === coastVId ? oceanEdge.v2 : oceanEdge.v1;
  g.board.vertices[coastVId].piece = { type: SETTLEMENT, owner: 'a' };
  const nextOcean = g.board.vertices[seaVId].edgeIds
    .map(id => g.board.edges[id])
    .find(e => e.id !== oceanEdge.id && e.hexIds.length === 0)!;
  g.players[0].resources = { ...RICH };
  return { g, reg, ctx, oceanEdge, nextOcean, coastVId, seaVId };
}

const build = (g: any, reg: any, piece: string, loc: number, pid = 'a') =>
  dispatch(g, reg, { type: 'build', playerId: pid, payload: { piece, loc } });

describe('T4a/T4b registration', () => {
  it('with Tidebound on: piece, health 1, shared cost modifier, upgrade action in the main phase, equal supply limits', () => {
    const reg = registryFor(allPacks, on);
    expect(reg.pieces.get(RICKETY)).toBe(ricketyPiece);
    expect(reg.rules.pieceLimits[RICKETY]).toBe(BRIDGE_BASE_LIMIT);
    expect(reg.rules.pieceLimits[RICKETY]).toBe(reg.rules.pieceLimits[BRIDGE]);
    expect(defsOf<any>(reg, DURABILITY_DEFS).get('tidebound.rickety')).toMatchObject({ pieceId: RICKETY, maxDurability: RICKETY_HEALTH });
    expect(RICKETY_HEALTH).toBe(1);
    expect(defsOf(reg, COST_MODS).has('tidebound.rickety_pool')).toBe(true);
    expect(defsOf(reg, SEVEN_STEPS).get(RICKETY_SEVEN_STEP_ID)).toBe(ricketyCollapseStep);
    expect(reg.actions.has(UPGRADE_BRIDGE)).toBe(true);
    expect(reg.phases.get('main')!.actions).toContain(UPGRADE_BRIDGE);
    expect(reg.phases.get('roll')!.actions).not.toContain(UPGRADE_BRIDGE);
  });

  it('with Tidebound off nothing of it is registered', () => {
    const reg = registryFor(allPacks, {});
    expect(reg.pieces.has(RICKETY)).toBe(false);
    expect(reg.actions.has(UPGRADE_BRIDGE)).toBe(false);
    expect(reg.phases.get('main')!.actions).not.toContain(UPGRADE_BRIDGE);
    expect(defsOf(reg, COST_MODS).has('tidebound.rickety_pool')).toBe(false);
    expect(defsOf(reg, SEVEN_STEPS).has(RICKETY_SEVEN_STEP_ID)).toBe(false);
  });

  it('with rickety bridges switched off, bridges behave as in T3 (one supply, nothing mirrored)', () => {
    const { g, reg, oceanEdge } = scene({ addons: { 'tidebound.rickety_bridges': false } });
    expect(reg.pieces.has(RICKETY)).toBe(false);
    expect(reg.phases.get('main')!.actions).not.toContain(UPGRADE_BRIDGE);
    expect(build(g, reg, BRIDGE, oceanEdge.id).ok).toBe(true);
    expect(g.players[0].pieces[BRIDGE]).toBe(BRIDGE_BASE_LIMIT - 1);
    expect(g.players[0].pieces[RICKETY]).toBeUndefined();
  });
});

describe('T4a rickety bridge', () => {
  it('costs 1 wood, uses the bridge placement rule, and has health 1', () => {
    const { g, reg, ctx, oceanEdge, nextOcean } = scene();
    const p = g.players[0];
    expect(RICKETY_COST).toEqual({ wood: 1 });
    expect(priceOf(g, reg, p, ricketyPiece)).toEqual({ wood: 1 });

    const before = { ...p.resources };
    const res = build(g, reg, RICKETY, oceanEdge.id);
    expect(res.ok).toBe(true);
    expect(g.board.edges[oceanEdge.id].piece).toEqual({ type: RICKETY, owner: 'a' });
    expect(p.resources.wood).toBe(before.wood - 1);
    expect(p.resources.brick).toBe(before.brick);
    expect(p.resources.ore).toBe(before.ore);
    expect(getPieceDurability(g, reg, 'edge', oceanEdge.id)).toBe(1);

    // Ocean edges only, like a bridge.
    const landEdge = g.board.edges.find(e => e.hexIds.length > 0)!;
    expect(checkAction(g, reg, { type: 'build', playerId: 'a', payload: { piece: RICKETY, loc: landEdge.id } })).toMatch(/Cannot place/);
    // And it connects: the next ocean edge is legal from the end of a rickety bridge.
    expect(checkAction(g, reg, { type: 'build', playerId: 'a', payload: { piece: RICKETY, loc: nextOcean.id } })).toBeNull();

    // It is road-like: Longest Road and connectivity treat it as a road.
    expect(isRoadPiece(ctx, RICKETY)).toBe(true);
  });

  it('shares one pool with bridges: building either lowers both supplies, other players are untouched', () => {
    const { g, reg, oceanEdge, nextOcean } = scene();
    expect(g.players[0].pieces[BRIDGE]).toBe(10);
    expect(g.players[0].pieces[RICKETY]).toBe(10);

    expect(build(g, reg, RICKETY, oceanEdge.id).ok).toBe(true);
    expect(g.players[0].pieces[BRIDGE]).toBe(9);
    expect(g.players[0].pieces[RICKETY]).toBe(9);

    expect(build(g, reg, BRIDGE, nextOcean.id).ok).toBe(true);
    expect(g.players[0].pieces[BRIDGE]).toBe(8);
    expect(g.players[0].pieces[RICKETY]).toBe(8);
    expect(bridgesOnBoard(g, 'a')).toBe(2);

    expect(g.players[1].pieces[BRIDGE]).toBe(10);
    expect(g.players[1].pieces[RICKETY]).toBe(10);
  });

  it('when the pool is used up neither kind can be built', () => {
    const { g, reg, oceanEdge, nextOcean } = scene();
    const fillers = g.board.edges.filter(e => e.id !== oceanEdge.id && e.id !== nextOcean.id).slice(0, 9);
    expect(fillers.length).toBe(9);
    fillers.forEach((e, i) => { e.piece = { type: i % 2 ? BRIDGE : RICKETY, owner: 'a' }; });
    syncBridgePool(g, 'a');
    expect(g.players[0].pieces[BRIDGE]).toBe(1);
    expect(g.players[0].pieces[RICKETY]).toBe(1);

    expect(build(g, reg, BRIDGE, oceanEdge.id).ok).toBe(true); // the last one in the pool
    expect(g.players[0].pieces[BRIDGE]).toBe(0);
    expect(g.players[0].pieces[RICKETY]).toBe(0);
    expect(checkAction(g, reg, { type: 'build', playerId: 'a', payload: { piece: RICKETY, loc: nextOcean.id } })).toMatch(/No Rickety bridge pieces left/);
    expect(checkAction(g, reg, { type: 'build', playerId: 'a', payload: { piece: BRIDGE, loc: nextOcean.id } })).toMatch(/No Bridge pieces left/);
  });

  it('the pool scales with radius like bridges do (both supplies start at the scaled cap)', () => {
    const { g } = makeSeaGame({ boardRadius: 4, vpToWin: 10 });
    expect(g.rules.pieceLimits[BRIDGE]).toBe(18);
    expect(g.rules.pieceLimits[RICKETY]).toBe(18);
    expect(g.players[0].pieces[RICKETY]).toBe(18);
    expect(g.players[0].pieces[BRIDGE]).toBe(18);
  });

  it('2x cost starts when bridges and rickety bridges TOGETHER reach the base limit', () => {
    const { g, reg } = scene();
    const p = g.players[0];
    const edges = g.board.edges;
    for (let i = 0; i < 5; i++) edges[i].piece = { type: BRIDGE, owner: 'a' };
    for (let i = 5; i < 10; i++) edges[i].piece = { type: RICKETY, owner: 'a' };
    // 5 + 5 = 10 in the pool, though neither kind is at 10 on its own.
    expect(priceOf(g, reg, p, bridgePiece)).toEqual({ wood: 2, brick: 2, ore: 2 });
    expect(priceOf(g, reg, p, ricketyPiece)).toEqual({ wood: 2 });

    edges[9].piece = null; // 9 in the pool
    expect(priceOf(g, reg, p, bridgePiece)).toEqual({ wood: 1, brick: 1, ore: 1 });
    expect(priceOf(g, reg, p, ricketyPiece)).toEqual({ wood: 1 });
  });

  it('2x cost is not doubled twice when one kind alone is already at the limit', () => {
    const { g, reg } = scene();
    for (let i = 0; i < 10; i++) g.board.edges[i].piece = { type: RICKETY, owner: 'a' };
    expect(priceOf(g, reg, g.players[0], ricketyPiece)).toEqual({ wood: 2 });
    expect(priceOf(g, reg, g.players[0], bridgePiece)).toEqual({ wood: 2, brick: 2, ore: 2 });
  });

  it('health 1: one point of damage breaks it and returns it to the pool once the pool is synced', () => {
    const { g, reg, ctx, oceanEdge } = scene();
    expect(build(g, reg, RICKETY, oceanEdge.id).ok).toBe(true);
    const out = damagePiece(ctx, 'edge', oceanEdge.id, 1);
    expect(out.broken).toBe(true);
    expect(g.board.edges[oceanEdge.id].piece).toBeNull();
    // damagePiece hands the piece back to the rickety counter only, so T4d must sync the pool after a collapse.
    expect(g.players[0].pieces[RICKETY]).toBe(10);
    expect(g.players[0].pieces[BRIDGE]).toBe(9);
    syncBridgePool(g, 'a');
    expect(g.players[0].pieces[RICKETY]).toBe(10);
    expect(g.players[0].pieces[BRIDGE]).toBe(10);
  });

  it('a bot that cannot pay for a full bridge builds a rickety one on the same spot', () => {
    const { g, reg, coastVId } = scene();
    const bot = g.players[0];
    bot.isBot = true;
    bot.difficulty = 'main';
    bot.resources = { wood: 1, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    // Block the land edges from the settlement so the sea is the way out (as in the T3e test).
    for (const eid of g.board.vertices[coastVId].edgeIds) {
      const e = g.board.edges[eid];
      if (e.hexIds.length > 0) e.piece = { type: 'road', owner: 'b' };
    }
    const act = chooseBotAction(g, reg, 'a');
    expect(act).not.toBeNull();
    expect(act?.type).toBe('build');
    expect(act?.payload?.piece).toBe(RICKETY);
    expect(dispatch(g, reg, { type: act!.type, playerId: 'a', payload: act!.payload }).ok).toBe(true);
  });
});

describe('T4b upgrade to a full bridge', () => {
  function withRickety() {
    const s = scene();
    expect(build(s.g, s.reg, RICKETY, s.oceanEdge.id).ok).toBe(true);
    return s;
  }

  it('turns your rickety bridge into a bridge in place for 1 brick + 1 ore', () => {
    const { g, reg, oceanEdge } = withRickety();
    const p = g.players[0];
    p.resources = { wood: 0, brick: 1, sheep: 0, wheat: 0, ore: 1 };
    const res = dispatch(g, reg, { type: UPGRADE_BRIDGE, playerId: 'a', payload: { edgeId: oceanEdge.id } });
    expect(res.ok).toBe(true);
    expect(g.board.edges[oceanEdge.id].piece).toEqual({ type: BRIDGE, owner: 'a' });
    expect(p.resources.brick).toBe(0);
    expect(p.resources.ore).toBe(0);
    // Same piece count on the board, so the supplies do not move.
    expect(p.pieces[BRIDGE]).toBe(9);
    expect(p.pieces[RICKETY]).toBe(9);
    expect(bridgesOnBoard(g, 'a')).toBe(1);
    expect(p.stats.bridgesUpgraded).toBe(1);
    expect(res.events?.some(ev => ev.type === 'bridgeUpgraded')).toBe(true);
  });

  it('rickety wood + upgrade brick and ore adds up to the full bridge price', () => {
    expect({ ...RICKETY_COST, ...RICKETY_UPGRADE_COST }).toEqual(BRIDGE_COST);
  });

  it('is refused for a bridge, for someone else\'s rickety bridge, with no resources, with a bad payload, and outside your main phase', () => {
    const { g, reg, oceanEdge } = withRickety();
    const p = g.players[0];
    const act = (payload: any) => checkAction(g, reg, { type: UPGRADE_BRIDGE, playerId: 'a', payload });

    p.resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    expect(act({ edgeId: oceanEdge.id })).toMatch(/Not enough resources/);
    p.resources = { ...RICH };
    expect(act({ edgeId: oceanEdge.id })).toBeNull();

    expect(act({})).toMatch(/Choose a rickety bridge/);
    expect(act({ edgeId: 99999 })).toMatch(/Choose a rickety bridge/);
    const landEdge = g.board.edges.find(e => e.hexIds.length > 0)!;
    expect(act({ edgeId: landEdge.id })).toMatch(/Only your own rickety bridge/);

    g.board.edges[oceanEdge.id].piece = { type: BRIDGE, owner: 'a' };
    expect(act({ edgeId: oceanEdge.id })).toMatch(/Only your own rickety bridge/);
    g.board.edges[oceanEdge.id].piece = { type: RICKETY, owner: 'b' };
    expect(act({ edgeId: oceanEdge.id })).toMatch(/Only your own rickety bridge/);

    g.board.edges[oceanEdge.id].piece = { type: RICKETY, owner: 'a' };
    g.phase = 'roll';
    expect(act({ edgeId: oceanEdge.id })).toMatch(/not allowed/);
  });

  it('costs double once bridges and rickety bridges together are at the base limit', () => {
    const { g, reg, oceanEdge } = withRickety();
    const p = g.players[0];
    g.board.edges.filter(e => e.id !== oceanEdge.id).slice(0, 9).forEach(e => { e.piece = { type: BRIDGE, owner: 'a' }; });
    expect(bridgesOnBoard(g, 'a')).toBe(10);

    p.resources = { wood: 0, brick: 1, sheep: 0, wheat: 0, ore: 1 };
    expect(checkAction(g, reg, { type: UPGRADE_BRIDGE, playerId: 'a', payload: { edgeId: oceanEdge.id } })).toMatch(/Not enough resources/);
    p.resources = { wood: 0, brick: 2, sheep: 0, wheat: 0, ore: 2 };
    expect(dispatch(g, reg, { type: UPGRADE_BRIDGE, playerId: 'a', payload: { edgeId: oceanEdge.id } }).ok).toBe(true);
    expect(p.resources.brick).toBe(0);
    expect(p.resources.ore).toBe(0);
  });

  it('legal actions list your rickety bridges only when you can pay', () => {
    const { g, reg, oceanEdge } = withRickety();
    const p = g.players[0];
    const upgrades = () => legalActions(g, reg, 'a').filter(a => a.type === UPGRADE_BRIDGE);

    p.resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    expect(upgrades()).toEqual([]);
    p.resources = { wood: 0, brick: 1, sheep: 0, wheat: 0, ore: 1 };
    expect(upgrades()).toEqual([{ type: UPGRADE_BRIDGE, payload: { edgeId: oceanEdge.id } }]);
  });

  it('a bot with spare cards upgrades a rickety bridge', () => {
    const { g, reg, oceanEdge } = scene();
    g.board.edges[oceanEdge.id].piece = { type: RICKETY, owner: 'a' };
    syncBridgePool(g, 'a');
    const bot = g.players[0];
    bot.isBot = true;
    bot.difficulty = 'main';
    bot.resources = { wood: 0, brick: 3, sheep: 0, wheat: 0, ore: 3 };
    const act = chooseBotAction(g, reg, 'a');
    expect(act?.type).toBe(UPGRADE_BRIDGE);
    expect(act?.payload).toEqual({ edgeId: oceanEdge.id });
    expect(dispatch(g, reg, { type: act!.type, playerId: 'a', payload: act!.payload }).ok).toBe(true);
    expect(g.board.edges[oceanEdge.id].piece?.type).toBe(BRIDGE);
  });
});

// T4c is a client popup (type picker, upgrade button). What the server owes it is one number: the player's upgrade price.
describe('T4c view data', () => {
  it('bridgeUpgradeView is this player\'s upgrade price while rickety bridges are in the game', () => {
    const { g, reg } = scene();
    expect(bridgeUpgradeView(g, reg, g.players[0])).toEqual(RICKETY_UPGRADE_COST);
  });

  it('it doubles with the pool, like the action itself', () => {
    const { g, reg } = scene();
    g.board.edges.slice(0, 10).forEach(e => { e.piece = { type: BRIDGE, owner: 'a' }; });
    expect(bridgeUpgradeView(g, reg, g.players[0])).toEqual({ brick: 2, ore: 2 });
    // The other player has nothing on the board, so theirs is the plain price.
    expect(bridgeUpgradeView(g, reg, g.players[1])).toEqual(RICKETY_UPGRADE_COST);
  });

  it('is undefined with the DLC off or with rickety bridges switched off, so those games send nothing new', () => {
    // With the DLC off the registry has no rickety piece, so the view gives nothing (the same game state is enough for that check).
    const { g: g0 } = scene();
    const off = registryFor(allPacks, {});
    expect(bridgeUpgradeView(g0, off, g0.players[0])).toBeUndefined();

    const s = scene({ addons: { 'tidebound.rickety_bridges': false } });
    expect(bridgeUpgradeView(s.g, s.reg, s.g.players[0])).toBeUndefined();
  });

  it('the piece price the client reads for the picker is in priceOf (rickety 1 wood, bridge 1 wood + 1 brick + 1 ore)', () => {
    const { g, reg } = scene();
    expect(priceOf(g, reg, g.players[0], ricketyPiece)).toEqual(RICKETY_COST);
    expect(priceOf(g, reg, g.players[0], bridgePiece)).toEqual(BRIDGE_COST);
  });
});

/** Finds a simple (non-self-intersecting) chain of `len` edges on `board`, optionally avoiding `usedVertices`. */
function findSimpleEdgeChain(board: any, len: number, avoidVertices = new Set<number>()): number[] {
  const visitedV = new Set<number>(avoidVertices);
  const path: number[] = [];

  function dfs(vId: number): boolean {
    if (path.length === len) return true;
    const v = board.vertices[vId];
    for (const eId of v.edgeIds) {
      if (path.includes(eId)) continue;
      const e = board.edges[eId];
      const nextV = e.v1 === vId ? e.v2 : e.v1;
      if (visitedV.has(nextV)) continue;
      visitedV.add(nextV);
      path.push(eId);
      if (dfs(nextV)) return true;
      path.pop();
      visitedV.delete(nextV);
    }
    return false;
  }

  for (const v of board.vertices) {
    if (visitedV.has(v.id)) continue;
    visitedV.add(v.id);
    if (dfs(v.id)) return path;
    visitedV.delete(v.id);
  }
  throw new Error(`Could not find simple edge chain of length ${len}`);
}

function verticesOfEdges(board: any, edgeIds: number[]): Set<number> {
  const s = new Set<number>();
  for (const id of edgeIds) {
    const e = board.edges[id];
    s.add(e.v1);
    s.add(e.v2);
  }
  return s;
}

describe('T4d collapse on a 7 (Seven Resolver)', () => {
  it('collapses all rickety bridges on a 7, leaves full bridges and roads intact, syncs both shared-pool counters, and draws zero RNG values', () => {
    const { g, reg, oceanEdge, nextOcean } = scene();
    // Alice builds a rickety bridge on oceanEdge and a full bridge on nextOcean.
    expect(build(g, reg, RICKETY, oceanEdge.id, 'a').ok).toBe(true);
    expect(build(g, reg, BRIDGE, nextOcean.id, 'a').ok).toBe(true);

    // Bob has a rickety bridge on another ocean edge and a road on a land edge.
    const bobOcean = g.board.edges.find(
      e => e.id !== oceanEdge.id && e.id !== nextOcean.id && e.hexIds.length === 0 && !e.piece
    )!;
    const bobRoadEdge = g.board.edges.find(e => e.hexIds.length > 0 && !e.piece)!;
    g.board.edges[bobOcean.id].piece = { type: RICKETY, owner: 'b' };
    g.board.edges[bobRoadEdge.id].piece = { type: ROAD, owner: 'b' };
    syncBridgePool(g, 'b');

    expect(g.players[0].pieces[BRIDGE]).toBe(BRIDGE_BASE_LIMIT - 2);
    expect(g.players[0].pieces[RICKETY]).toBe(BRIDGE_BASE_LIMIT - 2);
    expect(g.players[1].pieces[BRIDGE]).toBe(BRIDGE_BASE_LIMIT - 1);
    expect(g.players[1].pieces[RICKETY]).toBe(BRIDGE_BASE_LIMIT - 1);

    const rngBefore = g.rng.s;
    const ctx = makeCtx(g, reg);
    const executed = resolveSeven(ctx);

    // Zero RNG drift during Seven Resolver collapse.
    expect(g.rng.s).toBe(rngBefore);
    expect(executed).toContain(RICKETY_SEVEN_STEP_ID);

    // Both rickety bridges collapsed; Alice's full bridge and Bob's road remain on the board.
    expect(g.board.edges[oceanEdge.id].piece).toBeNull();
    expect(g.board.edges[nextOcean.id].piece).toEqual({ type: BRIDGE, owner: 'a' });
    expect(g.board.edges[bobOcean.id].piece).toBeNull();
    expect(g.board.edges[bobRoadEdge.id].piece).toEqual({ type: ROAD, owner: 'b' });

    // Shared pool counters for both players are synced and equal.
    expect(g.players[0].pieces[BRIDGE]).toBe(BRIDGE_BASE_LIMIT - 1);
    expect(g.players[0].pieces[RICKETY]).toBe(BRIDGE_BASE_LIMIT - 1);
    expect(g.players[1].pieces[BRIDGE]).toBe(BRIDGE_BASE_LIMIT);
    expect(g.players[1].pieces[RICKETY]).toBe(BRIDGE_BASE_LIMIT);
    expect(g.players[0].stats.ricketyCollapsed).toBe(1);
    expect(g.players[1].stats.ricketyCollapsed).toBe(1);
  });

  it('canFire is false when no rickety bridges are on the board, so it does not consume a Seven Resolver side-effect slot', () => {
    const { g, reg, oceanEdge } = scene();
    expect(build(g, reg, BRIDGE, oceanEdge.id, 'a').ok).toBe(true);
    const ctx = makeCtx(g, reg);
    expect(ricketyCollapseStep.canFire!(ctx)).toBe(false);
    const executed = resolveSeven(ctx);
    expect(executed).not.toContain(RICKETY_SEVEN_STEP_ID);
  });

  it('triggers through the roll action when a 7 is rolled in the roll phase', () => {
    const { g, reg, oceanEdge } = scene({ fairDice: true });
    expect(build(g, reg, RICKETY, oceanEdge.id, 'a').ok).toBe(true);
    expect(g.board.edges[oceanEdge.id].piece?.type).toBe(RICKETY);

    // Force the next fair-dice draw to be (3, 4) = 7.
    g.phase = 'roll';
    g.ext.base = { fairDiceDeck: [[1, 1], [1, 2], [2, 2], [2, 3], [3, 3], [2, 4], [3, 4]] };
    const res = dispatch(g, reg, { type: 'roll', playerId: 'a' });
    expect(res.ok).toBe(true);
    expect(g.dice).toEqual([3, 4]);
    expect(g.board.edges[oceanEdge.id].piece).toBeNull();
    expect(g.players[0].pieces[BRIDGE]).toBe(BRIDGE_BASE_LIMIT);
    expect(g.players[0].pieces[RICKETY]).toBe(BRIDGE_BASE_LIMIT);
  });
});

describe('T4e Longest Road recalculation through the change log', () => {
  it('splits a chain and drops Longest Road to null when nobody has >= 5 left, recording pieceBroken and awardChanged in the change log', () => {
    const { g, reg } = scene({ fairDice: true });
    // Build a 5-edge chain for Alice where the middle edge (index 2) is a rickety bridge.
    const chain = findSimpleEdgeChain(g.board, 5);
    chain.forEach((eId, idx) => {
      g.board.edges[eId].piece = { type: idx === 2 ? RICKETY : BRIDGE, owner: 'a' };
    });
    syncBridgePool(g, 'a');
    updateAwards(makeCtx(g, reg));
    expect(g.awards.longestRoad).toBe('a');
    expect(g.players[0].stats.longestRoad).toBe(5);

    // Roll a 7 via dispatch so afterAction hooks record public history in S0.10.
    g.phase = 'roll';
    g.ext.base = { fairDiceDeck: [[1, 1], [1, 2], [2, 2], [2, 3], [3, 3], [2, 4], [3, 4]] };
    const res = dispatch(g, reg, { type: 'roll', playerId: 'a' });
    expect(res.ok).toBe(true);

    // Middle rickety bridge collapsed, splitting the 5-chain into two 2-edge segments.
    expect(g.board.edges[chain[2]].piece).toBeNull();
    expect(g.players[0].stats.longestRoad).toBe(2);
    expect(g.awards.longestRoad).toBeNull();

    // Both pieceBroken and awardChanged are recorded in the S0.10 public history change log.
    const history = getPublicHistory(g);
    const brokenEntry = history.find(e => e.type === 'pieceBroken');
    const awardEntry = history.find(e => e.type === 'awardChanged');
    expect(brokenEntry).toBeDefined();
    expect(brokenEntry?.actorId).toBe('a');
    expect(brokenEntry?.data.piece).toBe(RICKETY);
    expect(brokenEntry?.data.loc).toBe(chain[2]);
    expect(awardEntry).toBeDefined();
    expect(awardEntry?.actorId).toBeNull();
    expect(awardEntry?.targetId).toBe('a');
    expect(awardEntry?.data.award).toBe('longestRoad');
    expect(awardEntry?.data.playerId).toBeNull();
    expect(awardEntry?.data.previousHolderId).toBe('a');
  });

  it('transfers Longest Road to another player who now holds the sole longest road >= 5 and records the handoff in the change log', () => {
    const { g, reg } = scene({ fairDice: true });
    // Alice has a 6-edge chain ending in 2 rickety bridges (4 sturdy + 2 rickety = 6).
    const aliceChain = findSimpleEdgeChain(g.board, 6);
    aliceChain.forEach((eId, idx) => {
      g.board.edges[eId].piece = { type: idx >= 4 ? RICKETY : BRIDGE, owner: 'a' };
    });
    // Bob has a disjoint 5-edge chain of sturdy roads/bridges.
    const bobChain = findSimpleEdgeChain(g.board, 5, verticesOfEdges(g.board, aliceChain));
    bobChain.forEach(eId => {
      g.board.edges[eId].piece = { type: BRIDGE, owner: 'b' };
    });
    syncBridgePool(g, 'a');
    syncBridgePool(g, 'b');
    updateAwards(makeCtx(g, reg));
    expect(g.awards.longestRoad).toBe('a');
    expect(g.players[0].stats.longestRoad).toBe(6);
    expect(g.players[1].stats.longestRoad).toBe(5);

    // Roll a 7: Alice's 2 rickety bridges collapse, dropping Alice from 6 to 4 while Bob stays at 5.
    g.phase = 'roll';
    g.ext.base = { fairDiceDeck: [[1, 1], [1, 2], [2, 2], [2, 3], [3, 3], [2, 4], [3, 4]] };
    const res = dispatch(g, reg, { type: 'roll', playerId: 'a' });
    expect(res.ok).toBe(true);

    expect(g.players[0].stats.longestRoad).toBe(4);
    expect(g.players[1].stats.longestRoad).toBe(5);
    expect(g.awards.longestRoad).toBe('b');

    const awardEntries = getPublicHistory(g, { type: 'awardChanged' });
    const latest = awardEntries[awardEntries.length - 1];
    expect(latest).toBeDefined();
    expect(latest.actorId).toBe('b');
    expect(latest.targetId).toBe('a');
    expect(latest.data.playerId).toBe('b');
    expect(latest.data.previousHolderId).toBe('a');
    expect(latest.data.value).toBe(5);
  });

  it('keeps Longest Road with the current holder when they shrink from 6 to 5 and tie another player at 5', () => {
    const { g, reg } = scene();
    const aliceChain = findSimpleEdgeChain(g.board, 6);
    aliceChain.forEach((eId, idx) => {
      g.board.edges[eId].piece = { type: idx === 5 ? RICKETY : BRIDGE, owner: 'a' };
    });
    const bobChain = findSimpleEdgeChain(g.board, 5, verticesOfEdges(g.board, aliceChain));
    bobChain.forEach(eId => {
      g.board.edges[eId].piece = { type: BRIDGE, owner: 'b' };
    });
    updateAwards(makeCtx(g, reg));
    expect(g.awards.longestRoad).toBe('a');

    // Collapse on a 7: Alice drops from 6 to 5, tied with Bob at 5; Alice retains Longest Road.
    const ctx = makeCtx(g, reg);
    resolveSeven(ctx);
    expect(g.players[0].stats.longestRoad).toBe(5);
    expect(g.players[1].stats.longestRoad).toBe(5);
    expect(g.awards.longestRoad).toBe('a');
    expect(ctx.events.some(ev => ev.type === 'awardChanged')).toBe(false);
  });

  it('leaves Longest Road unclaimed (null) if the holder drops below 5 while two other players are tied at 5', () => {
    const rules = { ...on };
    const reg = registryFor(allPacks, rules);
    const g = createGame(reg, {
      players: [
        { id: 'a', name: 'Alice' },
        { id: 'b', name: 'Bob' },
        { id: 'c', name: 'Cara' }
      ],
      rules,
      seed: 101,
      shuffleSeats: false
    });
    g.phase = 'main';

    const aliceChain = findSimpleEdgeChain(g.board, 6);
    const used = verticesOfEdges(g.board, aliceChain);
    const bobChain = findSimpleEdgeChain(g.board, 5, used);
    for (const v of verticesOfEdges(g.board, bobChain)) used.add(v);
    const caraChain = findSimpleEdgeChain(g.board, 5, used);

    aliceChain.forEach((eId, idx) => {
      g.board.edges[eId].piece = { type: idx >= 3 ? RICKETY : ROAD, owner: 'a' };
    });
    bobChain.forEach(eId => { g.board.edges[eId].piece = { type: ROAD, owner: 'b' }; });
    caraChain.forEach(eId => { g.board.edges[eId].piece = { type: ROAD, owner: 'c' }; });

    updateAwards(makeCtx(g, reg));
    expect(g.awards.longestRoad).toBe('a');

    const ctx = makeCtx(g, reg);
    resolveSeven(ctx);
    expect(g.players[0].stats.longestRoad).toBe(3);
    expect(g.players[1].stats.longestRoad).toBe(5);
    expect(g.players[2].stats.longestRoad).toBe(5);
    expect(g.awards.longestRoad).toBeNull();
    const ev = ctx.events.find(e => e.type === 'awardChanged');
    expect(ev?.data).toMatchObject({
      award: 'longestRoad',
      playerId: null,
      previousHolderId: 'a',
      value: 3
    });
  });
});

describe('Tidebound Bug 13 & Bug 14: bridge Edge SVG markup (sturdy vs rickety with player-color outline) and big-map pan/zoom optimizations', () => {
  it('draws a sturdy bridge with a player-color outer frame, dark timber bed, 5 uniform planks, and 4 corner bollard posts (Bug 13)', () => {
    const { rim, body } = bridgeEdgeMarkup('bridge', '#e0483a', 100, 100, 140, 100);
    expect(rim).toContain('class="bridge-rim-casing"');
    expect(body).toContain('class="bridge-frame"');
    expect(body).toContain('fill:#e0483a');
    expect(body).toContain('class="bridge-bed"');
    expect(body.match(/class="bridge-plank"/g)).toHaveLength(5);
    expect(body.match(/class="bridge-post"/g)).toHaveLength(4);
    // No old white cross-lines or dashed strokes
    expect(body).not.toContain('stroke-dasharray');
    expect(body).not.toContain('stroke:var(--piece-rim);stroke-width:2.8');
  });

  it('draws a rickety bridge with twin player-colored side ropes, 4 wooden stepping slats outlined in the player color, and distinct UI icons (Bug 13)', () => {
    const { rim, body } = bridgeEdgeMarkup('rickety_bridge', '#3a7bd5', 100, 100, 130, 130);
    expect(rim).toContain('class="bridge-rim-casing rickety"');
    expect(body.match(/class="bridge-rope"/g)).toHaveLength(2);
    expect(body).toContain('stroke:#3a7bd5');
    expect(body.match(/class="bridge-plank rickety"/g)).toHaveLength(4);
    expect(body.match(/class="bridge-post rickety"/g)).toHaveLength(4);
    expect(body).not.toContain('stroke-dasharray:9 5');

    const bridgeSvg = uiIcon('bridge', 18);
    const ricketySvg = uiIcon('rickety_bridge', 18);
    expect(bridgeSvg).toContain('<svg');
    expect(ricketySvg).toContain('<svg');
    expect(ricketySvg).not.toBe(bridgeSvg);
  });

  it('avoids universal .is-panning * selector and scopes scale CSS properties to vertex/road layers for big-map performance (Bug 14)', () => {
    const css = readFileSync('src/client/styles.css', 'utf8');
    expect(css).not.toContain('svg#boardSvg.is-panning *');
    expect(css).toContain('shape-rendering: optimizeSpeed');
    expect(css).toContain('.road-spot-line.spot-static');
    expect(css).toContain('.road-spot-dot.spot-static');

    const boardTs = readFileSync('src/client/render/board.ts', 'utf8');
    expect(boardTs).not.toContain("svg.style.setProperty('--building-scale'");
    expect(boardTs).not.toContain("svg.style.setProperty('--road-scale'");
    expect(boardTs).toContain("lastVerticesHtml");
    expect(boardTs).toContain("lastRoadSpotsHtml");
    expect(css).toContain('.piece-zoom-scale');
    expect(boardTs).toContain("'--piece-zoom'");
    expect(boardTs.match(/class="piece-zoom-scale"/g)).toHaveLength(2);
    expect(boardTs).toContain('tilePathSub');
    expect(boardTs).toContain('batchedTiles');
    expect(boardTs).toContain('beginBoardPan');
    expect(boardTs).toContain('updateBoardPan');
    expect(boardTs).toContain('commitBoardPan');
    expect(boardTs).toContain('translate3d(');
  });
});


