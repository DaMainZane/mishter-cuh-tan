// MODULE: map option definitions (shape ops, terrain and number styles, perks, quick starts), generator flags, pick resolution | DEPENDS ON: shared/mapshape, shared/registry, shared/rng, shared/topology, shared/types | USED BY: packs/tidebound/seaData, shared/index, shared/mapcells, shared/mapgen, shared/mapmix, shared/mapshape, +1 more
import type { Registry } from './registry';
import type { LandField } from './mapshape';
import type { RngState } from './rng';
import type { HexInit } from './topology';
import type { Rules } from './types';

/** Stages an option can belong to (the generator also has `ports` and `check`, which are not menu entries). */
export type MapOptionStage = 'shape' | 'terrain' | 'numbers' | 'extras';

export interface ParamDef { id: string; label: string; min: number; max: number; step: number; default: number }

/** Rule flags the generator reads. Defaults, then each active pick's `ruleOverrides`. */
export interface GenFlags {
  /** 'forbid': 6 and 8 may not touch (today's rule). 'allow' skips that check. */
  hotTouch: 'forbid' | 'allow';
  /** 'avoid': equal numbers kept apart (a soft goal). */
  equalTouch: 'avoid' | 'allow';
  /** One landmass only. */
  requireConnected: boolean;
  /** Warn when a resource has under half the average pips. Off for styles that unbalance on purpose (feast or famine) or balance by design. */
  balanceCheck: boolean;
  /** Share of land tiles with 2 or fewer land neighbours above which the thin-land warning fires. A ragged coast raises it. */
  thinLand: number;
  /** Terrain fix-up: every island of 4 or more tiles gets at least two resource types (the `island_mix` perk). Off when absent. */
  islandMix?: boolean;
}

export const DEFAULT_FLAGS: Readonly<GenFlags> = { hotTouch: 'forbid', equalTouch: 'avoid', requireConnected: false, balanceCheck: true, thinLand: 0.25 };

export interface MapOptionBase {
  id: string;
  label: string;
  description?: string;
  /** Options in the same slot replace each other (the later pick wins). No slot = a free toggle. */
  slot?: string;
  /** Used when its slot is empty (hexagon, random terrain, standard numbers). Needs a slot. */
  default?: boolean;
  /** Ids that cannot be active together with this option. The later pick wins. */
  conflicts?: string[];
  /** Capabilities a pack must register, e.g. 'crossing'. Unmet = the pick is refused. */
  requires?: string[];
  params?: ParamDef[];
  /** The seed and share code reveal hidden information (fog). */
  secret?: boolean;
  /** Changes the generator flags while this option is active. Two options that disagree on a flag must declare a conflict. */
  ruleOverrides?: Partial<GenFlags>;
  replace?: boolean;
}

export interface MapCtx {
  reg: Registry;
  rules: Rules;
  radius: number;
  /** Already derived from seed + stage (attempt 0 until the M5 retry loop). */
  rng: RngState;
  /** 0..1, seeded per seed and stage. */
  noise(x: number, y: number, octaves?: number): number;
  flags: GenFlags;
  /** The picked value, clamped, or the param's default. 0 for an id no active option declares. */
  param(id: string): number;
}

/**
 * One land cell handed to a terrain or number style. Cells come in canvas order, land cells only (see `buildCellInfo`).
 * Height and moisture are rank-normalized over the land cells, so a threshold means the same on every shape.
 */
export interface CellInfo {
  q: number;
  r: number;
  /** Height 0..1: the shape's heightfield when it has one, else fresh noise. */
  h: number;
  /** Moisture 0..1: noise, wetter near the coast. */
  m: number;
  /** Steps to the nearest land cell that touches water. 0 on the coast itself. */
  coastDist: number;
  /** Landmass index, in discovery order over the canvas. */
  landmass: number;
  /** The tile type placed here. Only set for number styles (terrain is decided by then), absent for terrain styles. */
  type?: string;
}

export interface ShapeOpDef extends MapOptionBase {
  stage: 'shape';
  phase: 'tweak' | 'base' | 'carve' | 'scatter';
  /**
   * Edits the land field. `tweak` runs first (it changes how the base draws), `base` builds `field.baseTarget` cells,
   * `carve` turns land into water, `scatter` adds land elsewhere. The classic hexagon is the whole canvas and needs no `run`.
   * An op that cannot finish sets `field.failed`; the attempt is dropped and the generator retries.
   */
  run?(field: LandField, ctx: MapCtx): void;
  /**
   * Carve and scatter ops: how many land cells they will remove or add, known before the base runs (`field.L` is set).
   * The base builds that many extra (carve) or fewer (scatter), so the final land count stays exact.
   */
  budget?(field: LandField, ctx: MapCtx): number;
  /**
   * Base ops: the canvas radius this shape needs for a normal map of `radius` (with `seaExtra` wide water), when that is more than the usual
   * canvas. Island clusters use it: many islands each with their own moat need more sea than a few big ones. The land count still comes from
   * `radius`; the generator caps the result at the canvas limit.
   */
  canvasRadius?(radius: number, seaExtra: number): number;
}

export interface TerrainDef extends MapOptionBase {
  stage: 'terrain';
  /** `types` is the final multiset. Return one type per cell with the same counts (a style only places, never counts). */
  place(cells: CellInfo[], types: string[], ctx: MapCtx): string[];
}

export interface NumbersDef extends MapOptionBase {
  stage: 'numbers';
  /** `pool` is the token multiset. Return one token per cell, aligned with `cells`, using exactly the pool. */
  place(cells: CellInfo[], pool: number[], ctx: MapCtx): number[];
}

export interface PerkDef extends MapOptionBase {
  stage: 'extras';
  /**
   * Changes the tile multiset (gold). `total` is the land cell count. A nonzero count in `rules.tileCounts`
   * (the Rules tab) wins over what a perk returns for the same tile; zero lets the perk decide.
   */
  tileCounts?(rules: Rules, total: number, ctx: MapCtx): Record<string, number>;
  /** Handed to `afterMapGenerated` hooks (fog: `fogCount`). Applying "a typed count wins" is the perk's job here. */
  extra?(rules: Rules, total: number, ctx: MapCtx): Record<string, any>;
  /**
   * Same moment as `afterMapGenerated`, but only while the perk is active.
   * `cells` are the land cells in canvas order with their ranked height `h` (the same list the terrain stage got), for a perk that writes data by height.
   * Match them to `inits` by position (`q`, `r`), not by index. A perk that ignores them can declare just `(inits, ctx)`.
   */
  afterGenerated?(inits: HexInit[], ctx: MapCtx, cells: readonly CellInfo[]): void;
}

export type MapOption = ShapeOpDef | TerrainDef | NumbersDef | PerkDef;

/** A preset chip as a recipe: the picks and params to apply (the seed is rolled fresh). */
export interface QuickStartDef {
  id: string;
  label: string;
  /** An all-water canvas for the painter. Not a shape: it breaks the land minimum. */
  blank?: boolean;
  picks: string[];
  params?: Record<string, number>;
  replace?: boolean;
}

// ---- Lookup ---------------------------------------------------------------------------------------------

/** Every registered option, shapes first, then terrain, numbers, perks (registration order inside each). */
export function allMapOptions(reg: Registry): MapOption[] {
  return [...reg.mapShapes.values(), ...reg.mapTerrains.values(), ...reg.mapNumberings.values(), ...reg.mapPerks.values()];
}

export function findMapOption(reg: Registry, id: string): MapOption | undefined {
  return reg.mapShapes.get(id) ?? reg.mapTerrains.get(id) ?? reg.mapNumberings.get(id) ?? reg.mapPerks.get(id);
}

/** True for an option id or a param id some option declares (what a share code may contain). */
export function isKnownMapId(reg: Registry, id: string): boolean {
  if (findMapOption(reg, id)) return true;
  return allMapOptions(reg).some(o => (o.params ?? []).some(p => p.id === id));
}

// ---- Resolution -------------------------------------------------------------------------------------------

export type DropReason = 'unknown' | 'unmet' | 'replaced' | 'conflict';
export interface DroppedPick { id: string; reason: DropReason }

const unmet = (reg: Registry, o: MapOption): boolean => (o.requires ?? []).some(c => !reg.capabilities.has(c));

/** Two options cannot be active together: same slot, or either one lists the other as a conflict. */
function clashes(a: MapOption, b: MapOption): boolean {
  if (a.id === b.id) return false;
  return (!!a.slot && a.slot === b.slot) || !!a.conflicts?.includes(b.id) || !!b.conflicts?.includes(a.id);
}

/**
 * Turns the picks the host ticked into a valid set: unknown ids and unmet `requires` are dropped, duplicates
 * collapse, and when two picks clash (same slot or a declared conflict) the LATER one wins. Defaults are not added here.
 * The same function runs on the server for every client message, so a stale client cannot create an invalid mix.
 */
export function resolvePicks(reg: Registry, picks: readonly string[]): { picks: string[]; dropped: DroppedPick[] } {
  const kept: MapOption[] = [];
  const dropped: DroppedPick[] = [];
  for (const raw of picks) {
    const id = String(raw);
    const opt = findMapOption(reg, id);
    if (!opt) { dropped.push({ id, reason: 'unknown' }); continue; }
    if (kept.includes(opt)) continue;
    if (unmet(reg, opt)) { dropped.push({ id, reason: 'unmet' }); continue; }
    for (let i = kept.length - 1; i >= 0; i--) {
      if (!clashes(opt, kept[i])) continue;
      dropped.push({ id: kept[i].id, reason: opt.slot && kept[i].slot === opt.slot ? 'replaced' : 'conflict' });
      kept.splice(i, 1);
    }
    kept.push(opt);
  }
  return { picks: kept.map(o => o.id), dropped };
}

export interface ResolvedMapOptions {
  /** The valid picks, without defaults (what settings store). */
  picks: string[];
  dropped: DroppedPick[];
  /** The options that run: defaults for empty slots first, then the picks. */
  options: MapOption[];
}

/** `resolvePicks` plus the default option of every slot nothing was picked for (skipped if it clashes with a pick). */
export function resolveMapOptions(reg: Registry, picks: readonly string[]): ResolvedMapOptions {
  const { picks: ids, dropped } = resolvePicks(reg, picks);
  const chosen = ids.map(id => findMapOption(reg, id)!);
  const defaults: MapOption[] = [];
  for (const o of allMapOptions(reg)) {
    if (!o.default || !o.slot || unmet(reg, o)) continue;
    if (chosen.some(k => k.slot === o.slot) || defaults.some(d => d.slot === o.slot)) continue;
    if (chosen.some(k => clashes(o, k))) continue;
    defaults.push(o);
  }
  return { picks: ids, dropped, options: [...defaults, ...chosen] };
}

// ---- Params and flags ---------------------------------------------------------------------------------------

/** Clamps to the range, then snaps to the step grid that starts at `min`. */
function clampParam(v: number, p: ParamDef): number {
  const bounded = Math.max(p.min, Math.min(p.max, v));
  const step = p.step > 0 ? p.step : 1;
  return Math.min(p.max, Math.round((bounded - p.min) / step) * step + p.min);
}

/** Keeps only params some active option declares, clamped to their ranges. Params left out stay at their defaults. */
export function resolveParams(options: readonly MapOption[], input: Record<string, any> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!input || typeof input !== 'object') return out;
  for (const o of options) {
    for (const p of o.params ?? []) {
      if (p.id in out || !(p.id in input)) continue;
      const v = Number(input[p.id]);
      if (Number.isFinite(v)) out[p.id] = clampParam(v, p);
    }
  }
  return out;
}

/** The value of a param: the one the recipe carries, else the declared default, else 0. */
export function paramOf(options: readonly MapOption[], params: Record<string, number>, id: string): number {
  if (id in params) return params[id];
  for (const o of options) {
    const p = (o.params ?? []).find(x => x.id === id);
    if (p) return p.default;
  }
  return 0;
}

/** Defaults, then each active option's overrides in order. */
export function effectiveFlags(options: readonly MapOption[]): GenFlags {
  const flags: GenFlags = { ...DEFAULT_FLAGS };
  for (const o of options) Object.assign(flags, o.ruleOverrides ?? {});
  return flags;
}
