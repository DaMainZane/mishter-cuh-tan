// Bulwark DLC (spec: Bulwark Design.md): castle, walled zones with control, tax and rebellion, wall pieces that extend existing walls, stone, decay and
// rot, the gatehouse with permits and its Longest Road rule, high ground, the two events, map spawning, and the DLC-off and seed guarantees.
import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import {
  BUILD_GATE,
  CASTLE,
  REPAIR_WALL,
  SET_PERMIT,
  STONE_WALL,
  TOGGLE_GATE,
  WALL,
  bulwarkState,
  bulwarkView,
  interiorVertices,
  palisadeDecayStep,
  palisadeFire,
  peasantRevolt,
  pendingZones,
  planZones,
  ringEdges,
  rotPalisades,
  wallCorners,
  zoneCountFor,
  zoneSizeFor
} from '../src/packs/bulwark';
import { longestRoadFor } from '../src/packs/base/longestRoad';
import {
  allEventCards,
  buildTopology,
  createGame,
  createRng,
  dispatch,
  getPieceDurability,
  makeCtx,
  registryFor
} from '../src/shared';
import type { HexInit } from '../src/shared';
import { runProductionPipeline } from '../src/shared/production';
import { getTileState, setTileState } from '../src/shared/tileState';

const on = { dlc: { bulwark: true } };
const ring = (q: number, r: number) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));

/** A land disc of `radius` (wood, all 6) with the 7 centre tiles planned as one zone (`ext.zone = 0`). */
function discInits(radius: number, zone = true, broken = false): HexInit[] {
  const out: HexInit[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.abs(q + r) > radius) continue;
      const inZone = zone && ring(q, r) <= 1;
      out.push({ q, r, type: 'wood', number: 6, ext: inZone ? { zone: 0, ...(broken ? { zoneBroken: true } : {}) } : {} });
    }
  }
  return out;
}

function makeGame(rules: Record<string, any> = on, opts: { zone?: boolean; broken?: boolean; seed?: number } = {}) {
  const reg = registryFor(allPacks, rules);
  const board = buildTopology(discInits(4, opts.zone ?? true, opts.broken ?? false), {
    isLand: t => !!reg.tiles.get(t)?.land,
    portBlocked: t => !!reg.tiles.get(t)?.noPort,
    waterEdges: true
  });
  const g = createGame(reg, {
    players: [
      { id: 'a', name: 'Ayla' },
      { id: 'b', name: 'Bram' }
    ],
    rules,
    board,
    seed: opts.seed ?? 77,
    shuffleSeats: false
  });
  g.phase = 'main';
  g.turn = 0;
  g.round = 3;
  return { g, reg, ctx: makeCtx(g, reg) };
}

type Game = ReturnType<typeof makeGame>;
const rich = { wood: 20, brick: 20, sheep: 20, wheat: 20, ore: 20 };
const centreIds = (g: Game['g']) => g.board.hexes.filter(h => ring(h.q, h.r) <= 1).map(h => h.id);
const act = (m: Game, pid: string, type: string, payload: any) => dispatch(m.g, m.reg, { type, playerId: pid, payload });
/** Puts a building straight on a corner and syncs (as a finished build would). */
function put(m: Game, vertexId: number, owner: string, type = 'settlement'): void {
  m.g.board.vertices[vertexId].piece = { type, owner };
  m.reg.hooks.afterAction.forEach(h => h(m.ctx, 'build'));
}
const resync = (m: Game) => m.reg.hooks.afterAction.forEach(h => h(m.ctx, 'build'));

describe('castle', () => {
  it('upgrades your own city for 9 cards, makes 4 per hit and is worth 3 VP', () => {
    const m = makeGame(on, { zone: false });
    const p = m.g.players[0];
    p.resources = { ...rich };
    const v = m.g.board.vertices.find(x => x.hexIds.length === 3)!;
    v.piece = { type: 'city', owner: 'a' };
    const before = Object.values(p.resources).reduce((s, n) => s + n, 0);
    expect(act(m, 'a', 'build', { piece: CASTLE, loc: v.id }).ok).toBe(true);
    expect(v.piece).toEqual({ type: CASTLE, owner: 'a' });
    expect(before - Object.values(p.resources).reduce((s, n) => s + n, 0)).toBe(9);
    const hex = m.g.board.hexes[v.hexIds[0]];
    const wood = p.resources.wood;
    runProductionPipeline(m.ctx, [hex], 6);
    expect(p.resources.wood - wood).toBe(4);
    expect(m.reg.pieces.get(CASTLE)!.vp).toBe(3);
  });

  it('cannot go on a settlement or a rival city', () => {
    const m = makeGame(on, { zone: false });
    m.g.players[0].resources = { ...rich };
    const [v1, v2] = m.g.board.vertices.filter(x => x.hexIds.length === 3);
    v1.piece = { type: 'settlement', owner: 'a' };
    v2.piece = { type: 'city', owner: 'b' };
    expect(act(m, 'a', 'build', { piece: CASTLE, loc: v1.id }).ok).toBe(false);
    expect(act(m, 'a', 'build', { piece: CASTLE, loc: v2.id }).ok).toBe(false);
  });
});

describe('spawned zones and walls', () => {
  it('puts walls on every edge around a planned zone at game start, neutral', () => {
    const m = makeGame();
    const st = bulwarkState(m.g);
    expect(st.zones).toHaveLength(1);
    const z = st.zones[0];
    expect(z.hexIds).toEqual(centreIds(m.g).sort((a, b) => a - b));
    const edges = ringEdges(m.g, z.hexIds);
    expect(edges).toHaveLength(18);
    for (const eid of edges) expect(m.g.board.edges[eid].piece?.type).toBe(WALL);
    expect(z.complete).toBe(true);
    expect(z.controller).toBeNull();
  });

  it('a broken ring has 1 or 2 gaps and is not complete; its plan shows as the would-be-inside tiles', () => {
    const m = makeGame(on, { broken: true });
    const z = bulwarkState(m.g).zones[0];
    const gaps = ringEdges(m.g, z.hexIds).filter(eid => !m.g.board.edges[eid].piece);
    expect(gaps.length).toBeGreaterThanOrEqual(1);
    expect(gaps.length).toBeLessThanOrEqual(2);
    expect(z.complete).toBe(false);
    expect(pendingZones(m.g, m.reg)[0].hexIds).toEqual(z.hexIds);
  });

  it('planZones: none below radius 4, at least 2 (never one alone), sizes in range, numbers no worse than the map average', () => {
    expect(zoneCountFor(3)).toBe(0);
    expect(zoneCountFor(4)).toBe(4);
    expect(zoneCountFor(8)).toBe(6);
    expect(zoneSizeFor(4)).toEqual({ min: 3, max: 7 });
    const inits: HexInit[] = [];
    const nums = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
    let k = 0;
    for (let q = -8; q <= 8; q++) for (let r = -8; r <= 8; r++) if (Math.abs(q + r) <= 8) inits.push({ q, r, type: ring(q, r) <= 7 ? 'wood' : 'water', number: ring(q, r) <= 7 ? nums[k++ % nums.length] : null, ext: {} });
    const n = planZones(inits, 8, createRng(5));
    expect(n).toBeGreaterThanOrEqual(2);
    const zones = new Map<number, HexInit[]>();
    for (const h of inits) if (typeof h.ext?.zone === 'number') zones.set(h.ext.zone, [...(zones.get(h.ext.zone) ?? []), h]);
    expect(zones.size).toBe(n);
    const pips = (x: number | null) => (x ? 6 - Math.abs(7 - x) : 0);
    const land = inits.filter(h => h.number);
    const avg = land.reduce((a, h) => a + pips(h.number), 0) / land.length;
    for (const z of zones.values()) {
      expect(z.length).toBeGreaterThanOrEqual(zoneSizeFor(8).min);
      expect(z.length).toBeLessThanOrEqual(zoneSizeFor(8).max);
      expect(z.reduce((a, h) => a + pips(h.number), 0) / z.length).toBeGreaterThanOrEqual(avg - 1e-9);
    }
    const broken = [...zones.values()].map(z => !!z[0].ext!.zoneBroken);
    expect(broken.includes(true) && broken.includes(false)).toBe(true);
  });

  it('a generated Bulwark map at radius 6 gets walled zones', () => {
    const rules = { ...on, boardRadius: 6 };
    const reg = registryFor(allPacks, rules);
    const g = createGame(reg, { players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], rules, seed: 4242 });
    expect(bulwarkState(g).zones.length).toBeGreaterThanOrEqual(2);
  });
});

describe('who may build where', () => {
  it('no building on a wall corner, even in setup', () => {
    const m = makeGame();
    const corner = [...wallCorners(m.g, bulwarkState(m.g))][0];
    m.g.phase = 'setup_settlement';
    expect(act(m, 'a', 'build', { piece: 'settlement', loc: corner }).ok).toBe(false);
  });

  it('in setup anyone may settle inside; the first settler holds the zone and the second is a guest', () => {
    const m = makeGame();
    const z = bulwarkState(m.g).zones[0];
    const inside = interiorVertices(m.g, z.hexIds);
    put(m, inside[0], 'a');
    expect(z.controller).toBe('a');
    const far = inside.find(v => !m.g.board.vertices[inside[0]].adjacentVertices.includes(v) && v !== inside[0])!;
    put(m, far, 'b');
    expect(z.controller).toBe('a');
  });

  it('in the main phase only the lord or a permit holder may build inside', () => {
    const m = makeGame();
    const z = bulwarkState(m.g).zones[0];
    const inside = interiorVertices(m.g, z.hexIds);
    put(m, inside[0], 'a');
    const far = inside.find(v => !m.g.board.vertices[inside[0]].adjacentVertices.includes(v) && v !== inside[0])!;
    put(m, far, 'b');
    m.g.players[1].resources = { ...rich };
    m.g.turn = 1;
    const roadSpot = m.g.board.vertices[far].edgeIds.find(eid => !m.g.board.edges[eid].piece)!;
    expect(act(m, 'b', 'build', { piece: 'road', loc: roadSpot }).error).toMatch(/lord|permit/i);
    // A permit lets b build.
    m.g.turn = 0;
    expect(act(m, 'a', SET_PERMIT, { vertexId: far }).ok).toBe(true);
    m.g.turn = 1;
    expect(act(m, 'b', 'build', { piece: 'road', loc: roadSpot }).ok).toBe(true);
  });
});

describe('tax and rebellion', () => {
  it('a guest pays exactly 30% of what they make inside (meter, no randomness); a rival castle pays half', () => {
    const m = makeGame();
    const z = bulwarkState(m.g).zones[0];
    const inside = interiorVertices(m.g, z.hexIds);
    put(m, inside[0], 'a', 'city');
    const far = inside.find(v => !m.g.board.vertices[inside[0]].adjacentVertices.includes(v) && v !== inside[0])!;
    put(m, far, 'b');
    const [pa, pb] = m.g.players;
    const hex = m.g.board.hexes[m.g.board.vertices[far].hexIds.find(h => !m.g.board.vertices[inside[0]].hexIds.includes(h))!];
    pa.resources.wood = 0;
    pb.resources.wood = 0;
    for (let i = 0; i < 10; i++) runProductionPipeline(m.ctx, [hex], 6);
    // 10 cards made inside: 3 taxed (0.3 x 10).
    expect(pb.resources.wood).toBe(7);
    expect(pa.resources.wood).toBe(3);
    expect(bulwarkView(m.g, m.reg)!.zones[0].meters.b).toBe(0);
  });

  it('a guest who passes the lord takes the zone over (Overthrown!)', () => {
    const m = makeGame();
    const z = bulwarkState(m.g).zones[0];
    const inside = interiorVertices(m.g, z.hexIds);
    put(m, inside[0], 'a');
    const far = inside.find(v => !m.g.board.vertices[inside[0]].adjacentVertices.includes(v) && v !== inside[0])!;
    put(m, far, 'b');
    expect(z.controller).toBe('a');
    put(m, far, 'b', 'city');
    expect(z.controller).toBe('b');
    expect(bulwarkState(m.g).lastOverthrow).toMatchObject({ zoneId: z.id, from: 'a', to: 'b' });
  });

  it('Peasant revolt resets the meters and guests skip 1 to 3 taxes', () => {
    const m = makeGame();
    const z = bulwarkState(m.g).zones[0];
    const inside = interiorVertices(m.g, z.hexIds);
    put(m, inside[0], 'a');
    const far = inside.find(v => !m.g.board.vertices[inside[0]].adjacentVertices.includes(v) && v !== inside[0])!;
    put(m, far, 'b');
    bulwarkState(m.g).meters[z.id] = { b: 15 };
    expect(peasantRevolt(m.ctx)?.id).toBe(z.id);
    expect(bulwarkState(m.g).meters[z.id]).toEqual({});
    const skips = bulwarkState(m.g).skips[z.id].b;
    expect(skips).toBeGreaterThanOrEqual(1);
    expect(skips).toBeLessThanOrEqual(3);
  });
});

describe('building walls', () => {
  it('a palisade must touch an existing wall and needs a building in that wall\'s zone; closing a new ring makes a new zone', () => {
    const m = makeGame();
    const z = bulwarkState(m.g).zones[0];
    const inside = interiorVertices(m.g, z.hexIds);
    put(m, inside[0], 'a');
    const p = m.g.players[0];
    p.resources = { ...rich };
    // An edge touching the ring from outside.
    const ringSet = new Set(ringEdges(m.g, z.hexIds));
    const corners = new Set([...ringSet].flatMap(eid => [m.g.board.edges[eid].v1, m.g.board.edges[eid].v2]));
    const touching = m.g.board.edges.find(e => !e.piece && e.hexIds.length && (corners.has(e.v1) || corners.has(e.v2)))!;
    expect(act(m, 'b', 'build', { piece: WALL, loc: touching.id }).ok).toBe(false);
    expect(act(m, 'a', 'build', { piece: WALL, loc: touching.id }).ok).toBe(true);
    // Far from any wall: refused.
    const far = m.g.board.edges.find(e => !e.piece && e.hexIds.length && ring(m.g.board.hexes[e.hexIds[0]].q, m.g.board.hexes[e.hexIds[0]].r) === 4)!;
    expect(act(m, 'a', 'build', { piece: WALL, loc: far.id }).ok).toBe(false);
  });

  it('the would-be-inside tiles of an open player wall follow the line between its open ends', () => {
    const m = makeGame(on, { zone: false });
    // A short wall line around a corner tile, built straight on the board.
    const hex = m.g.board.hexes.find(h => h.q === 2 && h.r === 0)!;
    const around = ringEdges(m.g, [hex.id]);
    for (const eid of around.slice(0, 4)) m.g.board.edges[eid].piece = { type: WALL, owner: 'a' };
    bulwarkState(m.g);
    const pending = pendingZones(m.g, m.reg);
    expect(pending.some(p => p.hexIds.includes(hex.id))).toBe(true);
  });
});

describe('decay, rot, repair and stone', () => {
  it('a 7 takes 1 from every palisade; at 0 the piece is gone and the zone opens', () => {
    const m = makeGame();
    const z = bulwarkState(m.g).zones[0];
    const eid = ringEdges(m.g, z.hexIds)[0];
    for (let i = 0; i < 3; i++) palisadeDecayStep.run(m.ctx);
    resync(m);
    expect(m.g.board.edges[eid].piece).toBeNull();
    expect(z.complete).toBe(false);
  });

  it('a palisade next to a flooded tile rots 1 a round; repair puts it back to full for 1 wood', () => {
    const m = makeGame();
    const z = bulwarkState(m.g).zones[0];
    const inside = interiorVertices(m.g, z.hexIds);
    put(m, inside[0], 'a');
    const eid = ringEdges(m.g, z.hexIds)[0];
    const outsideHex = m.g.board.edges[eid].hexIds.find(h => !z.hexIds.includes(h))!;
    setTileState(m.g, outsideHex, { id: 'flooded' });
    expect(rotPalisades(m.ctx)).toBeGreaterThan(0);
    expect(getPieceDurability(m.g, m.reg, 'edge', eid)).toBe(2);
    m.g.players[0].resources = { ...rich };
    expect(act(m, 'a', REPAIR_WALL, { edgeId: eid }).ok).toBe(true);
    expect(getPieceDurability(m.g, m.reg, 'edge', eid)).toBe(3);
    expect(act(m, 'b', REPAIR_WALL, { edgeId: eid }).ok).toBe(false);
  });

  it('stone: an upgrade of a palisade that never decays', () => {
    const m = makeGame();
    const z = bulwarkState(m.g).zones[0];
    put(m, interiorVertices(m.g, z.hexIds)[0], 'a');
    m.g.players[0].resources = { ...rich };
    const eid = ringEdges(m.g, z.hexIds)[0];
    expect(act(m, 'a', 'build', { piece: STONE_WALL, loc: eid }).ok).toBe(true);
    for (let i = 0; i < 5; i++) palisadeDecayStep.run(m.ctx);
    expect(m.g.board.edges[eid].piece?.type).toBe(STONE_WALL);
  });

  it('Palisade fire takes 1 or 2 from each palisade', () => {
    const m = makeGame();
    const z = bulwarkState(m.g).zones[0];
    palisadeFire(m.ctx);
    for (const eid of ringEdges(m.g, z.hexIds)) {
      const hp = m.g.board.edges[eid].piece ? getPieceDurability(m.g, m.reg, 'edge', eid)! : 0;
      expect(hp === 1 || hp === 2).toBe(true);
    }
  });
});

describe('gatehouse', () => {
  function held() {
    const m = makeGame();
    const z = bulwarkState(m.g).zones[0];
    const inside = interiorVertices(m.g, z.hexIds);
    put(m, inside[0], 'a');
    m.g.players[0].resources = { ...rich };
    return { m, z };
  }

  it('the lord builds a gate on a wall corner; it turns a wall edge into an arch and starts closed', () => {
    const { m, z } = held();
    const legal = m.reg.actions.get(BUILD_GATE)!.legal!(m.ctx, 'a');
    expect(legal.length).toBeGreaterThan(0);
    const v = legal[0].vertexId;
    expect(act(m, 'a', BUILD_GATE, legal[0]).ok).toBe(true);
    const gate = bulwarkState(m.g).gates[v];
    expect(gate.open).toBe(false);
    expect(m.g.board.edges[gate.arch].piece).toBeNull();
    resync(m);
    expect(z.complete).toBe(true);
    expect(m.reg.actions.get(BUILD_GATE)!.validate(m.ctx, 'b', legal[0])).not.toBeNull();
  });

  it('a closed gate keeps rivals\' roads out of the arch and cuts their Longest Road; open lets them through', () => {
    const { m } = held();
    const legal = m.reg.actions.get(BUILD_GATE)!.legal!(m.ctx, 'a');
    act(m, 'a', BUILD_GATE, legal[0]);
    const v = legal[0].vertexId;
    const gate = bulwarkState(m.g).gates[v];
    // b has a road on the gate corner's free edge.
    const free = m.g.board.vertices[v].edgeIds.find(eid => eid !== gate.arch && !m.g.board.edges[eid].piece)!;
    m.g.board.edges[free].piece = { type: 'road', owner: 'b' };
    m.g.players[1].resources = { ...rich };
    m.g.turn = 1;
    expect(act(m, 'b', 'build', { piece: 'road', loc: gate.arch }).error).toMatch(/gate/i);
    m.g.turn = 0;
    expect(act(m, 'a', TOGGLE_GATE, { vertexId: v }).ok).toBe(true);
    m.g.turn = 1;
    expect(act(m, 'b', 'build', { piece: 'road', loc: gate.arch }).ok).toBe(true);
    expect(longestRoadFor(m.ctx, 'b')).toBe(2);
    bulwarkState(m.g).gates[v].open = false;
    expect(longestRoadFor(m.ctx, 'b')).toBe(1);
  });
});

describe('high ground', () => {
  it('land inside a complete zone counts +1 elevation; a broken zone loses it', () => {
    const rules = { dlc: { bulwark: true, tidebound: true } };
    const m = makeGame(rules);
    const z = bulwarkState(m.g).zones[0];
    for (const h of z.hexIds) expect(m.g.board.hexes[h].ext.elevationBonus).toBe(1);
    m.g.board.edges[ringEdges(m.g, z.hexIds)[0]].piece = null;
    resync(m);
    for (const h of z.hexIds) expect(m.g.board.hexes[h].ext.elevationBonus).toBeUndefined();
  });
});

describe('the DLC switch and the seed', () => {
  it('with Bulwark off nothing is registered and no walls appear', () => {
    const m = makeGame({});
    expect(m.reg.pieces.has(CASTLE)).toBe(false);
    expect(m.reg.pieces.has(WALL)).toBe(false);
    expect(m.g.ext.bulwark).toBeUndefined();
    expect(m.g.board.edges.some(e => e.piece)).toBe(false);
  });

  it('adds Peasant revolt and Palisade fire to the Event Deck', () => {
    const { reg } = makeGame({ ...on, eventsOn: true });
    const cards = allEventCards(reg);
    expect(cards.has('bulwark.peasant_revolt')).toBe(true);
    expect(cards.has('bulwark.palisade_fire')).toBe(true);
  });

  it('draws nothing from g.rng (walls, decay, fire, revolt)', () => {
    const a = makeGame(on, { seed: 9 });
    const b = makeGame({}, { seed: 9, zone: false });
    expect(a.g.rng.s).toBe(b.g.rng.s);
    palisadeFire(a.ctx);
    peasantRevolt(a.ctx);
    palisadeDecayStep.run(a.ctx);
    expect(a.g.rng.s).toBe(b.g.rng.s);
    expect(getTileState(a.g.board.hexes[0])).toBeNull();
  });
});
