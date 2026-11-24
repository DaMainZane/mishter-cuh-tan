// MODULE: board generator (staged pipeline: shape, terrain, numbers, extras, ports; plus the old generateBoard) driven by the registry | DEPENDS ON: shared/mapcells, shared/mapcheck, shared/mapmix, shared/mapoptions, shared/maprecipe, shared/mapshape, +6 more | USED BY: shared/engine, shared/index
import type { Registry } from './registry';
import { createNoise } from './noise';
import { assignNumbers, buildNumberPool } from './numbers';
import { createRng, rngNext, rngShuffle } from './rng';
import type { RngState } from './rng';
import { addWaterTopology, buildTopology } from './topology';
import type { HexInit } from './topology';
import type { Board, Rules } from './types';
import { MAX_CANVAS_RADIUS, MAX_RADIUS, MIN_RADIUS, makeRecipe, stageRng } from './maprecipe';
import type { MapRecipe, MapStage } from './maprecipe';
import { effectiveFlags, paramOf, resolveMapOptions, resolveParams } from './mapoptions';
import type { CellInfo, DropReason, MapCtx, NumbersDef, PerkDef, ShapeOpDef, TerrainDef } from './mapoptions';
import { validateBoard } from './mapcheck';
import type { MapIssue, MapReport } from './mapcheck';
import { canvasCoords, canvasRadiusFor, runShape, seaExtraOf, seaGrow } from './mapshape';
import { buildCellInfo } from './mapcells';
import { mixIslands } from './mapmix';

function clampInt(val: any, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/**
 * The tile multiset for `total` land cells: special tiles first (always keep at least one base tile),
 * then base tiles cyclically. Unshuffled. Terrain styles only decide where each tile goes, never how many.
 */
function tileMultiset(reg: Registry, total: number, counts: Record<string, number>): string[] {
  const types: string[] = [];
  let budget = Math.max(0, total - 1);
  for (const [id, want] of Object.entries(counts)) {
    if (!reg.tiles.has(id)) continue;
    const n = Math.max(0, Math.min(Math.floor(Number(want) || 0), budget));
    for (let i = 0; i < n; i++) types.push(id);
    budget -= n;
  }
  const baseIds = [...reg.tiles.values()].filter(t => t.base).map(t => t.id);
  if (baseIds.length === 0) throw new Error('No base tiles registered (tile.base = true)');
  for (let i = 0; types.length < total; i++) types.push(baseIds[i % baseIds.length]);
  return types;
}

/** Extra shuffled copies of the port pool after the first one (11 x 9 = 99 types; the biggest board needs about 93 ports). */
const PORT_POOL_REPEATS = 10;

function portPool(reg: Registry): string[] {
  const pool: string[] = [];
  for (const p of reg.ports.values()) {
    for (let i = 0; i < (p.copies ?? 1); i++) pool.push(p.id);
  }
  return pool;
}

/**
 * The old entry point, driven by a preset id. Still used by `createGame` (sims, tests) and the legacy
 * Archipelago chip. The lobby builds its map through `generateMap` and recipes instead.
 */
export function generateBoard(reg: Registry, rules: Rules, rng: RngState, presetId = 'standard'): Board {
  const preset = reg.presets.get(presetId) ?? reg.presets.get('standard');
  const radius = clampInt(rules.boardRadius, MIN_RADIUS, MAX_RADIUS, 2);
  const isLand = (t: string) => !!reg.tiles.get(t)?.land;

  const coords = canvasCoords(radius);
  const total = coords.length;

  if (preset?.blank) {
    return buildTopology(coords.map(c => ({ q: c.q, r: c.r, type: 'water', number: null })), { isLand });
  }

  const counts: Record<string, number> = { ...rules.tileCounts, ...(preset?.tileCounts ? preset.tileCounts(rules, total) : {}) };
  const shuffledTypes = rngShuffle(rng, tileMultiset(reg, total, counts));
  const baseIds = [...reg.tiles.values()].filter(t => t.base).map(t => t.id);

  // Final tile types first (water chance may turn some into ocean), so the number pool matches the real count
  // of numbered tiles. Before, the pool was sized by every hex, which handed out extra 2s on the standard board.
  const finalTypes = coords.map((c, idx) => {
    const type = shuffledTypes[idx] || baseIds[0];
    if (preset?.waterChance && rngNext(rng) < preset.waterChance && (c.q !== 0 || c.r !== 0)) return 'water';
    return type;
  });
  const numberedIdx: number[] = [];
  finalTypes.forEach((type, idx) => {
    const def = reg.tiles.get(type);
    if (def && def.land && def.numbered) numberedIdx.push(idx);
  });
  const placed = assignNumbers(numberedIdx.map(i => coords[i]), buildNumberPool(numberedIdx.length), rng);
  const numberAt = new Map<number, number>();
  numberedIdx.forEach((idx, k) => numberAt.set(idx, placed[k]));

  const inits: HexInit[] = coords.map((c, idx) => ({
    q: c.q, r: c.r, type: finalTypes[idx], number: numberAt.get(idx) ?? null, ext: {}
  }));

  const extra = preset?.extra ? preset.extra(rules, total) : {};
  for (const hook of reg.hooks.afterMapGenerated) hook(inits, rules, rng, extra);

  return buildTopology(inits, {
    isLand,
    autoPorts: rngShuffle(rng, portPool(reg)),
    portBlocked: t => !!reg.tiles.get(t)?.noPort,
    waterEdges: reg.capabilities.has('crossing')
  });
}

// ---------------------------------------------------------------------------------------------------------
// Staged generator (Map Generation Design). M1 built the classic pipeline, M2 made it registry-driven:
// terrain and number styles and perks come from the registry, picks go through slots and conflicts.
// M3 added the shape stage: ops from the registry decide which canvas cells are land (see mapshape.ts).
// Each stage draws from its own RNG stream (see stageRng).
// ---------------------------------------------------------------------------------------------------------

export interface GeneratedMap {
  board: Board;
  report: MapReport;
  recipe: MapRecipe;
}

/** Board attempts for a radius (design section 11: 12 up to radius 20, fewer above, so a big board stays within its time budget). */
export function boardAttempts(radius: number): number {
  return radius <= 20 ? 12 : radius <= 30 ? 4 : 2;
}

/** Errors a new token layout (or terrain) can fix. Any other error comes from the shape and ends the loop. */
const REDRAWABLE_ERRORS = new Set(['resource-missing', 'token-mismatch']);

/** A pass is no errors and no low-fairness warning (design section 11). */
function attemptPassed(report: MapReport): boolean {
  return report.errors.length === 0 && !report.warnings.some(w => w.code === 'low-fairness');
}

/** Lower is better: errors dominate, then low fairness (worse = higher), then touching reds as a tiebreak. Ties keep the earlier attempt. */
function attemptScore(report: MapReport): number {
  let score = report.errors.length * 100;
  if (report.warnings.some(w => w.code === 'low-fairness')) score += 10 + (0.5 - report.stats.fairness);
  if (report.warnings.some(w => w.code === 'hot-touch')) score += 0.1;
  return score;
}

const DROP_TEXT: Record<DropReason, string> = {
  unknown: 'is not available',
  unmet: 'needs a feature no pack provides',
  replaced: 'was replaced by a later pick in the same slot',
  conflict: 'conflicts with a later pick'
};

/** Same members, ignoring order (a style may place, never change, the counts). */
function sameMembers<T extends string | number>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Map<T, number>();
  for (const x of a) left.set(x, (left.get(x) ?? 0) + 1);
  for (const x of b) {
    const n = left.get(x);
    if (!n) return false;
    left.set(x, n - 1);
  }
  return true;
}

/**
 * Builds a board from a recipe. The same recipe (with the same GEN_VERSION and packs) always gives the same map.
 * `input.radius` defaults to `rules.boardRadius`; an empty seed gets a fresh random one (read it from the result).
 * Never reads the player count (a new bot must not reroll the map).
 * A nonzero count in `rules.tileCounts` (Rules tab) wins over a perk's count for the same tile.
 */
export function generateMap(reg: Registry, rules: Rules, input: Partial<MapRecipe> = {}): GeneratedMap {
  const recipe = makeRecipe({ ...input, radius: input.radius ?? rules.boardRadius });
  const isLand = (t: string) => !!reg.tiles.get(t)?.land;
  const seed = recipe.seed;

  // 1 resolve: picks -> valid options (slots, conflicts, defaults), flags, params.
  const resolved = resolveMapOptions(reg, recipe.picks);
  const flags = effectiveFlags(resolved.options);
  const params = resolveParams(resolved.options, recipe.params);
  // Attempt 0 keeps the stream names of the single-pass generator, so a board that passes first time is unchanged.
  const ctxFor = (stage: MapStage, attempt = 0): MapCtx => ({
    reg,
    rules,
    radius: recipe.radius,
    rng: stageRng(seed, stage, attempt),
    noise: createNoise(attempt === 0 ? `${seed}:${stage}` : `${seed}:${stage}:${attempt}`),
    flags,
    param: (id: string) => paramOf(resolved.options, params, id)
  });
  const warnings: MapIssue[] = resolved.dropped.map(d => ({
    code: 'pick-ignored',
    message: `"${d.id}" ${DROP_TEXT[d.reason]} and was ignored.`
  }));
  // A wide-water pick (Tidebound) grows the canvas around the normal map: the land count stays what the radius gives, and the extra room is sea,
  // so wide gaps work at any radius. Only the radius cap can hold it back; say so instead of looking broken.
  const seaExtra = seaExtraOf(paramOf(resolved.options, params, 'water.extra'));
  const shapeCanvas = resolved.options.reduce((r, o) => (o.stage === 'shape' && (o as ShapeOpDef).canvasRadius ? Math.max(r, (o as ShapeOpDef).canvasRadius!(recipe.radius, seaExtra)) : r), 0);
  const canvasRadius = Math.min(MAX_CANVAS_RADIUS, Math.max(canvasRadiusFor(recipe.radius, seaExtra), shapeCanvas));
  if (seaExtra > 0 && canvasRadius < recipe.radius + seaGrow(seaExtra)) {
    warnings.push({
      code: 'wide-water-small',
      message: `Wide water needs room: radius ${recipe.radius} is close to the size limit, so the seas stay narrower than asked.`
    });
  }

  // 2 canvas, 3 shape: shape ops decide which canvas cells are land (the plain hexagon is the whole canvas).
  // Terrain, numbers and extras then work on the land cells only; the rest of the canvas stays water.
  // The canvas is the normal map's size, or bigger with a wide-water pick (`shape.radius` says which: a failed shape falls back to the normal size).
  const shapeOps = resolved.options.filter((o): o is ShapeOpDef => o.stage === 'shape');
  const shape = runShape({
    radius: canvasRadius,
    landRadius: recipe.radius,
    ops: shapeOps,
    // Picks like `ragged` or `satellites` clash with the default hexagon; they sit on a continent instead.
    fallbackBase: reg.mapShapes.get('continent') ?? reg.mapShapes.get('hexagon'),
    make: attempt => ({ ...ctxFor('shape'), rng: stageRng(seed, 'shape', attempt), noise: createNoise(`${seed}:shape:${attempt}`) })
  });
  const canvas = canvasCoords(shape.radius);
  if (shape.fallback) {
    const why = shape.why ? ` Most attempts failed on: ${shape.why}.` : '';
    warnings.push({ code: 'shape-fallback', message: `No shape attempt passed the checks, so the plain hexagon was used.${why} Try another seed or fewer options.` });
  }
  // An op that could only do part of its work (a river that ran out of room, fewer islets than asked) still gives a shape; say what is short.
  for (const note of shape.notes ?? []) warnings.push({ code: 'shape-partial', message: note });
  // Per-cell data for the terrain and number styles (land cells, canvas order): height, moisture, coast distance, landmass.
  // The shape's height field reaches the terrain stage here; shapes that drew none fall back to the terrain stage's noise.
  const cellsFor = (t: number): CellInfo[] =>
    buildCellInfo({ radius: recipe.radius, canvas, land: shape.land, h: shape.h, noise: createNoise(t === 0 ? `${seed}:terrain` : `${seed}:terrain:${t}`) });
  const cells0 = cellsFor(0);
  const total = cells0.length;

  // Counts first: rules.tileCounts, then perks fill in what the Rules tab left at zero.
  const perks = resolved.options.filter((o): o is PerkDef => o.stage === 'extras');
  const countsCtx = ctxFor('extras');
  const counts: Record<string, number> = { ...rules.tileCounts };
  const extra: Record<string, any> = {};
  for (const perk of perks) {
    if (perk.tileCounts) {
      for (const [id, n] of Object.entries(perk.tileCounts(rules, total, countsCtx))) {
        if (!(Number(rules.tileCounts?.[id]) > 0)) counts[id] = n;
      }
    }
    if (perk.extra) Object.assign(extra, perk.extra(rules, total, countsCtx));
  }

  // 4 terrain: the multiset is fixed, the style only places it. Kept per terrain attempt (0 unless a resource went missing).
  const multiset = tileMultiset(reg, total, counts);
  const terrain = resolved.options.find((o): o is TerrainDef => o.stage === 'terrain');
  const terrainCache = new Map<number, { cells: CellInfo[]; types: string[]; warnings: MapIssue[] }>();
  const terrainFor = (t: number) => {
    const hit = terrainCache.get(t);
    if (hit) return hit;
    const cells = t === 0 ? cells0 : cellsFor(t);
    const issues: MapIssue[] = [];
    let types = terrain ? terrain.place(cells, multiset, ctxFor('terrain', t)) : rngShuffle(stageRng(seed, 'terrain', t), multiset);
    if (!Array.isArray(types) || !sameMembers(types, multiset)) {
      issues.push({ code: 'terrain-invalid', message: `Terrain style "${terrain?.id}" changed the tile counts, so plain random placement was used.` });
      types = rngShuffle(stageRng(seed, 'terrain', t), multiset);
    }
    // The island_mix perk: swap tiles between landmasses so no island of 4 or more tiles has a single resource.
    if (flags.islandMix) types = mixIslands(reg, cells, types, createRng(`${seed}:islandmix:${t}`));
    const made = { cells, types, warnings: issues };
    terrainCache.set(t, made);
    return made;
  };

  const numbering = resolved.options.find((o): o is NumbersDef => o.stage === 'numbers');
  const numberOpts = { hotTouch: flags.hotTouch, equalTouch: flags.equalTouch };

  // Stages 5 to 8 for one attempt. The shape, the tile counts and (normally) the terrain stay as they are; only the
  // number stage draws from a new stream per attempt, so an unlucky token layout never costs the host the map they liked.
  const buildAttempt = (numAttempt: number, terrainAttempt: number) => {
    const { cells, types, warnings: terrainIssues } = terrainFor(terrainAttempt);
    const issues: MapIssue[] = [...terrainIssues];

    // 5 numbers: pool sized by the numbered tiles.
    const numberedIdx: number[] = [];
    types.forEach((type, idx) => {
      const def = reg.tiles.get(type);
      if (def && def.land && def.numbered) numberedIdx.push(idx);
    });
    const numberedCells = numberedIdx.map(i => ({ ...cells[i], type: types[i] }));
    const pool = buildNumberPool(numberedIdx.length);
    let tokens = numbering ? numbering.place(numberedCells, pool, ctxFor('numbers', numAttempt)) : assignNumbers(numberedCells, pool, stageRng(seed, 'numbers', numAttempt), numberOpts);
    if (!Array.isArray(tokens) || !sameMembers(tokens, pool)) {
      issues.push({ code: 'numbers-invalid', message: `Number style "${numbering?.id}" changed the tokens, so the standard placement was used.` });
      tokens = assignNumbers(numberedCells, pool, stageRng(seed, 'numbers', numAttempt), numberOpts);
    }
    const numberAt = new Map<number, number>();
    numberedIdx.forEach((idx, k) => numberAt.set(idx, tokens[k]));

    // Every canvas cell becomes a hex: land cells take the next type and token, the rest is water.
    let ord = 0;
    const inits: HexInit[] = canvas.map((c, i) => {
      if (shape.land[i] !== 1) return { q: c.q, r: c.r, type: 'water', number: null, ext: shape.river[i] ? { river: true } : {} };
      const idx = ord++;
      return { q: c.q, r: c.r, type: types[idx], number: numberAt.get(idx) ?? null, ext: {} };
    });

    // 6 extras: each active perk, then the hooks that need no menu entry (fog hides tiles here). Same stream every attempt.
    // Perks also get the land cells with their ranked height (`cells0`, the shape's own height field when it drew one), so a perk can write data
    // by height (Tidebound elevation). `cells0` and not this attempt's cells: a terrain redraw never moves it.
    const extrasCtx = ctxFor('extras');
    for (const perk of perks) perk.afterGenerated?.(inits, extrasCtx, cells0);
    for (const hook of reg.hooks.afterMapGenerated) hook(inits, rules, extrasCtx.rng, extra);

    // 7 topology and ports, 8 check.
    // Ports: always per landmass along the coast. The plain hexagon (the whole canvas is land) gets the real board's layout: 9 ports on the
    // standard board, a harbor on every second sea tile of the frame, each on the edge the real board uses (`portLayout: 'hexagon'`).
    // Every other shape keeps the general placement and may put ports on neighbouring tiles. The first shuffle and the offset draw exactly
    // as before; the pool then repeats as fresh shuffles, so a board with more than 9 ports (a big table, the 5-6 player size) keeps the
    // real 4 generic : 5 resource mix instead of repeating one order. The mirror flag is drawn last, so it never moves the draws before it.
    const portRng = stageRng(seed, 'ports');
    const autoPorts = rngShuffle(portRng, portPool(reg));
    const portOffset = rngNext(portRng);
    for (let k = 0; k < PORT_POOL_REPEATS; k++) autoPorts.push(...rngShuffle(portRng, portPool(reg)));
    const portFlip = rngNext(portRng) >= 0.5;
    const fullHexagon = shape.land.every(v => v === 1);
    const board = buildTopology(inits, {
      isLand, autoPorts, portMode: 'coast', portOffset, portFlip, portLayout: fullHexagon ? 'hexagon' : undefined,
      // A tile a pack marks `noPort` (land that takes none, or non-sea terrain) never gets or faces a port.
      portBlocked: t => !!reg.tiles.get(t)?.noPort
    });
    const report = validateBoard(board, reg, {
      expectLand: total,
      attempts: shape.attempts,
      rng: stageRng(seed, 'check'),
      hotTouch: flags.hotTouch,
      balanceCheck: flags.balanceCheck,
      thinLand: flags.thinLand,
      // Shapes that must stay whole say so; satellite islets are separate by design, so they switch that off.
      requireConnected: flags.requireConnected && !shapeOps.some(o => o.id === 'satellites'),
      // A ring must not squeeze through a 1-wide neck (design 6.8). Only meaningful where the band can be 2 tiles wide.
      checkNecks: shapeOps.some(o => o.id === 'ring') && recipe.radius >= 4,
      // Satellite islets are small on purpose.
      minLandmass: shapeOps.some(o => o.id === 'satellites') ? 1 : undefined
    });
    report.warnings.push(...warnings, ...issues);
    return { board, report };
  };

  // Board loop: keep the shape, redraw the tokens until the checks pass; keep the best attempt if none does. Never throws.
  const limit = boardAttempts(shape.radius);
  let terrainAttempt = 0;
  let best: { board: Board; report: MapReport; score: number } | null = null;
  let passed = false;
  let ran = 0;
  for (let a = 0; a < limit; a++) {
    const built = buildAttempt(a, terrainAttempt);
    ran++;
    const score = attemptScore(built.report);
    if (!best || score < best.score) best = { ...built, score };
    if (attemptPassed(built.report)) { passed = true; break; }
    // An error another token layout cannot fix (land count, landmass size, too few spots): more attempts would only cost time.
    if (built.report.errors.some(e => !REDRAWABLE_ERRORS.has(e.code))) break;
    // A resource with no tile is a terrain problem, so the next attempt also redraws the terrain.
    if (built.report.errors.some(e => e.code === 'resource-missing')) terrainAttempt++;
  }
  const chosen = best!;
  chosen.report.stats.boardAttempts = ran;
  if (!passed) chosen.report.degraded = true;
  if (reg.capabilities.has('crossing')) {
    addWaterTopology(chosen.board, isLand, t => !!reg.tiles.get(t)?.noPort);
  }
  return { board: chosen.board, report: chosen.report, recipe };
}
