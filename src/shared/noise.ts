// MODULE: seeded lattice value noise (integer hash, only + - * / and floor, so a saved seed gives the same map on any engine) | DEPENDS ON: shared/rng | USED BY: packs/base/map/clusters, packs/tidebound/seaData, shared/index, shared/mapcells, shared/mapgen, shared/mapshape
import { createRng } from './rng';

const SQRT3_2 = 0.8660254037844386;

/** Integer hash of a lattice point, 0..1. */
function lattice(seed: number, x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** Polynomial smoothstep (no trig, no pow). */
const fade = (t: number) => t * t * (3 - 2 * t);

function valueNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const a = lattice(seed, x0, y0);
  const b = lattice(seed, x0 + 1, y0);
  const c = lattice(seed, x0, y0 + 1);
  const d = lattice(seed, x0 + 1, y0 + 1);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

/** x, y in lattice units; octaves default 3. Returns 0..1. */
export type NoiseFn = (x: number, y: number, octaves?: number) => number;

/** One noise field per seed. Each octave doubles the frequency and halves the weight. */
export function createNoise(seed: number | string): NoiseFn {
  const base = createRng(seed).s | 0;
  return (x, y, octaves = 3) => {
    const n = Math.max(1, Math.min(6, Math.floor(octaves)));
    let sum = 0;
    let weight = 1;
    let total = 0;
    let freq = 1;
    for (let o = 0; o < n; o++) {
      sum += weight * valueNoise((base + Math.imul(o, 0x9e3779b1)) | 0, x * freq, y * freq);
      total += weight;
      weight = weight / 2;
      freq = freq * 2;
    }
    return sum / total;
  };
}

/** Position of an axial cell on a flat plane (one hex = one lattice unit), for sampling noise. */
export function cellPoint(q: number, r: number): { x: number; y: number } {
  return { x: q + r * 0.5, y: r * SQRT3_2 };
}
