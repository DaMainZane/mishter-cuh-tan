// MODULE: Tidebound map data (elevation 1 to 3 on land, seeded fish icons on sea tiles), written by the wide_water perk | DEPENDS ON: shared/mapoptions, shared/mapshape, shared/noise, shared/topology | USED BY: packs/tidebound/bridges, packs/tidebound/fishing, packs/tidebound/tides
import type { CellInfo, MapCtx } from '../../shared/mapoptions';
import { HEX_DIRS } from '../../shared/mapshape';
import { cellPoint } from '../../shared/noise';
import type { HexInit } from '../../shared/topology';

// Data only (T2b2, T2c): nothing here runs during a game. Both functions write one key into `hex.ext` and draw nothing from any RNG stream,
// so a recipe without the wide-water pick is untouched and a recipe with it gives the same data every time.
// Readers arrive later: tides resist by `ext.elevation` (T5d), the heat map shows it (T6d), nets read `ext.fish` (T7b, T7c).
// A host can repaint a tile in the lobby and the old key stays on it, so a reader checks the tile type first.

/** Elevation is a whole number from ELEVATION_MIN to ELEVATION_MAX: how many tides the tile resists. */
export const ELEVATION_MIN = 1;
export const ELEVATION_MAX = 3;
/**
 * Where elevation 2 and 3 start on `h`. `h` is rank-normalized over the land cells (0..1, see `buildCellInfo`), so these are shares of the
 * land on any shape: about 10% of the land is elevation 3, 25% is elevation 2 (the next 25%) and 65% is elevation 1. Higher is rarer.
 */
export const ELEVATION_2_FROM = 0.65;
export const ELEVATION_3_FROM = 0.9;

/** Fish boosts a sea tile starts with (the icon counts down from here; Fishing, T7c). */
export const FISH_BOOSTS = 4;
/** Share of the sea tiles next to land that hold fish, and of the open sea beyond. 30% below the first tuning (0.25 and 0.08): fish should hint at a good net spot, not fill the sea. */
export const FISH_SHARE_SHORE = 0.25 * 0.7;
export const FISH_SHARE_OPEN = 0.08 * 0.7;

/** Elevation for a height `h` (0..1): 3 for the top tenth, 2 for the next quarter, else 1. */
export function elevationOf(h: number): number {
  if (h >= ELEVATION_3_FROM) return ELEVATION_MAX;
  if (h >= ELEVATION_2_FROM) return 2;
  return ELEVATION_MIN;
}

const keyOf = (q: number, r: number): string => `${q},${r}`;

/**
 * Writes `ext.elevation` (1 to 3) on every land cell. `cells` are the generator's land cells, with `h` already ranked, so the high ground
 * follows the shape's height field (the realistic terrain style reads the same one). Cells are matched by position, never by order.
 */
export function applyElevation(inits: HexInit[], cells: readonly CellInfo[]): void {
  const at = new Map<string, CellInfo>();
  for (const c of cells) at.set(keyOf(c.q, c.r), c);
  for (const init of inits) {
    const cell = at.get(keyOf(init.q, init.r));
    if (!cell) continue;
    if (!init.ext) init.ext = {};
    init.ext.elevation = elevationOf(cell.h);
  }
}

/** The `count` entries of `ids` with the highest `raw` value. Ties break on position, never on engine sort order. */
function topByValue(ids: number[], raw: number[], count: number): number[] {
  return ids
    .map((_, k) => k)
    .sort((a, b) => raw[b] - raw[a] || a - b)
    .slice(0, Math.max(0, count))
    .map(k => ids[k]);
}

/**
 * Writes `ext.fish` (FISH_BOOSTS) on some sea tiles. A sea tile is a tile that is not land, takes no `noPort` flag and is not a river channel
 * (lakes count). Shore tiles (next to land) get a bigger share than the open sea, because nets sit on the coast. Which tiles is decided by the
 * extras-stage noise, ranked, so there are no RNG draws and fish gather a little into shoals. Counts are fixed by the share, never by the noise.
 */
export function placeFish(inits: HexInit[], ctx: MapCtx): void {
  const at = new Map<string, number>();
  inits.forEach((h, i) => at.set(keyOf(h.q, h.r), i));
  const landAt = (i: number): boolean => !!ctx.reg.tiles.get(inits[i].type)?.land;

  const shore: number[] = [];
  const open: number[] = [];
  inits.forEach((h, i) => {
    const def = ctx.reg.tiles.get(h.type);
    if (def?.land || def?.noPort || h.ext?.river) return;
    const touchesLand = HEX_DIRS.some(([dq, dr]) => {
      const j = at.get(keyOf(h.q + dq, h.r + dr));
      return j !== undefined && landAt(j);
    });
    (touchesLand ? shore : open).push(i);
  });

  const valueOf = (i: number): number => {
    const p = cellPoint(inits[i].q, inits[i].r);
    return ctx.noise(p.x * 0.9 + 211.7, p.y * 0.9 + 83.3, 2);
  };
  const place = (ids: number[], share: number): void => {
    const raw = ids.map(valueOf);
    for (const i of topByValue(ids, raw, Math.round(ids.length * share))) {
      if (!inits[i].ext) inits[i].ext = {};
      inits[i].ext!.fish = FISH_BOOSTS;
    }
  };
  place(shore, FISH_SHARE_SHORE);
  place(open, FISH_SHARE_OPEN);
}
