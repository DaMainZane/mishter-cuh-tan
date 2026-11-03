// MODULE: client copy of the visual manifest (set when the server's `visuals` event arrives, read by the renderers; empty before it arrives and when it never does) | DEPENDS ON: shared/visual | USED BY: client/main, client/pieceui, client/render/board, client/render/buildmenu, client/render/overlay
import { emptyManifest } from '../shared/visual';
import type { ManifestEntry, OverlayKindVisual, VisualManifest, VisualSlot } from '../shared/visual';

// R8.5. The manifest says what DLC pieces, actions and overlay kinds look like (see `Visual Manifest Design.md`). The server sends it in a separate
// `visuals` event, before `gameState` in the normal case. The renderers must work either way, so this module is always safe to read:
//   - before the first event, or if none ever comes: the empty manifest (no generated buttons, no overlay kinds),
//   - after a `gameState` and before the manifest: the same, then `onVisualsEvent` asks for one re-render when the manifest arrives,
//   - on junk or an unknown version: the empty manifest, never an exception.

const SLOTS: ReadonlySet<string> = new Set<VisualSlot>(['vertex', 'edge', 'edge:ocean', 'hex']);

let manifest: VisualManifest = emptyManifest();
let signature = JSON.stringify(manifest);
let revision = 0;
const listeners = new Set<() => void>();

const isText = (v: unknown): v is string => typeof v === 'string';
const isRecord = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** One entry if it has what the renderers read, else null. Anything else about it is passed through untouched. */
function cleanEntry(raw: unknown): ManifestEntry | null {
  if (!isRecord(raw)) return null;
  if (!isText(raw.id) || !raw.id) return null;
  if (raw.kind !== 'piece' && raw.kind !== 'action') return null;
  if (!isText(raw.slot) || !SLOTS.has(raw.slot)) return null;
  const b = raw.button;
  if (!isRecord(b) || !isText(b.label) || !isText(b.icon)) return null;
  const h = raw.hints;
  if (!isRecord(h) || !isText(h.cannotAfford) || !isText(h.noSpots)) return null;
  return JSON.parse(JSON.stringify(raw)) as ManifestEntry;
}

function cleanOverlay(raw: unknown): OverlayKindVisual | null {
  if (!isRecord(raw)) return null;
  if (!isText(raw.id) || !raw.id || !isText(raw.label) || !isText(raw.pattern)) return null;
  for (const part of ['tint', 'line']) {
    const c = raw[part];
    if (!isRecord(c) || !isText(c.light) || !isText(c.dark)) return null;
  }
  return JSON.parse(JSON.stringify(raw)) as OverlayKindVisual;
}

/** Turns whatever arrived into a manifest the renderers can trust: an unknown version or a non-object is the empty manifest, bad entries are dropped. */
function sanitize(raw: unknown): VisualManifest {
  if (!isRecord(raw) || raw.version !== 1) return emptyManifest();
  const pieces = Array.isArray(raw.pieces) ? raw.pieces.map(cleanEntry).filter((e): e is ManifestEntry => e !== null) : [];
  const overlays = Array.isArray(raw.overlays) ? raw.overlays.map(cleanOverlay).filter((o): o is OverlayKindVisual => o !== null) : [];
  return { version: 1, pieces, overlays };
}

function notify(): void {
  for (const fn of [...listeners]) {
    try { fn(); } catch (err) { console.error('Manifest listener error:', err); }
  }
}

/**
 * Replaces the manifest. Returns true when it changed (and tells the listeners), false when it is the same as before, so a resend costs no re-render.
 * It keeps its own copy: the caller's object is never aliased.
 */
export function setManifest(raw: unknown): boolean {
  const next = sanitize(raw);
  const sig = JSON.stringify(next);
  if (sig === signature) return false;
  manifest = next;
  signature = sig;
  revision++;
  notify();
  return true;
}

/** Back to the empty manifest (a disconnect). */
export function resetManifest(): void {
  setManifest(null);
}

/** The current manifest. Read only: do not change what it returns. */
export function getManifest(): VisualManifest {
  return manifest;
}

/** Goes up by one on every change, so a renderer can cache by it. */
export function manifestRevision(): number {
  return revision;
}

/** Pieces and actions in manifest order (`button.order`, then id; the server sorts them). Empty before the manifest arrives. */
export function manifestEntries(): readonly ManifestEntry[] {
  return manifest.pieces;
}

export function manifestEntry(id: string): ManifestEntry | undefined {
  return manifest.pieces.find(e => e.id === id);
}

export function overlayKind(id: string): OverlayKindVisual | undefined {
  return manifest.overlays.find(o => o.id === id);
}

/** True when the manifest has any entry or overlay kind. */
export function hasManifest(): boolean {
  return manifest.pieces.length > 0 || manifest.overlays.length > 0;
}

/** Calls `fn` after every change of the manifest. Returns the function that removes it. */
export function onManifestChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * What `main.ts` does with the `visuals` event: store the manifest and, only when it changed, ask for one re-render. A manifest that arrives before the
 * first state costs nothing extra (the first state renders with it); one that arrives after it triggers the re-render that adds the generated controls.
 * `rerender` is the caller's "draw again if there is a state" function.
 */
export function onVisualsEvent(payload: unknown, rerender: () => void): void {
  const manifestPart = isRecord(payload) ? payload.manifest : undefined;
  if (setManifest(manifestPart)) rerender();
}
