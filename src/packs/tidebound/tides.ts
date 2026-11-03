// MODULE: tidebound.tides addon (T5a: `flooded` tile state, coast clusters, seeded per-cluster tide schedule applied at round start; T5b: spring tide; T5c: tide level 1 to 5 from the host's slider; T5d: elevation resistance; T5e: ports idle while their land is flooded; T6: warning a turn ahead, overlays and elevation data for the client; T13a: flood exposure in scoreVertex) | DEPENDS ON: packs/base/techEffects, packs/tidebound/harbor, packs/tidebound/seaData, shared/index, shared/mapshape, shared/rng, +1 more | USED BY: packs/tidebound/addons.generated, packs/tidebound/fishing, packs/tidebound/index, packs/tidebound/risingSea
import { addonOn, BOT_GOALS, OVERLAY_KINDS, PORT_IDLE_CHECKS, VIEW_DATA } from '../../shared';
import type { AddonDef, BotGoalDef, Ctx, GameState, Hex, OverlayKindVisual, Registry, ViewDataDef } from '../../shared';
import { HEX_DIRS } from '../../shared/mapshape';
import { createRng, rngInt, rngShuffle } from '../../shared/rng';
import type { RngState } from '../../shared/rng';
import { getTileState, setTileState } from '../../shared/tileState';
import { portLevel } from '../base/techEffects';
import { isHarbor } from './harbor';
import { ELEVATION_MAX, ELEVATION_MIN } from './seaData';

// How it works (T5a). Coast land is split into clusters (a cluster is one stretch of coast, about TIDE_CLUSTER_SIZE tiles). Each cluster
// gets a phase, 0 or 1, from the world seed. At the start of every round the schedule is read and the `flooded` tile state is put on the
// clusters whose turn it is and taken off the rest. A flooded tile produces nothing (the production pipeline already reads the state).
// Nothing here draws from `g.rng`: the clusters use a stream derived from `g.seed`, and the schedule after that is a plain formula of the
// round number. The same seed gives the same tides, and a host who edits the board before the game starts gets clusters for the edited board.

/**
 * Tile state id. It is the base `flooded` state (blocks production and robber placement; a robber already standing there simply stays).
 * The base def hands a flooded tile over to silt when `until` runs out, but tides never set `until`: the schedule clears the state itself.
 */
export const FLOODED = 'flooded';
/** Rounds in one tide cycle at the Medium level ("every other round"). Other levels change it: see TIDE_LEVELS. */
export const TIDE_PERIOD = 2;
/** First round a tide can rise. Round 1 stays dry so nobody opens the game under water; T6 adds the warning a turn ahead. */
export const TIDE_FIRST_ROUND = 2;
/** Target size of one cluster. Bigger stretches of coast are cut into pieces of about this size. A starting guess: tune it with the gallery. */
export const TIDE_CLUSTER_SIZE = 6;
/** Mixed into the world seed to get the tide stream (the event deck uses a different one). */
const TIDE_SEED_SALT = 0x71de5eed;

export interface TideCluster {
  id: number;
  /** Board hex ids, ascending. Only coast land that was visible when the clusters were made (fog tiles never flood, so nothing leaks). */
  hexIds: number[];
  /** Land one step inland of this cluster's coast (visible, not coast itself): the second ring a spring tide reaches. Each tile belongs to one cluster. */
  inner: number[];
  /** 0 or 1: which rounds of the cycle this cluster is flooded in. */
  phase: number;
}

export interface TideState {
  clusters: TideCluster[];
}

/** A spring tide comes every this many rounds at the Medium level (round 4, 8, 12...). Other levels change it: see TIDE_LEVELS. */
export const TIDE_SPRING_EVERY = 4;

// ---- T5c: the tide level (the host's high/low slider) --------------------------------------------------------

export const TIDE_LEVEL_MIN = 1;
export const TIDE_LEVEL_MAX = 5;
/** Medium. This is what T5a and T5b built: every other round, a spring tide every 4th round, the coast ring only on a normal tide. */
export const TIDE_DEFAULT_LEVEL = 3;

/**
 * What one slider position means. High is more aggressive, lasts longer and reaches deeper; low is the opposite.
 *  - period, duration: a cluster is flooded for `duration` rounds out of every `period`. The two phases sit half a period apart.
 *  - springEvery: a spring tide (every cluster, whatever its phase, two rings deep) comes this often.
 *  - reach: rings a normal tide covers (1 = the coast, 2 = the coast and one ring inland). A spring tide always reaches 2.
 *  - strength, springStrength (T5d): how high the water stands. A tile floods when the strength of the tide is at least its elevation,
 *    so elevation 1 floods in any tide, elevation 2 needs strength 2 and elevation 3 needs strength 3.
 * Starting guesses except Medium, which is the earlier behaviour: tune them in the T14 balance gate.
 */
export interface TideLevelDef {
  name: string;
  period: number;
  duration: number;
  springEvery: number;
  reach: 1 | 2;
  strength: 1 | 2 | 3;
  springStrength: 1 | 2 | 3;
}

export const TIDE_LEVELS: readonly TideLevelDef[] = [
  { name: 'Very low', period: 4, duration: 1, springEvery: 6, reach: 1, strength: 1, springStrength: 2 },
  { name: 'Low', period: 3, duration: 1, springEvery: 5, reach: 1, strength: 1, springStrength: 2 },
  { name: 'Medium', period: 2, duration: 1, springEvery: 4, reach: 1, strength: 1, springStrength: 2 },
  { name: 'High', period: 3, duration: 2, springEvery: 4, reach: 1, strength: 2, springStrength: 3 },
  { name: 'Very high', period: 4, duration: 3, springEvery: 3, reach: 2, strength: 2, springStrength: 3 }
];

function clampLevel(level: number): number {
  const n = Math.round(Number(level));
  return Number.isFinite(n) ? Math.min(TIDE_LEVEL_MAX, Math.max(TIDE_LEVEL_MIN, n)) : TIDE_DEFAULT_LEVEL;
}

/** The numbers for a slider position (anything out of range or not a number is clamped, so a bad value can never break a round). */
export function tideLevelDef(level: number = TIDE_DEFAULT_LEVEL): TideLevelDef {
  return TIDE_LEVELS[clampLevel(level) - 1];
}

/** This game's tide level, from `rules.tideLevel` (the lobby sends it only when it is not Medium). */
export function tideLevelOf(g: GameState): number {
  return clampLevel(g.rules?.tideLevel as number);
}

/** The tide stream. Independent of `g.rng`, so Tides on or off never moves a die roll. */
export function deriveTideRng(seed: number): RngState {
  return createRng(((Number(seed) || 1) ^ TIDE_SEED_SALT) >>> 0);
}

/**
 * The schedule: is this cluster under water in this round? A pure formula of the cluster's phase, the round and the tide level.
 * The two phases sit half a period apart, so at Medium (period 2) it is the old "every other round, one phase apart".
 */
export function isFloodedAt(cluster: TideCluster, round: number, level: number = TIDE_DEFAULT_LEVEL): boolean {
  if (round < TIDE_FIRST_ROUND) return false;
  const d = tideLevelDef(level);
  const offset = (cluster.phase ? 1 : 0) * Math.floor(d.period / 2);
  return (round + offset) % d.period < d.duration;
}

/** Is this round a spring tide? Every `springEvery` rounds of the level, starting with the first multiple that is not before TIDE_FIRST_ROUND. */
export function isSpringTide(round: number, level: number = TIDE_DEFAULT_LEVEL): boolean {
  return round >= TIDE_FIRST_ROUND && round % tideLevelDef(level).springEvery === 0;
}

/**
 * How deep the water reaches this cluster in this round: 0 dry, 1 the coast ring, 2 the coast and one ring inland.
 * A spring tide reaches every cluster, whatever its phase, which is what makes the schedule worth reading: a player who has worked out
 * their coast's phase still gets surprised every few rounds. A normal tide reaches the level's `reach`. Whether a tile in that reach
 * actually floods also depends on its elevation (T5d, `applyTides`).
 */
export function floodDepthAt(cluster: TideCluster, round: number, level: number = TIDE_DEFAULT_LEVEL): 0 | 1 | 2 {
  if (isSpringTide(round, level)) return 2;
  return isFloodedAt(cluster, round, level) ? tideLevelDef(level).reach : 0;
}

/** The elevation of a tile (T5d): `ext.elevation` from the wide-water perk, 1 to 3. A tile without it (no perk, or painted by the host) counts as 1. */
export function hexElevation(hex: Hex): number {
  const n = Math.round(Number(hex.ext?.elevation));
  return Number.isFinite(n) ? Math.min(ELEVATION_MAX, Math.max(ELEVATION_MIN, n)) : ELEVATION_MIN;
}

/** How high the water stands in this round (T5d): the level's spring strength on a spring tide, else its normal strength. */
export function tideStrengthAt(round: number, level: number = TIDE_DEFAULT_LEVEL): number {
  const d = tideLevelDef(level);
  return isSpringTide(round, level) ? d.springStrength : d.strength;
}

// ---- Clusters ------------------------------------------------------------------------------------------

const keyOf = (q: number, r: number): string => `${q},${r}`;

/**
 * Land hexes that touch the sea: at least one of the six neighbours is water (rivers and lakes count) or missing (the edge of the
 * board is open ocean, like the ocean edges bridges use). Hidden hexes are left out, and a hidden neighbour does not count as sea,
 * so the clusters never tell anyone what is under the fog.
 */
export function coastHexIds(g: GameState, reg: Registry): number[] {
  const at = new Map<string, Hex>();
  for (const h of g.board.hexes) at.set(keyOf(h.q, h.r), h);
  const isSea = (h: Hex | undefined): boolean => {
    if (!h) return true;
    if (h.ext?.hidden) return false;
    const def = reg.tiles.get(h.type);
    return !!def && !def.land && !def.noPort;
  };
  const out: number[] = [];
  for (const h of g.board.hexes) {
    if (h.ext?.hidden) continue;
    if (!reg.tiles.get(h.type)?.land) continue;
    if (HEX_DIRS.some(([dq, dr]) => isSea(at.get(keyOf(h.q + dq, h.r + dr))))) out.push(h.id);
  }
  return out.sort((a, b) => a - b);
}

/** Steps from the nearest source, over the coast graph. */
function distances(sources: number[], adj: Map<number, number[]>): Map<number, number> {
  const dist = new Map<number, number>();
  const queue: number[] = [];
  for (const s of sources) {
    dist.set(s, 0);
    queue.push(s);
  }
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    for (const n of adj.get(cur) ?? []) {
      if (dist.has(n)) continue;
      dist.set(n, dist.get(cur)! + 1);
      queue.push(n);
    }
  }
  return dist;
}

/** Cuts one connected stretch of coast into pieces of about TIDE_CLUSTER_SIZE: seeds spread out far from each other, each tile joins the nearest seed. */
function splitStretch(ids: number[], adj: Map<number, number[]>, rng: RngState): number[][] {
  const k = Math.ceil(ids.length / TIDE_CLUSTER_SIZE);
  if (k <= 1) return [ids];
  const seeds = [ids[rngInt(rng, ids.length)]];
  while (seeds.length < k) {
    const dist = distances(seeds, adj);
    let best = ids[0];
    let bestD = -1;
    for (const id of ids) {
      const d = dist.get(id) ?? 0;
      if (d > bestD) {
        best = id;
        bestD = d;
      }
    }
    seeds.push(best);
  }
  // Nearest seed wins; a tie goes to the earlier seed (queue order), so the result never depends on engine sort order.
  const owner = new Map<number, number>();
  const queue: number[] = [];
  seeds.forEach((s, i) => {
    owner.set(s, i);
    queue.push(s);
  });
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    for (const n of adj.get(cur) ?? []) {
      if (owner.has(n)) continue;
      owner.set(n, owner.get(cur)!);
      queue.push(n);
    }
  }
  const groups: number[][] = seeds.map(() => []);
  for (const id of ids) groups[owner.get(id)!].push(id);
  return groups.filter(gr => gr.length > 0);
}

/**
 * Builds the clusters for a board: coast tiles, joined into stretches, stretches cut into pieces, then a phase for each piece.
 * Phases are dealt out half and half (a seeded shuffle decides who gets which), so with two or more clusters both phases always exist
 * and the whole coast never floods in the same round by bad luck. Uses only the derived tide stream.
 */
export function buildTideClusters(g: GameState, reg: Registry): TideCluster[] {
  const coast = coastHexIds(g, reg);
  if (coast.length === 0) return [];
  const rng = deriveTideRng(g.seed);

  const at = new Map<string, number>();
  for (const id of coast) at.set(keyOf(g.board.hexes[id].q, g.board.hexes[id].r), id);
  const adj = new Map<number, number[]>();
  for (const id of coast) {
    const h = g.board.hexes[id];
    const near: number[] = [];
    for (const [dq, dr] of HEX_DIRS) {
      const n = at.get(keyOf(h.q + dq, h.r + dr));
      if (n !== undefined) near.push(n);
    }
    adj.set(id, near);
  }

  // Stretches in ascending order of their lowest hex id.
  const seen = new Set<number>();
  const groups: number[][] = [];
  for (const start of coast) {
    if (seen.has(start)) continue;
    const comp = [...distances([start], adj).keys()];
    for (const id of comp) seen.add(id);
    comp.sort((a, b) => a - b);
    groups.push(...splitStretch(comp, adj, rng));
  }

  const offset = rngInt(rng, 2);
  const phases: number[] = new Array(groups.length).fill(0);
  rngShuffle(rng, groups.map((_, i) => i)).forEach((gi, k) => {
    phases[gi] = (k + offset) % 2;
  });

  // Second ring: visible land that is not coast but touches it. A tile touching several clusters goes to the first one found (neighbour order).
  const clusterOf = new Map<number, number>();
  groups.forEach((ids, i) => ids.forEach(id => clusterOf.set(id, i)));
  const inner: number[][] = groups.map(() => []);
  for (const h of g.board.hexes) {
    if (h.ext?.hidden || clusterOf.has(h.id) || !reg.tiles.get(h.type)?.land) continue;
    for (const [dq, dr] of HEX_DIRS) {
      const n = at.get(keyOf(h.q + dq, h.r + dr));
      if (n === undefined) continue;
      inner[clusterOf.get(n)!].push(h.id);
      break;
    }
  }
  return groups.map((hexIds, i) => ({ id: i, hexIds, inner: inner[i], phase: phases[i] }));
}

/** The tide data of this game, built on first use (game start; or the first round of a save made before Tides existed). */
export function ensureTides(g: GameState, reg: Registry): TideState {
  if (!g.ext) g.ext = {};
  if (!g.ext.tidebound) g.ext.tidebound = {};
  if (!g.ext.tidebound.tides) g.ext.tidebound.tides = { clusters: buildTideClusters(g, reg) } satisfies TideState;
  return g.ext.tidebound.tides as TideState;
}

// ---- Applying the schedule -----------------------------------------------------------------------------

/**
 * Puts `flooded` on every tile the water reaches this round (`floodDepthAt`: the coast ring, and on a spring tide the ring inland too) and
 * takes it off the rest. A tile that already holds another state (ash, barren, fertile...) is not overwritten: it simply stays dry that round,
 * and its own state is never cleared here. Emits `tileStateChanged` per tile and one `tideChanged { round, spring, risen, fell }` (hex ids)
 * when anything moved, for T6's title card.
 */
export function applyTides(ctx: Ctx): { risen: number[]; fell: number[] } {
  const { g, reg } = ctx;
  const st = ensureTides(g, reg);
  const level = tideLevelOf(g);
  const risen: number[] = [];
  const fell: number[] = [];
  // T5d: tiles the water reached this round that the tide was too weak to flood, because their ground is high enough.
  const held: number[] = [];
  const set = (id: number, reached: boolean, strength: number): void => {
    const hex = g.board.hexes[id];
    if (!hex) return;
    const cur = getTileState(hex);
    const up = reached && strength >= hexElevation(hex);
    if (reached && !up) held.push(id);
    if (up) {
      if (cur) return;
      setTileState(g, id, { id: FLOODED });
      ctx.emit('tileStateChanged', { hexId: id, from: null, to: FLOODED });
      risen.push(id);
    } else if (cur?.id === FLOODED) {
      setTileState(g, id, null);
      ctx.emit('tileStateChanged', { hexId: id, from: FLOODED, to: null });
      fell.push(id);
    }
  };
  for (const c of st.clusters) {
    const depth = floodDepthAt(c, g.round, level);
    const strength = depth > 0 ? tideStrengthAt(g.round, level) : 0;
    for (const id of c.hexIds) set(id, depth >= 1, strength);
    for (const id of c.inner ?? []) set(id, depth >= 2, strength);
  }
  const spring = isSpringTide(g.round, level);
  if (risen.length || fell.length) {
    ctx.emit('tideChanged', { round: g.round, spring, risen, fell, ...(held.length ? { held } : {}) });
    if (risen.length) {
      const n = risen.length;
      const rest = held.length ? `; ${held.length} higher ${held.length === 1 ? 'tile holds' : 'tiles hold'}` : '';
      ctx.log(spring ? `🌊 Spring tide! The sea reaches two tiles inland: ${n} ${n === 1 ? 'tile floods' : 'tiles flood'}${rest}` : `🌊 The tide rises over ${n} coast ${n === 1 ? 'tile' : 'tiles'}${rest}`, null);
    }
  }
  return { risen, fell };
}

// ---- T5e: ports idle while flooded ---------------------------------------------------------------------------

/**
 * Is the port on this vertex under water? Yes when it touches at least one land tile and every land tile it touches is flooded (a coast vertex
 * between a flooded and a dry tile keeps trading). Sea tiles do not count. Hidden (fog) land never floods, so it keeps the port working.
 * A harbor (T8) keeps working while flooded, so it is never idle here or in `PORT_IDLE_CHECKS`. Neither is a port raised to 2:1 by Harbor charters
 * (any upgraded port, level 1 or 2): an upgraded port is a harbor of sorts, and the flood must not undo the upgrade you paid for.
 */
export function isPortFlooded(g: GameState, reg: Registry, vertexId: number): boolean {
  if (portLevel(g, vertexId) >= 1) return false;
  if (addonOn(reg, 'tidebound.harbor') && isHarbor(g, vertexId)) return false;
  const v = g.board.vertices[vertexId];
  if (!v) return false;
  let land = 0;
  for (const id of v.hexIds) {
    const hex = g.board.hexes[id];
    if (!hex || !reg.tiles.get(hex.type)?.land) continue;
    land++;
    if (getTileState(hex)?.id !== FLOODED) return false;
  }
  return land > 0;
}

// ---- T6: what the client needs (warning a turn ahead, overlays, elevation, title card) ------------------------

/**
 * The tiles a tide in `round` floods, by the same rules as `applyTides` (depth, strength against elevation) but changing nothing.
 * Pure: a formula of the clusters, the round and the level.
 */
export function floodPlan(g: GameState, round: number): number[] {
  const st = g.ext?.tidebound?.tides as TideState | undefined;
  if (!st) return [];
  const level = tideLevelOf(g);
  const strength = tideStrengthAt(round, level);
  const out: number[] = [];
  for (const c of st.clusters) {
    const depth = floodDepthAt(c, round, level);
    if (depth < 1) continue;
    for (const id of c.hexIds) if (strength >= hexElevation(g.board.hexes[id])) out.push(id);
    if (depth >= 2) for (const id of c.inner ?? []) if (strength >= hexElevation(g.board.hexes[id])) out.push(id);
  }
  return out;
}

export interface TideWarning {
  /** The round whose start brings the tide. */
  round: number;
  spring: boolean;
  /** Tiles that will go under and are dry now. */
  hexIds: number[];
}

/**
 * The warning: one turn ahead, not a whole round. It shows during the last seat's turn of a round (the next thing that happens is the round
 * start, where the tide rises), for the tiles that are dry now and will flood then. Null in setup, at game over, with Tides off, or when
 * nothing new will rise.
 */
export function tideWarning(g: GameState): TideWarning | null {
  if (!g.ext?.tidebound?.tides) return null;
  if (g.phase === 'gameover' || String(g.phase).startsWith('setup')) return null;
  if (g.turn !== g.players.length - 1) return null;
  const next = (g.round || 0) + 1;
  if (next < TIDE_FIRST_ROUND) return null;
  // A tile that already holds any state is left alone by the tide: it is not warned about (it is flooded already, or another state keeps it dry).
  const hexIds = floodPlan(g, next).filter(id => !getTileState(g.board.hexes[id]));
  if (!hexIds.length) return null;
  return { round: next, spring: isSpringTide(next, tideLevelOf(g)), hexIds };
}

export interface TideClientView {
  /** hexId -> overlay for the client's overlay layer: `flood` for a flooded tile, `flood-warn` for a tile the warning is about. */
  overlays: Record<number, { kind: 'flood' | 'flood-warn' }>;
  tide: {
    level: number;
    levelName: string;
    round: number;
    /** Tides that rose at the start of this round (tiles dry in the round before, flooded now), for the title card. Null when nothing rose. */
    rose: { round: number; spring: boolean; count: number } | null;
    warning: { round: number; spring: boolean; count: number } | null;
    /** Elevation of every visible land tile, for the heat map. Null when every tile is the same, so there is nothing to show. */
    elevation: Record<number, number> | null;
  };
}

/** Public tide information for the `gameState` the client renders. Null when Tides is not part of this game. Never reads or shows fogged tiles. */
export function tideClientView(g: GameState, reg: Registry): TideClientView | null {
  if (!reg.enabled.has('tidebound.tides') || !g.ext?.tidebound?.tides) return null;
  const level = tideLevelOf(g);
  const round = g.round || 0;
  const overlays: TideClientView['overlays'] = {};
  const flooded = new Set<number>();
  for (const hex of g.board.hexes) {
    if (hex.ext?.hidden || getTileState(hex)?.id !== FLOODED) continue;
    flooded.add(hex.id);
    overlays[hex.id] = { kind: 'flood' };
  }
  const warning = tideWarning(g);
  if (warning) for (const id of warning.hexIds) if (!overlays[id]) overlays[id] = { kind: 'flood-warn' };

  let rose: TideClientView['tide']['rose'] = null;
  if (round >= TIDE_FIRST_ROUND && flooded.size) {
    const before = new Set(floodPlan(g, round - 1));
    const count = floodPlan(g, round).filter(id => flooded.has(id) && !before.has(id)).length;
    if (count > 0) rose = { round, spring: isSpringTide(round, level), count };
  }

  const elevation: Record<number, number> = {};
  let min = Infinity;
  let max = -Infinity;
  for (const hex of g.board.hexes) {
    if (hex.ext?.hidden || !reg.tiles.get(hex.type)?.land) continue;
    const e = hexElevation(hex);
    elevation[hex.id] = e;
    min = Math.min(min, e);
    max = Math.max(max, e);
  }
  return {
    overlays,
    tide: {
      level,
      levelName: tideLevelDef(level).name,
      round,
      rose,
      warning: warning ? { round: warning.round, spring: warning.spring, count: warning.hexIds.length } : null,
      elevation: max > min ? elevation : null
    }
  };
}

/**
 * VIEW_DATA entry (R7a.5, group 5): the tile overlays (`hexOverlays`) and the public `tide` field of the client state, both from `tideClientView`.
 * Registered inside the tides addon. `overlays()` returns `undefined` while there is no tide view, so the merged `hexOverlays` stays `null`; with a view
 * it returns the overlays object (`{}` when nothing is marked, as the old code sent). While Tides is off the pack's always-on `tidebound.view_defaults`
 * entry supplies `tide: null`. The view is built once per call (it is pure), so the two parts each build it.
 */
export const tideViewData: ViewDataDef = {
  id: 'tidebound.tides.view',
  shared: (g: GameState, reg: Registry) => ({ tide: tideClientView(g, reg)?.tide ?? null }),
  overlays: (g: GameState, reg: Registry) => tideClientView(g, reg)?.overlays
};

/**
 * R8.8: plain-data look of a flooded tile and of the one-turn-ahead warning (`OVERLAY_KINDS`). Sent in the visual manifest only while Tides is on.
 * Both are a `motif`: one drawing per hex, centred and mirror-symmetric (calm when zoomed out, no board-wide tiling). Flat layers, no gradients, per
 * "Design UI Philosophy.md" (Bad North calm sea, flat facets): two stacked translucent discs for depth, then three wave lines (crests on both sides of
 * a centre trough). Colour is never the only signal: the wave lines are the pattern, "Flooded" is the label.
 */
const FLOOD_WAVES = (extra: string): string =>
  [
    'M 24 40 Q 37 30 50 40 Q 63 30 76 40',
    'M 16 54 Q 33 42 50 54 Q 67 42 84 54',
    'M 24 68 Q 37 58 50 68 Q 63 58 76 68'
  ]
    .map(d => `<path d="${d}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" ${extra} />`)
    .join('');

export const floodOverlayKind: OverlayKindVisual = {
  id: 'flood',
  label: 'Flooded',
  tint: { light: 'rgba(21, 62, 112, 0.56)', dark: 'rgba(18, 54, 102, 0.62)' },
  line: { light: 'rgba(186, 230, 253, 0.92)', dark: 'rgba(186, 230, 253, 0.95)' },
  pattern:
    '<circle cx="50" cy="50" r="40" fill="currentColor" fill-opacity="0.12" />' +
    '<circle cx="50" cy="50" r="24" fill="currentColor" fill-opacity="0.14" />' +
    FLOOD_WAVES('stroke-width="3.4"'),
  motif: true
};

/** The warning is the same motif drawn as dashes: `pathLength="100"` with `12 10` gives five dashes with both ends dashed, so it stays symmetric. */
export const floodWarnOverlayKind: OverlayKindVisual = {
  id: 'flood-warn',
  label: 'Flood warning',
  tint: { light: 'rgba(29, 78, 137, 0.30)', dark: 'rgba(29, 78, 137, 0.34)' },
  line: { light: 'rgba(33, 92, 140, 0.85)', dark: 'rgba(168, 222, 245, 0.9)' },
  pattern:
    '<circle cx="50" cy="50" r="40" fill="currentColor" fill-opacity="0.08" />' +
    FLOOD_WAVES('pathLength="100" stroke-width="3" stroke-dasharray="12 10"'),
  motif: true,
  pulse: true
};

// ---- T13a: Flood exposure in scoreVertex ---------------------------------------------------------------------

const TIDE_PIP_COUNT: Record<number, number> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1
};

/**
 * Expected fraction of rounds (0..1) in which `hexId` is flooded by Tides at the game's current `tideLevel`,
 * accounting for coast vs inner ring and `hexElevation` resistance. Pure: never mutates `g.ext`.
 */
export function tideFloodShareForHex(g: GameState, reg: Registry, hexId: number): number {
  if (!addonOn(reg, 'tidebound.tides')) return 0;
  const hex = g.board.hexes[hexId];
  if (!hex || hex.ext?.hidden || !reg.tiles.get(hex.type)?.land) return 0;
  const clusters: TideCluster[] = (g.ext?.tidebound?.tides as TideState | undefined)?.clusters ?? buildTideClusters(g, reg);
  let inCoast = false;
  let inInner = false;
  for (const c of clusters) {
    if (c.hexIds.includes(hexId)) {
      inCoast = true;
      break;
    }
    if ((c.inner ?? []).includes(hexId)) {
      inInner = true;
      break;
    }
  }
  if (!inCoast && !inInner) return 0;

  const level = tideLevelOf(g);
  const def = tideLevelDef(level);
  const elev = hexElevation(hex);
  const normalReaches = inCoast || (inInner && def.reach >= 2);
  const normalFloods = normalReaches && def.strength >= elev;
  const springFloods = (inCoast || inInner) && def.springStrength >= elev;

  const normalShare = normalFloods ? def.duration / def.period : 0;
  const springShare = springFloods ? (1 - normalShare) * (1 / def.springEvery) : 0;
  return Math.min(1, normalShare + springShare);
}

/**
 * Bot goal (T13a): adjusts `scoreVertex` (`vertexDelta`) for flood exposure on coastal and inner-ring tiles.
 * Low-elevation tiles that flood frequently are discounted by their expected flood downtime, while high-elevation
 * coastal ground that resists normal tides receives a resilience bonus. Non-harbor ports whose land tiles flood
 * also receive a port-downtime discount.
 */
export const tidesBotGoal: BotGoalDef = {
  id: 'tidebound.tides',
  goalClass: 'generic',
  vertexDelta(ctx: Ctx, _pid: string, vertexId: number): number {
    const { g, reg } = ctx;
    if (!addonOn(reg, 'tidebound.tides')) return 0;
    const v = g.board.vertices[vertexId];
    if (!v) return 0;

    const clusters: TideCluster[] = (g.ext?.tidebound?.tides as TideState | undefined)?.clusters ?? buildTideClusters(g, reg);
    const tideZone = new Set<number>();
    for (const c of clusters) {
      for (const id of c.hexIds) tideZone.add(id);
      for (const id of c.inner ?? []) tideZone.add(id);
    }

    let delta = 0;
    let landCount = 0;
    let minPortFloodShare = 1;

    for (const hId of v.hexIds) {
      const hex = g.board.hexes[hId];
      if (!hex || hex.ext?.hidden || !reg.tiles.get(hex.type)?.land) continue;
      landCount++;
      const pips = TIDE_PIP_COUNT[hex.number || 0] || 0;
      const share = tideFloodShareForHex(g, reg, hId);
      minPortFloodShare = Math.min(minPortFloodShare, share);

      if (pips > 0 && share > 0) {
        delta -= pips * share * 0.85;
      }
      if (pips > 0 && getTileState(hex)?.id === FLOODED) {
        delta -= pips * 0.2;
      }
      const elev = hexElevation(hex);
      if (tideZone.has(hId) && elev >= 2 && share < 0.35) {
        delta += 0.4 * (elev - 1);
      }
    }

    if (v.port && landCount > 0 && minPortFloodShare > 0 && portLevel(g, vertexId) < 1 && !(addonOn(reg, 'tidebound.harbor') && isHarbor(g, vertexId))) {
      delta -= 0.6 * minPortFloodShare;
    }

    return delta;
  }
};

export const tidesAddon: AddonDef = {
  id: 'tidebound.tides',
  name: 'Tides',
  description: 'Coast tiles flood on a seeded schedule; a flooded tile yields half, rounded up, for every settlement and city on it. Higher ground resists.',
  links: [
    { target: 'round-clock', kind: 'mechanic' },
    { target: 'tile-state', kind: 'mechanic' },
    { target: 'production', kind: 'mechanic' },
    { target: 'overlay', kind: 'ui' },
    { target: 'bot-goals', kind: 'bot' }
  ],
  // T5a flooded state and per-cluster schedule, T5b spring tide, T5c tide level (`rules.tideLevel`, the host's slider; on or off is the addon
  // toggle), T5d elevation resistance, T5e ports idle while flooded (the production stage already skips flooded tiles through the tile state
  // layer), T6 warning, title card, flooded tint and heat map (data from `tideClientView`, drawn by the client overlay kit), T13a flood exposure in scoreVertex.
  register(api) {
    api.define(PORT_IDLE_CHECKS, {
      id: 'tidebound.tides.flooded',
      idle: (g: GameState, reg: Registry, vertexId: number) => isPortFlooded(g, reg, vertexId)
    });
    api.hook('onGameStart', (ctx: Ctx) => {
      ensureTides(ctx.g, ctx.reg);
    });
    api.hook('onRoundStart', (ctx: Ctx) => {
      applyTides(ctx);
    });
    // R7a.5: the flood overlays and the tide facts for the client state.
    api.define(VIEW_DATA, tideViewData);
    // R8.8: the `flood` and `flood-warn` overlay visuals for the manifest.
    api.define(OVERLAY_KINDS, floodOverlayKind);
    api.define(OVERLAY_KINDS, floodWarnOverlayKind);
    // T13a: flood exposure in scoreVertex.
    api.define(BOT_GOALS, tidesBotGoal);
  }
};

