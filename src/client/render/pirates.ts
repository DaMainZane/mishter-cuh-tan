// MODULE: Tidebound T10 pirates on the board (pirate icon markup, the SVG layer markup, click to drive one off); draws its own styles | DEPENDS ON: client/audio, client/icons, client/pirateIcon, client/socket, client/store, client/util | USED BY: client/main, client/render/board
import { playTone } from '../audio';
import { hexIconLayout } from '../icons';
import { PIRATE_ICON_CY, PIRATE_ICON_RADIUS, pirateIconMarkup, pirateLook } from '../pirateIcon';
import { socket } from '../socket';
import { hasDraggedMap, state } from '../store';
import { esc } from '../util';

const STYLE_ID = 'pirateStyles';

/** Styles live here (like the bridge picker's) so the pirate layer needs nothing from `styles.css`. Added once, on first draw. */
function ensurePirateStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
    @keyframes pirate-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2.5px); } }
    @keyframes pirate-ring-pulse { 0%, 100% { opacity: 0.95; } 50% { opacity: 0.35; } }
    .pirate-bob { animation: pirate-bob 2.6s ease-in-out infinite; }
    .pirate-flee .pirate-bob { animation-duration: 0.9s; }
    .pirate-ring { fill: none; stroke: var(--accent); stroke-width: 3; stroke-dasharray: 6 4; animation: pirate-ring-pulse 1.4s ease-in-out infinite; }
    .pirate-face { fill: #c0404f; stroke: #3a0d14; stroke-width: 16; stroke-linejoin: round; }
    .pirate-wood { fill: #5a2a14; stroke: #3a0d14; stroke-width: 12; stroke-linejoin: round; }
    .pirate-glyph { fill: #2a080e; }
    .pirate-badge { fill: var(--token); stroke: var(--ink); stroke-width: 1.6; }
    .pirate-badge-text { fill: var(--token-ink); font-weight: 800; text-anchor: middle; font-size: 12px; }
    .pirate-flee .pirate-face, .pirate-flee .pirate-wood, .pirate-flee .pirate-glyph { opacity: 0.7; }
    .piece-zoom-scale { transform: scale(var(--piece-zoom, 1)); transform-origin: 0 0; }
    @media (prefers-reduced-motion: reduce) { .pirate-bob, .pirate-ring { animation: none; } }
  `;
  document.head.appendChild(el);
}

/**
 * The pirate drawn around (0, 0): a crimson badge with a head, a crossed pair and two side parts (picked from `id`, UI only; see `client/pirateIcon.ts`),
 * with the strength badge underneath.
 */
export function pirateMarkup(strength: number, fleeing: boolean, id = ''): string {
  const s = Math.max(1, Math.round(Number(strength) || 1));
  return `
    <g class="${fleeing ? 'pirate-flee' : ''}">
      <g class="pirate-bob">
        ${pirateIconMarkup(pirateLook(id))}
      </g>
      <g transform="translate(0,${PIRATE_ICON_CY + PIRATE_ICON_RADIUS + 10})">
        <circle class="pirate-badge" r="10" />
        <text class="pirate-badge-text" y="4.4">${s}</text>
      </g>
    </g>`;
}

/**
 * The pirates layer: one ship per pirate on its sea tile. A pirate you can drive off right now (`drives` = the server's `pirateDrives`)
 * gets a pulsing ring and a click handler; everyone sees the strength badge and the title text (what it takes).
 */
export function renderPiratesMarkup(
  pirates: { id: string; hexId: number; strength: number; mode: string }[],
  hexes: any[],
  drives: number[],
  crowdedFishHexes?: Set<number>,
  crowdedWreckHexes?: Set<number>
): string {
  if (!pirates || pirates.length === 0) return '';
  ensurePirateStyles();
  const canDrive = new Set<number>(drives || []);
  let html = '';
  for (const p of pirates) {
    const h = hexes[p.hexId];
    if (!h || h.fog) continue;
    const { pirateOffset } = hexIconLayout({
      hasFish: crowdedFishHexes?.has(p.hexId) ?? false,
      hasSeaWreck: crowdedWreckHexes?.has(p.hexId) ?? false,
      hasPirate: true
    });
    const px = Number(h.x) + pirateOffset.dx;
    const py = Number(h.y) + pirateOffset.dy;
    const fleeing = p.mode === 'flee';
    const clickable = canDrive.has(p.hexId);
    const title = `Pirate ship, strength ${p.strength}${fleeing ? ' (fleeing)' : ''}: ${
      clickable ? 'click to drive it off' : `driving it off takes ${p.strength} played knight${p.strength === 1 ? '' : 's'} and a road, bridge or port touching this tile`
    }`;
    html += `
      <g transform="translate(${px.toFixed(1)}, ${py.toFixed(1)}) scale(1.2)" data-pirate-id="${esc(p.id)}"
         ${clickable ? `onclick="clickPirate(${p.hexId})" style="cursor:pointer"` : 'style="pointer-events:none"'}>
        <title>${esc(title)}</title>
        <g class="piece-zoom-scale">
          ${clickable ? `<circle class="pirate-ring" cy="${PIRATE_ICON_CY}" r="${PIRATE_ICON_RADIUS + 5}" />` : ''}
          ${pirateMarkup(p.strength, fleeing, p.id)}
        </g>
      </g>`;
  }
  return html;
}

/** Drive off the pirate on this tile (only offered on pirates the server listed in your `pirateDrives`). */
export function clickPirate(hexId: number): void {
  if (hasDraggedMap || !state) return;
  playTone(600, 0.1);
  socket.emit('act', { code: state.code, type: 'drive_off_pirate', payload: { hexId } });
}
