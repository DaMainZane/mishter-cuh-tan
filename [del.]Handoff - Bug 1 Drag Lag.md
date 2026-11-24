# Handoff: Bug 1, drag lag on big maps

Written 2026-11-03. Read `CLAUDE.md` first (its bug rules apply: failing test first, say what you did not verify, never regenerate `tests/golden.snapshot.json`; `tests/view.snapshot.json` only as a reviewed diff). `BUGS/Bug List.md` holds the report. Your job: finish and verify this fix, then commit.

## The bug

Zoomed out on a map of radius 15 or more, dragging the board stutters and drops frames. (Capping the max map radius at 30 is **not** part of this job: the user gave it to another agent.)

## Cause (measured, not guessed)

Test setup: radius 20 map, about 26,000 SVG nodes, the in-app browser pane. A drag wrote a new `viewBox` on `#boardSvg` every frame. With that many nodes the browser restyles and repaints the whole svg each time:

| Change | Cost per frame (forced layout, radius 20) |
|---|---|
| new `viewBox` on the svg | about 21 to 48 ms |
| `transform` on the svg itself | about 23 to 43 ms (no better: it restyles every node too) |
| `transform: translate3d` on a **plain div wrapping the svg** | **0 to 1 ms** |

So the fix is to move a wrapper div while dragging and write the real `viewBox` once at the end.

## What is already written (uncommitted, builds, typecheck clean)

- `src/client/panPreview.ts` and `tests/panPreview.test.ts`: pure math, 6 tests pass. Given the board box, the view box and world-per-pixel, it says how much board is off-screen on each side and whether a translated board would show an unpainted gap (`needsRepaint`).
- `public/index.html`: the svg is now inside `<div id="boardPan" class="board-pan">`, plus an empty `<div id="boardPanShield" class="board-pan-shield">` after it.
- `src/client/styles.css`: `.board-pan { position:absolute; inset:0; will-change:transform }`, and the shield (`display:none`, `.on` shows it, `cursor:grabbing`). The old `svg#boardSvg.is-panning` rule is gone (it set `pointer-events:none`, `shape-rendering` and `text-rendering` on the svg, which restyles every node at the start and end of a drag).
- `src/client/render/board.ts`: `panBoardPreview(rect)` (called every drag move; coalesced with `requestAnimationFrame`) translates `#boardPan` by the pan since the last repaint, and calls `updateCameraViewBox()` only when `needsRepaint` says unpainted board would show (slack: 12% of the shorter screen side). `endBoardPan()` writes the real viewBox at drag end. `updateCameraViewBox()` now also clears the wrapper transform and resets the cached hidden edges.
- `src/client/main.ts`: the mousemove handler calls `panBoardPreview(rect)` instead of `rerenderBoard()`; mouseup calls `endBoardPan()`; `is-panning` on the svg is replaced by showing `#boardPanShield` once a drag starts.

## Verified so far (live, radius 20)

- During a scripted drag the wrapper gets `translate3d(...)` each move and the svg's `viewBox` is not rewritten; the transform is cleared and the viewBox written at mouse up.
- A long-animation-frame observer saw **no long frames during the drag**; the only long frame (about 100 to 130 ms) is the single viewBox write at the end.
- Game loads and plays; no console errors seen.

## Not verified, do these next

1. **A real frame-rate comparison.** The in-app browser pane throttled `requestAnimationFrame` to about one frame per 2 s in my session (the page was not focused), so frame times were unusable. Measure in a focused window if you can (the user's own Chrome via Claude in Chrome, or ask the user to try it), at radius 20 and 30, before and after (git stash for before).
2. **Visual check of the end-of-drag jump.** When the real viewBox is written, the board must land exactly where the translate had put it (same pixels). My check: after a drag the final viewBox pan matches. Look for a visible jump or a blank strip at the edges in a screenshot, mid-drag and just after release. If there is a jump, check that `worldPerPx` in `applyPanPreview` matches the one in the `mousemove` handler in `main.ts` (both use `camZoom * max(contentW / rect.width, contentH / rect.height)`).
3. **Edge gap.** With a zoomed-in view, drag far: when unpainted board would show, it should repaint mid-drag instead of showing sea. `PAN_SLACK` (12%) is a guess; tune it. Zoom-out (whole board visible) must never repaint mid-drag.
4. **Wheel zoom and the zoom handler** (`stage.addEventListener('wheel')` in `main.ts`, around line 267 to 366) still call `rerenderBoard()`, so zooming repaints every wheel tick. Not the reported bug, but the same trick may help; leave it unless dragging is fixed and the user asks.
5. **Hover work.** `onRoadHover` and friends still run on mousemove over the board when not dragging. The shield removes that during a drag only.
6. **Touch and pointer devices.** The drag code is mouse only; I did not touch that.

## Then finish

```bash
npm run headers:write
npm run index
npm run typecheck
npx vitest run
```

Expected failures, all older than this work (they fail at HEAD too): the two `tests/architecture.test.ts` cycle checks (`client/debug` is part of an import cycle not listed in `KNOWN_CYCLES`) and `tests/mindmap.test.ts` (`ARCHITECTURE.md` moved to `Architecture/Architecture of Code.md`). `tests/mapbudget.test.ts` can fail on timing when the game server is busy; it passes alone.

Also: add `tests/panPreview.test.ts` to the `tests/` table in `INDEX.md` (hand-written table, last row pattern: `| \`panPreview.test.ts\` | ... |`) and a pass to `change log.md` (top section is "Passes 112-114 (Nov 3)": add **115**). The `INDEX.md` `src/` rows regenerate with `npm run index`.

If the fix holds, delete the Bug 1 entry from `BUGS/Bug List.md` (that leaves the file empty, which is fine) and commit. Commit message: `perf(client): drag the board as one layer so big maps stop stuttering (Bug 1)`.

## How to run and measure

`.claude/launch.json` is in the **vault root** (not the project) and starts the server with `npm --prefix "Coding Project/colonist-custom-catan" start`, port 3000. It serves `dist/`, so run `npm run build` after every change and reload the page (restart the server only for server-side changes).

To get a big map fast, in the browser: type a nickname, Create game, set the `#setRadius` input to 20 and fire a `change` event, add a bot (a button labelled `Bot`), Start now. The node count is `document.querySelectorAll('#boardSvg *').length` (about 26,000 at radius 20; the in-game debug panel, backtick key, also shows SVG nodes and FPS).

Drag benchmark used (paste in the page after the game starts): dispatch `mousedown` on `#boardSvg`, then a series of `mousemove` events on `window` one per animation frame, then `mouseup`; read frame times with a `PerformanceObserver` for `long-animation-frame` rather than `requestAnimationFrame` timestamps if the pane is throttled.

## If it does not hold up (fallbacks)

- **Fewer nodes while zoomed out.** Skip drawing number tokens, port badges, fish and small icons (`boardTerrainLayer` builds them in `renderBoard`) when the zoom makes them smaller than a few pixels. This cuts the 26,000 nodes and helps every redraw, not just drags.
- **`contain: strict` / `content-visibility`** on layers that do not change during a drag, and `shape-rendering: optimizeSpeed` set once on the terrain layer only.
- **Canvas or an offscreen bitmap** of the terrain layer for very large boards (bigger change; discuss with the user first).

## Open design note

The visible-board check assumes the unpainted region is only ever off-screen board, not stale content. If a state update (`renderBoard`) arrives mid-drag it rewrites layers and calls `updateCameraViewBox()`, which resets the translate: confirm there is no flash when a bot move arrives during a drag.
