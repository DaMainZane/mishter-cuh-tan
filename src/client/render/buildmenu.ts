// MODULE: build menu popover and cost tooltip (BUG 5: a click on a board hotspot opens a popover of the pieces that may go there; one cost tooltip, shown after a short hover or a long press, serves the popover and the build bar) | DEPENDS ON: client/audio, client/buildMenu, client/pieceModel, client/pieceui, client/render/techpanel, client/socket, +3 more | USED BY: client/main, client/render/board
import { playTone } from '../audio';
import { socket } from '../socket';
import { state, hasDraggedMap, setBuildModeValue } from '../store';
import { esc } from '../util';
import { iconHtml } from '../pieceModel';
import { placeAt } from '../pieceui';
import { manifestEntry } from '../visuals';
import { costTipHtml, edgeOptions, hexOptions, popoverPlace, tipDelay, vertexOptions } from '../buildMenu';
import type { BuildOption, MenuContext } from '../buildMenu';
import { upgradePortClick } from './techpanel';

// The pure half (which pieces, which price, the delay, where the popover sits) is `client/buildMenu.ts`. `board.ts` hands this file the menu context on
// every render (`syncBuildMenu`), so this file never imports the renderers (no new import cycle).

type NodeKind = 'vertex' | 'edge' | 'hex';

let open: { kind: NodeKind; id: number } | null = null;
/** Set by `board.ts` on every render: null when the menu is off (not your main-phase turn, or a build mode is on). */
let ctx: MenuContext | null = null;
let built = false;
let lastHtml = '';

const CSS = `
#buildMenu{position:fixed;z-index:70;display:none}
#buildMenu .bm-card{display:flex;flex-direction:column;gap:4px;min-width:150px;padding:6px;border-radius:var(--r-lg);background:var(--surface);color:var(--ink);box-shadow:var(--shadow)}
#buildMenu .bm-opt{display:flex;align-items:center;gap:8px;padding:7px 10px;border:0;border-radius:var(--r);background:var(--surface-2);color:var(--ink);font:inherit;font-size:13px;font-weight:700;text-align:left;cursor:pointer}
#buildMenu .bm-opt:hover:not(.is-off),#buildMenu .bm-opt:focus-visible{background:var(--surface-3);box-shadow:0 0 0 2px var(--accent);outline:none}
#buildMenu .bm-opt.is-off{opacity:.5;cursor:not-allowed}
#buildMenu .bm-opt > span:first-of-type{display:inline-flex}
#costTip{position:fixed;z-index:95;display:none;pointer-events:none}
`;

// ---- Cost tooltip --------------------------------------------------------------------------------------------------------------

let tipTimer: ReturnType<typeof setTimeout> | null = null;
let tipFor: Element | null = null;
let pressStart: { x: number; y: number } | null = null;
let swallowClick = false;

/** The element that carries a cost: any `.has-recipe` with a filled `.btn-recipe-popup` child (the build bar buttons and the popover options). */
function tipHost(target: EventTarget | null): HTMLElement | null {
  return ((target as Element | null)?.closest?.('.has-recipe') as HTMLElement | null) ?? null;
}

function hideTip(): void {
  if (tipTimer) clearTimeout(tipTimer);
  tipTimer = null;
  tipFor = null;
  const tip = document.getElementById('costTip');
  if (tip) tip.style.display = 'none';
}

function showTip(host: HTMLElement): void {
  const tip = document.getElementById('costTip');
  const body = host.querySelector('.btn-recipe-popup')?.innerHTML ?? '';
  if (!tip || !body.trim() || !host.isConnected) return;
  tip.innerHTML = body;
  tip.style.display = 'block';
  const r = host.getBoundingClientRect();
  const pos = popoverPlace({ x: r.left + r.width / 2, y: r.top + 10 }, { w: tip.offsetWidth, h: tip.offsetHeight }, { w: window.innerWidth, h: window.innerHeight });
  tip.style.left = `${pos.left}px`;
  tip.style.top = `${pos.below ? r.bottom + 8 : pos.top}px`;
}

function scheduleTip(host: HTMLElement, pointerType: string): void {
  if (tipFor === host) return;
  hideTip();
  tipFor = host;
  tipTimer = setTimeout(() => {
    tipTimer = null;
    showTip(host);
    if (pointerType === 'touch') swallowClick = true;
  }, tipDelay(pointerType));
}

/** One set of listeners for every cost tooltip on the page: hover with a short delay (mouse, pen), long press (touch). A long press does not also click. */
function initCostTips(): void {
  const tip = document.createElement('div');
  tip.id = 'costTip';
  document.body.appendChild(tip);
  document.addEventListener('pointerover', e => {
    if (e.pointerType === 'touch') return;
    const host = tipHost(e.target);
    if (host) scheduleTip(host, e.pointerType);
  });
  document.addEventListener('pointerout', e => {
    if (e.pointerType === 'touch' || !tipFor) return;
    if (!tipFor.contains(e.relatedTarget as Node | null)) hideTip();
  });
  document.addEventListener('pointerdown', e => {
    const host = tipHost(e.target);
    if (e.pointerType !== 'touch' || !host) {
      if (e.pointerType !== 'touch') hideTip();
      return;
    }
    hideTip();
    pressStart = { x: e.clientX, y: e.clientY };
    scheduleTip(host, 'touch');
  }, true);
  document.addEventListener('pointermove', e => {
    if (e.pointerType !== 'touch' || !pressStart || !tipTimer) return;
    if (Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 10) hideTip();
  });
  const endPress = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    pressStart = null;
    if (tipTimer) hideTip();
  };
  document.addEventListener('pointerup', endPress);
  document.addEventListener('pointercancel', endPress);
  document.addEventListener('click', e => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  document.addEventListener('contextmenu', e => {
    if (tipHost(e.target) && (pressStart || swallowClick)) e.preventDefault();
  });
}

// ---- Popover ---------------------------------------------------------------------------------------------------------------------

function ensureDom(): void {
  if (built) return;
  built = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'buildMenu';
  el.setAttribute('role', 'menu');
  el.innerHTML = '<div class="bm-card"></div>';
  document.body.appendChild(el);
  initCostTips();
  // Pressing anywhere else (or scrolling, or Escape) puts the popover away. Pressing another hotspot closes it, and that click then opens the new one.
  document.addEventListener('pointerdown', e => {
    if (open && !(e.target as Element | null)?.closest?.('#buildMenu')) closeBuildMenu();
  }, true);
  document.addEventListener('wheel', () => { if (open) closeBuildMenu(); }, { capture: true, passive: true });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) closeBuildMenu(); });
}

function optionsAt(kind: NodeKind, id: number): BuildOption[] {
  if (!ctx) return [];
  return kind === 'vertex' ? vertexOptions(ctx, id) : kind === 'edge' ? edgeOptions(ctx, id) : hexOptions(ctx, id);
}

function optionHtml(o: BuildOption, hand: Record<string, number> | undefined): string {
  return `
    <button class="bm-opt has-recipe${o.affordable ? '' : ' is-off'}" type="button" role="menuitem" aria-disabled="${!o.affordable}" onclick="chooseBuildOption('${esc(o.id)}')">
      <div class="btn-recipe-popup">${costTipHtml(o.cost, hand)}</div>
      ${iconHtml(o.icon)}<span>${esc(o.label)}</span>
    </button>`;
}

/** Screen point of a corner or of the middle of an edge. */
function nodeScreenPoint(kind: NodeKind, id: number): { x: number; y: number } | null {
  const svg = document.getElementById('boardSvg') as unknown as SVGSVGElement | null;
  const b = state?.board;
  if (!svg || !b) return null;
  let x: number;
  let y: number;
  if (kind === 'hex') {
    const h = b.hexes[id];
    if (!h) return null;
    x = h.x; y = h.y;
  } else if (kind === 'vertex') {
    const v = b.vertices[id];
    if (!v) return null;
    x = v.x; y = v.y;
  } else {
    const e = b.edges[id];
    const v1 = e && b.vertices[e.v1];
    const v2 = e && b.vertices[e.v2];
    if (!v1 || !v2) return null;
    x = (v1.x + v2.x) / 2; y = (v1.y + v2.y) / 2;
  }
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = x; pt.y = y;
  const out = pt.matrixTransform(ctm);
  return { x: out.x, y: out.y };
}

function placePopover(el: HTMLElement): void {
  if (!open) return;
  const at = nodeScreenPoint(open.kind, open.id);
  if (!at) return;
  const pos = popoverPlace(at, { w: el.offsetWidth, h: el.offsetHeight }, { w: window.innerWidth, h: window.innerHeight });
  el.style.left = `${pos.left}px`;
  el.style.top = `${pos.top}px`;
}

/** Draws the open popover from the current state, or puts it away when the node offers nothing any more (not your turn, built over, supply gone). */
function refresh(): void {
  ensureDom();
  const el = document.getElementById('buildMenu') as HTMLElement;
  const opts = open ? optionsAt(open.kind, open.id) : [];
  if (!open || opts.length === 0) {
    closeBuildMenu();
    return;
  }
  const html = opts.map(o => optionHtml(o, ctx?.me.resources)).join('');
  // Skip the redraw when nothing changed, so a hovered option keeps its tooltip across broadcasts.
  if (html !== lastHtml) {
    (el.querySelector('.bm-card') as HTMLElement).innerHTML = html;
    lastHtml = html;
  }
  el.style.display = 'block';
  placePopover(el);
}

/** Called by `renderBoard` with this render's menu context: keeps the open popover in step with the state (or closes it), and makes sure the cost tooltip listeners exist for the build bar. */
export function syncBuildMenu(next: MenuContext | null): void {
  ctx = next;
  refresh();
}

export function closeBuildMenu(): void {
  open = null;
  lastHtml = '';
  hideTip();
  const el = document.getElementById('buildMenu');
  if (el) el.style.display = 'none';
}

/** A hotspot was clicked (`window.openBuildMenu`): list what may go on that corner or edge. */
export function openBuildMenu(kind: NodeKind, id: number): void {
  if (hasDraggedMap || !state?.code) return;
  open = { kind, id };
  lastHtml = '';
  refresh();
  if (open) playTone(520, 0.04);
}

/** An option of the popover was clicked (`window.chooseBuildOption`). A disabled one (cannot pay) does nothing: its tooltip says why. */
export function chooseBuildOption(optionId: string): void {
  if (!open || !state?.code) return;
  const { kind, id } = open;
  const opt = optionsAt(kind, id).find(o => o.id === optionId);
  if (!opt || !opt.affordable) return;
  closeBuildMenu();
  setBuildModeValue(null);
  const code = state.code;
  if (opt.entryId) {
    const entry = manifestEntry(opt.entryId);
    if (entry) placeAt(entry, id);
    return;
  }
  playTone(600, 0.08);
  switch (opt.id) {
    case 'settlement':
    case 'city':
      socket.emit('clickVertex', { code, vertexId: id });
      break;
    case 'road':
      socket.emit('clickEdge', { code, edgeId: id });
      break;
    case 'bridge':
    case 'rickety_bridge':
      socket.emit('place', { code, piece: opt.id, loc: id });
      break;
    case 'harbor':
      socket.emit('act', { code, type: 'upgrade_harbor', payload: { vertexId: id } });
      break;
    case 'upgrade_port':
      upgradePortClick(id);
      break;
    case 'feed_sea':
    case 'place_net':
      socket.emit('act', { code, type: opt.id, payload: { hexId: id } });
      break;
  }
}
