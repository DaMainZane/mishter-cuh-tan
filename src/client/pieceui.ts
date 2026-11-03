// MODULE: generic piece UI (R8.7: draws the build-bar buttons, the spot layer and the placed shapes of manifest pieces and actions, shows their hints and sends their clicks; the logic is in client/pieceModel) | DEPENDS ON: client/audio, client/pieceModel, client/socket, client/store, client/types, client/ui, +2 more | USED BY: client/actions, client/main, client/render/board, client/render/buildmenu, client/render/index
import { playTone } from './audio';
import { socket } from './socket';
import { state, buildMode, setBuildModeValue } from './store';
import { showToast } from './ui';
import { manifestEntries, manifestEntry } from './visuals';
import {
  badgeFor, buttonHtml, buttonModels, buttonVisible, edgeShapeMarkup, entriesAtSpot, isSafeCss, modeHint, modeOf, modelForMode, placedEntry,
  recipeCostFor, recipeStripHtml, spotMarkup, spotsForMode, vertexShapeMarkup
} from './pieceModel';
import type { PieceViewer } from './pieceModel';
import type { PlayerView } from './types';
import type { ManifestEntry } from '../shared/visual';

// R8.7: the generic client code for DLC pieces and actions, written beside the hand-written code for net, harbor, feed and bridges (R8.8 migrates them one by one).
// Nothing here does anything until the manifest has an entry: with an empty manifest every function returns an empty result, so the game draws as before.

/** Called when a spot shared by two or more entries of one group is clicked (the bridge picker is the first). `pieceIds` are the entries that list the spot, in order. */
export type SpotChooser = (loc: number, pieceIds: string[]) => void;

const choosers = new Map<string, SpotChooser>();

/** Registers the chooser for a button group. With none registered, the first entry by order wins. */
export function registerSpotChooser(group: string, fn: SpotChooser): void {
  choosers.set(group, fn);
}

// ---- Styles (design section e) --------------------------------------------------------------------------------------------

/** Keeps one `<style id="vis-css-<id>">` per manifest entry that has `css`: added when the entry appears, rewritten when its text changes, removed when it is gone. */
export function syncEntryStyles(entries: readonly ManifestEntry[]): void {
  const want = new Map<string, string>();
  for (const e of entries) {
    if (e.css && isSafeCss(e.css) && /^[A-Za-z0-9_.:-]+$/.test(e.id)) want.set(`vis-css-${e.id}`, e.css);
  }
  document.head.querySelectorAll('style[data-vis-css]').forEach(el => {
    if (!want.has(el.id)) el.remove();
  });
  for (const [id, css] of want) {
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      el.setAttribute('data-vis-css', '1');
      document.head.appendChild(el);
    }
    if (el.textContent !== css) el.textContent = css;
  }
}

// ---- Build-bar buttons -----------------------------------------------------------------------------------------------------

/**
 * Draws the generated buttons into `#pieceButtons` (an empty container in `public/index.html`, after Road). The buttons are rebuilt only when the manifest changes
 * the set, labels or icons; every call after that only updates visibility, disabled, the active mode, the badge and the recipe popup, so a hover on a popup
 * is never interrupted by a re-render. `target` is the player whose supplies are shown (you, or the spectated player).
 */
export function renderPieceButtons(target: PieceViewer, isMyTurn: boolean): void {
  const entries = manifestEntries();
  syncEntryStyles(entries);
  const host = document.getElementById('pieceButtons');
  if (!host) return;
  const models = buttonModels(entries);
  const sig = models.map(m => `${m.mode}|${m.label}|${m.icon}`).join('\n');
  if (host.dataset.sig !== sig) {
    host.innerHTML = models.map(buttonHtml).join('');
    host.dataset.sig = sig;
  }
  const inLobby = state?.status === 'LOBBY';
  const canClick = isMyTurn && state?.phase === 'MAIN';
  for (const m of models) {
    const btn = document.getElementById(`pieceBtn-${m.mode}`) as HTMLButtonElement | null;
    if (!btn) continue;
    btn.style.display = buttonVisible(m, target, inLobby) ? '' : 'none';
    btn.disabled = !canClick;
    btn.classList.toggle('active-mode', buildMode === m.mode);
    const badge = document.getElementById(`pieceBadge-${m.mode}`);
    const left = badgeFor(m, target);
    if (badge) {
      badge.style.display = left === null ? 'none' : '';
      badge.textContent = left === null ? '' : String(left);
    }
    const popup = document.getElementById(`recipePopup-${m.mode}`);
    if (popup) popup.innerHTML = recipeStripHtml(recipeCostFor(m, target), target?.resources);
  }
}

/** True when the build mode belongs to a generated button, so `board.ts` skips the settlement spots (as it does for the hand-written net, feed and harbor modes). */
export function isPieceMode(mode: string | null): boolean {
  return modelForMode(manifestEntries(), mode) !== undefined;
}

/** The toast for switching a generated mode on, or null (`setBuildMode` shows it). */
export function pieceModeHint(mode: string, viewer: PieceViewer): string | null {
  const model = modelForMode(manifestEntries(), mode);
  return model ? modeHint(model, viewer) : null;
}

// ---- Spots and clicks -------------------------------------------------------------------------------------------------------

/** SVG for the generic spot layer (`#boardPieceSpotsLayer`): the spots of the active mode on your main-phase turn, else empty. */
export function pieceSpotsMarkup(me: PlayerView | undefined, isMyTurn: boolean): string {
  if (!state || !state.board || !me || !isMyTurn || state.phase !== 'MAIN') return '';
  const entries = manifestEntries();
  if (entries.length === 0) return '';
  const staticSpots = state.board.vertices.length > 120;
  return spotsForMode(entries, buildMode, me).map(ref => spotMarkup(ref, state!.board, staticSpots)).join('');
}

/** Sends the build or the action for one entry at one location, and leaves build mode. */
export function placeAt(entry: ManifestEntry, loc: number): void {
  if (!state) return;
  setBuildModeValue(null);
  if (entry.kind === 'action') {
    playTone(660, 0.08);
    socket.emit('act', { code: state.code, type: entry.id, payload: { [entry.spotKey as string]: loc } });
  } else {
    socket.emit('place', { code: state.code, piece: entry.id, loc });
  }
}

/**
 * The one click handler of every generated spot (`window.clickSpot`). `pieceId` is the entry the spot was drawn for. If two or more entries of its group list this
 * location and a chooser is registered, the chooser decides; otherwise the first entry by order is built.
 */
export function clickSpot(pieceId: string, loc: number): void {
  if (!state) return;
  const entry = manifestEntry(pieceId);
  if (!entry) return;
  const me = state.players.find(p => p.id === socket.id);
  const mode = modeOf(entry);
  const atSpot = entriesAtSpot(manifestEntries(), me, mode, loc);
  const ids = atSpot.length > 0 ? atSpot.map(e => e.id) : [entry.id];
  const chooser = ids.length > 1 ? choosers.get(mode) : undefined;
  if (chooser) {
    chooser(loc, ids);
    return;
  }
  placeAt(manifestEntry(ids[0]) ?? entry, loc);
}

// ---- Placed shapes (called by board.ts) ---------------------------------------------------------------------------------------

/** True when a placed piece of this type is drawn from the manifest (so `board.ts` does not need to know its name). */
export function hasPlacedShape(type: string | undefined | null): boolean {
  return placedEntry(manifestEntries(), type, 'vertex') !== undefined || placedEntry(manifestEntries(), type, 'edge') !== undefined;
}

/** The SVG of a placed vertex piece in the owner's colour, or null when the type is not a manifest piece (the caller then draws it as before). */
export function placedVertexMarkup(type: string | undefined | null, color: string): string | null {
  const entry = placedEntry(manifestEntries(), type, 'vertex');
  return entry ? vertexShapeMarkup(entry, color) : null;
}

/** The SVG of a placed edge piece between `p1` and `p2`, or null when the type is not a manifest piece. */
export function placedEdgeMarkup(type: string | undefined | null, color: string, p1: { x: number; y: number }, p2: { x: number; y: number }): string | null {
  const entry = placedEntry(manifestEntries(), type, 'edge');
  return entry ? edgeShapeMarkup(entry, color, p1, p2) : null;
}
