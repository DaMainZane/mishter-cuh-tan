// MODULE: generic piece UI model (R8.7: pure functions that turn the visual manifest and a player's `pieces[id]` data into buttons, badges, hints, recipe strips with their stacked cost cards, spots and shapes; no DOM, no socket, no store) | DEPENDS ON: client/icons, client/types, shared/visual | USED BY: client/actions, client/pieceui, client/render/board, client/render/hand, client/render/overlay, client/render/techpanel
import { getMiniSvg, shade, uiIcon } from './icons';
import type { PlayerView, Resources, TechActionsView } from './types';
import type { ManifestEntry, PiecePlayerData } from '../shared/visual';

// R8.7. Everything here is a function of plain data, so `tests/pieceModel.test.ts` runs it in node with no DOM. The impure half (reading the store, writing the
// page, emitting to the socket) is `client/pieceui.ts`. Contract: `Visual Manifest Design.md`, sections c, d, h and i.

/** The part of a player view this module reads. A spectator's target player works the same way as `me`. */
export type PieceViewer = Pick<PlayerView, 'resources' | 'pieces'> | null | undefined;

/** One generated build-bar button. Entries with the same `button.group` share one (bridge and rickety bridge). */
export interface PieceButtonModel {
  /** The build mode the button turns on: the group name, or the entry id when there is no group. */
  mode: string;
  /** Entries behind the button, ordered by `button.order`, then id. */
  entries: ManifestEntry[];
  /** Label and icon come from the first entry (design section d). */
  label: string;
  icon: string;
  order: number;
}

/** One clickable spot: the entry that lists the location first (by order), and the location (a vertex, edge or hex id, by the entry's slot). */
export interface SpotRef {
  entry: ManifestEntry;
  loc: number;
}

/** Just the board geometry the spot and shape drawing needs. The client `GameState.board` fits it. */
export interface BoardGeom {
  vertices: { x: number; y: number }[];
  edges: { v1: number; v2: number }[];
  hexes: { x: number; y: number }[];
}

const DEFAULT_ORDER = 100;
const DEFAULT_RIM = 3.4;
/** Modes and ids end up inside inline `onclick="..."` and element ids, so only plain characters pass. */
const SAFE_ID = /^[A-Za-z0-9_.:-]+$/;
const COLOR_OK = /^#[0-9a-f]{3,8}$/i;
const FALLBACK_COLOR = '#888888';

function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function orderOf(e: ManifestEntry): number {
  return e.button.order ?? DEFAULT_ORDER;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escText(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ESCAPES[c]);
}

/** SVG the client is willing to put into the page. The server already checks this (`visualProblems`); this is the second lock on the client's door. */
export function isSafeFragment(s: string): boolean {
  return !(/<\s*script/i.test(s) || /<\s*foreignObject/i.test(s) || /\son[a-z]+\s*=/i.test(s) || /javascript:/i.test(s));
}

export function isSafeCss(s: string): boolean {
  return !(/<|@import|expression\s*\(|javascript:/i.test(s));
}

// ---- Buttons -----------------------------------------------------------------------------------------------------------------

/** The build mode of an entry: its group, or its id. */
export function modeOf(e: ManifestEntry): string {
  return e.button.group || e.id;
}

/** Groups the manifest entries into buttons, in button order. An entry whose id or group is not a plain identifier is left out. */
export function buttonModels(entries: readonly ManifestEntry[]): PieceButtonModel[] {
  const byMode = new Map<string, PieceButtonModel>();
  const sorted = [...entries].sort((a, b) => orderOf(a) - orderOf(b) || byText(a.id, b.id));
  for (const e of sorted) {
    const mode = modeOf(e);
    if (!SAFE_ID.test(mode) || !SAFE_ID.test(e.id)) continue;
    let m = byMode.get(mode);
    if (!m) {
      m = { mode, entries: [], label: e.button.label, icon: e.button.icon, order: orderOf(e) };
      byMode.set(mode, m);
    }
    m.entries.push(e);
  }
  return [...byMode.values()].sort((a, b) => a.order - b.order || byText(a.mode, b.mode));
}

/** The model for one build mode, or undefined when the mode is not a generated one (road, settlement, city, an old hard-coded button, or none). */
export function modelForMode(entries: readonly ManifestEntry[], mode: string | null | undefined): PieceButtonModel | undefined {
  if (!mode) return undefined;
  return buttonModels(entries).find(m => m.mode === mode);
}

/** The entries of a button that are on offer to this player (a key in `pieces`). */
export function offeredEntries(model: PieceButtonModel, viewer: PieceViewer): ManifestEntry[] {
  const pieces = viewer?.pieces;
  return pieces ? model.entries.filter(e => pieces[e.id] !== undefined) : [];
}

/** Can the viewer pay `cost` from their hand? An empty price is always payable. */
export function canPay(viewer: PieceViewer, cost: Resources | undefined): boolean {
  const hand = viewer?.resources;
  if (!hand) return false;
  return Object.entries(cost ?? {}).every(([r, n]) => (hand[r] || 0) >= (Number(n) || 0));
}

/**
 * Is the button shown? In a game: when the viewer has any of its entries on offer (an absent key means the addon is off or the tech is missing).
 * In the lobby nobody has `pieces` yet, so it is shown as a preview of what the game will have (the manifest only holds addons that are on).
 */
export function buttonVisible(model: PieceButtonModel, viewer: PieceViewer, inLobby: boolean): boolean {
  return inLobby || offeredEntries(model, viewer).length > 0;
}

/** The badge number: the supply left of the first offered entry that has one. Null means no badge (an action, or no data yet). */
export function badgeFor(model: PieceButtonModel, viewer: PieceViewer): number | null {
  const pieces = viewer?.pieces;
  if (!pieces) return null;
  for (const e of offeredEntries(model, viewer)) {
    const left = pieces[e.id]?.left;
    if (typeof left === 'number') return left;
  }
  return null;
}

/** The price shown in the button's recipe popup: the first offered entry's price. */
export function recipeCostFor(model: PieceButtonModel, viewer: PieceViewer): Resources | undefined {
  const first = offeredEntries(model, viewer)[0];
  return first ? viewer?.pieces?.[first.id]?.cost : undefined;
}

/**
 * The toast when a mode is switched on and nothing can be done, first match wins (design section d): the supply is used up (`noSupply`), the player cannot
 * pay (`cannotAfford`), they can pay but nothing is legal (`noSpots`). For a group the step applies when it holds for every entry on offer.
 * Null when something can be done, or when the server has not computed the spots (`spots: null`, so not your turn: no hint is better than a wrong one).
 */
export function modeHint(model: PieceButtonModel, viewer: PieceViewer): string | null {
  const pieces = viewer?.pieces;
  if (!pieces) return null;
  const offered = offeredEntries(model, viewer);
  if (offered.length === 0) return null;
  const data = (e: ManifestEntry): PiecePlayerData => pieces[e.id];
  if (offered.every(e => data(e).left === 0)) {
    const text = offered.map(e => e.hints.noSupply).find(t => !!t);
    if (text) return text;
  }
  const inSupply = offered.filter(e => data(e).left !== 0);
  const payable = inSupply.filter(e => canPay(viewer, data(e).cost));
  if (payable.length === 0) return (inSupply[0] ?? offered[0]).hints.cannotAfford;
  if (payable.every(e => Array.isArray(data(e).spots) && data(e).spots!.length === 0)) return payable[0].hints.noSpots;
  return null;
}

// ---- Markup: button, recipe strip ------------------------------------------------------------------------------------------------

/** The icon of a button: a UI icon name, or inline SVG (a full `<svg>` as is, or the inner shapes of a 24x24 box). */
export function iconHtml(icon: string): string {
  if (icon.startsWith('<')) {
    if (!isSafeFragment(icon)) return uiIcon('plus', 22);
    if (/^<svg[\s>]/i.test(icon)) return `<span>${icon}</span>`;
    return `<span><svg class="ui-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg></span>`;
  }
  const svg = uiIcon(icon, 22) || uiIcon('plus', 22);
  return `<span data-icon="${escText(icon)}" data-size="22">${svg}</span>`;
}

/** One build-bar button, hidden until `renderPieceButtons` shows it. Same classes as the hand-written ones in `public/index.html`. */
export function buttonHtml(model: PieceButtonModel): string {
  const m = model.mode;
  return `<button class="act-btn has-recipe" id="pieceBtn-${m}" data-piece-mode="${m}" style="display:none;" onclick="setBuildMode('${m}')" title="${escText(model.label)}">`
    + `<div class="btn-recipe-popup" id="recipePopup-${m}"></div>`
    + `<span class="piece-badge" id="pieceBadge-${m}" style="display:none;"></span>`
    + `${iconHtml(model.icon)}<span class="lbl">${escText(model.label)}</span></button>`;
}

/** Most cards one stack of a cost shows. A bigger count continues in another stack, like a tally (BUG 5). */
export const COST_STACK_MAX = 4;

/** Splits a count into stack sizes of at most `max`: 3 gives [3], 6 gives [4, 2], 12 gives [4, 4, 4]. Zero, a negative or a non-number gives none. */
export function stackSizes(count: number, max: number = COST_STACK_MAX): number[] {
  const n = Math.floor(Number(count));
  const cap = Math.max(1, Math.floor(max));
  if (!Number.isFinite(n) || n <= 0) return [];
  const out: number[] = [];
  for (let left = n; left > 0; left -= cap) out.push(Math.min(cap, left));
  return out;
}

/**
 * The cards of one resource in a cost, as overlapped stacks instead of a row (BUG 5). The first card is in front and each card behind it peeks out to the
 * right and down (`--i` is its layer, `--n` the stack size, read by `.recipe-stack` in styles.css), so the visible edges are the count. A stack holds at most
 * `COST_STACK_MAX` cards; the rest continue in the next stack. The first `owned` units are lit (`has-res`) and the rest dim, counted across stacks.
 * Empty for a zero count or a resource name that is not plain (it ends up in a class name). Every place that draws a cost goes through this one function.
 */
export function costStackHtml(resource: string, count: number, owned: number): string {
  if (!/^[a-z_]+$/i.test(resource)) return '';
  const have = Math.max(0, Math.floor(Number(owned) || 0));
  let unit = 0;
  return stackSizes(count).map(size => {
    const layers = Array.from({ length: size }, (_, i) => {
      unit++;
      const lit = have >= unit;
      return `<div class="recipe-mini-card card-${resource} ${lit ? 'has-res' : 'lacks-res'}" style="--i:${i}">${getMiniSvg(resource)}</div>`;
    }).join('');
    return `<div class="recipe-stack" style="--n:${size}">${layers}</div>`;
  }).join('');
}

/** The price strip of a recipe popup: one stack per resource (more than four of one continues in another stack). The server's price already includes any 2x scaling. */
export function recipeStripHtml(cost: Resources | undefined, hand: Resources | undefined): string {
  const stacks = Object.entries(cost ?? {}).map(([r, n]) => costStackHtml(r, Number(n) || 0, hand?.[r] || 0)).join('');
  return stacks ? `<div class="recipe-cards-strip">${stacks}</div>` : '';
}

// ---- Spots -------------------------------------------------------------------------------------------------------------

/** One port that Harbor charters can raise from 3:1 to 2:1: a hotspot on the board (BUG 4). `cost` and `affordable` are what a cost tooltip or popover option needs (BUG 5). */
export interface PortRaiseSpot {
  vertexId: number;
  cost: Resources;
  affordable: boolean;
}

/**
 * The hotspots for raising a port (action `upgrade_port`, from the server's `techActions.harbor`): your ports that are not raised yet (`level` 0).
 * Empty without the tech (`harbor` null), off your main-phase turn, or when every port is already raised. An unaffordable spot is still listed with
 * `affordable: false`, so the caller can show it disabled (BUG 5) or hide it.
 */
export function portRaiseSpots(harbor: TechActionsView['harbor'] | undefined, myMainTurn: boolean): PortRaiseSpot[] {
  if (!harbor || !myMainTurn) return [];
  return harbor.ports
    .filter(p => p.level < 1)
    .map(p => ({ vertexId: p.vertexId, cost: harbor.cost, affordable: harbor.affordable }));
}

/** One sea tile covered by a player's fishing net. */
export interface NetTile {
  hexId: number;
  owner: string;
}

/**
 * The sea tiles to draw a net on (fishing net bug). A net is a vertex piece that fishes every sea tile at its vertex, so each visible `water` tile at a net
 * vertex gets a net. A tile is listed once, for the first net (by vertex order) that covers it. `bare` lists the net vertices with no tile to draw on
 * (the sea tile is hidden by fog, or not `water`), so the caller keeps their small vertex piece instead of making the net disappear.
 */
export function netSeaTiles(
  vertices: readonly { id: number; hexIds: readonly number[]; building?: { type: string; owner: string } | null }[],
  hexes: readonly { type: string; fog?: boolean }[]
): { tiles: NetTile[]; bare: number[] } {
  const owners = new Map<number, string>();
  const bare: number[] = [];
  for (const v of vertices) {
    if (v.building?.type !== 'net') continue;
    let drew = false;
    for (const hexId of v.hexIds) {
      const h = hexes[hexId];
      if (!h || h.type !== 'water' || h.fog) continue;
      drew = true;
      if (!owners.has(hexId)) owners.set(hexId, v.building.owner);
    }
    if (!drew) bare.push(v.id);
  }
  const tiles = [...owners.entries()].sort((a, b) => a[0] - b[0]).map(([hexId, owner]) => ({ hexId, owner }));
  return { tiles, bare };
}

function isEdgeSlot(e: ManifestEntry): boolean {
  return e.slot === 'edge' || e.slot === 'edge:ocean';
}

/**
 * The spots to draw for one build mode. `mode` is the active build mode, or null for none. A button's own mode draws its spots; with no mode active the
 * edge buttons also draw theirs (the road does the same today), the vertex and hex ones wait for their button. A location listed by two entries of one
 * group is one spot, owned by the first by order. The caller decides whether it is the viewer's turn (the server sends `spots: null` otherwise anyway).
 */
export function spotsForMode(entries: readonly ManifestEntry[], mode: string | null, viewer: PieceViewer): SpotRef[] {
  const pieces = viewer?.pieces;
  if (!pieces) return [];
  const out: SpotRef[] = [];
  for (const model of buttonModels(entries)) {
    const edgeLike = isEdgeSlot(model.entries[0]);
    if (!(mode === model.mode || (mode === null && edgeLike))) continue;
    const seen = new Set<string>();
    for (const entry of offeredEntries(model, viewer)) {
      for (const loc of pieces[entry.id].spots ?? []) {
        const key = `${entry.slot}:${loc}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ entry, loc });
      }
    }
  }
  return out;
}

/** The entries of one group that list `loc`, in order. Used by the click: two or more means the spot needs a chooser. */
export function entriesAtSpot(entries: readonly ManifestEntry[], viewer: PieceViewer, mode: string, loc: number): ManifestEntry[] {
  const pieces = viewer?.pieces;
  if (!pieces) return [];
  const model = modelForMode(entries, mode);
  return model ? offeredEntries(model, viewer).filter(e => pieces[e.id].spots?.includes(loc)) : [];
}

/** SVG for one spot: the entry's own `spot` fragment when it has one, else the generic marker for its slot. Empty when the location is not on the board. */
export function spotMarkup(ref: SpotRef, board: BoardGeom, staticSpots = false): string {
  const { entry, loc } = ref;
  const call = `clickSpot('${entry.id}',${loc})`;
  const own = entry.spot && isSafeFragment(entry.spot) ? entry.spot : '';
  if (entry.slot === 'vertex') {
    const v = board.vertices[loc];
    if (!v) return '';
    const mark = own
      ? `<g transform="translate(${v.x}, ${v.y})"><g class="building-zoom-scale">${own}</g></g>`
      : `<circle cx="${v.x}" cy="${v.y}" r="11" class="spot-pulse${staticSpots ? ' spot-static' : ''}" />`;
    return `<g onclick="${call}" style="cursor:pointer"><circle cx="${v.x}" cy="${v.y}" r="20" fill="transparent" />${mark}</g>`;
  }
  if (entry.slot === 'hex') {
    const h = board.hexes[loc];
    if (!h) return '';
    const mark = own || `<circle class="spot-pulse${staticSpots ? ' spot-static' : ''}" r="26" />`;
    return `<g transform="translate(${h.x}, ${h.y})" onclick="${call}" style="cursor:pointer">${mark}</g>`;
  }
  const e = board.edges[loc];
  const v1 = e && board.vertices[e.v1];
  const v2 = e && board.vertices[e.v2];
  if (!v1 || !v2) return '';
  const mx = (v1.x + v2.x) / 2;
  const my = (v1.y + v2.y) / 2;
  const dot = own ? `<g transform="translate(${mx}, ${my})">${own}</g>` : `<circle class="road-spot-dot" cx="${mx}" cy="${my}" r="8" />`;
  return `<g onclick="${call}" style="cursor:pointer"><line class="road-spot-line" x1="${v1.x}" y1="${v1.y}" x2="${v2.x}" y2="${v2.y}" />${dot}</g>`;
}

// ---- Shapes ----------------------------------------------------------------------------------------------------------------

/** The shape fragment with `{color}` and `{dark}` filled in. A colour that is not a hex colour becomes grey, so the placeholders can never carry markup. Null when there is no safe shape. */
export function fillShape(shape: string | undefined, color: string): string | null {
  if (!shape || !shape.trim() || !isSafeFragment(shape)) return null;
  const col = COLOR_OK.test(color) ? color : FALLBACK_COLOR;
  return shape.split('{color}').join(col).split('{dark}').join(shade(col, 0.7));
}

/**
 * Body plus rim. The rim layer is the same fragment drawn first with every fill and stroke forced to the rim colour and the stroke widened to `rim`
 * (`.vis-rim` in styles.css), so any shape gets the light outline the hand-written pieces have. An element with class `no-rim` is left out of the rim layer.
 */
export function withRim(body: string, rim: number | undefined): string {
  const w = Number.isFinite(rim) && (rim as number) >= 0 ? (rim as number) : DEFAULT_RIM;
  return `<g class="vis-rim" style="--vis-rim:${w}px">${body}</g>${body}`;
}

/** A placed vertex piece, drawn around (0,0) like `settlementMarkup`. Null when the entry has no safe shape. */
export function vertexShapeMarkup(entry: ManifestEntry, color: string): string | null {
  const body = fillShape(entry.shape, color);
  return body === null ? null : withRim(body, entry.rim);
}

/** A placed edge piece: the shape lies along x from -50 to 50 and is moved, turned and stretched onto the segment (design section c). Null when there is no safe shape. */
export function edgeShapeMarkup(entry: ManifestEntry, color: string, p1: { x: number; y: number }, p2: { x: number; y: number }): string | null {
  const body = fillShape(entry.shape, color);
  if (body === null) return null;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  return `<g transform="translate(${mx.toFixed(1)}, ${my.toFixed(1)}) rotate(${angle.toFixed(2)}) scale(${(len / 100).toFixed(4)}, 1)">${withRim(body, entry.rim)}</g>`;
}

/** The manifest entry that draws a placed piece of this type on a vertex (`slot` vertex) or on an edge (`slot` edge or edge:ocean), if there is one. Road, settlement and city are never in the manifest. */
export function placedEntry(entries: readonly ManifestEntry[], type: string | undefined | null, where: 'vertex' | 'edge'): ManifestEntry | undefined {
  if (!type) return undefined;
  return entries.find(e => e.kind === 'piece' && e.id === type && !!e.shape && (where === 'vertex' ? e.slot === 'vertex' : isEdgeSlot(e)));
}
