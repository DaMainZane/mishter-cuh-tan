// MODULE: S0.13 overlay and popup kit (Service 11: hex tint/pattern layer, timer-bar popups, dramatic event title card, round-end recap card; T6: theme-aware flood and flood-warning patterns, elevation heat map) | DEPENDS ON: client/icons, client/pieceModel, client/util, client/visuals, shared/visual | USED BY: client/main, client/render/board, client/render/index
// Colorblind rule ("Design UI Philosophy.md"): every hex overlay pairs a color tint with a distinct geometric SVG pattern
// (hatch, waves, dots, chevrons, diagonal crack, rings) so color is never the only signal.
import { uiIcon } from '../icons';
import { isSafeCss, isSafeFragment } from '../pieceModel';
import { esc } from '../util';
import { getManifest, manifestRevision, overlayKind } from '../visuals';
import type { OverlayKindVisual } from '../../shared/visual';

/** Overlay kinds for DLCs not built yet stay hard-coded here; DLCs that have shipped register theirs in `OVERLAY_KINDS` (`Visual Manifest Design.md`, section f). */
export type BuiltinHexOverlayKind =
  | 'wall-incomplete'
  | 'plague'
  | 'wave'
  | 'crack'
  | 'season';

export type HexOverlayKind = BuiltinHexOverlayKind | (string & {});

export interface HexOverlayEntry {
  hexId: number;
  kind: HexOverlayKind;
  label?: string;
}

export interface TimerPopupAction {
  id: string;
  label: string;
  kind?: 'primary' | 'danger' | 'default';
  onClick?: () => void;
}

export interface TimerPopupItem {
  id: string;
  kicker?: string;
  title: string;
  subtitle?: string;
  accentColor?: string;
  durationMs: number;
  createdAt: number;
  actions: TimerPopupAction[];
}

export interface EventTitleCardOpts {
  kicker: string;
  title: string;
  subtitle?: string;
  badgeText?: string;
  tone?: 'accent' | 'danger' | 'ok';
  icon?: string;
  durationMs?: number;
}

export interface RoundRecapOpts {
  round: number;
  event?: string | null;
  contracts?: string[];
  relations?: string[];
  wrecks?: string[];
  durationMs?: number;
}

const clientHexOverlays = new Map<number, HexOverlayEntry>();
const activeTimerPopups = new Map<string, TimerPopupItem>();
let popupRafId: number | null = null;
let recapDismissTimer: any = null;

const PATTERN_IDS: Record<BuiltinHexOverlayKind, string> = {
  'wall-incomplete': 'ov-pat-wall-incomplete',
  plague: 'ov-pat-plague',
  wave: 'ov-pat-wave',
  crack: 'ov-pat-crack',
  season: 'ov-pat-season'
};

const SAFE_OVERLAY_ID = /^[A-Za-z0-9_-]+$/;
const OVERLAY_STYLE_ID = 'vis-overlay-vars';

function isSafeOverlayColor(c: string): boolean {
  return !!c && isSafeCss(c) && !/[;{}]/.test(c);
}

function isSafeOverlayKind(o: OverlayKindVisual): boolean {
  return (
    SAFE_OVERLAY_ID.test(o.id) &&
    isSafeFragment(o.pattern) &&
    isSafeOverlayColor(o.tint.light) &&
    isSafeOverlayColor(o.tint.dark) &&
    isSafeOverlayColor(o.line.light) &&
    isSafeOverlayColor(o.line.dark)
  );
}

/**
 * R8.8: CSS custom properties (`--ov-<id>-tint` and `--ov-<id>-line`) for every manifest overlay kind, for light and dark themes.
 * Empty when the manifest has no overlay kinds.
 */
export function overlayVarsCss(overlays: readonly OverlayKindVisual[] = getManifest().overlays): string {
  const valid = overlays.filter(isSafeOverlayKind);
  if (valid.length === 0) return '';
  const light = valid.map(o => `--ov-${o.id}-tint:${o.tint.light};--ov-${o.id}-line:${o.line.light};`).join('');
  const dark = valid.map(o => `--ov-${o.id}-tint:${o.tint.dark};--ov-${o.id}-line:${o.line.dark};`).join('');
  return `:root{${light}}:root[data-theme="dark"]{${dark}}`;
}

function overlayPatternDefsInnerMarkup(overlays: readonly OverlayKindVisual[] = getManifest().overlays): string {
  const dynamic = overlays
    .filter(isSafeOverlayKind)
    .map(o =>
      o.motif
        ? `
      <pattern id="ov-pat-${o.id}" x="0" y="0" width="1" height="1" patternUnits="objectBoundingBox" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style="color:var(--ov-${o.id}-line)">
        <rect x="-200" y="-200" width="500" height="500" stroke="none" style="fill:var(--ov-${o.id}-tint);stroke:none" />
        ${o.pattern}
      </pattern>`
        : `
      <pattern id="ov-pat-${o.id}" width="24" height="14" patternUnits="userSpaceOnUse" style="color:var(--ov-${o.id}-line)">
        <rect width="24" height="14" stroke="none" style="fill:var(--ov-${o.id}-tint);stroke:none" />
        ${o.pattern}
      </pattern>`
    )
    .join('');
  return `
      <!-- 1. wall-incomplete: red diagonal hatch -->
      <pattern id="ov-pat-wall-incomplete" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="14" height="14" fill="rgba(196, 71, 47, 0.18)" />
        <line x1="0" y1="0" x2="0" y2="14" stroke="#c4472f" stroke-width="4" stroke-opacity="0.65" />
      </pattern>${dynamic}
      <!-- 3. plague: green spore dots -->
      <pattern id="ov-pat-plague" width="16" height="16" patternUnits="userSpaceOnUse">
        <rect width="16" height="16" fill="rgba(79, 138, 74, 0.20)" />
        <circle cx="4" cy="4" r="2.3" fill="#3f743b" fill-opacity="0.75" />
        <circle cx="12" cy="12" r="2.8" fill="#3f743b" fill-opacity="0.75" />
      </pattern>
      <!-- 4. wave: amber chevrons -->
      <pattern id="ov-pat-wave" width="18" height="14" patternUnits="userSpaceOnUse">
        <rect width="18" height="14" fill="rgba(217, 137, 59, 0.18)" />
        <path d="M 2 10 L 9 4 L 16 10" fill="none" stroke="#d9893b" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.78" />
      </pattern>
      <!-- 5. crack: amber jagged fracture lines -->
      <pattern id="ov-pat-crack" width="22" height="22" patternUnits="userSpaceOnUse">
        <rect width="22" height="22" fill="rgba(217, 137, 59, 0.20)" />
        <path d="M 2 2 L 10 8 L 7 14 L 19 20" fill="none" stroke="#b85d19" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.82" />
      </pattern>
      <!-- 6. season: gold concentric rings -->
      <pattern id="ov-pat-season" width="22" height="22" patternUnits="userSpaceOnUse">
        <rect width="22" height="22" fill="rgba(217, 164, 65, 0.16)" />
        <circle cx="11" cy="11" r="6.5" fill="none" stroke="#b58524" stroke-width="1.8" stroke-opacity="0.72" />
      </pattern>
    `;
}

/** SVG <defs> for the built-in and manifest colorblind-safe geometric hex overlay patterns. */
export function overlayPatternDefsMarkup(overlays: readonly OverlayKindVisual[] = getManifest().overlays): string {
  return `
    <defs id="boardOverlayDefs" data-rev="${manifestRevision()}">${overlayPatternDefsInnerMarkup(overlays)}</defs>
  `;
}

/** Keeps `<style id="vis-overlay-vars">` and `<defs id="boardOverlayDefs">` in sync with the current manifest. Safe when `document` is absent (Node tests). */
export function syncOverlayManifest(): void {
  if (typeof document === 'undefined') return;
  const rev = String(manifestRevision());
  const overlays = getManifest().overlays;
  const css = overlayVarsCss(overlays);
  let styleEl = document.getElementById(OVERLAY_STYLE_ID) as HTMLStyleElement | null;
  if (!css) {
    if (styleEl) styleEl.remove();
  } else {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = OVERLAY_STYLE_ID;
      document.head.appendChild(styleEl);
    }
    if (styleEl.dataset.rev !== rev || styleEl.textContent !== css) {
      styleEl.textContent = css;
      styleEl.dataset.rev = rev;
    }
  }
  const defsEl = document.getElementById('boardOverlayDefs');
  if (defsEl && defsEl.getAttribute('data-rev') !== rev) {
    defsEl.innerHTML = overlayPatternDefsInnerMarkup(overlays);
    defsEl.setAttribute('data-rev', rev);
  }
}

/** Set or clear a client-side hex overlay tint/pattern (supplements any server-sent `hex.overlay` field). */
export function setHexOverlay(hexId: number, kind: HexOverlayKind | null, label?: string): void {
  if (!kind) clientHexOverlays.delete(hexId);
  else clientHexOverlays.set(hexId, { hexId, kind, label });
}

export function clearHexOverlays(): void {
  clientHexOverlays.clear();
}

/** Renders the hex tint & pattern SVG markup for `#boardOverlayLayer`. */
export function renderHexOverlaysMarkup(
  hexes: any[],
  getInnerPoly: (hexId: number) => string | undefined,
  serverOverlays?: Record<number, { kind: HexOverlayKind; label?: string }> | null
): string {
  syncOverlayManifest();
  let html = '';
  for (const h of hexes) {
    if (!h || h.type === 'water' || h.fog || h.type === 'fog') continue;
    const entry =
      clientHexOverlays.get(h.id) ||
      (serverOverlays && serverOverlays[h.id]) ||
      (h.overlay && typeof h.overlay === 'object' ? h.overlay : typeof h.overlay === 'string' ? { kind: h.overlay as HexOverlayKind } : null);
    if (!entry || !entry.kind) continue;
    const kindDef = overlayKind(entry.kind);
    const validManifestKind = kindDef && isSafeOverlayKind(kindDef) ? kindDef : undefined;
    const patId = validManifestKind
      ? `ov-pat-${validManifestKind.id}`
      : PATTERN_IDS[entry.kind as BuiltinHexOverlayKind];
    if (!patId) continue;
    const poly = getInnerPoly(h.id);
    if (!poly) continue;
    const label = entry.label ?? validManifestKind?.label;
    const pulseCls = validManifestKind?.pulse ? ' hex-overlay-pulse' : '';
    html += `<g class="hex-overlay-item hex-overlay-${esc(entry.kind)}${pulseCls}" style="pointer-events:none">
      <polygon points="${poly}" fill="url(#${patId})" class="hex-overlay-poly" />
      ${label ? `<text x="${h.x.toFixed(1)}" y="${(h.y + 44).toFixed(1)}" class="hex-overlay-label">${esc(label)}</text>` : ''}
    </g>`;
  }
  return html;
}

/**
 * Elevation heat map (T6d): one flat tint per height (1 to 3, darker = higher) plus the number itself, so color is never the only signal.
 * `elevation` maps hex id to height; hexes without an entry (sea, fog) get nothing.
 */
export function renderElevationMarkup(
  hexes: any[],
  getInnerPoly: (hexId: number) => string | undefined,
  elevation: Record<number, number>
): string {
  let html = '';
  for (const h of hexes) {
    if (!h || h.type === 'water' || h.fog || h.type === 'fog') continue;
    const e = Math.max(1, Math.min(3, Math.round(Number(elevation[h.id]))));
    if (!Number.isFinite(e) || elevation[h.id] === undefined) continue;
    const poly = getInnerPoly(h.id);
    if (!poly) continue;
    html += `<g class="hex-elev-item" style="pointer-events:none">
      <polygon points="${poly}" class="hex-elev hex-elev-${e}" />
      <text x="${h.x.toFixed(1)}" y="${(h.y + 46).toFixed(1)}" class="hex-elev-label">${'\u25B2'.repeat(e)}</text>
    </g>`;
  }
  return html;
}

/**
 * Outline for a sea tile that holds a fishing ground, so it reads as a tile like the land ones (Tidebound fish tile outline).
 * `poly` is the tile's inset polygon (the same one the land tiles use). Returns '' when there is no polygon.
 */
export function fishTileOutlineMarkup(poly: string | undefined): string {
  if (!poly) return '';
  return `<polygon class="fish-tile-outline" points="${esc(poly)}" style="fill:none;stroke:var(--token);stroke-width:3.5;stroke-linejoin:round;pointer-events:none" />`;
}

// ---- 2. Timer-bar popup (peace offers, event vetoes, gate permits) ------------------------------------------

function tickTimerPopups(): void {
  const now = performance.now();
  let anyLeft = false;
  for (const [id, item] of activeTimerPopups.entries()) {
    const elapsed = now - item.createdAt;
    const rem = Math.max(0, item.durationMs - elapsed);
    const bar = document.querySelector<HTMLElement>(`[data-popup-timer="${id}"]`);
    if (bar) {
      const frac = item.durationMs > 0 ? Math.max(0, Math.min(1, rem / item.durationMs)) : 0;
      bar.style.transform = `scaleX(${frac.toFixed(3)})`;
      bar.classList.toggle('low', rem <= 5000);
    }
    if (rem <= 0) {
      activeTimerPopups.delete(id);
      renderTimerPopups();
    } else {
      anyLeft = true;
    }
  }
  if (anyLeft) {
    popupRafId = requestAnimationFrame(tickTimerPopups);
  } else {
    popupRafId = null;
  }
}

export function showTimerPopup(opts: Omit<TimerPopupItem, 'createdAt'> & { createdAt?: number }): void {
  const item: TimerPopupItem = {
    ...opts,
    durationMs: Math.max(1000, opts.durationMs || 15000),
    createdAt: opts.createdAt ?? performance.now()
  };
  activeTimerPopups.set(item.id, item);
  renderTimerPopups();
  if (popupRafId === null) {
    popupRafId = requestAnimationFrame(tickTimerPopups);
  }
}

export function dismissTimerPopup(id: string): void {
  if (activeTimerPopups.delete(id)) {
    renderTimerPopups();
  }
}

export function triggerTimerPopupAction(popupId: string, actionId: string): void {
  const item = activeTimerPopups.get(popupId);
  if (!item) return;
  const act = item.actions.find(a => a.id === actionId);
  activeTimerPopups.delete(popupId);
  renderTimerPopups();
  if (act?.onClick) act.onClick();
}

export function renderTimerPopups(): void {
  const mount = document.getElementById('overlayPopupStack');
  if (!mount) return;
  if (activeTimerPopups.size === 0) {
    mount.style.display = 'none';
    mount.innerHTML = '';
    return;
  }
  mount.style.display = 'flex';
  mount.innerHTML = [...activeTimerPopups.values()]
    .map(item => {
      const btns = item.actions
        .map(a => {
          const cls = a.kind === 'primary' ? 'btn sm primary' : a.kind === 'danger' ? 'btn sm danger' : 'btn sm';
          return `<button type="button" class="${cls}" onclick="triggerTimerPopupAction('${esc(item.id)}', '${esc(a.id)}')">${esc(a.label)}</button>`;
        })
        .join('');
      return `
        <div class="overlay-timer-card" style="${item.accentColor ? `--popup-accent:${esc(item.accentColor)}` : ''}">
          <div class="overlay-timer-info">
            ${item.kicker ? `<span class="overlay-timer-kicker">${esc(item.kicker)}</span>` : ''}
            <strong class="overlay-timer-title">${esc(item.title)}</strong>
            ${item.subtitle ? `<span class="overlay-timer-sub">${esc(item.subtitle)}</span>` : ''}
          </div>
          <div class="overlay-timer-actions">${btns}</div>
          <div class="trade-timer-track"><div class="trade-timer-fill" data-popup-timer="${esc(item.id)}"></div></div>
        </div>`;
    })
    .join('');
}

// ---- 3. Dramatic event title card (overthrown, betrayal, eruption) ------------------------------------------

export function showEventTitleCard(opts: EventTitleCardOpts): void {
  const mount = document.getElementById('eventTitleMount') || document.body;
  const banner = document.createElement('div');
  const toneClass = opts.tone === 'danger' ? 'stolen' : opts.tone === 'ok' ? 'tone-ok' : '';
  banner.className = `award-epic-banner event-title-card ${toneClass}`.trim();
  const iconName = opts.icon || (opts.tone === 'danger' ? 'close' : 'sword');
  banner.innerHTML = `
    <div class="award-rays"></div>
    <div class="award-badge-icon">${uiIcon(iconName as any, 24)}</div>
    <div class="award-info">
      <div class="award-kicker">${esc(opts.kicker)}</div>
      <div class="award-headline">${esc(opts.title)}</div>
      ${opts.subtitle ? `<div class="award-sub">${esc(opts.subtitle)}</div>` : ''}
    </div>
    ${opts.badgeText ? `<div class="award-vp-pill">${esc(opts.badgeText)}</div>` : ''}
  `;
  mount.appendChild(banner);
  const ttl = Math.max(1200, opts.durationMs || 2600);
  setTimeout(() => banner.remove(), ttl);
}

// ---- 4. Round-end recap card (compact summary; skips empty sections) ----------------------------------------

export function dismissRoundRecapCard(): void {
  if (recapDismissTimer) {
    clearTimeout(recapDismissTimer);
    recapDismissTimer = null;
  }
  const mount = document.getElementById('roundRecapMount');
  if (mount) {
    mount.style.display = 'none';
    mount.innerHTML = '';
  }
}

export function showRoundRecapCard(opts: RoundRecapOpts): boolean {
  const sections: { label: string; lines: string[] }[] = [];
  if (opts.event && opts.event.trim()) {
    sections.push({ label: 'Event', lines: [opts.event.trim()] });
  }
  if (opts.contracts && opts.contracts.length > 0) {
    sections.push({ label: 'Contracts', lines: opts.contracts.filter(Boolean) });
  }
  if (opts.relations && opts.relations.length > 0) {
    sections.push({ label: 'Relations', lines: opts.relations.filter(Boolean) });
  }
  if (opts.wrecks && opts.wrecks.length > 0) {
    sections.push({ label: 'Wrecks & Damage', lines: opts.wrecks.filter(Boolean) });
  }

  // Rule from S0.13: skip empty sections, and do not show the card at all when every section is empty.
  if (sections.length === 0) {
    dismissRoundRecapCard();
    return false;
  }

  const mount = document.getElementById('roundRecapMount');
  if (!mount) return false;

  const bodyHtml = sections
    .map(
      sec => `
      <div class="recap-section">
        <span class="recap-sec-label">${esc(sec.label)}</span>
        <div class="recap-sec-items">${sec.lines.map(l => `<div class="recap-line">${esc(l)}</div>`).join('')}</div>
      </div>`
    )
    .join('');

  mount.style.display = 'flex';
  mount.innerHTML = `
    <div class="round-recap-card">
      <div class="round-recap-head">
        <strong>Round ${esc(opts.round)} Recap</strong>
        <button type="button" class="icon-btn" onclick="dismissRoundRecapCard()" title="Dismiss">${uiIcon('close', 15)}</button>
      </div>
      <div class="round-recap-body">${bodyHtml}</div>
    </div>
  `;

  if (recapDismissTimer) clearTimeout(recapDismissTimer);
  recapDismissTimer = setTimeout(() => dismissRoundRecapCard(), Math.max(2000, opts.durationMs || 6500));
  return true;
}
