// MODULE: seeded RNG (mulberry32), state is plain JSON | DEPENDS ON: none | USED BY: packs/tidebound/fishing, packs/tidebound/risingSea, shared/engine, shared/eventDeck, shared/index, shared/mapcheck, +11 more
export interface RngState { s: number }

function hashSeed(seed: number | string): number {
  if (typeof seed === 'number') return seed >>> 0;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed: number | string): RngState {
  return { s: hashSeed(seed) };
}

/** Float in [0, 1). Mutates the state. */
export function rngNext(r: RngState): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [0, max). */
export function rngInt(r: RngState, max: number): number {
  return Math.floor(rngNext(r) * max);
}

export function rngPick<T>(r: RngState, arr: T[]): T {
  return arr[rngInt(r, arr.length)];
}

export function rngShuffle<T>(r: RngState, arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rngInt(r, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const shuffle = rngShuffle;

/** Only for creating a new game outside the engine. The engine itself never calls Math.random. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 4294967296);
}
