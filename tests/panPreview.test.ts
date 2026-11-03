import { describe, expect, it } from 'vitest';
import { hiddenEdges, missingAfterOffset, needsRepaint } from '../src/client/panPreview';

// BUG 1: while dragging, the board is moved as one painted layer (a CSS translate) instead of repainting every SVG node each frame. The only time it
// must repaint mid-drag is when the drag pulls board into view that was off-screen at the last repaint (it was never painted, so it shows as blank sea).

const board = { left: 0, top: 0, right: 1000, bottom: 800 };

describe('pan preview: what lies off-screen', () => {
  it('a board that fits on screen hides nothing', () => {
    expect(hiddenEdges(board, { left: -100, top: -100, right: 1100, bottom: 900 }, 1)).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });

  it('a zoomed-in view hides board on every side, in screen pixels (world / world-per-pixel)', () => {
    expect(hiddenEdges(board, { left: 200, top: 100, right: 600, bottom: 500 }, 2)).toEqual({ left: 100, top: 50, right: 200, bottom: 150 });
  });
});

describe('pan preview: when the translated layer would leave a gap', () => {
  const hidden = { left: 100, top: 0, right: 0, bottom: 40 };

  it('dragging right reveals the left side: the gap is the drag, up to what was hidden there', () => {
    expect(missingAfterOffset(hidden, 30, 0)).toBe(30);
    expect(missingAfterOffset(hidden, 250, 0)).toBe(100);
  });

  it('dragging toward a side with nothing hidden leaves no gap (only sea comes into view)', () => {
    expect(missingAfterOffset(hidden, -300, 0)).toBe(0);
    expect(missingAfterOffset(hidden, 0, 500)).toBe(0);
  });

  it('dragging up reveals the bottom; the worst axis counts', () => {
    expect(missingAfterOffset(hidden, 0, -25)).toBe(25);
    expect(missingAfterOffset(hidden, 60, -25)).toBe(60);
  });

  it('repaints only once the gap is bigger than the allowed slack', () => {
    expect(needsRepaint(hidden, 20, 0, 24)).toBe(false);
    expect(needsRepaint(hidden, 30, 0, 24)).toBe(true);
    // A whole-board view never repaints mid-drag, however far it goes.
    expect(needsRepaint({ left: 0, top: 0, right: 0, bottom: 0 }, 5000, -5000, 24)).toBe(false);
  });
});
