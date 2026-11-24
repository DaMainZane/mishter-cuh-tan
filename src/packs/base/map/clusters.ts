// MODULE: island clusters (the Tidebound default map shape: island sizes 4 to 20 drawn about 65% small, 25% medium, 10% large; islands grouped in clusters that merge when they meet; 1 or 2 tiles of water inside a cluster, at least 3 between clusters) | DEPENDS ON: shared/index, shared/mapshape, shared/noise | USED BY: packs/base/map/shapes
import { rngInt, rngNext } from '../../../shared';
import type { RngState } from '../../../shared';
import { cellDistance } from '../../../shared/mapshape';
import type { LandField } from '../../../shared/mapshape';
import { cellPoint } from '../../../shared/noise';

/** Smallest and biggest island. */
export const ISLAND_MIN = 4;
export const ISLAND_MAX = 20;
/** Island size bands and how often each is drawn (by count): mostly small, a few big. */
export const ISLAND_BANDS = [
  { min: 4, max: 7, share: 0.65 },
  { min: 8, max: 13, share: 0.25 },
  { min: 14, max: 20, share: 0.1 }
] as const;
/** Water tiles between two clusters, at least. Inside a cluster islands keep 1 or 2. */
export const CLUSTER_GAP = 3;
/** Islands per cluster before merging: a lone island now and then, otherwise 2 to this many. */
const CLUSTER_MAX_ISLANDS = 6;
const LONE_CHANCE = 0.15;
/** Cells a cluster's disc holds per land tile (the islands plus their 1 to 2 tile moats). */
const ROOM = 3.2;

function drawBandSize(rng: RngState): number {
  const x = rngNext(rng);
  let acc = 0;
  for (const b of ISLAND_BANDS) {
    acc += b.share;
    if (x < acc) return b.min + rngInt(rng, b.max - b.min + 1);
  }
  const last = ISLAND_BANDS[ISLAND_BANDS.length - 1];
  return last.min + rngInt(rng, last.max - last.min + 1);
}

/**
 * Island sizes that add up to `total` exactly, each 4 to 20, drawn from the bands. The last pieces are adjusted so nothing smaller than 4 is
 * left over. Null when there is less land than one island.
 */
export function clusterIslandSizes(rng: RngState, total: number): number[] | null {
  if (!(total >= ISLAND_MIN)) return null;
  const out: number[] = [];
  let left = Math.floor(total);
  while (left >= ISLAND_MIN) {
    let s = Math.min(drawBandSize(rng), left);
    const rest = left - s;
    if (rest > 0 && rest < ISLAND_MIN) s = left <= ISLAND_MAX ? left : left - ISLAND_MIN;
    out.push(s);
    left -= s;
  }
  return out;
}

/** Canvas cells per land tile the whole map needs (islands, moats, the 3-tile channels between clusters and some open sea). */
export const CLUSTER_SEA_FACTOR = 3.6;
/** Land share of the normal map (the shape's default `land` param, percent). */
export const CLUSTER_LAND_SHARE = 55;

/**
 * Canvas radius the island clusters need for a normal map of `radius`: big enough for the islands and their water, never smaller than the usual
 * wide-water canvas. Many small islands each with a moat need more sea than a few big ones, so the board grows with the radius.
 */
export function clusterCanvasRadius(radius: number, seaExtra: number): number {
  const land = ((3 * radius * (radius + 1) + 1) * CLUSTER_LAND_SHARE) / 100;
  const need = Math.ceil(Math.sqrt((CLUSTER_SEA_FACTOR * land) / 3)) + 1;
  return Math.max(radius + Math.ceil(seaExtra * 1.5), need);
}

/** Radius of the disc a cluster with `land` tiles is grown in. */
const discRadius = (land: number) => Math.max(1, Math.ceil(Math.sqrt((ROOM * land) / 3)));

/** Cells within `radius` of `center` (by neighbour steps), not locked. */
function discCells(f: LandField, center: number, radius: number): number[] {
  const seen = new Set<number>([center]);
  const out: number[] = [];
  let ring = [center];
  for (let d = 0; d <= radius && ring.length; d++) {
    const next: number[] = [];
    for (const c of ring) {
      if (!f.locked[c]) out.push(c);
      if (d === radius) continue;
      for (const n of f.nb[c]) if (n >= 0 && !seen.has(n)) { seen.add(n); next.push(n); }
    }
    ring = next;
  }
  return out;
}

/**
 * Plans the clusters and grows the islands on `f` (its `baseTarget` is the land count). Returns null on success, or why this attempt failed
 * (the generator then tries another attempt, up to its limit).
 */
export function growIslandClusters(f: LandField): string | null {
  const sizes = clusterIslandSizes(f.rng, f.baseTarget);
  if (!sizes) return 'island clusters: too little land';
  const n = sizes.length;

  // 1. Group islands into clusters.
  const groups: number[][] = [];
  for (let i = 0; i < n;) {
    const k = rngNext(f.rng) < LONE_CHANCE ? 1 : 2 + rngInt(f.rng, CLUSTER_MAX_ISLANDS - 1);
    const g: number[] = [];
    for (let j = i; j < Math.min(n, i + k); j++) g.push(j);
    groups.push(g);
    i += k;
  }

  // 2. A centre for each cluster. A cluster that lands on top of another (closer than both discs plus the 3-tile gap) merges into it.
  const discCenter = new Int32Array(n);
  const discR = new Int32Array(n);
  const merged = new Int32Array(n);
  const placed: { center: number; radius: number; id: number }[] = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const land = g.reduce((a, i) => a + sizes[i], 0);
    const R = discRadius(land);
    const pool: number[] = [];
    const reach = f.radius - R - 1 >= 1 ? f.radius - R - 1 : f.radius - 1;
    for (let c = 0; c < f.size; c++) if (!f.locked[c] && f.dist[c] <= reach) pool.push(c);
    if (pool.length === 0) return 'island clusters: no room';
    // Best of a few random cells, so clusters spread out a little but still land unevenly (some meet and merge, some sit alone).
    let best = pool[rngInt(f.rng, pool.length)];
    let bestScore = -Infinity;
    for (let s = 0; s < 3; s++) {
      const c = s === 0 ? best : pool[rngInt(f.rng, pool.length)];
      let score = Infinity;
      for (const o of placed) score = Math.min(score, cellDistance(f, c, o.center) - o.radius - R);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    let id = gi;
    for (const o of placed) if (cellDistance(f, best, o.center) < o.radius + R + CLUSTER_GAP) { id = o.id; break; }
    placed.push({ center: best, radius: R, id });
    for (const i of g) { discCenter[i] = best; discR[i] = R; merged[i] = id; }
  }

  // 3. Water between two islands: 1 or 2 tiles inside a (merged) cluster, the cluster gap otherwise. Drawn once, in a fixed order.
  const pair = new Int8Array(n * n);
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const g = merged[a] === merged[b] ? 1 + rngInt(f.rng, 2) : CLUSTER_GAP;
      pair[a * n + b] = g;
      pair[b * n + a] = g;
    }
  }
  const pairGap = (a: number, b: number) => pair[a * n + b];

  // 4. Grow the islands one at a time, biggest first. An island takes free cells only (cells that keep the right gap to every island already
  // grown); its centre is a free cell in its cluster's disc, and if it gets boxed in before reaching its size it is undone and tried elsewhere.
  const owner = new Int16Array(f.size).fill(-1);
  const MAXG = CLUSTER_GAP;
  const offsets: [number, number, number][] = [];
  for (let dq = -MAXG; dq <= MAXG; dq++) {
    for (let dr = Math.max(-MAXG, -dq - MAXG); dr <= Math.min(MAXG, -dq + MAXG); dr++) {
      const d = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
      if (d > 0) offsets.push([dq, dr, d]);
    }
  }
  const free = (c: number, i: number): boolean => {
    if (owner[c] >= 0 || f.locked[c]) return false;
    for (const [dq, dr, d] of offsets) {
      const j = f.at(f.q[c] + dq, f.r[c] + dr);
      if (j >= 0 && owner[j] >= 0 && owner[j] !== i && d <= pairGap(i, owner[j])) return false;
    }
    return true;
  };
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[b] - sizes[a] || a - b);
  for (const i of order) {
    const ox = 19.7 * (i + 1), oy = 47.3 * (i + 1);
    let done = false;
    // Start cells: free cells of the cluster's disc; when it is full, a wider disc (the island then sits at the cluster's edge), and as a last
    // resort any free cell on the board (it becomes a lone island, still 3 tiles from other clusters).
    for (let widen = 0; widen <= 4 && !done; widen++) {
      const starts = widen < 4
        ? discCells(f, discCenter[i], discR[i] + widen * 2).filter(c => free(c, i))
        : Array.from({ length: f.size }, (_, c) => c).filter(c => free(c, i));
      for (let tryNo = 0; tryNo < 12 && !done && starts.length > 0; tryNo++) {
      const start = starts[rngInt(f.rng, starts.length)];
      const mine: number[] = [start];
      owner[start] = i;
      const sp = cellPoint(f.q[start], f.r[start]);
      while (mine.length < sizes[i]) {
        let best = -1;
        let bestV = -Infinity;
        for (const c of mine) {
          for (const nn of f.nb[c]) {
            if (nn < 0 || owner[nn] >= 0 || !free(nn, i)) continue;
            const p = cellPoint(f.q[nn], f.r[nn]);
            let own = 0;
            for (const m of f.nb[nn]) if (m >= 0 && owner[m] === i) own++;
            const dist = Math.hypot(p.x - sp.x, p.y - sp.y);
            const v = f.noise(p.x / 2.5 + ox, p.y / 2.5 + oy, 3) - dist / (Math.sqrt(sizes[i]) + 1) + 0.15 * own;
            if (v > bestV || (v === bestV && nn < best)) { bestV = v; best = nn; }
          }
        }
        if (best < 0) break;
        owner[best] = i;
        mine.push(best);
      }
      if (mine.length === sizes[i]) done = true;
      else for (const c of mine) owner[c] = -1;
      }
    }
    if (!done) return 'island clusters: no room for an island';
  }
  f.land.fill(0);
  for (let c = 0; c < f.size; c++) if (owner[c] >= 0) f.land[c] = 1;
  return null;
}
