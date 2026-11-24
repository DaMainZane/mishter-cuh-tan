// MODULE: tidebound.tides addon (2026-11-24 rework: the tide is an Event Deck card that picks a height 1 to 3 and a duration of 2 to 5 rounds; every land tile joined to the coast through tiles no higher than the height floods at once; a tide during a tide rises 1 and keeps the longer time left; it retreats when its rounds are over; the Tide level slider sets how many tide cards are in the deck; the `flooded` tile state, ports idle while flooded, the one-turn warning, the title card facts, overlays, elevation data and flood exposure for bots) | DEPENDS ON: packs/base/techEffects, packs/tidebound/harbor, packs/tidebound/seaData, packs/tidebound/seaEvents, shared/index, shared/mapshape, +1 more | USED BY: packs/tidebound/addons.generated, packs/tidebound/fishing, packs/tidebound/index, packs/tidebound/risingSea
import { addonOn, allEventCards, BOT_GOALS, EVENT_CARDS, OVERLAY_KINDS, PORT_IDLE_CHECKS, rngNext, VIEW_DATA } from '../../shared';
import type { AddonDef, BotGoalDef, Ctx, EventCardDef, EventDeckState, GameState, Hex, OverlayKindVisual, Registry, ViewDataDef } from '../../shared';
import { HEX_DIRS } from '../../shared/mapshape';
import { getTileState, setTileState } from '../../shared/tileState';
import { portLevel } from '../base/techEffects';
import { isHarbor } from './harbor';
import { ELEVATION_MAX, ELEVATION_MIN } from './seaData';
import { eventStream } from './seaEvents';

// How it works. A tide card in the Event Deck fires on its round (the deck's timeline shows it 2 to 4 rounds ahead). Its height and duration are
// a hash of the world seed and that round (`tidePick`), so the timeline can show them before it fires. The water then covers every land tile it can
// reach from the sea without climbing above the height (`floodSet`), all at once, and stays until `untilRound`, when the round clock (`applyTides`)
// takes it away. Nothing here draws from `g.rng`.

/**
 * Tile state id. It is the base `flooded` state (half yield rounded up, blocks robber placement; a robber already standing there stays).
 * Tides never set `until`: the tide state clears the tiles it flooded itself, and leaves a flood from anywhere else alone.
 */
export const FLOODED = 'flooded';
/** Event card id in the Event Deck. */
export const TIDE_EVENT_ID = 'tidebound.tide';
/** How many rounds a tide stays: drawn from this range. */
export const TIDE_DURATION_MIN = 2;
export const TIDE_DURATION_MAX = 5;
/**
 * How high a tide rises, and how often (by draw). On the default Tidebound maps height 1 covers about 65% of the land, height 2 about 90% and
 * height 3 all of it (elevation is about 65% / 25% / 10% and the islands are small), so the high tides are rare. A stacked tide can still reach 3.
 */
export const TIDE_HEIGHTS: readonly { height: number; share: number }[] = [
  { height: 1, share: 0.7 },
  { height: 2, share: 0.25 },
  { height: 3, share: 0.05 }
];
const TIDE_SALT = 0x71de5eed;

export interface TideState {
  /** Height of the tide that is up (1 to 3), 0 when the sea is calm. */
  height: number;
  /** The round at whose start the tide retreats. The tide is up in the rounds before it. */
  untilRound: number;
  /** Tiles this tide flooded (ascending). Only these are ever cleared. */
  flooded: number[];
  /** The last rise, for the title card: the round, the new height, until when, how many tiles are under water, and whether it rose on a tide already up. */
  rose: { round: number; height: number; untilRound: number; count: number; stacked: boolean } | null;
}

// ---- The Tide level (the host's slider): how many tide cards the deck holds ----------------------------------------------------------

export const TIDE_LEVEL_MIN = 1;
export const TIDE_LEVEL_MAX = 5;
export const TIDE_DEFAULT_LEVEL = 3;

export interface TideLevelDef {
  name: string;
  /** Tide cards in the Event Deck at this level. */
  copies: number;
}

export const TIDE_LEVELS: readonly TideLevelDef[] = [
  { name: 'Very low', copies: 1 },
  { name: 'Low', copies: 2 },
  { name: 'Medium', copies: 3 },
  { name: 'High', copies: 4 },
  { name: 'Very high', copies: 5 }
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
  return clampLevel(g?.rules?.tideLevel as number);
}

// ---- Heights, elevation and where the water goes ---------------------------------------------------------------------------------------

/** The height and duration of a tide card firing in `round`: a hash of the world seed and the round, so it is known before it fires. */
export function tidePick(seed: number, round: number): { height: number; rounds: number } {
  const rng = eventStream(seed, TIDE_SALT, round);
  const x = rngNext(rng);
  let acc = 0;
  let height = TIDE_HEIGHTS[TIDE_HEIGHTS.length - 1].height;
  for (const h of TIDE_HEIGHTS) {
    acc += h.share;
    if (x < acc) {
      height = h.height;
      break;
    }
  }
  const rounds = TIDE_DURATION_MIN + Math.floor(rngNext(rng) * (TIDE_DURATION_MAX - TIDE_DURATION_MIN + 1));
  return { height, rounds };
}

/**
 * The elevation of a tile: `ext.elevation` from the wide-water perk, 1 to 3 (a tile without it counts as 1), plus `ext.elevationBonus`, which other
 * content may write (Bulwark: +1 for land inside a finished wall zone). With the bonus a tile can stand above 3, where no tide reaches.
 */
export function hexElevation(hex: Hex): number {
  const n = Math.round(Number(hex?.ext?.elevation));
  const base = Number.isFinite(n) ? Math.min(ELEVATION_MAX, Math.max(ELEVATION_MIN, n)) : ELEVATION_MIN;
  return base + Math.max(0, Math.round(Number(hex?.ext?.elevationBonus)) || 0);
}

const keyOf = (q: number, r: number): string => `${q},${r}`;

/**
 * Land hexes that touch the sea: at least one of the six neighbours is water (rivers and lakes count) or missing (the edge of the board is open
 * ocean). Hidden hexes are left out, and a hidden neighbour does not count as sea, so nothing tells anyone what is under the fog.
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

/**
 * The lowest tide that reaches each land tile: the smallest height for which there is a path of visible land from the coast to the tile with no
 * tile on it higher than that height. Tiles no tide reaches (inland, hidden) are missing. Pure: reads the board only.
 */
export function floodThresholds(g: GameState, reg: Registry): Map<number, number> {
  const at = new Map<string, Hex>();
  for (const h of g.board.hexes) at.set(keyOf(h.q, h.r), h);
  const coast = coastHexIds(g, reg).map(id => g.board.hexes[id]);
  const out = new Map<number, number>();
  for (let level = ELEVATION_MIN; level <= ELEVATION_MAX; level++) {
    const queue = coast.filter(h => hexElevation(h) <= level);
    const seen = new Set<number>(queue.map(h => h.id));
    for (let i = 0; i < queue.length; i++) {
      const h = queue[i];
      for (const [dq, dr] of HEX_DIRS) {
        const n = at.get(keyOf(h.q + dq, h.r + dr));
        if (!n || seen.has(n.id) || n.ext?.hidden || !reg.tiles.get(n.type)?.land || hexElevation(n) > level) continue;
        seen.add(n.id);
        queue.push(n);
      }
    }
    for (const id of seen) if (!out.has(id)) out.set(id, level);
  }
  return out;
}

/** The tiles a tide of `height` covers (ascending ids). */
export function floodSet(g: GameState, reg: Registry, height: number): number[] {
  if (!(height > 0)) return [];
  const out: number[] = [];
  for (const [id, t] of floodThresholds(g, reg)) if (t <= height) out.push(id);
  return out.sort((a, b) => a - b);
}

// ---- The tide state, stacking and the timeline projection ------------------------------------------------------------------------------

function freshState(): TideState {
  return { height: 0, untilRound: 0, flooded: [], rose: null };
}

/**
 * The tide data of this game, made on first use. A save from before the rework (a cluster schedule) has its scheduled floods taken off and starts
 * calm, so no tile stays under water forever.
 */
export function ensureTides(g: GameState, reg: Registry): TideState {
  if (!g.ext) g.ext = {};
  if (!g.ext.tidebound) g.ext.tidebound = {};
  const cur = g.ext.tidebound.tides;
  if (cur && typeof cur.height === 'number') return cur as TideState;
  if (cur?.clusters) {
    for (const c of cur.clusters as { hexIds?: number[]; inner?: number[] }[]) {
      for (const id of [...(c.hexIds ?? []), ...(c.inner ?? [])]) {
        if (getTileState(g.board.hexes[id])?.id === FLOODED) setTileState(g, id, null);
      }
    }
  }
  void reg;
  g.ext.tidebound.tides = freshState();
  return g.ext.tidebound.tides as TideState;
}

/** One tide card in `round` on top of a tide (height, until): a tide already up rises 1 (at most 3) and keeps the longer time left; else a fresh tide. */
export function stepTide(height: number, untilRound: number, round: number, seed: number): { height: number; untilRound: number; stacked: boolean } {
  const p = tidePick(seed, round);
  if (height > 0 && round < untilRound) {
    return { height: Math.min(ELEVATION_MAX, height + 1), untilRound: round + Math.max(untilRound - round, p.rounds), stacked: true };
  }
  return { height: p.height, untilRound: round + p.rounds, stacked: false };
}

/** The next events as they will really fire: a pending veto that nobody upheld sends `deck[0]` to the bottom, so the card after it takes its round. */
function effectiveSchedule(g: GameState): { cardId: string; round: number }[] {
  if (!g.rules?.eventsOn) return [];
  const st = g.ext?.core?.eventDeck as EventDeckState | undefined;
  if (!st || !Array.isArray(st.rounds)) return [];
  const vetoed = !!st.pendingVeto && !st.pendingVeto.upheldBy && st.deck[0] === st.pendingVeto.cardId;
  const ids = vetoed ? st.deck.slice(1) : st.deck;
  const out: { cardId: string; round: number }[] = [];
  for (let i = 0; i < Math.min(ids.length, st.rounds.length); i++) out.push({ cardId: ids[i], round: st.rounds[i] });
  return out;
}

/**
 * The tide that will be up in `round` (after that round's events), from the tide now and the tide cards on the timeline up to that round. Null when
 * the sea will be calm. Pure: the timeline detail, the warning and the card itself agree because they all step the same way.
 */
export function projectTide(g: GameState, round: number): { height: number; untilRound: number; stacked: boolean } | null {
  const st = g.ext?.tidebound?.tides as TideState | undefined;
  let height = st && typeof st.height === 'number' ? st.height : 0;
  let untilRound = st?.untilRound ?? 0;
  let stacked = false;
  for (const e of effectiveSchedule(g)) {
    if (e.round > round) break;
    if (e.cardId !== TIDE_EVENT_ID) continue;
    ({ height, untilRound, stacked } = stepTide(height, untilRound, e.round, g.seed));
  }
  return height > 0 && round < untilRound ? { height, untilRound, stacked } : null;
}

/** Puts the tide's tiles under water and takes the rest of its old tiles out. Never overwrites another tile state, never clears a flood it did not make. */
function reconcile(ctx: Ctx, st: TideState): { risen: number[]; fell: number[] } {
  const { g, reg } = ctx;
  const want = new Set(st.height > 0 ? floodSet(g, reg, st.height) : []);
  const risen: number[] = [];
  const fell: number[] = [];
  const keep: number[] = [];
  for (const id of st.flooded) {
    const hex = g.board.hexes[id];
    if (getTileState(hex)?.id !== FLOODED) continue;
    if (want.has(id)) {
      keep.push(id);
    } else {
      setTileState(g, id, null);
      ctx.emit('tileStateChanged', { hexId: id, from: FLOODED, to: null });
      fell.push(id);
    }
  }
  const mine = new Set(keep);
  for (const id of want) {
    if (mine.has(id)) continue;
    if (getTileState(g.board.hexes[id])) continue;
    setTileState(g, id, { id: FLOODED });
    ctx.emit('tileStateChanged', { hexId: id, from: null, to: FLOODED });
    risen.push(id);
    keep.push(id);
  }
  st.flooded = keep.sort((a, b) => a - b);
  return { risen, fell };
}

/**
 * Round start: a tide whose rounds are over retreats, and the board is brought in line with the tide that is up (so a save, a hook order or a
 * board change can never leave stray water). Emits `tideChanged` and logs when the tide goes.
 */
export function applyTides(ctx: Ctx): { risen: number[]; fell: number[] } {
  const { g, reg } = ctx;
  const st = ensureTides(g, reg);
  const round = g.round || 0;
  const wasUp = st.height > 0;
  if (wasUp && round >= st.untilRound) st.height = 0;
  const moved = reconcile(ctx, st);
  if (wasUp && st.height === 0) {
    ctx.emit('tideChanged', { round, height: 0, untilRound: null, stacked: false, risen: moved.risen, fell: moved.fell });
    ctx.log('🌊 The tide retreats', null);
  }
  return moved;
}

/** The tide card: raises the tide for this round (fresh, or 1 higher on a tide already up) and floods the board at once. */
export function raiseTide(ctx: Ctx): { risen: number[]; fell: number[] } {
  const { g, reg } = ctx;
  const st = ensureTides(g, reg);
  const round = g.round || 0;
  if (st.height > 0 && round >= st.untilRound) st.height = 0;
  const next = stepTide(st.height, st.untilRound, round, g.seed);
  st.height = next.height;
  st.untilRound = next.untilRound;
  const moved = reconcile(ctx, st);
  const count = st.flooded.length;
  st.rose = { round, height: st.height, untilRound: st.untilRound, count, stacked: next.stacked };
  ctx.emit('tideChanged', { round, height: st.height, untilRound: st.untilRound, stacked: next.stacked, risen: moved.risen, fell: moved.fell });
  const tiles = `${count} ${count === 1 ? 'tile' : 'tiles'} under water`;
  ctx.log(
    next.stacked
      ? `🌊 The tide rises higher, to height ${st.height}: ${tiles} until round ${st.untilRound}`
      : `🌊 The tide rises to height ${st.height} for ${st.untilRound - round} rounds: ${tiles}`,
    null
  );
  return moved;
}

/** The tide card of the Event Deck. */
export const tideEventCard: EventCardDef = {
  id: TIDE_EVENT_ID,
  title: 'The tide rises',
  description: 'The sea rises to a height of 1 to 3 for 2 to 5 rounds: every coast tile, and every tile joined to it, no higher than that floods. A tide during a tide rises 1 higher.',
  pack: 'tidebound',
  copies: (g: GameState | undefined) => tideLevelDef(g ? tideLevelOf(g) : TIDE_DEFAULT_LEVEL).copies,
  icon: 'waves',
  detail(g: GameState, round: number) {
    const t = projectTide(g, round);
    return t ? `Tide ${t.height} · ${t.untilRound - round} rounds` : undefined;
  },
  apply(ctx) {
    if (!addonOn(ctx.reg, 'tidebound.tides')) return;
    raiseTide(ctx);
  }
};

// ---- Ports idle while flooded ---------------------------------------------------------------------------------------------------------

/**
 * Is the port on this vertex under water? Yes when it touches at least one land tile and every land tile it touches is flooded (a coast vertex
 * between a flooded and a dry tile keeps trading). A harbor and a port raised to 2:1 keep working while flooded.
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

// ---- What the client needs (warning a turn ahead, overlays, elevation, title card) -----------------------------------------------------

export interface TideWarning {
  /** The round whose start brings the tide. */
  round: number;
  height: number;
  /** Rounds it will stay from then. */
  rounds: number;
  /** Tiles that will go under and are dry now. */
  hexIds: number[];
}

/**
 * The warning: one turn ahead. It shows during the last seat's turn of a round (the next thing that happens is the round start, where the tide card
 * fires) for the tiles that are dry now and will be under water then. Null in setup, at game over, with Tides off, or when nothing new will flood.
 */
export function tideWarning(g: GameState, reg: Registry): TideWarning | null {
  if (!g.ext?.tidebound?.tides) return null;
  if (g.phase === 'gameover' || String(g.phase).startsWith('setup')) return null;
  if (g.turn !== g.players.length - 1) return null;
  const next = (g.round || 0) + 1;
  const t = projectTide(g, next);
  if (!t) return null;
  const hexIds = floodSet(g, reg, t.height).filter(id => !getTileState(g.board.hexes[id]));
  if (!hexIds.length) return null;
  return { round: next, height: t.height, rounds: t.untilRound - next, hexIds };
}

export interface TideClientView {
  /** hexId -> overlay for the client's overlay layer: `flood` for a flooded tile, `flood-warn` for a tile the warning is about. */
  overlays: Record<number, { kind: 'flood' | 'flood-warn' }>;
  tide: {
    level: number;
    levelName: string;
    round: number;
    /** The tide up now (0 = calm) and the round it retreats at (null when calm). */
    height: number;
    untilRound: number | null;
    /** The tide that rose at the start of this round, for the title card. Null in any other round. */
    rose: TideState['rose'];
    warning: { round: number; height: number; rounds: number; count: number } | null;
    /** Elevation of every visible land tile, for the heat map. Null when every tile is the same, so there is nothing to show. */
    elevation: Record<number, number> | null;
  };
}

/** Public tide information for the `gameState` the client renders. Null when Tides is not part of this game. Never reads or shows fogged tiles. */
export function tideClientView(g: GameState, reg: Registry): TideClientView | null {
  if (!reg.enabled.has('tidebound.tides') || !g.ext?.tidebound?.tides) return null;
  const st = g.ext.tidebound.tides as Partial<TideState>;
  const level = tideLevelOf(g);
  const round = g.round || 0;
  const overlays: TideClientView['overlays'] = {};
  for (const hex of g.board.hexes) {
    if (hex.ext?.hidden || getTileState(hex)?.id !== FLOODED) continue;
    overlays[hex.id] = { kind: 'flood' };
  }
  const warning = tideWarning(g, reg);
  if (warning) for (const id of warning.hexIds) if (!overlays[id]) overlays[id] = { kind: 'flood-warn' };

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
  const up = typeof st.height === 'number' && st.height > 0 && round < (st.untilRound ?? 0);
  return {
    overlays,
    tide: {
      level,
      levelName: tideLevelDef(level).name,
      round,
      height: up ? st.height! : 0,
      untilRound: up ? st.untilRound! : null,
      rose: st.rose && st.rose.round === round ? { ...st.rose } : null,
      warning: warning ? { round: warning.round, height: warning.height, rounds: warning.rounds, count: warning.hexIds.length } : null,
      elevation: max > min ? elevation : null
    }
  };
}

/**
 * VIEW_DATA entry: the tile overlays (`hexOverlays`) and the public `tide` field of the client state, both from `tideClientView`. While Tides is off
 * the pack's always-on `tidebound.view_defaults` entry supplies `tide: null`.
 */
export const tideViewData: ViewDataDef = {
  id: 'tidebound.tides.view',
  shared: (g: GameState, reg: Registry) => ({ tide: tideClientView(g, reg)?.tide ?? null }),
  overlays: (g: GameState, reg: Registry) => tideClientView(g, reg)?.overlays
};

/**
 * Plain-data look of a flooded tile and of the one-turn-ahead warning (`OVERLAY_KINDS`). Both are a `motif`: one drawing per hex, centred and
 * mirror-symmetric. Flat layers, no gradients, per "Design UI Philosophy.md". Colour is never the only signal: the wave lines are the pattern.
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

// ---- Flood exposure for bots ------------------------------------------------------------------------------------------------------------

const TIDE_PIP_COUNT: Record<number, number> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1
};
/** Rounds between events and rounds a tide stays, on average (the deck's 2 to 4, the card's 2 to 5). */
const AVG_EVENT_GAP = 3;
const AVG_TIDE_ROUNDS = (TIDE_DURATION_MIN + TIDE_DURATION_MAX) / 2;

/** Share of tide draws that reach at least `threshold`. */
function heightShareAtLeast(threshold: number): number {
  return TIDE_HEIGHTS.filter(h => h.height >= threshold).reduce((a, h) => a + h.share, 0);
}

/** About how much of the time a tide is up in this game: the tide cards' share of the deck, times how long a tide stays per event gap. 0 with the deck off. */
export function tideUpShare(g: GameState, reg: Registry): number {
  if (!g.rules?.eventsOn) return 0;
  let total = 0;
  let tide = 0;
  for (const c of allEventCards(reg).values()) {
    const raw = typeof c.copies === 'function' ? c.copies(g) : c.copies;
    const n = Math.max(1, Math.floor(Number(raw ?? 1)) || 1);
    total += n;
    if (c.id === TIDE_EVENT_ID) tide += n;
  }
  if (!total || !tide) return 0;
  return Math.min(0.9, (tide / total) * (AVG_TIDE_ROUNDS / AVG_EVENT_GAP));
}

interface TideLookup {
  thresholds: Map<number, number>;
  up: number;
}

const tideLookupByCtx = new WeakMap<Ctx, TideLookup>();

function lookupFor(ctx: Ctx): TideLookup {
  let cached = tideLookupByCtx.get(ctx);
  if (!cached) {
    cached = { thresholds: floodThresholds(ctx.g, ctx.reg), up: tideUpShare(ctx.g, ctx.reg) };
    tideLookupByCtx.set(ctx, cached);
  }
  return cached;
}

function shareFrom(lookup: TideLookup, hexId: number): number {
  const t = lookup.thresholds.get(hexId);
  return t === undefined ? 0 : lookup.up * heightShareAtLeast(t);
}

/** Expected fraction of rounds (0..1) in which `hexId` is under a tide. Pure: never changes the game. */
export function tideFloodShareForHex(g: GameState, reg: Registry, hexId: number): number {
  if (!addonOn(reg, 'tidebound.tides')) return 0;
  const hex = g.board.hexes[hexId];
  if (!hex || hex.ext?.hidden || !reg.tiles.get(hex.type)?.land) return 0;
  return shareFrom({ thresholds: floodThresholds(g, reg), up: tideUpShare(g, reg) }, hexId);
}

/**
 * Bot goal: adjusts `scoreVertex` (`vertexDelta`) for flood exposure. Tiles the tide often covers are discounted by their expected downtime, high
 * coastal ground that low tides leave dry gets a small bonus, and a plain port whose land floods gets a port-downtime discount.
 */
export const tidesBotGoal: BotGoalDef = {
  id: 'tidebound.tides',
  goalClass: 'generic',
  vertexDelta(ctx: Ctx, _pid: string, vertexId: number): number {
    const { g, reg } = ctx;
    if (!addonOn(reg, 'tidebound.tides')) return 0;
    const v = g.board.vertices[vertexId];
    if (!v) return 0;
    const lookup = lookupFor(ctx);
    let delta = 0;
    let landCount = 0;
    let minPortFloodShare = 1;
    for (const hId of v.hexIds) {
      const hex = g.board.hexes[hId];
      if (!hex || hex.ext?.hidden || !reg.tiles.get(hex.type)?.land) continue;
      landCount++;
      const pips = TIDE_PIP_COUNT[hex.number || 0] || 0;
      const reached = lookup.thresholds.has(hId);
      const share = shareFrom(lookup, hId);
      minPortFloodShare = Math.min(minPortFloodShare, share);
      if (pips > 0 && share > 0) delta -= pips * share * 0.85;
      if (pips > 0 && getTileState(hex)?.id === FLOODED) delta -= pips * 0.2;
      const elev = hexElevation(hex);
      if (reached && elev >= 2 && share < 0.35) delta += 0.4 * (elev - 1);
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
  description: 'Tide events: the sea rises to a height of 1 to 3 for 2 to 5 rounds and floods every coast tile, and every tile joined to it, no higher than that. A flooded tile yields half, rounded up. Needs the Event Deck.',
  links: [
    { target: 'event-deck', kind: 'content' },
    { target: 'tile-state', kind: 'mechanic' },
    { target: 'production', kind: 'mechanic' },
    { target: 'overlay', kind: 'ui' },
    { target: 'bot-goals', kind: 'bot' }
  ],
  register(api) {
    api.define(PORT_IDLE_CHECKS, {
      id: 'tidebound.tides.flooded',
      idle: (g: GameState, reg: Registry, vertexId: number) => isPortFlooded(g, reg, vertexId)
    });
    api.define(EVENT_CARDS, tideEventCard);
    api.hook('onGameStart', (ctx: Ctx) => {
      ensureTides(ctx.g, ctx.reg);
    });
    api.hook('onRoundStart', (ctx: Ctx) => {
      applyTides(ctx);
    });
    api.define(VIEW_DATA, tideViewData);
    api.define(OVERLAY_KINDS, floodOverlayKind);
    api.define(OVERLAY_KINDS, floodWarnOverlayKind);
    api.define(BOT_GOALS, tidesBotGoal);
  }
};
