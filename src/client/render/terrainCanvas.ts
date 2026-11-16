// MODULE: 2D canvas terrain renderer (viewport-culled hexes, coastlines, resource glyphs, number tokens, and math hex hit-testing) | DEPENDS ON: none | USED BY: client/debug, client/render/board

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
    if (polyCornersCache.size > 4000) polyCornersCache.clear();
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
  token: string;
  tokenInk: string;
  tokenHot: string;
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

  cachedPalette = {
    themeKey,
    seaShallow: css('--sea-shallow', '#86b0bf'),
    sand: css('--sand', '#e8d9ab'),
    token: css('--token', '#f4f1ea'),
    tokenInk: css('--token-ink', '#2b2f33'),
    tokenHot: css('--token-hot', '#b3402e'),
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
    if (hexPolyPathCache.size > 4000) hexPolyPathCache.clear();
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
    goldSpark: new Path2D('M9,-13 L10.2,-9.2 L14,-8 L10.2,-6.8 L9,-3 L7.8,-6.8 L4,-8 L7.8,-9.2 Z')
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

/** Draws the exact pictogram from `src/client/icons.ts` (`getBoardIconSvg(tileType, 0, hasNumber ? -24 : 0, hasNumber ? 1.45 : 1.9)`). */
function drawTerrainGlyph(
  ctx: CanvasRenderingContext2D,
  tileType: string,
  hx: number,
  hy: number,
  hasNumber: boolean,
  pal: ThemePalette
): void {
  const gp = getGlyphPaths();
  if (!gp) return;

  const yOffset = hasNumber ? -24 : 0;
  const iconScale = hasNumber ? 1.45 : 1.9;

  ctx.save();
  ctx.translate(hx, hy + yOffset);
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

let lastInput: TerrainCanvasDrawInput | null = null;
let observersAttached = false;

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
  }
  if (!observersAttached && typeof window !== 'undefined') {
    observersAttached = true;
    window.addEventListener('resize', () => {
      if (lastInput) drawBoardTerrainCanvas(lastInput);
    });
    if (typeof MutationObserver !== 'undefined' && document.documentElement) {
      const mo = new MutationObserver(() => {
        cachedPalette = null;
        if (lastInput) drawBoardTerrainCanvas(lastInput);
      });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
  }
  return canvas;
}

/**
 * Draws the board's static/semi-static terrain layer (shallow water, sand, water cells,
 * viewport-culled land/fog hexes, resource pictograms, and number tokens) onto `#boardTerrainCanvas`.
 */
export function drawBoardTerrainCanvas(input: TerrainCanvasDrawInput): void {
  lastInput = input;
  const canvas = ensureCanvasElement();
  if (!canvas) return;

  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const rect = canvas.getBoundingClientRect();
  const viewW = rect.width || canvas.clientWidth || 1000;
  const viewH = rect.height || canvas.clientHeight || 800;
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

  // 3. Viewport-culled land/fog hexes, resource pictograms, and number tokens
  let visibleCount = 0;
  let totalLandCount = 0;
  const { hexes, animatingFogHexIds } = input;

  for (let i = 0; i < hexes.length; i++) {
    const h = hexes[i];
    if (h.type === 'water') continue;
    totalLandCount++;

    if (!isHexVisible(h.x, h.y, cam)) continue;
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

  const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
  stats.lastDrawMs = Math.round((t1 - t0) * 100) / 100;
  stats.visibleHexes = visibleCount;
  stats.totalHexes = totalLandCount;
  stats.drawCount++;
}
