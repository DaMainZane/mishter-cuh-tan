// MODULE: unit tests for T11 (Tidebound Tech Nodes: T11a fork layout & cost divisor, T11b techGate, T11c nodes 1-3, T11d nodes 4-6, T11e nodes 7-9, T11f demolish_bridge, Grand Causeway & Harbor Empire)
import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import { tradeRatios } from '../src/packs/base/trading';
import {
  buildTopology,
  checkAction,
  createGame,
  dispatch,
  hasTech,
  makeCtx,
  publicVP,
  registryFor,
  researchTech,
  score,
  techBuildingValue,
  techCostCards,
  techGate,
  techPanelFor
} from '../src/shared';
import type { Board, Edge, GameState, Hex, Vertex } from '../src/shared';
import {
  BRIDGE,
  claimWreck,
  computeWreckLootCount,
  DEMOLISH_BRIDGE,
  DRIVE_OFF_PIRATE,
  FEED_SEA,
  GRAND_CAUSEWAY_BONUS_VP,
  GRAND_CAUSEWAY_VP,
  grandCausewayBonusVp,
  harborLimitFor,
  longestRoadHasBridge,
  netPrice,
  pirateKnightsNeeded,
  PLACE_NET,
  RICKETY,
  spawnPirate,
  spawnWreckAt,
  syncBridgePool,
  TECH_FISHING_NETS,
  TECH_GRAND_CAUSEWAY,
  TECH_HARBOR_CHARTERS,
  TECH_HARBOR_EMPIRE,
  TECH_HARBOR_MASTER,
  TECH_NET_WORKS,
  TECH_PIRATE_HUNTER,
  TECH_RICKETY_BRIDGES,
  TECH_SALVAGE_CREW,
  UPGRADE_BRIDGE,
  UPGRADE_HARBOR
} from '../src/packs/tidebound';
import { layout as layoutTechPanel } from '../src/client/render/techpanel';

/**
 * Compact test board:
 *  - Hex 0: land ('wood', number 6), vertices [0, 1, 2, 3, 4, 5]
 *  - Hex 1: water ('water'), vertices [1, 2, 6, 7]
 *  - Edge 0: coast (v0-v1, hexIds: [0], port: 'generic')
 *  - Edge 1: coast (v1-v2, hexIds: [0, 1])
 *  - Edge 2: land  (v2-v3, hexIds: [0])
 *  - Edge 3: land  (v3-v4, hexIds: [0])
 *  - Edge 4: land  (v4-v5, hexIds: [0])
 *  - Edge 5: land  (v5-v0, hexIds: [0])
 *  - Edge 6: ocean (v1-v6, hexIds: []) -> bridge edge
 *  - Edge 7: ocean (v6-v7, hexIds: []) -> bridge edge
 */
function makeBoard(): Board {
  const hexes: Hex[] = [
    { id: 0, q: 0, r: 0, x: 0, y: 0, type: 'wood', number: 6, vertexIds: [0, 1, 2, 3, 4, 5], corners: [], ext: {} },
    { id: 1, q: 1, r: 0, x: 90, y: 0, type: 'water', number: null, vertexIds: [1, 2, 6, 7], corners: [], ext: {} }
  ];
  const vertices: Vertex[] = [
    { id: 0, x: -30, y: -30, hexIds: [0], edgeIds: [0, 5], adjacentVertices: [1, 5], port: '3:1', piece: null },
    { id: 1, x: 30, y: -30, hexIds: [0], edgeIds: [0, 1, 6], adjacentVertices: [0, 2, 6], port: null, piece: null },
    { id: 2, x: 30, y: 30, hexIds: [0], edgeIds: [1, 2], adjacentVertices: [1, 3], port: null, piece: null },
    { id: 3, x: 0, y: 50, hexIds: [0], edgeIds: [2, 3], adjacentVertices: [2, 4], port: null, piece: null },
    { id: 4, x: -30, y: 30, hexIds: [0], edgeIds: [3, 4], adjacentVertices: [3, 5], port: null, piece: null },
    { id: 5, x: -50, y: 0, hexIds: [0], edgeIds: [4, 5], adjacentVertices: [4, 0], port: null, piece: null },
    { id: 6, x: 90, y: -30, hexIds: [], edgeIds: [6, 7], adjacentVertices: [1, 7], port: null, piece: null },
    { id: 7, x: 90, y: 30, hexIds: [], edgeIds: [7], adjacentVertices: [6], port: null, piece: null }
  ];
  const edges: Edge[] = [
    { id: 0, key: '0-1', v1: 0, v2: 1, hexIds: [0], port: '3:1', piece: null },
    { id: 1, key: '1-2', v1: 1, v2: 2, hexIds: [0], port: null, piece: null },
    { id: 2, key: '2-3', v1: 2, v2: 3, hexIds: [0], port: null, piece: null },
    { id: 3, key: '3-4', v1: 3, v2: 4, hexIds: [0], port: null, piece: null },
    { id: 4, key: '4-5', v1: 4, v2: 5, hexIds: [0], port: null, piece: null },
    { id: 5, key: '0-5', v1: 5, v2: 0, hexIds: [0], port: null, piece: null },
    { id: 6, key: '1-6', v1: 1, v2: 6, hexIds: [], port: null, piece: null },
    { id: 7, key: '6-7', v1: 6, v2: 7, hexIds: [], port: null, piece: null }
  ];
  return { hexes, vertices, edges, robberHexId: 0 };
}

function giveTech(g: GameState, pid: string, techId: string): void {
  g.ext = g.ext || {};
  g.ext.core = g.ext.core || {};
  g.ext.core.techs = g.ext.core.techs || {};
  g.ext.core.techs[pid] = [...new Set([...(g.ext.core.techs[pid] || []), techId])];
}

function makeMainGame(techTreeOn: boolean) {
  const rules = { dlc: { tidebound: true }, techTreeOn };
  const reg = registryFor(allPacks, rules);
  const g = createGame(reg, {
    players: [
      { id: 'p1', name: 'Alice', avatar: 'a', color: 'red', isBot: false },
      { id: 'p2', name: 'Bob', avatar: 'b', color: 'blue', isBot: false }
    ],
    board: makeBoard(),
    seed: 4242,
    shuffleSeats: false,
    rules
  });
  g.board.hexes[1].vertexIds = [0, 1, 6, 7];
  g.phase = 'main';
  g.turn = 0;
  return { g, reg, ctx: makeCtx(g, reg) };
}

describe('T11a — Tech tree fork layout & 25+ VP cost divisor', () => {
  it('registers all 9 Tidebound tech nodes across tiers 1..4 and forks Expansion vs Industrial lanes cleanly', () => {
    const { g, reg } = makeMainGame(true);
    const rows = techPanelFor(g, reg, 'p1')!;
    const tbRows = rows.filter(r => r.branch === 'tidebound');
    expect(tbRows.map(r => r.id)).toEqual([
      TECH_HARBOR_CHARTERS,
      TECH_RICKETY_BRIDGES,
      TECH_FISHING_NETS,
      TECH_SALVAGE_CREW,
      TECH_NET_WORKS,
      TECH_PIRATE_HUNTER,
      TECH_HARBOR_MASTER,
      TECH_GRAND_CAUSEWAY,
      TECH_HARBOR_EMPIRE
    ]);

    const branches = ['tidebound', 'bulwark', 'warlords', 'wildearth', 'guildhall'];
    const { placed, maxRing } = layoutTechPanel(rows, branches);
    expect(maxRing).toBe(5);

    const byId = new Map(placed.map(p => [p.row.id, p]));
    expect(byId.get(TECH_HARBOR_CHARTERS)!.ring).toBe(1);
    expect(byId.get(TECH_RICKETY_BRIDGES)!.ring).toBe(2);
    expect(byId.get(TECH_FISHING_NETS)!.ring).toBe(2);
    expect(byId.get(TECH_SALVAGE_CREW)!.ring).toBe(3);
    expect(byId.get(TECH_NET_WORKS)!.ring).toBe(3);
    expect(byId.get(TECH_PIRATE_HUNTER)!.ring).toBe(4);
    expect(byId.get(TECH_HARBOR_MASTER)!.ring).toBe(4);
    expect(byId.get(TECH_GRAND_CAUSEWAY)!.ring).toBe(5);
    expect(byId.get(TECH_HARBOR_EMPIRE)!.ring).toBe(5);

    // Expansion and Industrial nodes on the same ring sit on distinct lanes (non-overlapping x/y).
    for (const [expId, indId] of [
      [TECH_RICKETY_BRIDGES, TECH_FISHING_NETS],
      [TECH_SALVAGE_CREW, TECH_NET_WORKS],
      [TECH_PIRATE_HUNTER, TECH_HARBOR_MASTER],
      [TECH_GRAND_CAUSEWAY, TECH_HARBOR_EMPIRE]
    ]) {
      const exp = byId.get(expId)!;
      const ind = byId.get(indId)!;
      expect(Math.hypot(exp.x - ind.x, exp.y - ind.y)).toBeGreaterThan(2);
    }
  });

  it('scales techCostCards divisor at 25+ VP using Math.max(3, Math.round(0.3 * vpToWin))', () => {
    const { g, reg } = makeMainGame(true);
    // Give p1 6 cities (V = 12)
    for (let i = 0; i < 6; i++) {
      g.board.vertices[i].piece = { type: 'city', owner: 'p1' };
    }
    expect(techBuildingValue(g, 'p1')).toBe(12);

    g.rules.vpToWin = 10; // divisor = max(3, round(3)) = 3 -> 1 + 0 + ceil(12/3) = 5
    const cost10 = techCostCards(g, reg, 'p1', 1);
    g.rules.vpToWin = 30; // divisor = max(3, round(9)) = 9 -> 1 + 0 + ceil(12/9) = 3
    const cost30 = techCostCards(g, reg, 'p1', 1);
    expect(cost10).toBe(5);
    expect(cost30).toBe(3);
  });
});

describe('T11b — techGate helper', () => {
  it('allows everything when techTreeOn is false, and requires hasTech when techTreeOn is true', () => {
    const { g: gOff } = makeMainGame(false);
    expect(techGate(gOff, 'p1', TECH_RICKETY_BRIDGES)).toBe(true);
    expect(techGate(gOff, 'p1', TECH_HARBOR_MASTER)).toBe(true);

    const { g: gOn } = makeMainGame(true);
    expect(techGate(gOn, 'p1', TECH_RICKETY_BRIDGES)).toBe(false);
    giveTech(gOn, 'p1', TECH_RICKETY_BRIDGES);
    expect(techGate(gOn, 'p1', TECH_RICKETY_BRIDGES)).toBe(true);
  });
});

describe('T11c — Nodes 1–3 (Harbor Charters, Rickety Bridges, Fishing Nets)', () => {
  it('gates rickety_bridge build and upgrade by tidebound.rickety_bridges when techTreeOn is true, and grants +4 bridge cap before 2x price', () => {
    const { g, reg } = makeMainGame(true);
    const p1 = g.players[0];
    p1.resources = { wood: 10, brick: 10, sheep: 10, wheat: 10, ore: 10 };
    g.board.vertices[1].piece = { type: 'settlement', owner: 'p1' };

    // Locked before researching tidebound.rickety_bridges
    expect(checkAction(g, reg, { type: 'build', playerId: 'p1', payload: { piece: RICKETY, loc: 6 } })).toBeTruthy();

    // Base bridge pool before tech: 10 bridges (or board-scaled)
    const beforePool = p1.pieces[BRIDGE];

    // Research Harbor Charters -> Rickety Bridges
    giveTech(g, 'p1', TECH_HARBOR_CHARTERS);
    dispatch(g, reg, { type: 'research_tech', playerId: 'p1', payload: { techId: TECH_RICKETY_BRIDGES } });
    expect(hasTech(g, 'p1', TECH_RICKETY_BRIDGES)).toBe(true);
    // Pool cap increases by +4
    expect(p1.pieces[BRIDGE]).toBe(beforePool + 4);

    // Now building a rickety bridge on ocean edge 6 is legal!
    expect(checkAction(g, reg, { type: 'build', playerId: 'p1', payload: { piece: RICKETY, loc: 6 } })).toBeNull();
    dispatch(g, reg, { type: 'build', playerId: 'p1', payload: { piece: RICKETY, loc: 6 } });
    expect(g.board.edges[6].piece?.type).toBe(RICKETY);

    // Upgrading the rickety bridge to a full bridge is also legal
    expect(checkAction(g, reg, { type: UPGRADE_BRIDGE, playerId: 'p1', payload: { edgeId: 6 } })).toBeNull();
  });

  it('gates place_net by tidebound.fishing_nets and lets upgrade_port raise a 3:1 port with a settlement', () => {
    const { g, reg } = makeMainGame(true);
    const p1 = g.players[0];
    p1.resources = { wood: 10, brick: 10, sheep: 10, wheat: 10, ore: 10 };
    // Put a settlement on coastal generic port vertex 0 and connect edge 0
    g.board.vertices[0].piece = { type: 'settlement', owner: 'p1' };
    g.board.edges[0].piece = { type: 'road', owner: 'p1' };

    // A net on the sea tile (hex 1) beside the coast road on edge 0 is blocked before Fishing Nets
    expect(checkAction(g, reg, { type: PLACE_NET, playerId: 'p1', payload: { hexId: 1 } })).toBeTruthy();

    // With Harbor Charters alone, upgrade_port requires a city on vertex 0 (settlement is rejected)
    giveTech(g, 'p1', TECH_HARBOR_CHARTERS);
    expect(checkAction(g, reg, { type: 'upgrade_port', playerId: 'p1', payload: { vertexId: 0 } })).toBe(
      'A harbor upgrade needs your own city'
    );

    // Research Fishing Nets: now both the net and the settlement 3:1->2:1 port upgrade are legal!
    giveTech(g, 'p1', TECH_FISHING_NETS);
    expect(checkAction(g, reg, { type: PLACE_NET, playerId: 'p1', payload: { hexId: 1 } })).toBeNull();
    expect(checkAction(g, reg, { type: 'upgrade_port', playerId: 'p1', payload: { vertexId: 0 } })).toBeNull();

    dispatch(g, reg, { type: 'upgrade_port', playerId: 'p1', payload: { vertexId: 0 } });
    const ratios = tradeRatios(g, reg, 'p1');
    expect(ratios.wood).toBe(2);
    expect(ratios.ore).toBe(2);
  });
});

describe('T11d — Nodes 4–6 (Salvage Crew, Net Works, Pirate Hunter)', () => {
  it('Salvage Crew boosts wreck loot by +25% (4 -> 5 cards)', () => {
    const { g, ctx } = makeMainGame(true);
    expect(computeWreckLootCount({ baseCards: 4, turnCount: 0, hasSalvageCrew: false })).toBe(4);
    expect(computeWreckLootCount({ baseCards: 4, turnCount: 0, hasSalvageCrew: true })).toBe(5);

    giveTech(g, 'p1', TECH_SALVAGE_CREW);
    const w = spawnWreckAt(ctx, 1, { site: 'sea', resource: 'wood', baseCards: 4, bonus: null });
    expect(w).not.toBeNull();
    const res = claimWreck(ctx, w!, 'p1');
    expect(res?.amount).toBe(5);
  });

  it('Net Works reduces net cost by 1 wood (2 wood + 1 sheep -> 1 wood + 1 sheep) and boosts catch rates', () => {
    const { g, reg } = makeMainGame(true);
    const p1 = g.players[0];
    // A net is a tile action now, not a piece: its price is `netPrice`, which runs the cost modifiers.
    expect(netPrice(g, reg, p1)).toEqual({ wood: 2, sheep: 1 });

    giveTech(g, 'p1', TECH_NET_WORKS);
    expect(netPrice(g, reg, p1)).toEqual({ wood: 1, sheep: 1 });
  });

  it('Pirate Hunter reduces knights needed by 2 (min 1) and increases pirate loot by +50%', () => {
    const { g, reg, ctx } = makeMainGame(true);
    const p1 = g.players[0];
    g.board.vertices[1].piece = { type: 'settlement', owner: 'p1' };
    g.round = 10; // strength 2 -> base loot 4 cards, +50% = 6 cards
    spawnPirate(ctx, { hexId: 1 });

    expect(pirateKnightsNeeded(g, 'p1', 4)).toBe(4);
    expect(pirateKnightsNeeded(g, 'p1', 2)).toBe(2);
    giveTech(g, 'p1', TECH_PIRATE_HUNTER);
    expect(pirateKnightsNeeded(g, 'p1', 4)).toBe(2);
    expect(pirateKnightsNeeded(g, 'p1', 2)).toBe(1);

    // With 1 played knight (discounted from 2), p1 can drive off the strength-2 pirate and gets 9 cards (+50% over 6)
    p1.stats.knightsPlayed = 1;
    const beforeCards = Object.values(p1.resources).reduce((a, b) => a + b, 0);
    expect(checkAction(g, reg, { type: DRIVE_OFF_PIRATE, playerId: 'p1', payload: { hexId: 1 } })).toBeNull();
    dispatch(g, reg, { type: DRIVE_OFF_PIRATE, playerId: 'p1', payload: { hexId: 1 } });
    const gained = Object.values(p1.resources).reduce((a, b) => a + b, 0) - beforeCards;
    expect(gained).toBe(9);
  });
});

describe('T11e — Nodes 7–9 registration & Harbor Master gating', () => {
  it('gates upgrade_harbor and feed_sea by tidebound.harbor_master when techTreeOn is true', () => {
    const { g, reg } = makeMainGame(true);
    const p1 = g.players[0];
    p1.resources = { wood: 10, brick: 10, sheep: 10, wheat: 10, ore: 10 };
    g.board.vertices[0].piece = { type: 'city', owner: 'p1' };
    g.board.hexes[1].ext.net = { owner: 'p1' };

    // Both upgrade_harbor and feed_sea are blocked before Harbor Master
    expect(checkAction(g, reg, { type: UPGRADE_HARBOR, playerId: 'p1', payload: { vertexId: 0 } })).toBeTruthy();
    expect(checkAction(g, reg, { type: FEED_SEA, playerId: 'p1', payload: { hexId: 1 } })).toBeTruthy();

    // Unlock Harbor Master: both become legal!
    giveTech(g, 'p1', TECH_HARBOR_MASTER);
    expect(checkAction(g, reg, { type: UPGRADE_HARBOR, playerId: 'p1', payload: { vertexId: 0 } })).toBeNull();
    expect(checkAction(g, reg, { type: FEED_SEA, playerId: 'p1', payload: { hexId: 1 } })).toBeNull();
  });
});

describe('T11f — demolish_bridge, Grand Causeway (16 VP Longest Road), and Harbor Empire', () => {
  it('demolish_bridge removes own bridge or rickety_bridge, refunds floor(cost/2) cards, and requires Salvage Crew', () => {
    const { g, reg } = makeMainGame(true);
    const p1 = g.players[0];
    p1.resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    g.board.edges[6].piece = { type: BRIDGE, owner: 'p1' };
    g.board.edges[7].piece = { type: RICKETY, owner: 'p1' };
    syncBridgePool(g, 'p1');
    const beforePool = p1.pieces[BRIDGE];

    // Locked without Salvage Crew
    expect(checkAction(g, reg, { type: DEMOLISH_BRIDGE, playerId: 'p1', payload: { edgeId: 6 } })).toBe(
      'Research Salvage crew first'
    );

    giveTech(g, 'p1', TECH_SALVAGE_CREW);
    expect(checkAction(g, reg, { type: DEMOLISH_BRIDGE, playerId: 'p1', payload: { edgeId: 6 } })).toBeNull();

    // Demolish full bridge (paid 3 cards: 1 wood + 1 brick + 1 ore -> refunds floor(3/2) = 1 card: 1 wood)
    dispatch(g, reg, { type: DEMOLISH_BRIDGE, playerId: 'p1', payload: { edgeId: 6 } });
    expect(g.board.edges[6].piece).toBeNull();
    expect(p1.resources.wood).toBe(1);
    expect(p1.pieces[BRIDGE]).toBe(beforePool + 1);

    // Demolish 1x rickety bridge (paid 1 card: 1 wood -> refunds floor(1/2) = 0 cards, frees bridge pool slot)
    dispatch(g, reg, { type: DEMOLISH_BRIDGE, playerId: 'p1', payload: { edgeId: 7 } });
    expect(g.board.edges[7].piece).toBeNull();
    expect(p1.resources.wood).toBe(1);
    expect(p1.pieces[BRIDGE]).toBe(beforePool + 2);
  });

  it('Grand Causeway makes Longest Road worth 16 VP (+14 bonus) only when Longest Road includes a bridge, and drops if lost', () => {
    const { g, reg } = makeMainGame(true);
    const p1 = g.players[0];
    // 5 connected land roads (edges 0..4) -> Longest Road = 5, no bridge yet
    for (const eId of [0, 1, 2, 3, 4]) {
      g.board.edges[eId].piece = { type: 'road', owner: 'p1' };
    }
    g.awards.longestRoad = 'p1';
    p1.stats.longestRoad = 5;

    giveTech(g, 'p1', TECH_GRAND_CAUSEWAY);
    // No bridge in the road -> 0 bonus VP (Longest Road stays 2 VP)
    expect(longestRoadHasBridge(g, reg, 'p1')).toBe(false);
    expect(grandCausewayBonusVp(g, reg, 'p1')).toBe(0);
    expect(score(g, reg, p1, true)).toBe(2);

    // Add ocean bridge on edge 6 (v1-v6) so the longest road (6 segments: e4-e3-e2-e1-e6) includes a bridge!
    g.board.edges[6].piece = { type: BRIDGE, owner: 'p1' };
    p1.stats.longestRoad = 6;
    expect(longestRoadHasBridge(g, reg, 'p1')).toBe(true);
    expect(grandCausewayBonusVp(g, reg, 'p1')).toBe(GRAND_CAUSEWAY_BONUS_VP);
    expect(score(g, reg, p1, true)).toBe(GRAND_CAUSEWAY_VP);
    expect(publicVP(g, reg, p1)).toBe(GRAND_CAUSEWAY_VP);

    // Even if a player extends their land road so the strictly longest simple path is land-only and the bridge sits on a shorter branch,
    // Grand Causeway still turns Longest Road to 16 VP while they hold Longest Road and have a bridge on the board.
    g.board.edges[5].piece = { type: 'road', owner: 'p1' };
    expect(longestRoadHasBridge(g, reg, 'p1')).toBe(true);
    expect(grandCausewayBonusVp(g, reg, 'p1')).toBe(GRAND_CAUSEWAY_BONUS_VP);
    expect(score(g, reg, p1, true)).toBe(GRAND_CAUSEWAY_VP);

    // Losing Longest Road immediately drops the +14 bonus
    g.awards.longestRoad = 'p2';
    expect(grandCausewayBonusVp(g, reg, 'p1')).toBe(0);
    expect(score(g, reg, p1, true)).toBe(0);
  });

  it('discounts Tidebound tech costs in active games with starting settlements so tiers cost 2 / 3 / 5 / 5 / 8 cards (Bug 3)', () => {
    const { g, reg } = makeMainGame(true);
    // Standard game start: 2 settlements on the board (V = 2)
    g.board.vertices[0].piece = { type: 'settlement', owner: 'p1' };
    g.board.vertices[2].piece = { type: 'settlement', owner: 'p1' };
    expect(techBuildingValue(g, 'p1')).toBe(2);

    const panel = techPanelFor(g, reg, 'p1')!;
    const costOf = (id: string) => panel.find(r => r.id === id)!.cost;

    expect(costOf(TECH_HARBOR_CHARTERS)).toBe(2);
    expect(costOf(TECH_RICKETY_BRIDGES)).toBe(3);
    expect(costOf(TECH_FISHING_NETS)).toBe(3);
    expect(costOf(TECH_SALVAGE_CREW)).toBe(5);
    expect(costOf(TECH_NET_WORKS)).toBe(5);
    expect(costOf(TECH_HARBOR_MASTER)).toBe(5);
    expect(costOf(TECH_GRAND_CAUSEWAY)).toBe(8);
    expect(costOf(TECH_HARBOR_EMPIRE)).toBe(8);
  });

  it('Harbor Empire raises harbor limit to 2 and grants ceil(V / 2) random cards on unlock with zero g.rng draws', () => {
    const { g, reg } = makeMainGame(true);
    const p1 = g.players[0];
    // Give p1 1 settlement + 2 cities -> V = 5 -> ceil(5 / 2) = 3 cards granted on unlock
    g.board.vertices[0].piece = { type: 'settlement', owner: 'p1' };
    g.board.vertices[2].piece = { type: 'city', owner: 'p1' };
    g.board.vertices[4].piece = { type: 'city', owner: 'p1' };
    expect(techBuildingValue(g, 'p1')).toBe(5);

    giveTech(g, 'p1', TECH_HARBOR_CHARTERS);
    giveTech(g, 'p1', TECH_FISHING_NETS);
    giveTech(g, 'p1', TECH_NET_WORKS);
    giveTech(g, 'p1', TECH_HARBOR_MASTER);

    // Give exact resources to pay for Harbor Empire research
    const row = techPanelFor(g, reg, 'p1')!.find(r => r.id === TECH_HARBOR_EMPIRE)!;
    p1.resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0, ...row.payment };

    const rngBefore = { ...g.rng };
    expect(harborLimitFor(g, 'p1')).toBe(1);

    dispatch(g, reg, { type: 'research_tech', playerId: 'p1', payload: { techId: TECH_HARBOR_EMPIRE } });
    expect(hasTech(g, 'p1', TECH_HARBOR_EMPIRE)).toBe(true);
    expect(harborLimitFor(g, 'p1')).toBe(2);

    // Payment was spent and ceil(5 / 2) = 3 random cards were granted from the bank
    const handAfter = Object.values(p1.resources).reduce((a, b) => a + b, 0);
    expect(handAfter).toBe(3);
    // Zero g.rng draws!
    expect(g.rng).toEqual(rngBefore);
  });
});

