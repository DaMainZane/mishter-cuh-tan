// MODULE: unit tests for 2D terrain canvas camera math, viewport culling, and hex hit-testing
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  computeCanvasCamera,
  isHexVisible,
  screenToWorld,
  parsePolyPoints,
  pointInPolygon,
  findHexAtWorldPoint,
  type TerrainHexLike
} from '../src/client/render/terrainCanvas';

function makeRegularHex(id: number, cx: number, cy: number, r = 58): TerrainHexLike {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = ((60 * i - 30) * Math.PI) / 180;
    const x = (cx + r * Math.cos(angle)).toFixed(1);
    const y = (cy + r * Math.sin(angle)).toFixed(1);
    pts.push(`${x},${y}`);
  }
  const poly = pts.join(' ');
  return {
    id,
    x: cx,
    y: cy,
    type: 'wood',
    number: 8,
    tilePoly: poly,
    rawPts: poly
  };
}

describe('terrainCanvas camera & culling math', () => {
  it('aligns world-to-screen transform identically to SVG preserveAspectRatio="xMidYMid meet"', () => {
    const bounds = { centerX0: 120, centerY0: -80, contentW: 2000, contentH: 1600 };
    const camZoom = 0.5;
    const camPanX = 150;
    const camPanY = -60;
    const viewW = 1280;
    const viewH = 720;

    const cam = computeCanvasCamera(bounds, camZoom, camPanX, camPanY, viewW, viewH);

    // SVG viewBox dimensions: baseW = 1000, baseH = 800
    // Viewport is 1280x720 -> height-constrained: scale = min(1280/1000, 720/800) = 0.9
    expect(cam.scale).toBeCloseTo(0.9, 6);
    expect(cam.worldPerPx).toBeCloseTo(1 / 0.9, 6);

    // World center (centerX0 - camPanX, centerY0 - camPanY) = (-30, -20) must map to screen center (viewW/2, viewH/2)
    const screenCenterX = -30 * cam.scale + cam.tx;
    const screenCenterY = -20 * cam.scale + cam.ty;
    expect(screenCenterX).toBeCloseTo(viewW / 2, 6);
    expect(screenCenterY).toBeCloseTo(viewH / 2, 6);

    // screenToWorld must invert the affine transform at arbitrary screen points
    const worldCenter = screenToWorld(viewW / 2, viewH / 2, cam);
    expect(worldCenter.x).toBeCloseTo(-30, 6);
    expect(worldCenter.y).toBeCloseTo(-20, 6);

    const sampleWorld = { x: 245.5, y: -188.25 };
    const sampleScreenX = sampleWorld.x * cam.scale + cam.tx;
    const sampleScreenY = sampleWorld.y * cam.scale + cam.ty;
    const roundTrip = screenToWorld(sampleScreenX, sampleScreenY, cam);
    expect(roundTrip.x).toBeCloseTo(sampleWorld.x, 5);
    expect(roundTrip.y).toBeCloseTo(sampleWorld.y, 5);
  });

  it('culls off-screen hexes when zoomed in on a large board', () => {
    const bounds = { centerX0: 0, centerY0: 0, contentW: 4000, contentH: 4000 };
    // Zoomed in 4x at center (0, 0) on a 1000x800 viewport -> viewBox is 1000x1000, scale = 0.8,
    // so visible world box is (-625..625, -500..500) + 76 pad = (-701..701, -576..576)
    const cam = computeCanvasCamera(bounds, 0.25, 0, 0, 1000, 800, 76);

    expect(isHexVisible(0, 0, cam)).toBe(true);
    expect(isHexVisible(480, 350, cam)).toBe(true);
    expect(isHexVisible(690, 0, cam)).toBe(true); // within 625 + 76 pad (701)
    expect(isHexVisible(750, 0, cam)).toBe(false); // outside 625 + 76 pad (701)
    expect(isHexVisible(0, -620, cam)).toBe(false); // outside -500 - 76 pad (-576)
    expect(isHexVisible(-1800, 1600, cam)).toBe(false);
  });

  it('accurately hit-tests hex polygons via findHexAtWorldPoint', () => {
    const h0 = makeRegularHex(0, 0, 0, 58);
    const h1 = makeRegularHex(1, 100.5, 0, 58);
    const h2 = makeRegularHex(2, 50.25, 87, 58);
    const hexes = [h0, h1, h2];

    const corners0 = parsePolyPoints(h0.tilePoly);
    expect(corners0).toHaveLength(6);
    expect(pointInPolygon(0, 0, corners0)).toBe(true);
    expect(pointInPolygon(100, 0, corners0)).toBe(false);

    expect(findHexAtWorldPoint(5, -4, hexes)).toBe(0);
    expect(findHexAtWorldPoint(102, 8, hexes)).toBe(1);
    expect(findHexAtWorldPoint(48, 82, hexes)).toBe(2);
    expect(findHexAtWorldPoint(-200, -200, hexes)).toBeNull();
  });

  it('mounts #boardTerrainCanvas inside #boardPan and removes mid-drag chunking', () => {
    const html = readFileSync('public/index.html', 'utf8');
    const css = readFileSync('src/client/styles.css', 'utf8');
    const boardTs = readFileSync('src/client/render/board.ts', 'utf8');

    expect(html).toContain('id="boardTerrainCanvas"');
    expect(css).toContain('.board-terrain-canvas');
    expect(boardTs).toContain('drawBoardTerrainCanvas');
    expect(boardTs).toContain('hexAtClientPoint');
    expect(boardTs).not.toContain('translate3d(');
  });
});
