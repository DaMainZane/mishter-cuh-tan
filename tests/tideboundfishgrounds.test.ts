import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import {
  FEED_SEA,
  FEED_SEA_COST,
  FISH,
  FISH_ICON_MULTIPLIER,
  NET_BOOSTED_CHANCE,
  NET_CATCH_CHANCE,
  feedSpotsView,
  feedableHexIds,
  fishBotGoal,
  fishClientView,
  fishLeft,
  netCatchOnRoll,
  netYield,
  netSeaHexIds,
  replenishFish,
  seaHexIdsAt,
  tideReachOnSea
} from '../src/packs/tidebound/fishing';
import { FISH_BOOSTS } from '../src/packs/tidebound/seaData';
import { buildTopology, createGame, dispatch, getWildTokens, legalActions, makeCtx, registryFor } from '../src/shared';

// T7c fish icon boosts, T7d tide replenish, T7e feed the sea.
//  - A sea tile with `ext.fish` boosts left doubles the catch chance of a net next to it; each fish caught that way uses up one boost.
//  - Tides refill icons slowly (a normal tide, a deeper spring tide), a hash of seed, round and tile, never `g.rng`.
//  - Feed the sea: 1 wheat sets a sea tile next to one of your nets back to full.

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

function makeGame(rules: Record<string, any> = on, seed = 99, landRadius = 0) {
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

/** A corner of the lone land tile: two sea tiles touch it. */
function cornerOf(m: M, index = 0): number {
  const centre = m.g.board.hexes.find(h => h.q === 0 && h.r === 0)!;
  return centre.vertexIds[index];
}

/** The six sea tiles around the lone land tile, ascending. */
function ringIds(m: M): number[] {
  const centre = m.g.board.hexes.find(h => h.q === 0 && h.r === 0)!;
  const ids = new Set<number>();
  for (const vId of centre.vertexIds) for (const id of seaHexIdsAt(m.g, m.reg, vId)) ids.add(id);
  return [...ids].sort((a, b) => a - b);
}

function setFish(m: M, id: number, n: number | undefined): void {
  const hex = m.g.board.hexes[id];
  if (!hex.ext) hex.ext = {};
  if (n === undefined) delete hex.ext.fish;
  else hex.ext.fish = n;
}

/** A net sits on one sea tile (`hex.ext.net`). It only pays the buildings at its corners, so a settlement of `owner` goes on a free corner of the tile when there is none yet. */
function putNet(m: M, hexId: number, owner = 'a'): void {
  m.g.board.hexes[hexId].ext.net = { owner };
  if (netYield(m.g, m.reg, hexId, owner) > 0) return;
  const corner = m.g.board.vertices.find(v => v.hexIds.length > 0 && !v.piece && seaHexIdsAt(m.g, m.reg, v.id).includes(hexId));
  if (corner) corner.piece = { type: 'settlement', owner };
}

/** One roll the way the roll action does it (it adds one to `diceStats` first). True when `owner` got a fish. */
function rollOnce(m: M, owner = 'a'): boolean {
  const before = getWildTokens(m.g, owner, FISH);
  m.g.diceStats[8] = (m.g.diceStats[8] || 0) + 1;
  netCatchOnRoll(m.ctx, 8);
  return getWildTokens(m.g, owner, FISH) > before;
}

/** Index (1-based) of the first roll that caught a fish, or 0 when none did within `max` rolls. */
function firstCatch(m: M, max: number): number {
  for (let i = 1; i <= max; i++) if (rollOnce(m)) return i;
  return 0;
}

/** Puts a hand-made tide state on the game: one cluster of the lone land tile. `phase` 0 floods the even rounds at Medium. */
function giveTides(m: M, phase = 0): void {
  const centre = m.g.board.hexes.find(h => h.q === 0 && h.r === 0)!;
  const ext = m.g.ext as any;
  ext.tidebound = { ...(ext.tidebound ?? {}), tides: { clusters: [{ id: 0, hexIds: [centre.id], inner: [], phase }] } };
}

describe('T7c fish icon boosts', () => {
  it('reads the boosts left on a tile: null without an icon, clamped to 0 to the maximum', () => {
    const m = makeGame();
    const [id] = ringIds(m);
    setFish(m, id, undefined);
    expect(fishLeft(m.g.board.hexes[id])).toBeNull();
    setFish(m, id, 0);
    expect(fishLeft(m.g.board.hexes[id])).toBe(0);
    setFish(m, id, 3);
    expect(fishLeft(m.g.board.hexes[id])).toBe(3);
    setFish(m, id, 99);
    expect(fishLeft(m.g.board.hexes[id])).toBe(FISH_BOOSTS);
    setFish(m, id, -2);
    expect(fishLeft(m.g.board.hexes[id])).toBe(0);
    expect(fishLeft(undefined)).toBeNull();
  });

  it('a boost doubles the catch chance (1 in 6 to 1 in 3)', () => {
    expect(FISH_ICON_MULTIPLIER).toBe(2);
    expect(NET_BOOSTED_CHANCE).toBeCloseTo(NET_CATCH_CHANCE * 2);
    expect(NET_BOOSTED_CHANCE).toBeCloseTo(1 / 3);
  });

  it('a net on a full icon catches earlier than the same net without one, on the same seed', () => {
    let earlier = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const bare = makeGame(on, seed);
      const boosted = makeGame(on, seed);
      const tile = seaHexIdsAt(bare.g, bare.reg, cornerOf(bare))[0];
      putNet(bare, tile);
      putNet(boosted, tile);
      setFish(boosted, tile, FISH_BOOSTS);
      const a = firstCatch(bare, 400);
      const b = firstCatch(boosted, 400);
      expect(a).toBeGreaterThan(0);
      expect(b).toBeGreaterThan(0);
      // The draw is the same number, so every roll that catches at 1 in 6 also catches at 1 in 3.
      expect(b).toBeLessThanOrEqual(a);
      if (b < a) earlier++;
    }
    expect(earlier).toBeGreaterThan(0);
  });

  it('each boosted catch uses up one boost of the tile under the net, and the icon stays at 0', () => {
    const m = makeGame();
    const v = cornerOf(m);
    const [lo, hi] = seaHexIdsAt(m.g, m.reg, v);
    putNet(m, lo);
    setFish(m, lo, FISH_BOOSTS);
    setFish(m, hi, undefined);
    for (let i = 0; i < 3000; i++) rollOnce(m);
    expect(fishLeft(m.g.board.hexes[lo])).toBe(0);
    expect(m.g.board.hexes[lo].ext.fish).toBe(0);
    // The tile that never had an icon never got one from catching.
    expect(fishLeft(m.g.board.hexes[hi])).toBeNull();
    expect(player(m.g, 'a').stats.fishCaught).toBe(getWildTokens(m.g, 'a', FISH));
    // 4 boosted catches, then 1 in 6 for the rest: far above what the 4 boosts alone give, and about 3000 / 6.
    expect(getWildTokens(m.g, 'a', FISH)).toBeGreaterThan(400);
    expect(getWildTokens(m.g, 'a', FISH)).toBeLessThan(600);
  });

  it('the first catch takes a boost from the tile under the net, and none from a richer neighbour', () => {
    const m = makeGame();
    const [lo, hi] = seaHexIdsAt(m.g, m.reg, cornerOf(m));
    putNet(m, lo);
    setFish(m, lo, 2);
    setFish(m, hi, 3);
    expect(firstCatch(m, 600)).toBeGreaterThan(0);
    expect(fishLeft(m.g.board.hexes[lo])).toBe(1);
    expect(fishLeft(m.g.board.hexes[hi])).toBe(3);
  });

  it('an icon that ran out (0) gives no boost, and never draws from `g.rng`', () => {
    const m = makeGame();
    const tile = seaHexIdsAt(m.g, m.reg, cornerOf(m))[0];
    putNet(m, tile);
    setFish(m, tile, 0);
    const bare = makeGame();
    putNet(bare, tile);
    const rngBefore = m.g.rng.s;
    expect(firstCatch(m, 600)).toBe(firstCatch(bare, 600));
    expect(m.g.rng.s).toBe(rngBefore);
  });
});

describe('T7d tide replenish', () => {
  it('the tide reaches the sea around a flooding cluster: depth 1 on a normal tide, 2 on a spring tide, none when dry', () => {
    const m = makeGame();
    giveTides(m);
    const ring = ringIds(m);
    expect(ring).toHaveLength(6);
    const normal = tideReachOnSea(m.g, m.reg, 2);
    expect([...normal.keys()].sort((a, b) => a - b)).toEqual(ring);
    for (const id of ring) expect(normal.get(id)).toBe(1);
    expect(tideReachOnSea(m.g, m.reg, 3).size).toBe(0);
    for (const id of ring) expect(tideReachOnSea(m.g, m.reg, 4).get(id)).toBe(2);
  });

  it('reaches nothing without a tide state', () => {
    const m = makeGame();
    delete (m.g.ext as any).tidebound?.tides;
    expect(tideReachOnSea(m.g, m.reg, 2).size).toBe(0);
    for (const id of ringIds(m)) setFish(m, id, 1);
    m.g.round = 2;
    expect(replenishFish(m.ctx)).toEqual([]);
  });

  it('refills slowly, and a spring tide refills faster than a normal one; a dry round refills nothing', () => {
    const m = makeGame();
    giveTides(m);
    const ring = ringIds(m);
    let normal = 0;
    let spring = 0;
    let dry = 0;
    for (let round = 2; round <= 401; round++) {
      for (const id of ring) setFish(m, id, 1);
      m.g.round = round;
      const grown = replenishFish(m.ctx);
      for (const id of grown) expect(fishLeft(m.g.board.hexes[id])).toBe(2);
      if (round % 2 === 1) dry += grown.length;
      else if (round % 4 === 0) spring += grown.length;
      else normal += grown.length;
    }
    expect(dry).toBe(0);
    // 100 normal rounds x 6 tiles x 0.2 = 120 (sd about 10); 100 spring rounds x 6 tiles x 0.45 = 270 (sd about 12).
    expect(normal).toBeGreaterThan(80);
    expect(normal).toBeLessThan(170);
    expect(spring).toBeGreaterThan(220);
    expect(spring).toBeLessThan(330);
  });

  it('never grows a full icon past the maximum, gives no icon to a tile without one, and refills a spent one', () => {
    const m = makeGame();
    giveTides(m);
    const ring = ringIds(m);
    setFish(m, ring[0], FISH_BOOSTS);
    setFish(m, ring[1], undefined);
    setFish(m, ring[2], 0);
    let spentGrew = false;
    for (let round = 2; round <= 201; round += 2) {
      m.g.round = round;
      replenishFish(m.ctx);
      if ((fishLeft(m.g.board.hexes[ring[2]]) ?? 0) > 0) spentGrew = true;
    }
    expect(fishLeft(m.g.board.hexes[ring[0]])).toBe(FISH_BOOSTS);
    expect(fishLeft(m.g.board.hexes[ring[1]])).toBeNull();
    expect(spentGrew).toBe(true);
  });

  it('is seeded: the same seed and round give the same tiles, and `g.rng` is not drawn from', () => {
    function run(seed: number) {
      const m = makeGame(on, seed);
      giveTides(m);
      const grown: number[][] = [];
      const rngBefore = m.g.rng.s;
      for (let round = 2; round <= 60; round++) {
        for (const id of ringIds(m)) setFish(m, id, 1);
        m.g.round = round;
        grown.push(replenishFish(m.ctx));
      }
      return { grown, untouched: m.g.rng.s === rngBefore };
    }
    const one = run(5);
    expect(run(5).grown).toEqual(one.grown);
    expect(one.untouched).toBe(true);
    expect(run(6).grown).not.toEqual(one.grown);
  });
});

describe('T7e feed the sea', () => {
  /** Player a has a net on the first of the two sea tiles at the corner (`sea[0]`; `sea[1]` has none), 1 wheat, and it is their main phase. */
  function ready(rules: Record<string, any> = on) {
    const m = makeGame(rules);
    const v = cornerOf(m);
    const sea = seaHexIdsAt(m.g, m.reg, v);
    putNet(m, sea[0]);
    player(m.g, 'a').resources.wheat = 1;
    return { ...m, v, sea, a: player(m.g, 'a') };
  }
  const feed = (m: ReturnType<typeof ready>, hexId: unknown, pid = 'a') => dispatch(m.g, m.reg, { type: FEED_SEA, playerId: pid, payload: { hexId } });

  it('costs 1 wheat and is registered only with Tidebound and Fishing on', () => {
    expect(FEED_SEA_COST).toEqual({ wheat: 1 });
    expect(makeGame(on).reg.actions.has(FEED_SEA)).toBe(true);
    for (const rules of [{}, { dlc: { tidebound: false } }, fishOff]) {
      const m = makeGame(rules);
      expect(m.reg.actions.has(FEED_SEA)).toBe(false);
      player(m.g, 'a').resources.wheat = 1;
      expect(dispatch(m.g, m.reg, { type: FEED_SEA, playerId: 'a', payload: { hexId: 0 } }).ok).toBe(false);
    }
  });

  it('lists the tile under your own net that is not full (no icon counts as empty), and never a neighbour', () => {
    const m = ready();
    expect(netSeaHexIds(m.g, m.reg, 'a')).toEqual([m.sea[0]]);
    expect(netSeaHexIds(m.g, m.reg, 'b')).toEqual([]);
    expect(feedableHexIds(m.g, m.reg, 'a')).toEqual([m.sea[0]]);
    setFish(m, m.sea[0], 0);
    expect(feedableHexIds(m.g, m.reg, 'a')).toEqual([m.sea[0]]);
    setFish(m, m.sea[0], FISH_BOOSTS);
    expect(feedableHexIds(m.g, m.reg, 'a')).toEqual([]);
  });

  it('leaves out a fogged sea tile', () => {
    const m = ready();
    m.g.board.hexes[m.sea[0]].ext.hidden = true;
    expect(netSeaHexIds(m.g, m.reg, 'a')).toEqual([]);
  });

  it('fills an empty ground, takes the wheat into the bank and counts the feed', () => {
    const m = ready();
    setFish(m, m.sea[0], 0);
    const bankWheat = m.g.bank.wheat;
    expect(feed(m, m.sea[0]).ok).toBe(true);
    expect(fishLeft(m.g.board.hexes[m.sea[0]])).toBe(FISH_BOOSTS);
    expect(m.a.resources.wheat).toBe(0);
    expect(m.g.bank.wheat).toBe(bankWheat + 1);
    expect(m.a.stats.seaFed).toBe(1);
  });

  it('gives a tile with no icon its first icon, and tops up a half-full one', () => {
    const m = ready();
    setFish(m, m.sea[0], undefined);
    expect(feed(m, m.sea[0]).ok).toBe(true);
    expect(fishLeft(m.g.board.hexes[m.sea[0]])).toBe(FISH_BOOSTS);

    m.a.resources.wheat = 1;
    setFish(m, m.sea[0], 1);
    expect(feed(m, m.sea[0]).ok).toBe(true);
    expect(fishLeft(m.g.board.hexes[m.sea[0]])).toBe(FISH_BOOSTS);
  });

  it('refuses without the wheat, on a full ground, away from your nets, on land, and a refusal changes nothing', () => {
    const m = ready();
    setFish(m, m.sea[0], 1);

    m.a.resources.wheat = 0;
    const poor = feed(m, m.sea[0]);
    expect(poor.ok).toBe(false);
    expect(poor.error).toContain('WHEAT');
    m.a.resources.wheat = 1;

    setFish(m, m.sea[0], FISH_BOOSTS);
    const full = feed(m, m.sea[0]);
    expect(full.ok).toBe(false);
    expect(full.error).toContain('full');
    setFish(m, m.sea[0], 1);

    // The neighbouring tile at the same corner has no net on it, and the net fishes only its own tile.
    const next = feed(m, m.sea[1]);
    expect(next.ok).toBe(false);
    expect(next.error).toContain('net');
    const far = ringIds(m).find(id => !m.sea.includes(id))!;
    expect(feed(m, far).ok).toBe(false);
    expect(feed(m, m.sea[0], 'b').ok).toBe(false);

    const land = m.g.board.hexes.find(h => h.q === 0 && h.r === 0)!;
    expect(feed(m, land.id).ok).toBe(false);
    expect(feed(m, 'x').ok).toBe(false);
    expect(feed(m, 1.5).ok).toBe(false);

    expect(m.a.resources.wheat).toBe(1);
    expect(fishLeft(m.g.board.hexes[m.sea[0]])).toBe(1);
    expect(feed(m, m.sea[0]).ok).toBe(true);
  });

  it('refuses a river channel and a fogged tile', () => {
    const m = ready();
    m.g.board.hexes[m.sea[0]].ext.river = true;
    expect(feed(m, m.sea[0]).ok).toBe(false);
    delete m.g.board.hexes[m.sea[0]].ext.river;
    m.g.board.hexes[m.sea[0]].ext.hidden = true;
    expect(feed(m, m.sea[0]).ok).toBe(false);
  });

  it('is a main-phase action only', () => {
    const m = ready();
    m.g.phase = 'roll';
    expect(feed(m, m.sea[0]).ok).toBe(false);
    m.g.phase = 'main';
    expect(feed(m, m.sea[0]).ok).toBe(true);
  });

  it('is in the legal action list for each ground you could feed, and only when you can pay', () => {
    const m = ready();
    const hexIds = () => legalActions(m.g, m.reg, 'a').filter(x => x.type === FEED_SEA).map(x => x.payload.hexId).sort((a: number, b: number) => a - b);
    expect(hexIds()).toEqual([m.sea[0]]);
    m.a.resources.wheat = 0;
    expect(hexIds()).toEqual([]);
  });

  it('draws nothing from `g.rng`', () => {
    const m = ready();
    const before = m.g.rng.s;
    expect(feed(m, m.sea[0]).ok).toBe(true);
    expect(m.g.rng.s).toBe(before);
  });
});

describe('what the client is sent', () => {
  it('fishClientView: boosts left by tile, public, without fogged tiles; null with no icon or with Fishing off', () => {
    const m = makeGame();
    const ring = ringIds(m);
    for (const id of ring) setFish(m, id, undefined);
    expect(fishClientView(m.g, m.reg)).toBeNull();
    setFish(m, ring[0], 3);
    setFish(m, ring[1], 0);
    setFish(m, ring[2], 2);
    m.g.board.hexes[ring[2]].ext.hidden = true;
    expect(fishClientView(m.g, m.reg)).toEqual({ [ring[0]]: 3, [ring[1]]: 0 });

    const off = makeGame(fishOff);
    for (const id of ringIds(off)) setFish(off, id, 2);
    expect(fishClientView(off.g, off.reg)).toBeNull();
  });

  it('feedSpotsView: undefined off your turn or outside the main phase, [] when you cannot pay or have no ground, the list otherwise', () => {
    const m = makeGame();
    const v = cornerOf(m);
    const sea = seaHexIdsAt(m.g, m.reg, v);
    putNet(m, sea[0]);
    const a = player(m.g, 'a');
    const b = player(m.g, 'b');

    a.resources.wheat = 0;
    expect(feedSpotsView(m.g, m.reg, a)).toEqual([]);
    a.resources.wheat = 1;
    expect(feedSpotsView(m.g, m.reg, a)).toEqual([sea[0]]);
    expect(feedSpotsView(m.g, m.reg, b)).toBeUndefined();

    m.g.phase = 'roll';
    expect(feedSpotsView(m.g, m.reg, a)).toBeUndefined();
    m.g.phase = 'main';

    for (const id of sea) setFish(m, id, FISH_BOOSTS);
    expect(feedSpotsView(m.g, m.reg, a)).toEqual([]);

    const off = makeGame(fishOff);
    expect(feedSpotsView(off.g, off.reg, player(off.g, 'a'))).toBeUndefined();
  });
});

describe('the bot', () => {
  function botReady(wheat: number, others: number) {
    const m = makeGame();
    const v = cornerOf(m);
    const sea = seaHexIdsAt(m.g, m.reg, v);
    putNet(m, sea[0]);
    const a = player(m.g, 'a');
    for (const r of Object.keys(a.resources)) a.resources[r] = 0;
    a.resources.wheat = wheat;
    a.resources.wood = others;
    const score = (hexId: unknown) => fishBotGoal.actionScore!(m.ctx, 'a', { type: FEED_SEA, payload: { hexId } });
    return { ...m, sea, score };
  }

  it('feeds an empty ground (12) or one with no icon (10) when it has a spare wheat and cards to keep', () => {
    const m = botReady(2, 3);
    setFish(m, m.sea[0], 0);
    setFish(m, m.sea[1], undefined);
    expect(m.score(m.sea[0])).toBe(12);
    expect(m.score(m.sea[1])).toBe(10);
  });

  it('never feeds a ground that still has boosts, without a spare wheat, or with too few cards left after paying', () => {
    const rich = botReady(2, 3);
    setFish(rich, rich.sea[0], 1);
    expect(rich.score(rich.sea[0])).toBe(0);

    const noSpare = botReady(1, 5);
    setFish(noSpare, noSpare.sea[0], 0);
    expect(noSpare.score(noSpare.sea[0])).toBe(0);

    const thin = botReady(2, 1);
    setFish(thin, thin.sea[0], 0);
    expect(thin.score(thin.sea[0])).toBe(0);

    const nonsense = botReady(2, 3);
    expect(nonsense.score('x')).toBe(0);
    expect(nonsense.score(9999)).toBe(0);
  });
});
