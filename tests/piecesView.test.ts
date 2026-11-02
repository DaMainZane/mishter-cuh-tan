// MODULE: tests for generic per-player piece and action view data (R8.6: base.pieces_view in packs/base/piecesView.ts) | USED BY: npm test
import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import { validateBuild } from '../src/packs/base/building';
import { CITY, GENERIC_PORT } from '../src/packs/base/constants';
import {
  FEED_SEA,
  FEED_SEA_COST,
  PLACE_NET,
  RICKETY,
  TECH_FISHING_NETS,
  TECH_HARBOR_MASTER,
  TECH_RICKETY_BRIDGES,
  UPGRADE_HARBOR,
  harborUpgradeCost,
  isOceanEdge,
  netPrice,
  seaHexIdsAt,
  techGate
} from '../src/packs/tidebound';
import { clearBotTimers, createRoom, rooms } from '../src/server/rooms';
import { defaultSettings } from '../src/server/runtime';
import { makeStateBuilder } from '../src/server/view';
import { buildTopology, createGame, getPlayer, makeCtx, mergeViewPlayer, registryFor, viewDataEntries } from '../src/shared';
import type { GameState, Id, Registry } from '../src/shared';

const TIDE_RULES = { dlc: { tidebound: true }, techTreeOn: true };
const ALL_TEST_TECHS = [TECH_FISHING_NETS, TECH_HARBOR_MASTER, TECH_RICKETY_BRIDGES];

function islandInits(landRadius: number, outerRadius: number): { q: number; r: number; type: string; number: number | null }[] {
  const out: { q: number; r: number; type: string; number: number | null }[] = [];
  for (let q = -outerRadius; q <= outerRadius; q++) {
    for (let r = -outerRadius; r <= outerRadius; r++) {
      if (Math.abs(q + r) > outerRadius) continue;
      const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
      const land = dist <= landRadius;
      out.push({ q, r, type: land ? 'wood' : 'water', number: land ? 6 : null });
    }
  }
  return out;
}

function giveTech(g: any, pid: string, techId: string): void {
  g.ext = g.ext || {};
  g.ext.core = g.ext.core || {};
  g.ext.core.techs = g.ext.core.techs || {};
  g.ext.core.techs[pid] = [...new Set([...(g.ext.core.techs[pid] || []), techId])];
}

/** Attaches test `visual` objects (and action `available`/`price` fallbacks if not yet on the action def) to `place_net`, `rickety_bridge`, `feed_sea`, `upgrade_harbor`. */
function attachVisuals(reg: Registry): void {
  // A net is an action on a sea tile (slot 'hex'), like feed_sea.
  const netDef = reg.actions.get(PLACE_NET);
  if (netDef) {
    reg.actions.set(PLACE_NET, {
      ...netDef,
      visual: { slot: 'hex', spotKey: 'hexId', button: { label: 'Net', icon: 'net', order: 20 } }
    } as any);
  }

  const ricketyDef = reg.pieces.get(RICKETY);
  if (ricketyDef) {
    reg.pieces.set(RICKETY, {
      ...ricketyDef,
      visual: { slot: 'edge:ocean', shape: '<g class="test-rickety"/>', button: { label: 'Rickety', icon: 'bridge', order: 15 } }
    } as any);
  }

  const feedDef = reg.actions.get(FEED_SEA);
  if (feedDef) {
    reg.actions.set(FEED_SEA, {
      ...feedDef,
      available: (feedDef as any).available ?? ((g: GameState, pid: Id) => techGate(g, pid, TECH_HARBOR_MASTER)),
      price: (feedDef as any).price ?? (() => FEED_SEA_COST),
      visual: { slot: 'hex', spotKey: 'hexId', button: { label: 'Feed', icon: 'fish', order: 30 } }
    } as any);
  }

  const harborDef = reg.actions.get(UPGRADE_HARBOR);
  if (harborDef) {
    reg.actions.set(UPGRADE_HARBOR, {
      ...harborDef,
      available: (harborDef as any).available ?? ((g: GameState, pid: Id) => techGate(g, pid, TECH_HARBOR_MASTER)),
      price: (harborDef as any).price ?? ((g: GameState, r: Registry, pid: Id) => harborUpgradeCost(g, r, getPlayer(g, pid)!)),
      visual: { slot: 'vertex', spotKey: 'vertexId', button: { label: 'Harbor', icon: 'harbor', order: 40 } }
    } as any);
  }
}

/** Builds a two-player game in Bob's (`'b'`) main phase with a coastal road, a placed net next to a non-full fishing ground, and a port city. */
function makeScene(rules: Record<string, any> = TIDE_RULES, techs: string[] = ALL_TEST_TECHS, attach = true) {
  const reg = registryFor(allPacks, rules);
  if (attach) attachVisuals(reg);
  const board = buildTopology(islandInits(2, 5), {
    isLand: t => !!reg.tiles.get(t)?.land,
    portBlocked: t => !!reg.tiles.get(t)?.noPort,
    waterEdges: true
  });
  const g: any = createGame(reg, {
    players: [
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' }
    ],
    rules,
    board,
    seed: 806,
    shuffleSeats: false
  });
  g.phase = 'main';
  g.turn = 1;
  g.turnCount = 4;
  g.round = 3;

  for (const t of techs) giveTech(g, 'b', t);
  const bob = g.players[1];
  bob.resources = { wood: 5, brick: 5, sheep: 5, wheat: 5, ore: 5 };

  if (reg.actions.has(PLACE_NET)) {
    const coast: number[] = g.board.vertices
      .filter((v: any) => v.hexIds.length > 0 && seaHexIdsAt(g, reg, v.id).length > 0)
      .map((v: any) => v.id);
    const roadV = coast[0];
    const netV = coast[Math.floor(coast.length / 2)];
    const harborV = coast[coast.length - 1];

    const roadEdge = g.board.vertices[roadV].edgeIds.find((e: number) => g.board.edges[e].hexIds.length > 0)!;
    g.board.edges[roadEdge].piece = { type: 'road', owner: 'b' };

    const ground = seaHexIdsAt(g, reg, netV)[0];
    g.board.hexes[ground].ext.net = { owner: 'b' };
    g.board.hexes[ground].ext.fish = 2;

    g.board.vertices[harborV].port = GENERIC_PORT;
    g.board.vertices[harborV].piece = { type: CITY, owner: 'b' };
  }

  return { g, reg, ctx: makeCtx(g, reg) };
}

describe('R8.6: generic per-player piece data (base.pieces_view)', () => {
  it('1. Base game (or registry with no visual): PlayerView.pieces is undefined', () => {
    const { g, reg } = makeScene({}, [], false);
    expect(viewDataEntries(reg).some(d => d.id === 'base.pieces_view')).toBe(true);

    const view = mergeViewPlayer(g, reg, g.players[1], { self: true, over: false, spectator: false });
    expect(view.pieces).toBeUndefined();

    // Also check through makeStateBuilder in a base game room.
    const room = createRoom('host-piecesview', 'Host');
    const created = room.code;
    room.settings = { ...defaultSettings() };
    room.game = g;
    try {
      const built = makeStateBuilder(room)('b');
      for (const p of built.players) {
        expect(p.pieces).toBeUndefined();
        expect('pieces' in JSON.parse(JSON.stringify(p))).toBe(false);
      }
    } finally {
      clearBotTimers(room);
      delete rooms[created];
    }

    // Tidebound with no visuals registered yet also gives undefined.
    const unattached = makeScene(TIDE_RULES, ALL_TEST_TECHS, false);
    const tideNoVis = mergeViewPlayer(unattached.g, unattached.reg, unattached.g.players[1], {
      self: true,
      over: false,
      spectator: false
    });
    expect(tideNoVis.pieces).toBeUndefined();
  });

  it('2. Parity: for place_net, feed_sea and upgrade_harbor, pieces[id].spots equals legacy netSpots, feedSpots, harborSpots', () => {
    const { g, reg } = makeScene(TIDE_RULES, ALL_TEST_TECHS, true);
    const bob = g.players[1];
    const view = mergeViewPlayer(g, reg, bob, { self: true, over: false, spectator: false });

    expect(view.pieces).toBeDefined();
    expect(view.netSpots.length).toBeGreaterThan(0);
    expect(view.feedSpots.length).toBeGreaterThan(0);
    expect(view.harborSpots.length).toBeGreaterThan(0);

    const sortNum = (arr: number[]) => [...arr].sort((a, b) => a - b);
    expect(sortNum(view.pieces[PLACE_NET].spots)).toEqual(sortNum(view.netSpots));
    expect(sortNum(view.pieces[FEED_SEA].spots)).toEqual(sortNum(view.feedSpots));
    expect(sortNum(view.pieces[UPGRADE_HARBOR].spots)).toEqual(sortNum(view.harborSpots));

    // Cost and supply parity with legacy fields.
    // A net is an action now, so `left` is null; the supply stays in `netsLeft` until the build UI rework (bug 5) reads it from here.
    expect(view.pieces[PLACE_NET].left).toBeNull();
    expect(view.pieces[PLACE_NET].cost).toEqual(netPrice(g, reg, bob));
    expect(view.pieces[FEED_SEA].cost).toEqual(view.feedCost);
    expect(view.pieces[UPGRADE_HARBOR].cost).toEqual(view.harborCost);
  });

  it('3. Edge piece: every id in rickety_bridge spots passes build validation; no other ocean edge does', () => {
    const { g, reg, ctx } = makeScene(TIDE_RULES, ALL_TEST_TECHS, true);
    const bob = g.players[1];
    const view = mergeViewPlayer(g, reg, bob, { self: true, over: false, spectator: false });

    const spots: number[] = view.pieces[RICKETY].spots;
    expect(Array.isArray(spots)).toBe(true);
    expect(spots.length).toBeGreaterThan(0);

    const spotSet = new Set(spots);
    for (const edgeId of spots) {
      expect(isOceanEdge(ctx, edgeId)).toBe(true);
      expect(validateBuild(ctx, 'b', { piece: RICKETY, loc: edgeId })).toBeNull();
    }

    for (const edge of g.board.edges) {
      if (spotSet.has(edge.id)) continue;
      if (isOceanEdge(ctx, edge.id)) {
        expect(validateBuild(ctx, 'b', { piece: RICKETY, loc: edge.id })).not.toBeNull();
      } else {
        expect(validateBuild(ctx, 'b', { piece: RICKETY, loc: edge.id })).not.toBeNull();
      }
    }
  });

  it('4. Absent key when available is false; left is null for an action; spots is null for other/spectator/off-turn/gameover and [] when broke', () => {
    // (a) No techs unlocked: all four keys are absent, and no present key has undefined inside.
    const locked = makeScene(TIDE_RULES, [], true);
    const lockedView = mergeViewPlayer(locked.g, locked.reg, locked.g.players[1], {
      self: true,
      over: false,
      spectator: false
    });
    expect(lockedView.pieces).toEqual({});
    expect(PLACE_NET in lockedView.pieces).toBe(false);
    expect(RICKETY in lockedView.pieces).toBe(false);
    expect(FEED_SEA in lockedView.pieces).toBe(false);
    expect(UPGRADE_HARBOR in lockedView.pieces).toBe(false);

    // Partial unlock: only Fishing nets owned -> only `place_net` is present.
    const netOnly = makeScene(TIDE_RULES, [TECH_FISHING_NETS], true);
    const netOnlyView = mergeViewPlayer(netOnly.g, netOnly.reg, netOnly.g.players[1], {
      self: true,
      over: false,
      spectator: false
    });
    expect(Object.keys(netOnlyView.pieces)).toEqual([PLACE_NET]);

    // (b) With all techs unlocked: `left` is a number for pieces and `null` for actions.
    const { g, reg } = makeScene(TIDE_RULES, ALL_TEST_TECHS, true);
    const bob = g.players[1];
    const alice = g.players[0];
    for (const t of ALL_TEST_TECHS) giveTech(g, 'a', t);

    const selfView = mergeViewPlayer(g, reg, bob, { self: true, over: false, spectator: false });
    expect(selfView.pieces[PLACE_NET].left).toBeNull();
    expect(typeof selfView.pieces[RICKETY].left).toBe('number');
    expect(selfView.pieces[FEED_SEA].left).toBeNull();
    expect(selfView.pieces[UPGRADE_HARBOR].left).toBeNull();

    for (const [key, entry] of Object.entries<any>(selfView.pieces)) {
      expect(entry.left, `${key}.left`).not.toBeUndefined();
      expect(entry.cost, `${key}.cost`).toBeDefined();
      expect(entry.spots, `${key}.spots`).not.toBeUndefined();
    }

    // (c) Other player viewing Bob: left and cost present, spots is null.
    const otherView = mergeViewPlayer(g, reg, bob, { self: false, over: false, spectator: false });
    for (const id of [PLACE_NET, RICKETY, FEED_SEA, UPGRADE_HARBOR]) {
      expect(otherView.pieces[id].spots, `other:${id}`).toBeNull();
      expect(otherView.pieces[id].cost, `other:${id}.cost`).toBeDefined();
    }

    // (d) Spectator viewing Bob: spots is null.
    const specView = mergeViewPlayer(g, reg, bob, { self: false, over: false, spectator: true });
    for (const id of [PLACE_NET, RICKETY, FEED_SEA, UPGRADE_HARBOR]) {
      expect(specView.pieces[id].spots, `spectator:${id}`).toBeNull();
    }

    // (e) Off-turn player viewing themselves (Alice while it is Bob's turn): spots is null.
    const offTurnAlice = mergeViewPlayer(g, reg, alice, { self: true, over: false, spectator: false });
    for (const id of [PLACE_NET, RICKETY, FEED_SEA, UPGRADE_HARBOR]) {
      expect(offTurnAlice.pieces[id].spots, `offTurnAlice:${id}`).toBeNull();
    }

    // Off-phase (Bob during roll phase): spots is null.
    g.phase = 'roll';
    const rollView = mergeViewPlayer(g, reg, bob, { self: true, over: false, spectator: false });
    for (const id of [PLACE_NET, RICKETY, FEED_SEA, UPGRADE_HARBOR]) {
      expect(rollView.pieces[id].spots, `rollPhase:${id}`).toBeNull();
    }
    g.phase = 'main';

    // (f) Game over (`who.over: true` or `g.phase = 'gameover'`): spots is null.
    const overWhoView = mergeViewPlayer(g, reg, bob, { self: true, over: true, spectator: false });
    for (const id of [PLACE_NET, RICKETY, FEED_SEA, UPGRADE_HARBOR]) {
      expect(overWhoView.pieces[id].spots, `overWho:${id}`).toBeNull();
    }
    g.phase = 'gameover';
    const overPhaseView = mergeViewPlayer(g, reg, bob, { self: true, over: false, spectator: false });
    for (const id of [PLACE_NET, RICKETY, FEED_SEA, UPGRADE_HARBOR]) {
      expect(overPhaseView.pieces[id].spots, `overPhase:${id}`).toBeNull();
    }
    g.phase = 'main';

    // (g) Cannot pay on your own main-phase turn: spots is [].
    bob.resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    const brokeView = mergeViewPlayer(g, reg, bob, { self: true, over: false, spectator: false });
    for (const id of [PLACE_NET, RICKETY, FEED_SEA, UPGRADE_HARBOR]) {
      expect(brokeView.pieces[id].spots, `broke:${id}`).toEqual([]);
    }
  });

  it('5. Spots ascending, whole view survives JSON round-trip, and g.rng / g.log are untouched', () => {
    const { g, reg } = makeScene(TIDE_RULES, ALL_TEST_TECHS, true);
    const bob = g.players[1];
    const rngBefore = JSON.stringify(g.rng);
    const logBefore = JSON.stringify(g.log);

    const view = mergeViewPlayer(g, reg, bob, { self: true, over: false, spectator: false });
    for (const [id, data] of Object.entries<any>(view.pieces)) {
      expect(Array.isArray(data.spots), `${id}.spots is array`).toBe(true);
      for (let i = 1; i < data.spots.length; i++) {
        expect(data.spots[i], `${id}.spots ascending at ${i}`).toBeGreaterThan(data.spots[i - 1]);
      }
    }

    const roundTrip = JSON.parse(JSON.stringify(view));
    expect(roundTrip.pieces).toEqual(view.pieces);
    expect(JSON.stringify(g.rng)).toBe(rngBefore);
    expect(JSON.stringify(g.log)).toBe(logBefore);
  });
});
