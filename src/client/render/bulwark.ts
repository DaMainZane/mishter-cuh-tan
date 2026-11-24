// MODULE: Bulwark board layer (gates open and closed with their arch, cracked palisades, a banner per walled zone with its lord and your tax meter) and the "Overthrown!" title card; draws its own styles | DEPENDS ON: client/render/overlay, client/socket, client/store, client/types, client/util | USED BY: client/render/index
import { state } from '../store';
import { socket } from '../socket';
import { esc } from '../util';
import { showEventTitleCard } from './overlay';
import type { BulwarkView } from '../types';

const LAYER_ID = 'boardBulwarkLayer';
const STYLE_ID = 'bulwarkStyles';
let lastHtml = '';
// The last overthrow this screen has seen. Empty = nothing of this game seen yet, so a reconnect does not replay an old card.
let overthrowSeenKey = '';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
    .bw-gate .bw-gate-frame { fill: #6b6258; stroke: #2f2a24; stroke-width: 1.6; }
    .bw-gate .bw-gate-door { fill: #8a5a32; stroke: #2f2a24; stroke-width: 1.2; }
    .bw-gate.open .bw-gate-door { fill: none; stroke-dasharray: 2 2; }
    .bw-arch { stroke: #6b6258; stroke-width: 6; stroke-linecap: round; stroke-dasharray: 3 7; fill: none; opacity: 0.85; }
    .bw-crack { fill: #f59e0b; stroke: #2f2a24; stroke-width: 1.2; }
    .bw-hp { fill: #2f2a24; font-size: 9px; font-weight: 800; text-anchor: middle; }
    .bw-banner-ring { stroke: #2f2a24; stroke-width: 1.6; }
    .bw-banner-text { font-size: 9px; font-weight: 800; text-anchor: middle; fill: #f4f1ea; paint-order: stroke; stroke: #2f2a24; stroke-width: 2.4px; }
  `;
  document.head.appendChild(st);
}

/** The layer sits above the roads (walls are drawn there) and below the buildings. Recreated when the board rebuilds its layers. */
function ensureLayer(): Element | null {
  const svg = document.getElementById('boardSvg');
  if (!svg) return null;
  let layer: Element | null = document.getElementById(LAYER_ID);
  if (layer && layer.parentElement === svg) return layer;
  layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  layer.id = LAYER_ID;
  const before = document.getElementById('boardVerticesLayer');
  if (before && before.parentElement === svg) svg.insertBefore(layer, before);
  else svg.appendChild(layer);
  lastHtml = '';
  return layer;
}

function playerName(id: string | null): string {
  if (!id) return 'nobody';
  const p = state.players.find(x => x.id === id);
  return p ? p.name : 'someone';
}

function playerColor(id: string | null): string {
  if (!id) return '#9a958c';
  return state.players.find(x => x.id === id)?.color || '#9a958c';
}

function gateMarkup(b: BulwarkView, g: BulwarkView['gates'][number]): string {
  const v = state.board.vertices[g.vertexId];
  const e = state.board.edges[g.arch];
  if (!v || !e) return '';
  const a = state.board.vertices[e.v1];
  const c = state.board.vertices[e.v2];
  const zone = b.zones.find(z => z.id === g.zoneId);
  const title = `Gate of ${esc(playerName(zone?.controller ?? null))}: ${g.open ? 'open, anyone may pass' : 'closed, only permit holders may pass'}`;
  return `
    <line class="bw-arch" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${c.x.toFixed(1)}" y2="${c.y.toFixed(1)}"><title>Gateway arch</title></line>
    <g class="bw-gate ${g.open ? 'open' : 'closed'}" transform="translate(${v.x.toFixed(1)}, ${v.y.toFixed(1)})" style="pointer-events:none">
      <title>${title}</title>
      <g class="building-zoom-scale">
        <path class="bw-gate-frame" d="M-11 9 L-11 -4 A11 11 0 0 1 11 -4 L11 9 Z"/>
        <path class="bw-gate-door" d="M-6 9 L-6 -1 A6 6 0 0 1 6 -1 L6 9 Z"/>
      </g>
    </g>`;
}

function damagedMarkup(edgeId: number, hp: number): string {
  const e = state.board.edges[edgeId];
  if (!e) return '';
  const a = state.board.vertices[e.v1];
  const c = state.board.vertices[e.v2];
  if (!a || !c) return '';
  const x = (a.x + c.x) / 2;
  const y = (a.y + c.y) / 2;
  if (hp <= 1) {
    // Amber crack: one more hit (a 7, rot or fire) breaks it.
    return `<g transform="translate(${x.toFixed(1)}, ${y.toFixed(1)})" style="pointer-events:none"><title>Cracked palisade: 1 durability left, repair it (1 wood)</title>
      <g class="building-zoom-scale"><path class="bw-crack" d="M-7 -6 L1 -1 L-3 1 L7 6 L-1 2 L3 0 Z"/></g></g>`;
  }
  return `<g transform="translate(${x.toFixed(1)}, ${y.toFixed(1)})" style="pointer-events:none"><title>Damaged palisade: ${hp} durability left</title>
    <text class="bw-hp" y="3">${hp}</text></g>`;
}

function bannerMarkup(z: BulwarkView['zones'][number]): string {
  if (!z.complete) return '';
  const hexes = z.hexIds.map(id => state.board.hexes[id]).filter(Boolean);
  if (!hexes.length) return '';
  const x = hexes.reduce((s, h) => s + h.x, 0) / hexes.length;
  const y = hexes.reduce((s, h) => s + h.y, 0) / hexes.length;
  const me = socket.id ?? '';
  const meter = z.meters?.[me];
  const guest = !!z.controller && z.controller !== me && (z.vp?.[me] ?? 0) > 0;
  const lines = [
    `Walled zone, lord: ${playerName(z.controller)}`,
    ...Object.entries(z.vp ?? {}).map(([pid, n]) => `${playerName(pid)}: ${n} VP inside`),
    guest ? `Your tax meter: ${((meter ?? 0) / 20).toFixed(2)} (a card goes to the lord at 1.00)` : '',
    z.permits?.length ? `Permits: ${z.permits.map(playerName).join(', ')}` : ''
  ].filter(Boolean);
  const label = guest ? `tax ${((meter ?? 0) / 20).toFixed(1)}` : '';
  return `
    <g transform="translate(${x.toFixed(1)}, ${(y - 34).toFixed(1)})" style="pointer-events:all">
      <title>${esc(lines.join('\n'))}</title>
      <g class="building-zoom-scale">
        <circle class="bw-banner-ring" r="11" fill="${esc(playerColor(z.controller))}"/>
        <path d="M-6 3 L-7 -4 L-3.5 -1 L0 -6 L3.5 -1 L7 -4 L6 3 Z" fill="#ffd45e" stroke="#2f2a24" stroke-width="1"/>
        ${label ? `<text class="bw-banner-text" y="22">${esc(label)}</text>` : ''}
      </g>
    </g>`;
}

function syncOverthrowCard(b: BulwarkView | null | undefined): void {
  if (!b || state.status === 'LOBBY' || state.status === 'GAMEOVER') {
    overthrowSeenKey = '';
    return;
  }
  const o = b.lastOverthrow;
  const key = `${state.code || ''}:${o ? `${o.round}:${o.zoneId}:${o.to}` : '-'}`;
  if (overthrowSeenKey === '') {
    overthrowSeenKey = key;
    return;
  }
  if (key === overthrowSeenKey) return;
  overthrowSeenKey = key;
  if (!o) return;
  showEventTitleCard({
    kicker: 'Rebellion',
    title: 'Overthrown!',
    subtitle: `${playerName(o.to)} takes a walled zone from ${playerName(o.from)}: control and tax rights change hands`,
    tone: 'danger',
    icon: 'crown',
    durationMs: 3200
  });
}

/** Called from `renderAll` on every state. */
export function renderBulwark(): void {
  const b = state.bulwark;
  syncOverthrowCard(b);
  const layer = ensureLayer();
  if (!layer) return;
  if (!b || state.status === 'LOBBY' || !state.board?.vertices) {
    if (lastHtml !== '') {
      lastHtml = '';
      layer.innerHTML = '';
    }
    return;
  }
  ensureStyles();
  // Gates and banners grow with the camera like buildings do: borrow the board's building scale.
  const scale = document.getElementById('boardVerticesLayer')?.style.getPropertyValue('--building-scale');
  if (scale && (layer as HTMLElement).style?.getPropertyValue('--building-scale') !== scale) (layer as unknown as HTMLElement).style.setProperty('--building-scale', scale);
  let html = '';
  for (const [eid, hp] of Object.entries(b.damaged ?? {})) html += damagedMarkup(Number(eid), Number(hp));
  for (const g of b.gates ?? []) html += gateMarkup(b, g);
  for (const z of b.zones ?? []) html += bannerMarkup(z);
  if (html !== lastHtml) {
    lastHtml = html;
    layer.innerHTML = html;
  }
}
