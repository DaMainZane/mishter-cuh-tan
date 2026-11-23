// MODULE: board SVG renderer, camera, board input and board animations | DEPENDS ON: client/audio, client/buildMenu, client/constants, client/icons, client/pieceModel, client/pieceui, +12 more | USED BY: client/actions, client/debug, client/main, client/render/bridgepicker, client/render/hand, client/render/index
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
import { getClientHexOverlay, overlayPatternDefsMarkup, syncOverlayManifest } from './overlay';
import { renderSidebar, visibleRect } from './sidebar';
import { esc } from '../util';
import { clickPlacedBridge, openBridgePicker } from './bridgepicker';
import { openBuildMenu, syncBuildMenu } from './buildmenu';
import { renderPiratesMarkup } from './pirates';
import { upgradePortClick } from './techpanel';
import { hasPlacedShape, isPieceMode, pieceSpotsMarkup, placedEdgeMarkup, placedVertexMarkup } from '../pieceui';
import { portRaiseSpots } from '../pieceModel';
import { edgeOptions, hexCandidates, hexOptions, vertexOptions } from '../buildMenu';
import type { BuildOption, MenuContext } from '../buildMenu';
import { manifestEntries } from '../visuals';
import {
  computeCanvasCamera,
  drawBoardTerrainCanvas,
  findHexAtWorldPoint,
  screenToWorld,
  type CanvasEdgeSpot,
  type CanvasFeedSpot,
  type CanvasFishLike,
  type CanvasHexOverlayLike,
  type CanvasHexSpot,
  type CanvasInteractiveSpots,
  type CanvasPortLike,
  type CanvasPortSpot,
  type CanvasVertexSpot,
  type TerrainHexLike
} from './terrainCanvas';

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
let committedZoom = 1;
let panFramePending = false;
let zoomCommitTimer: ReturnType<typeof setTimeout> | null = null;

let staticCanvasVersion = 0;
let cachedCanvasHexes: TerrainHexLike[] = [];
let cachedLandPathD = '';
let cachedWaterPathD = '';
let cachedCanPaintHex = false;
let cachedAnimatingFogIds = new Set<number>();
let cachedCanvasPorts: CanvasPortLike[] = [];
let cachedCanvasFish: CanvasFishLike[] = [];
let cachedCanvasOverlays: CanvasHexOverlayLike[] = [];
let cachedInteractiveSpots: CanvasInteractiveSpots = {};
let lastOverlayKey = '';
let lastFishKey = '';
let coastalEdgeIndices: number[] = [];
let cachedCoastalBoardKey = '';

// Layer dirty-keys so gameplay updates (rolls, trades, builds, selections) do not rebuild static hex terrain or ports.
let lastTerrainKey = '';
let lastPortsKey = '';
let lastPlacedRoadsKey = '';
// The overlay layer is only rewritten when its markup changes.
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
  const isMobileView = typeof window !== 'undefined' && window.innerWidth <= 900;
  const key = `${state.code}_${state.status}_${isMobileView ? 'm' : 'd'}_${state.board.hexes.length}_${firstHex?.x ?? 0}_${lastHex?.x ?? 0}`;
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

  const topExtra = isMobileView ? 250 : (state.status === 'LOBBY' ? 210 : 115);
  const bottomExtra = isMobileView ? 235 : 165;
  const sidePad = isMobileView ? 215 : 130;

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
  if (zoomCommitTimer !== null) {
    clearTimeout(zoomCommitTimer);
    zoomCommitTimer = null;
  }
  const { centerX0, centerY0, contentW, contentH } = getBoardBounds();
  const baseW = contentW * camZoom;
  const baseH = contentH * camZoom;
  const baseX = (centerX0 - camPanX) - baseW / 2;
  const baseY = (centerY0 - camPanY) - baseH / 2;
  svg.setAttribute('viewBox', `${baseX.toFixed(1)} ${baseY.toFixed(1)} ${baseW.toFixed(1)} ${baseH.toFixed(1)}`);
  if (svg.style.transform) svg.style.transform = '';
  if (svg.style.transformOrigin) svg.style.transformOrigin = '';
  committedPanX = camPanX;
  committedPanY = camPanY;
  committedZoom = camZoom;
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

  cachedInteractiveSpots.roadScale = roadScale;

  if (cachedCanvasHexes.length > 0) {
    drawBoardTerrainCanvas({
      hexes: cachedCanvasHexes,
      landPath: cachedLandPathD,
      waterPath: cachedWaterPathD,
      isLobby: state.status === 'LOBBY',
      canPaintHex: cachedCanPaintHex,
      bounds: { centerX0, centerY0, contentW, contentH },
      camZoom,
      camPanX,
      camPanY,
      animatingFogHexIds: cachedAnimatingFogIds,
      staticVersion: staticCanvasVersion,
      ports: cachedCanvasPorts,
      fishGrounds: cachedCanvasFish,
      hexOverlays: cachedCanvasOverlays,
      interactiveSpots: cachedInteractiveSpots
    });
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

/** Computes the port badge center `(sx, sy)` outward along the coastal hex edge normal. */
function portBadgeCenter(v1: any, v2: any, h: any): { sx: number; sy: number } {
  const mx = (v1.x + v2.x) / 2;
  const my = (v1.y + v2.y) / 2;
  const dx = mx - h.x;
  const dy = my - h.y;
  const nLen = Math.hypot(dx, dy) || 1;
  return { sx: mx + (dx / nLen) * 42, sy: my + (dy / nLen) * 42 };
}

/** The port is the node for a harbor upgrade and a port raise (not the city on it): what click it sends, and whether you cannot pay for any of it yet. */
interface PortNode {
  kind: 'harbor' | 'upgrade_port' | 'menu';
  vertexId: number;
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

  // 1. Static / Terrain Layer: rendered onto #boardTerrainCanvas (0 SVG DOM nodes in #boardTerrainLayer).
  const playerById = new Map<string, any>();
  for (const p of state.players) playerById.set(p.id, p);

  if (cachedCoastalBoardKey !== cachedGeomBoardKey) {
    cachedCoastalBoardKey = cachedGeomBoardKey;
    coastalEdgeIndices = [];
    for (let i = 0; i < edges.length; i++) {
      if (edges[i].hexIds.length === 1) coastalEdgeIndices.push(i);
    }
  }

  let staticChanged = false;
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
    staticChanged = true;
    let landPathD = '';
    let waterPathD = '';
    const nextCanvasHexes: TerrainHexLike[] = [];
    const nextAnimatingFog = new Set<number>();

    for (const h of hexes) {
      const g = hexGeomCache.get(h.id);
      if (!g) continue;
      if (h.type === 'water') {
        if (state.status === 'LOBBY') waterPathD += g.pathSub;
      } else {
        landPathD += g.pathSub;
      }
      if (getPieceAnimAttrs(`fog_${h.id}`, now).isAnimating) {
        nextAnimatingFog.add(h.id);
      }
      nextCanvasHexes.push({
        id: h.id,
        x: h.x,
        y: h.y,
        type: h.type,
        fog: Boolean(h.fog),
        number: h.number ?? null,
        tilePoly: g.tilePoly,
        rawPts: g.rawPts
      });
    }

    cachedLandPathD = landPathD;
    cachedWaterPathD = waterPathD;
    cachedCanvasHexes = nextCanvasHexes;
    cachedCanPaintHex = canPaintHex;
    cachedAnimatingFogIds = nextAnimatingFog;

    if (layers.terrainLayer.innerHTML !== '') {
      layers.terrainLayer.innerHTML = '';
    }
    layers.terrainLayer.style.pointerEvents = 'none';
  }

  // Interactive spots collected for the fast frustum-culled 2D canvas pass (eliminates thousands of SVG DOM nodes on big maps).
  const nextHexSpots: CanvasHexSpot[] = [];
  const nextFeedSpots: CanvasFeedSpot[] = [];
  const nextPortSpots: CanvasPortSpot[] = [];
  const nextEdgeSpots: CanvasEdgeSpot[] = [];
  const nextVertexSpots: CanvasVertexSpot[] = [];

  // 2. Dynamic Hex Layer: ONLY the single robber SVG piece stays in SVG; rolled dimming, robber targets, and net spots render on 2D Canvas.
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

    if (isRolledHex) {
      nextHexSpots.push({ hexId: h.id, x: h.x, y: h.y, innerPoly: geom.innerPoly, kind: 'rolled' });
    }
    if (canClickRobber) {
      nextHexSpots.push({ hexId: h.id, x: h.x, y: h.y, innerPoly: geom.innerPoly, kind: 'robber' });
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
  // Fishing nets: in net mode the sea tiles the server listed (`netSpots`, hex ids) render on Canvas and click via math hit-testing.
  const netSpotSet = isMyTurn && buildMode === 'net' && state.phase === 'MAIN' && me && (me.netsLeft ?? 0) > 0 && canClientAffordPiece(me, 'net')
    ? new Set<number>(me.netSpots ?? [])
    : null;
  if (netSpotSet) {
    for (const id of [...netSpotSet].sort((a, b) => a - b)) {
      const h = hexes[id];
      const geom = hexGeomCache.get(id);
      if (!h || !geom) continue;
      nextHexSpots.push({ hexId: id, x: h.x, y: h.y, innerPoly: geom.innerPoly, kind: 'net' });
    }
  }
  if (hexDynHtml !== lastHexDynamicHtml) {
    lastHexDynamicHtml = hexDynHtml;
    layers.hexDynamicLayer.innerHTML = hexDynHtml;
  }

  // 2b. Overlays (Tidebound flood/warning/drowned, elevation heat map, base overlays): rendered on 2D Canvas (0 SVG DOM nodes).
  syncOverlayManifest();
  const elevation = state.tide?.elevation ?? null;
  const serverOverlays = (state as any).hexOverlays ?? null;
  const overlaySigParts: string[] = [cachedGeomBoardKey, elevationView && elevation ? 'elev' : 'ov'];
  const nextOverlays: CanvasHexOverlayLike[] = [];
  if (elevationView && elevation) {
    for (const h of hexes) {
      if (!h || h.type === 'water' || h.fog || h.type === 'fog') continue;
      if (elevation[h.id] === undefined) continue;
      const e = Math.max(1, Math.min(3, Math.round(Number(elevation[h.id]))));
      if (!Number.isFinite(e)) continue;
      const poly = hexGeomCache.get(h.id)?.innerPoly;
      if (!poly) continue;
      const kind = `elev-${e}`;
      overlaySigParts.push(`${h.id}:${kind}`);
      nextOverlays.push({ hexId: h.id, x: h.x, y: h.y, innerPoly: poly, kind });
    }
  } else {
    for (const h of hexes) {
      if (!h || h.type === 'water' || h.fog || h.type === 'fog') continue;
      const entry =
        getClientHexOverlay(h.id) ||
        (serverOverlays && serverOverlays[h.id]) ||
        (h.overlay && typeof h.overlay === 'object' ? h.overlay : typeof h.overlay === 'string' ? { kind: h.overlay } : null);
      if (!entry || !entry.kind) continue;
      const poly = hexGeomCache.get(h.id)?.innerPoly;
      if (!poly) continue;
      const label = entry.label ?? (entry.kind === 'flood' ? 'Flooded' : entry.kind === 'flood-warn' ? 'Flood warning' : undefined);
      overlaySigParts.push(`${h.id}:${entry.kind}:${label || ''}`);
      nextOverlays.push({ hexId: h.id, x: h.x, y: h.y, innerPoly: poly, kind: entry.kind, label });
    }
  }
  const overlayKey = overlaySigParts.join('|');
  if (overlayKey !== lastOverlayKey) {
    lastOverlayKey = overlayKey;
    cachedCanvasOverlays = nextOverlays;
    staticChanged = true;
  }
  if (lastOverlayHtml !== '' || layers.overlayLayer.innerHTML !== '') {
    lastOverlayHtml = '';
    layers.overlayLayer.innerHTML = '';
  }

  // Fishing nets: a net sits on one sea tile and fishes only that tile (few placed nets, stays crisp in SVG).
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

  // Fishing grounds (T7c, T7e): rendered on 2D Canvas (0 SVG DOM nodes in #boardFishLayer).
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

  const fishSigParts: string[] = [cachedGeomBoardKey];
  const nextFish: CanvasFishLike[] = [];
  for (const id of [...fishIds].sort((a, b) => a - b)) {
    const h = hexes[id];
    if (!h || h.fog) continue;
    const hasIcon = fishIcons[id] !== undefined;
    const left = hasIcon ? fishIcons[id] : 0;
    const { fishOffset } = hexIconLayout({
      hasFish: true,
      hasSeaWreck: seaWreckHexIds.has(id),
      hasPirate: pirateHexIds.has(id)
    });
    const fx = Number(h.x) + fishOffset.dx;
    const fy = Number(h.y) + fishOffset.dy;
    const tilePoly = hasIcon ? hexGeomCache.get(id)?.tilePoly : undefined;
    fishSigParts.push(`${id}:${hasIcon ? 1 : 0}:${left}:${fx.toFixed(1)},${fy.toFixed(1)}`);
    nextFish.push({ hexId: id, fx, fy, left, hasIcon, tilePoly });
    if (feedSpotSet?.has(id)) {
      nextFeedSpots.push({ hexId: id, fx, fy, isNew: !hasIcon });
    }
  }
  const fishKey = fishSigParts.join('|');
  if (fishKey !== lastFishKey) {
    lastFishKey = fishKey;
    cachedCanvasFish = nextFish;
    staticChanged = true;
  }
  if (lastFishHtml !== '' || layers.fishLayer.innerHTML !== '') {
    lastFishHtml = '';
    layers.fishLayer.innerHTML = '';
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

  // Pirates (T10): one ship per pirate on its sea tile with a strength badge.
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
  const menuCtx = isMyTurn && state.phase === 'MAIN' && !buildMode && me ? buildMenuContext(me) : null;
  const harborModeOn = isMyTurn && state.phase === 'MAIN' && !!me && buildMode === 'harbor';
  const harborModeSet = harborModeOn && canClientAffordHarbor(me) ? new Set<number>(me.harborSpots ?? []) : null;
  const raiseModeSet = harborModeOn && !me.harborCost
    ? new Set<number>(portRaiseSpots(state.techActions?.harbor, true).filter(s => s.affordable).map(s => s.vertexId))
    : null;
  const portNodeFor = (e: any): PortNode | null => {
    for (const vid of [e.v1, e.v2]) {
      const b = vertices[vid]?.building;
      if (!b || b.owner !== socket.id) continue;
      if (harborModeSet?.has(vid)) return { kind: 'harbor', vertexId: vid, dim: false };
      if (raiseModeSet?.has(vid)) return { kind: 'upgrade_port', vertexId: vid, dim: false };
      if (!menuCtx) continue;
      const opts = vertexOptions(menuCtx, vid).filter(o => o.id === 'harbor' || o.id === 'upgrade_port');
      if (opts.length > 0) return { kind: 'menu', vertexId: vid, dim: !opts.some(o => o.affordable) };
    }
    return null;
  };

  // 3. Ports Layer: rendered on 2D Canvas (0 SVG DOM nodes in #boardPortsLayer).
  const canPaintPort = isLobbyHost && activeBrush.type === 'port';
  const portsSigParts: string[] = [cachedGeomBoardKey];
  const nextPorts: CanvasPortLike[] = [];
  for (let ci = 0; ci < coastalEdgeIndices.length; ci++) {
    const e = edges[coastalEdgeIndices[ci]];
    const v1 = vertices[e.v1], v2 = vertices[e.v2];
    if (!v1 || !v2) continue;
    const h = hexes[e.hexIds[0]];
    if (!h) continue;

    if (e.port) {
      const owned = Boolean((v1.building && v1.building.owner === socket.id) || (v2.building && v2.building.owner === socket.id));
      const pLvl = Math.max(state.portLevels?.[e.v1] || 0, state.portLevels?.[e.v2] || 0);
      const { sx, sy } = portBadgeCenter(v1, v2, h);
      portsSigParts.push(`${e.id}:${e.port}:${owned ? 1 : 0}:${pLvl}`);
      nextPorts.push({
        edgeId: e.id,
        v1x: v1.x, v1y: v1.y,
        v2x: v2.x, v2y: v2.y,
        hx: h.x, hy: h.y,
        port: e.port,
        owned,
        level: pLvl,
        sx, sy
      });
      if (canPaintPort) {
        nextPortSpots.push({ edgeId: e.id, sx, sy, kind: 'paint' });
      } else {
        const node = portNodeFor(e);
        if (node) {
          nextPortSpots.push({ edgeId: e.id, sx, sy, kind: node.kind, vertexId: node.vertexId, dim: node.dim });
        }
      }
    } else if (canPaintPort) {
      nextPortSpots.push({
        edgeId: e.id,
        sx: (v1.x + v2.x) / 2,
        sy: (v1.y + v2.y) / 2,
        kind: 'paint'
      });
    }
  }
  const portsKey = portsSigParts.join('|');
  if (portsKey !== lastPortsKey) {
    lastPortsKey = portsKey;
    cachedCanvasPorts = nextPorts;
    staticChanged = true;
  }
  if (layers.portsLayer.innerHTML !== '') {
    layers.portsLayer.innerHTML = '';
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
      const owner = playerById.get(c.owner);
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
      const owner = playerById.get(ownerId);
      const col = owner?.color || '#888';
      const isRickety = e.pieceType === 'rickety_bridge';
      const isBridge = e.pieceType === 'bridge' || isRickety;

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

  // Fast O(myPieces) candidate vertex/edge sets for MAIN phase (avoids scanning 5,000+ edges & 3,700+ vertices on big maps)
  const myId = socket.id;
  let myCandidateEdges: Set<number> | null = null;
  let myCandidateVertices: Set<number> | null = null;
  if (isMyTurn && state.phase === 'MAIN' && me) {
    myCandidateEdges = new Set<number>();
    myCandidateVertices = new Set<number>();
    for (const v of vertices) {
      if (v.building && v.building.owner === myId) {
        for (const eid of v.edgeIds) myCandidateEdges.add(eid);
      }
    }
    for (const e of edges) {
      if (e.road !== myId) continue;
      for (const vid of [e.v1, e.v2]) {
        const v = vertices[vid];
        if (!v) continue;
        if (!v.building) myCandidateVertices.add(vid);
        if (!v.building || v.building.owner === myId) {
          for (const oe of v.edgeIds) myCandidateEdges.add(oe);
        }
      }
    }
    // Include any server-provided manifest piece spots so generic pack pieces always show up
    if (me.pieces) {
      for (const ent of manifestEntries()) {
        const spots = me.pieces[ent.id]?.spots;
        if (!spots) continue;
        if (ent.slot === 'vertex') {
          for (const vid of spots) myCandidateVertices.add(vid);
        } else if (ent.slot === 'edge' || ent.slot === 'edge:ocean') {
          for (const eid of spots) myCandidateEdges.add(eid);
        }
      }
    }
  }

  // 5. Road & Bridge Spots: rendered on 2D Canvas (0 SVG DOM nodes in #roadSpotsLayer).
  if (isMyTurn && me) {
    if (menuCtx && myCandidateEdges) {
      for (const eid of myCandidateEdges) {
        const e = edges[eid];
        if (!e || e.road) continue;
        const v1 = vertices[e.v1], v2 = vertices[e.v2];
        if (!v1 || !v2) continue;
        const opts = edgeOptions(menuCtx, e.id);
        if (opts.length === 0) continue;
        nextEdgeSpots.push({
          edgeId: e.id,
          x1: v1.x, y1: v1.y,
          x2: v2.x, y2: v2.y,
          mx: (v1.x + v2.x) / 2,
          my: (v1.y + v2.y) / 2,
          kind: 'menu',
          dim: !opts.some(o => o.affordable)
        });
      }
    } else if (state.phase === 'SETUP_ROAD' && state.lastSetupVertexId != null) {
      const setupV = vertices[state.lastSetupVertexId];
      if (setupV) {
        for (const eid of setupV.edgeIds) {
          const e = edges[eid];
          if (!e || e.road) continue;
          if (!canClientPlaceRoad(e, me)) continue;
          const v1 = vertices[e.v1], v2 = vertices[e.v2];
          if (!v1 || !v2) continue;
          nextEdgeSpots.push({
            edgeId: e.id,
            x1: v1.x, y1: v1.y,
            x2: v2.x, y2: v2.y,
            mx: (v1.x + v2.x) / 2,
            my: (v1.y + v2.y) / 2,
            kind: 'direct'
          });
        }
      }
    } else if (state.phase === 'MAIN' && myCandidateEdges) {
      const allowRoad = (!buildMode || buildMode === 'road') && me.roadsLeft > 0 && (me.freeRoads > 0 || canClientAffordPiece(me, 'road'));
      const allowBridge = (!buildMode || buildMode === 'bridge') && (me.bridgesLeft ?? 0) > 0 &&
        (canClientAffordPiece(me, 'bridge') || (isRicketyEnabled(me) && canClientAffordPiece(me, 'rickety_bridge')));
      if (allowRoad || allowBridge) {
        for (const eid of myCandidateEdges) {
          const e = edges[eid];
          if (!e || e.road) continue;
          const ok = (allowRoad && e.hexIds.length > 0 && canClientPlaceRoad(e, me)) ||
            (allowBridge && e.hexIds.length === 0 && canClientPlaceBridge(e, me));
          if (!ok) continue;
          const v1 = vertices[e.v1], v2 = vertices[e.v2];
          if (!v1 || !v2) continue;
          nextEdgeSpots.push({
            edgeId: e.id,
            x1: v1.x, y1: v1.y,
            x2: v2.x, y2: v2.y,
            mx: (v1.x + v2.x) / 2,
            my: (v1.y + v2.y) / 2,
            kind: 'direct'
          });
        }
      }
    }
    if (state.phase === 'MAIN' && canClientAffordBridgeUpgrade(me)) {
      for (const e of edges) {
        if (e.pieceType !== 'rickety_bridge' || e.road !== myId) continue;
        const v1 = vertices[e.v1], v2 = vertices[e.v2];
        if (!v1 || !v2) continue;
        nextEdgeSpots.push({
          edgeId: e.id,
          x1: v1.x, y1: v1.y,
          x2: v2.x, y2: v2.y,
          mx: (v1.x + v2.x) / 2,
          my: (v1.y + v2.y) / 2,
          kind: 'bridge_upgrade'
        });
      }
    }
  }
  if (lastRoadSpotsHtml !== '' || layers.roadSpotsLayer.innerHTML !== '') {
    lastRoadSpotsHtml = '';
    layers.roadSpotsLayer.innerHTML = '';
  }

  // 6. Vertices Layer: ONLY placed settlements & cities stay in SVG (~4-40 nodes); all empty settlement spots render on 2D Canvas.
  const robberVictimSet = new Set<string>(state.robberVictims || []);
  let verticesHtml = '';
  const canAffordCity = me ? canClientAffordPiece(me, 'city') : false;
  const canAffordSettle = me ? canClientAffordPiece(me, 'settlement') : false;
  const skipEmptySpots = buildMode === 'net' || buildMode === 'feed' || buildMode === 'harbor' || isPieceMode(buildMode);

  for (const v of vertices) {
    if (v.building) {
      const owner = playerById.get(v.building.owner);
      const col = owner?.color || '#888';
      const canUpgrade = isMyTurn && state.phase === 'MAIN' && buildMode !== 'harbor' &&
        v.building.owner === myId && v.building.type === 'settlement' &&
        me && canAffordCity && me.citiesLeft > 0;
      const canRobThisBuilding = isMyTurn && state.phase === 'ROBBER_STEAL' &&
        v.hexIds.includes(robberHexId) && robberVictimSet.has(v.building.owner);
      const isCity = v.building.type === 'city';
      const isClickable = canUpgrade || canRobThisBuilding;
      const menuOpts = menuCtx && v.building.owner === myId
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
    } else if (isMyTurn && state.phase === 'SETUP_SETTLEMENT' && me && me.settlementsLeft > 0 && !skipEmptySpots) {
      if (v.hexIds && v.hexIds.length > 0) {
        let adjBlocked = false;
        for (let k = 0; k < v.adjacentVertices.length; k++) {
          if (vertices[v.adjacentVertices[k]]?.building) { adjBlocked = true; break; }
        }
        if (!adjBlocked) {
          nextVertexSpots.push({ vertexId: v.id, x: v.x, y: v.y, kind: 'direct' });
        }
      }
    }
  }

  // MAIN phase empty vertex hotspots (O(myPieces) via myCandidateVertices)
  if (isMyTurn && state.phase === 'MAIN' && me && myCandidateVertices && !skipEmptySpots) {
    for (const vid of myCandidateVertices) {
      const v = vertices[vid];
      if (!v || v.building) continue;
      if (menuCtx) {
        const opts = vertexOptions(menuCtx, vid);
        if (opts.length === 0) continue;
        nextVertexSpots.push({ vertexId: vid, x: v.x, y: v.y, kind: 'menu', dim: !opts.some(o => o.affordable) });
      } else if (canAffordSettle && me.settlementsLeft > 0 && canClientPlaceSettlement(v, me)) {
        nextVertexSpots.push({ vertexId: vid, x: v.x, y: v.y, kind: 'direct' });
      }
    }
  }

  if (verticesHtml !== lastVerticesHtml) {
    lastVerticesHtml = verticesHtml;
    layers.verticesLayer.innerHTML = verticesHtml;
  }

  // BUG 5: the open build menu follows this render (its options and prices), and closes when the menu is off.
  syncBuildMenu(menuCtx);

  // 7. Generic spots of manifest pieces and actions (R8.7): hex menu spots go to Canvas; manifest piece spots stay in #boardPieceSpotsLayer.
  if (menuCtx) {
    for (const id of hexCandidates(menuCtx)) {
      const h = hexes[id];
      const opts = h && !h.fog ? hexOptions(menuCtx, id) : [];
      if (opts.length === 0) continue;
      const geom = hexGeomCache.get(id);
      nextHexSpots.push({
        hexId: id,
        x: h.x,
        y: h.y,
        innerPoly: geom?.innerPoly || '',
        kind: 'menu',
        dim: !opts.some(o => o.affordable)
      });
    }
  }
  const pieceSpotsHtml = pieceSpotsMarkup(me, isMyTurn);
  if (pieceSpotsHtml !== lastPieceSpotsHtml) {
    lastPieceSpotsHtml = pieceSpotsHtml;
    layers.pieceSpotsLayer.innerHTML = pieceSpotsHtml;
  }

  if (staticChanged) {
    staticCanvasVersion++;
  }
  cachedInteractiveSpots = {
    vertices: nextVertexSpots,
    edges: nextEdgeSpots,
    ports: nextPortSpots,
    feeds: nextFeedSpots,
    hexes: nextHexSpots,
    roadScale: lastRoadScale > 0 ? lastRoadScale : ROAD_BASE_SCALE
  };

  updateCameraViewBox();
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
 * Updates the 2D canvas immediately (<0.5ms, zero chunk loading) and moves the lightweight SVG piece overlay
 * on the GPU compositor (`translate` + `scale`) during BOTH pan drags and zooms so SVG viewBox is never mutated mid-gesture.
 */
export function panBoardPreview(rect?: DOMRect): void {
  if (!state || panFramePending) return;
  panFramePending = true;
  requestAnimationFrame(() => {
    panFramePending = false;
    if (!state || !state.board) return;
    const svg = document.getElementById('boardSvg');
    if (!svg) return;
    const bounds = getBoardBounds();
    if (cachedCanvasHexes.length > 0) {
      drawBoardTerrainCanvas({
        hexes: cachedCanvasHexes,
        landPath: cachedLandPathD,
        waterPath: cachedWaterPathD,
        isLobby: state.status === 'LOBBY',
        canPaintHex: cachedCanPaintHex,
        bounds,
        camZoom,
        camPanX,
        camPanY,
        animatingFogHexIds: cachedAnimatingFogIds,
        staticVersion: staticCanvasVersion,
        ports: cachedCanvasPorts,
        fishGrounds: cachedCanvasFish,
        hexOverlays: cachedCanvasOverlays,
        interactiveSpots: cachedInteractiveSpots
      });
    }
    const viewW = rect?.width || svg.clientWidth || 1000;
    const viewH = rect?.height || svg.clientHeight || 800;
    const cam = computeCanvasCamera(bounds, camZoom, camPanX, camPanY, viewW, viewH);
    const dxPx = (camPanX - committedPanX) * cam.scale;
    const dyPx = (camPanY - committedPanY) * cam.scale;
    const scaleRatio = committedZoom / Math.max(0.001, camZoom);
    svg.style.transformOrigin = '50% 50%';
    if (Math.abs(scaleRatio - 1) > 0.0005) {
      svg.style.transform = `translate(${dxPx.toFixed(2)}px, ${dyPx.toFixed(2)}px) scale(${scaleRatio.toFixed(5)})`;
    } else {
      svg.style.transform = `translate(${dxPx.toFixed(2)}px, ${dyPx.toFixed(2)}px)`;
    }
  });
}

/** Smooth 60 FPS GPU-composited wheel zoom preview; commits crisp SVG viewBox once zooming settles. */
export function zoomBoardPreview(rect?: DOMRect): void {
  panBoardPreview(rect);
  if (zoomCommitTimer !== null) clearTimeout(zoomCommitTimer);
  zoomCommitTimer = setTimeout(() => {
    zoomCommitTimer = null;
    endBoardPan();
  }, 130);
}

/** The pan or zoom gesture ended: flush any pending SVG camera viewBox commit. */
export function endBoardPan(): void {
  if (zoomCommitTimer !== null) {
    clearTimeout(zoomCommitTimer);
    zoomCommitTimer = null;
  }
  const panLayer = document.getElementById('boardPan');
  const svg = document.getElementById('boardSvg');
  if (
    state?.board &&
    (camPanX !== committedPanX || camPanY !== committedPanY || camZoom !== committedZoom || panLayer?.style.transform || svg?.style.transform)
  ) {
    updateCameraViewBox();
  }
}

function clientPointToWorld(clientX: number, clientY: number): { wx: number; wy: number; worldPerPx: number } | null {
  if (!state?.board) return null;
  const svg = document.getElementById('boardSvg');
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const bounds = getBoardBounds();
  const cam = computeCanvasCamera(bounds, camZoom, camPanX, camPanY, rect.width, rect.height);
  const pt = screenToWorld(clientX - rect.left, clientY - rect.top, cam);
  return { wx: pt.x, wy: pt.y, worldPerPx: cam.worldPerPx };
}

function pointToSegmentDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-6) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/**
 * Returns the hex ID underneath viewport client coordinates `(clientX, clientY)` using fast math hit-testing
 * (replaces 1,300+ `<polygon data-paintable="1">` DOM nodes in Lobby).
 */
export function hexAtClientPoint(clientX: number, clientY: number): number | null {
  if (cachedCanvasHexes.length === 0) return null;
  const info = clientPointToWorld(clientX, clientY);
  if (!info) return null;
  return findHexAtWorldPoint(info.wx, info.wy, cachedCanvasHexes);
}

/** Returns the coastal port edge ID underneath `(clientX, clientY)` when lobby port painting is active. */
export function portEdgeAtClientPoint(clientX: number, clientY: number): number | null {
  const ports = cachedInteractiveSpots.ports;
  if (!ports || ports.length === 0) return null;
  const info = clientPointToWorld(clientX, clientY);
  if (!info) return null;
  const maxDist = Math.max(24, 22 * info.worldPerPx);
  let bestId: number | null = null;
  let bestDist = maxDist;
  for (let i = 0; i < ports.length; i++) {
    const p = ports[i];
    if (p.kind !== 'paint') continue;
    const d = Math.hypot(info.wx - p.sx, info.wy - p.sy);
    if (d <= bestDist) {
      bestDist = d;
      bestId = p.edgeId;
    }
  }
  return bestId;
}

/**
 * Handles clicks/taps on all 2D-canvas-rendered interactive spots (settlement/build spots, road/bridge spots,
 * port upgrades, feed spots, robber targets, net spots, and lobby port brushes) with 44px hit slop (nearest wins).
 */
export function handleBoardCanvasClick(clientX: number, clientY: number, ev?: MouseEvent): boolean {
  const info = clientPointToWorld(clientX, clientY);
  if (!info) return false;
  const { wx, wy, worldPerPx } = info;
  const hitSlopWorld = 22 * worldPerPx; // 44px diameter minimum touch target

  // Track best point-like target (vertices, edges, port rings, feed rings, menu hex dots) by screen-pixel distance
  let bestPxDist = Infinity;
  let bestAction: (() => void) | null = null;

  const consider = (worldDist: number, maxWorldR: number, biasPx: number, action: () => void) => {
    if (worldDist > maxWorldR) return;
    const pxDist = worldDist / worldPerPx + biasPx;
    if (pxDist < bestPxDist) {
      bestPxDist = pxDist;
      bestAction = action;
    }
  };

  // 1. Vertex spots (slight -2px tie-break bias so corners win over adjacent edges right at the corner)
  const vSpots = cachedInteractiveSpots.vertices;
  if (vSpots && vSpots.length > 0) {
    const maxR = Math.max(20, hitSlopWorld);
    for (let i = 0; i < vSpots.length; i++) {
      const vs = vSpots[i];
      const d = Math.hypot(wx - vs.x, wy - vs.y);
      if (d <= maxR) {
        consider(d, maxR, -2, () => {
          if (vs.kind === 'menu') openBuildMenu('vertex', vs.vertexId);
          else clickVertex(vs.vertexId);
        });
      }
    }
  }

  // 2. Edge spots (roads, bridges, rickety bridge upgrade dots)
  const eSpots = cachedInteractiveSpots.edges;
  if (eSpots && eSpots.length > 0) {
    const maxR = Math.max(16, hitSlopWorld);
    for (let i = 0; i < eSpots.length; i++) {
      const es = eSpots[i];
      const d = es.kind === 'bridge_upgrade'
        ? Math.hypot(wx - es.mx, wy - es.my)
        : pointToSegmentDist(wx, wy, es.x1, es.y1, es.x2, es.y2);
      if (d <= maxR) {
        consider(d, maxR, 0, () => {
          if (es.kind === 'bridge_upgrade') clickPlacedBridge(es.edgeId);
          else if (es.kind === 'menu') openBuildMenu('edge', es.edgeId);
          else clickEdge(es.edgeId);
        });
      }
    }
  }

  // 3. Port spots (harbor / port-raise / menu; lobby port paint is handled on mousedown/touchstart)
  const pSpots = cachedInteractiveSpots.ports;
  if (pSpots && pSpots.length > 0) {
    const maxR = Math.max(26, hitSlopWorld);
    for (let i = 0; i < pSpots.length; i++) {
      const ps = pSpots[i];
      if (ps.kind === 'paint') continue;
      const d = Math.hypot(wx - ps.sx, wy - ps.sy);
      if (d <= maxR) {
        consider(d, maxR, 0, () => {
          if (ps.kind === 'harbor' && ps.vertexId !== undefined) clickHarborSpot(ps.vertexId);
          else if (ps.kind === 'upgrade_port' && ps.vertexId !== undefined) upgradePortClick(ps.vertexId);
          else if (ps.kind === 'menu' && ps.vertexId !== undefined) openBuildMenu('vertex', ps.vertexId);
        });
      }
    }
  }

  // 4. Feed-the-sea spots
  const fSpots = cachedInteractiveSpots.feeds;
  if (fSpots && fSpots.length > 0) {
    const maxR = Math.max(30, hitSlopWorld);
    for (let i = 0; i < fSpots.length; i++) {
      const fs = fSpots[i];
      const d = Math.hypot(wx - fs.fx, wy - fs.fy);
      if (d <= maxR) {
        consider(d, maxR, 0, () => clickFeedSpot(fs.hexId));
      }
    }
  }

  // 5. Hex spots (menu hex dots checked as points; robber / net checked by exact hex containment)
  const hSpots = cachedInteractiveSpots.hexes;
  if (hSpots && hSpots.length > 0) {
    const dotMaxR = Math.max(22, hitSlopWorld);
    let hasAreaTarget = false;
    for (let i = 0; i < hSpots.length; i++) {
      const hs = hSpots[i];
      if (hs.kind === 'menu') {
        const d = Math.hypot(wx - hs.x, wy - hs.y);
        if (d <= dotMaxR) {
          consider(d, dotMaxR, 0, () => openBuildMenu('hex', hs.hexId));
        }
      } else if (hs.kind === 'robber' || hs.kind === 'net') {
        hasAreaTarget = true;
      }
    }

    if (bestAction) {
      (bestAction as () => void)();
      return true;
    }

    if (hasAreaTarget && cachedCanvasHexes.length > 0) {
      const hitHexId = findHexAtWorldPoint(wx, wy, cachedCanvasHexes);
      if (hitHexId !== null) {
        for (let i = 0; i < hSpots.length; i++) {
          const hs = hSpots[i];
          if (hs.hexId !== hitHexId) continue;
          if (hs.kind === 'robber') {
            onHexClick(hitHexId, ev);
            return true;
          }
          if (hs.kind === 'net') {
            clickNetSpot(hitHexId);
            return true;
          }
        }
      }
    }
    return false;
  }

  if (bestAction) {
    (bestAction as () => void)();
    return true;
  }
  return false;
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
      const mobDev = document.getElementById('mobBankDevDeck');
      if (mobDev && mobDev.offsetWidth > 0) return mobDev;
      return document.getElementById('bankDevDeckItem') || document.getElementById('bankBar');
    }
    const mobRes = document.getElementById(`mobBankRes_${resource}`);
    if (mobRes && mobRes.offsetWidth > 0) return mobRes;
    const mobileBtn = document.getElementById('btnMobileSidebar');
    if (mobileBtn && mobileBtn.offsetWidth > 0) return mobileBtn;
    return document.getElementById(`bankRes_${resource}`) || document.getElementById('bankBar');
  }
  const mobilePill = document.getElementById(`mobilePlayerPill_${actorId}`);
  if (mobilePill && mobilePill.offsetWidth > 0) return mobilePill;
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
      const mobilePill = document.getElementById(`mobilePlayerPill_${prod.playerId}`);
      targetEl = (mobilePill && mobilePill.offsetWidth > 0) ? mobilePill : document.getElementById(`playerRow_${prod.playerId}`);
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
