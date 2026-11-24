// MODULE: 2D canvas board renderer (full-board static atlas + crisp vector zoom for terrain, coastlines, ports, fish, overlays, and frustum-culled build spots) | DEPENDS ON: none | USED BY: client/debug, client/render/board

export interface BoardBounds {
  centerX0: number;
  centerY0: number;
  contentW: number;
  contentH: number;
}

export interface CanvasCamera {
  scale: number;
  worldPerPx: number;
  tx: number;
  ty: number;
  visMinX: number;
  visMaxX: number;
  visMinY: number;
  visMaxY: number;
}

export interface TerrainHexLike {
  id: number;
  x: number;
  y: number;
  type: string;
  fog?: boolean;
  number?: number | null;
  tilePoly: string;
  rawPts?: string;
}

export interface CanvasPortLike {
  edgeId: number;
  v1x: number;
  v1y: number;
  v2x: number;
  v2y: number;
  hx: number;
  hy: number;
  port: string;
  owned: boolean;
  level: number;
  sx: number;
  sy: number;
}

export interface CanvasFishLike {
  hexId: number;
  fx: number;
  fy: number;
  left: number;
  hasIcon: boolean;
  tilePoly?: string;
}

export interface CanvasHexOverlayLike {
  hexId: number;
  x: number;
  y: number;
  innerPoly: string;
  kind: string;
  label?: string;
}

export interface CanvasVertexSpot {
  vertexId: number;
  x: number;
  y: number;
  kind: 'direct' | 'menu';
  dim?: boolean;
}

export interface CanvasEdgeSpot {
  edgeId: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  mx: number;
  my: number;
  kind: 'direct' | 'menu' | 'bridge_upgrade';
  dim?: boolean;
}

export interface CanvasPortSpot {
  edgeId: number;
  sx: number;
  sy: number;
  kind: 'paint' | 'harbor' | 'upgrade_port' | 'menu';
  vertexId?: number;
  dim?: boolean;
}

export interface CanvasFeedSpot {
  hexId: number;
  fx: number;
  fy: number;
  isNew?: boolean;
}

export interface CanvasHexSpot {
  hexId: number;
  x: number;
  y: number;
  innerPoly: string;
  kind: 'robber' | 'net' | 'rolled' | 'menu';
  dim?: boolean;
}

export interface CanvasInteractiveSpots {
  vertices?: ReadonlyArray<CanvasVertexSpot>;
  edges?: ReadonlyArray<CanvasEdgeSpot>;
  ports?: ReadonlyArray<CanvasPortSpot>;
  feeds?: ReadonlyArray<CanvasFeedSpot>;
  hexes?: ReadonlyArray<CanvasHexSpot>;
  roadScale?: number;
}

export interface TerrainCanvasDrawInput {
  hexes: TerrainHexLike[];
  landPath: string;
  waterPath: string;
  isLobby: boolean;
  canPaintHex: boolean;
  bounds: BoardBounds;
  camZoom: number;
  camPanX: number;
  camPanY: number;
  animatingFogHexIds?: ReadonlySet<number>;
  staticVersion?: number;
  ports?: ReadonlyArray<CanvasPortLike>;
  fishGrounds?: ReadonlyArray<CanvasFishLike>;
  hexOverlays?: ReadonlyArray<CanvasHexOverlayLike>;
  interactiveSpots?: CanvasInteractiveSpots | null;
}

export interface TerrainCanvasStats {
  lastDrawMs: number;
  visibleHexes: number;
  totalHexes: number;
  drawCount: number;
}

const DEFAULT_HEX_CULL_PAD = 76;

/**
 * Computes the exact 2D canvas affine transform (`scale`, `tx`, `ty`) and world-space culling box
 * that matches `<svg preserveAspectRatio="xMidYMid meet">` for a given viewBox and viewport size.
 */
export function computeCanvasCamera(
  bounds: BoardBounds,
  camZoom: number,
  camPanX: number,
  camPanY: number,
  viewW: number,
  viewH: number,
  padWorld: number = DEFAULT_HEX_CULL_PAD
): CanvasCamera {
  const safeW = Math.max(1, viewW);
  const safeH = Math.max(1, viewH);
  const safeZoom = Math.max(0.001, camZoom);
  const baseW = Math.max(1, bounds.contentW * safeZoom);
  const baseH = Math.max(1, bounds.contentH * safeZoom);
  const scale = Math.min(safeW / baseW, safeH / baseH);
  const worldPerPx = 1 / scale;

  // Center of the SVG viewBox in world coordinates:
  // baseX + baseW/2 = (centerX0 - camPanX - baseW/2) + baseW/2 = centerX0 - camPanX
  const cx = bounds.centerX0 - camPanX;
  const cy = bounds.centerY0 - camPanY;

  const tx = safeW / 2 - cx * scale;
  const ty = safeH / 2 - cy * scale;

  const halfVisW = (safeW / 2) * worldPerPx;
  const halfVisH = (safeH / 2) * worldPerPx;

  return {
    scale,
    worldPerPx,
    tx,
    ty,
    visMinX: cx - halfVisW - padWorld,
    visMaxX: cx + halfVisW + padWorld,
    visMinY: cy - halfVisH - padWorld,
    visMaxY: cy + halfVisH + padWorld
  };
}

/** Fast AABB check for whether a hex centered at `(hx, hy)` overlaps the visible camera frustum. */
export function isHexVisible(hx: number, hy: number, cam: CanvasCamera): boolean {
  return hx >= cam.visMinX && hx <= cam.visMaxX && hy >= cam.visMinY && hy <= cam.visMaxY;
}

/** Converts viewport-local CSS pixels `(px, py)` into board world coordinates `(wx, wy)`. */
export function screenToWorld(px: number, py: number, cam: CanvasCamera): { x: number; y: number } {
  return {
    x: (px - cam.tx) * cam.worldPerPx,
    y: (py - cam.ty) * cam.worldPerPx
  };
}

/** Parses an SVG polygon `points="x1,y1 x2,y2 ..."` string into an array of `[x, y]` pairs. */
export function parsePolyPoints(tilePoly: string): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const parts = tilePoly.trim().split(/\s+/);
  for (const part of parts) {
    if (!part) continue;
    const comma = part.indexOf(',');
    if (comma === -1) continue;
    const x = Number(part.slice(0, comma));
    const y = Number(part.slice(comma + 1));
    if (Number.isFinite(x) && Number.isFinite(y)) {
      pts.push([x, y]);
    }
  }
  return pts;
}

/** Ray-casting point-in-polygon test in board world coordinates. */
export function pointInPolygon(wx: number, wy: number, corners: ReadonlyArray<[number, number]>): boolean {
  const n = corners.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = corners[i][0];
    const yi = corners[i][1];
    const xj = corners[j][0];
    const yj = corners[j][1];
    const intersects = yi > wy !== yj > wy && wx < ((xj - xi) * (wy - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

const polyCornersCache = new Map<string, Array<[number, number]>>();

function getCachedCorners(polyStr: string): Array<[number, number]> {
  let pts = polyCornersCache.get(polyStr);
  if (!pts) {
    if (polyCornersCache.size > 6000) polyCornersCache.clear();
    pts = parsePolyPoints(polyStr);
    polyCornersCache.set(polyStr, pts);
  }
  return pts;
}

/**
 * Finds the hex ID containing world point `(wx, wy)` using a fast bounding-radius pre-check
 * followed by exact polygon containment. Returns `null` if no hex contains the point.
 */
export function findHexAtWorldPoint(
  wx: number,
  wy: number,
  hexes: ReadonlyArray<TerrainHexLike>,
  maxRadius: number = 62
): number | null {
  const maxR2 = maxRadius * maxRadius;
  let closestId: number | null = null;
  let closestD2 = Infinity;

  for (let i = 0; i < hexes.length; i++) {
    const h = hexes[i];
    const dx = wx - h.x;
    const dy = wy - h.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > maxR2) continue;
    const polyStr = h.rawPts || h.tilePoly;
    const corners = getCachedCorners(polyStr);
    if (corners.length >= 3 && pointInPolygon(wx, wy, corners)) {
      if (d2 < closestD2) {
        closestD2 = d2;
        closestId = h.id;
      }
    }
  }
  return closestId;
}

interface ThemePalette {
  themeKey: string;
  seaShallow: string;
  sand: string;
  pier: string;
  pierDark: string;
  accent: string;
  danger: string;
  pieceRim: string;
  ink: string;
  token: string;
  tokenInk: string;
  tokenHot: string;
  elev1: string;
  elev2: string;
  elev3: string;
  elevInk: string;
  ovFloodTint: string;
  ovFloodLine: string;
  ovFloodWarnTint: string;
  ovFloodWarnLine: string;
  tile: Record<string, string>;
  trim: Record<string, string>;
  glyph: {
    wood: string;
    brick: string;
    sheep: string;
    wool: string;
    wheat: string;
    ore: string;
    oreLt: string;
    oreDk: string;
    gold: string;
    desert: string;
    fog: string;
  };
}

let cachedPalette: ThemePalette | null = null;

function readThemePalette(): ThemePalette {
  const themeKey =
    (typeof document !== 'undefined' && document.documentElement?.dataset?.theme) || 'light';
  if (cachedPalette && cachedPalette.themeKey === themeKey) {
    return cachedPalette;
  }
  const style =
    typeof window !== 'undefined' && typeof document !== 'undefined'
      ? window.getComputedStyle(document.documentElement)
      : null;
  const css = (name: string, fallback: string): string => {
    const v = style?.getPropertyValue(name)?.trim();
    return v || fallback;
  };
  const isDark = themeKey === 'dark';

  cachedPalette = {
    themeKey,
    seaShallow: css('--sea-shallow', isDark ? '#5d8696' : '#86b0bf'),
    sand: css('--sand', isDark ? '#a8946a' : '#e8d9ab'),
    pier: css('--pier', isDark ? '#b08f63' : '#9a7b53'),
    pierDark: css('--pier-dark', isDark ? '#7a603e' : '#6e5434'),
    accent: css('--accent', '#d9893b'),
    danger: css('--danger', isDark ? '#e0604a' : '#c4472f'),
    pieceRim: css('--piece-rim', '#f4f1ea'),
    ink: css('--ink', isDark ? '#ece9e1' : '#2b2f33'),
    token: css('--token', '#f4f1ea'),
    tokenInk: css('--token-ink', '#2b2f33'),
    tokenHot: css('--token-hot', '#b3402e'),
    elev1: css('--elev-1', isDark ? 'rgba(214, 116, 44, 0.76)' : 'rgba(236, 132, 52, 0.80)'),
    elev2: css('--elev-2', isDark ? 'rgba(170, 168, 58, 0.78)' : 'rgba(190, 186, 62, 0.82)'),
    elev3: css('--elev-3', isDark ? 'rgba(50, 132, 72, 0.84)' : 'rgba(58, 150, 82, 0.86)'),
    elevInk: css('--elev-ink', isDark ? '#f4f1ea' : '#ffffff'),
    ovFloodTint: css('--ov-flood-tint', isDark ? 'rgba(18, 54, 102, 0.62)' : 'rgba(21, 62, 112, 0.56)'),
    ovFloodLine: css('--ov-flood-line', isDark ? 'rgba(186, 230, 253, 0.95)' : 'rgba(186, 230, 253, 0.92)'),
    ovFloodWarnTint: css('--ov-flood-warn-tint', isDark ? 'rgba(29, 78, 137, 0.34)' : 'rgba(29, 78, 137, 0.30)'),
    ovFloodWarnLine: css('--ov-flood-warn-line', isDark ? 'rgba(168, 222, 245, 0.90)' : 'rgba(33, 92, 140, 0.85)'),
    tile: {
      wood: css('--tile-wood', '#5f8a5a'),
      brick: css('--tile-brick', '#c0674a'),
      sheep: css('--tile-sheep', '#a9c27a'),
      wheat: css('--tile-wheat', '#e2c56b'),
      ore: css('--tile-ore', '#8d98a3'),
      desert: css('--tile-desert', '#d9c9a0'),
      gold: css('--tile-gold', '#d9a441'),
      fog: css('--tile-fog', '#c9d1d6')
    },
    trim: {
      wood: css('--trim-wood', '#42663e'),
      brick: css('--trim-brick', '#94462e'),
      sheep: css('--trim-sheep', '#7c944e'),
      wheat: css('--trim-wheat', '#b59538'),
      ore: css('--trim-ore', '#626d78'),
      desert: css('--trim-desert', '#b09c70'),
      gold: css('--trim-gold', '#a6761c'),
      fog: css('--trim-fog', '#98a3ab')
    },
    glyph: {
      wood: css('--glyph-wood', '#3d6240'),
      brick: css('--glyph-brick', '#8c3f28'),
      sheep: css('--glyph-sheep', '#4a5a2e'),
      wool: css('--glyph-wool', '#f4f1ea'),
      wheat: css('--glyph-wheat', '#9a7420'),
      ore: css('--glyph-ore', '#5b6670'),
      oreLt: css('--glyph-ore-lt', '#a2acb5'),
      oreDk: css('--glyph-ore-dk', '#454e56'),
      gold: css('--glyph-gold', '#8f6416'),
      desert: css('--glyph-desert', '#6f8f55'),
      fog: css('--glyph-fog', '#8f9ba3')
    }
  };
  return cachedPalette;
}

// Cached Path2D geometry so neither coastline paths nor hex polygons are re-parsed during pans/zooms
let cachedLandPathStr = '';
let cachedLandPath2D: Path2D | null = null;
let cachedWaterPathStr = '';
let cachedWaterPath2D: Path2D | null = null;
const hexPolyPathCache = new Map<string, Path2D>();

function getHexPolyPath2D(tilePoly: string): Path2D | null {
  if (typeof Path2D === 'undefined') return null;
  let path = hexPolyPathCache.get(tilePoly);
  if (!path) {
    if (hexPolyPathCache.size > 6000) hexPolyPathCache.clear();
    const d = 'M ' + tilePoly.trim().replace(/\s+/g, ' L ') + ' Z';
    path = new Path2D(d);
    hexPolyPathCache.set(tilePoly, path);
  }
  return path;
}

// Cached Path2D primitives matching GLYPHS in src/client/icons.ts (centered on 0,0 in a 28x28 box)
interface GlyphPaths {
  wood: Path2D;
  wheatStem: Path2D;
  oreBase: Path2D;
  oreLt: Path2D;
  oreDk: Path2D;
  goldIngots: Path2D;
  goldSpark: Path2D;
  fishTail: Path2D;
  floodWaves: Path2D;
}

let glyphPaths: GlyphPaths | null = null;

function getGlyphPaths(): GlyphPaths | null {
  if (typeof Path2D === 'undefined') return null;
  if (glyphPaths) return glyphPaths;
  glyphPaths = {
    wood: new Path2D(
      'M0,-14 L-6,-5 L-3,-5 L-8,2 L-4,2 L-10,10 L-1.8,10 L-1.8,14 L1.8,14 L1.8,10 L10,10 L4,2 L8,2 L3,-5 L6,-5 Z'
    ),
    wheatStem: new Path2D('M0,13 L0,-3'),
    oreBase: new Path2D('M-13,10 L-10,-2 L-3,-9 L5,-10 L12,-2 L13,10 Z'),
    oreLt: new Path2D('M-10,-2 L-3,-9 L5,-10 L1,0 L-6,2 Z'),
    oreDk: new Path2D('M5,-10 L12,-2 L13,10 L4,10 L1,0 Z'),
    goldIngots: new Path2D(
      'M-13,11 L-10,5 L-1,5 L-3,11 Z M0,11 L2,5 L11,5 L13,11 Z M-6.5,4 L-4,-2 L4,-2 L6.5,4 Z'
    ),
    goldSpark: new Path2D('M9,-13 L10.2,-9.2 L14,-8 L10.2,-6.8 L9,-3 L7.8,-6.8 L4,-8 L7.8,-9.2 Z'),
    fishTail: new Path2D('M6,0 L13.5,-6.5 L13.5,6.5 Z'),
    floodWaves: new Path2D(
      'M-26,-10 Q-13,-20 0,-10 Q13,-20 26,-10 M-34,4 Q-17,-8 0,4 Q17,-8 34,4 M-26,18 Q-13,8 0,18 Q13,8 26,18'
    )
  };
  return glyphPaths;
}

function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
  ctx.fill();
}

function fillCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function fillEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotDeg = 0
): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, (rotDeg * Math.PI) / 180, 0, Math.PI * 2);
  ctx.fill();
}

/** Draws a flat pictogram glyph centered at `(cx, cy)` with `scale` (matching `src/client/icons.ts`). */
function drawGlyphAt(
  ctx: CanvasRenderingContext2D,
  tileType: string,
  cx: number,
  cy: number,
  iconScale: number,
  pal: ThemePalette
): void {
  const gp = getGlyphPaths();
  if (!gp) return;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(iconScale, iconScale);

  switch (tileType) {
    case 'wood': {
      ctx.fillStyle = pal.glyph.wood;
      ctx.fill(gp.wood);
      break;
    }
    case 'brick': {
      ctx.fillStyle = pal.glyph.brick;
      fillRoundRect(ctx, -13, -11, 12, 6, 1);
      fillRoundRect(ctx, 1, -11, 12, 6, 1);
      fillRoundRect(ctx, -13, -4, 7, 6, 1);
      fillRoundRect(ctx, -4, -4, 8, 6, 1);
      fillRoundRect(ctx, 6, -4, 7, 6, 1);
      fillRoundRect(ctx, -13, 3, 12, 6, 1);
      fillRoundRect(ctx, 1, 3, 12, 6, 1);
      break;
    }
    case 'sheep': {
      ctx.fillStyle = pal.glyph.sheep;
      fillRoundRect(ctx, -6.5, 6, 2.4, 6.5, 1);
      fillRoundRect(ctx, 2.5, 6, 2.4, 6.5, 1);
      fillEllipse(ctx, 11, -1.5, 3.6, 3.2);
      ctx.fillStyle = pal.glyph.wool;
      fillCircle(ctx, -6, 0, 5.6);
      fillCircle(ctx, -0.5, -4, 6.4);
      fillCircle(ctx, 5, -1, 5.4);
      fillCircle(ctx, -2, 3.4, 5.6);
      fillCircle(ctx, 3.5, 3.6, 4.8);
      break;
    }
    case 'wheat': {
      ctx.strokeStyle = pal.glyph.wheat;
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      ctx.stroke(gp.wheatStem);
      ctx.fillStyle = pal.glyph.wheat;
      fillEllipse(ctx, 0, -9, 2.6, 4.6);
      fillEllipse(ctx, -4.6, -3.5, 2.5, 4.4, -28);
      fillEllipse(ctx, 4.6, -3.5, 2.5, 4.4, 28);
      fillEllipse(ctx, -4.6, 3.5, 2.5, 4.4, -28);
      fillEllipse(ctx, 4.6, 3.5, 2.5, 4.4, 28);
      break;
    }
    case 'ore': {
      ctx.fillStyle = pal.glyph.ore;
      ctx.fill(gp.oreBase);
      ctx.fillStyle = pal.glyph.oreLt;
      ctx.fill(gp.oreLt);
      ctx.fillStyle = pal.glyph.oreDk;
      ctx.fill(gp.oreDk);
      break;
    }
    case 'gold': {
      ctx.fillStyle = pal.glyph.gold;
      ctx.fill(gp.goldIngots);
      ctx.fillStyle = pal.glyph.wool;
      ctx.fill(gp.goldSpark);
      break;
    }
    case 'desert': {
      ctx.fillStyle = pal.glyph.desert;
      fillRoundRect(ctx, -2.8, -12, 5.6, 25, 2.8);
      fillRoundRect(ctx, -9, -1, 8, 4.4, 2.2);
      fillRoundRect(ctx, -9, -8, 4.4, 11, 2.2);
      fillRoundRect(ctx, 1, -5, 8, 4.4, 2.2);
      fillRoundRect(ctx, 4.6, -11, 4.4, 10, 2.2);
      break;
    }
    case 'fog': {
      ctx.fillStyle = pal.glyph.fog;
      fillCircle(ctx, -5.5, 0.5, 5.2);
      fillCircle(ctx, 1, -4.5, 6.8);
      fillCircle(ctx, 7.5, 0, 5);
      ctx.fillRect(-10.5, 0, 23, 5.5);
      fillRoundRect(ctx, -9, 8.4, 15, 2.4, 1.2);
      fillRoundRect(ctx, -3, 12, 12, 2.4, 1.2);
      break;
    }
  }

  ctx.restore();
}

/** Draws the exact pictogram from `src/client/icons.ts` (`getBoardIconSvg(tileType, 0, hasNumber ? -24 : 0, hasNumber ? 1.45 : 1.9)`). */
function drawTerrainGlyph(
  ctx: CanvasRenderingContext2D,
  tileType: string,
  hx: number,
  hy: number,
  hasNumber: boolean,
  pal: ThemePalette
): void {
  drawGlyphAt(ctx, tileType, hx, hy + (hasNumber ? -24 : 0), hasNumber ? 1.45 : 1.9, pal);
}

/** Draws the exact number token from `tokenMarkup(n)` in `src/client/render/board.ts`. */
function drawNumberToken(
  ctx: CanvasRenderingContext2D,
  hx: number,
  hy: number,
  num: number,
  pal: ThemePalette
): void {
  const hot = num === 6 || num === 8;
  const ty = hy + 22;

  ctx.beginPath();
  ctx.arc(hx, ty, 19, 0, Math.PI * 2);
  ctx.fillStyle = pal.token;
  ctx.fill();

  ctx.fillStyle = hot ? pal.tokenHot : pal.tokenInk;
  ctx.font = '700 22px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(num), hx, ty + 8);
}

/** Draws a flat anchor icon (matching `uiIcon('harbor', 20)`) for upgraded 1:1 harbors. */
function drawHarborAnchor(ctx: CanvasRenderingContext2D, sx: number, sy: number, color: string): void {
  ctx.save();
  ctx.translate(sx, sy - 7);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(0, -5.5, 2.2, 0, Math.PI * 2);
  ctx.moveTo(0, -3.3);
  ctx.lineTo(0, 6.2);
  ctx.moveTo(-4, -1);
  ctx.lineTo(4, -1);
  ctx.moveTo(-6.2, 2.2);
  ctx.quadraticCurveTo(-5, 6.5, 0, 6.5);
  ctx.quadraticCurveTo(5, 6.5, 6.2, 2.2);
  ctx.stroke();
  ctx.restore();
}

/** Draws a single coastal port dock + badge (matching `portMarkup` in `src/client/render/board.ts`). */
function drawPort(ctx: CanvasRenderingContext2D, p: CanvasPortLike, pal: ThemePalette): void {
  const mx = (p.v1x + p.v2x) / 2;
  const my = (p.v1y + p.v2y) / 2;
  const dx = mx - p.hx;
  const dy = my - p.hy;
  const nLen = Math.hypot(dx, dy) || 1;
  const nx = dx / nLen;
  const ny = dy / nLen;

  const ex = p.v2x - p.v1x;
  const ey = p.v2y - p.v1y;
  const eLen = Math.hypot(ex, ey) || 1;
  const tx = ex / eLen;
  const ty = ey / eLen;

  const D0 = -4.5;
  const D1 = 35;
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

  // Dock apron
  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = pal.pierDark;
  ctx.beginPath();
  ctx.moveTo(b1x, b1y);
  ctx.lineTo(b2x, b2y);
  ctx.lineTo(t2x, t2y);
  ctx.lineTo(t1x, t1y);
  ctx.closePath();
  ctx.fill();

  // Cross-planks
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = pal.pierDark;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const d of [7, 16, 25]) {
    const f = (d - D0) / (D1 - D0);
    const halfW = hw0 * (1 - f) + hw1 * f;
    const px = mx + nx * d;
    const py = my + ny * d;
    ctx.moveTo(px - tx * halfW, py - ty * halfW);
    ctx.lineTo(px + tx * halfW, py + ty * halfW);
  }
  ctx.stroke();

  // Pier rims & wood planks
  ctx.globalAlpha = 1;
  ctx.strokeStyle = pal.pierDark;
  ctx.lineWidth = 11;
  ctx.beginPath();
  ctx.moveTo(b1x, b1y);
  ctx.lineTo(t1x, t1y);
  ctx.moveTo(b2x, b2y);
  ctx.lineTo(t2x, t2y);
  ctx.stroke();

  ctx.strokeStyle = pal.pier;
  ctx.lineWidth = 6.5;
  ctx.beginPath();
  ctx.moveTo(b1x, b1y);
  ctx.lineTo(t1x, t1y);
  ctx.moveTo(b2x, b2y);
  ctx.lineTo(t2x, t2y);
  ctx.stroke();

  // Posts
  ctx.fillStyle = pal.pier;
  ctx.strokeStyle = pal.pierDark;
  ctx.lineWidth = 2;
  for (const [px, py] of [[b1x, b1y], [b2x, b2y]]) {
    ctx.beginPath();
    ctx.arc(px, py, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  const sx = p.sx;
  const sy = p.sy;
  const any = p.port === '3:1';
  const isHarborPort = p.level >= 2;
  const ratioText = p.level >= 2 ? '1:1' : p.level === 1 || !any ? '2:1' : '3:1';

  // Ownership ring
  if (p.owned) {
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(sx, sy, 24, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Outer badge rim
  ctx.fillStyle = isHarborPort ? pal.accent : pal.pierDark;
  ctx.strokeStyle = pal.pieceRim;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(sx, sy, 21, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Inner badge fill
  const badgeFill = isHarborPort ? pal.pierDark : any ? pal.token : (pal.tile[p.port] || pal.token);
  const badgeBorder = isHarborPort ? pal.accent : any ? pal.pierDark : (pal.trim[p.port] || pal.pierDark);
  ctx.fillStyle = badgeFill;
  ctx.strokeStyle = badgeBorder;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(sx, sy, 17.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Badge label / glyph
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  if (isHarborPort) {
    drawHarborAnchor(ctx, sx, sy, pal.token);
    ctx.fillStyle = pal.token;
    ctx.strokeStyle = pal.pierDark;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(sx - 13, sy + 5, 26, 12, 6);
    else ctx.rect(sx - 13, sy + 5, 26, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = pal.tokenInk;
    ctx.font = '800 8.8px system-ui, -apple-system, sans-serif';
    ctx.fillText(ratioText, sx, sy + 14);
  } else if (any) {
    ctx.fillStyle = pal.tokenInk;
    ctx.font = '800 13px system-ui, -apple-system, sans-serif';
    ctx.fillText(ratioText, sx, sy + 4.5);
  } else {
    drawGlyphAt(ctx, p.port, sx, sy - 4.5, 0.56, pal);
    ctx.fillStyle = pal.token;
    ctx.strokeStyle = pal.pierDark;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(sx - 13, sy + 5, 26, 12, 6);
    else ctx.rect(sx - 13, sy + 5, 26, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = pal.tokenInk;
    ctx.font = '800 8.8px system-ui, -apple-system, sans-serif';
    ctx.fillText(ratioText, sx, sy + 14);
  }
  ctx.restore();
}

/** Draws a Tidebound fishing ground tile outline + pictogram + boost pips (matching `fishGroundMarkup`). */
function drawFishGround(ctx: CanvasRenderingContext2D, f: CanvasFishLike, pal: ThemePalette): void {
  const gp = getGlyphPaths();
  if (!gp) return;

  if (f.hasIcon && f.tilePoly) {
    const poly = getHexPolyPath2D(f.tilePoly);
    if (poly) {
      ctx.save();
      ctx.strokeStyle = pal.token;
      ctx.lineWidth = 3.5;
      ctx.lineJoin = 'round';
      ctx.stroke(poly);
      ctx.restore();
    }
  }

  const n = Math.max(0, Math.min(4, Math.round(f.left)));
  const spent = n <= 0;

  ctx.save();
  ctx.translate(f.fx, f.fy);
  ctx.scale(1.25, 1.25);
  ctx.globalAlpha = !f.hasIcon ? 0.6 : spent ? 0.55 : 0.92;

  // Fish body & tail
  ctx.save();
  ctx.translate(0, -3);
  if (spent) {
    ctx.strokeStyle = pal.token;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.ellipse(-2, 0, 9.5, 6.2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.stroke(gp.fishTail);
    ctx.setLineDash([]);
    ctx.fillStyle = pal.token;
    fillCircle(ctx, -6.5, -1.6, 1.5);
  } else {
    ctx.fillStyle = pal.token;
    fillEllipse(ctx, -2, 0, 9.5, 6.2);
    ctx.fill(gp.fishTail);
    ctx.fillStyle = pal.tokenInk;
    fillCircle(ctx, -6.5, -1.6, 1.5);
  }
  ctx.restore();

  // 4 boost pips
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = pal.token;
  ctx.fillStyle = pal.token;
  for (let i = 0; i < 4; i++) {
    const px = (i - 1.5) * 7;
    ctx.beginPath();
    ctx.arc(px, 11, 2.4, 0, Math.PI * 2);
    if (i < n) ctx.fill();
    else ctx.stroke();
  }
  ctx.restore();
}

/** Draws a single colorblind-safe hex overlay (Tidebound flood/warning/drowned, elevation heat map, or base overlays). */
function drawHexOverlay(ctx: CanvasRenderingContext2D, ov: CanvasHexOverlayLike, pal: ThemePalette): void {
  const poly = getHexPolyPath2D(ov.innerPoly);
  if (!poly) return;

  ctx.save();
  if (ov.kind === 'elev-1' || ov.kind === 'elev-2' || ov.kind === 'elev-3') {
    const level = ov.kind === 'elev-3' ? 3 : ov.kind === 'elev-2' ? 2 : 1;
    ctx.fillStyle = level === 3 ? pal.elev3 : level === 2 ? pal.elev2 : pal.elev1;
    ctx.fill(poly);
    ctx.font = '800 14px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillStyle = pal.elevInk;
    const txt = '\u25B2'.repeat(level);
    ctx.strokeText(txt, ov.x, ov.y + 46);
    ctx.fillText(txt, ov.x, ov.y + 46);
    ctx.restore();
    return;
  }

  const gp = getGlyphPaths();
  const isFlood = ov.kind === 'flood';
  const isWarn = ov.kind === 'flood-warn';

  // Clip to hex inner polygon
  ctx.clip(poly);
  if (isFlood || isWarn) {
    ctx.fillStyle = isFlood ? pal.ovFloodTint : pal.ovFloodWarnTint;
    ctx.fill(poly);

    ctx.save();
    ctx.translate(ov.x, ov.y);
    ctx.scale(0.86, 0.86);
    const lineColor = isFlood ? pal.ovFloodLine : pal.ovFloodWarnLine;
    ctx.fillStyle = lineColor;
    ctx.globalAlpha = isFlood ? 0.12 : 0.08;
    fillCircle(ctx, 0, 0, 40);
    if (isFlood) {
      ctx.globalAlpha = 0.14;
      fillCircle(ctx, 0, 0, 24);
    }
    if (gp) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = isFlood ? 3.4 : 3.0;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (isWarn) ctx.setLineDash([8, 6]);
      ctx.stroke(gp.floodWaves);
      if (isWarn) ctx.setLineDash([]);
    }
    ctx.restore();
  } else if (ov.kind === 'zone-closed' || ov.kind === 'zone-open') {
    // Bulwark walled zone: a calm stone tint with upright stakes (dashed while its gate stands open).
    const open = ov.kind === 'zone-open';
    ctx.fillStyle = open ? 'rgba(120, 104, 84, 0.10)' : 'rgba(120, 104, 84, 0.16)';
    ctx.fill(poly);
    ctx.strokeStyle = 'rgba(92, 70, 46, 0.42)';
    ctx.lineWidth = 1.6;
    if (open) ctx.setLineDash([6, 6]);
    ctx.beginPath();
    for (let offset = -48; offset <= 48; offset += 16) {
      ctx.moveTo(ov.x + offset, ov.y - 50);
      ctx.lineTo(ov.x + offset, ov.y + 50);
    }
    ctx.stroke();
    if (open) ctx.setLineDash([]);
  } else {
    // Fallback tint + diagonal stripe for any other overlay kind (plague, crack, wave, etc.)
    ctx.fillStyle =
      ov.kind === 'wall-incomplete'
        ? 'rgba(196, 71, 47, 0.22)'
        : ov.kind === 'plague'
          ? 'rgba(79, 138, 74, 0.24)'
          : 'rgba(217, 137, 59, 0.22)';
    ctx.fill(poly);
    ctx.strokeStyle =
      ov.kind === 'wall-incomplete'
        ? '#c4472f'
        : ov.kind === 'plague'
          ? '#3f743b'
          : '#d9893b';
    ctx.lineWidth = 2.4;
    ctx.globalAlpha = 0.72;
    ctx.beginPath();
    for (let offset = -60; offset <= 60; offset += 16) {
      ctx.moveTo(ov.x + offset - 50, ov.y - 50);
      ctx.lineTo(ov.x + offset + 50, ov.y + 50);
    }
    ctx.stroke();
  }

  ctx.restore();

  if (ov.label) {
    ctx.save();
    ctx.font = '800 8.5px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 2.6;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = pal.token;
    ctx.fillStyle = pal.tokenInk;
    ctx.strokeText(ov.label, ov.x, ov.y + 44);
    ctx.fillText(ov.label, ov.x, ov.y + 44);
    ctx.restore();
  }
}

/** Draws frustum-culled interactive spots on top of the terrain/atlas layer (<0.25ms even for 3,000+ spots). */
function drawInteractiveSpots(
  ctx: CanvasRenderingContext2D,
  spots: CanvasInteractiveSpots,
  pal: ThemePalette,
  cam: CanvasCamera
): void {
  const roadScale = spots.roadScale ?? 1;

  // 1. Hex targets (rolled dimming, robber move targets, net spots, menu hex dots)
  if (spots.hexes && spots.hexes.length > 0) {
    for (let i = 0; i < spots.hexes.length; i++) {
      const hs = spots.hexes[i];
      if (!isHexVisible(hs.x, hs.y, cam)) continue;
      if (hs.kind === 'menu') {
        ctx.save();
        ctx.globalAlpha = hs.dim ? 0.4 : 0.9;
        ctx.fillStyle = pal.accent;
        ctx.strokeStyle = pal.pieceRim;
        ctx.lineWidth = 2.5 * roadScale;
        ctx.beginPath();
        ctx.arc(hs.x, hs.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        continue;
      }
      const poly = getHexPolyPath2D(hs.innerPoly);
      if (!poly) continue;
      ctx.save();
      if (hs.kind === 'rolled') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
        ctx.fill(poly);
      } else if (hs.kind === 'robber') {
        ctx.fillStyle = pal.danger;
        ctx.globalAlpha = 0.24;
        ctx.fill(poly);
        ctx.globalAlpha = 0.82;
        ctx.strokeStyle = pal.danger;
        ctx.lineWidth = 3.5;
        ctx.lineJoin = 'round';
        ctx.stroke(poly);
      } else if (hs.kind === 'net') {
        ctx.fillStyle = pal.accent;
        ctx.globalAlpha = 0.16;
        ctx.fill(poly);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.setLineDash([9, 6]);
        ctx.stroke(poly);
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
  }

  // 2. Feed-the-sea rings
  if (spots.feeds && spots.feeds.length > 0) {
    ctx.save();
    for (let i = 0; i < spots.feeds.length; i++) {
      const f = spots.feeds[i];
      if (!isHexVisible(f.fx, f.fy, cam)) continue;
      ctx.fillStyle = pal.accent;
      ctx.globalAlpha = 0.18;
      fillCircle(ctx, f.fx, f.fy, 30);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(f.fx, f.fy, 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // 3. Port spots (lobby port-paint dots + harbor / port-raise rings)
  if (spots.ports && spots.ports.length > 0) {
    ctx.save();
    for (let i = 0; i < spots.ports.length; i++) {
      const ps = spots.ports[i];
      if (!isHexVisible(ps.sx, ps.sy, cam)) continue;
      if (ps.kind === 'paint') {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ps.sx, ps.sy, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.globalAlpha = ps.dim ? 0.35 : 0.9;
        ctx.fillStyle = pal.accent;
        ctx.beginPath();
        ctx.arc(ps.sx, ps.sy, 26, 0, Math.PI * 2);
        ctx.save();
        ctx.globalAlpha = ps.dim ? 0.14 : 0.32;
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // 4. Edge spots (road/bridge build spots + rickety bridge upgrade dots)
  if (spots.edges && spots.edges.length > 0) {
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0; i < spots.edges.length; i++) {
      const es = spots.edges[i];
      if (!isHexVisible(es.mx, es.my, cam)) continue;
      if (es.kind === 'bridge_upgrade') {
        ctx.fillStyle = pal.accent;
        ctx.strokeStyle = pal.pieceRim;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.arc(es.mx, es.my, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        continue;
      }
      ctx.globalAlpha = es.dim ? 0.22 : 0.42;
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 12 * roadScale;
      ctx.beginPath();
      ctx.moveTo(es.x1, es.y1);
      ctx.lineTo(es.x2, es.y2);
      ctx.stroke();

      ctx.globalAlpha = es.dim ? 0.4 : es.kind === 'menu' ? 0.72 : 0.95;
      ctx.fillStyle = pal.accent;
      ctx.strokeStyle = pal.pieceRim;
      ctx.lineWidth = 2.6 * roadScale;
      ctx.beginPath();
      ctx.arc(es.mx, es.my, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // 5. Vertex spots (setup settlement spots, main build spots, build-menu vertex hotspots)
  if (spots.vertices && spots.vertices.length > 0) {
    ctx.save();
    // Keep vertex dots legible when zoomed far out on radius 10-20 boards without inflating into overlaps
    const dotR = Math.max(9.5, Math.min(13.5, 4.6 * cam.worldPerPx));
    const strokeW = Math.max(2.4, dotR * 0.24);
    ctx.lineWidth = strokeW;
    ctx.strokeStyle = pal.pieceRim;
    ctx.fillStyle = pal.accent;
    for (let i = 0; i < spots.vertices.length; i++) {
      const vs = spots.vertices[i];
      if (!isHexVisible(vs.x, vs.y, cam)) continue;
      ctx.globalAlpha = vs.dim ? 0.36 : vs.kind === 'menu' ? 0.62 : 0.92;
      ctx.beginPath();
      ctx.arc(vs.x, vs.y, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

let lastInput: TerrainCanvasDrawInput | null = null;
let observersAttached = false;
let cachedViewW = 0;
let cachedViewH = 0;

// Full-board pre-rendered offscreen atlas (ZERO chunks, ZERO pop-in) for fast zoomed-out pan/zoom (<0.2ms/frame)
let atlasCanvas: HTMLCanvasElement | null = null;
let atlasKey = '';
let atlasWorldX = 0;
let atlasWorldY = 0;
let atlasWorldW = 1;
let atlasWorldH = 1;
let atlasScaleUsed = 1;
let atlasTotalLandCount = 0;

const stats: TerrainCanvasStats = {
  lastDrawMs: 0,
  visibleHexes: 0,
  totalHexes: 0,
  drawCount: 0
};

export function getTerrainCanvasStats(): TerrainCanvasStats {
  return stats;
}

function ensureCanvasElement(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  let canvas = document.getElementById('boardTerrainCanvas') as HTMLCanvasElement | null;
  if (!canvas) {
    const pan = document.getElementById('boardPan');
    const svg = document.getElementById('boardSvg');
    if (!pan) return null;
    canvas = document.createElement('canvas');
    canvas.id = 'boardTerrainCanvas';
    canvas.className = 'board-terrain-canvas';
    pan.insertBefore(canvas, svg || pan.firstChild);
    cachedViewW = 0;
    cachedViewH = 0;
  }
  if (!observersAttached && typeof window !== 'undefined') {
    observersAttached = true;
    window.addEventListener('resize', () => {
      cachedViewW = 0;
      cachedViewH = 0;
      if (lastInput) drawBoardTerrainCanvas(lastInput);
    });
    if (typeof MutationObserver !== 'undefined' && document.documentElement) {
      const mo = new MutationObserver(() => {
        cachedPalette = null;
        atlasKey = '';
        if (lastInput) drawBoardTerrainCanvas(lastInput);
      });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
  }
  return canvas;
}

function renderStaticSceneToContext(
  ctx: CanvasRenderingContext2D,
  input: TerrainCanvasDrawInput,
  pal: ThemePalette,
  cam: CanvasCamera | null
): { visibleCount: number; totalLandCount: number } {
  // 1. Coastline shallow water & sand halo
  if (typeof Path2D !== 'undefined' && input.landPath) {
    if (input.landPath !== cachedLandPathStr) {
      cachedLandPathStr = input.landPath;
      cachedLandPath2D = new Path2D(input.landPath);
    }
    if (cachedLandPath2D) {
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.fillStyle = pal.seaShallow;
      ctx.strokeStyle = pal.seaShallow;
      ctx.lineWidth = 46;
      ctx.fill(cachedLandPath2D);
      ctx.stroke(cachedLandPath2D);

      ctx.fillStyle = pal.sand;
      ctx.strokeStyle = pal.sand;
      ctx.lineWidth = 16;
      ctx.fill(cachedLandPath2D);
      ctx.stroke(cachedLandPath2D);
      ctx.restore();
    }
  }

  // 2. Lobby water cells grid
  if (typeof Path2D !== 'undefined' && input.isLobby && input.waterPath) {
    if (input.waterPath !== cachedWaterPathStr) {
      cachedWaterPathStr = input.waterPath;
      cachedWaterPath2D = new Path2D(input.waterPath);
    }
    if (cachedWaterPath2D) {
      ctx.save();
      ctx.fillStyle = input.canPaintHex ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.06)';
      ctx.strokeStyle = input.canPaintHex ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.24)';
      ctx.lineWidth = input.canPaintHex ? 2 : 1.6;
      ctx.lineJoin = 'round';
      ctx.fill(cachedWaterPath2D);
      ctx.stroke(cachedWaterPath2D);
      ctx.restore();
    }
  }

  // 3. Land/fog hexes, resource pictograms, and number tokens
  let visibleCount = 0;
  let totalLandCount = 0;
  const { hexes, animatingFogHexIds } = input;

  for (let i = 0; i < hexes.length; i++) {
    const h = hexes[i];
    if (h.type === 'water') continue;
    totalLandCount++;

    if (cam && !isHexVisible(h.x, h.y, cam)) continue;
    visibleCount++;

    const polyPath = getHexPolyPath2D(h.tilePoly);
    if (!polyPath) continue;

    const isFog = Boolean(h.fog || h.type === 'fog');
    const tileType = isFog ? 'fog' : h.type;
    const fill = pal.tile[tileType] || pal.tile.desert;
    const stroke = pal.trim[tileType] || pal.trim.desert;

    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.fill(polyPath);
    ctx.stroke(polyPath);

    const isRevealing = Boolean(animatingFogHexIds && animatingFogHexIds.has(h.id));
    if (isRevealing) {
      ctx.save();
      ctx.translate(h.x, h.y);
      ctx.scale(1.06, 1.06);
      ctx.translate(-h.x, -h.y);
    }

    const hasNumber = !isFog && Boolean(h.number);
    drawTerrainGlyph(ctx, tileType, h.x, h.y, hasNumber, pal);
    if (hasNumber && h.number) {
      drawNumberToken(ctx, h.x, h.y, h.number, pal);
    }

    if (isRevealing) {
      ctx.restore();
    }
  }

  // 4. Hex overlays (Tidebound flood/warning/drowned, elevation heat map, base overlays)
  if (input.hexOverlays && input.hexOverlays.length > 0) {
    for (let i = 0; i < input.hexOverlays.length; i++) {
      const ov = input.hexOverlays[i];
      if (cam && !isHexVisible(ov.x, ov.y, cam)) continue;
      drawHexOverlay(ctx, ov, pal);
    }
  }

  // 5. Tidebound fishing grounds (sea tile outlines + fish pictograms + boost pips)
  if (input.fishGrounds && input.fishGrounds.length > 0) {
    for (let i = 0; i < input.fishGrounds.length; i++) {
      const f = input.fishGrounds[i];
      if (cam && !isHexVisible(f.fx, f.fy, cam)) continue;
      drawFishGround(ctx, f, pal);
    }
  }

  // 6. Coastal trading ports (docks, piers, badges, glyphs, ownership rings)
  if (input.ports && input.ports.length > 0) {
    for (let i = 0; i < input.ports.length; i++) {
      const p = input.ports[i];
      if (cam && !isHexVisible(p.sx, p.sy, cam)) continue;
      drawPort(ctx, p, pal);
    }
  }

  return { visibleCount, totalLandCount };
}

function buildAtlasKey(input: TerrainCanvasDrawInput, pal: ThemePalette): string {
  // Fast O(1) path when caller provides monotonic `staticVersion` (avoids per-frame string hashing of 1,000+ hexes).
  if (typeof input.staticVersion === 'number') {
    return `${pal.themeKey}|v${input.staticVersion}|${input.bounds.centerX0.toFixed(1)},${input.bounds.centerY0.toFixed(1)},${input.bounds.contentW.toFixed(1)},${input.bounds.contentH.toFixed(1)}`;
  }
  let hexSig = '';
  for (let i = 0; i < input.hexes.length; i++) {
    const h = input.hexes[i];
    if (h.type === 'water') continue;
    hexSig += `${h.id}:${h.fog ? 'f' : h.type}:${h.number ?? ''};`;
  }
  return `${pal.themeKey}|${input.isLobby ? 1 : 0}|${input.canPaintHex ? 1 : 0}|${input.bounds.centerX0.toFixed(1)},${input.bounds.centerY0.toFixed(1)},${input.bounds.contentW.toFixed(1)},${input.bounds.contentH.toFixed(1)}|${input.landPath.length}|${input.waterPath.length}|${hexSig}`;
}

function ensureBoardAtlas(input: TerrainCanvasDrawInput, pal: ThemePalette): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const nextKey = buildAtlasKey(input, pal);
  if (atlasCanvas && atlasKey === nextKey) {
    return atlasCanvas;
  }

  const margin = 80;
  const worldW = Math.max(200, input.bounds.contentW + margin * 2);
  const worldH = Math.max(200, input.bounds.contentH + margin * 2);
  const worldX = input.bounds.centerX0 - worldW / 2;
  const worldY = input.bounds.centerY0 - worldH / 2;

  // Single full-board GPU texture (no chunks, no pop-in). 3072px on desktop, 2400px on mobile.
  const isNarrow = typeof window !== 'undefined' && window.innerWidth <= 900;
  const maxTexDim = isNarrow ? 2400 : 3072;
  const atlasScale = Math.min(2.0, maxTexDim / Math.max(worldW, worldH));
  const texW = Math.max(1, Math.round(worldW * atlasScale));
  const texH = Math.max(1, Math.round(worldH * atlasScale));

  if (!atlasCanvas) {
    atlasCanvas = document.createElement('canvas');
  }
  atlasCanvas.width = texW;
  atlasCanvas.height = texH;
  const actx = atlasCanvas.getContext('2d');
  if (!actx) return null;

  actx.setTransform(1, 0, 0, 1, 0, 0);
  actx.clearRect(0, 0, texW, texH);
  actx.setTransform(atlasScale, 0, 0, atlasScale, -worldX * atlasScale, -worldY * atlasScale);

  const counts = renderStaticSceneToContext(actx, { ...input, animatingFogHexIds: undefined }, pal, null);
  atlasKey = nextKey;
  atlasWorldX = worldX;
  atlasWorldY = worldY;
  atlasWorldW = worldW;
  atlasWorldH = worldH;
  atlasScaleUsed = atlasScale;
  atlasTotalLandCount = counts.totalLandCount;
  return atlasCanvas;
}

/**
 * Draws the board's terrain, coastlines, ports, fish, overlays, and interactive spots onto `#boardTerrainCanvas`.
 * - Zoomed out / normal view: blits ONE pre-rendered full-board offscreen bitmap atlas in <0.2ms (zero chunk loading, zero pop-in).
 * - Zoomed in closely past atlas resolution: draws only the ~15-80 on-screen elements directly in crisp Retina 2D vector canvas.
 * - Interactive build spots are always rendered in a fast frustum-culled pass on top (<0.25ms), replacing thousands of SVG DOM nodes.
 */
export function drawBoardTerrainCanvas(input: TerrainCanvasDrawInput): void {
  lastInput = input;
  const canvas = ensureCanvasElement();
  if (!canvas) return;

  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  if (cachedViewW <= 0 || cachedViewH <= 0) {
    const rect = canvas.getBoundingClientRect();
    cachedViewW = rect.width || canvas.clientWidth || 1000;
    cachedViewH = rect.height || canvas.clientHeight || 800;
  }
  const viewW = cachedViewW;
  const viewH = cachedViewH;
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;

  const targetW = Math.max(1, Math.round(viewW * dpr));
  const targetH = Math.max(1, Math.round(viewH * dpr));
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const pal = readThemePalette();
  const cam = computeCanvasCamera(
    input.bounds,
    input.camZoom,
    input.camPanX,
    input.camPanY,
    viewW,
    viewH
  );

  // Clear entire canvas in physical pixels, then switch to board world coordinates
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, targetW, targetH);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(cam.tx, cam.ty);
  ctx.scale(cam.scale, cam.scale);

  const hasFogAnim = Boolean(input.animatingFogHexIds && input.animatingFogHexIds.size > 0);
  const atlas = !hasFogAnim ? ensureBoardAtlas(input, pal) : null;

  // Use the single full-board atlas whenever its pixel density is close to screen density;
  // only switch to direct Retina vector drawing when zoomed in deeply (few hexes on screen) so text/glyphs stay sharp.
  const screenWorldScale = cam.scale * dpr;
  const useCrispVectorZoom = !atlas || screenWorldScale > atlasScaleUsed * 1.65;

  if (!useCrispVectorZoom && atlas) {
    ctx.drawImage(atlas, atlasWorldX, atlasWorldY, atlasWorldW, atlasWorldH);
    stats.visibleHexes = atlasTotalLandCount;
    stats.totalHexes = atlasTotalLandCount;
  } else {
    const counts = renderStaticSceneToContext(ctx, input, pal, cam);
    stats.visibleHexes = counts.visibleCount;
    stats.totalHexes = counts.totalLandCount;
  }

  if (input.interactiveSpots) {
    drawInteractiveSpots(ctx, input.interactiveSpots, pal, cam);
  }

  const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
  stats.lastDrawMs = Math.round((t1 - t0) * 100) / 100;
  stats.drawCount++;
}
