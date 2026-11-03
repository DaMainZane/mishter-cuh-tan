// MODULE: drag-pan preview math (BUG 1: how much board lies off-screen at the last repaint, and whether a CSS-translated board would now show a gap, so it must repaint) | DEPENDS ON: none | USED BY: client/render/board

// While dragging, `board.ts` moves the painted board as one layer (a CSS translate) instead of rewriting the viewBox, which repaints every SVG node.
// That is exact for everything that was on screen at the last repaint. Board that was off-screen then was never painted, so dragging it into view
// shows plain sea until the next repaint. These functions say how big that gap is, so the board repaints only when it would be noticed.

/** A rectangle by its four sides (world units or screen pixels). */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Board outside the visible area on each side, in screen pixels (0 where the board ends inside the view). Both boxes in world units. */
export function hiddenEdges(board: Box, view: Box, worldPerPx: number): Box {
  const k = worldPerPx > 0 ? 1 / worldPerPx : 0;
  return {
    left: Math.max(0, view.left - board.left) * k,
    top: Math.max(0, view.top - board.top) * k,
    right: Math.max(0, board.right - view.right) * k,
    bottom: Math.max(0, board.bottom - view.bottom) * k
  };
}

/**
 * Width in pixels of the unpainted strip a board translated by (`dx`, `dy`) pixels shows: dragging right brings the left side into view, up to what was
 * hidden there, and so on. The larger of the two axes.
 */
export function missingAfterOffset(hidden: Box, dx: number, dy: number): number {
  const x = dx > 0 ? Math.min(dx, hidden.left) : Math.min(-dx, hidden.right);
  const y = dy > 0 ? Math.min(dy, hidden.top) : Math.min(-dy, hidden.bottom);
  return Math.max(0, x, y);
}

/** Repaint now: the unpainted strip is wider than `slackPx`. */
export function needsRepaint(hidden: Box, dx: number, dy: number, slackPx: number): boolean {
  return missingAfterOffset(hidden, dx, dy) > slackPx;
}
