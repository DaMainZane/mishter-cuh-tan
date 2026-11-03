// MODULE: board SVG renderer, camera, board input and board animations | DEPENDS ON: client/audio, client/buildMenu, client/constants, client/debug, client/icons, client/panPreview, +12 more | USED BY: client/actions, client/debug, client/main, client/render/bridgepicker, client/render/hand, client/render/index
// Flat style from "Design UI Philosophy.md": matte tiles with a small gap, pictogram glyph + circle number token,
// pieces with a light rim, quiet highlights (accent color) for anything the player can click.
import { RES_META } from '../constants';
import { getBoardIconSvg, getMiniSvg, getDevSvg, uiIcon, settlementMarkup, cityMarkup, netTileMarkup, bridgeEdgeMarkup, robberMarkup, fishGroundMarkup, wreckMarkup, hexIconLayout } from '../icons';
import {
  playTone,
  playPlaceRoadSound,
  playBridgeCollapseSound,
  playWreckSpawnSound,
  playPlaceSettlementSound,
  playPlaceCitySound,
  playPlaceRobberSound,
  playStealCardSound,
  playDiscardSound,
  playTradeSound,
  playBuyDevCardSound,
  playAwardSound
} from '../audio';
import { socket } from '../socket';
import {
  state, camZoom, camPanX, camPanY, activeBrush, isMouseDown, hasDraggedMap, elevationView,
  buildMode, setBuildModeValue, setCamZoom, setCamPan, getClientSpeed,
  addInFlightResource, releaseInFlightResource, addInFlightDev, releaseInFlightDev
} from '../store';
import { renderHand } from './hand';
import { fishTileOutlineMarkup, overlayPatternDefsMarkup, renderElevationMarkup, renderHexOverlaysMarkup } from './overlay';
import { renderSidebar, visibleRect } from './sidebar';
import { esc } from '../util';
import { openBridgePicker } from './bridgepicker';
import { syncBuildMenu } from './buildmenu';
import { renderPiratesMarkup } from './pirates';
import { hasPlacedShape, isPieceMode, pieceSpotsMarkup, placedEdgeMarkup, placedVertexMarkup } from '../pieceui';
import { portRaiseSpots } from '../pieceModel';
import { edgeOptions, hexCandidates, hexOptions, vertexOptions } from '../buildMenu';
import type { BuildOption, MenuContext } from '../buildMenu';
import { manifestEntries } from '../visuals';
import { isDebugOverlayActive, renderDebugBoardOverlayMarkup } from '../debug';
import { hiddenEdges, needsRepaint } from '../panPreview';
import type { Box } from '../panPreview';

const knownRoads = new Set<number>();
const knownRoadPieces = new Map<number, { owner: string; pieceType: string }>();
const collapsingBridges = new Map<number, { owner: string; pieceType: string; start: number }>();
const COLLAPSE_ANIM_MS = 620;
const knownBuildings = new Map<number, string>();
const knownFogHexes = new Set<number>();
// Sea tiles that already carry a net, so a new one plays its placing sound once.
const knownNetTiles = new Set<number>();
const knownWrecks = new Set<string>();
const WRECK_ANIM_MS = 760;
let knownRobberHexId: number | null = null;
// Tiles that just produced go dark for a moment, then fade back. Keyed so repaints do not restart it.
const ROLL_DIM_MS = 2000;
let knownRollKey = '';
let rollStart = 0;
const pieceAnimTimestamps = new Map<string, number>();
const ANIM_DURATION_MS = 420;

// Robber sits beside the number token. Shared by the board and the move animation.
const ROBBER_DX = 30;
const ROBBER_DY = -8;

// Base size of settlements, cities, and roads at default zoom. The zoom-out boost and its cap scale with it.
const BUILDING_BASE_SCALE = 1.5;
const ROAD_BASE_SCALE = 1.15;

let cachedBoundsKey = '';
let cachedBounds = { centerX0: 0, centerY0: 0, contentW: 1000, contentH: 900 };
let lastBuildingScale = -1;
let lastRoadScale = -1;
let cameraRafPending = false;
// BUG 1 (drag lag on big maps): the camera pan the viewBox was last written for. While dragging, the board is moved by a CSS translate of the
// difference instead of a new viewBox, so the browser moves one painted layer instead of repainting every SVG node each frame.
let committedPanX = 0;
let committedPanY = 0;
/** Off-screen board on each side at the last repaint, in pixels (computed on the first drag frame after it). */
let panHidden: Box | null = null;
let panRect: DOMRect | null = null;
let panFramePending = false;
/** Unpainted strip (a share of the shorter screen side) a drag may show before the board repaints mid-drag. */
const PAN_SLACK = 0.12;

// Layer dirty-keys so gameplay updates (rolls, trades, builds, selections) do not rebuild static hex terrain or ports.
let lastTerrainKey = '';
let lastPortsKey = '';
let lastPlacedRoadsKey = '';
// The overlay layer is only rewritten when its markup changes, so the flood warning's fading flash is not restarted by every state update.
let lastOverlayHtml = '';
// Same for the fish icons on the sea (T7c): rewritten only when their markup changes.
let lastFishHtml = '';
// Fishing nets over the sea tiles they fish (fishing net bug): rewritten only when their markup changes.
let lastNetsHtml = '';
let lastWrecksHtml = '';
let lastPiratesHtml = '';
// R8.7: the generic spot layer for manifest pieces is only rewritten when its markup changes.
let lastPieceSpotsHtml = '';
let lastHexDynamicHtml = '';
let lastRoadSpotsHtml = '';
let lastVerticesHtml = '';
let lastDebugHtml = '';

interface HexGeomCache {
  rawPts: string;
  pathSub: string;
  tilePoly: string;
  innerPoly: string;
}
let cachedGeomBoardKey = '';
let hexGeomCache = new Map<number, HexGeomCache>();

interface RoadConnInfo {
  ownerName: string;
  ownerColor: string;
  totalRoads: number;
  longestStretch: number;
  longestPathEdges: Set<number>;
  componentEdges: number[];
}
const roadAnalysisCache = new Map<number, RoadConnInfo>();

export function getBoardBounds(): { centerX0: number; centerY0: number; contentW: number; contentH: number } {
  if (!state || !state.board || !state.board.hexes || state.board.hexes.length === 0) {
    return { centerX0: 0, centerY0: 0, contentW: 1000, contentH: 900 };
  }
  const firstHex = state.board.hexes[0];
  const lastHex = state.board.hexes[state.board.hexes.length - 1];
  const key = `${state.code}_${state.status}_${state.board.hexes.length}_${firstHex?.x ?? 0}_${lastHex?.x ?? 0}`;
  if (key === cachedBoundsKey) return cachedBounds;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  state.board.hexes.forEach((h: any) => {
    h.corners.forEach((pt: any) => {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    });
  });

  const topExtra = state.status === 'LOBBY' ? 210 : 115;
  const bottomExtra = 165;
  const sidePad = 130;

  const contentX = minX - sidePad;
  const contentY = minY - topExtra;
  const contentW = (maxX - minX) + sidePad * 2;
  const contentH = (maxY - minY) + topExtra + bottomExtra;

  cachedBoundsKey = key;
  cachedBounds = {
    centerX0: contentX + contentW / 2,
    centerY0: contentY + contentH / 2,
    contentW,
    contentH
  };
  return cachedBounds;
}

export function updateCameraViewBox(): void {
  if (!state || !state.board) return;
  const svg = document.getElementById('boardSvg');
  if (!svg) return;
  const { centerX0, centerY0, contentW, contentH } = getBoardBounds();
  const baseW = contentW * camZoom;
  const baseH = contentH * camZoom;
  const baseX = (centerX0 - camPanX) - baseW / 2;
  const baseY = (centerY0 - camPanY) - baseH / 2;
  svg.setAttribute('viewBox', `${baseX.toFixed(1)} ${baseY.toFixed(1)} ${baseW.toFixed(1)} ${baseH.toFixed(1)}`);
  committedPanX = camPanX;
  committedPanY = camPanY;
  panHidden = null;
  const panLayer = document.getElementById('boardPan');
  if (panLayer?.style.transform) panLayer.style.transform = '';

  // Scale settlements, cities, robber, shipwrecks, pirates, and roads up as the camera zooms out (or on larger boards).
  // Scoped to the vertex/spot, dynamic/wreck/pirate, and road layers (never set on #boardSvg) so zooming does not invalidate styles on #boardTerrainLayer (Bug 14).
  const zoomFactor = Math.max(camZoom, Math.max(baseW, baseH) / 720);
  const buildingScale = Math.min(2.8, BUILDING_BASE_SCALE * Math.pow(Math.max(1, zoomFactor), 0.62));
  const roadScale = Math.min(2.45, ROAD_BASE_SCALE * Math.pow(Math.max(1, zoomFactor), 0.58));
  if (Math.abs(buildingScale - lastBuildingScale) >= 0.015) {
    lastBuildingScale = buildingScale;
    const bs = buildingScale.toFixed(3);
    const pz = (buildingScale / BUILDING_BASE_SCALE).toFixed(3);
    for (const id of ['boardVerticesLayer', 'boardPieceSpotsLayer']) {
      document.getElementById(id)?.style.setProperty('--building-scale', bs);
    }
    for (const id of ['boardHexDynamicLayer', 'boardWrecksLayer', 'boardPiratesLayer', 'boardDebugLayer']) {
      document.getElementById(id)?.style.setProperty('--piece-zoom', pz);
    }
  }
  if (Math.abs(roadScale - lastRoadScale) >= 0.015) {
    lastRoadScale = roadScale;
    const rs = roadScale.toFixed(3);
    for (const id of ['roadHighlightLayer', 'roadRimsLayer', 'roadBodiesLayer', 'roadHitsLayer', 'roadSpotsLayer']) {
      document.getElementById(id)?.style.setProperty('--road-scale', rs);
    }
  }
}

function getPieceAnimAttrs(key: string, now: number): { isAnimating: boolean; delayStyle: string } {
  const start = pieceAnimTimestamps.get(key);
  if (start === undefined) return { isAnimating: false, delayStyle: '' };
  const elapsed = now - start;
  if (elapsed >= ANIM_DURATION_MS) return { isAnimating: false, delayStyle: '' };
  return {
    isAnimating: true,
    delayStyle: `animation-delay: -${Math.max(0, Math.round(elapsed))}ms;`
  };
}

// Hex corners pulled toward the center so neighbouring tiles leave a thin gap of sea between them.
function insetPoints(h: any, inset: number): string {
  return h.corners.map((c: any) => {
    const dx = c.x - h.x, dy = c.y - h.y;
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.max(0, (len - inset) / len);
    return `${(h.x + dx * k).toFixed(1)},${(h.y + dy * k).toFixed(1)}`;
  }).join(' ');
}

function ensureHexGeomCache(hexes: any[]): void {
  const first = hexes[0];
  const last = hexes[hexes.length - 1];
  const geomKey = `${state?.code || ''}_${hexes.length}_${first?.x ?? 0}_${first?.y ?? 0}_${last?.x ?? 0}_${last?.y ?? 0}`;
  if (geomKey === cachedGeomBoardKey && hexGeomCache.size === hexes.length) return;
  cachedGeomBoardKey = geomKey;
  hexGeomCache = new Map();
  for (const h of hexes) {
    const rawPts = h.corners.map((c: any) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const pathSub = h.corners
      .map((c: any, idx: number) => `${idx === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
      .join('') + 'Z';
    hexGeomCache.set(h.id, {
      rawPts,
      pathSub,
      tilePoly: insetPoints(h, 5.5),
      innerPoly: insetPoints(h, 7.5)
    });
  }
}

function ensureBoardLayers(svg: HTMLElement): {
  terrainLayer: HTMLElement;
  overlayLayer: HTMLElement;
  netsLayer: Element;
  fishLayer: Element;
  wrecksLayer: Element;
  piratesLayer: Element;
  pieceSpotsLayer: Element;
  portsLayer: HTMLElement;
  hexDynamicLayer: HTMLElement;
  roadRimsLayer: HTMLElement;
  roadBodiesLayer: HTMLElement;
  roadHitsLayer: HTMLElement;
  roadSpotsLayer: HTMLElement;
  verticesLayer: HTMLElement;
} {
  let terrainLayer = document.getElementById('boardTerrainLayer');
  if (!terrainLayer || terrainLayer.parentElement !== svg) {
    svg.innerHTML = `
      ${overlayPatternDefsMarkup()}
      <g id="boardTerrainLayer"></g>
      <g id="boardOverlayLayer"></g>
      <g id="boardNetsLayer"></g>
      <g id="boardFishLayer"></g>
      <g id="boardWrecksLayer"></g>
      <g id="boardPiratesLayer"></g>
      <g id="boardHexDynamicLayer"></g>
      <g id="boardPortsLayer"></g>
      <g id="roadHighlightLayer"></g>
      <g id="roadRimsLayer"></g>
      <g id="roadBodiesLayer"></g>
      <g id="roadHitsLayer"></g>
      <g id="roadSpotsLayer"></g>
      <g id="boardVerticesLayer"></g>
      <g id="boardPieceSpotsLayer"></g>
      <g id="boardDebugLayer"></g>
    `;
    lastTerrainKey = '';
    lastPortsKey = '';
    lastPlacedRoadsKey = '';
    lastOverlayHtml = '';
    lastNetsHtml = '';
    lastFishHtml = '';
    lastWrecksHtml = '';
    lastPiratesHtml = '';
    lastPieceSpotsHtml = '';
    lastHexDynamicHtml = '';
    lastRoadSpotsHtml = '';
    lastVerticesHtml = '';
    lastDebugHtml = '';
    lastBuildingScale = -1;
    lastRoadScale = -1;
    terrainLayer = document.getElementById('boardTerrainLayer')!;
  }
  // A board drawn before the fish layer existed (an open tab across an update) gets it added without a full rebuild.
  let fishLayer: Element | null = document.getElementById('boardFishLayer');
  if (!fishLayer) {
    fishLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    fishLayer.id = 'boardFishLayer';
    document.getElementById('boardOverlayLayer')!.after(fishLayer);
    lastFishHtml = '';
  }
  // Same for the nets layer, which sits under the fish icons.
  let netsLayer: Element | null = document.getElementById('boardNetsLayer');
  if (!netsLayer) {
    netsLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    netsLayer.id = 'boardNetsLayer';
    fishLayer.before(netsLayer);
    lastNetsHtml = '';
  }
  let wrecksLayer: Element | null = document.getElementById('boardWrecksLayer');
  if (!wrecksLayer) {
    wrecksLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    wrecksLayer.id = 'boardWrecksLayer';
    fishLayer.after(wrecksLayer);
    lastWrecksHtml = '';
    lastBuildingScale = -1;
  }
  // Same for the generic piece spots layer (R8.7), which sits above the vertices so its spots can be clicked.
  let pieceSpotsLayer: Element | null = document.getElementById('boardPieceSpotsLayer');
  if (!pieceSpotsLayer) {
    pieceSpotsLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    pieceSpotsLayer.id = 'boardPieceSpotsLayer';
    document.getElementById('boardVerticesLayer')!.after(pieceSpotsLayer);
    lastPieceSpotsHtml = '';
    lastBuildingScale = -1;
  }
  // Same for the pirates layer (T10).
  let piratesLayer: Element | null = document.getElementById('boardPiratesLayer');
  if (!piratesLayer) {
    piratesLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    piratesLayer.id = 'boardPiratesLayer';
    wrecksLayer.after(piratesLayer);
    lastPiratesHtml = '';
    lastBuildingScale = -1;
  }
  return {
    terrainLayer,
    overlayLayer: document.getElementById('boardOverlayLayer')!,
    netsLayer,
    fishLayer,
    wrecksLayer,
    piratesLayer,
    pieceSpotsLayer,
    portsLayer: document.getElementById('boardPortsLayer')!,
    hexDynamicLayer: document.getElementById('boardHexDynamicLayer')!,
    roadRimsLayer: document.getElementById('roadRimsLayer')!,
    roadBodiesLayer: document.getElementById('roadBodiesLayer')!,
    roadHitsLayer: document.getElementById('roadHitsLayer')!,
    roadSpotsLayer: document.getElementById('roadSpotsLayer')!,
    verticesLayer: document.getElementById('boardVerticesLayer')!
  };
}

// Number token: circle with the number (6 and 8 in the "hot" color).
function tokenMarkup(n: number): string {
  const hot = n === 6 || n === 8;
  const ink = hot ? 'var(--token-hot)' : 'var(--token-ink)';
  return `
    <g transform="translate(0,22)">
      <circle r="19" style="fill:var(--token)"/>
      <text class="token-text" y="8" font-size="22" style="fill:${ink}">${n}</text>
    </g>`;
}

// Trading port dock strictly aligned to the coastal hex edge (tangent T along v1->v2, outward normal N).
function portMarkup(e: any, v1: any, v2: any, h: any, owned: boolean, isLobbyHost: boolean, node: PortNode | null): string {
  const mx = (v1.x + v2.x) / 2;
  const my = (v1.y + v2.y) / 2;
  const dx = mx - h.x;
  const dy = my - h.y;
  const nLen = Math.hypot(dx, dy) || 1;
  const nx = dx / nLen;
  const ny = dy / nLen;

  const ex = v2.x - v1.x;
  const ey = v2.y - v1.y;
  const eLen = Math.hypot(ex, ey) || 1;
  const tx = ex / eLen;
  const ty = ey / eLen;

  // Two sturdy planked piers that run the full length of the coastal hex side (anchored near its two corners)
  // and reach straight out along the outward normal. Narrower at the tip, like a landing.
  const D0 = -4.5;                       // the drawn tile edge sits just inside the geometric edge
  const D1 = 35;                         // pier tip
  const hw0 = Math.max(14, eLen / 2 - 7);
  const hw1 = hw0 * 0.55;
  const b1x = mx - tx * hw0 + nx * D0;
  const b1y = my - ty * hw0 + ny * D0;
  const b2x = mx + tx * hw0 + nx * D0;
  const b2y = my + ty * hw0 + ny * D0;

  const t1x = mx - tx * hw1 + nx * D1;
  const t1y = my - ty * hw1 + ny * D1;
  const t2x = mx + tx * hw1 + nx * D1;
  const t2y = my + ty * hw1 + ny * D1;

  // Cross-planks parallel to the hex edge
  const planks = [7, 16, 25].map(d => {
    const f = (d - D0) / (D1 - D0);
    const halfW = hw0 * (1 - f) + hw1 * f;
    const px = mx + nx * d;
    const py = my + ny * d;
    return `<line class="port-plank" x1="${(px - tx * halfW).toFixed(1)}" y1="${(py - ty * halfW).toFixed(1)}" x2="${(px + tx * halfW).toFixed(1)}" y2="${(py + ty * halfW).toFixed(1)}" />`;
  }).join('');

  const sx = mx + nx * 42;
  const sy = my + ny * 42;

  const pLvl = Math.max(state.portLevels?.[e.v1] || 0, state.portLevels?.[e.v2] || 0);
  const any = e.port === '3:1';
  const kind: string = any ? 'any' : e.port;
  // A harbor (level 2) replaces the port sprite: a dark badge with an anchor and a 1:1 pill (BUG: the harbor looked the same as the port).
  const isHarborPort = pLvl >= 2;
  const badgeFill = isHarborPort ? 'var(--pier-dark)' : any ? 'var(--token)' : (RES_META[kind]?.color || 'var(--token)');
  const badgeBorder = isHarborPort ? 'var(--accent)' : any ? 'var(--pier-dark)' : (RES_META[kind]?.border || 'var(--pier-dark)');
  const ratioText = pLvl >= 2 ? '1:1' : pLvl === 1 || !any ? '2:1' : '3:1';
  const label = isHarborPort
    ? `<g class="port-harbor-icon" transform="translate(${(sx - 10).toFixed(1)}, ${(sy - 17).toFixed(1)})">${uiIcon('harbor', 20)}</g>
       <rect class="port-ratio-pill" x="${(sx - 13).toFixed(1)}" y="${(sy + 5).toFixed(1)}" width="26" height="12" rx="6" />
       <text class="port-text" x="${sx.toFixed(1)}" y="${(sy + 14).toFixed(1)}" font-size="8.8">${ratioText}</text>`
    : any
    ? `<text class="port-text" x="${sx.toFixed(1)}" y="${(sy + 4.5).toFixed(1)}" font-size="13">${ratioText}</text>`
    : `${getBoardIconSvg(kind, Number(sx.toFixed(1)), Number((sy - 4.5).toFixed(1)), 0.56)}
       <rect class="port-ratio-pill" x="${(sx - 13).toFixed(1)}" y="${(sy + 5).toFixed(1)}" width="26" height="12" rx="6" />
       <text class="port-text" x="${sx.toFixed(1)}" y="${(sy + 14).toFixed(1)}" font-size="8.8">${ratioText}</text>`;

  const canPaintPort = isLobbyHost && activeBrush.type === 'port';
  return `
    <g data-paintable="${canPaintPort ? '1' : ''}" onclick="${canPaintPort ? `onEdgeInteract(${e.id})` : ''}" style="${canPaintPort ? 'cursor:pointer' : ''}">
      <polygon class="port-dock-apron" points="${b1x.toFixed(1)},${b1y.toFixed(1)} ${b2x.toFixed(1)},${b2y.toFixed(1)} ${t2x.toFixed(1)},${t2y.toFixed(1)} ${t1x.toFixed(1)},${t1y.toFixed(1)}" />
      ${planks}
      <line class="port-pier-rim" x1="${b1x.toFixed(1)}" y1="${b1y.toFixed(1)}" x2="${t1x.toFixed(1)}" y2="${t1y.toFixed(1)}" style="stroke-width:11;stroke-linecap:round" />
      <line class="port-pier-rim" x1="${b2x.toFixed(1)}" y1="${b2y.toFixed(1)}" x2="${t2x.toFixed(1)}" y2="${t2y.toFixed(1)}" style="stroke-width:11;stroke-linecap:round" />
      <line class="port-pier" x1="${b1x.toFixed(1)}" y1="${b1y.toFixed(1)}" x2="${t1x.toFixed(1)}" y2="${t1y.toFixed(1)}" style="stroke-width:6.5;stroke-linecap:round" />
      <line class="port-pier" x1="${b2x.toFixed(1)}" y1="${b2y.toFixed(1)}" x2="${t2x.toFixed(1)}" y2="${t2y.toFixed(1)}" style="stroke-width:6.5;stroke-linecap:round" />
      <circle class="port-post" cx="${b1x.toFixed(1)}" cy="${b1y.toFixed(1)}" r="5.2" />
      <circle class="port-post" cx="${b2x.toFixed(1)}" cy="${b2y.toFixed(1)}" r="5.2" />
      ${owned ? `<circle class="port-ring" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="24" />` : ''}
      <circle class="port-badge-outer${isHarborPort ? ' harbor' : ''}" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="21" />
      <circle class="port-badge" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="17.5" style="fill:${badgeFill};stroke:${badgeBorder}" />
      ${label}
      ${node ? `<g class="port-node${node.dim ? ' hot-dim' : ''}" onclick="${node.call}" style="cursor:pointer"><circle class="port-node-ring" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="26" /><circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="26" fill="transparent" /></g>` : ''}
    </g>`;
}

/** The port is the node for a harbor upgrade and a port raise (not the city on it): the click it sends, and whether you cannot pay for any of it yet. */
interface PortNode {
  call: string;
  dim: boolean;
}

export function renderBoard(me: any, isMyTurn: boolean): void {
  if (!state || !state.board) return;
  const svg = document.getElementById('boardSvg')!;
  const { hexes, vertices, edges, robberHexId } = state.board;
  const isLobbyHost = state.status === 'LOBBY' && state.hostId === socket.id;
  const rolledHexSet = new Set<number>(state.lastRollHexIds || []);

  ensureHexGeomCache(hexes);
  const layers = ensureBoardLayers(svg);

  if (state.status === 'LOBBY') {
    knownRoads.clear();
    knownRoadPieces.clear();
    collapsingBridges.clear();
    knownBuildings.clear();
    knownFogHexes.clear();
    knownNetTiles.clear();
    knownWrecks.clear();
    pieceAnimTimestamps.clear();
    roadAnalysisCache.clear();
    knownRobberHexId = robberHexId;
    for (const h of hexes) {
      if (h.fog || h.type === 'fog') knownFogHexes.add(h.id);
    }
    for (const w of state.wrecks || []) {
      knownWrecks.add(w.id);
    }
  }

  const now = performance.now();
  if (state.phase !== 'ROLL') {
    const rollKey = `${state.turnCount}|${(state.lastRollHexIds || []).join(',')}|${(state.lastDice || []).join(',')}`;
    if (rollKey !== knownRollKey) { knownRollKey = rollKey; rollStart = now; }
  }
  const rollElapsed = now - rollStart;
  const showRollDim = rollElapsed < ROLL_DIM_MS;
  const rollDimStyle = `animation-delay: -${Math.max(0, Math.round(rollElapsed))}ms;`;
  let playedRoadSfx = false;
  let playedCollapseSfx = false;
  let playedSettleSfx = false;
  let playedCitySfx = false;

  if (state.status !== 'LOBBY') {
    if (knownRobberHexId !== null && knownRobberHexId !== robberHexId) {
      const prevHexId = knownRobberHexId;
      knownRobberHexId = robberHexId;
      pieceAnimTimestamps.set('robber_move', now);
      playPlaceRobberSound();
      setTimeout(() => triggerRobberMoveAnimation(prevHexId, robberHexId), 0);
    } else if (knownRobberHexId === null) {
      knownRobberHexId = robberHexId;
    }
  }

  let hasActiveFogAnim = false;
  for (const h of hexes) {
    const isFog = !!h.fog || h.type === 'fog';
    if (isFog) {
      knownFogHexes.add(h.id);
    } else if (knownFogHexes.has(h.id)) {
      knownFogHexes.delete(h.id);
      pieceAnimTimestamps.set(`fog_${h.id}`, now);
    }
    if (!hasActiveFogAnim && getPieceAnimAttrs(`fog_${h.id}`, now).isAnimating) {
      hasActiveFogAnim = true;
    }
  }

  let hasActiveRoadAnim = false;
  for (const e of edges) {
    const prevRoad = knownRoadPieces.get(e.id);
    const curType = e.pieceType || 'road';
    if (e.road) {
      if (!knownRoads.has(e.id) || (prevRoad && prevRoad.pieceType !== curType)) {
        knownRoads.add(e.id);
        knownRoadPieces.set(e.id, { owner: e.road, pieceType: curType });
        collapsingBridges.delete(e.id);
        pieceAnimTimestamps.set(`road_${e.id}`, now);
        if (state.status !== 'LOBBY' && !playedRoadSfx) {
          playedRoadSfx = true;
          playPlaceRoadSound();
        }
      } else if (!prevRoad) {
        knownRoadPieces.set(e.id, { owner: e.road, pieceType: curType });
      }
    } else if (prevRoad || knownRoads.has(e.id)) {
      knownRoads.delete(e.id);
      knownRoadPieces.delete(e.id);
      if (state.status !== 'LOBBY' && prevRoad) {
        collapsingBridges.set(e.id, { owner: prevRoad.owner, pieceType: prevRoad.pieceType, start: now });
        if (!playedCollapseSfx) {
          playedCollapseSfx = true;
          playBridgeCollapseSound();
        }
        setTimeout(() => syncInFlightUi(), COLLAPSE_ANIM_MS + 30);
      }
    }
    if (!hasActiveRoadAnim && e.road && getPieceAnimAttrs(`road_${e.id}`, now).isAnimating) {
      hasActiveRoadAnim = true;
    }
  }
  for (const [edgeId, c] of collapsingBridges) {
    if (now - c.start >= COLLAPSE_ANIM_MS) {
      collapsingBridges.delete(edgeId);
    } else {
      hasActiveRoadAnim = true;
    }
  }
  for (const v of vertices) {
    if (v.building) {
      const prev = knownBuildings.get(v.id);
      if (prev !== v.building.type) {
        knownBuildings.set(v.id, v.building.type);
        pieceAnimTimestamps.set(`${v.building.type}_${v.id}`, now);
        if (state.status !== 'LOBBY') {
          if (v.building.type === 'city' && !playedCitySfx) {
            playedCitySfx = true;
            playPlaceCitySound();
          } else if ((v.building.type === 'settlement' || hasPlacedShape(v.building.type)) && !playedSettleSfx) {
            playedSettleSfx = true;
            playPlaceSettlementSound();
          }
        }
      }
    }
  }

  updateCameraViewBox();

  // 1. Static / Terrain Layer: rebuilds only when board terrain/numbers/fog/lobby brush changes.
  const canPaintHex = isLobbyHost && (activeBrush.type === 'terrain' || activeBrush.type === 'number' || activeBrush.type === 'robber');
  const terrainSigParts: string[] = [
    cachedGeomBoardKey,
    state.status,
    canPaintHex ? '1' : '0',
    hasActiveFogAnim ? String(Math.floor(now / 32)) : '0'
  ];
  for (const h of hexes) {
    const isFog = !!h.fog || h.type === 'fog';
    terrainSigParts.push(`${isFog ? 'fog' : h.type}:${isFog ? '' : (h.number || '')}`);
  }
  const terrainKey = terrainSigParts.join('|');

  if (terrainKey !== lastTerrainKey) {
    lastTerrainKey = terrainKey;
    let landPathD = '';
    let waterPathD = '';
    for (const h of hexes) {
      const g = hexGeomCache.get(h.id);
      if (!g) continue;
      if (h.type === 'water') {
        if (state.status === 'LOBBY' && !canPaintHex) waterPathD += g.pathSub;
        continue;
      }
      landPathD += g.pathSub;
    }

    let terrainHtml = '';
    if (landPathD) {
      // Single combined <path> for shallow water and single <path> for sand instead of 2*N separate polygons.
      terrainHtml += `<path d="${landPathD}" style="fill:var(--sea-shallow);stroke:var(--sea-shallow);stroke-width:46;stroke-linejoin:round" />`;
      terrainHtml += `<path d="${landPathD}" style="fill:var(--sand);stroke:var(--sand);stroke-width:16;stroke-linejoin:round" />`;
    }
    if (waterPathD) {
      // Single combined <path> for non-paintable lobby water cells instead of ratusan dashed polygons (Bug 14).
      terrainHtml += `<path d="${waterPathD}" style="fill:rgba(255,255,255,0.06);stroke:rgba(255,255,255,0.24);stroke-width:1.6;stroke-linejoin:round;pointer-events:none" />`;
    }

    for (const h of hexes) {
      const geom = hexGeomCache.get(h.id)!;
      if (h.type === 'water') {
        if (state.status === 'LOBBY' && canPaintHex) {
          terrainHtml += `
            <polygon data-paintable="1" points="${geom.rawPts}" style="fill:rgba(255,255,255,0.07);stroke:rgba(255,255,255,0.32);stroke-width:2;cursor:pointer"
              onmousedown="onHexInteract(${h.id}, event)" onmouseenter="onHexEnter(${h.id}, event)" />
          `;
        }
        continue;
      }

      const isFog = !!h.fog || h.type === 'fog';
      const tileType = isFog ? 'fog' : h.type;
      const meta = RES_META[tileType] || RES_META.desert;
      const hasNumber = !isFog && !!h.number;
      const fogAnim = getPieceAnimAttrs(`fog_${h.id}`, now);
      const glyph = hasNumber ? getBoardIconSvg(tileType, 0, -24, 1.45) : getBoardIconSvg(tileType, 0, 0, 1.9);
      const paintAttrs = canPaintHex
        ? `data-paintable="1" style="cursor:pointer" onmousedown="onHexInteract(${h.id}, event)" onclick="onHexClick(${h.id}, event)" onmouseenter="onHexEnter(${h.id}, event)"`
        : '';

      terrainHtml += `
        <g ${paintAttrs}>
          <polygon points="${geom.tilePoly}" style="fill:${meta.color};stroke:${meta.border};stroke-width:4;stroke-linejoin:round" />
          <g transform="translate(${h.x}, ${h.y})">
            <g class="${fogAnim.isAnimating ? 'fog-reveal-anim' : ''}" style="${fogAnim.delayStyle}">
              ${glyph}
              ${hasNumber ? tokenMarkup(h.number) : ''}
            </g>
          </g>
        </g>
      `;
    }
    layers.terrainLayer.style.pointerEvents = canPaintHex ? 'auto' : 'none';
    layers.terrainLayer.innerHTML = terrainHtml;
  }

  // 2. Dynamic Hex Overlay Layer: rolled hex dimming, robber target highlights, and the robber piece.
  const robberAnim = getPieceAnimAttrs('robber_move', now);
  let hexDynHtml = '';
  const isRobberPhase = isMyTurn && state.phase === 'ROBBER';
  for (const h of hexes) {
    if (h.type === 'water') continue;
    const isFog = !!h.fog || h.type === 'fog';
    if (isFog) continue;
    const geom = hexGeomCache.get(h.id)!;
    const isRolledHex = showRollDim && rolledHexSet.has(h.id);
    const canClickRobber = isRobberPhase && h.id !== robberHexId;
    const hasRobber = h.id === robberHexId;

    if (!isRolledHex && !canClickRobber && !hasRobber) continue;

    if (isRolledHex) {
      hexDynHtml += `<polygon class="hex-rolled" points="${geom.innerPoly}" style="${rollDimStyle}" />`;
    }
    if (canClickRobber) {
      hexDynHtml += `
        <g onclick="onHexClick(${h.id}, event)" style="cursor:pointer">
          <polygon class="hex-tint" points="${geom.innerPoly}" />
          <polygon class="hex-target" points="${geom.innerPoly}" />
        </g>`;
    }
    if (hasRobber) {
      hexDynHtml += `
        <g transform="translate(${h.x + ROBBER_DX}, ${h.y + ROBBER_DY})" style="pointer-events:none">
          <g class="piece-zoom-scale">
            ${robberAnim.isAnimating ? `<circle cx="0" cy="0" r="24" class="robber-impact-ring" style="${robberAnim.delayStyle}" />` : ''}
            <g class="${robberAnim.isAnimating ? 'robber-drop-anim' : ''}" style="${robberAnim.delayStyle}">
              <g transform="scale(0.85)">${robberMarkup()}</g>
            </g>
          </g>
        </g>`;
    }
  }
  // Fishing nets: in net mode the sea tiles the server listed (`netSpots`, hex ids) are drawn as clickable tiles; a click puts the net on that tile.
  const netSpotSet = isMyTurn && buildMode === 'net' && state.phase === 'MAIN' && me && (me.netsLeft ?? 0) > 0 && canClientAffordPiece(me, 'net')
    ? new Set<number>(me.netSpots ?? [])
    : null;
  if (netSpotSet) {
    for (const id of [...netSpotSet].sort((a, b) => a - b)) {
      const geom = hexGeomCache.get(id);
      if (!geom) continue;
      hexDynHtml += `
        <g onclick="clickNetSpot(${id})" style="cursor:pointer">
          <polygon points="${geom.innerPoly}" style="fill:var(--accent);fill-opacity:0.16;stroke:var(--accent);stroke-width:3;stroke-dasharray:9 6;stroke-linejoin:round" />
        </g>`;
    }
  }
  if (hexDynHtml !== lastHexDynamicHtml) {
    lastHexDynamicHtml = hexDynHtml;
    layers.hexDynamicLayer.innerHTML = hexDynHtml;
  }
  // Tide overlays (flooded tint, warning a turn ahead), or the elevation heat map when the player switched it on (T6).
  const elevation = state.tide?.elevation ?? null;
  const overlayHtml = elevationView && elevation
    ? renderElevationMarkup(hexes, id => hexGeomCache.get(id)?.innerPoly, elevation)
    : renderHexOverlaysMarkup(hexes, id => hexGeomCache.get(id)?.innerPoly, (state as any).hexOverlays ?? null);
  if (overlayHtml !== lastOverlayHtml) {
    lastOverlayHtml = overlayHtml;
    layers.overlayLayer.innerHTML = overlayHtml;
  }

  // Fishing nets: a net sits on one sea tile and fishes only that tile, so it is drawn over that tile, under the fish icons. The tiles are public (`netTiles` of every player).
  let netsHtml = '';
  let newNetTile = false;
  const seenNetTiles = new Set<number>();
  for (const p of state.players) {
    for (const hexId of p.netTiles ?? []) {
      const h = hexes[hexId];
      if (!h || h.fog) continue;
      seenNetTiles.add(hexId);
      if (!knownNetTiles.has(hexId)) {
        knownNetTiles.add(hexId);
        newNetTile = true;
      }
      netsHtml += netTileMarkup(h.id, h.corners, h.x, h.y, p.color || '#888');
    }
  }
  for (const id of [...knownNetTiles]) if (!seenNetTiles.has(id)) knownNetTiles.delete(id);
  if (newNetTile && state.status !== 'LOBBY') playPlaceSettlementSound();
  if (netsHtml !== lastNetsHtml) {
    lastNetsHtml = netsHtml;
    layers.netsLayer.innerHTML = netsHtml;
  }

  // Fishing grounds (T7c, T7e) & shared hex icon slot layout (Bugs 5, 9, 17):
  // When a fish icon shares a sea tile with a pirate or sea wreck, each icon shifts into its predetermined slot so they never overlap.
  const fishIcons: Record<number, number> = state.fishIcons ?? {};
  const feedSpotSet = isMyTurn && buildMode === 'feed' && state.phase === 'MAIN' && me && canClientAffordFeed(me)
    ? new Set<number>(me.feedSpots ?? [])
    : null;
  const fishIds = new Set<number>(Object.keys(fishIcons).map(Number));
  if (feedSpotSet) for (const id of feedSpotSet) fishIds.add(id);

  const wrecks = state.wrecks || [];
  const pirates = state.pirates || [];
  const seaWreckHexIds = new Set<number>(wrecks.filter(w => w.site === 'sea').map(w => w.hexId));
  const pirateHexIds = new Set<number>(pirates.map(p => p.hexId));

  let fishHtml = '';
  for (const id of [...fishIds].sort((a, b) => a - b)) {
    const h = hexes[id];
    if (!h || h.fog) continue;
    const hasIcon = fishIcons[id] !== undefined;
    const left = hasIcon ? fishIcons[id] : 0;
    const inner = fishGroundMarkup(left);
    const { fishOffset } = hexIconLayout({
      hasFish: true,
      hasSeaWreck: seaWreckHexIds.has(id),
      hasPirate: pirateHexIds.has(id)
    });
    const fx = Number(h.x) + fishOffset.dx;
    const fy = Number(h.y) + fishOffset.dy;
    if (hasIcon) fishHtml += fishTileOutlineMarkup(hexGeomCache.get(id)?.tilePoly);
    if (feedSpotSet?.has(id)) {
      fishHtml += `
        <g transform="translate(${fx.toFixed(1)}, ${fy.toFixed(1)})" class="fish-spot" onclick="clickFeedSpot(${id})" style="cursor:pointer">
          <circle class="fish-ring" r="30" />
          <g transform="scale(1.25)" class="${hasIcon ? '' : 'fish-new'}">${inner}</g>
        </g>`;
    } else {
      fishHtml += `<g transform="translate(${fx.toFixed(1)}, ${fy.toFixed(1)}) scale(1.25)" style="pointer-events:none"><title>Fishing ground: ${Math.max(0, left)} of 4 boosts left</title>${inner}</g>`;
    }
  }
  if (fishHtml !== lastFishHtml) {
    lastFishHtml = fishHtml;
    layers.fishLayer.innerHTML = fishHtml;
  }

  // Shipwrecks (T9, Bugs 5, 9, 17): sea wrecks sit on the ocean tile (or top-right slot when sharing with fish/pirate);
  // shore wrecks beach in a coastal flank slot away from the tile's number token.
  const currentWreckIds = new Set<string>();
  let playedWreckSfx = false;
  for (const w of wrecks) {
    currentWreckIds.add(w.id);
    if (!knownWrecks.has(w.id)) {
      knownWrecks.add(w.id);
      pieceAnimTimestamps.set(`wreck_${w.id}`, now);
      if (state.status !== 'LOBBY' && !playedWreckSfx) {
        playedWreckSfx = true;
        playWreckSpawnSound(w.site);
      }
      setTimeout(() => syncInFlightUi(), WRECK_ANIM_MS + 30);
    }
  }
  for (const id of [...knownWrecks]) {
    if (!currentWreckIds.has(id)) knownWrecks.delete(id);
  }

  let wrecksHtml = '';
  for (const w of wrecks) {
    const h = hexes[w.hexId];
    if (!h || h.fog) continue;
    const start = pieceAnimTimestamps.get(`wreck_${w.id}`);
    const elapsed = start !== undefined ? now - start : Infinity;
    const isAnimating = elapsed < WRECK_ANIM_MS;
    const delayStyle = isAnimating ? `animation-delay: -${Math.max(0, Math.round(elapsed))}ms;` : '';

    const { wreckOffset } = hexIconLayout({
      hasFish: fishIds.has(w.hexId),
      hasSeaWreck: w.site === 'sea',
      hasPirate: pirateHexIds.has(w.hexId),
      shoreDir: w.site === 'shore' ? w.shoreDir : null,
      hasNumber: !!h.number
    });
    const wx = Number(h.x) + wreckOffset.dx;
    const wy = Number(h.y) + wreckOffset.dy;

    const animClass = isAnimating
      ? w.site === 'sea'
        ? 'wreck-spawn-sea-anim'
        : 'wreck-spawn-shore-anim'
      : '';
    const spawnEffect = isAnimating
      ? w.site === 'sea'
        ? `<circle cx="0" cy="0" r="22" class="wreck-sea-whirlpool-ring" style="${delayStyle}" />`
        : `<path d="M-20,-10 Q-10,0 -20,10 M-12,-14 Q-2,0 -12,14" class="wreck-shore-surf-wave" style="${delayStyle}" />`
      : '';
    const siteLabel = w.site === 'sea' ? 'Sea shipwreck' : 'Shore shipwreck';
    wrecksHtml += `
      <g transform="translate(${wx.toFixed(1)}, ${wy.toFixed(1)})" style="pointer-events:none" data-wreck-id="${esc(w.id)}" data-wreck-site="${w.site}">
        <title>${siteLabel} (${w.countdown} round${w.countdown === 1 ? '' : 's'} left — connect a road, bridge, or port to claim)</title>
        <g class="piece-zoom-scale">
          ${spawnEffect}
          <g class="${animClass}" style="${delayStyle}">
            <g transform="scale(1.18)">${wreckMarkup(w.site, w.countdown)}</g>
          </g>
        </g>
      </g>`;
  }
  if (wrecksHtml !== lastWrecksHtml) {
    lastWrecksHtml = wrecksHtml;
    layers.wrecksLayer.innerHTML = wrecksHtml;
  }

  // Pirates (T10): one ship per pirate on its sea tile with a strength badge. On your main-phase turn the ones you can drive off (the server's `pirateDrives`) get a ring and a click.
  const piratesHtml = renderPiratesMarkup(
    pirates,
    hexes,
    isMyTurn && state.phase === 'MAIN' && me ? (me.pirateDrives ?? []) : [],
    fishIds,
    seaWreckHexIds
  );
  if (piratesHtml !== lastPiratesHtml) {
    lastPiratesHtml = piratesHtml;
    layers.piratesLayer.innerHTML = piratesHtml;
  }

  // BUG 5: on your main-phase turn with no build mode, every corner and edge where a piece may stand gets a hotspot that opens the build menu.
  // A build mode from the bar keeps the direct click (the piece is already chosen).
  const menuCtx = isMyTurn && state.phase === 'MAIN' && !buildMode && me ? buildMenuContext(me) : null;
  // Harbor mode (toolbar): the ports of the cities you can upgrade are the nodes, or the ports you can raise when only Harbor charters are known.
  const harborModeOn = isMyTurn && state.phase === 'MAIN' && !!me && buildMode === 'harbor';
  const harborModeSet = harborModeOn && canClientAffordHarbor(me) ? new Set<number>(me.harborSpots ?? []) : null;
  const raiseModeSet = harborModeOn && !me.harborCost
    ? new Set<number>(portRaiseSpots(state.techActions?.harbor, true).filter(s => s.affordable).map(s => s.vertexId))
    : null;
  const portNodeFor = (e: any): PortNode | null => {
    for (const vid of [e.v1, e.v2]) {
      const b = vertices[vid]?.building;
      if (!b || b.owner !== socket.id) continue;
      if (harborModeSet?.has(vid)) return { call: `clickHarborSpot(${vid})`, dim: false };
      if (raiseModeSet?.has(vid)) return { call: `upgradePortClick(${vid})`, dim: false };
      if (!menuCtx) continue;
      const opts = vertexOptions(menuCtx, vid).filter(o => o.id === 'harbor' || o.id === 'upgrade_port');
      if (opts.length > 0) return { call: `openBuildMenu('vertex', ${vid})`, dim: !opts.some(o => o.affordable) };
    }
    return null;
  };

  // 3. Ports Layer: rebuilds only when coastal ports, port ownership, port nodes, or lobby port brush changes.
  const canPaintPort = isLobbyHost && activeBrush.type === 'port';
  const portsSigParts: string[] = [cachedGeomBoardKey, canPaintPort ? '1' : '0'];
  for (const e of edges) {
    if (e.hexIds.length !== 1) continue;
    if (e.port) {
      const v1 = vertices[e.v1], v2 = vertices[e.v2];
      const owned = Boolean(v1 && v2 && [v1, v2].some((v: any) => v.building && v.building.owner === socket.id));
      const pLvl = Math.max(state.portLevels?.[e.v1] || 0, state.portLevels?.[e.v2] || 0);
      const nodeSig = portNodeFor(e);
      portsSigParts.push(`${e.id}:${e.port}:${owned ? '1' : '0'}:${pLvl}:${nodeSig ? nodeSig.call + (nodeSig.dim ? 'd' : '') : ''}`);
    }
  }
  const portsKey = portsSigParts.join('|');
  if (portsKey !== lastPortsKey) {
    lastPortsKey = portsKey;
    let portsHtml = '';
    for (const e of edges) {
      if (e.hexIds.length !== 1) continue;
      const v1 = vertices[e.v1], v2 = vertices[e.v2];
      if (!v1 || !v2) continue;

      const mx = (v1.x + v2.x) / 2, my = (v1.y + v2.y) / 2;
      const h = hexes[e.hexIds[0]];

      if (e.port) {
        const owned = [v1, v2].some((v: any) => v.building && v.building.owner === socket.id);
        portsHtml += portMarkup(e, v1, v2, h, owned, isLobbyHost, portNodeFor(e));
      } else if (canPaintPort) {
        portsHtml += `
          <circle data-paintable="1" cx="${mx}" cy="${my}" r="9" style="fill:rgba(255,255,255,0.5);stroke:var(--accent);stroke-width:2;cursor:pointer"
            onclick="onEdgeInteract(${e.id})" />
        `;
      }
    }
    layers.portsLayer.innerHTML = portsHtml;
  }

  // 4. Placed Roads Layers: rebuilds only when placed roads/bridges, blocking buildings, or road drop/collapse animations change.
  const placedRoadsSigParts: string[] = [
    cachedGeomBoardKey,
    hasActiveRoadAnim ? String(Math.floor(now / 32)) : '0'
  ];
  for (const e of edges) {
    if (e.road) placedRoadsSigParts.push(`r${e.id}:${e.road}:${e.pieceType || 'road'}`);
  }
  for (const [edgeId, c] of collapsingBridges) {
    placedRoadsSigParts.push(`c${edgeId}:${c.owner}:${c.pieceType}:${Math.floor(c.start)}`);
  }
  for (const v of vertices) {
    if (v.building) placedRoadsSigParts.push(`b${v.id}:${v.building.owner}`);
  }
  const placedRoadsKey = placedRoadsSigParts.join('|');

  if (placedRoadsKey !== lastPlacedRoadsKey) {
    lastPlacedRoadsKey = placedRoadsKey;
    roadAnalysisCache.clear();
    let roadRimsHtml = '';
    let roadBodiesHtml = '';
    let roadHitsHtml = '';

    for (const [edgeId, c] of collapsingBridges) {
      const e = edges[edgeId];
      if (!e || e.road) continue;
      const v1 = vertices[e.v1], v2 = vertices[e.v2];
      if (!v1 || !v2) continue;
      const owner = state.players.find(p => p.id === c.owner);
      const col = owner?.color || '#888';
      const isRickety = c.pieceType === 'rickety_bridge';
      const isBridge = c.pieceType === 'bridge' || isRickety;
      const x1 = v1.x + (v2.x - v1.x) * 0.08;
      const y1 = v1.y + (v2.y - v1.y) * 0.08;
      const x2 = v1.x + (v2.x - v1.x) * 0.92;
      const y2 = v1.y + (v2.y - v1.y) * 0.92;
      const mx = (v1.x + v2.x) / 2;
      const my = (v1.y + v2.y) / 2;
      const delayStyle = `animation-delay: -${Math.max(0, Math.round(now - c.start))}ms;`;

      if (isBridge) {
        const bridge = bridgeEdgeMarkup(isRickety ? 'rickety_bridge' : 'bridge', col, x1, y1, x2, y2);
        roadRimsHtml += `
          <g transform="translate(${mx}, ${my})">
            <circle cx="0" cy="0" r="22" class="bridge-collapse-ring" style="${delayStyle}" />
            <g class="bridge-collapse-anim" style="${delayStyle}">${bridge.rim}</g>
          </g>`;
        roadBodiesHtml += `
          <g transform="translate(${mx}, ${my})">
            <g class="bridge-collapse-anim" style="${delayStyle}">${bridge.body}</g>
          </g>`;
      } else {
        roadRimsHtml += `
          <g transform="translate(${mx}, ${my})">
            <circle cx="0" cy="0" r="22" class="bridge-collapse-ring" style="${delayStyle}" />
            <g class="bridge-collapse-anim" style="${delayStyle}">
              <line class="road-rim-line" x1="${(x1 - mx).toFixed(1)}" y1="${(y1 - my).toFixed(1)}" x2="${(x2 - mx).toFixed(1)}" y2="${(y2 - my).toFixed(1)}" />
            </g>
          </g>`;
        roadBodiesHtml += `
          <g transform="translate(${mx}, ${my})">
            <g class="bridge-collapse-anim" style="${delayStyle}">
              <line class="road-body-line" x1="${(x1 - mx).toFixed(1)}" y1="${(y1 - my).toFixed(1)}" x2="${(x2 - mx).toFixed(1)}" y2="${(y2 - my).toFixed(1)}" style="stroke:${col}" />
            </g>
          </g>`;
      }
    }

    for (const e of edges) {
      if (!e.road) continue;
      const v1 = vertices[e.v1], v2 = vertices[e.v2];
      if (!v1 || !v2) continue;
      const ownerId = e.road;
      const owner = state.players.find(p => p.id === ownerId);
      const col = owner?.color || '#888';
      const isRickety = e.pieceType === 'rickety_bridge';
      const isBridge = e.pieceType === 'bridge' || isRickety;

      // Extend endpoint to vertex if another road/bridge of the same player meets there (and no enemy building blocks it)
      const blocked1 = v1.building && v1.building.owner !== ownerId;
      const blocked2 = v2.building && v2.building.owner !== ownerId;
      const conn1 = !blocked1 && (
        (v1.building && v1.building.owner === ownerId) ||
        v1.edgeIds.some((oe: number) => oe !== e.id && edges[oe]?.road === ownerId)
      );
      const conn2 = !blocked2 && (
        (v2.building && v2.building.owner === ownerId) ||
        v2.edgeIds.some((oe: number) => oe !== e.id && edges[oe]?.road === ownerId)
      );

      const t1 = conn1 ? 0.0 : 0.08;
      const t2 = conn2 ? 1.0 : 0.92;
      const x1 = v1.x + (v2.x - v1.x) * t1;
      const y1 = v1.y + (v2.y - v1.y) * t1;
      const x2 = v1.x + (v2.x - v1.x) * t2;
      const y2 = v1.y + (v2.y - v1.y) * t2;

      const mx = (v1.x + v2.x) / 2;
      const my = (v1.y + v2.y) / 2;
      const anim = getPieceAnimAttrs(`road_${e.id}`, now);

      // R8.7: an edge piece that the manifest describes is drawn from its shape (the generic path; the bridge code below stays until R8.8 migrates it).
      const genericEdge = placedEdgeMarkup(e.pieceType, col, { x: x1, y: y1 }, { x: x2, y: y2 });
      if (genericEdge) {
        if (anim.isAnimating) {
          roadRimsHtml += `<g transform="translate(${mx}, ${my})"><circle cx="0" cy="0" r="20" class="piece-impact-ring" style="${anim.delayStyle}" /></g>`;
        }
        roadBodiesHtml += `<g class="${anim.isAnimating ? 'piece-drop-anim' : ''}" style="${anim.delayStyle}">${genericEdge}</g>`;
        roadHitsHtml += `
        <line class="road-hit" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
          onmouseenter="onRoadHover(${e.id}, event)"
          onmousemove="onRoadMove(event)"
          onmouseleave="onRoadLeave()" />`;
        continue;
      }

      if (isBridge) {
        const bx1 = v1.x + (v2.x - v1.x) * 0.06;
        const by1 = v1.y + (v2.y - v1.y) * 0.06;
        const bx2 = v1.x + (v2.x - v1.x) * 0.94;
        const by2 = v1.y + (v2.y - v1.y) * 0.94;
        const bridge = bridgeEdgeMarkup(isRickety ? 'rickety_bridge' : 'bridge', col, bx1, by1, bx2, by2);
        roadRimsHtml += `
          <g transform="translate(${mx}, ${my})">
            ${anim.isAnimating ? `<circle cx="0" cy="0" r="20" class="piece-impact-ring" style="${anim.delayStyle}" />` : ''}
            <g class="${anim.isAnimating ? 'piece-drop-anim' : ''}" style="${anim.delayStyle}">${bridge.rim}</g>
          </g>`;
        roadBodiesHtml += `
          <g transform="translate(${mx}, ${my})">
            <g class="${anim.isAnimating ? 'piece-drop-anim' : ''}" style="${anim.delayStyle}">${bridge.body}</g>
          </g>`;
      } else {
        roadRimsHtml += `
          <g transform="translate(${mx}, ${my})">
            ${anim.isAnimating ? `<circle cx="0" cy="0" r="20" class="piece-impact-ring" style="${anim.delayStyle}" />` : ''}
            <g class="${anim.isAnimating ? 'piece-drop-anim' : ''}" style="${anim.delayStyle}">
              <line class="road-rim-line" x1="${(x1 - mx).toFixed(1)}" y1="${(y1 - my).toFixed(1)}" x2="${(x2 - mx).toFixed(1)}" y2="${(y2 - my).toFixed(1)}" />
            </g>
          </g>`;

        roadBodiesHtml += `
          <g transform="translate(${mx}, ${my})">
            <g class="${anim.isAnimating ? 'piece-drop-anim' : ''}" style="${anim.delayStyle}">
              <line class="road-body-line" x1="${(x1 - mx).toFixed(1)}" y1="${(y1 - my).toFixed(1)}" x2="${(x2 - mx).toFixed(1)}" y2="${(y2 - my).toFixed(1)}" style="stroke:${col}" />
            </g>
          </g>`;
      }

      roadHitsHtml += `
        <line class="road-hit" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
          onmouseenter="onRoadHover(${e.id}, event)"
          onmousemove="onRoadMove(event)"
          onmouseleave="onRoadLeave()"${isBridge && ownerId === socket.id ? ` onclick="clickPlacedBridge(${e.id})" style="cursor:pointer"` : ''} />`;
    }

    layers.roadRimsLayer.innerHTML = roadRimsHtml;
    layers.roadBodiesLayer.innerHTML = roadBodiesHtml;
    layers.roadHitsLayer.innerHTML = roadHitsHtml;
  }

  // 5. Road & Bridge Spots Layer (buildable edges)
  const staticSpots = vertices.length > 120;
  let roadSpotsHtml = '';
  for (const e of edges) {
    if (e.road) continue;
    const v1 = vertices[e.v1], v2 = vertices[e.v2];
    if (!v1 || !v2) continue;
    if (menuCtx) {
      const opts = edgeOptions(menuCtx, e.id);
      if (opts.length === 0) continue;
      const mx = (v1.x + v2.x) / 2, my = (v1.y + v2.y) / 2;
      const cls = `${staticSpots ? ' spot-static' : ''}${hotDim(opts)}`;
      roadSpotsHtml += `
        <g onclick="openBuildMenu('edge', ${e.id})" style="cursor:pointer">
          <line class="road-spot-line hotspot${cls}" x1="${v1.x}" y1="${v1.y}" x2="${v2.x}" y2="${v2.y}" />
          <circle class="road-spot-dot hotspot${cls}" cx="${mx}" cy="${my}" r="8" />
        </g>
      `;
      continue;
    }
    const allowRoad = !buildMode || buildMode === 'road';
    const allowBridge = !buildMode || buildMode === 'bridge';
    if (isMyTurn && ((allowRoad && canClientPlaceRoad(e, me)) || (allowBridge && canClientPlaceBridge(e, me)))) {
      const mx = (v1.x + v2.x) / 2, my = (v1.y + v2.y) / 2;
      roadSpotsHtml += `
        <g onclick="clickEdge(${e.id})" style="cursor:pointer">
          <line class="road-spot-line${staticSpots ? ' spot-static' : ''}" x1="${v1.x}" y1="${v1.y}" x2="${v2.x}" y2="${v2.y}" />
          <circle class="road-spot-dot${staticSpots ? ' spot-static' : ''}" cx="${mx}" cy="${my}" r="8" />
        </g>
      `;
    }
  }
  // Your rickety bridges you can pay to upgrade get a marker (click opens the upgrade popup; clicking the bridge itself does too).
  if (isMyTurn && state.phase === 'MAIN' && me && canClientAffordBridgeUpgrade(me)) {
    for (const e of edges) {
      if (e.pieceType !== 'rickety_bridge' || e.road !== socket.id) continue;
      const v1 = vertices[e.v1], v2 = vertices[e.v2];
      if (!v1 || !v2) continue;
      const mx = (v1.x + v2.x) / 2, my = (v1.y + v2.y) / 2;
      roadSpotsHtml += `
        <g onclick="clickPlacedBridge(${e.id})" style="cursor:pointer">
          <circle class="bridge-upgrade-dot" cx="${mx}" cy="${my}" r="10" />
        </g>
      `;
    }
  }
  if (roadSpotsHtml !== lastRoadSpotsHtml) {
    lastRoadSpotsHtml = roadSpotsHtml;
    layers.roadSpotsLayer.innerHTML = roadSpotsHtml;
  }

  // 6. Vertices Layer: settlements, cities, and settlement spots
  const robberVictimSet = new Set<string>(state.robberVictims || []);
  let verticesHtml = '';
  const canAffordCity = me ? canClientAffordPiece(me, 'city') : false;
  for (const v of vertices) {
    if (v.building) {
      const owner = state.players.find(p => p.id === v.building.owner);
      const col = owner?.color || '#888';
      const canUpgrade = isMyTurn && state.phase === 'MAIN' && buildMode !== 'harbor' &&
        v.building.owner === socket.id && v.building.type === 'settlement' &&
        me && canAffordCity && me.citiesLeft > 0;
      const canRobThisBuilding = isMyTurn && state.phase === 'ROBBER_STEAL' &&
        v.hexIds.includes(robberHexId) && robberVictimSet.has(v.building.owner);
      const isCity = v.building.type === 'city';
      const isClickable = canUpgrade || canRobThisBuilding;
      // BUG 5: with the build menu on, your own building is a hotspot when it offers a city (affordable or not).
      // The harbor upgrade and the port raise are on the port (`portNodeFor`), not on the building.
      const menuOpts = menuCtx && v.building.owner === socket.id
        ? vertexOptions(menuCtx, v.id).filter(o => o.id !== 'harbor' && o.id !== 'upgrade_port')
        : [];
      const showRing = menuCtx ? menuOpts.length > 0 : (!isCity && canUpgrade);
      const clickAttr = menuOpts.length > 0
        ? `openBuildMenu('vertex', ${v.id})`
        : (isCity ? canRobThisBuilding : isClickable)
          ? `clickVertex(${v.id})`
          : '';
      const ringR = isCity ? 27 : 22;
      const anim = getPieceAnimAttrs(`${v.building.type}_${v.id}`, now);

      verticesHtml += `
        <g transform="translate(${v.x}, ${v.y})" onclick="${clickAttr}" style="${clickAttr ? 'cursor:pointer' : ''}">
          <g class="building-zoom-scale">
            ${anim.isAnimating ? `<circle cx="0" cy="0" r="${ringR + 4}" class="piece-impact-ring" style="${anim.delayStyle}" />` : ''}
            ${clickAttr ? `<circle r="${ringR + 2}" fill="transparent" />` : ''}
            ${canRobThisBuilding ? `<circle r="${ringR}" class="target-ring rob" />` : ''}
            ${showRing && !canRobThisBuilding ? `<circle r="${ringR}" class="target-ring upgrade${hotDim(menuOpts)}" />` : ''}
            <g class="${anim.isAnimating ? 'piece-drop-anim' : ''}" style="${anim.delayStyle}">
              ${placedVertexMarkup(v.building.type, col) ?? (isCity ? cityMarkup(col) : settlementMarkup(col))}
            </g>
          </g>
        </g>
      `;
    } else if (menuCtx) {
      const opts = vertexOptions(menuCtx, v.id);
      if (opts.length === 0) continue;
      verticesHtml += `
        <g onclick="openBuildMenu('vertex', ${v.id})" style="cursor:pointer">
          <circle cx="${v.x}" cy="${v.y}" r="20" fill="transparent" />
          <circle cx="${v.x}" cy="${v.y}" r="11" class="spot-pulse hotspot${staticSpots ? ' spot-static' : ''}${hotDim(opts)}" />
        </g>
      `;
    } else if (isMyTurn && (buildMode === 'net' || buildMode === 'feed' || buildMode === 'harbor' || isPieceMode(buildMode))) {
      // Net, feed and harbor mode draw no empty-vertex spots: a net and the feed pick sea tiles (drawn on the hex layer), so no settlement spots here either.
      continue;
    } else if (isMyTurn && canClientPlaceSettlement(v, me)) {
      verticesHtml += `
        <g onclick="clickVertex(${v.id})" style="cursor:pointer">
          <circle cx="${v.x}" cy="${v.y}" r="20" fill="transparent" />
          <circle cx="${v.x}" cy="${v.y}" r="11" class="spot-pulse${staticSpots ? ' spot-static' : ''}" />
        </g>
      `;
    }
  }

  if (verticesHtml !== lastVerticesHtml) {
    lastVerticesHtml = verticesHtml;
    layers.verticesLayer.innerHTML = verticesHtml;
  }

  // BUG 5: the open build menu follows this render (its options and prices), and closes when the menu is off.
  syncBuildMenu(menuCtx);

  // 7. Generic spots of manifest pieces and actions (R8.7): the spots of the active build mode, from the server's `pieces[id].spots`. Empty until a piece has a visual.
  // BUG: a sea tile you can feed (under your net) or put a net on is a hotspot of the build menu, like a corner or an edge.
  let hexSpotsHtml = '';
  if (menuCtx) {
    for (const id of hexCandidates(menuCtx)) {
      const h = hexes[id];
      const opts = h && !h.fog ? hexOptions(menuCtx, id) : [];
      if (opts.length === 0) continue;
      hexSpotsHtml += `<g transform="translate(${h.x}, ${h.y})" onclick="openBuildMenu('hex', ${id})" style="cursor:pointer"><circle r="22" fill="transparent" /><circle class="road-spot-dot hotspot${staticSpots ? ' spot-static' : ''}${opts.some(o => o.affordable) ? '' : ' hot-dim'}" r="8" /></g>`;
    }
  }
  const pieceSpotsHtml = pieceSpotsMarkup(me, isMyTurn) + hexSpotsHtml;
  if (pieceSpotsHtml !== lastPieceSpotsHtml) {
    lastPieceSpotsHtml = pieceSpotsHtml;
    layers.pieceSpotsLayer.innerHTML = pieceSpotsHtml;
  }

  // 8. Debug overlay layer (H/V/E IDs, sandbox click targets, and all-icons stress test when Debug Mode is active)
  const debugLayer = document.getElementById('boardDebugLayer');
  if (debugLayer) {
    const debugHtml = isDebugOverlayActive() ? renderDebugBoardOverlayMarkup() : '';
    if (debugHtml !== lastDebugHtml) {
      lastDebugHtml = debugHtml;
      debugLayer.innerHTML = debugHtml;
    }
  }
}

// Updates camera viewBox smoothly via requestAnimationFrame on pan/zoom without reconstructing the SVG DOM.
export function rerenderBoard(): void {
  if (!state || cameraRafPending) return;
  cameraRafPending = true;
  requestAnimationFrame(() => {
    cameraRafPending = false;
    updateCameraViewBox();
  });
}

/**
 * One drag frame (BUG 1): moves the painted board by the pan since the last repaint with a CSS translate of `#boardPan` (the svg's wrapper). It repaints (a real viewBox) only when the
 * drag would bring board into view that was off-screen at the last repaint by more than `PAN_SLACK` of the screen; a whole-board view never
 * repaints mid-drag. `rect` is the board's screen box at the start of the drag.
 */
export function panBoardPreview(rect: DOMRect): void {
  panRect = rect;
  if (!state || panFramePending) return;
  panFramePending = true;
  requestAnimationFrame(() => {
    panFramePending = false;
    applyPanPreview();
  });
}

function applyPanPreview(): void {
  const svg = document.getElementById('boardSvg');
  const rect = panRect;
  if (!svg || !rect || !state?.board) return;
  const { centerX0, centerY0, contentW, contentH } = getBoardBounds();
  const worldPerPx = camZoom * Math.max(contentW / (rect.width || 1), contentH / (rect.height || 1));
  if (!panHidden) {
    const cx = centerX0 - committedPanX;
    const cy = centerY0 - committedPanY;
    const halfW = (rect.width * worldPerPx) / 2;
    const halfH = (rect.height * worldPerPx) / 2;
    panHidden = hiddenEdges(
      { left: centerX0 - contentW / 2, top: centerY0 - contentH / 2, right: centerX0 + contentW / 2, bottom: centerY0 + contentH / 2 },
      { left: cx - halfW, top: cy - halfH, right: cx + halfW, bottom: cy + halfH },
      worldPerPx
    );
  }
  const dx = (camPanX - committedPanX) / worldPerPx;
  const dy = (camPanY - committedPanY) / worldPerPx;
  if (needsRepaint(panHidden, dx, dy, PAN_SLACK * Math.min(rect.width, rect.height))) {
    updateCameraViewBox();
    return;
  }
  (document.getElementById('boardPan') ?? svg).style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
}

/** The drag ended: write the real viewBox for where the board now is (this drops the translate). */
export function endBoardPan(): void {
  panRect = null;
  const panLayer = document.getElementById('boardPan');
  if (state?.board && (camPanX !== committedPanX || camPanY !== committedPanY || panLayer?.style.transform)) {
    updateCameraViewBox();
  }
}

export function resetCamera(): void {
  setCamZoom(1);
  setCamPan(0, 0);
  updateCameraViewBox();
}

export function onHexInteract(hexId: number, ev?: MouseEvent): void {
  if (ev && (ev.button === 2 || ev.button === 1 || ev.altKey)) return;
  if (state.status === 'LOBBY' && state.hostId === socket.id) {
    if (activeBrush.type === 'terrain' || activeBrush.type === 'number' || activeBrush.type === 'robber') {
      socket.emit('paintHex', {
        code: state.code,
        hexId,
        paintType: activeBrush.type,
        paintValue: activeBrush.value
      });
      playTone(400, 0.04);
    }
  }
}

export function onHexClick(hexId: number, ev?: MouseEvent): void {
  if (hasDraggedMap) return;
  if (ev && (ev.button === 2 || ev.button === 1 || ev.altKey)) return;
  if (state.status !== 'LOBBY' && state.phase === 'ROBBER' && state.players[state.turnIndex]?.id === socket.id) {
    socket.emit('clickHex', { code: state.code, hexId });
    playTone(260, 0.12);
  }
}

// Drag-painting: only paints while the mouse button is held in Lobby.
export function onHexEnter(hexId: number, ev?: MouseEvent): void {
  if (isMouseDown && state?.status === 'LOBBY') onHexInteract(hexId, ev);
}

export function onEdgeInteract(edgeId: number): void {
  if (hasDraggedMap) return;
  if (state.status === 'LOBBY' && state.hostId === socket.id && activeBrush.type === 'port') {
    socket.emit('paintPort', { code: state.code, edgeId, portValue: activeBrush.value });
    playTone(520, 0.06);
  }
}

// Computes the connected road network containing `startEdgeId` and its longest continuous simple path (stretch).
function analyzeRoadConnection(startEdgeId: number): RoadConnInfo | null {
  if (!state?.board) return null;
  const cached = roadAnalysisCache.get(startEdgeId);
  if (cached) return cached;

  const { edges, vertices } = state.board;
  const startEdge = edges[startEdgeId];
  if (!startEdge || !startEdge.road) return null;
  const ownerId = startEdge.road;
  const owner = state.players.find(p => p.id === ownerId);

  // 1. BFS to find all roads in this connected component (respecting enemy buildings on vertices)
  const compSet = new Set<number>([startEdgeId]);
  const queue: number[] = [startEdgeId];
  while (queue.length > 0) {
    const curId = queue.shift()!;
    const cur = edges[curId];
    for (const vId of [cur.v1, cur.v2]) {
      const v = vertices[vId];
      if (!v) continue;
      if (v.building && v.building.owner !== ownerId) continue;
      for (const adjEdgeId of v.edgeIds) {
        if (!compSet.has(adjEdgeId) && edges[adjEdgeId]?.road === ownerId) {
          compSet.add(adjEdgeId);
          queue.push(adjEdgeId);
        }
      }
    }
  }

  // 2. Bounded DFS over the connected component to find the longest continuous stretch (simple path of edges)
  let bestPath: number[] = [startEdgeId];
  let bestIncludesHovered = true;
  const used = new Set<number>();
  const currentPath: number[] = [];
  let steps = 0;
  const maxSteps = 4000;

  function dfs(vertexId: number, depth: number): void {
    if (++steps > maxSteps) return;
    const includesHovered = currentPath.includes(startEdgeId);
    if (
      currentPath.length > bestPath.length ||
      (currentPath.length === bestPath.length && includesHovered && !bestIncludesHovered)
    ) {
      bestPath = [...currentPath];
      bestIncludesHovered = includesHovered;
    }

    const v = vertices[vertexId];
    if (!v) return;
    if (depth > 0 && v.building && v.building.owner !== ownerId) return;

    for (const edgeId of v.edgeIds) {
      if (used.has(edgeId) || !compSet.has(edgeId)) continue;
      const edge = edges[edgeId];
      if (!edge || edge.road !== ownerId) continue;
      used.add(edgeId);
      currentPath.push(edgeId);
      dfs(edge.v1 === vertexId ? edge.v2 : edge.v1, depth + 1);
      currentPath.pop();
      used.delete(edgeId);
      if (steps > maxSteps) return;
    }
  }

  const endpoints = new Set<number>();
  for (const eId of compSet) {
    const e = edges[eId];
    endpoints.add(e.v1);
    endpoints.add(e.v2);
  }
  for (const vId of endpoints) {
    dfs(vId, 0);
    if (steps > maxSteps) break;
  }

  const result: RoadConnInfo = {
    ownerName: owner?.name || 'Player',
    ownerColor: owner?.color || '#888',
    totalRoads: compSet.size,
    longestStretch: bestPath.length,
    longestPathEdges: new Set(bestPath),
    componentEdges: [...compSet]
  };
  roadAnalysisCache.set(startEdgeId, result);
  return result;
}

export function onRoadHover(edgeId: number, ev?: MouseEvent): void {
  if (isMouseDown || hasDraggedMap) return;
  const info = analyzeRoadConnection(edgeId);
  const hlLayer = document.getElementById('roadHighlightLayer');
  const tooltip = document.getElementById('roadHoverTooltip');
  if (!info || !hlLayer || !state?.board) return;

  // Two halos under the roads. Each is one group (opacity on the group), so segments join without overlapping:
  // a faint one for the whole connected network, a stronger one for the longest stretch.
  const { edges, vertices } = state.board;
  const lineOf = (eId: number): string => {
    const e = edges[eId];
    const v1 = vertices[e.v1], v2 = vertices[e.v2];
    return v1 && v2 ? `<line x1="${v1.x}" y1="${v1.y}" x2="${v2.x}" y2="${v2.y}" />` : '';
  };
  const netHtml = info.componentEdges.map(lineOf).join('');
  const bestHtml = [...info.longestPathEdges].map(lineOf).join('');
  hlLayer.innerHTML = `<g class="road-glow-net">${netHtml}</g><g class="road-glow-best">${bestHtml}</g>`;

  if (tooltip) {
    tooltip.textContent = `Road Length: ${info.longestStretch}`;
    tooltip.style.display = 'flex';
    if (ev) onRoadMove(ev);
  }
}

export function onRoadMove(ev: MouseEvent): void {
  if (isMouseDown || hasDraggedMap) return;
  const tooltip = document.getElementById('roadHoverTooltip');
  if (!tooltip || tooltip.style.display === 'none') return;
  const x = Math.max(80, Math.min(window.innerWidth - 80, ev.clientX));
  const y = Math.max(48, ev.clientY - 16);
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}

export function onRoadLeave(): void {
  const hlLayer = document.getElementById('roadHighlightLayer');
  const tooltip = document.getElementById('roadHoverTooltip');
  if (hlLayer) hlLayer.innerHTML = '';
  if (tooltip) tooltip.style.display = 'none';
}

export function triggerAwardAnimation(
  award: 'longestRoad' | 'largestArmy',
  newOwner: any,
  prevOwner: any
): void {
  if (!newOwner) return;
  const isStolen = !!prevOwner && prevOwner.id !== newOwner.id;
  playAwardSound(isStolen);

  const isRoad = award === 'longestRoad';
  const title = isRoad ? 'Longest Road' : 'Largest Army';
  const kicker = isStolen ? `${title} Stolen!` : `${title} Claimed!`;
  const sub = isStolen
    ? `Taken from ${esc(prevOwner.name)} · ${isRoad ? `${newOwner.longestRoad ?? 5}+ roads` : `${newOwner.army ?? 3}+ knights`}`
    : `${isRoad ? `${newOwner.longestRoad ?? 5} connected roads` : `${newOwner.army ?? 3} knights played`}`;

  const banner = document.createElement('div');
  banner.className = `award-epic-banner ${isStolen ? 'stolen' : ''}`;
  banner.innerHTML = `
    <div class="award-rays"></div>
    <div class="award-badge-icon">${uiIcon(isRoad ? 'road' : 'sword', 24)}</div>
    <div class="award-info">
      <div class="award-kicker">${kicker}</div>
      <div class="award-headline" style="color:${newOwner.color || 'var(--ink)'}">${esc(newOwner.name)}</div>
      <div class="award-sub">${sub}</div>
    </div>
    <div class="award-vp-pill">+2 VP</div>
  `;
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 2450);
}

export type ClientPieceKey = 'road' | 'bridge' | 'rickety_bridge' | 'net' | 'settlement' | 'city';

const CLIENT_BASE_PIECE_LIMITS: Record<ClientPieceKey, number> = {
  road: 15,
  bridge: 10,
  rickety_bridge: 10,
  net: 4,
  settlement: 5,
  city: 4
};

export function countClientActivePieces(ownerId: string, piece: ClientPieceKey): number {
  if (!state?.board) return 0;
  // A net sits on a sea tile, so it is counted from the tiles the server lists for that player (public `netTiles`), not from vertex pieces.
  if (piece === 'net') return state.players?.find(p => p.id === ownerId)?.netTiles?.length ?? 0;
  // Bridges and rickety bridges share one pool (and one 2x threshold), so each counts both kinds.
  const pool = piece === 'bridge' || piece === 'rickety_bridge';
  if (piece === 'road' || pool) {
    let n = 0;
    for (const e of state.board.edges) {
      if (e.road === ownerId) {
        const pt = e.pieceType || 'road';
        if (pool ? (pt === 'bridge' || pt === 'rickety_bridge') : pt === piece) n++;
      }
    }
    return n;
  }
  let n = 0;
  for (const v of state.board.vertices) {
    if (v.building && v.building.owner === ownerId && v.building.type === piece) n++;
  }
  return n;
}

export function isClientPieceDoubleCost(piece: ClientPieceKey, ownerId: string = socket.id || ''): boolean {
  if (!ownerId || !state?.board) return false;
  // For a net the 2x price starts at 4 placed nets on every board (the server's NET_BASE_LIMIT); only the supply scales with the board.
  return countClientActivePieces(ownerId, piece) >= CLIENT_BASE_PIECE_LIMITS[piece];
}

const CLIENT_BASE_PIECE_COSTS: Record<ClientPieceKey, Record<string, number>> = {
  road: { wood: 1, brick: 1 },
  bridge: { wood: 1, brick: 1, ore: 1 },
  rickety_bridge: { wood: 1 },
  net: { wood: 2, sheep: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 }
};

export function getClientPieceCost(piece: ClientPieceKey, ownerId: string = socket.id || ''): Record<string, number> {
  const player = state?.players?.find(p => p.id === ownerId);
  // A net is a tile action, so its price comes as `netCost`; every other piece is in `pieceCosts`.
  const srvCost = piece === 'net' ? player?.netCost : player?.pieceCosts?.[piece];
  if (srvCost && typeof srvCost === 'object') return srvCost;
  const mult = isClientPieceDoubleCost(piece, ownerId) ? 2 : 1;
  const base = CLIENT_BASE_PIECE_COSTS[piece];
  return Object.fromEntries(Object.entries(base).map(([r, n]) => [r, n * mult]));
}

export function canClientAffordPiece(me: any, piece: ClientPieceKey): boolean {
  if (!me || !me.resources) return false;
  const cost = getClientPieceCost(piece, me.id || socket.id || '');
  return Object.entries(cost).every(([r, n]) => (me.resources[r] || 0) >= (Number(n) || 0));
}

/** BUG 5: what the build menu reads about you and the board: client prices, rickety bridges, harbor and port-raise data, manifest entries. */
export function buildMenuContext(me: any): MenuContext {
  const myId = me?.id || socket.id || '';
  return {
    board: state.board,
    me: { ...me, id: myId },
    costOf: piece => getClientPieceCost(piece as ClientPieceKey, myId),
    ricketyOn: isRicketyEnabled(me),
    harborCost: me?.harborCost ?? null,
    portRaise: portRaiseSpots(state.techActions?.harbor, true),
    feedSpots: me?.feedSpots,
    feedCost: me?.feedCost ?? null,
    netSpots: me?.netSpots,
    netCost: me?.netCost ?? null,
    entries: manifestEntries()
  };
}

/** A hotspot where you can pay for nothing yet is drawn dim and still (BUG 5): it opens the menu, whose options show the price. */
function hotDim(opts: BuildOption[]): string {
  return opts.length > 0 && !opts.some(o => o.affordable) ? ' hot-dim' : '';
}

/** Rickety bridges are in this game (the server sends a price for the piece only then). */
export function isRicketyEnabled(me: any): boolean {
  return !!me?.pieceCosts?.rickety_bridge;
}

/** Can you pay the upgrade price from rickety to full bridge? (The server sends the price only when rickety bridges are in the game.) */
export function canClientAffordBridgeUpgrade(me: any): boolean {
  const cost = me?.bridgeUpgradeCost;
  if (!me?.resources || !cost || typeof cost !== 'object') return false;
  return Object.entries(cost).every(([r, n]) => (me.resources[r] || 0) >= (Number(n) || 0));
}

export function canClientPlaceSettlement(v: any, me: any): boolean {
  if (!me || me.settlementsLeft <= 0) return false;
  if (!v.hexIds || v.hexIds.length === 0) return false;
  for (const adjId of v.adjacentVertices) {
    if (state.board.vertices[adjId]?.building) return false;
  }
  if (state.phase === 'SETUP_SETTLEMENT') return true;
  if (state.phase !== 'MAIN') return false;
  if (!canClientAffordPiece(me, 'settlement')) return false;
  return v.edgeIds.some((eId: number) => state.board.edges[eId]?.road === socket.id);
}

export function canClientPlaceRoad(e: any, me: any): boolean {
  if (!me || me.roadsLeft <= 0) return false;
  if (!e.hexIds || e.hexIds.length === 0) return false;
  if (state.phase === 'SETUP_ROAD') {
    return e.v1 === state.lastSetupVertexId || e.v2 === state.lastSetupVertexId;
  }
  if (state.phase !== 'MAIN') return false;
  const canAfford = me.freeRoads > 0 || canClientAffordPiece(me, 'road');
  if (!canAfford) return false;

  for (const vId of [e.v1, e.v2]) {
    const v = state.board.vertices[vId];
    if (!v) continue;
    if (v.building && v.building.owner === socket.id) return true;
    if (v.building && v.building.owner !== socket.id) continue;
    if (v.edgeIds.some((oe: number) => state.board.edges[oe]?.road === socket.id)) return true;
  }
  return false;
}

export function canClientPlaceBridge(e: any, me: any): boolean {
  if (!me || (me.bridgesLeft ?? 0) <= 0) return false;
  if (!e.hexIds || e.hexIds.length !== 0) return false;
  if (state.phase !== 'MAIN') return false;
  // Either kind will do: a full bridge, or a rickety one when those are in the game.
  if (!canClientAffordPiece(me, 'bridge') && !(isRicketyEnabled(me) && canClientAffordPiece(me, 'rickety_bridge'))) return false;

  for (const vId of [e.v1, e.v2]) {
    const v = state.board.vertices[vId];
    if (!v) continue;
    if (v.building && v.building.owner === socket.id) return true;
    if (v.building && v.building.owner !== socket.id) continue;
    if (v.edgeIds.some((oe: number) => state.board.edges[oe]?.road === socket.id)) return true;
  }
  return false;
}

/** Can you pay the price of feeding the sea? (The server sends `feedCost` only when the action is in the game.) */
export function canClientAffordFeed(me: any): boolean {
  const cost = me?.feedCost;
  if (!me?.resources || !cost || typeof cost !== 'object') return false;
  return Object.entries(cost).every(([r, n]) => (me.resources[r] || 0) >= (Number(n) || 0));
}

/** Can you pay the price of upgrading a port city to a harbor? (The server sends `harborCost` only when harbors are in the game.) */
export function canClientAffordHarbor(me: any): boolean {
  const cost = me?.harborCost;
  if (!me?.resources || !cost || typeof cost !== 'object') return false;
  return Object.entries(cost).every(([r, n]) => (me.resources[r] || 0) >= (Number(n) || 0));
}

export function clickVertex(vertexId: number): void {
  setBuildModeValue(null);
  socket.emit('clickVertex', { code: state.code, vertexId });
}

/** Tidebound T7b1: put a fishing net on this sea tile (only offered in net mode, from the server's list of legal tiles). */
export function clickNetSpot(hexId: number): void {
  setBuildModeValue(null);
  playTone(640, 0.08);
  socket.emit('act', { code: state.code, type: 'place_net', payload: { hexId } });
}

/** Tidebound T7e: pay to fill the fishing ground on this sea tile (only offered in feed mode, from the server's list of tiles next to your nets). */
export function clickFeedSpot(hexId: number): void {
  setBuildModeValue(null);
  playTone(660, 0.08);
  socket.emit('act', { code: state.code, type: 'feed_sea', payload: { hexId } });
}

/** Tidebound T8a: upgrade your city on a port to a 1:1 harbor (only offered in harbor mode, from the server's `harborSpots`). */
export function clickHarborSpot(vertexId: number): void {
  setBuildModeValue(null);
  playTone(680, 0.08);
  socket.emit('act', { code: state.code, type: 'upgrade_harbor', payload: { vertexId } });
}

export function clickEdge(edgeId: number): void {
  // An empty ocean edge with rickety bridges in the game: let the player pick the type first (the picker sends the build).
  const edge = state?.board?.edges?.[edgeId];
  const me = state?.players?.find(p => p.id === socket.id);
  if (edge && edge.hexIds.length === 0 && !edge.road && state.phase === 'MAIN' && isRicketyEnabled(me)) {
    openBridgePicker(edgeId);
    return;
  }
  setBuildModeValue(null);
  socket.emit('clickEdge', { code: state.code, edgeId });
}

export function triggerRobberMoveAnimation(fromHexId: number, toHexId: number): void {
  const svg = document.getElementById('boardSvg') as unknown as SVGSVGElement | null;
  if (!svg || !state?.board) return;
  const fromHex = state.board.hexes[fromHexId];
  const toHex = state.board.hexes[toHexId];
  if (!fromHex || !toHex) return;
  const ctm = svg.getScreenCTM();
  if (!ctm) return;

  const speed = getClientSpeed();
  const flightMs = Math.max(140, Math.round(460 / Math.sqrt(speed)));

  const ptFrom = svg.createSVGPoint();
  ptFrom.x = fromHex.x + ROBBER_DX;
  ptFrom.y = fromHex.y + ROBBER_DY;
  const screenFrom = ptFrom.matrixTransform(ctm);

  const ptTo = svg.createSVGPoint();
  ptTo.x = toHex.x + ROBBER_DX;
  ptTo.y = toHex.y + ROBBER_DY;
  const screenTo = ptTo.matrixTransform(ctm);

  const robberEl = document.createElement('div');
  robberEl.className = 'flying-robber-piece';
  robberEl.style.transition = `left ${flightMs}ms cubic-bezier(0.22, 1, 0.36, 1), top ${flightMs}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${flightMs}ms ease, opacity ${flightMs}ms ease`;
  robberEl.innerHTML = `<svg width="40" height="50" viewBox="-16 -24 32 40">${robberMarkup()}</svg>`;
  robberEl.style.left = `${screenFrom.x - 20}px`;
  robberEl.style.top = `${screenFrom.y - 25}px`;
  robberEl.style.transform = 'scale(1.2) translateY(-14px)';
  document.body.appendChild(robberEl);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      robberEl.style.left = `${screenTo.x - 20}px`;
      robberEl.style.top = `${screenTo.y - 25}px`;
      robberEl.style.transform = 'scale(1) translateY(0px)';
    });
  });

  setTimeout(() => {
    robberEl.style.opacity = '0';
    setTimeout(() => robberEl.remove(), 180);
  }, flightMs);
}

let inFlightUiRaf = false;

function syncInFlightUiImmediate(): void {
  if (!state) return;
  const me = state.players.find(p => p.id === socket.id);
  const current = state.players[state.turnIndex];
  const isMyTurn = !!current && current.id === socket.id;
  renderHand(me, isMyTurn);
  renderSidebar();
  if (state.status !== 'GAMEOVER') {
    renderBoard(me, isMyTurn);
  }
}

function syncInFlightUi(): void {
  if (!state || inFlightUiRaf) return;
  inFlightUiRaf = true;
  requestAnimationFrame(() => {
    inFlightUiRaf = false;
    syncInFlightUiImmediate();
  });
}

function getTransferTargetEl(actorId: string, resource: string, kind: string): HTMLElement | null {
  if (actorId === socket.id) {
    if (resource && resource !== 'dev' && resource !== 'mystery') {
      return document.querySelector<HTMLElement>(`#myHandPanel .card-${resource}`) || document.getElementById('myHandPanel');
    }
    return document.getElementById('myHandPanel');
  }
  if (actorId === 'bank') {
    if (resource === 'dev' || kind === 'buyDev') {
      return document.getElementById('bankDevDeckItem') || document.getElementById('bankBar');
    }
    return document.getElementById(`bankRes_${resource}`) || document.getElementById('bankBar');
  }
  return document.getElementById(`playerRow_${actorId}`);
}

/** Transfers that feel like being robbed: a robber steal, a Monopoly, and (Tidebound T10) a pirate raid, whose cards go to the bank. */
function isRobKind(kind: string): boolean {
  return kind === 'steal' || kind === 'monopoly' || kind === 'pirate';
}

export function triggerCardTransferAnimations(transfers: any[]): void {
  if (!transfers || transfers.length === 0) return;

  const flightMs = 720;
  const cardStackStepMs = 95;

  const hasSteal = transfers.some(t => isRobKind(t.kind));
  const iWasRobbed = transfers.some(t => isRobKind(t.kind) && t.from === socket.id);
  const hasTrade = transfers.some(t => t.kind === 'playerTrade' || t.kind === 'bankTrade');
  const hasBuyDev = transfers.some(t => t.kind === 'buyDev');
  const hasDiscard = transfers.some(t => t.kind === 'discard');

  if (hasSteal) playStealCardSound(iWasRobbed);
  else if (hasBuyDev) playBuyDevCardSound();
  else if (hasTrade) playTradeSound();
  else if (hasDiscard) playDiscardSound();

  if (iWasRobbed) {
    const handEl = document.getElementById('myHandPanel');
    if (handEl) {
      handEl.classList.remove('hand-stolen-shake');
      void handEl.offsetWidth;
      handEl.classList.add('hand-stolen-shake');
      setTimeout(() => handEl.classList.remove('hand-stolen-shake'), 650);

      const stolenItems = transfers.filter(t => isRobKind(t.kind) && t.from === socket.id);
      const rect = handEl.getBoundingClientRect();
      stolenItems.forEach((st, idx) => {
        const badge = document.createElement('div');
        badge.className = 'stolen-toast-badge';
        const resName = RES_META[st.resource]?.name || String(st.resource).toUpperCase();
        badge.textContent = `-${st.amount} ${resName} stolen`;
        badge.style.left = `${rect.left + 24 + idx * 120}px`;
        badge.style.top = `${rect.top - 16}px`;
        document.body.appendChild(badge);
        setTimeout(() => badge.remove(), 1200);
      });
    }
  }

  let heldAny = false;
  transfers.forEach((tr, groupIdx) => {
    const fromEl = getTransferTargetEl(tr.from, tr.resource, tr.kind);
    const toEl = getTransferTargetEl(tr.to, tr.resource, tr.kind);
    if (!fromEl || !toEl) return;

    const fromRect = visibleRect(fromEl);
    const toRect = visibleRect(toEl);

    const startX = fromRect.left + fromRect.width / 2 - 24;
    const startY = fromRect.top + fromRect.height / 2 - 33;
    const endX = toRect.left + toRect.width / 2 - 24;
    const endY = toRect.top + toRect.height / 2 - 33;

    // Slight vertical offset so simultaneous bidirectional trade cards don't overlap identically
    const curveOffset = (groupIdx % 2 === 0 ? -1 : 1) * 14;
    const totalAmount = Math.max(1, tr.amount || 1);
    const maxStack = transfers.length > 6 ? 2 : 3;
    const count = Math.min(totalAmount, maxStack);
    const isIncomingToPlayer = Boolean(tr.to && tr.to !== 'bank');

    // If bankTrade or buyDev receiving from bank, add a slight beat after the payment cards fly in
    const baseGroupDelay = (tr.from === 'bank' && (tr.kind === 'bankTrade' || tr.kind === 'buyDev'))
      ? 200
      : Math.min(160, groupIdx * 40);

    for (let i = 0; i < count; i++) {
      const cardAmount = i === count - 1
        ? totalAmount - Math.floor(totalAmount / count) * (count - 1)
        : Math.floor(totalAmount / count);

      if (isIncomingToPlayer) {
        heldAny = true;
        if (tr.resource === 'dev') {
          addInFlightDev(tr.to, socket.id, cardAmount);
        } else {
          addInFlightResource(tr.to, socket.id, tr.resource, cardAmount);
        }
      }

      const d = baseGroupDelay + i * cardStackStepMs;
      setTimeout(() => {
        const cardEl = document.createElement('div');
        const isSteal = isRobKind(tr.kind);
        let cardClass = `card-${tr.resource}`;
        let innerHtml = '';

        if (tr.resource === 'dev') {
          cardClass = 'card-dev';
          innerHtml = getDevSvg('back');
        } else if (tr.resource === 'mystery') {
          cardClass = 'card-mystery';
          innerHtml = `<span>?</span>`;
        } else {
          innerHtml = getMiniSvg(tr.resource);
        }

        cardEl.className = `flying-res-card ${cardClass} ${isSteal ? 'stolen-card-flight' : ''}`;
        cardEl.style.transition = `left ${flightMs}ms cubic-bezier(0.22, 1, 0.36, 1), top ${flightMs}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${flightMs}ms ease, opacity 90ms ease-out`;
        cardEl.innerHTML = innerHtml;
        cardEl.style.left = `${startX + i * 7}px`;
        cardEl.style.top = `${startY - i * 5 + curveOffset}px`;
        cardEl.style.transform = isSteal ? 'scale(1.1) rotate(-5deg)' : 'scale(0.9)';
        document.body.appendChild(cardEl);

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            cardEl.style.left = `${endX + i * 5}px`;
            cardEl.style.top = `${endY - i * 4}px`;
            cardEl.style.transform = 'scale(1) rotate(0deg)';
          });
        });

        // Land: reveal the card in hand/sidebar right as the flying card arrives, then fade out.
        setTimeout(() => {
          if (isIncomingToPlayer) {
            if (tr.resource === 'dev') {
              releaseInFlightDev(tr.to, socket.id, cardAmount);
            } else {
              releaseInFlightResource(tr.to, socket.id, tr.resource, cardAmount);
            }
            syncInFlightUi();
          }
          cardEl.style.opacity = '0';
          setTimeout(() => cardEl.remove(), 100);
        }, flightMs);
      }, d);
    }
  });

  if (heldAny) {
    syncInFlightUiImmediate();
  }
}

export function triggerFlyingResourceAnimations(productions: any[]): void {
  const svg = document.getElementById('boardSvg') as unknown as SVGSVGElement | null;
  if (!svg || !state?.board) return;
  const ctm = svg.getScreenCTM();
  if (!ctm) return;

  // Short lead-in after dice shake so all producing hexes launch their cards together and finish before bots act.
  const rollBeatMs = 180;
  const flightMs = 780;
  const cardStackStepMs = 110;
  const maxVisualCardsPerProd = productions.length > 6 ? 1 : 2;

  let heldAny = false;
  let soundBudget = 0;

  productions.forEach((prod, prodIdx) => {
    const hex = state.board.hexes[prod.hexId];
    if (!hex) return;

    const pt = svg.createSVGPoint();
    pt.x = hex.x;
    pt.y = hex.y;
    const screenPt = pt.matrixTransform(ctm);

    let targetEl: HTMLElement | null = null;
    if (prod.playerId === socket.id) {
      targetEl = document.querySelector<HTMLElement>(`#myHandPanel .card-${prod.resource}`) || document.getElementById('myHandPanel');
    } else {
      targetEl = document.getElementById(`playerRow_${prod.playerId}`);
    }
    if (!targetEl) return;
    const rect = visibleRect(targetEl);
    const targetX = rect.left + rect.width / 2 - 24;
    const targetY = rect.top + rect.height / 2 - 33;

    const totalAmount = Math.max(1, prod.amount || 1);
    const cardsToFly = Math.min(totalAmount, maxVisualCardsPerProd);
    const groupOffsetMs = Math.min(180, prodIdx * 30);

    for (let i = 0; i < cardsToFly; i++) {
      const cardAmount = i === cardsToFly - 1
        ? totalAmount - Math.floor(totalAmount / cardsToFly) * (cardsToFly - 1)
        : Math.floor(totalAmount / cardsToFly);

      heldAny = true;
      addInFlightResource(prod.playerId, socket.id, prod.resource, cardAmount);

      const d = rollBeatMs + groupOffsetMs + i * cardStackStepMs;
      const playChime = soundBudget < 5;
      if (playChime) soundBudget++;
      const chimeIdx = soundBudget;

      setTimeout(() => {
        const cardEl = document.createElement('div');
        cardEl.className = `flying-res-card card-${prod.resource}`;
        cardEl.style.transition = `left ${flightMs}ms cubic-bezier(0.22, 1, 0.36, 1), top ${flightMs}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${flightMs}ms ease, opacity 90ms ease-out`;
        cardEl.innerHTML = getMiniSvg(prod.resource);
        cardEl.style.left = `${screenPt.x - 24 + (i * 8)}px`;
        cardEl.style.top = `${screenPt.y - 33 - (i * 6)}px`;
        cardEl.style.transform = 'scale(0.85)';
        document.body.appendChild(cardEl);

        if (playChime) {
          playTone(540 + chimeIdx * 45, 0.05);
        }

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            cardEl.style.left = `${targetX}px`;
            cardEl.style.top = `${targetY}px`;
            cardEl.style.transform = 'scale(1)';
          });
        });

        setTimeout(() => {
          releaseInFlightResource(prod.playerId, socket.id, prod.resource, cardAmount);
          syncInFlightUi();
          cardEl.style.opacity = '0';
          setTimeout(() => cardEl.remove(), 100);
        }, flightMs);
      }, d);
    }
  });

  if (heldAny) {
    syncInFlightUiImmediate();
  }
}
