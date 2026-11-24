// MODULE: map recipe (seed + radius + picks + params), share code, per-stage RNG streams, GEN_VERSION | DEPENDS ON: shared/rng | USED BY: server/lobby, shared/index, shared/mapcheck, shared/mapgen, shared/mapshape
import { createRng, randomSeed } from './rng';
import type { RngState } from './rng';

/**
 * Bump on any change that alters the output for the same recipe (golden tests catch accidental ones).
 * A recipe carries the version it was made with; a mismatch means the seed may not give the same map.
 * 2: the board loop redraws tokens per attempt, the ring keeps a 2-tile band, the `island_mix` perk exists.
 * 3: ports per landmass are capped by land size (`portCap`), `noPort` tiles take or face none, and a board with more than 9 ports
 *    deals fresh shuffles of the pool instead of repeating one order.
 * 4: ports follow the real board's rule (a harbor on every second sea tile of the coast, 9 on the standard board in the real layout,
 *    3 (R + 1) on a hexagon of radius R) instead of an even spread by coast length at a random phase.
 * 5: on the plain hexagon each harbor takes the edge of its sea tile the real board uses (away from the corner tile next to it), so the
 *    gaps run 2, 3, 2, 2, 3, 2, 2, 3, 2 and a corner harbor has a gap of 2 on both sides. Other shapes are unchanged.
 * 6: Tidebound's wide water grows the canvas around the normal map (`canvasRadiusFor`) and keeps the normal land count, instead of cutting the
 *    land on the same canvas. Counts that scale with the land (islands, river length, noise size, ring size) read `baseRadius`. Without the
 *    wide-water pick nothing changes. The same pick also writes `ext.elevation` (1 to 3) on land and `ext.fish` on seeded sea tiles (T2b2, T2c; no
 *    RNG draws), still version 6 because version 6 had not shipped.
 */
export const GEN_VERSION = 6;

export const SHARE_PREFIX = 'hx1';
export const MIN_RADIUS = 1;
/** Largest map radius a host can choose (30: past that, maps were too big to play and too slow to draw). */
export const MAX_RADIUS = 30;
/** Largest canvas the generator builds: a radius-30 map plus Tidebound's wide-water sea rings still fits. */
export const MAX_CANVAS_RADIUS = 50;
const MAX_PICKS = 16;
const MAX_PARAMS = 32;
const MAX_SEED_LEN = 32;
const RESERVED_KEYS = new Set(['g', 'r', 'picks', 'seed']);
const ID_RE = /^[a-z][a-z0-9_.]{0,39}$/i;

export type MapStage = 'shape' | 'terrain' | 'numbers' | 'extras' | 'ports' | 'check';

export interface MapRecipe {
  /** Generator version the recipe was made with. */
  g: number;
  /** Canonical seed text (see cleanSeed). */
  seed: string;
  radius: number;
  /** Menu ids the host ticked: shape ops, terrain and number styles, perks. */
  picks: string[];
  /** Numeric params by id, e.g. land, islands.count. */
  params: Record<string, number>;
}

/**
 * One RNG stream per stage, so changing one stage never reshuffles another.
 * The attempt number is part of the stream, so retries are deterministic.
 */
export function stageRng(seed: string, stage: MapStage, attempt = 0): RngState {
  return createRng(`${seed}:${stage}:${attempt}`);
}

/** A fresh random seed: a uint32 as 7 base36 characters. */
export function newSeedText(): string {
  return randomSeed().toString(36).toUpperCase().padStart(7, '0');
}

/**
 * Canonical seed text. Typed words stay as typed (letters, digits, - and _ only, 32 characters at most).
 * Seven base36 characters are the random-seed format and get upper-cased, so a pasted
 * seed always reads the same. Empty input gives ''.
 */
export function cleanSeed(input: unknown): string {
  let s = String(input ?? '').trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_SEED_LEN);
  if (/^[0-9a-z]{7}$/i.test(s)) s = s.toUpperCase();
  return s;
}

function clampRadius(v: any, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, Math.floor(n)));
}

/** Fills defaults and clamps everything. Never throws. Unknown ids are the registry's business (M2). */
export function makeRecipe(input: Partial<MapRecipe> = {}): MapRecipe {
  const picks: string[] = [];
  for (const p of Array.isArray(input.picks) ? input.picks : []) {
    const id = String(p);
    if (ID_RE.test(id) && !picks.includes(id) && picks.length < MAX_PICKS) picks.push(id);
  }
  const params: Record<string, number> = {};
  for (const [k, v] of Object.entries(input.params ?? {})) {
    const n = Number(v);
    if (!ID_RE.test(k) || RESERVED_KEYS.has(k) || !Number.isFinite(n)) continue;
    if (Object.keys(params).length >= MAX_PARAMS) break;
    params[k] = n;
  }
  return {
    g: Number.isFinite(Number(input.g)) && Number(input.g) > 0 ? Math.floor(Number(input.g)) : GEN_VERSION,
    seed: cleanSeed(input.seed) || newSeedText(),
    radius: clampRadius(input.radius, 2),
    picks,
    params
  };
}

/** `hx1;g=1;r=4;picks=continent+lake;land=70;seed=7K3F9Q2` (params sorted by id, so the code is stable). */
export function encodeRecipe(recipe: MapRecipe): string {
  const parts = [SHARE_PREFIX, `g=${recipe.g}`, `r=${recipe.radius}`];
  if (recipe.picks.length > 0) parts.push(`picks=${recipe.picks.join('+')}`);
  for (const k of Object.keys(recipe.params).sort()) parts.push(`${k}=${recipe.params[k]}`);
  parts.push(`seed=${recipe.seed}`);
  return parts.join(';');
}

export interface DecodedRecipe { recipe: MapRecipe; dropped: string[] }

/**
 * Reads a share code. Returns null when it is not a code (wrong prefix, no seed).
 * `known` lets the caller drop ids the registry does not have; they come back in `dropped`.
 * Radius and numbers are clamped, never trusted.
 */
export function decodeRecipe(code: string, known?: (id: string) => boolean): DecodedRecipe | null {
  const parts = String(code ?? '').trim().split(';');
  if (parts[0] !== SHARE_PREFIX) return null;
  const dropped: string[] = [];
  const raw: Partial<MapRecipe> = { params: {}, picks: [] };
  let sawSeed = false;
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const key = part.slice(0, eq);
    const val = part.slice(eq + 1);
    if (key === 'g') raw.g = Number(val);
    else if (key === 'r') raw.radius = Number(val);
    else if (key === 'seed') { raw.seed = val; sawSeed = true; }
    else if (key === 'picks') {
      for (const id of val.split('+')) {
        if (!id) continue;
        if (!ID_RE.test(id) || (known && !known(id))) dropped.push(id);
        else raw.picks!.push(id);
      }
    } else {
      if (!ID_RE.test(key) || RESERVED_KEYS.has(key) || (known && !known(key))) dropped.push(key);
      else raw.params![key] = Number(val);
    }
  }
  if (!sawSeed || !cleanSeed(raw.seed)) return null;
  return { recipe: makeRecipe(raw), dropped };
}

/** True when the recipe came from another generator version, so its seed may give a different map. */
export function isOtherVersion(recipe: MapRecipe): boolean {
  return recipe.g !== GEN_VERSION;
}
