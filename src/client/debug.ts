// MODULE: client debug mode HUD, FPS/SVG node profiler, client-vs-server spot desync checker, sandbox controls, and board ID/icon-stress overlays | DEPENDS ON: client/icons, client/pieceModel, client/render/board, client/render/pirates, client/socket, client/store, +2 more | USED BY: client/main, client/render/board, client/render/index
import { fishGroundMarkup, hexIconLayout, netTileMarkup, robberMarkup, wreckMarkup } from './icons';
import { portRaiseSpots } from './pieceModel';
import {
  canClientAffordHarbor,
  canClientAffordPiece,
  canClientPlaceBridge,
  canClientPlaceRoad,
  canClientPlaceSettlement
} from './render/board';
import { pirateMarkup } from './render/pirates';
import { socket } from './socket';
import { state } from './store';
import { showToast } from './ui';
import { esc } from './util';

export type DebugBrush =
  | 'off'
  | 'settlement'
  | 'city'
  | 'road'
  | 'bridge'
  | 'rickety_bridge'
  | 'net'
  | 'pirate'
  | 'wreck_sea'
  | 'wreck_shore'
  | 'robber'
  | 'clear';

export interface SpotSetSummary {
  settlementVertices: number[];
  roadEdges: number[];
  bridgeEdges: number[];
  netHexes: number[];
  harborVertices: number[];
  portRaiseVertices: number[];
}

let debugOpen = false;
let debugShowIds = false;
let debugStressHex = false;
let debugAutoAudit = true;
let debugBrush: DebugBrush = 'off';
let lastAuditReport: any = null;
let lastAuditStateKey = '';

// Frame timing & FPS tracker (active only while Debug Mode is open)
let fpsRafId = 0;
let lastFrameTs = 0;
let frameCount = 0;
let currentFps = 60;
let worstFrameMs = 0;
let recentFrames: { ts: number; dt: number }[] = [];

export function isDebugModeOpen(): boolean {
  return debugOpen;
}

export function isDebugOverlayActive(): boolean {
  return debugOpen && (debugShowIds || debugStressHex || debugBrush !== 'off');
}

export function getDebugOverlayKey(): string {
  if (!isDebugOverlayActive()) return 'off';
  return `${debugShowIds ? 'ids' : ''}_${debugStressHex ? 'stress' : ''}_${debugBrush}_${state?.board?.hexes?.length ?? 0}`;
}

/** Pure diff between client-computed build spots and server `legalActions` spots. Returns human-readable desync warnings. */
export function diffClientVsServerSpots(client: SpotSetSummary, server: SpotSetSummary): string[] {
  const diffs: string[] = [];
  const check = (label: string, prefix: string, cList: number[], sList: number[]) => {
    const cSet = new Set(cList);
    const sSet = new Set(sList);
    const missingInClient = sList.filter(id => !cSet.has(id));
    const extraInClient = cList.filter(id => !sSet.has(id));
    if (missingInClient.length > 0) {
      diffs.push(`Client hides legal ${label}: ${missingInClient.slice(0, 6).map(i => `${prefix}${i}`).join(', ')}`);
    }
    if (extraInClient.length > 0) {
      diffs.push(`Client shows illegal ${label}: ${extraInClient.slice(0, 6).map(i => `${prefix}${i}`).join(', ')}`);
    }
  };

  check('settlement', 'V', client.settlementVertices, server.settlementVertices);
  check('road', 'E', client.roadEdges, server.roadEdges);
  check('bridge', 'E', client.bridgeEdges, server.bridgeEdges);
  check('net', 'H', client.netHexes, server.netHexes);
  check('harbor', 'V', client.harborVertices, server.harborVertices);
  check('port raise', 'V', client.portRaiseVertices, server.portRaiseVertices);
  return diffs;
}

/** Computes what spots the client currently considers buildable for `me` on their turn. */
export function collectClientSpots(): SpotSetSummary {
  const empty: SpotSetSummary = {
    settlementVertices: [],
    roadEdges: [],
    bridgeEdges: [],
    netHexes: [],
    harborVertices: [],
    portRaiseVertices: []
  };
  if (!state?.board || !state?.players) return empty;
  const me = state.players.find(p => p.id === socket.id) ?? state.players[state.turnIndex];
  if (!me) return empty;
  const isMyTurn = state.currentPlayerId === me.id || state.players[state.turnIndex]?.id === me.id;
  if (!isMyTurn) return empty;

  const settlementVertices: number[] = [];
  for (const v of state.board.vertices) {
    if (!v.building && canClientPlaceSettlement(v, me)) settlementVertices.push(v.id);
  }

  const roadEdges: number[] = [];
  const bridgeEdges: number[] = [];
  for (const e of state.board.edges) {
    if (e.road) continue;
    if (canClientPlaceRoad(e, me)) roadEdges.push(e.id);
    if (canClientPlaceBridge(e, me)) bridgeEdges.push(e.id);
  }

  const netHexes =
    state.phase === 'MAIN' && (me.netsLeft ?? 0) > 0 && canClientAffordPiece(me, 'net')
      ? [...(me.netSpots ?? [])]
      : [];
  const harborVertices =
    state.phase === 'MAIN' && canClientAffordHarbor(me)
      ? [...(me.harborSpots ?? [])]
      : [];
  const portRaiseVertices =
    state.phase === 'MAIN'
      ? portRaiseSpots(state.techActions?.harbor, true).filter(s => s.affordable).map(s => s.vertexId)
      : [];

  return {
    settlementVertices,
    roadEdges,
    bridgeEdges,
    netHexes,
    harborVertices,
    portRaiseVertices
  };
}

/** Generates SVG markup for `#boardDebugLayer` (board IDs, clickable sandbox targets, and the all-icons slot stress test). */
export function renderDebugBoardOverlayMarkup(): string {
  if (!isDebugOverlayActive() || !state?.board) return '';
  const { hexes = [], vertices = [], edges = [] } = state.board;
  let html = '';

  // 1. All-Icons Slot Stress Test on the center hex (verifies Bugs 5, 9, 17 and zoom scaling simultaneously)
  if (debugStressHex && hexes.length > 0) {
    const centerHex = hexes[Math.floor(hexes.length / 2)] || hexes[0];
    if (centerHex) {
      const seaLayout = hexIconLayout({
        hasFish: true,
        hasSeaWreck: true,
        hasPirate: true
      });
      const shoreLayout = hexIconLayout({
        hasFish: false,
        hasSeaWreck: false,
        hasPirate: false,
        shoreDir: { dq: 1, dr: 0 },
        hasNumber: true
      });
      const cx = Number(centerHex.x);
      const cy = Number(centerHex.y);
      html += `
        <g data-debug-stress="1" style="pointer-events:none">
          ${netTileMarkup(centerHex.id, centerHex.corners, cx, cy, '#ff7043')}
          <g transform="translate(${(cx + seaLayout.fishOffset.dx).toFixed(1)}, ${(cy + seaLayout.fishOffset.dy).toFixed(1)}) scale(1.25)">
            ${fishGroundMarkup(3)}
          </g>
          <g transform="translate(${(cx + seaLayout.wreckOffset.dx).toFixed(1)}, ${(cy + seaLayout.wreckOffset.dy).toFixed(1)})">
            <g class="piece-zoom-scale"><g transform="scale(1.18)">${wreckMarkup('sea', 1)}</g></g>
          </g>
          <g transform="translate(${(cx + shoreLayout.wreckOffset.dx).toFixed(1)}, ${(cy + shoreLayout.wreckOffset.dy).toFixed(1)})">
            <g class="piece-zoom-scale"><g transform="scale(1.18)">${wreckMarkup('shore', 1)}</g></g>
          </g>
          <g transform="translate(${(cx + seaLayout.pirateOffset.dx).toFixed(1)}, ${(cy + seaLayout.pirateOffset.dy).toFixed(1)})">
            <g class="piece-zoom-scale">${pirateMarkup(2, false)}</g>
          </g>
          <g transform="translate(${(cx + 30).toFixed(1)}, ${(cy - 8).toFixed(1)})">
            <g class="piece-zoom-scale"><g transform="scale(0.85)">${robberMarkup()}</g></g>
          </g>
        </g>
      `;
    }
  }

  const hexBrushActive =
    debugBrush === 'net' ||
    debugBrush === 'pirate' ||
    debugBrush === 'wreck_sea' ||
    debugBrush === 'wreck_shore' ||
    debugBrush === 'robber' ||
    debugBrush === 'clear';
  const vertBrushActive = debugBrush === 'settlement' || debugBrush === 'city' || debugBrush === 'clear';
  const edgeBrushActive =
    debugBrush === 'road' || debugBrush === 'bridge' || debugBrush === 'rickety_bridge' || debugBrush === 'clear';

  // 2. Hex IDs & Hex sandbox click targets
  if (debugShowIds || hexBrushActive) {
    for (const h of hexes) {
      const click = hexBrushActive ? `onclick="debugClickBoard('hex', ${h.id}, event)" style="cursor:crosshair"` : 'style="pointer-events:none"';
      html += `
        <g ${click}>
          ${hexBrushActive ? `<circle cx="${h.x}" cy="${h.y}" r="26" fill="rgba(255,193,7,0.14)" stroke="rgba(255,193,7,0.65)" stroke-width="1.5" stroke-dasharray="4 3" />` : ''}
          ${debugShowIds ? `<rect x="${h.x - 16}" y="${h.y - 42}" width="32" height="14" rx="4" fill="rgba(15,23,42,0.82)" /><text x="${h.x}" y="${h.y - 32}" text-anchor="middle" fill="#38bdf8" font-size="10" font-weight="700">H${h.id}</text>` : ''}
        </g>`;
    }
  }

  // 3. Edge IDs & Edge sandbox click targets
  if (debugShowIds || edgeBrushActive) {
    for (const e of edges) {
      const v1 = vertices[e.v1], v2 = vertices[e.v2];
      if (!v1 || !v2) continue;
      const mx = (v1.x + v2.x) / 2;
      const my = (v1.y + v2.y) / 2;
      const click = edgeBrushActive ? `onclick="debugClickBoard('edge', ${e.id}, event)" style="cursor:crosshair"` : 'style="pointer-events:none"';
      html += `
        <g ${click}>
          ${edgeBrushActive ? `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="10" fill="rgba(56,189,248,0.18)" stroke="#38bdf8" stroke-width="1.5" />` : ''}
          ${debugShowIds ? `<text x="${mx.toFixed(1)}" y="${(my + 3).toFixed(1)}" text-anchor="middle" fill="#fbbf24" stroke="#0f172a" stroke-width="2.5" paint-order="stroke" font-size="9" font-weight="700">E${e.id}</text>` : ''}
        </g>`;
    }
  }

  // 4. Vertex IDs & Vertex sandbox click targets
  if (debugShowIds || vertBrushActive) {
    for (const v of vertices) {
      const click = vertBrushActive ? `onclick="debugClickBoard('vertex', ${v.id}, event)" style="cursor:crosshair"` : 'style="pointer-events:none"';
      html += `
        <g ${click}>
          ${vertBrushActive ? `<circle cx="${v.x}" cy="${v.y}" r="12" fill="rgba(74,222,128,0.18)" stroke="#4ade80" stroke-width="1.5" />` : ''}
          ${debugShowIds ? `<text x="${v.x}" y="${v.y - 12}" text-anchor="middle" fill="#4ade80" stroke="#0f172a" stroke-width="2.5" paint-order="stroke" font-size="9" font-weight="700">V${v.id}</text>` : ''}
        </g>`;
    }
  }

  return html;
}

function countSvgNodes(): { total: number; terrain: number; roads: number; vertices: number; overlays: number } {
  const svg = document.getElementById('boardSvg');
  if (!svg) return { total: 0, terrain: 0, roads: 0, vertices: 0, overlays: 0 };
  const countIn = (id: string) => document.getElementById(id)?.getElementsByTagName('*').length ?? 0;
  const terrain = countIn('boardTerrainLayer') + countIn('boardPortsLayer');
  const roads =
    countIn('roadRimsLayer') + countIn('roadBodiesLayer') + countIn('roadHitsLayer') + countIn('roadSpotsLayer');
  const vertices = countIn('boardVerticesLayer') + countIn('boardPieceSpotsLayer');
  const overlays =
    countIn('boardOverlayLayer') +
    countIn('boardNetsLayer') +
    countIn('boardFishLayer') +
    countIn('boardWrecksLayer') +
    countIn('boardPiratesLayer') +
    countIn('boardHexDynamicLayer');
  const total = svg.getElementsByTagName('*').length;
  return { total, terrain, roads, vertices, overlays };
}

function updatePerfLoop(now: number): void {
  if (!debugOpen) {
    fpsRafId = 0;
    return;
  }
  if (lastFrameTs > 0) {
    const dt = now - lastFrameTs;
    frameCount++;
    recentFrames.push({ ts: now, dt });
    while (recentFrames.length > 0 && now - recentFrames[0].ts > 3000) {
      recentFrames.shift();
    }
    if (frameCount % 12 === 0) {
      const avgDt = recentFrames.reduce((s, f) => s + f.dt, 0) / Math.max(1, recentFrames.length);
      currentFps = Math.min(120, Math.round(1000 / Math.max(1, avgDt)));
      worstFrameMs = Math.round(recentFrames.reduce((m, f) => Math.max(m, f.dt), 0));
      const perfEl = document.getElementById('debugPerfLine');
      if (perfEl) {
        const nodes = countSvgNodes();
        perfEl.textContent = `FPS: ${currentFps} | Max frame (3s): ${worstFrameMs}ms | SVG nodes: ${nodes.total} (T:${nodes.terrain} R:${nodes.roads} V:${nodes.vertices} O:${nodes.overlays})`;
      }
    }
  }
  lastFrameTs = now;
  fpsRafId = requestAnimationFrame(updatePerfLoop);
}

function ensureDebugHudElement(): HTMLElement {
  let el = document.getElementById('debugHudPanel');
  if (!el) {
    el = document.createElement('div');
    el.id = 'debugHudPanel';
    el.className = 'debug-hud-panel';
    el.style.display = 'none';
    document.body.appendChild(el);
  }
  return el;
}

export function sendDebugCmd(cmd: string, payload: Record<string, any> = {}): void {
  if (!state?.code) {
    showToast('Join or create a room first.');
    return;
  }
  socket.emit('debugCmd', { code: state.code, cmd, payload });
}

export function setDebugBrush(brush: DebugBrush): void {
  debugBrush = debugBrush === brush ? 'off' : brush;
  renderDebugHud();
  const me = state?.players?.find(p => p.id === socket.id);
  const isMyTurn = Boolean(state && state.currentPlayerId === socket.id);
  if (state?.board) renderBoardWithDebug(me, isMyTurn);
}

export function toggleDebugIds(): void {
  debugShowIds = !debugShowIds;
  renderDebugHud();
  const me = state?.players?.find(p => p.id === socket.id);
  const isMyTurn = Boolean(state && state.currentPlayerId === socket.id);
  if (state?.board) renderBoardWithDebug(me, isMyTurn);
}

export function toggleDebugStressHex(): void {
  debugStressHex = !debugStressHex;
  renderDebugHud();
  const me = state?.players?.find(p => p.id === socket.id);
  const isMyTurn = Boolean(state && state.currentPlayerId === socket.id);
  if (state?.board) renderBoardWithDebug(me, isMyTurn);
}

export function debugClickBoard(targetType: 'hex' | 'vertex' | 'edge', id: number, ev?: MouseEvent): void {
  if (ev) {
    ev.stopPropagation();
    ev.preventDefault();
  }
  if (debugBrush === 'off') return;
  sendDebugCmd('paintPiece', { brush: debugBrush, targetType, id });
}

function renderBoardWithDebug(me: any, isMyTurn: boolean): void {
  const layer = document.getElementById('boardDebugLayer');
  if (layer) {
    layer.innerHTML = renderDebugBoardOverlayMarkup();
  }
}

export function toggleDebugMode(force?: boolean): void {
  debugOpen = typeof force === 'boolean' ? force : !debugOpen;
  const el = ensureDebugHudElement();
  el.style.display = debugOpen ? 'flex' : 'none';
  if (debugOpen) {
    lastFrameTs = 0;
    if (!fpsRafId) fpsRafId = requestAnimationFrame(updatePerfLoop);
    if (state?.code && state.status !== 'LOBBY') {
      sendDebugCmd('audit');
    }
    renderDebugHud();
  } else {
    debugBrush = 'off';
    debugShowIds = false;
    debugStressHex = false;
  }
  const layer = document.getElementById('boardDebugLayer');
  if (layer) layer.innerHTML = renderDebugBoardOverlayMarkup();
}

export function onDebugStateUpdated(): void {
  if (!debugOpen || !state) return;
  const stateKey = `${state.code}_${state.status}_${state.turnCount}_${state.phase}_${state.round}`;
  if (debugAutoAudit && state.status !== 'LOBBY' && stateKey !== lastAuditStateKey) {
    lastAuditStateKey = stateKey;
    sendDebugCmd('audit');
  }
  renderDebugHud();
}

export function renderDebugHud(): void {
  if (!debugOpen) return;
  const el = ensureDebugHudElement();
  const nodes = countSvgNodes();

  const report = lastAuditReport;
  const clientSpots = collectClientSpots();
  const spotDiffs = report?.legalSpots ? diffClientVsServerSpots(clientSpots, report.legalSpots) : [];
  const allIssues = [...(report?.issues ?? []), ...spotDiffs];

  const brushes: { id: DebugBrush; label: string }[] = [
    { id: 'off', label: 'Off' },
    { id: 'settlement', label: 'Settle' },
    { id: 'city', label: 'City' },
    { id: 'road', label: 'Road' },
    { id: 'bridge', label: 'Bridge' },
    { id: 'rickety_bridge', label: 'Rickety' },
    { id: 'net', label: 'Net' },
    { id: 'pirate', label: 'Pirate' },
    { id: 'wreck_sea', label: 'SeaWreck' },
    { id: 'wreck_shore', label: 'ShoreWreck' },
    { id: 'robber', label: 'Robber' },
    { id: 'clear', label: 'Erase' }
  ];

  const playerRows = (report?.playerAudits ?? [])
    .map(
      (pa: any) =>
        `<div class="dbg-audit-row">
          <b>${esc(pa.name)}</b>: VP=${pa.scoreVp} (bd=${pa.breakdownSum}) · LR=${pa.longestRoadLen}${pa.longestRoadHasBridge ? ' [Bridge✓]' : ''}${pa.grandCausewayBonus ? ` [+${pa.grandCausewayBonus} GC]` : ''} · ${pa.legalActionCount} legal acts
        </div>`
    )
    .join('');

  el.innerHTML = `
    <div class="dbg-head">
      <span>🛠️ Debug Mode (\` to toggle)</span>
      <button type="button" class="dbg-close" onclick="toggleDebugMode(false)">✕</button>
    </div>
    <div class="dbg-perf" id="debugPerfLine">
      FPS: ${currentFps} | Max frame (3s): ${worstFrameMs}ms | SVG nodes: ${nodes.total} (T:${nodes.terrain} R:${nodes.roads} V:${nodes.vertices} O:${nodes.overlays})
    </div>
    <div class="dbg-sec">
      <div class="dbg-lbl">Quick Sandbox Grants</div>
      <div class="dbg-row">
        <button type="button" class="dbg-btn" onclick="sendDebugCmd('grantResources', { amount: 10 })">+10 All Res</button>
        <button type="button" class="dbg-btn" onclick="sendDebugCmd('grantFish', { amount: 5 })">+5 Fish</button>
        <button type="button" class="dbg-btn" onclick="sendDebugCmd('unlockAllTechs')">Unlock All Techs</button>
        <button type="button" class="dbg-btn" onclick="sendDebugCmd('audit')">Audit State</button>
        <button type="button" class="dbg-btn" onclick="sendDebugCmd('exportSnapshot')">Copy Repro JSON</button>
      </div>
    </div>
    <div class="dbg-sec">
      <div class="dbg-lbl">Force Dice Roll</div>
      <div class="dbg-row">
        ${[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
          .map(
            n =>
              `<button type="button" class="dbg-btn ${n === 7 ? 'dbg-warn' : ''}" onclick="sendDebugCmd('forceRoll', { sum: ${n} })">${n}</button>`
          )
          .join('')}
      </div>
    </div>
    <div class="dbg-sec">
      <div class="dbg-lbl">In-Game Board Brush (click H/V/E on board)</div>
      <div class="dbg-row">
        ${brushes
          .map(
            b =>
              `<button type="button" class="dbg-btn ${debugBrush === b.id ? 'on' : ''}" onclick="setDebugBrush('${b.id}')">${b.label}</button>`
          )
          .join('')}
      </div>
    </div>
    <div class="dbg-sec">
      <div class="dbg-lbl">Visual Overlays</div>
      <div class="dbg-row">
        <button type="button" class="dbg-btn ${debugShowIds ? 'on' : ''}" onclick="toggleDebugIds()">Show H/V/E IDs</button>
        <button type="button" class="dbg-btn ${debugStressHex ? 'on' : ''}" onclick="toggleDebugStressHex()">All-Icons Stress Test</button>
      </div>
    </div>
    <div class="dbg-sec">
      <div class="dbg-lbl">Invariant & Client-vs-Server Spot Audit</div>
      <div class="dbg-audit-box ${allIssues.length === 0 ? 'ok' : 'err'}">
        ${
          allIssues.length === 0
            ? `<div class="dbg-ok">✓ 0 invariant or spot-desync issues found</div>`
            : allIssues.map(iss => `<div class="dbg-err-item">⚠️ ${esc(iss)}</div>`).join('')
        }
        ${playerRows}
      </div>
    </div>
  `;
}

export function initDebugMode(): void {
  socket.on('debugReport', (data: any) => {
    if (data?.report) {
      lastAuditReport = data.report;
    }
    if (data?.message) {
      showToast(data.message);
    }
    if (data?.snapshot) {
      const json = JSON.stringify(data.snapshot, null, 2);
      navigator.clipboard?.writeText(json).catch(() => {});
      showToast('Copied debug repro snapshot JSON to clipboard!');
    }
    if (debugOpen) renderDebugHud();
  });

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === '`' || e.key === 'F2') {
      e.preventDefault();
      toggleDebugMode();
    }
  });

  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1') {
    toggleDebugMode(true);
  }
}
