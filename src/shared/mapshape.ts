// MODULE: land field for the shape stage (heightfield, cleanup, exact count fix, blob growth, retry loop) | DEPENDS ON: shared/mapcheck, shared/mapoptions, shared/maprecipe, shared/noise, shared/rng, shared/topology | USED BY: packs/base/map/shapes, packs/tidebound/risingSea, packs/tidebound/seaData, packs/tidebound/tides, shared/index, shared/mapcells, +2 more
import { BASELINE_SPOTS, estimateVertices } from './mapcheck';
import type { MapCtx, ShapeOpDef } from './mapoptions';
import { cellPoint } from './noise';
import type { NoiseFn } from './noise';
import { rngInt, rngNext } from './rng';
import type { RngState } from './rng';
import { MAX_CANVAS_RADIUS } from './maprecipe';
import { hexDistance } from './topology';

/** Neighbour directions in ring order (consecutive entries are neighbours of each other). */
export const HEX_DIRS: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

/** Every axial cell within `radius` of the center, in the order the board has always used. */
export function canvasCoords(radius: number): { q: number; r: number }[] {
  const coords: { q: number; r: number }[] = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) coords.push({ q, r });
  }
  return coords;
}

/** Shape attempts before the generator gives up and falls back to the plain hexagon (Map Generation Design, section 11). */
export const SHAPE_ATTEMPTS = 40;
/** Attempts spent hunting for a clean shape once one with notes (a short river, fewer islets) exists. */
export const SOFT_ATTEMPTS = 10;
/** Smallest land count a shaped map may have. */
export const MIN_LAND = 7;
/** Most extra sea width a wide-water perk may ask for, in tiles. */
export const SEA_EXTRA_MAX = 5;
/** Rings of sea a wide-water pick adds around the normal map per extra tile of water width (rounded up: 4 extra = 6 rings). A starting guess: tune it with the gallery. */
export const SEA_GROW_PER_EXTRA = 1.5;

/** Cells within `radius` of the center (the size of a canvas). */
export function cellsWithin(radius: number): number {
  return 3 * radius * (radius + 1) + 1;
}

/** The `water.extra` param as a whole number from 0 (no wide-water pick) to SEA_EXTRA_MAX. */
export function seaExtraOf(raw: unknown): number {
  return Math.max(0, Math.min(SEA_EXTRA_MAX, Math.floor(Number(raw) || 0)));
}

/** Rings of sea a wide-water pick adds around the normal map. 0 without the pick. */
export function seaGrow(extra: number): number {
  return extra > 0 ? Math.ceil(extra * SEA_GROW_PER_EXTRA) : 0;
}

/**
 * The canvas radius for a normal map of `radius` and a wide-water extra: the normal map plus the sea rings, never above MAX_CANVAS_RADIUS.
 * Tidebound's map is bigger than the base one by design; the land count still comes from `radius`, so the extra room is all sea.
 */
export function canvasRadiusFor(radius: number, extra: number): number {
  return Math.min(MAX_CANVAS_RADIUS, radius + seaGrow(extra));
}

/**
 * The canvas while the shape stage works on it. Cells are indexed in canvas order (the same order the
 * board uses), so index i here is index i of the canvas everywhere else.
 */
export interface LandField {
  /** Radius of the canvas. */
  radius: number;
  /**
   * Radius of the normal map the land is sized for. Equal to `radius`, except while a wide-water pick grows the canvas around it.
   * Everything that scales with the amount of land (land share, island count, river length, noise size) reads this, not `radius`.
   */
  baseRadius: number;
  size: number;
  q: number[];
  r: number[];
  /** Six neighbours per cell in HEX_DIRS order, -1 outside the canvas. */
  nb: number[][];
  /** Hex distance from the center cell. */
  dist: number[];
  /** Cell index of an axial coordinate, -1 outside the canvas. */
  at(q: number, r: number): number;
  noise: NoiseFn;
  rng: RngState;
  /** Ranking value, higher = more landlike. Filled by `fillHeight`. */
  h: number[];
  land: Uint8Array;
  /** Never land (lake, lagoon, river). */
  locked: Uint8Array;
  /** Never removed by cleanup (the shore of a lake). */
  keep: Uint8Array;
  /** Water that was carved as a river (no ports on its banks). */
  river: Uint8Array;
  /** Land that was scattered as a satellite islet (not part of the main landmass checks). */
  sat: Uint8Array;
  /** Final land count the shape promises. */
  L: number;
  /** Land count after cleanup, before scatter ops add their cells. */
  target: number;
  /** Land count the base op builds (target plus what carve ops will remove). */
  baseTarget: number;
  /** One main landmass. */
  single: boolean;
  /** Run cleanup (hole fill, spike removal, exact count fix) after base and carve. */
  cleanup: boolean;
  /** Remove land cells with at most one land neighbour. */
  spikes: boolean;
  /** Ruggedness 0..1, set by tweak ops and read by `fillHeight`. */
  ragged: number;
  /** Smallest allowed size of a main landmass. */
  minSize: number;
  lakes: number;
  /**
   * Extra sea width, in tiles, that a wide-water perk asked for (0 = none, the normal map). `tryShape` reads it from the `water.extra` param
   * before any op runs. Ops widen the water between landmasses and along a river with it, and the land share shrinks to make room.
   */
  seaExtra: number;
  /** Set by an op that cannot finish; the attempt is dropped. */
  failed: string | null;
  /**
   * Plain-words remarks about what an op could only do in part (a river that ran out of room, fewer islets than asked).
   * An attempt with notes still counts, but `runShape` first looks for a clean one.
   */
  notes: string[];
}

export function createLandField(radius: number, noise: NoiseFn, rng: RngState, baseRadius: number = radius): LandField {
  const cells = canvasCoords(radius);
  const size = cells.length;
  const side = 2 * radius + 1;
  const slot = new Int32Array(side * side).fill(-1);
  const key = (q: number, r: number) => (q + radius) * side + (r + radius);
  cells.forEach((c, i) => { slot[key(c.q, c.r)] = i; });
  const at = (q: number, r: number): number => {
    if (q < -radius || q > radius || r < -radius || r > radius) return -1;
    return slot[key(q, r)];
  };
  const nb = cells.map(c => HEX_DIRS.map(([dq, dr]) => at(c.q + dq, c.r + dr)));
  return {
    radius,
    baseRadius,
    size,
    q: cells.map(c => c.q),
    r: cells.map(c => c.r),
    nb,
    dist: cells.map(c => hexDistance(c, { q: 0, r: 0 })),
    at,
    noise,
    rng,
    h: new Array(size).fill(0),
    land: new Uint8Array(size),
    locked: new Uint8Array(size),
    keep: new Uint8Array(size),
    river: new Uint8Array(size),
    sat: new Uint8Array(size),
    L: size,
    target: size,
    baseTarget: size,
    single: true,
    cleanup: false,
    spikes: true,
    ragged: 0,
    minSize: 1,
    lakes: 0,
    seaExtra: 0,
    failed: null,
    notes: []
  };
}

// ---- Small queries ---------------------------------------------------------------------------------------------

export function landCount(f: LandField): number {
  let n = 0;
  for (let i = 0; i < f.size; i++) if (f.land[i]) n++;
  return n;
}

export function landNeighbours(f: LandField, i: number): number {
  let n = 0;
  for (const j of f.nb[i]) if (j >= 0 && f.land[j]) n++;
  return n;
}

/** A land cell next to water or the canvas edge. */
export function isCoastal(f: LandField, i: number): boolean {
  for (const j of f.nb[i]) if (j < 0 || !f.land[j]) return true;
  return false;
}

/**
 * True when the land neighbours of a cell form one unbroken arc around it. Removing such a cell can never split
 * its landmass, and the test only looks at six neighbours.
 */
export function isArc(f: LandField, i: number): boolean {
  const nb = f.nb[i];
  let arcs = 0;
  for (let k = 0; k < 6; k++) {
    const a = nb[k] >= 0 && f.land[nb[k]] === 1;
    const b = nb[(k + 1) % 6] >= 0 && f.land[nb[(k + 1) % 6]] === 1;
    if (a && !b) arcs++;
  }
  return arcs <= 1;
}

/** Number of water neighbours inside the canvas (the canvas edge does not count). */
export function waterNeighbours(f: LandField, i: number): number {
  let n = 0;
  for (const j of f.nb[i]) if (j >= 0 && !f.land[j]) n++;
  return n;
}

/** Landmasses as lists of cells, in discovery order. */
export function components(f: LandField): number[][] {
  const seen = new Uint8Array(f.size);
  const out: number[][] = [];
  for (let s = 0; s < f.size; s++) {
    if (!f.land[s] || seen[s]) continue;
    const comp = [s];
    seen[s] = 1;
    for (let k = 0; k < comp.length; k++) {
      for (const j of f.nb[comp[k]]) {
        if (j < 0 || !f.land[j] || seen[j]) continue;
        seen[j] = 1;
        comp.push(j);
      }
    }
    out.push(comp);
  }
  return out;
}

/** Steps from each land cell to the nearest water. The canvas edge counts as water. Water cells are 0. */
export function oceanDistance(f: LandField): Int32Array {
  const d = new Int32Array(f.size).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < f.size; i++) if (!f.land[i]) { d[i] = 0; queue.push(i); }
  for (let i = 0; i < f.size; i++) {
    if (d[i] === 0 || !f.nb[i].some(j => j < 0)) continue;
    d[i] = 1;
    queue.push(i);
  }
  for (let k = 0; k < queue.length; k++) {
    const c = queue[k];
    for (const j of f.nb[c]) {
      if (j < 0 || d[j] >= 0) continue;
      d[j] = d[c] + 1;
      queue.push(j);
    }
  }
  return d;
}

/** Hex distance between two cells. */
export function cellDistance(f: LandField, a: number, b: number): number {
  return hexDistance({ q: f.q[a], r: f.r[a] }, { q: f.q[b], r: f.r[b] });
}

// ---- Wide water (the Tidebound perk). Every helper here does nothing while `f.seaExtra` is 0. -----------------------

/**
 * Rough hex-packing estimate of the widest water gap that `k` landmasses holding `land` tiles in all can keep on this canvas
 * (round blobs, centres spread evenly, 20% safety margin). It only stops a wide-water pick from asking for what cannot fit.
 */
export function gapRoom(f: LandField, k: number, land: number): number {
  if (k < 2) return f.radius;
  const free = f.radius - 1 - Math.sqrt(land / 3);
  return Math.max(0, Math.floor((1.6 * free) / Math.sqrt(k)));
}

/**
 * The landmass count and water gap a base op should use: its own gap plus the wide-water extra, kept within what the canvas can hold.
 * Landmasses are dropped one at a time (down to `minK`) before the gap gives way. Without a wide-water pick the input comes back unchanged.
 */
export function wideGap(f: LandField, baseGap: number, k: number, land: number, minK: number): { k: number; gap: number } {
  if (f.seaExtra <= 0) return { k, gap: baseGap };
  const want = baseGap + f.seaExtra;
  let n = k;
  while (n > minK && gapRoom(f, n, land) < want) n--;
  return { k: n, gap: Math.max(baseGap, Math.min(want, gapRoom(f, n, land))) };
}

/** True when two of the centres are too close to keep `gap` tiles of water between the landmasses grown from them. */
export function centersTooClose(f: LandField, centers: number[], gap: number): boolean {
  for (let a = 0; a < centers.length; a++) {
    for (let b = a + 1; b < centers.length; b++) {
      if (cellDistance(f, centers[a], centers[b]) < gap + 2) return true;
    }
  }
  return false;
}

// ---- Heightfield ------------------------------------------------------------------------------------------------

export interface HeightOpts {
  /** Noise lattice units per cell. */
  freq: number;
  /** Noise strength. */
  amp: number;
  /** Pull toward the center (0 = none). */
  pull: number;
  /** Penalty on the outer rings, so land only reaches the canvas edge when it must (default 0.8). */
  rim?: number;
  ox?: number;
  oy?: number;
  octaves?: number;
}

/** `h = noise + pull toward the center - rim penalty`. The ragged tweak raises frequency and strength. */
export function fillHeight(f: LandField, o: HeightOpts): void {
  const rug = f.ragged;
  const freq = o.freq * (1 + rug);
  const amp = o.amp * (1 + 1.5 * rug);
  const pull = o.pull * (1 - 0.35 * rug);
  const rim = o.rim ?? 0.8;
  for (let i = 0; i < f.size; i++) {
    const p = cellPoint(f.q[i], f.r[i]);
    const n = f.noise(p.x * freq + (o.ox ?? 0), p.y * freq + (o.oy ?? 0), o.octaves ?? 3);
    const fall = 1 - f.dist[i] / f.baseRadius;
    let pen = 0;
    if (f.radius >= 3) {
      if (f.dist[i] === f.radius) pen = rim;
      else if (f.dist[i] === f.radius - 1) pen = rim / 2;
    } else if (f.radius === 2 && f.dist[i] === 2) pen = rim / 2;
    f.h[i] = (n - 0.5) * amp + pull * fall - pen;
  }
}

/** Cells sorted by height, best first. Ties break on the cell index (never on engine sort order). */
export function ranked(f: LandField, ids: number[]): number[] {
  return [...ids].sort((a, b) => f.h[b] - f.h[a] || a - b);
}

/** Land = the `count` best cells that are not locked. */
export function takeTop(f: LandField, count: number): void {
  const ids: number[] = [];
  for (let i = 0; i < f.size; i++) if (!f.locked[i]) ids.push(i);
  f.land.fill(0);
  for (const i of ranked(f, ids).slice(0, Math.max(0, count))) f.land[i] = 1;
}

/** Lowers the land promise when a base op cannot place that many cells (a ring needs room around its lagoon). */
export function limitLand(f: LandField, maxBase: number): void {
  if (f.baseTarget <= maxBase) return;
  const diff = f.baseTarget - maxBase;
  f.baseTarget -= diff;
  f.target = Math.max(1, f.target - diff);
  f.L = Math.max(1, f.L - diff);
}

// ---- Cleanup and exact count ---------------------------------------------------------------------------------------

function keepLargest(f: LandField): void {
  const comps = components(f);
  if (comps.length < 2) return;
  let best = 0;
  for (let k = 1; k < comps.length; k++) if (comps[k].length > comps[best].length) best = k;
  comps.forEach((c, k) => { if (k !== best) for (const i of c) f.land[i] = 0; });
}

/**
 * Brings the land count to `f.target` one cell at a time: add the best-ranked water cell next to land,
 * or remove the worst-ranked coastal cell whose land neighbours form one arc (so the land never splits).
 * Returns false when no cell can move.
 */
export function fixCount(f: LandField): boolean {
  let n = landCount(f);
  let guard = f.size * 2;
  while (n !== f.target && guard-- > 0) {
    let best = -1;
    if (n < f.target) {
      for (let i = 0; i < f.size; i++) {
        if (f.land[i] || f.locked[i] || landNeighbours(f, i) === 0) continue;
        if (best < 0 || f.h[i] > f.h[best]) best = i;
      }
      if (best < 0) return false;
      f.land[best] = 1;
      n++;
    } else {
      for (let i = 0; i < f.size; i++) {
        if (!f.land[i] || f.keep[i] || !isCoastal(f, i) || !isArc(f, i)) continue;
        if (best < 0 || f.h[i] < f.h[best]) best = i;
      }
      if (best < 0) return false;
      f.land[best] = 0;
      n--;
    }
  }
  return n === f.target;
}

/** Largest landmass only (single shapes), spikes off, one-cell holes filled, then the exact count. */
export function cleanupField(f: LandField): boolean {
  if (f.single) keepLargest(f);
  if (f.spikes && landCount(f) > 6) {
    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      for (let i = 0; i < f.size; i++) {
        if (f.land[i] && !f.keep[i] && landNeighbours(f, i) <= 1) { f.land[i] = 0; changed = true; }
      }
      if (!changed) break;
    }
  }
  for (let i = 0; i < f.size; i++) {
    if (f.land[i] || f.locked[i] || f.nb[i].some(j => j < 0)) continue;
    if (f.nb[i].every(j => f.land[j])) f.land[i] = 1;
  }
  if (f.single) keepLargest(f);
  return fixCount(f);
}

// ---- Blobs (islands and continents) -------------------------------------------------------------------------------

const AXES: [number, number][] = [
  [1, 0], [0.8660254037844386, 0.5], [0.5, 0.8660254037844386], [0, 1], [-0.5, 0.8660254037844386], [-0.8660254037844386, 0.5]
];

export interface BlobSpec {
  center: number;
  size: number;
  /** Axis ratio 1 = round, 2 = twice as long as wide. */
  stretch: number;
  /** Index 0..5 of the long axis. */
  axis: number;
  /** Strength of the bulge toward `lobeDir` (peninsulas). 0 = none. */
  lobe: number;
  lobeDir: number;
  /** Noise offset, so no two blobs share an outline. */
  ox: number;
  oy: number;
  /** Noise strength (default 1). */
  amp?: number;
}

/**
 * Picks `k` centers by best-candidate sampling: each new center is the best of a few random cells, measured by
 * its distance to the centers already chosen. Cells near the canvas edge are avoided.
 */
export function pickCenters(f: LandField, k: number, margin: number): number[] {
  const pool: number[] = [];
  for (let i = 0; i < f.size; i++) if (!f.locked[i] && f.dist[i] <= Math.max(1, f.radius - margin)) pool.push(i);
  if (pool.length === 0) return [];
  const out: number[] = [pool[rngInt(f.rng, pool.length)]];
  while (out.length < k) {
    let best = -1;
    let bestD = -1;
    for (let s = 0; s < 12; s++) {
      const c = pool[rngInt(f.rng, pool.length)];
      let d = 1e9;
      for (const o of out) d = Math.min(d, cellDistance(f, c, o));
      if (d > bestD || (d === bestD && c < best)) { bestD = d; best = c; }
    }
    out.push(best);
  }
  return out;
}

/**
 * Splits `total` cells over `k` blobs: each at least `min`, the rest by random weights, the biggest at least
 * `minLargest`. Returns null when that cannot be done.
 */
export function splitSizes(rng: RngState, total: number, k: number, min: number, minLargest: number): number[] | null {
  if (k < 1 || k * min > total) return null;
  const w: number[] = [];
  let sum = 0;
  for (let i = 0; i < k; i++) { const x = 0.4 + rngNext(rng); w.push(x); sum += x; }
  const rem = total - k * min;
  const sizes = w.map(x => min + Math.floor((rem * x) / sum));
  let left = total - sizes.reduce((a, b) => a + b, 0);
  const order = w.map((_, i) => i).sort((a, b) => w[b] - w[a] || a - b);
  for (let i = 0; left > 0; i = (i + 1) % k) { sizes[order[i]]++; left--; }
  let big = 0;
  for (let i = 1; i < k; i++) if (sizes[i] > sizes[big]) big = i;
  while (sizes[big] < minLargest) {
    let src = -1;
    for (let j = 0; j < k; j++) if (j !== big && sizes[j] > min && (src < 0 || sizes[j] > sizes[src])) src = j;
    if (src < 0) return null;
    sizes[src]--;
    sizes[big]++;
  }
  return sizes;
}

/**
 * Grows all blobs together, always the one that is furthest behind its target size. A cell may join a blob when no
 * other blob has land within `gap` of it. Each blob prefers cells near its center (stretched), cells where its own
 * noise is high, and cells with several neighbours already in the blob. Returns false when a blob gets stuck.
 */
export function growBlobs(f: LandField, specs: BlobSpec[], gap: number): boolean {
  const K = specs.length;
  if (K === 0) return false;
  const owner = new Int16Array(f.size).fill(-1);
  const count: number[] = specs.map(() => 0);
  const frontier: number[][] = specs.map(() => []);
  const queued = specs.map(() => new Uint8Array(f.size));
  const centers = specs.map(s => cellPoint(f.q[s.center], f.r[s.center]));
  const scale = specs.map(s => Math.sqrt(s.size) + 1);

  const offsets: [number, number][] = [];
  for (let dq = -gap; dq <= gap; dq++) {
    for (let dr = Math.max(-gap, -dq - gap); dr <= Math.min(gap, -dq + gap); dr++) offsets.push([dq, dr]);
  }
  const gapOk = (c: number, k: number): boolean => {
    for (const [dq, dr] of offsets) {
      const j = f.at(f.q[c] + dq, f.r[c] + dr);
      if (j >= 0 && owner[j] >= 0 && owner[j] !== k) return false;
    }
    return true;
  };
  const claim = (c: number, k: number) => {
    owner[c] = k;
    count[k]++;
    for (const n of f.nb[c]) {
      if (n >= 0 && owner[n] < 0 && !f.locked[n] && !queued[k][n]) { queued[k][n] = 1; frontier[k].push(n); }
    }
  };
  const score = (c: number, k: number): number => {
    const s = specs[k];
    const p = cellPoint(f.q[c], f.r[c]);
    const dx = p.x - centers[k].x;
    const dy = p.y - centers[k].y;
    const ax = AXES[s.axis % 6];
    const u = dx * ax[0] + dy * ax[1];
    const v = -dx * ax[1] + dy * ax[0];
    const root = Math.sqrt(Math.max(1, s.stretch));
    const d = Math.sqrt((u / root) * (u / root) + v * root * (v * root));
    const n = f.noise(p.x / (0.9 * scale[k]) + s.ox, p.y / (0.9 * scale[k]) + s.oy, 3);
    let val = (n - 0.5) * (s.amp ?? 1) - d / scale[k];
    let own = 0;
    for (const nn of f.nb[c]) if (nn >= 0 && owner[nn] === k) own++;
    val += 0.12 * (own - 1);
    if (s.lobe > 0 && d > 0) {
      const lx = AXES[s.lobeDir % 6];
      const dot = (dx * lx[0] + dy * lx[1]) / Math.sqrt(dx * dx + dy * dy);
      if (dot > 0) val += s.lobe * dot * (d / scale[k]) * 0.5;
    }
    return val;
  };

  for (let k = 0; k < K; k++) {
    const c = specs[k].center;
    if (owner[c] >= 0 || f.locked[c] || !gapOk(c, k)) return false;
    claim(c, k);
  }
  let remaining = specs.reduce((a, s) => a + s.size, 0) - K;
  while (remaining > 0) {
    let k = -1;
    let ratio = 1e9;
    for (let j = 0; j < K; j++) {
      if (count[j] >= specs[j].size) continue;
      const r = count[j] / specs[j].size;
      if (r < ratio) { ratio = r; k = j; }
    }
    if (k < 0) break;
    let placed = false;
    for (;;) {
      const live = frontier[k].filter(c => owner[c] < 0);
      frontier[k] = live;
      if (live.length === 0) return false;
      let bi = 0;
      let bv = -1e9;
      for (let x = 0; x < live.length; x++) {
        const v = score(live[x], k);
        if (v > bv || (v === bv && live[x] < live[bi])) { bv = v; bi = x; }
      }
      const c = live[bi];
      if (gapOk(c, k)) { claim(c, k); placed = true; break; }
      live.splice(bi, 1);
    }
    if (!placed) return false;
    remaining--;
  }
  f.land.fill(0);
  for (let i = 0; i < f.size; i++) if (owner[i] >= 0) f.land[i] = 1;
  return true;
}

// ---- The shape stage -----------------------------------------------------------------------------------------------

export interface ShapeInput {
  /** Radius of the canvas. */
  radius: number;
  /** Radius of the normal map whose land count the shape keeps (see `LandField.baseRadius`). Defaults to `radius`. */
  landRadius?: number;
  ops: ShapeOpDef[];
  /** Used when the picks leave no base op (for example `ragged` alone, because the default hexagon conflicts with it). */
  fallbackBase?: ShapeOpDef;
  /** The stage context of one attempt: its own RNG stream and noise, so retries are deterministic. */
  make(attempt: number): MapCtx;
}

export interface ShapeResult {
  /** Radius of the canvas every array here is indexed by. The plain-hexagon fallback uses the land radius, not a grown canvas. */
  radius: number;
  /** 1 = land, by canvas index. */
  land: Uint8Array;
  /** 1 = water carved as a river. */
  river: Uint8Array;
  /**
   * The height field by canvas index, for terrain styles that want it (`realistic`). Null when the shape never drew
   * one (hexagon, islands, archipelago, continents, the fallback): the terrain stage then uses its own noise.
   */
  h: number[] | null;
  attempts: number;
  /** The attempts all failed and the plain hexagon was used. */
  fallback: boolean;
  /** When `fallback` is set: the reasons most attempts failed on, most common first (for the lobby tag). */
  why?: string | null;
  /** What the chosen attempt could only do in part (see `LandField.notes`). */
  notes?: string[];
}

/** Cheap checks on a finished shape: landmasses, sizes and room for a table. Returns what is wrong, or null when it passes. */
function shapeProblem(f: LandField): string | null {
  if (f.failed) return f.failed;
  if (landCount(f) < 1) return 'no land';
  const main = components(f).filter(c => c.some(i => !f.sat[i]));
  if (main.length === 0) return 'no mainland';
  if (f.single && main.length !== 1) return 'land split in several pieces';
  for (const c of main) if (c.length < f.minSize) return 'a landmass is too small';
  let big = main[0];
  for (const c of main) if (c.length > big.length) big = c;
  let coast = 0;
  for (const i of big) for (const j of f.nb[i]) if (j < 0 || !f.land[j]) coast++;
  if (estimateVertices(big.length, coast, 1, f.lakes) < 3 * BASELINE_SPOTS) return 'no landmass can hold a table';
  return null;
}

/** Null when the attempt produced a usable shape, else the reason it did not. */
function tryShape(f: LandField, ctx: MapCtx, base: ShapeOpDef, tweaks: ShapeOpDef[], carves: ShapeOpDef[], scatters: ShapeOpDef[]): string | null {
  // A wide-water perk declares `water.extra`. With no such pick `ctx.param` gives 0 and nothing below changes.
  f.seaExtra = seaExtraOf(ctx.param('water.extra'));
  for (const t of tweaks) t.run?.(f, ctx);
  if (!base.run) {
    // The hexagon: the whole canvas is land. Carve ops (a lake) may still cut into it; the count is whatever is left.
    f.land.fill(1);
    f.L = f.size;
    f.target = f.size;
    f.baseTarget = f.size;
    f.single = true;
    f.cleanup = false;
    for (const c of carves) c.run?.(f, ctx);
    return shapeProblem(f);
  }

  const landDefault = base.params?.find(p => p.id === 'land')?.default ?? 70;
  const density = ctx.param('land') || landDefault;
  // The land share comes from the normal map (`baseRadius`), so wide water adds sea around the same land. Without the pick that is `f.size`.
  const landCells = Math.round((cellsWithin(f.baseRadius) * density) / 100);
  const L = Math.max(Math.min(MIN_LAND, f.size), Math.min(f.size, landCells));
  // Budgets read f.L, so it is set first.
  f.L = L;
  const carveCells = carves.reduce((a, c) => a + (c.budget?.(f, ctx) ?? 0), 0);
  const satCells = scatters.reduce((a, c) => a + (c.budget?.(f, ctx) ?? 0), 0);
  f.target = Math.max(1, L - satCells);
  f.baseTarget = Math.min(f.size, f.target + carveCells);
  base.run(f, ctx);
  if (f.failed) return f.failed;
  for (const c of carves) c.run?.(f, ctx);
  if (f.failed) return f.failed;
  if (f.cleanup && !cleanupField(f)) return 'cleanup could not reach the land count';
  for (const s of scatters) s.run?.(f, ctx);
  // A carve that finds no room (a river on a small island) leaves extra land, and a scatter may place fewer islets than asked.
  // Both are accepted and noted (`f.notes`): the land count is exact only for what was placed. `runShape` prefers a clean attempt,
  // but keeps one with notes over dropping the whole shape for the plain hexagon.
  return shapeProblem(f);
}

/**
 * Stage 3: decides which canvas cells are land. Ops run as tweak, base, carve, scatter. The loop retries with a
 * new RNG stream and noise (up to SHAPE_ATTEMPTS); when every attempt fails, the plain hexagon is used and the
 * caller reports it. Never throws.
 */
export function runShape(input: ShapeInput): ShapeResult {
  const base = input.ops.find(o => o.phase === 'base') ?? input.fallbackBase;
  const tweaks = input.ops.filter(o => o.phase === 'tweak');
  const carves = input.ops.filter(o => o.phase === 'carve');
  const scatters = input.ops.filter(o => o.phase === 'scatter');
  const why = new Map<string, number>();
  let soft: { f: LandField; attempt: number } | null = null;
  const finish = (f: LandField, attempts: number): ShapeResult => {
    // A shape that never called fillHeight leaves the field all zero: that means "no height", not "flat".
    const drawn = f.h.some(v => v !== 0);
    return { radius: input.radius, land: f.land, river: f.river, h: drawn ? f.h : null, attempts, fallback: false, why: null, notes: f.notes };
  };
  if (base) {
    for (let attempt = 0; attempt < SHAPE_ATTEMPTS; attempt++) {
      const ctx = input.make(attempt);
      const f = createLandField(input.radius, ctx.noise, ctx.rng, input.landRadius ?? input.radius);
      const problem = tryShape(f, ctx, base, tweaks, carves, scatters);
      if (problem !== null) {
        why.set(problem, (why.get(problem) ?? 0) + 1);
        continue;
      }
      if (f.notes.length === 0) return finish(f, attempt + 1);
      // Usable, but an op could only do part of its work: keep the first such shape and look a little longer for a clean one.
      if (!soft) soft = { f, attempt };
      if (attempt + 1 >= SOFT_ATTEMPTS) break;
    }
    if (soft) return finish(soft.f, soft.attempt + 1);
  }
  // A failed shape falls back to the plain hexagon of the normal map, not of the grown canvas.
  const fallbackRadius = input.landRadius ?? input.radius;
  const size = canvasCoords(fallbackRadius).length;
  const top = [...why.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 2)
    .map(([reason, n]) => `${reason} (${n}x)`)
    .join(', ');
  return { radius: fallbackRadius, land: new Uint8Array(size).fill(1), river: new Uint8Array(size), h: null, attempts: SHAPE_ATTEMPTS, fallback: !!base, why: top || null, notes: [] };
}
