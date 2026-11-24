import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import { CITY, SETTLEMENT } from '../src/packs/base/constants';
import {
  DRIVE_OFF_PIRATE,
  PIRATE_AVOID_RADIUS,
  PIRATE_BASE_STRENGTH,
  PIRATE_CADENCE_ROUNDS,
  PIRATE_EVENT_ID,
  PIRATE_FIRST_ROUND,
  PIRATE_FLEE_CLOSE_STEP,
  PIRATE_FLEE_ROB_STEP,
  PIRATE_LOOT_BASE,
  PIRATE_MAX,
  PIRATE_MAX_STRENGTH,
  PIRATE_ROB_CARDS,
  WRECK_MAX_PLAYER_DIST,
  activePirates,
  canDrivePirate,
  driveOffPirateAction,
  guardedVertices,
  hexVertexDistance,
  isGuardedHex,
  isWreckSeaHex,
  minPlayerDistanceToHex,
  passivePirateSpawn,
  pirateAt,
  pirateBotGoal,
  pirateClientView,
  pirateContactVertices,
  pirateDriveView,
  pirateKnights,
  pirateKnightsNeeded,
  pirateLootCards,
  pirateRaidCard,
  pirateRoundStep,
  pirateSpawnCandidates,
  pirateStrengthAt,
  seaNeighborIds,
  spawnPirate,
  verticesOfHex
} from '../src/packs/tidebound';
import { allEventCards, buildTopology, createGame, dispatch, hexDistance, makeCtx, registryFor } from '../src/shared';

// T10 Pirates. T10a: marker, max 2, ocean only, random move. T10b: strength grows, knights needed to drive one off. T10c: a pirate robs 2 cards
// from every settlement/city it touches. T10d: flee mode and keeping clear of players with more knights than its strength.

const on = { dlc: { tidebound: true } };
const piratesOff = { dlc: { tidebound: true }, addons: { 'tidebound.pirates': false } };
const dlcOff = { dlc: { tidebound: false } };

/** A disc of radius `outerRadius`: land (wood) within `landRadius` of the centre, sea outside. */
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

function makeGame(rules: Record<string, any> = on, seed = 810, landRadius = 2, outerRadius = 6) {
  const reg = registryFor(allPacks, rules);
  const board = buildTopology(islandInits(landRadius, outerRadius), {
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

/** First sea tile with a land-touching corner: puts a piece of `owner` on that corner and returns both ids. */
function coastSetup(g: any, reg: any, owner = 'a', type: string = SETTLEMENT): { seaId: number; vertexId: number } {
  for (const h of g.board.hexes) {
    if (!isWreckSeaHex(reg, h)) continue;
    const vId = verticesOfHex(g, reg, h.id).find((v: number) => g.board.vertices[v].hexIds.length > 0 && !g.board.vertices[v].piece);
    if (vId !== undefined) {
      g.board.vertices[vId].piece = { type, owner };
      return { seaId: h.id, vertexId: vId };
    }
  }
  throw new Error('no coastal sea tile found');
}

/** Cards in the whole game (bank plus every hand), so a rob can be checked for conservation. */
function allCards(g: any): number {
  const bank = Object.values(g.bank as Record<string, number>).reduce((s, n) => s + n, 0);
  const hands = g.players.reduce((s: number, p: any) => s + Object.values(p.resources as Record<string, number>).reduce((t, n) => t + n, 0), 0);
  return bank + hands;
}

function handSize(p: any): number {
  return Object.values(p.resources as Record<string, number>).reduce((s, n) => s + n, 0);
}

function farSeaHexIds(g: any, reg: any, minFromCentre: number): number[] {
  const centre = g.board.hexes.find((h: any) => h.q === 0 && h.r === 0);
  return g.board.hexes.filter((h: any) => isWreckSeaHex(reg, h) && hexDistance(h, centre) >= minFromCentre).map((h: any) => h.id);
}

function act(g: any, reg: any, playerId: string, type: string, payload: any = {}) {
  return dispatch(g, reg, { playerId, type, payload });
}

describe('Tidebound T10a: pirate marker, max 2, ocean only, random move', () => {
  it('registers nothing when Tidebound or tidebound.pirates is off', () => {
    for (const rules of [dlcOff, piratesOff]) {
      const { g, reg, ctx } = makeGame(rules);
      expect(allEventCards(reg).has(PIRATE_EVENT_ID)).toBe(false);
      expect(reg.actions.has(DRIVE_OFF_PIRATE)).toBe(false);
      expect(spawnPirate(ctx)).toBeNull();
      expect(pirateClientView(g, reg)).toBeNull();
      expect(pirateDriveView(g, reg, g.players[0])).toBeUndefined();
      passivePirateSpawn(ctx);
      pirateRoundStep(ctx);
      expect(activePirates(g)).toHaveLength(0);
    }
  });

  it('registers the raid event card and spawns on the ocean only, never touching g.rng', () => {
    const { g, reg, ctx } = makeGame(on);
    expect(allEventCards(reg).has(PIRATE_EVENT_ID)).toBe(true);
    expect(PIRATE_MAX).toBe(2);

    coastSetup(g, reg);
    const rngBefore = JSON.stringify(g.rng);
    pirateRaidCard.apply(ctx);
    expect(activePirates(g)).toHaveLength(1);
    const first = activePirates(g)[0];
    expect(isWreckSeaHex(reg, g.board.hexes[Number(first.loc)])).toBe(true);
    expect(JSON.stringify(g.rng)).toBe(rngBefore);

    // A land tile is never legal.
    const landHex = g.board.hexes.find((h: any) => !isWreckSeaHex(reg, h))!;
    expect(spawnPirate(ctx, { hexId: landHex.id })).toBeNull();
    expect(activePirates(g)).toHaveLength(1);
  });

  it('allows at most 2 pirates at once, on different tiles', () => {
    const { g, reg, ctx } = makeGame(on);
    const seas = farSeaHexIds(g, reg, 4);
    expect(spawnPirate(ctx, { hexId: seas[0] })).not.toBeNull();
    // The same tile is refused.
    expect(spawnPirate(ctx, { hexId: seas[0] })).toBeNull();
    expect(spawnPirate(ctx, { hexId: seas[1] })).not.toBeNull();
    expect(activePirates(g)).toHaveLength(PIRATE_MAX);
    // A third one is refused, explicit tile or random.
    expect(spawnPirate(ctx, { hexId: seas[2] })).toBeNull();
    expect(spawnPirate(ctx)).toBeNull();
    expect(activePirates(g)).toHaveLength(2);
  });

  it('spawns random pirates within 4 tiles of a player only', () => {
    const { g, reg, ctx } = makeGame(on);
    coastSetup(g, reg);
    const cands = pirateSpawnCandidates(g, reg);
    expect(cands.length).toBeGreaterThan(0);
    for (const id of cands) {
      expect(isWreckSeaHex(reg, g.board.hexes[id])).toBe(true);
      expect(minPlayerDistanceToHex(g, reg, id)).toBeLessThanOrEqual(WRECK_MAX_PLAYER_DIST);
    }
    expect(spawnPirate(ctx)).not.toBeNull();
  });

  it('spawns on a fixed schedule when the Event Deck is off: round 4, then every 4th, never past the max', () => {
    const { g, reg, ctx } = makeGame(on);
    coastSetup(g, reg);
    expect(PIRATE_FIRST_ROUND).toBe(4);
    expect(PIRATE_CADENCE_ROUNDS).toBe(4);
    const rngBefore = JSON.stringify(g.rng);

    g.round = 3;
    for (const h of reg.hooks.onRoundStart) h(ctx);
    expect(activePirates(g)).toHaveLength(0);

    g.round = 4;
    for (const h of reg.hooks.onRoundStart) h(ctx);
    expect(activePirates(g)).toHaveLength(1);

    g.round = 5;
    for (const h of reg.hooks.onRoundStart) h(ctx);
    expect(activePirates(g)).toHaveLength(1);

    g.round = 8;
    for (const h of reg.hooks.onRoundStart) h(ctx);
    expect(activePirates(g)).toHaveLength(2);

    g.round = 12;
    for (const h of reg.hooks.onRoundStart) h(ctx);
    expect(activePirates(g)).toHaveLength(2);
    expect(JSON.stringify(g.rng)).toBe(rngBefore);
  });

  it('leaves the schedule to the Event Deck when it is on', () => {
    const { g, reg, ctx } = makeGame(on);
    coastSetup(g, reg);
    (g.rules as any).eventsOn = true;
    g.round = PIRATE_FIRST_ROUND;
    passivePirateSpawn(ctx);
    expect(activePirates(g)).toHaveLength(0);
  });

  it('moves one random step to a free neighbouring sea tile each round, staying on the ocean', () => {
    const { g, reg, ctx } = makeGame(on);
    const [start, other] = farSeaHexIds(g, reg, 4);
    spawnPirate(ctx, { hexId: start });
    spawnPirate(ctx, { hexId: other });
    const rngBefore = JSON.stringify(g.rng);

    for (let i = 0; i < 20; i++) {
      const before = activePirates(g).map(m => Number(m.loc));
      pirateRoundStep(ctx);
      const after = activePirates(g).map(m => Number(m.loc));
      after.forEach((hexId, idx) => {
        expect(isWreckSeaHex(reg, g.board.hexes[hexId])).toBe(true);
        // One step at most (it stays put only when boxed in).
        expect(hexDistance(g.board.hexes[before[idx]], g.board.hexes[hexId])).toBeLessThanOrEqual(1);
      });
      // Never two on one tile.
      expect(new Set(after).size).toBe(after.length);
    }
    expect(JSON.stringify(g.rng)).toBe(rngBefore);
  });

  it('finds only sea neighbours for a coastal sea tile', () => {
    const { g, reg } = makeGame(on);
    const { seaId } = coastSetup(g, reg);
    const next = seaNeighborIds(g, reg, seaId);
    expect(next.length).toBeGreaterThan(0);
    for (const id of next) {
      expect(isWreckSeaHex(reg, g.board.hexes[id])).toBe(true);
      expect(hexDistance(g.board.hexes[seaId], g.board.hexes[id])).toBe(1);
    }
  });
});

describe('Tidebound T10b: strength grows slowly, knights needed to drive one off', () => {
  it('grows 1 strength every 6 rounds after round 4, capped at 5', () => {
    expect(PIRATE_BASE_STRENGTH).toBe(1);
    expect(pirateStrengthAt(0)).toBe(1);
    expect(pirateStrengthAt(4)).toBe(1);
    expect(pirateStrengthAt(9)).toBe(1);
    expect(pirateStrengthAt(10)).toBe(2);
    expect(pirateStrengthAt(16)).toBe(3);
    expect(pirateStrengthAt(22)).toBe(4);
    expect(pirateStrengthAt(28)).toBe(5);
    expect(pirateStrengthAt(200)).toBe(PIRATE_MAX_STRENGTH);
  });

  it('a pirate already out follows the round: its strength is refreshed every round', () => {
    const { g, reg, ctx } = makeGame(on);
    const [hexId] = farSeaHexIds(g, reg, 4);
    g.round = 4;
    spawnPirate(ctx, { hexId });
    expect(pirateClientView(g, reg)![0].strength).toBe(1);
    g.round = 16;
    pirateRoundStep(ctx);
    expect(pirateClientView(g, reg)![0].strength).toBe(3);
  });

  it('loot grows with strength: 4 plus the strength, +50% with Salvage crew', () => {
    expect(PIRATE_LOOT_BASE).toBe(4);
    expect(pirateLootCards(1)).toBe(5);
    expect(pirateLootCards(3)).toBe(7);
    expect(pirateLootCards(5)).toBe(9);
    expect(pirateLootCards(2, true)).toBe(9);
  });

  it('needs played knights equal to the strength, and a road, bridge or port touching the tile', () => {
    const { g, reg, ctx } = makeGame(on);
    const { seaId } = coastSetup(g, reg);
    g.round = 10; // strength 2
    expect(canDrivePirate(g, reg, 'a', seaId)).toBe('There is no pirate on that tile');
    spawnPirate(ctx, { hexId: seaId });
    expect(pirateKnightsNeeded(g, 'a', 2)).toBe(2);

    g.players[0].stats.knightsPlayed = 1;
    expect(pirateKnights(g, 'a')).toBe(1);
    expect(canDrivePirate(g, reg, 'a', seaId)).toContain('takes 2 played knights (you have 1)');

    g.players[0].stats.knightsPlayed = 2;
    expect(canDrivePirate(g, reg, 'a', seaId)).toBeNull();

    // Bob has the knights but nothing touching the tile.
    g.players[1].stats.knightsPlayed = 3;
    expect(canDrivePirate(g, reg, 'b', seaId)).toContain('touches');
  });

  it('drive_off_pirate pays the loot from the bank, removes the pirate and counts it', () => {
    const { g, reg, ctx } = makeGame(on, 812);
    const { seaId } = coastSetup(g, reg);
    g.round = 10; // strength 2 -> 6 cards
    spawnPirate(ctx, { hexId: seaId });
    const a = g.players[0];
    a.stats.knightsPlayed = 2;
    a.resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    for (const r of Object.keys(g.bank)) g.bank[r] = 19; // plenty, so the loot is paid in full whichever resource is picked
    const total = allCards(g);

    expect(driveOffPirateAction.legal!(ctx, 'a')).toEqual([{ hexId: seaId }]);
    expect(pirateDriveView(g, reg, a)).toEqual([seaId]);
    expect(pirateDriveView(g, reg, g.players[1])).toBeUndefined(); // not Bob's turn

    const res = act(g, reg, 'a', DRIVE_OFF_PIRATE, { hexId: seaId });
    expect(res.ok).toBe(true);
    expect(handSize(a)).toBe(pirateLootCards(2));
    expect(allCards(g)).toBe(total);
    expect(activePirates(g)).toHaveLength(0);
    expect(a.stats.piratesDriven).toBe(1);
    expect(pirateClientView(g, reg)).toBeNull();
  });

  it('refuses to drive one off without enough knights', () => {
    const { g, reg, ctx } = makeGame(on, 813);
    const { seaId } = coastSetup(g, reg);
    spawnPirate(ctx, { hexId: seaId });
    const res = act(g, reg, 'a', DRIVE_OFF_PIRATE, { hexId: seaId });
    expect(res.ok).toBe(false);
    expect(activePirates(g)).toHaveLength(1);
  });
});

describe('Tidebound T10c: a pirate robs 2 cards from every settlement and city it touches', () => {
  it('takes 2 cards from a settlement in contact and gives them to the bank', () => {
    const { g, reg, ctx } = makeGame(on, 820);
    const { seaId, vertexId } = coastSetup(g, reg);
    const a = g.players[0];
    a.resources = { wood: 3, brick: 2, sheep: 0, wheat: 0, ore: 0 };
    const total = allCards(g);
    const bankBefore = Object.values(g.bank as Record<string, number>).reduce((s, n) => s + n, 0);

    spawnPirate(ctx, { hexId: seaId });
    expect(pirateContactVertices(g, reg, seaId)).toContain(vertexId);
    // It has just robbed, and the flee roll is set to fail, so it stays and robs again.
    const m = pirateAt(g, seaId)!;
    (m.payload as any).lastRobbed = true;
    (m.payload as any).fleeChance = 0;

    expect(PIRATE_ROB_CARDS).toBe(2);
    pirateRoundStep(ctx);
    expect(handSize(a)).toBe(3);
    expect(Object.values(g.bank as Record<string, number>).reduce((s, n) => s + n, 0)).toBe(bankBefore + 2);
    expect(allCards(g)).toBe(total);
    expect(a.stats.piratesRobbedCards).toBe(2);
    expect(a.stats.piratesRobbedTimes).toBe(1);
  });

  it('robs a city for the same 2 cards, and a player with an empty hand loses nothing', () => {
    const { g, reg, ctx } = makeGame(on, 821);
    const { seaId } = coastSetup(g, reg, 'a', CITY);
    const a = g.players[0];
    a.resources = { wood: 1, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    spawnPirate(ctx, { hexId: seaId });
    const m = pirateAt(g, seaId)!;
    (m.payload as any).lastRobbed = true;
    (m.payload as any).fleeChance = 0;

    pirateRoundStep(ctx); // only 1 card to take
    expect(handSize(a)).toBe(0);
    expect(a.stats.piratesRobbedCards).toBe(1);

    (m.payload as any).fleeChance = 0;
    pirateRoundStep(ctx); // nothing left: no crash, nothing taken
    expect(handSize(a)).toBe(0);
    expect(a.stats.piratesRobbedCards).toBe(1);
    expect(a.stats.piratesRobbedTimes).toBe(2);
  });

  it('robs every player it touches, not just one', () => {
    const { g, reg, ctx } = makeGame(on, 822);
    const { seaId, vertexId } = coastSetup(g, reg, 'a');
    // Put Bob on another corner of the same sea tile that touches land.
    const other = verticesOfHex(g, reg, seaId).find(
      (v: number) => v !== vertexId && g.board.vertices[v].hexIds.length > 0 && !g.board.vertices[v].piece
    );
    if (other === undefined) return; // this seed has a single land corner on that tile
    g.board.vertices[other].piece = { type: SETTLEMENT, owner: 'b' };
    g.players[0].resources = { wood: 4, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    g.players[1].resources = { wood: 0, brick: 4, sheep: 0, wheat: 0, ore: 0 };

    spawnPirate(ctx, { hexId: seaId });
    const m = pirateAt(g, seaId)!;
    (m.payload as any).lastRobbed = true;
    (m.payload as any).fleeChance = 0;
    pirateRoundStep(ctx);
    expect(handSize(g.players[0])).toBe(2);
    expect(handSize(g.players[1])).toBe(2);
  });
});

describe('Tidebound T10d: flee mode and avoiding stronger players', () => {
  it('the flee chance rises after every rob, and more when the victim has nearly enough knights', () => {
    const { g, reg, ctx } = makeGame(on, 830);
    const { seaId } = coastSetup(g, reg);
    g.players[0].resources = { wood: 9, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    spawnPirate(ctx, { hexId: seaId });
    const m = pirateAt(g, seaId)!;

    (m.payload as any).lastRobbed = true;
    (m.payload as any).fleeChance = 0;
    pirateRoundStep(ctx);
    // No knights: only the base step.
    expect((m.payload as any).fleeChance).toBeCloseTo(PIRATE_FLEE_ROB_STEP, 5);

    // A victim with knights equal to the strength (1) adds the whole "close" step as well.
    g.players[0].stats.knightsPlayed = 1;
    (m.payload as any).lastRobbed = true;
    (m.payload as any).fleeChance = 0;
    pirateRoundStep(ctx);
    expect((m.payload as any).fleeChance).toBeCloseTo(PIRATE_FLEE_ROB_STEP + PIRATE_FLEE_CLOSE_STEP, 5);
  });

  it('a fleeing pirate runs away from the city it robbed and does not rob on the way', () => {
    const { g, reg, ctx } = makeGame(on, 831);
    const { seaId, vertexId } = coastSetup(g, reg);
    const a = g.players[0];
    a.resources = { wood: 5, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    spawnPirate(ctx, { hexId: seaId });
    const m = pirateAt(g, seaId)!;
    expect(hexVertexDistance(g, reg, seaId, vertexId)).toBe(0);

    // Just robbed, and the flee roll always succeeds.
    (m.payload as any).lastRobbed = true;
    (m.payload as any).lastVertex = vertexId;
    (m.payload as any).fleeChance = 1;
    pirateRoundStep(ctx);

    const now = Number(m.loc);
    expect(now).not.toBe(seaId);
    expect(isWreckSeaHex(reg, g.board.hexes[now])).toBe(true);
    expect(hexVertexDistance(g, reg, now, vertexId)).toBeGreaterThanOrEqual(1);
    expect(handSize(a)).toBe(5);

    // It keeps going (still no robbing) until it is far enough away, then roams again.
    for (let i = 0; i < 3 && (m.payload as any).mode === 'flee'; i++) {
      pirateRoundStep(ctx);
      expect(handSize(a)).toBe(5);
    }
    expect((m.payload as any).mode).toBe('roam');
  });

  it('does not spawn or step within 2 tiles of a city of a player with more knights than its strength', () => {
    const { g, reg, ctx } = makeGame(on, 832);
    const { vertexId } = coastSetup(g, reg);
    const a = g.players[0];
    a.resources = { wood: 6, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    const strength = pirateStrengthAt(g.round || 0);

    // Equal knights is not enough to scare it; more is.
    a.stats.knightsPlayed = strength;
    expect(guardedVertices(g, strength)).toHaveLength(0);
    a.stats.knightsPlayed = strength + 1;
    expect(guardedVertices(g, strength)).toContain(vertexId);

    const cands = pirateSpawnCandidates(g, reg);
    expect(cands.length).toBeGreaterThan(0);
    for (const id of cands) {
      expect(hexVertexDistance(g, reg, id, vertexId)).toBeGreaterThan(PIRATE_AVOID_RADIUS);
    }

    // A pirate on the edge of the guarded zone never steps into it.
    const edgeHex = g.board.hexes.find(
      (h: any) => isWreckSeaHex(reg, h) && hexVertexDistance(g, reg, h.id, vertexId) === PIRATE_AVOID_RADIUS + 1
    );
    expect(edgeHex).toBeDefined();
    spawnPirate(ctx, { hexId: edgeHex!.id });
    const guarded = guardedVertices(g, strength);
    for (let i = 0; i < 25; i++) {
      pirateRoundStep(ctx);
      const loc = Number(activePirates(g)[0].loc);
      expect(isWreckSeaHex(reg, g.board.hexes[loc])).toBe(true);
      expect(isGuardedHex(g, reg, loc, guarded)).toBe(false);
    }
    expect(handSize(a)).toBe(6);
  });
});

describe('Tidebound T10: public view and minimal bot goal', () => {
  it('the client view is public: tile, strength and mode, nothing hidden', () => {
    const { g, reg, ctx } = makeGame(on);
    const [hexId] = farSeaHexIds(g, reg, 4);
    expect(pirateClientView(g, reg)).toBeNull();
    spawnPirate(ctx, { hexId });
    const view = pirateClientView(g, reg)!;
    expect(view).toHaveLength(1);
    expect(view[0]).toMatchObject({ hexId, strength: 1, mode: 'roam' });
    expect(Object.keys(view[0]).sort()).toEqual(['hexId', 'id', 'mode', 'strength']);
  });

  it('a bot with the knights and a piece on the tile drives the pirate off; otherwise it has no goal', () => {
    const { g, reg, ctx } = makeGame(on, 840);
    const { seaId } = coastSetup(g, reg);
    spawnPirate(ctx, { hexId: seaId });

    expect(pirateBotGoal.goals!(ctx, 'a')).toEqual([]);
    expect(pirateBotGoal.actionScore!(ctx, 'a', { type: DRIVE_OFF_PIRATE, payload: { hexId: seaId } })).toBe(0);

    g.players[0].stats.knightsPlayed = 1;
    const goals = pirateBotGoal.goals!(ctx, 'a');
    expect(goals).toHaveLength(1);
    expect(goals[0].action).toEqual({ type: DRIVE_OFF_PIRATE, payload: { hexId: seaId } });
    expect(pirateBotGoal.actionScore!(ctx, 'a', { type: DRIVE_OFF_PIRATE, payload: { hexId: seaId } })).toBeGreaterThan(0);

    // Bob has nothing near it.
    g.players[1].stats.knightsPlayed = 5;
    expect(pirateBotGoal.goals!(ctx, 'b')).toEqual([]);
  });
});
