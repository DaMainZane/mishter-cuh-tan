import { describe, expect, it } from 'vitest';
import { FIT_VIEW, MAX_SCALE, MIN_SCALE, WORLD_SPAN, clampView, panBy, zoomAt } from '../src/client/techView';

// Bug "tech tree ring spacing": the rings are twice as far apart as they were. The tree lives in a world that is
// WORLD_SPAN times the stage, so the rings keep their place in percent but sit further apart in pixels (the techs keep their size).
// The opening view fits the whole world, and zooming in reaches the techs at full size.

const W = 600;
const H = 600;

describe('tech tree world span (ring spacing)', () => {
  it('makes the world at least twice the stage, so the rings are at least twice as far apart', () => {
    expect(WORLD_SPAN).toBeGreaterThanOrEqual(2);
  });

  it('opens on a view that fits the whole world in the stage', () => {
    expect(FIT_VIEW.scale * WORLD_SPAN).toBeCloseTo(1, 6);
    expect(FIT_VIEW.scale).toBeGreaterThanOrEqual(MIN_SCALE);
    expect(clampView(FIT_VIEW, W, H, WORLD_SPAN)).toEqual(FIT_VIEW);
  });

  it('cannot pan while the whole world is in view', () => {
    expect(panBy(FIT_VIEW, 120, -80, W, H, WORLD_SPAN)).toEqual(FIT_VIEW);
  });

  it('zooming in lets you pan, and stops at the edges of the bigger world', () => {
    const zoomed = { scale: 1, x: -300, y: -300 };
    expect(panBy(zoomed, 5000, 5000, W, H, WORLD_SPAN)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(panBy(zoomed, -5000, -5000, W, H, WORLD_SPAN)).toEqual({ scale: 1, x: -(WORLD_SPAN - 1) * W, y: -(WORLD_SPAN - 1) * H });
  });

  it('zoom keeps the world point under the cursor in place', () => {
    const before = { x: (200 - FIT_VIEW.x) / FIT_VIEW.scale, y: (150 - FIT_VIEW.y) / FIT_VIEW.scale };
    const next = zoomAt(FIT_VIEW, 2, 200, 150, W, H, WORLD_SPAN);
    expect((200 - next.x) / next.scale).toBeCloseTo(before.x, 6);
    expect((150 - next.y) / next.scale).toBeCloseTo(before.y, 6);
  });

  it('can still zoom in far enough to read every tech at full size', () => {
    expect(MAX_SCALE).toBeGreaterThanOrEqual(1.25);
  });

  it('keeps the old single-world behaviour when no span is given', () => {
    expect(clampView({ scale: 2, x: -5000, y: 5000 }, W, H)).toEqual({ scale: 2, x: -600, y: 0 });
  });
});
