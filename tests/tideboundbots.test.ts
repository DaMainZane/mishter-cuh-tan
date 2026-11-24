import { describe, expect, it } from 'vitest';
import {
  BOT_GOALS,
  botGoalWantsKnight,
  botGoalEdgeDelta,
  botGoalVertexDelta,
  buildTopology,
  createGame,
  defsOf,
  dispatch,
  ensureEventTimeline,
  evaluateBotGoals,
  getPlayerTechs,
  grantWildToken,
  makeCtx,
  registryFor,
  setTileState
} from '../src/shared';
import type { GameState, Id, Registry } from '../src/shared';
import { allPacks } from '../src/packs';
import { CITY, ROAD, SETTLEMENT } from '../src/packs/base/constants';
import {
  TECH_GROUND_WORK,
  TECH_PLUNDER,
  TECH_ROAD_LEVY,
  TECH_STOCKPILING
} from '../src/packs/base/techEffects';
import {
  BRIDGE,
  DEMOLISH_BRIDGE,
  FEED_SEA,
  FISH,
  FLOODED,
  NET,
  PIRATE_EVENT_ID,
  RICKETY,
  SHIPWRECK_EVENT_ID,
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
  UPGRADE_HARBOR,
  drownHex,
  ensureTides,
  fishBotGoal,
  isOceanEdge,
  lowestElevationFrontierHexIds,
  pirateBotGoal,
  pirateStrengthAt,
  ricketyBotGoal,
  risingSeaBotGoal,
  salvageBotGoal,
  tideFloodShareForHex,
  tidesBotGoal
} from '../src/packs/tidebound';
import { chooseBotAction } from '../src/server/bots/brain';
import {
  BOT_FEED_SEA_ACTION,
  BOT_NET_PIECE,
  BOT_PIRATE_EVENT,
  BOT_SHIPWRECK_EVENT,
  BOT_UPGRADE_HARBOR_ACTION
} from '../src/packs/tidebound/tech';
import { emitBotDialogue } from '../src/server/bots/dialogue';
import { buildCtx } from '../src/server/bots/dialogue/context';
import { ALL_LINES } from '../src/server/bots/dialogue/lines';
import { TIDEBOUND_LINES } from '../src/server/bots/dialogue/lines/tidebound';
import type { Room } from '../src/server/types';

/** Corners of a tile (the shipwreck rework of 2026-11-24 removed the pack's copy; these tests only need the topology). */
function verticesOfHex(g: GameState, _reg: Registry, hexId: number): number[] {
  return [...(g.board.hexes[hexId]?.vertexIds ?? [])];
}

function grantTech(g: GameState, pid: Id, techId: string): void {
  const core = (g.ext.core ??= {});
  const techs = (core.techs ??= {});
  const list = (techs[pid] ??= []);
  if (!list.includes(techId)) list.push(techId);
}

function makeTideboundGame(seed = 1301, extraRules: Record<string, any> = {}): { g: GameState; reg: Registry } {
  const rules = { dlc: { tidebound: true }, ...extraRules };
  const reg = registryFor(allPacks, rules);
  const inits: { q: number; r: number; type: string; number: number | null; ext?: Record<string, any> }[] = [
    { q: 0, r: 0, type: 'wheat', number: 6, ext: { elevation: 2 } },
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
      if (dist === 2) inits.push({ q, r, type: 'water', number: null, ext: { fish: 4 } });
    }
  }
  const board = buildTopology(inits, {
    isLand: t => !!reg.tiles.get(t)?.land,
    portBlocked: t => !!reg.tiles.get(t)?.noPort,
    waterEdges: true
  });
  const g = createGame(reg, {
    seed,
    players: [
      { id: 'p1', name: 'Ayla', color: '#e74c3c', isBot: true, difficulty: 'Overload' },
      { id: 'p2', name: 'Bram', color: '#3498db', isBot: true, difficulty: 'Secondary' }
    ],
    rules,
    board,
    shuffleSeats: false
  });
  g.phase = 'main';
  g.turn = 0;
  return { g, reg };
}

describe('T13a: Flood & rising-sea exposure in vertex scoring', () => {
  it('discounts flood-exposed low-elevation coastal vertices and rewards elevated coastal ground', () => {
    const { g, reg } = makeTideboundGame(1302);
    const tides = ensureTides(g, reg);
    const ctx = makeCtx(g, reg);

    // Pick a coastal land hex in a tide cluster
    const clusters = tides.clusters;
    const coastCluster = clusters[0];
    const hexId = coastCluster.hexIds[0];
    const hex = g.board.hexes[hexId];
    hex.type = 'wheat';
    hex.number = 6;
    const vId = hex.vertexIds[0];

    // Low elevation (1) has positive flood share and a negative vertexDelta from tidesBotGoal
    hex.ext = { ...hex.ext, elevation: 1 };
    const lowShare = tideFloodShareForHex(g, reg, hexId);
    expect(lowShare).toBeGreaterThan(0);
    const lowDelta = tidesBotGoal.vertexDelta!(ctx, 'p1', vId);

    // High elevation (2) resists normal tides (strength 1) -> lower flood share and higher vertexDelta
    hex.ext = { ...hex.ext, elevation: 2 };
    const highShare = tideFloodShareForHex(g, reg, hexId);
    expect(highShare).toBeLessThan(lowShare);
    const highDelta = tidesBotGoal.vertexDelta!(ctx, 'p1', vId);
    expect(highDelta).toBeGreaterThan(lowDelta);

    // Currently flooded hex receives an extra penalty
    setTileState(g, hexId, { id: FLOODED });
    const floodedDelta = tidesBotGoal.vertexDelta!(ctx, 'p1', vId);
    expect(floodedDelta).toBeLessThan(highDelta);
  });

  it('penalizes drowned tiles and lowest-elevation rising-sea frontier tiles when Rising Sea is active', () => {
    const { g, reg } = makeTideboundGame(1303, {
      risingSeaLevel: 4,
      addons: { 'tidebound.tides': true, 'tidebound.rising_sea': true }
    });
    const ctx = makeCtx(g, reg);
    const lowFront = lowestElevationFrontierHexIds(g, reg);
    expect(lowFront.length).toBeGreaterThan(0);
    const hexId = lowFront[0];
    const hex = g.board.hexes[hexId];
    hex.type = 'ore';
    hex.number = 8;
    const vId = hex.vertexIds[0];

    const frontierDelta = risingSeaBotGoal.vertexDelta!(ctx, 'p1', vId);
    expect(frontierDelta).toBeLessThan(0);

    // Elevate the hex above the lowest frontier: penalty drops
    hex.ext = { ...hex.ext, elevation: 3 };
    const safeDelta = risingSeaBotGoal.vertexDelta!(ctx, 'p1', vId);
    expect(safeDelta).toBeGreaterThan(frontierDelta);

    // Drown the hex: penalty is severe
    drownHex(ctx, hexId);
    const drownedDelta = risingSeaBotGoal.vertexDelta!(ctx, 'p1', vId);
    expect(drownedDelta).toBeLessThan(frontierDelta);
  });
});

describe('T13b: Salvage goal (demolish_bridge, rickety bridge upgrade)', () => {
  it('has no board goals any more: a shipwreck is an Event Deck event, nothing to reach (2026-11-24)', () => {
    const { g, reg } = makeTideboundGame(1304);
    const ctx = makeCtx(g, reg);
    expect(salvageBotGoal.goals).toBeUndefined();
    expect(salvageBotGoal.edgeDelta).toBeUndefined();
    expect(salvageBotGoal.vertexDelta).toBeUndefined();
    expect(evaluateBotGoals(ctx, 'p1', 'overload').some(item => item.id.startsWith('tidebound.wrecks'))).toBe(false);
  });

  it('scores demolish_bridge positively only for dead-end bridges with Salvage Crew, and prioritizes upgrading rickety bridges in Longest Road', () => {
    const { g, reg } = makeTideboundGame(1305, { techTreeOn: true });
    const ctx = makeCtx(g, reg);
    for (const v of g.board.vertices) v.piece = null;
    for (const e of g.board.edges) e.piece = null;

    const oceanEdge = g.board.edges.find(e => isOceanEdge(ctx, e.id))!;
    g.board.vertices[oceanEdge.v1].piece = { type: SETTLEMENT, owner: 'p1' };
    oceanEdge.piece = { type: BRIDGE, owner: 'p1' };
    g.ext.bridges = { paid: { [oceanEdge.id]: { wood: 1, brick: 1, ore: 1 } } };
    g.players[0].resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    g.players[0].stats.longestRoad = 2;

    // Without Salvage Crew, demolish_bridge is not legal / scores 0
    expect(salvageBotGoal.actionScore!(ctx, 'p1', { type: DEMOLISH_BRIDGE, payload: { edgeId: oceanEdge.id } })).toBe(0);

    // With Salvage Crew on a dead-end bridge when low on cards, demolish_bridge scores > 0
    grantTech(g, 'p1', TECH_SALVAGE_CREW);
    expect(salvageBotGoal.actionScore!(ctx, 'p1', { type: DEMOLISH_BRIDGE, payload: { edgeId: oceanEdge.id } })).toBeGreaterThan(0);

    // If a piece is at the far end (not a dead end), bot refuses to demolish it
    g.board.vertices[oceanEdge.v2].piece = { type: SETTLEMENT, owner: 'p1' };
    expect(salvageBotGoal.actionScore!(ctx, 'p1', { type: DEMOLISH_BRIDGE, payload: { edgeId: oceanEdge.id } })).toBe(0);

    // Make the bridge rickety: upgrading a rickety bridge that connects two pieces scores higher when holding Longest Road
    grantTech(g, 'p1', TECH_RICKETY_BRIDGES);
    oceanEdge.piece = { type: RICKETY, owner: 'p1' };
    g.ext.rickety = { durability: { [oceanEdge.id]: 1 } };
    g.players[0].resources = { wood: 0, brick: 2, sheep: 0, wheat: 0, ore: 1 };
    const baseUpgradeScore = ricketyBotGoal.actionScore!(ctx, 'p1', { type: UPGRADE_BRIDGE, payload: { edgeId: oceanEdge.id } });
    expect(baseUpgradeScore).toBe(0); // Only 1 card left after paying (rem = 1 < 3) when not a Longest Road contender

    g.awards.longestRoad = 'p1';
    g.players[0].stats.longestRoad = 5;
    const roadContenderScore = ricketyBotGoal.actionScore!(ctx, 'p1', { type: UPGRADE_BRIDGE, payload: { edgeId: oceanEdge.id } });
    expect(roadContenderScore).toBeGreaterThanOrEqual(50);
  });
});

describe('T13c: Port and net placement in vertex scoring & bot goals', () => {
  it('boosts coastal port vertices and coastal vertices adjacent to fish-rich sea hexes', () => {
    const { g, reg } = makeTideboundGame(1306, { techTreeOn: true });
    const ctx = makeCtx(g, reg);

    // Place a 3:1 port on a coastal vertex whose adjacent coastal vertex touches a fish-boosted sea hex
    const seaHex = g.board.hexes.find(h => !reg.tiles.get(h.type)?.land)!;
    const coastVId = verticesOfHex(g, reg, seaHex.id)[0];
    const portV = g.board.vertices[coastVId];
    portV.port = '3:1';
    for (const hId of portV.hexIds) {
      if (reg.tiles.get(g.board.hexes[hId]?.type)?.land) {
        g.board.hexes[hId].ext = { ...g.board.hexes[hId].ext, elevation: 3 };
      }
    }
    const nonPortV = g.board.vertices[0];
    nonPortV.port = null;

    expect(botGoalVertexDelta(ctx, 'p1', portV.id, 'overload')).toBeGreaterThan(
      botGoalVertexDelta(ctx, 'p1', nonPortV.id, 'overload')
    );

    // Prioritize Harbor upgrade even higher when the port is currently flooded
    for (const v of g.board.vertices) v.piece = null;
    portV.piece = { type: CITY, owner: 'p1' };
    grantTech(g, 'p1', TECH_HARBOR_MASTER);
    g.players[0].resources = { wood: 3, brick: 3, sheep: 3, wheat: 3, ore: 3 };
    for (const hId of portV.hexIds) {
      if (reg.tiles.get(g.board.hexes[hId]?.type)?.land) setTileState(g, hId, { id: FLOODED });
    }
    const goals = evaluateBotGoals(ctx, 'p1', 'overload');
    const harborGoal = goals.find(item => item.action.type === UPGRADE_HARBOR);
    expect(harborGoal).toBeDefined();
    expect(harborGoal!.priority).toBeGreaterThanOrEqual(80);
  });

  it('scores feed_sea by the ground under the net: an empty ground 12, no icon 10, boosts left 0', () => {
    const { g, reg } = makeTideboundGame(1307, { techTreeOn: true });
    const ctx = makeCtx(g, reg);
    for (const v of g.board.vertices) {
      v.piece = null;
      v.port = null;
    }

    // One net sits on one sea tile and fishes only that tile, so a tile can no longer hold two nets: the score depends on the ground itself.
    const seaHex = g.board.hexes.find(h => !reg.tiles.get(h.type)?.land && verticesOfHex(g, reg, h.id).length >= 2)!;
    seaHex.ext = { ...seaHex.ext, fish: 0, net: { owner: 'p1' } };
    grantTech(g, 'p1', TECH_HARBOR_MASTER);
    g.players[0].resources = { wood: 3, brick: 3, sheep: 4, wheat: 4, ore: 3 };
    grantWildToken(ctx, 'p1', FISH, 2);

    const feedScore = () => fishBotGoal.actionScore!(ctx, 'p1', { type: FEED_SEA, payload: { hexId: seaHex.id } });
    expect(feedScore()).toBe(12);

    delete seaHex.ext.fish;
    expect(feedScore()).toBe(10);

    seaHex.ext.fish = 2;
    expect(feedScore()).toBe(0);
  });
});

describe('T13d: Pirate raids on the timeline (2026-11-24)', () => {
  /** Puts a pirate raid first on the timeline and returns its strength. */
  function raidNext(g: GameState, reg: Registry): number {
    const st = ensureEventTimeline(g, reg, g.round || 0);
    st.deck[0] = PIRATE_EVENT_ID;
    return pirateStrengthAt(st.rounds![0]);
  }

  it('wants a knight only while the next raid on the timeline would beat the bot', () => {
    const { g, reg } = makeTideboundGame(1308, { eventsOn: true });
    const ctx = makeCtx(g, reg);
    g.round = 3;
    const st = ensureEventTimeline(g, reg, 3);
    st.deck = st.deck.map(id => (id === PIRATE_EVENT_ID ? SHIPWRECK_EVENT_ID : id));
    expect(pirateBotGoal.wantsKnight!(ctx, 'p1')).toBe(false);

    const strength = raidNext(g, reg);
    g.players[0].stats.knightsPlayed = strength - 1;
    expect(pirateBotGoal.wantsKnight!(ctx, 'p1')).toBe(true);
    g.players[0].stats.knightsPlayed = strength;
    expect(pirateBotGoal.wantsKnight!(ctx, 'p1')).toBe(false);
    grantTech(g, 'p1', TECH_PIRATE_HUNTER);
    g.players[0].stats.knightsPlayed = Math.max(0, strength - 2);
    expect(pirateBotGoal.wantsKnight!(ctx, 'p1')).toBe(false);
  });

  it('plays a knight development card when a raid it would lose is on the timeline', () => {
    const { g, reg } = makeTideboundGame(1309, { eventsOn: true });
    g.round = 3;
    raidNext(g, reg);
    const p1 = g.players[0];
    p1.stats.knightsPlayed = 0;
    p1.devCards = ['knight'];
    p1.flags.playedDev = false;
    p1.resources = {};
    expect(botGoalWantsKnight(makeCtx(g, reg), 'p1')).toBe(true);

    const move = chooseBotAction(g, reg, 'p1', () => 0.5);
    expect(move?.type).toBe('play_dev');
    expect(move?.payload.card).toBe('knight');
  });
});

describe('T13e: Tech research across all 9 Tidebound nodes', () => {
  it('progressively researches Tier 1, Tier 2, Tier 3, and Tier 4 Tidebound tech nodes across both lanes', () => {
    const { g, reg } = makeTideboundGame(1310, { techTreeOn: true });
    const p1 = g.players[0];
    p1.pieces.city = 0;
    p1.pieces.settlement = 0;
    p1.pieces.road = 0;
    p1.pieces[BRIDGE] = 0;
    p1.pieces[RICKETY] = 0;
    p1.pieces[NET] = 0;

    // Lock the other 4 roots so the bot researches down the Tidebound tree
    grantTech(g, 'p1', TECH_STOCKPILING);
    grantTech(g, 'p1', TECH_ROAD_LEVY);
    grantTech(g, 'p1', TECH_PLUNDER);
    grantTech(g, 'p1', TECH_GROUND_WORK);

    const expectedNodes = [
      TECH_HARBOR_CHARTERS,
      TECH_RICKETY_BRIDGES,
      TECH_FISHING_NETS,
      TECH_SALVAGE_CREW,
      TECH_NET_WORKS,
      TECH_PIRATE_HUNTER,
      TECH_HARBOR_MASTER,
      TECH_GRAND_CAUSEWAY,
      TECH_HARBOR_EMPIRE
    ];

    for (let step = 0; step < expectedNodes.length; step++) {
      p1.resources = { wood: 10, brick: 10, sheep: 10, wheat: 10, ore: 10 };
      const move = chooseBotAction(g, reg, 'p1', () => 0.5);
      expect(move?.type).toBe('research_tech');
      expect(expectedNodes).toContain(move?.payload.techId);
      const res = dispatch(g, reg, { type: move!.type, playerId: 'p1', payload: move!.payload });
      expect(res.ok).toBe(true);
    }

    const owned = getPlayerTechs(g, 'p1');
    for (const id of expectedNodes) {
      expect(owned).toContain(id);
    }
  });
});

describe('T13f: Public-info-only Tidebound dialogue lines', () => {
  const RESOURCE_WORDS = /\b(wood|brick|sheep|wool|wheat|grain|ore|lumber|clay|stone)\b/i;

  it('adds tidebound map trait when DLC is enabled and keeps all Tidebound lines free of resource names', () => {
    const { g } = makeTideboundGame(1311);
    const room: Room = {
      code: 'TB',
      hostId: 'p1',
      settings: { botChat: 'chatty', gameSpeed: 1, vpToWin: 10, cardDiscardLimit: 7 } as any,
      lobbyPlayers: [],
      chats: [],
      game: g
    } as unknown as Room;

    const ctx = buildCtx(room, { id: 'p1', name: 'Ayla' });
    expect(ctx.facts.traits).toContain('tidebound');

    for (const line of TIDEBOUND_LINES) {
      expect(ALL_LINES).toContain(line);
      const texts = Array.isArray(line.text) ? line.text : line.text ? [line.text] : [];
      for (const t of texts) {
        expect(t).not.toMatch(RESOURCE_WORDS);
      }
    }
  });

  it('emits public-info-only bot chat for shipwreckEvent, pirateEvent (lost and won), harborBuilt, netBuilt, bridgeCollapsed, tideFlood and risingSeaDrowned', () => {
    const { g } = makeTideboundGame(1312);
    const landHex = g.board.hexes[0];
    g.board.vertices[landHex.vertexIds[0]].piece = { type: SETTLEMENT, owner: 'p1' };

    const triggers: { action: string; ev: any }[] = [
      { action: 'roll', ev: { type: 'shipwreckEvent', data: { round: 6, results: [{ playerId: 'p1', roll: 17, cards: 6, got: { ore: 4, wood: 2 } }, { playerId: 'p2', roll: 3, cards: 2, got: { sheep: 2 } }] } } },
      { action: 'roll', ev: { type: 'pirateEvent', data: { round: 9, strength: 2, results: [{ playerId: 'p1', won: false, defence: 0, strength: 2, got: {}, lost: { brick: 2 }, lostFish: 0 }] } } },
      { action: 'roll', ev: { type: 'pirateEvent', data: { round: 9, strength: 2, results: [{ playerId: 'p1', won: true, defence: 3, strength: 2, got: { ore: 4 }, lost: {}, lostFish: 0 }] } } },
      { action: 'upgrade_harbor', ev: { type: 'portUpgraded', data: { playerId: 'p1', vertexId: 0, level: 2 } } },
      { action: 'place_net', ev: { type: 'netPlaced', data: { playerId: 'p1', hexId: 0, doubleCost: false } } },
      { action: 'roll', ev: { type: 'pieceBroken', data: { target: 'edge', loc: 0, piece: 'rickety_bridge', ownerId: 'p1' } } },
      { action: 'roll', ev: { type: 'tideChanged', data: { round: 4, spring: false, risen: [landHex.id], fell: [] } } },
      { action: 'roll', ev: { type: 'risingSeaDrowned', data: { hexId: landHex.id, round: 5 } } }
    ];

    let totalPosted = 0;
    for (const trig of triggers) {
      let posted = 0;
      for (let i = 0; i < 20; i++) {
        const room: Room = {
          code: `TB${i}`,
          hostId: 'p1',
          settings: { botChat: 'chatty', gameSpeed: 1, vpToWin: 10, cardDiscardLimit: 7 } as any,
          lobbyPlayers: [],
          chats: [],
          game: g
        } as unknown as Room;
        emitBotDialogue(room, 'p1', trig.action, [trig.ev]);
        for (const c of room.chats) {
          totalPosted++;
          posted++;
          expect(c.text).not.toMatch(RESOURCE_WORDS);
        }
      }
      // Each trigger must post on its own, so one dead handler cannot hide behind the others.
      expect(posted, `${trig.ev.type} never posted`).toBeGreaterThan(0);
    }
    expect(totalPosted).toBeGreaterThan(20);
  });
});

describe('T13 DLC-off invariant', () => {
  it('registers no Tidebound bot goals, draws no RNG, and adds no tidebound map trait when DLC is off', () => {
    const reg = registryFor(allPacks, { dlc: { tidebound: false } });
    const g = createGame(reg, {
      seed: 1399,
      players: [
        { id: 'p1', name: 'Ayla', color: '#e74c3c', isBot: true, difficulty: 'Overload' },
        { id: 'p2', name: 'Bram', color: '#3498db', isBot: true, difficulty: 'Main' }
      ],
      rules: { dlc: { tidebound: false } }
    });
    const ctx = makeCtx(g, reg);
    const rngBefore = JSON.stringify(g.rng);

    expect(evaluateBotGoals(ctx, 'p1', 'overload')).toEqual([]);
    expect(botGoalVertexDelta(ctx, 'p1', 0, 'overload')).toBe(0);
    expect(botGoalEdgeDelta(ctx, 'p1', 0, 'overload')).toBe(0);
    expect(JSON.stringify(g.rng)).toBe(rngBefore);

    const room: Room = {
      code: 'OFF',
      hostId: 'p1',
      settings: { botChat: 'chatty', gameSpeed: 1, vpToWin: 10, cardDiscardLimit: 7 } as any,
      lobbyPlayers: [],
      chats: [],
      game: g
    } as unknown as Room;
    expect(buildCtx(room, { id: 'p1', name: 'Ayla' }).facts.traits).not.toContain('tidebound');
  });
});

describe('T13 bot brain stays generic', () => {
  const seededRand = (seed: number) => {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  };

  it('spells the ids it shares with other Tidebound files exactly as they are defined', () => {
    expect(BOT_NET_PIECE).toBe(NET);
    expect(BOT_FEED_SEA_ACTION).toBe(FEED_SEA);
    expect(BOT_UPGRADE_HARBOR_ACTION).toBe(UPGRADE_HARBOR);
    expect(BOT_SHIPWRECK_EVENT).toBe(SHIPWRECK_EVENT_ID);
    expect(BOT_PIRATE_EVENT).toBe(PIRATE_EVENT_ID);
  });

  it('with Tidebound off, chooseBotAction picks the same moves as a registry built without the Tidebound pack', () => {
    const rules = { techTreeOn: true, dlc: { tidebound: false } };
    const regOff = registryFor(allPacks, rules);
    const regNone = registryFor(allPacks.filter(p => p.id !== 'tidebound'), { techTreeOn: true });
    expect([...defsOf(regOff, BOT_GOALS).keys()].filter(id => id.startsWith('tidebound.'))).toEqual([]);

    const g = createGame(regOff, {
      seed: 1398,
      players: [
        { id: 'p1', name: 'Ayla', color: '#e74c3c', isBot: true, difficulty: 'Overload' },
        { id: 'p2', name: 'Bram', color: '#3498db', isBot: true, difficulty: 'Secondary' },
        { id: 'p3', name: 'Cora', color: '#2ecc71', isBot: true, difficulty: 'Main' }
      ],
      rules
    });

    let steps = 0;
    for (; steps < 120; steps++) {
      const moves = g.players.map(p => ({
        pid: p.id,
        off: chooseBotAction(g, regOff, p.id, seededRand(steps + 7)),
        none: chooseBotAction(g, regNone, p.id, seededRand(steps + 7))
      }));
      for (const m of moves) expect(m.off, `step ${steps}, ${m.pid}`).toEqual(m.none);
      const next = moves.find(m => m.pid === g.players[g.turn].id && m.off) ?? moves.find(m => m.off);
      if (!next || !next.off) break;
      const res = dispatch(g, regOff, { type: next.off.type, playerId: next.pid, payload: next.off.payload });
      expect(res.ok).toBe(true);
    }
    expect(steps).toBeGreaterThan(20);
  });
});
