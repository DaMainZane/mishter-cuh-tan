// MODULE: Bulwark map spawn (plans walled zones while the map generates: count and size grow with the radius, never a lone zone, a mix of whole and broken rings, good numbers moved in when needed; then puts the walls up at game start, broken rings with 1 or 2 gaps) | DEPENDS ON: packs/bulwark/constants, packs/bulwark/zones, shared/index | USED BY: packs/bulwark/index, packs/bulwark/walls
import { createRng, rngInt, rngNext, rngShuffle } from '../../shared';
import type { Ctx, GameState, HexInit, RngState } from '../../shared';
import { NO_OWNER, STONE_WALL, WALL, WALL_MIN_RADIUS, ZONE_MIN_TILES } from './constants';
import { bulwarkState, ringEdges } from './zones';
import type { ZoneRec } from './zones';

const DIRS: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const GAP_SALT = 0x57414c4c; // 'WALL'

/** Zones on a map of this radius: none below 4, then 4, +1 for every 2 radius. */
export function zoneCountFor(radius: number): number {
  if (radius < WALL_MIN_RADIUS) return 0;
  return 4 + Math.floor((radius - WALL_MIN_RADIUS) / 2);
}

/** Smallest and biggest zone (land tiles) on a map of this radius: 3 to 7 at radius 4, growing with the radius. */
export function zoneSizeFor(radius: number): { min: number; max: number } {
  const r = Math.max(WALL_MIN_RADIUS, radius);
  return {
    min: Math.min(6, ZONE_MIN_TILES + Math.floor((r - WALL_MIN_RADIUS) / 4)),
    max: Math.min(14, 7 + Math.floor((r - WALL_MIN_RADIUS) / 2))
  };
}

/** Pips of a number token (6 and 8 are 5, 2 and 12 are 1). */
export function pipsOf(n: number | null | undefined): number {
  if (!n || n === 7) return 0;
  return 6 - Math.abs(7 - n);
}

const isLand = (h: HexInit | undefined) => !!h && h.type !== 'water';
const keyOf = (q: number, r: number) => `${q},${r}`;

/**
 * Plans the zones on the generated hexes (before topology): marks `ext.zone` (the zone's index) and `ext.zoneBroken` on the tiles inside. Rings sit
 * on land, never touch another ring, and keep a margin of outside land (2 tiles if the map allows, then 1, then none). Fewer than 2 that fit: none
 * at all (never a lone zone). Zones whose numbers are below the map's average get better tokens swapped in (never a 6 or 8 next to another).
 */
export function planZones(inits: HexInit[], radius: number, rng: RngState): number {
  const want = zoneCountFor(radius);
  if (want <= 0) return 0;
  const { min, max } = zoneSizeFor(radius);
  const at = new Map<string, HexInit>();
  for (const h of inits) at.set(keyOf(h.q, h.r), h);
  const nb = (h: HexInit) => DIRS.map(([dq, dr]) => at.get(keyOf(h.q + dq, h.r + dr)));
  const landAround = (h: HexInit, margin: number): boolean => {
    let ring = [h];
    const seen = new Set<HexInit>([h]);
    for (let d = 0; d < margin; d++) {
      const next: HexInit[] = [];
      for (const x of ring) {
        for (const y of nb(x)) {
          if (!y || !isLand(y)) return false;
          if (!seen.has(y)) {
            seen.add(y);
            next.push(y);
          }
        }
      }
      ring = next;
    }
    return true;
  };

  const zones: HexInit[][] = [];
  const taken = new Set<HexInit>();
  const blocked = (h: HexInit) => taken.has(h) || nb(h).some(y => !!y && taken.has(y));
  for (const margin of [2, 1, 0]) {
    if (zones.length >= want) break;
    // Wall corners need land on the far side too, so a tile on the very edge of the board never joins (margin 0 still needs a board neighbour).
    const ok = (h: HexInit) => isLand(h) && !blocked(h) && landAround(h, margin) && nb(h).every(y => !!y);
    const seeds = rngShuffle(rng, inits.filter(ok));
    for (const seed of seeds) {
      if (zones.length >= want) break;
      if (!ok(seed)) continue;
      const size = min + rngInt(rng, max - min + 1);
      const zone = [seed];
      const inZone = new Set<HexInit>(zone);
      while (zone.length < size) {
        const front: HexInit[] = [];
        for (const x of zone) for (const y of nb(x)) if (y && !inZone.has(y) && ok(y) && !front.includes(y)) front.push(y);
        if (!front.length) break;
        // Compact shapes: prefer tiles touching more of the zone.
        front.sort((a, b) => nb(b).filter(y => y && inZone.has(y)).length - nb(a).filter(y => y && inZone.has(y)).length);
        const top = front.filter(y => nb(y).filter(z => z && inZone.has(z)).length === nb(front[0]).filter(z => z && inZone.has(z)).length);
        const pick = top[rngInt(rng, top.length)];
        zone.push(pick);
        inZone.add(pick);
      }
      if (zone.length < min) continue;
      zones.push(zone);
      for (const x of zone) taken.add(x);
    }
  }
  if (zones.length < 2) return 0;

  // A mix of whole and broken rings: about 1 in 3 broken, at least one of each.
  const broken = zones.map(() => rngNext(rng) < 1 / 3);
  if (broken.every(b => b)) broken[0] = false;
  if (broken.every(b => !b)) broken[zones.length - 1] = true;
  zones.forEach((z, i) => {
    for (const h of z) h.ext = { ...(h.ext ?? {}), zone: i, ...(broken[i] ? { zoneBroken: true } : {}) };
  });

  improveNumbers(inits, zones, nb);
  return zones.length;
}

/** Swaps better number tokens into zones whose average is below the map's, keeping red numbers (6, 8) apart. */
function improveNumbers(inits: HexInit[], zones: HexInit[][], nb: (h: HexInit) => (HexInit | undefined)[]): void {
  const numbered = inits.filter(h => isLand(h) && h.number);
  if (!numbered.length) return;
  const avg = numbered.reduce((a, h) => a + pipsOf(h.number), 0) / numbered.length;
  const inAnyZone = new Set(zones.flat());
  const red = (n: number | null) => n === 6 || n === 8;
  const redOk = (h: HexInit, n: number | null) => !red(n) || !nb(h).some(y => !!y && red(y.number));
  for (const zone of zones) {
    for (let guard = 0; guard < 12; guard++) {
      const z = zone.filter(h => h.number);
      if (!z.length) break;
      const zAvg = z.reduce((a, h) => a + pipsOf(h.number), 0) / z.length;
      if (zAvg >= avg) break;
      const worst = z.reduce((a, h) => (pipsOf(h.number) < pipsOf(a.number) ? h : a));
      const outside = numbered
        .filter(h => !inAnyZone.has(h) && pipsOf(h.number) > pipsOf(worst.number))
        .sort((a, b) => pipsOf(b.number) - pipsOf(a.number));
      const swap = outside.find(o => {
        const a = worst.number;
        const b = o.number;
        worst.number = b;
        o.number = a;
        const fine = redOk(worst, worst.number) && redOk(o, o.number);
        worst.number = a;
        o.number = b;
        return fine;
      });
      if (!swap) break;
      const tmp = worst.number;
      worst.number = swap.number;
      swap.number = tmp;
    }
  }
}

/** The map hook: plans zones while the walls addon is on. Uses the map's own stream, never `g.rng`. */
export function zonesAfterMapGenerated(inits: HexInit[], rules: any, rng: RngState): void {
  planZones(inits, Number(rules?.boardRadius) || 0, rng);
}

/**
 * Game start: turns the planned tiles (`ext.zone`) into zone records and puts the walls up on their rings (neutral walls nobody owns). A broken ring
 * loses 1 or 2 of its wall pieces, picked from a stream of the world seed. Runs once (a game that already has zones is left alone).
 */
export function raiseSpawnedWalls(ctx: Ctx): void {
  const { g, reg } = ctx;
  const st = bulwarkState(g);
  if (st.zones.length || !reg.pieces.has(WALL)) return;
  const groups = new Map<number, number[]>();
  const brokenIdx = new Set<number>();
  for (const h of g.board.hexes) {
    const zi = h.ext?.zone;
    if (typeof zi !== 'number') continue;
    if (!groups.has(zi)) groups.set(zi, []);
    groups.get(zi)!.push(h.id);
    if (h.ext.zoneBroken) brokenIdx.add(zi);
  }
  const rng = createRng(((Number(g.seed) || 1) ^ GAP_SALT) >>> 0);
  for (const zi of [...groups.keys()].sort((a, b) => a - b)) {
    const hexIds = groups.get(zi)!.sort((a, b) => a - b);
    const z: ZoneRec = { id: st.nextId++, hexIds, spawned: true, complete: false, controller: null, closer: null };
    st.zones.push(z);
    const ring = ringEdges(g, hexIds);
    let gaps = new Set<number>();
    if (brokenIdx.has(zi) && ring.length > 4) {
      const n = 1 + rngInt(rng, 2);
      gaps = new Set(rngShuffle(rng, ring).slice(0, n));
    }
    for (const eid of ring) {
      st.wallZone[eid] = z.id;
      const e = g.board.edges[eid];
      if (gaps.has(eid) || e.piece) continue;
      // The map's rings are old stone when Stone walls is on: a palisade ring (18 pieces, 3 durability) would rot away within a few rounds of 7s,
      // so decay is a cost of the palisades players build, not of the map. Without the stone addon the rings are palisades.
      e.piece = { type: reg.pieces.has(STONE_WALL) ? STONE_WALL : WALL, owner: NO_OWNER };
    }
  }
}

/** Test helper: how many palisades are on the board (the map's own rings are stone when Stone walls is on). */
export function wallCount(g: GameState): number {
  return g.board.edges.filter(e => e.piece?.type === WALL).length;
}
