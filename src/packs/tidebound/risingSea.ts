// MODULE: tidebound.rising_sea addon (T12a: coast-inward drowning of the lowest elevation land tiles first using a derived RNG stream, `drowned` tile state blocking production and robber, and idle checks for submerged non-harbor ports; T12b: works standalone or alongside Tides, `risingSeaLevel` 1-5 rate settings, and drowned tile client overlays; T13a: rising-sea drowning exposure in scoreVertex) | DEPENDS ON: packs/tidebound/harbor, packs/tidebound/tides, shared/index, shared/mapshape, shared/rng, shared/tileState | USED BY: packs/tidebound/addons.generated, packs/tidebound/index
import { addonOn, BOT_GOALS, PORT_IDLE_CHECKS, VIEW_DATA } from '../../shared';
import type { AddonDef, BotGoalDef, Ctx, GameState, Hex, Registry, RngState, ViewDataDef, ViewOverlay } from '../../shared';
import { HEX_DIRS } from '../../shared/mapshape';
import { createRng, rngInt } from '../../shared/rng';
import { getTileState, setTileState } from '../../shared/tileState';
import { isHarbor } from './harbor';
import { FLOODED, hexElevation } from './tides';

/**
 * Tile state id (`DEFAULT_TILE_STATES.drowned`: `blocksProduction: true`, `blocksRobber: true`, no `until` expiry).
 * Unlike Tides (`flooded`), a `drowned` tile never dries out and counts as sea for further inward drowning.
 */
export const DROWNED = 'drowned';
/** First round the rising sea claims a tile at the Medium level, leaving rounds 1 and 2 dry for opening expansion. */
export const RISING_SEA_FIRST_ROUND = 3;
/** Default cadence in rounds between rising-sea drownings at the Medium level (round 3, 5, 7...). */
export const RISING_SEA_CADENCE_ROUNDS = 2;
/** Mixed into `g.seed` to derive the Rising Sea RNG stream so `g.rng` is never touched. */
export const RISING_SEA_RNG_SALT = 0x52534541; // 'RSEA'

// ---- T12b: Rising sea rate settings (1 Very slow to 5 Very fast, default 3 Medium) ----------------------------

export const RISING_SEA_LEVEL_MIN = 1;
export const RISING_SEA_LEVEL_MAX = 5;
/** Medium: matches the T12a baseline (`firstRound: 3`, `cadence: 2`, `tilesPerPulse: 1`). */
export const RISING_SEA_DEFAULT_LEVEL = 3;

export interface RisingSeaLevelDef {
  name: string;
  firstRound: number;
  cadence: number;
  tilesPerPulse: 1 | 2;
}

export const RISING_SEA_LEVELS: readonly RisingSeaLevelDef[] = [
  { name: 'Very slow', firstRound: 5, cadence: 4, tilesPerPulse: 1 },
  { name: 'Slow', firstRound: 4, cadence: 3, tilesPerPulse: 1 },
  { name: 'Medium', firstRound: 3, cadence: 2, tilesPerPulse: 1 },
  { name: 'Fast', firstRound: 2, cadence: 2, tilesPerPulse: 1 },
  { name: 'Very fast', firstRound: 2, cadence: 1, tilesPerPulse: 2 }
];

function clampRisingSeaLevel(level: unknown): number {
  const n = Math.round(Number(level));
  return Number.isFinite(n)
    ? Math.min(RISING_SEA_LEVEL_MAX, Math.max(RISING_SEA_LEVEL_MIN, n))
    : RISING_SEA_DEFAULT_LEVEL;
}

/** Rate definition for a slider position (out-of-range or non-numeric values clamp safely to 1..5 or Medium). */
export function risingSeaLevelDef(level: number = RISING_SEA_DEFAULT_LEVEL): RisingSeaLevelDef {
  return RISING_SEA_LEVELS[clampRisingSeaLevel(level) - 1];
}

/** This game's rising-sea level from `rules.risingSeaLevel` (defaults to 3, Medium). */
export function risingSeaLevelOf(g: GameState): number {
  return clampRisingSeaLevel(g.rules?.risingSeaLevel);
}

/** Effective schedule configuration for `g`, combining `rules.risingSeaLevel` with optional rule overrides. */
export function risingSeaConfigOf(g: GameState): RisingSeaLevelDef & { level: number } {
  const level = risingSeaLevelOf(g);
  const base = risingSeaLevelDef(level);
  const rawFirst = Number(g.rules?.risingSeaFirstRound);
  const rawCadence = Number(g.rules?.risingSeaCadence);
  const rawPulse = Number(g.rules?.risingSeaTilesPerPulse);
  return {
    level,
    name: base.name,
    firstRound: Number.isFinite(rawFirst) && rawFirst >= 1 ? Math.round(rawFirst) : base.firstRound,
    cadence: Number.isFinite(rawCadence) && rawCadence >= 1 ? Math.round(rawCadence) : base.cadence,
    tilesPerPulse:
      Number.isFinite(rawPulse) && rawPulse >= 1 ? (Math.min(2, Math.max(1, Math.round(rawPulse))) as 1 | 2) : base.tilesPerPulse
  };
}

const keyOf = (q: number, r: number): string => `${q},${r}`;

/** Independent RNG stream derived from the world seed (`g.rng` is never touched). */
export function deriveRisingSeaRng(seed: number): RngState {
  return createRng(((Number(seed) || 1) ^ RISING_SEA_RNG_SALT) >>> 0);
}

/** Lazily initializes and returns the per-game Rising Sea RNG state in `g.ext.tidebound.risingSeaRng`. */
export function ensureRisingSeaRng(g: GameState): RngState {
  if (!g.ext) g.ext = {};
  if (!g.ext.tidebound) g.ext.tidebound = {};
  if (!g.ext.tidebound.risingSeaRng || typeof g.ext.tidebound.risingSeaRng.s !== 'number') {
    g.ext.tidebound.risingSeaRng = deriveRisingSeaRng(g.seed);
  }
  return g.ext.tidebound.risingSeaRng as RngState;
}

/** True when `hex` currently holds the permanent `drowned` tile state. */
export function isDrownedHex(hex: Hex | undefined): boolean {
  return !!hex && getTileState(hex)?.id === DROWNED;
}

/** True on rounds when the rising sea claims another frontier land tile (`round >= firstRound`, every `cadence` rounds). */
export function isRisingSeaRound(
  round: number,
  cadence: number = RISING_SEA_CADENCE_ROUNDS,
  firstRound: number = RISING_SEA_FIRST_ROUND
): boolean {
  const start = Number.isFinite(Number(firstRound)) && Number(firstRound) >= 1 ? Math.round(Number(firstRound)) : RISING_SEA_FIRST_ROUND;
  const step = Number.isFinite(Number(cadence)) && Number(cadence) >= 1 ? Math.round(Number(cadence)) : RISING_SEA_CADENCE_ROUNDS;
  return round >= start && (round - start) % step === 0;
}

/**
 * Visible, non-drowned land hexes on the rising-sea frontier (coast-inward).
 * A land hex is on the frontier if at least one of its 6 neighbours is open sea (visible water/river
 * tile with `!def.land && !def.noPort`) OR an already-`drowned` visible land hex. Hidden (fog) hexes never drown and
 * never act as sea sources, so fog contents are never leaked.
 */
export function risingSeaFrontierHexIds(g: GameState, reg: Registry): number[] {
  const at = new Map<string, Hex>();
  for (const h of g.board.hexes) at.set(keyOf(h.q, h.r), h);

  const isWaterSource = (h: Hex | undefined): boolean => {
    if (!h || h.ext?.hidden) return false;
    if (isDrownedHex(h)) return true;
    const def = reg.tiles.get(h.type);
    return !!def && !def.land && !def.noPort;
  };

  const out: number[] = [];
  for (const h of g.board.hexes) {
    if (h.ext?.hidden) continue;
    if (!reg.tiles.get(h.type)?.land) continue;
    if (isDrownedHex(h)) continue;
    if (HEX_DIRS.some(([dq, dr]) => isWaterSource(at.get(keyOf(h.q + dq, h.r + dr))))) {
      out.push(h.id);
    }
  }
  return out.sort((a, b) => a - b);
}

/**
 * Filters the current coast-inward frontier down to the lowest elevation tier (`hexElevation`: 1 before 2 before 3).
 * Returns hex ids in ascending order, or `[]` when no land on the frontier can drown.
 */
export function lowestElevationFrontierHexIds(g: GameState, reg: Registry): number[] {
  const frontier = risingSeaFrontierHexIds(g, reg);
  if (frontier.length === 0) return [];
  let minElev = Infinity;
  for (const id of frontier) {
    const e = hexElevation(g.board.hexes[id]);
    if (e < minElev) minElev = e;
  }
  return frontier.filter(id => hexElevation(g.board.hexes[id]) === minElev);
}

/**
 * Picks the next hex to drown from `lowestElevationFrontierHexIds(g, reg)` using the derived Rising Sea RNG stream.
 * Draws from `ensureRisingSeaRng(g)` (never `g.rng`). Returns `null` if no candidate exists.
 */
export function pickRisingSeaHex(g: GameState, reg: Registry): number | null {
  const candidates = lowestElevationFrontierHexIds(g, reg);
  if (candidates.length === 0) return null;
  const rng = ensureRisingSeaRng(g);
  const idx = rngInt(rng, candidates.length);
  return candidates[idx];
}

/**
 * Permanently drowns `hexId` (`{ id: DROWNED }`), overwriting any temporary state (such as `flooded`),
 * and emits `tileStateChanged` + `risingSeaDrowned`. Returns `true` when the tile state changed to `drowned`.
 */
export function drownHex(ctx: Ctx, hexId: number): boolean {
  const { g, reg } = ctx;
  const hex = g.board.hexes[hexId];
  if (!hex || hex.ext?.hidden || !reg.tiles.get(hex.type)?.land) return false;
  const prev = getTileState(hex)?.id ?? null;
  if (prev === DROWNED) return false;
  const elevation = hexElevation(hex);
  setTileState(g, hexId, { id: DROWNED });
  ctx.emit('tileStateChanged', { hexId, from: prev, to: DROWNED });
  ctx.emit('risingSeaDrowned', { round: g.round, hexId, elevation });
  ctx.log(`🌊 The rising sea drowns tile #${hexId} (elevation ${elevation})`, null);
  return true;
}

/**
 * Round-start step for `tidebound.rising_sea`: on scheduled rounds (`risingSeaConfigOf(ctx.g)`), picks up to
 * `tilesPerPulse` lowest-elevation frontier tiles and drowns them permanently. Returns the drowned hex ids.
 */
export function applyRisingSea(ctx: Ctx): number[] {
  const cfg = risingSeaConfigOf(ctx.g);
  if (!isRisingSeaRound(ctx.g.round, cfg.cadence, cfg.firstRound)) return [];
  const drowned: number[] = [];
  for (let i = 0; i < cfg.tilesPerPulse; i++) {
    const hexId = pickRisingSeaHex(ctx.g, ctx.reg);
    if (hexId === null) break;
    if (drownHex(ctx, hexId)) drowned.push(hexId);
  }
  return drowned;
}

/**
 * Port idleness check for Rising Sea (`PORT_IDLE_CHECKS`): a non-harbor port vertex is idle when it touches at least
 * one `drowned` land tile and every land tile it touches is submerged (`drowned`, or `flooded` while Tides is on).
 * Harbors (T8) stay active.
 */
export function isPortDrowned(g: GameState, reg: Registry, vertexId: number): boolean {
  if (addonOn(reg, 'tidebound.harbor') && isHarbor(g, vertexId)) return false;
  const v = g.board.vertices[vertexId];
  if (!v) return false;
  const tidesActive = addonOn(reg, 'tidebound.tides');
  let land = 0;
  let hasDrowned = false;
  for (const id of v.hexIds) {
    const hex = g.board.hexes[id];
    if (!hex || !reg.tiles.get(hex.type)?.land) continue;
    land++;
    const st = getTileState(hex)?.id;
    if (st === DROWNED) hasDrowned = true;
    else if (!(st === FLOODED && tidesActive)) return false;
  }
  return land > 0 && hasDrowned;
}

/**
 * Client hex overlays for drowned tiles (`VIEW_DATA`, T12b).
 * Returns `undefined` when no visible hex is drowned so `hexOverlays` stays `null` when nothing is drowned and Tides is off.
 * When tiles are drowned, marks each visible drowned hex with `{ kind: 'flood', label: 'Drowned' }` at higher priority than Tides.
 */
export function risingSeaOverlays(g: GameState, reg: Registry): Record<number, ViewOverlay> | undefined {
  if (!reg.enabled.has('tidebound.rising_sea')) return undefined;
  const out: Record<number, ViewOverlay> = {};
  let any = false;
  for (const hex of g.board.hexes) {
    if (hex.ext?.hidden || !isDrownedHex(hex)) continue;
    out[hex.id] = { kind: 'flood', label: 'Drowned' };
    any = true;
  }
  return any ? out : undefined;
}

export const risingSeaViewData: ViewDataDef = {
  id: 'tidebound.rising_sea.view',
  priority: 10,
  overlays: (g: GameState, reg: Registry) => risingSeaOverlays(g, reg)
};

// ---- T13a: Rising sea exposure in scoreVertex ----------------------------------------------------------------

const RISING_SEA_PIP_COUNT: Record<number, number> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1
};

const risingSeaSetsByCtx = new WeakMap<Ctx, { frontier: Set<number>; lowest: Set<number> }>();

function getRisingSeaSetsForCtx(ctx: Ctx): { frontier: Set<number>; lowest: Set<number> } {
  let cached = risingSeaSetsByCtx.get(ctx);
  if (cached) return cached;
  const frontierIds = risingSeaFrontierHexIds(ctx.g, ctx.reg);
  const frontier = new Set(frontierIds);
  let minElev = Infinity;
  for (const id of frontierIds) {
    const e = hexElevation(ctx.g.board.hexes[id]);
    if (e < minElev) minElev = e;
  }
  const lowest = new Set<number>();
  for (const id of frontierIds) {
    if (hexElevation(ctx.g.board.hexes[id]) === minElev) lowest.add(id);
  }
  cached = { frontier, lowest };
  risingSeaSetsByCtx.set(ctx, cached);
  return cached;
}

/**
 * Bot goal (T13a): adjusts `scoreVertex` (`vertexDelta`) for permanent rising-sea drowning exposure.
 * Already-drowned tiles lose their base production score, lowest-elevation frontier tiles are discounted by the
 * rising-sea rate, and higher-elevation or inland tiles receive a safety bonus.
 */
export const risingSeaBotGoal: BotGoalDef = {
  id: 'tidebound.rising_sea',
  goalClass: 'generic',
  vertexDelta(ctx: Ctx, _pid: string, vertexId: number): number {
    const { g, reg } = ctx;
    if (!addonOn(reg, 'tidebound.rising_sea')) return 0;
    const v = g.board.vertices[vertexId];
    if (!v) return 0;

    const { frontier, lowest } = getRisingSeaSetsForCtx(ctx);
    const level = risingSeaLevelOf(g);
    const rateWeight = 0.35 + level * 0.1;

    let delta = 0;
    for (const hId of v.hexIds) {
      const hex = g.board.hexes[hId];
      if (!hex || hex.ext?.hidden || !reg.tiles.get(hex.type)?.land) continue;
      const pips = RISING_SEA_PIP_COUNT[hex.number || 0] || 0;
      if (isDrownedHex(hex)) {
        delta -= pips * 1.5 + 1.5;
        continue;
      }
      const elev = hexElevation(hex);
      if (lowest.has(hId)) {
        delta -= (pips || 1) * rateWeight;
      } else if (frontier.has(hId)) {
        delta -= (pips || 1) * (rateWeight * 0.45) / elev;
      } else {
        delta += 0.35;
      }
      if (elev >= 2) {
        delta += 0.45 * (elev - 1);
      }
    }

    if (v.port && isPortDrowned(g, reg, vertexId)) {
      delta -= 1.5;
    }

    return delta;
  }
};

export const risingSeaAddon: AddonDef = {
  id: 'tidebound.rising_sea',
  name: 'Rising sea',
  description: 'Land drowns from the lowest ground up. Bridges become the only roads. Works alone or with Tides.',
  links: [
    { target: 'tile-state', kind: 'mechanic' },
    { target: 'round-clock', kind: 'mechanic' },
    { target: 'bot-goals', kind: 'bot' },
    { target: 'tidebound.tides', kind: 'content' }
  ],
  register(api) {
    api.define(PORT_IDLE_CHECKS, {
      id: 'tidebound.rising_sea.drowned',
      idle: (g: GameState, reg: Registry, vertexId: number) => isPortDrowned(g, reg, vertexId)
    });
    api.hook('onRoundStart', (ctx: Ctx) => {
      applyRisingSea(ctx);
    });
    api.define(VIEW_DATA, risingSeaViewData);
    api.define(BOT_GOALS, risingSeaBotGoal);
  }
};

