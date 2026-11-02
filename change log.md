# Change Log

## 2026-11-02 (Pass 111: Debug Mode — sandbox grants, forced dice rolls, in-game board brush, invariant & client-vs-server spot auditor, and FPS/SVG node profiler; headers, index, typecheck and all 66 test files passed)
### Added
- **Server Debug Mode (`src/server/debug.ts`, `src/server/socket.ts`)**:
  - `auditGameState(room, viewerId)` checks Longest Road award consistency (`longestRoadFor`, `longestRoadHasBridge`, `grandCausewayBonusVp`), verifies `score(g, reg, p, true) === sum(vpBreakdown)`, audits base piece supplies (`settlement`, `city`, `road`), shared `bridge` + `rickety_bridge` pools, and `net` tile caps, and extracts the server's ground-truth `legalSpots` (`settlementVertices`, `cityVertices`, `roadEdges`, `bridgeEdges`, `ricketyEdges`, `netHexes`, `harborVertices`, `portRaiseVertices`).
  - `applyDebugCommand(room, actorId, cmd, payload)` handles `grantResources` (`+10` all resources), `grantFish` (`+5` fish tokens), `unlockAllTechs`, `forceRoll` (`2..12` through the real `onRoll` + `resolveSeven` / `runProductionPipeline` hooks), `paintPiece` (place/clear `settlement`, `city`, `road`, `bridge`, `rickety_bridge`, `net`, `pirate`, `wreck_sea`, `wreck_shore`, `robber` on any hex/vertex/edge while keeping piece pools and awards synced), and `exportSnapshot` (JSON repro state).
  - Wired `socket.on('debugCmd', ...)` in `src/server/socket.ts` emitting `debugReport`.
- **Client Debug Mode HUD & Board Overlay (`src/client/debug.ts`, `src/client/render/board.ts`, `src/client/render/index.ts`, `src/client/main.ts`, `src/client/styles.css`, `public/index.html`)**:
  - Toggled via `?debug=1`, pressing `` ` `` or `F2`, or clicking **Debug Mode** in `#gameSettingsMenu`.
  - Live **FPS / Max Frame Spike (3s) / SVG Layer Node Counter** (`Terrain`, `Roads`, `Vertices`, `Overlays`, `Total`).
  - Automatic **Client-vs-Server Spot Diff** (`diffClientVsServerSpots`) comparing `canClientPlaceSettlement`, `canClientPlaceRoad`, `canClientPlaceBridge`, `netSpots`, `harborSpots`, and `portRaiseSpots` against the server's `legalActions`.
  - `#boardDebugLayer` overlay in `board.ts` supporting **Show H/V/E IDs**, **All-Icons Stress Test** (simultaneously drawing number token, robber, fish ground, net, pirate, sea wreck, and shore wreck on the center hex), and clickable in-game board brush targets.
### Tests
- `tests/debugmode.test.ts` (4 tests covering clean game audit, supply/award corruption detection, sandbox commands & repro export, and client-vs-server spot desync diffing).
### Not verified
- Not seen in the game: visual layout of `#debugHudPanel` on narrow mobile screens.

## 2026-11-02 (Pass 110: Bug List — Bug 3 tech cost balancing; headers, index, typecheck and all 65 test files passed)
### Fixed
- **Bug 3 — Tidebound tech cost balancing (`src/shared/stage1.ts`)**: in active games (`placedCount(g, pid, 'settlement') >= 1` or `hasTech(g, pid, 'tidebound.harbor_charters')` with Tidebound DLC or `offset >= 3`), `techCostCards` now exempts the 2 starting settlements (`effV = Math.max(0, v - 2)`) and scales down tier offsets (`effOffset = Math.floor(offset * 0.4)`), reducing real-game Tidebound tech costs from `2 / 6 / 9 / 11 / 15` cards down to `2 / 3 / 5 / 5 / 8` cards at game start while keeping legacy unit tests and `tests/view.snapshot.json` unchanged.
### Tests
- `tests/tideboundtech.test.ts` (Bug 3 active-game tech cost tiers).
### Not verified
- Not seen in the game: mid/late-game tech purchase pacing across 4-player and 8-player Tidebound matches.

## 2026-11-02 (Pass 109: Bug List — Fishing net rework (one net per sea tile, Steps 1–3); headers, index, typecheck and all 65 test files passed)
### Fixed
- **Fishing net rework — one net per sea tile (`src/packs/tidebound/fishing.ts`, `src/packs/tidebound/pirates.ts`, `src/packs/tidebound/wrecks.ts`, `src/packs/tidebound/dialogue.ts`, `src/client/render/board.ts`, `src/client/render/hand.ts`, `src/client/actions.ts`, `src/client/pieceModel.ts`, `src/client/icons.ts`)**:
  - **Engine & actions (Step 1)**: replaced the old vertex `PieceDef` (`NET`) with a sea-tile placement model (`hex.ext.net = { owner }`, `PLACE_NET = 'place_net'`, payload `{ hexId }`). Each net occupies and fishes **one** open sea tile (`isSeaHex`), and a sea tile holds at most one net. Legal sea tiles (`netSpotHexIds` / `canPlaceNet`) are open, unhidden sea tiles without a net that touch a coastal vertex adjacent to the player's road, bridge or rickety bridge (once any building is on the board, the player must also own a settlement or city). Because a net no longer occupies a vertex, coastal settlement spots and port vertices are never blocked. Added `netsOf`, `netLimit`, `netsLeft`, `netPrice` (2x after `NET_BASE_LIMIT = 4`, reduced by 1 wood with `tidebound.net_works`), and `migrateVertexNets` so old saves heal on roll. Updated `pirates.ts` and `wrecks.ts` coast reach and `dialogue.ts` triggers to read `hex.ext.net` and `place_net`.
  - **Client & bot integration (Step 2)**: `netViewData` exposes `netsLeft` and `netTiles` (public sea tile IDs carrying the player's nets) to all viewers, and `netSpots` (legal sea tile IDs) plus `netCost` to the active player. `board.ts` renders each net tile in `#boardNetsLayer` via `netTileMarkup`, renders pulsing `.net-spot` hex polygons in `#boardPieceSpotsLayer` when `buildMode === 'net'`, and dispatches `act: place_net` from `clickNetSpot(hexId)`. `netBotGoal` scores and places `place_net` actions on sea tiles (preferring fish-boosted tiles).
  - **Cleanup & docs (Step 3)**: removed `netMarkup` from `src/client/icons.ts`, removed the temporary `netSeaTiles` vertex-to-tile helper from `src/client/pieceModel.ts` and `tests/pieceModel.test.ts`, updated `ROUTER.md`, `RECIPES.md` and `INDEX.md`, and removed `BUGS/Net Rework Handoff.md`.
### Tests
- `tests/tideboundnets.test.ts` (24 tests), `tests/tideboundnetsclient.test.ts` (13 tests), `tests/tideboundfishing.test.ts` (11 tests), `tests/pieceModel.test.ts` (`netTileMarkup`).
### Not verified
- Not seen in the game: clicking a pulsing `.net-spot` sea hex in a live browser session and visual layering when a net tile also holds a fish ground, pirate, or sea shipwreck.

## 2026-11-02 (Pass 108: Scale robber, shipwrecks and pirates when zooming out; headers, index, typecheck and tests passed)
### Fixed
- **Zoom-out scaling for robber, shipwrecks and pirates (`src/client/render/board.ts`, `src/client/render/pirates.ts`, `src/client/styles.css`)**: settlements, cities and roads grew as the camera zoomed out or on larger boards (`buildingScale` / `roadScale`), while the robber, shipwrecks and pirates stayed at fixed board-unit sizes and shrank when zoomed out. `updateCameraViewBox` now sets `--piece-zoom` (`buildingScale / BUILDING_BASE_SCALE`, 1.0 at normal zoom and matching the settlement/city growth curve when zoomed out) on `#boardHexDynamicLayer`, `#boardWrecksLayer` and `#boardPiratesLayer` (staying off `#boardTerrainLayer`), and wraps the robber, shipwreck and pirate groups in `<g class="piece-zoom-scale">` (`transform: scale(var(--piece-zoom, 1)); transform-origin: 0 0`).
### Tests
- `tests/pirateicon.test.ts`, `tests/tideboundrickety.test.ts`.
### Not verified
- Not seen in the game: visual crowding when a tile holds both a fish icon and a zoomed-out pirate or sea wreck on a radius-20 map.

## 2026-11-02 (Pass 107: Bug List — fishing net icon rework; superseded by Pass 109; headers, index, typecheck and all tests passed)
### Fixed
- **Fishing net icon (`src/client/icons.ts`, `src/client/pieceModel.ts`, `src/client/render/board.ts`)**: a net was a tiny piece on the settlement spot, not on the water. Added `netTileMarkup(hexId, corners, cx, cy, col)` which draws a rope border pulled in from the tile edge, a diamond mesh clipped to it (`net-clip-<hexId>`) and one float per corner in the owner's colour, flat with the piece rim, `pointer-events:none`, rendered in `boardNetsLayer`. (The temporary `netSeaTiles` vertex-mapping helper was superseded in Pass 109 by one-net-per-sea-tile placement.)
### Tests
- `tests/pieceModel.test.ts` (`netTileMarkup`).
### Not verified
- Not seen in the game: the look against the sea colour and the `--pier` tokens.

## 2026-11-02 (Pass 106: Bug List — Bug 4 port upgrade node; headers, index, typecheck and all tests passed)
### Fixed
- **Bug 4 (`src/client/pieceModel.ts`, `src/client/render/board.ts`, `src/client/actions.ts`)**: with only Harbor charters researched there was no way to raise a 3:1 port on the board, and the Harbor toolbar button said "Not enough resources for a harbor" even with enough cards. Harbor mode only knew the 1:1 harbor (`upgrade_harbor`), whose price (`harborCost`) the server sends only with Harbor master. New pure `portRaiseSpots(harbor, myMainTurn)` lists the ports not yet raised from `techActions.harbor`, each with `cost` and `affordable` (so the Bug 5 popover and cost tooltip can reuse it). `board.ts` draws the upgrade ring on your affordable 3:1 port cities on your main-phase turn (no build mode, or harbor mode) and the click emits `upgrade_port` through `upgradePortClick`; a settlement that can also become a city keeps the city ring. `setBuildMode('harbor')` without Harbor master now says why: no port city, cannot pay, or click the glowing city.
### Tests
- `tests/pieceModel.test.ts` (`portRaiseSpots`).
### Not verified
- Not seen in the game: the ring on a real port city, and harbor mode when both Harbor charters and Harbor master are owned (the 1:1 ring wins there, so the raise ring is hidden in harbor mode for a port the 1:1 upgrade also covers).

## 2026-11-02 (Pass 105: Bug List — live log player filter; headers, index, typecheck and all tests passed)
### Fixed
- **Live log player filter (new `src/client/logFilter.ts`, `src/client/render/sidebar.ts`)**: filtering by a player also showed other players' turns. `actionMatchesFilter` kept a `player:` match when the action text merely contained the name, so "Breeze got +1 brick" inside Jew's turn passed the Breeze filter. The player filter now keeps only turns taken by that player (all rounds, past ones included). `splitFilterKey` and `actionMatchesFilter` moved out of `sidebar.ts` into the pure `logFilter.ts` so they can be tested without the socket and store; the other filter kinds are copied unchanged. The unused `PlayerTurnSummary` import in `sidebar.ts` is gone.
### Tests
- `tests/logfilter.test.ts` (new).
### Not verified
- Not seen in the game. Side effect to check: a player's resource gains during someone else's roll ("Breeze got +1 brick") no longer show under the Breeze filter, because they are not an action Breeze took; the resource filters still show them.

## 2026-11-02 (Pass 104: Bug List — heat map tint, fish tile outline, tech tree ring spacing; headers, index, typecheck and all tests passed)
### Fixed
- **Heat map tint (`src/client/styles.css`)**: the `--elev-1` to `--elev-3` tokens were pale and 40 to 72% opaque, so the three heights barely differed. They are now a yellow, orange, deep red ramp at 72 to 92% opacity (light and dark theme), and `.hex-elev-label` is white with a dark outline (`paint-order: stroke`) so the arrows read on every level. The arrows stay as the second signal.
- **Fish tile outline (`src/client/render/overlay.ts`, `src/client/render/board.ts`)**: a sea tile holding a fishing ground had no outline. New `fishTileOutlineMarkup(poly)` draws the tile's inset polygon (`geom.tilePoly`, the polygon land tiles use) as an unfilled `var(--token)` stroke, `pointer-events:none`; the fish layer adds it for every tile that has a fish icon (also while feed mode is on). A feed spot with no fish yet gets none.
- **Tech tree ring spacing (`src/client/techView.ts`, `src/client/render/techpanel.ts`)**: rings are 2x further apart in pixels. The tree keeps its percent layout (`layout` and its radii untouched) but lives in a `.tp-world` that is `WORLD_SPAN` (2) times the stage; techs keep their size. `clampView`, `zoomAt` and `panBy` take an optional `span` (default 1, so old callers behave as before); `FIT_VIEW` (scale `1 / WORLD_SPAN`) is the opening and Reset view, so the whole tree is in view first and zooming in reads the techs at full size with 2x the room.
### Tests
- `tests/elevationtint.test.ts`, `tests/fishtileoutline.test.ts`, `tests/techworldspan.test.ts` (new).
### Not verified
- Not seen in the game: heat map contrast on a real board, the fish outline colour against the sea, and how the tech tree looks at the fit view (techs are half size there; captions keep their size).

## 2026-11-01 (Pass 103: Bug List fixes — Bug 3 tech tree zoom cost threshold & counter-scale, Bug 13 sturdy and rickety bridge designs, Bug 14 big-map pan/zoom optimization; headers, index, typecheck and all tests passed)
### Fixed
- **Bug 3 (`src/client/techView.ts`, `src/client/render/techpanel.ts`)**: raised `COST_MIN_SCALE` from `0.85` to `1.25` so at the default whole-tree overview (`scale = 1`, where all rings are visible as in `BUGS/Image/2.png`), `costsVisible(1)` is `false` and the cost strips stay hidden until the player zooms in (`>= 1.25`) or hovers/focuses a single node; counter-scaled `#techPanel .tp-cap` with `scale(var(--tp-inv, 1))` (`transform-origin: 50% 0`) so zooming in separates the nodes in screen space while keeping captions and cost cards at a compact 1x size instead of ballooning over neighboring nodes; widened `PATH_ANGLE_DEG` from `±8.5°` to `±11.5°`.
- **Bug 13 (`src/client/icons.ts`, `src/client/render/board.ts`, `src/client/render/bridgepicker.ts`, `src/client/styles.css`)**: replaced the old road line + perpendicular white rim ticks and uneven `stroke-dasharray: 9 5` with `bridgeEdgeMarkup(pieceType, col, x1, y1, x2, y2)` in rotated edge coordinates:
  - **Normal bridge (`bridge`)**: bold player-colored outer frame (`.bridge-frame`, `fill: col`) inside a light silhouette rim (`.bridge-rim-casing`), dark timber deck recess (`.bridge-bed`, `var(--pier-dark)`), 5 uniform flat timber planks (`.bridge-plank`, `var(--pier)`) inset cleanly inside the side rails, and 4 corner bollard posts (`.bridge-post`).
  - **Rickety bridge (`rickety_bridge`)**: twin player-colored side ropes (`.bridge-rope`, `stroke: col`) over a water gap (`.bridge-gap`), 4 uniform tilted wooden stepping slats (`.bridge-plank.rickety`, `fill: var(--pier); stroke: col`), and 4 corner rope knots, plus a distinct `rickety_bridge` UI icon in `bridgepicker.ts`.
- **Bug 14 (`src/client/render/board.ts`, `src/client/main.ts`, `src/client/cursors.ts`, `src/client/styles.css`)**:
  - Removed the universal `svg#boardSvg.is-panning *` CSS selector (which forced Blink to recalculate styles across 10,000+ SVG child elements at the start and end of every pan) and replaced it with `pointer-events: none; shape-rendering: optimizeSpeed; text-rendering: optimizeSpeed;` on `svg#boardSvg.is-panning` plus `contain: layout paint` on `svg#boardSvg`.
  - Scoped `--building-scale` to `#boardVerticesLayer` and `#boardPieceSpotsLayer` and `--road-scale` to the road layers (`#roadHighlightLayer`, `#roadRimsLayer`, `#roadBodiesLayer`, `#roadHitsLayer`, `#roadSpotsLayer`) instead of `#boardSvg`, preventing zoom updates from invalidating styles on `#boardTerrainLayer`.
  - Batched non-paintable lobby water cells into a single `<path>` instead of hundreds of individual `stroke-dasharray` `<polygon>` elements, disabled `pointer-events` and inline mouse handlers on `#boardTerrainLayer` when `!canPaintHex`, added dirty-check keys (`lastHexDynamicHtml`, `lastRoadSpotsHtml`, `lastVerticesHtml`), extended `spot-static` animation suppression to `.road-spot-line` and `.road-spot-dot` on big maps (`vertices.length > 120`), cached `#boardSvg`'s `DOMRect` across `wheel`/`mousemove` ticks, and skipped `getScreenCTM()` in `cursors.ts` while panning.
### Tests
- `tests/techpanelview.test.ts`: updated Bug 3 tests verifying `costsVisible(1)` is `false` at the default overview and `true` at `COST_MIN_SCALE` (`1.25`) and above.
- `tests/tideboundrickety.test.ts`: added 3 tests covering sturdy `bridgeEdgeMarkup('bridge', ...)`, rickety `bridgeEdgeMarkup('rickety_bridge', ...)` + `uiIcon('rickety_bridge')` (Bug 13), and big-map pan/zoom CSS/DOM invariants (Bug 14).

## 2026-11-01 (Pass 102: Bug 6 new pirate icon built from glyph parts; NOT run, no shell)
### Fixed
- **Bug 6 (`src/client/pirateIcon.ts` new, `src/client/render/pirates.ts`)**: the pirate was a flat off-white sailboat. It is now a wine-crimson badge (`.pirate-face`, dark glyphs) built from the supplied SVGs: head slot (`pirate-skull`, `blade-bite`), bottom slot (`crossed-sabres`, `crossed-bones`), and a left and a right side decorator (`blunderbuss`, `cannon-ball`, `cannon-shot`, `curled-tentacle`, `sail`, `sparky-bomb`) rolled independently, so both sides may match. The left glyph is mirrored so directional parts face outward. The roll is `pirateLook(id)`, a pure hash of the pirate id (FNV-1a plus a seeded stream): UI only, no game state, no `g.rng`, nothing in `server/` or `shared/`, golden snapshot untouched. The badge is 54 units wide (old ship 34, so about 1.5x); the strength badge stays underneath, moved down to clear it; the drive-off ring grew to fit. `pirateMarkup(strength, fleeing, id)` takes the id as a new last argument. Glyph paths are inlined with the black background square of each file removed.
### Tests
- `tests/pirateicon.test.ts` (new): 9 tests (same id same look, parts from the lists, every part used, sides independent, badge face plus four glyphs with the left mirrored, no background square, board layer markup and strength badge, ring size, size ratio).
### Not verified
- Nothing was run in the repo (no shell). The new test file was run against a copy of `pirateIcon.ts` and `pirates.ts` with stubbed browser imports, and the two files typechecked on their own; `npm run headers:write`, `npm run index`, `npm run typecheck` and `npm test` have not been run. Not seen in the game: legibility at real zoom, and crowded sea tiles (fish or wreck sharing the tile with a pirate): `hexIconLayout` slots were left as they are (a test pins them) and the bigger icon may touch a neighbour there.

## 2026-11-01 (Pass 101: Bug List 2 and 3, tech tree pan and zoom, costs only when zoomed in; NOT run, no shell)
### Fixed
- **Bug 2 (`src/client/render/techpanel.ts`, new `src/client/techView.ts`)**: the tree could not be zoomed or moved. The stage is now a clipped viewport (`.tp-stage`) around a `.tp-world` that takes a CSS transform. Drag to pan (a press that moves under 5px is still a click, and the click that ends a drag is swallowed so it does not research a tech), wheel to zoom about the cursor, two-finger pinch, and `-`, `+` and `Reset view` buttons in the panel head. The view lives in a module variable and is written to the DOM by `applyView` after each redraw, so a redraw does not reset it; opening the panel resets it. Listeners sit on the panel (never replaced), so `main.ts` needs no new global. `techView.ts` holds the pure maths: `clampScale` (0.4 to 3), `clampView` (a bigger world cannot be dragged past its edges, a smaller one stays inside), `zoomAt` (the point under the cursor stays put), `panBy`, `viewCss`.
- **Bug 3 (`src/client/render/techpanel.ts`, `src/client/techView.ts`)**: costs under the techs now hide when zoomed out. `costsVisible(scale)` is true from `COST_MIN_SCALE` (0.85, a judgement call; the opening view is 1, so costs show there). `applyView` toggles a `tp-far` class on the stage and CSS hides `.recipe-cards-strip` inside `.tp-cap` while it is set. Names stay visible.
- Tooltips: counter-scaled with `scale: var(--tp-inv)` (set to `1 / scale`, with a transform origin per tooltip position) so a description stays the same size at any zoom. They are hidden while dragging.
### Tests
- `tests/techpanelview.test.ts` (new): 13 tests for the pure maths (default view, scale limits, zoom keeps the cursor point, zoom out and back, no pan at scale 1, pan clamped to the edges, smaller world stays inside, no size yet, `viewCss`) and the Bug 3 threshold (`costsVisible` at the default, at the threshold, below it, and the threshold sits between the smallest scale and 1).
### Not verified
- Nothing was run (no shell). The DOM half (drag, wheel, pinch, buttons, click swallow, the `tp-far` class, tooltip scale) has no automated test and has not been tried in a browser. A tooltip near the edge of the stage is clipped by the viewport.

## 2026-11-01 (Pass 100: Bug List fixes — Bugs 15, 10, 11, 1, 12, 8, 16, 17, 9, and 5; headers, index, typecheck and all tests passed)
### Fixed
- **Bug 15 (`src/server/turnHistory.ts`)**: removed the `robberMoved` live-log action push (which read `d.hexId` instead of `d.to`, producing `"Hex undefined"` and redundant `"Moved Robber to hex #..."` lines) and suppressed the engine-note fallback on `move_robber` / `robberMoved` so the live log only records who robbed who on `steal`.
- **Bug 10 & Bug 11 (`src/client/render/overlay.ts`, `src/packs/tidebound/tides.ts`)**: removed `stroke:var(--ov-${o.id}-line)` from `<pattern>` and set `stroke="none"` (`style="fill:var(--ov-${o.id}-tint);stroke:none"`) on the pattern `<rect width="24" height="14">` so the `<rect>` no longer inherits a stroke that drew a 24×14 grid of vertical and horizontal lines over flooded tiles; darkened `floodOverlayKind` (`rgba(21, 62, 112, 0.56)` light / `rgba(18, 54, 102, 0.62)` dark, high-contrast wave line) and `floodWarnOverlayKind` (`rgba(29, 78, 137, 0.30)` / `0.34`) to match robber-selection filter visibility.
- **Bug 1 (`src/client/render/sidebar.ts`, `src/client/styles.css`)**: fixed signature collision where `toggleLogFilter(null)` reset `lastFilterBarSig = ''` and `renderFilterBar()` computed `sig = ''` when `logFilter` was `null`, causing `if (sig === lastFilterBarSig && bar.innerHTML.length > 0) return;` to bail out early without removing the active filter tag from `#logFilterBar`. Replaced empty-string reset with `'__dirty__'`, distinguished active vs empty signatures (`active:${logFilter}` vs `'none'`), bypassed `hasSelectionIn` when dirty, split filter keys on the first `:` only (`splitFilterKey`), and added `.lf-top-row`, `.lf-cat-row`, `.lf-rs-group`, and `.lf-x` layout rules.
- **Bug 12 (`src/packs/tidebound/wrecks.ts`, `src/packs/tidebound/index.ts`)**: doubled shipwreck base card ranges (`WRECK_SEA_MIN_CARDS = 6`, `WRECK_SEA_MAX_CARDS = 10`, `WRECK_SHORE_MIN_CARDS = 2`, `WRECK_SHORE_MAX_CARDS = 4`), added `wreckRoundBonus(round) = Math.floor(0.7 * round)` (`1->0, 2->1, 3->2, 4->2, 5->3`) to `computeWreckLootCount`, and updated `claimWreck` so unforced shipwrecks fill `wantedCards` with random picks across the 5 basic resources in the bank using the derived wreck RNG stream (`ensureWreckRng`, zero `g.rng` draws).
- **Bug 8 (`src/packs/base/actions/roll.ts`, `src/shared/tileState.ts`)**: wired `rollAction` through `matchingHexesForRoll` and `runProductionPipeline` (instead of a local `produce` helper that bypassed tile states) and updated `DEFAULT_TILE_STATES.flooded` from `blocksProduction: true` to `yieldMultiplier: 0.5, yieldRound: 'ceil'` so flooded tiles yield half resources rounded up per building (`settlement 1 -> 1`, `city 2 -> 1`, `castle 3 -> 2`).
- **Bug 16 (`src/packs/tidebound/fishing.ts`, `src/packs/base/techEffects.ts`, `src/client/render/techpanel.ts`, `src/client/actions.ts`, `public/index.html`)**: added `hasBuildingForNet` in `canPlaceNet` so a player must own a Settlement or City first before placing a Fishing Net, updated `groundWorkSourceError` (`(reg.pieces.get(pc.type)?.produces || 0) > 0` instead of `target === 'vertex'`) so a Fishing Net is not treated as a Settlement/City for Ground Work tile modification, and updated the `tidebound.fishing_nets` tooltip in `techpanel.ts`, `#btnBuildNet` tooltip, and the net build-mode toast to clearly state that a Fishing Net requires a Settlement or City first and acts as a coastal tile modification.
- **Bug 5, Bug 9, & Bug 17 (`src/client/icons.ts`, `src/client/render/board.ts`, `src/client/render/pirates.ts`)**: added `hexIconLayout` so when a fish ground shares a sea tile with a pirate or sea shipwreck, each icon moves into a predetermined non-overlapping corner slot (`fish: (-24, -16)`, `sea wreck: (22, -16)`, `pirate: (20, 10)`); shifted shore shipwrecks into left/right coastal flank slots (`dx = ±34`) so they stay `>= 35px` clear of the tile's number token at `(0, +22)` and resource glyph at `(0, -24)` across all 6 axial shore directions; updated `wreckMarkup` to display `${rounds}R` and render an urgent 1-round expiration ring (`wreck-countdown-urgent` / `wreck-urgent-ring`) when `countdown <= 1`.
### Tests
- `tests/turnhistory.test.ts`: updated robber/knight tests for Bug 15 (no `"Moved Robber to hex #..."` or `"undefined"` lines) and added DOM regression test for Bug 1 (`toggleLogFilter(null)` clears `#logFilterBar` and `describeActiveFilter('val:3:1')`).
- `tests/tideboundtides.test.ts` & `tests/clankerton_s0.test.ts`: updated overlay CSS/pattern assertions for Bugs 10 & 11 (`stroke:none` on `<rect>`, no stroke on `<pattern>`, darker blue tints) and updated flooded production tests for Bug 8 (`settlement 1->1`, `city 2->1`, `castle 3->2`).
- `tests/tideboundwrecks.test.ts`: updated `T9d` tests and added multi-resource storm wreck test for Bug 12, plus `hexIconLayout`, `renderPiratesMarkup`, shore number clearance, and `1R` urgent badge tests for Bugs 5, 9, and 17.
- `tests/tideboundnets.test.ts`: added placement test verifying `canPlaceNet` requires a settlement or city of yours first before placing a net (Bug 16).

## 2026-11-01 (Pass 99: BUG 5 stacked cost cards with a 4-card tally cap; headers, index, typecheck and tests passed when run by the user)
### Fixed
- **BUG 5 stacked cost cards (`src/client/pieceModel.ts`, `src/client/render/hand.ts`, `src/client/render/techpanel.ts`, `src/client/styles.css`)**: a cost drew one card per unit in a row. New `costStackHtml(resource, count, owned)` draws one resource as overlapped stacks: the first card in front, each card behind it shifted right and down so the visible edges count the cards. A stack holds at most `COST_STACK_MAX` (4) cards; a bigger count continues in another stack, like a tally (6 is 4 + 2, 12 is 4 + 4 + 4). The first `owned` units are lit and the rest dim, counted across stacks. No number is shown on a stack. `stackSizes` does the split.
- Callers moved to the helper: `recipeStripHtml` (generated build buttons), `renderRecipeStripHtml` in `hand.ts` (hand-written buttons, the 2x badge stays), and `costStripHtml` in `techpanel.ts` (tech costs, Harbor charters, and the bridge picker that reuses it). The live log chips already show one icon plus an amount and are unchanged.
- CSS: `.recipe-stack` and `.recipe-stack > .recipe-mini-card`, sized by `--cw`, `--ch`, `--dx`, `--dy` (the tech panel overrides them for its smaller cards); `.recipe-cards-strip` gap and alignment changed so stacks of different heights line up at the top.
### Tests
- `tests/pieceModel.test.ts`: 8 new tests (`stackSizes` splits and empty cases, N layers for N, 6 is 4 + 2 and 12 is three stacks, lit and dim counted across stacks, empty for zero or an unsafe name, one group per resource in a strip, 12 wood and 1 sheep is four stacks and 13 cards).
- `tests/turnhistory.test.ts` (Pass 98's test, flaky not new): "logs an accepted trade on the turn of the player whose turn it is" assumed Alice moves first, but `createGame` randomizes the turn order, so it failed whenever Bob went first. It now takes the mover from `currentPlayer`. No source change.
### Not verified
- The commands were run by the user and passed. The look of the stacks (offsets, tech panel sizes, the tooltip below a node) has not been checked in a browser.

## 2026-11-01 (Pass 98: bug list 1 to 4 — merged Live Log, dev card detail, no phantom "Passed turn", Tidebound map defaults; typecheck and tests passed when run before Pass 99)
### Fixed
- **BUG 4 phantom "Passed turn" (`src/server/turnHistory.ts`, `src/client/render/sidebar.ts`)**: a player who only answered a trade got an empty turn card, which the client drew as "Passed turn". The recorder now removes a turn it created that stayed empty, the client skips empty cards, and trade replies (`respond_trade`, `counter_trade`) are logged on the turn of the player whose turn it is (an accepted trade now reads from the proposer's side).
- **BUG 3 dev card detail (`src/server/turnHistory.ts`)**: Monopoly says the resource and how many cards came in (or "nothing taken"), once; Year of Plenty picks read "Year of Plenty: picked X"; a Knight's robber move and steal read "Knight moved Robber..." and "Knight stole from X" (until the next roll).
- **BUG 2 one stream (`src/server/turnHistory.ts`, `src/server/game.ts`, `src/client/render/sidebar.ts`)**: the "Stream / Recent Feed" block is gone in game. `takeNewLogLines` hands each engine log line to the recorder once; a line is kept as an `event` action only when its action recorded nothing else (turn order, tides, seat changes). Lines written outside an action are picked up at the next action. Trade chatter is not kept.
- **BUG 1 Tidebound map defaults (`src/server/lobby.ts`, `src/server/socket.ts`)**: turning Tidebound on in `updateSettings` now calls `applyTideboundMapDefaults`: picks `islands` + `wide_water`, radius at least `TIDEBOUND_MAP_RADIUS` (7, a judgement call), fresh seed.
### Tests
- `tests/turnhistory.test.ts`: 9 new tests (trade reply creates no turn, accepted trade attribution, Monopoly detail and nothing-taken, Knight move and steal, steal after a roll is not a Knight steal, Year of Plenty picks, log lines folded in or dropped, `takeNewLogLines` once-only).
- `tests/tideboundmapdefaults.test.ts` (new): 2 tests for the Tidebound lobby defaults (`tests/tideboundlobby.test.ts` is untouched).
### Not done
- BUG 5: done in Pass 99.

## 2026-10-31 (Pass 97: Tidebound T13 — T13a flood/rising-sea vertex scoring, T13b salvage & bridge goals, T13c port/net/fish goals, T13d pirate avoidance & hunting, T13e 9-node tech research, and T13f public-info-only dialogue; typecheck and tests passed)
### Added & Changed
- **T13a Flood & rising-sea exposure in vertex scoring (`src/packs/tidebound/tides.ts`, `src/packs/tidebound/risingSea.ts`, `src/packs/tidebound/index.ts`)**:
  - `tideFloodShareForHex(g, reg, hexId)` computes expected flood fraction (`0..1`) from `tideLevelOf(g)`, coast vs inner cluster reach, and `hexElevation` resistance.
  - `tidesBotGoal` (`BOT_GOALS`: `tidebound.tides`) discounts flood-exposed vertices, penalizes currently `flooded` tiles and flood-idle non-harbor ports, and rewards elevated (`>= 2`) coastal ground.
  - `risingSeaBotGoal` (`BOT_GOALS`: `tidebound.rising_sea`) subtracts production from permanently `drowned` tiles, discounts `lowestElevationFrontierHexIds` and `risingSeaFrontierHexIds` scaled by `risingSeaLevelOf(g)`, and rewards elevated/inland ground.
- **T13b Salvage goal (`src/packs/tidebound/wrecks.ts`, `src/packs/tidebound/ricketyBridges.ts`, `src/packs/tidebound/index.ts`)**:
  - `expectedWreckLootValue(g, pid, site, builtCostCards)` evaluates expected salvage payout using site mean, `wreckTimeMultiplier`, `Salvage crew`, bonus drop odds, and the `builtCostCards + 1` floor rule.
  - `wreckBotGoal` adds `vertexDelta` (port settlements that immediately claim a wreck), 1-step claim and 2-step approach `edgeDelta` & `goals`, and `actionScore` for `demolish_bridge` (only on safe dead-end bridges when `hasTech(g, pid, TECH_SALVAGE_CREW)` and the bot is not a Longest Road contender and needs cards).
  - `ricketyBotGoal.actionScore` prioritizes `upgrade_bridge` when the rickety bridge sits inside a Longest Road contender (`g.awards.longestRoad === pid` or `longestRoad >= 5` or `tidebound.grand_causeway`) or links two parts of the player's network.
- **T13c Port and net placement (`src/packs/tidebound/harbor.ts`, `src/packs/tidebound/fishing.ts`)**:
  - `harborBotGoal` adds `vertexDelta` for port vertices when Harbors are enabled and raises `upgrade_harbor` priority (`82` vs `52`) when the port's adjacent land is currently `flooded` or `drowned`.
  - `netBotGoal` adds `vertexDelta` for coastal vertices with adjacent non-port net spots on fish-boosted sea tiles and weights actual `fishLeft` boosts and `TECH_NET_WORKS`; `fishBotGoal.actionScore` scales `feed_sea` with multiple own nets on the sea tile and allows `spend_fish` to finish a `net` build.
- **T13d Pirate avoidance & hunting (`src/packs/tidebound/pirates.ts`, `src/server/bots/brain.ts`)**:
  - `pirateBotGoal` adds `vertexDelta` (unprotected bots with `knightsPlayed < needed` and `knightsPlayed <= strength` avoid settling within distance 0–2 of a roaming pirate, while armed bots get a bonus on port vertices touching a pirate), `edgeDelta` (+24 for edges touching a pirate the bot is armed to drive off, -3 when unprotected), and `tidebound.pirates.intercept:${hexId}` goals (priority 72) to build a road/bridge to touch an active pirate.
  - `knightBeforeRoll` and `shouldPlayKnight` in `src/server/bots/brain.ts` play a `knight` dev card when an active pirate is on the board so the bot arms up to scare away or drive off pirates.
- **T13e Tech research (`src/server/bots/brain.ts`)**:
  - Updated `techValue` and `pickUpgradePortMove` for all 9 Tidebound tech nodes across the Expansion and Industrial lanes, fixing `salvage_crew` and `pirate_hunter` to inspect active `wreck` and `pirate` markers via `getMarkers`, scaling `rickety_bridges`, `fishing_nets`, `net_works`, `harbor_master`, `grand_causeway`, and `harbor_empire` (`techBuildingValue`) with board state, and enabling `tidebound.harbor_charters` and `upgrade_port` for all bot tiers when Tidebound is active.
- **T13f Public-info-only dialogue lines (`src/server/bots/dialogue/{types,events,context,index}.ts`, `src/server/bots/dialogue/lines/{tidebound,index,table}.ts`)**:
  - Added `'tidebound'` to `MapTrait` (`mapTraits` in `context.ts`) and 7 Tidebound dialogue events (`tideFlood`, `bridgeCollapsed`, `harborBuilt`, `netBuilt`, `wreckClaimed`, `pirateRaid`, `pirateDriven`), with `wreckClaimed`, `pirateRaid`, and `pirateDriven` in `PRIVATE_EVENTS` (`risk: 'private'`).
  - Added `TIDEBOUND_LINES` in `src/server/bots/dialogue/lines/tidebound.ts` (plus `when: { map: 'tidebound' }` start lines in `table.ts`) and wired `emitBotDialogue` in `src/server/bots/dialogue/index.ts` without reading any salvaged or stolen resource fields.
### Tests
- `tests/tideboundbots.test.ts` (new): 12 tests covering T13a (`tideFloodShareForHex`, `tidesBotGoal`, `risingSeaBotGoal`), T13b (`expectedWreckLootValue`, 1-step & 2-step wreck salvage goals, dead-end `demolish_bridge`, `ricketyBotGoal` Longest Road upgrade priority), T13c (port & net `vertexDelta`, flooded port `harborBotGoal` priority, multi-net `feed_sea` scoring), T13d (pirate avoidance `vertexDelta`, pirate intercept `edgeDelta`/goals, `drive_off_pirate`, knight play vs pirates), T13e (bot research across all 9 Tidebound tech nodes), T13f (public-info-only Tidebound dialogue lines and `emitBotDialogue` triggers), and DLC-off zero-effect invariants.

## 2026-10-31 (Pass 96: Tidebound T12 — T12a lowest-elevation-first drowning & T12b optional with Tides, rate settings, and drowned overlays; typecheck and tests passed)
### Added
- **T12a Coast-inward lowest-elevation-first drowning (`src/packs/tidebound/risingSea.ts`, `src/packs/tidebound/index.ts`)**:
  - `DROWNED = 'drowned'` (`DEFAULT_TILE_STATES.drowned`: `blocksProduction: true`, `blocksRobber: true`, permanent with no `until`), `RISING_SEA_FIRST_ROUND = 3`, `RISING_SEA_CADENCE_ROUNDS = 2`, `RISING_SEA_RNG_SALT = 0x52534541`.
  - Independent derived RNG stream `deriveRisingSeaRng(seed)` / `ensureRisingSeaRng(g)` stored in `g.ext.tidebound.risingSeaRng` (zero `g.rng` draws).
  - `risingSeaFrontierHexIds(g, reg)` selects visible non-drowned land hexes touching sea or already-`drowned` land (advancing coast-inward as coastal tiles drown, never reading or exposing hidden fog hexes).
  - `lowestElevationFrontierHexIds(g, reg)` filters the frontier to the lowest `hexElevation` tier (`1` before `2` before `3`), and `pickRisingSeaHex(g, reg)` breaks ties via `ensureRisingSeaRng(g)`.
  - `drownHex(ctx, hexId)` permanently sets `{ id: 'drowned' }` (overwriting temporary `flooded` and surviving `applyTides` drying), emits `tileStateChanged` and `risingSeaDrowned`, and logs the drowned tile.
  - `isPortDrowned(g, reg, vertexId)` (`PORT_IDLE_CHECKS`: `tidebound.rising_sea.drowned`) idles non-harbor ports whose adjacent land hexes are all submerged (`drowned` or `flooded`), while Harbors (`HARBOR_LEVEL = 2`) remain active.
- **T12b Optional with Tides, rate settings, and client overlays (`src/packs/tidebound/risingSea.ts`, `src/server/{types,runtime,lobby}.ts`, `src/client/render/setup.ts`, `src/client/{actions,main}.ts`)**:
  - `tidebound.rising_sea` has no dependency on `tidebound.tides`: works standalone when Tides is off, or alongside Tides when both are on (`applyTides` leaves `drowned` tiles untouched and `tideWarning` skips them).
  - `RISING_SEA_LEVELS` (1 `Very slow` to 5 `Very fast`, default 3 `Medium`: `firstRound: 3, cadence: 2, tilesPerPulse: 1`), `risingSeaLevelDef`, `risingSeaLevelOf`, and `risingSeaConfigOf` (supporting both `rules.risingSeaLevel` 1–5 and direct `risingSeaFirstRound` / `risingSeaCadence` / `risingSeaTilesPerPulse` rule overrides).
  - Lobby setting `Settings.risingSeaLevel` (clamped 1–5 in `mergeSettings`, mapped to `rules.risingSeaLevel` by `rulesFromSettings` only while `tidebound.rising_sea` is enabled and off Medium) and host setup slider (`previewRisingSeaLevel`, `setRisingSeaLevel`, summary pill `Rising sea · <level>`).
  - `risingSeaViewData` (`VIEW_DATA`, `id: 'tidebound.rising_sea.view'`, `priority: 10`) and `risingSeaOverlays(g, reg)`: returns `undefined` when no tile is drowned (preserving `null` `hexOverlays` when Tides is off and leaving `view.snapshot.json` untouched), and marks visible drowned tiles with `{ kind: 'flood', label: 'Drowned' }` at higher priority than Tides.
### Tests
- `tests/tideboundrisingsea.test.ts` (new): 9 tests covering T12a (DLC/addon off zero effect, coast-inward frontier expansion and fog exclusion, lowest-elevation-first ordering `1 -> 2 -> 3`, round-clock cadence and derived RNG determinism with zero `g.rng` draws, permanent `drowned` blocking of production and robber placement, Tides drying survival, and port/harbor idleness) and T12b (standalone operation with `tidebound.tides: false`, combined operation with `tidebound.tides: true`, `risingSeaOverlays` / `mergeViewOverlays` priority, `RISING_SEA_LEVELS` 1–5 clamping and scaling, rule overrides, and lobby `mergeSettings` / `rulesFromSettings`).

## 2026-10-31 (Pass 95: Modular rework R9.2 to R9.4, the lantern proof piece and the docs for it; NOT run, no shell)
### Changed
- `src/packs/_template/lantern.ts` (new, the only new source file): addon `template.lantern` with `lanternPiece` (vertex, price 2 ore + 1 wheat, 1 VP, supply 3 through `rules.pieceLimits`, `canPlace` = empty land corner next to an edge piece you own, and a `visual`: slot `vertex`, button, three hints, a house-like shape with `{color}` and `{dark}`) and `lanternBotGoal` (generic tier, builds on the corner with the most land tiles). No `VIEW_DATA` entry: `base.pieces_view` already sends `pieces[id] = { left, cost, spots }` for any piece with a `visual`. No tip action and no tech node (those stay in `demo.ts`).
- `tests/lantern.test.ts` (new): Rule of Two audit, nothing registered when off, manifest entry (`registryVisualProblems` is empty, plain JSON), `pieces[id]` through `mergeViewPlayer` (broke: `spots: []`; can pay: corners next to the road; other viewer: `spots: null`; off: no `pieces` key), build through `dispatch` (VP +1 through `score`, supply, zero `g.rng` draws, the corner stops being a spot), refusal away from your roads, bot goal and `chooseBotAction` building it with exactly the price in hand.
- Docs: `RECIPES.md` (intro, recipe 1 steps 1, 4, 5, 6, 7: a piece is one file, the old client-glue list is gone and replaced by a note not to copy the hand-written pieces), `ROUTER.md` (New piece row), `CLAUDE.md` (glue bullet), `INDEX.md` (`tests/` row; the `src/` row for `lantern.ts` comes from `npm run index`).
### Deviations from the R9 plan
- The proof lives in the `_template` pack, not in a shipped DLC: `tests/tidebound.test.ts` pins the Tidebound addon list (8 ids) and the `client/render/setup.ts` fallback list, so a 9th Tidebound addon would force edits outside its own file.
- No `VIEW_DATA` entry (the plan listed one): the generic `pieces_view` made it unnecessary.
- `ROUTER.md` still lists the hand-written glue of the net, harbor, feed and bridge pieces in its glue names, `RECIPES.md` recipe 5 and the `client/render/board.ts` and `overlay.ts` notes: R8.8 steps 2 to 6 and R8.9 have not landed, so those lists stay until then. `README.md` unchanged.
### Not done
- Nothing was run (no shell). Commands, one per line: `npm run addons`, `npx vitest run tests/lantern.test.ts tests/template.test.ts`, `npm run headers:write`, `npm run index`, `npm run typecheck`, `npm test`.
- R9.3 browser and bot game, and R9.5 commit: not done. The code of Pass 93 (R8.7) and Pass 94 (R8.8 step 1) was also never run.

## 2026-10-31 (Pass 94: Modular rework R8.8 step 1, migrate `flood` and `flood-warn` overlay kinds onto `OVERLAY_KINDS` and delete their hard-coded client definitions; NOT run, no shell)
### Changed
- `src/packs/tidebound/tides.ts` & `src/packs/tidebound/index.ts`: added `floodOverlayKind` (`id: 'flood'`, `label: 'Flooded'`, light/dark `tint` and `line`, wave `pattern`) and `floodWarnOverlayKind` (`id: 'flood-warn'`, `label: 'Flood warning'`, light/dark `tint` and `line`, dashed wave `pattern`, `pulse: true`), registered via `api.define(OVERLAY_KINDS, ...)` inside `tidesAddon.register` and re-exported from `packs/tidebound/index.ts`.
- `src/client/render/overlay.ts`: added `overlayVarsCss` (`--ov-<id>-tint` and `--ov-<id>-line` for `:root` and `:root[data-theme="dark"]`), `syncOverlayManifest` (keeps `<style id="vis-overlay-vars">` and `<defs id="boardOverlayDefs">` in sync with `manifestRevision()`), dynamic `<pattern id="ov-pat-<id>">` generation in `overlayPatternDefsMarkup`, and manifest lookup (`overlayKind`) in `renderHexOverlaysMarkup` with automatic `label` and `hex-overlay-pulse` class when `pulse` is true. Left the 5 unbuilt-DLC kinds (`wall-incomplete`, `plague`, `wave`, `crack`, `season`) in `BuiltinHexOverlayKind` / `PATTERN_IDS`.
- `src/client/styles.css`: replaced `.hex-overlay-flood-warn .hex-overlay-poly` and `@keyframes floodWarnFlash` with generic `.hex-overlay-pulse .hex-overlay-poly` and `@keyframes hexOverlayPulse`; added `text-anchor: middle; fill: var(--ink)` to `.hex-overlay-label`.
- `tests/tideboundtides.test.ts`, `tests/visualManifest.test.ts`, `tests/visualsEvent.test.ts`: added tests for `flood` and `flood-warn` registration in `OVERLAY_KINDS`, `registryVisualProblems`, `overlayVarsCss`, `overlayPatternDefsMarkup`, and `renderHexOverlaysMarkup` before and after the manifest arrives; updated shipped-registry manifest expectations.
### Deleted
- Hard-coded `'flood'` and `'flood-warn'` entries from `PATTERN_IDS` and `overlayPatternDefsMarkup()` in `src/client/render/overlay.ts`.
- Hard-coded `--flood-tint`, `--flood-line`, `--flood-warn-tint`, `--flood-warn-line`, `.hex-overlay-flood-warn`, and `@keyframes floodWarnFlash` from `src/client/styles.css`.
### Not done
- Nothing was run (no shell). `tests/view.snapshot.json` and `tests/golden.snapshot.json` untouched (`OVERLAY_KINDS` is sent in the `visuals` event, not `gameState`).
- Commands, one per line: `npx vitest run tests/tideboundtides.test.ts tests/visualManifest.test.ts tests/visualsEvent.test.ts`, `npm run headers:write`, `npm run index`, `npm run typecheck`, `npm test`.
- Next: R8.8 step 2 (`net` vertex piece).

## 2026-10-31 (Pass 93: Modular rework R8.7, generic client code for manifest pieces and actions; NOT run, no shell; nothing registers a visual yet, so the game draws as before)
### Changed
- `src/client/pieceModel.ts` (new, pure, no DOM): `buttonModels` (one button per mode, grouped by `button.group`, ordered by `order` then id; an id or group that is not a plain identifier is left out), `buttonVisible`, `badgeFor`, `recipeCostFor`, `recipeStripHtml`, `canPay`, `modeHint` (first match wins: `noSupply`, `cannotAfford`, `noSpots`; for a group the step must hold for every entry on offer; `spots: null` gives no hint), `spotsForMode`, `entriesAtSpot`, `spotMarkup`, `fillShape` (`{color}`, `{dark}`; a non-hex colour becomes grey), `withRim`, `vertexShapeMarkup`, `edgeShapeMarkup`, `placedEntry`, `iconHtml`, `buttonHtml`, `isSafeFragment`, `isSafeCss` (the client's second lock on top of `visualProblems`).
- `src/client/pieceui.ts` (new, the impure half): `renderPieceButtons` (into `#pieceButtons`; rebuilt only when the set, labels or icons change), `syncEntryStyles` (one `<style id="vis-css-<id>">` per entry), `isPieceMode`, `pieceModeHint`, `pieceSpotsMarkup`, `placeAt` (emits `place` for a piece and `act` for an action), `clickSpot(pieceId, loc)` (one handler; `registerSpotChooser(group, fn)` for a spot two grouped entries share, the bridge picker later), `hasPlacedShape`, `placedVertexMarkup`, `placedEdgeMarkup`.
- Wiring: `public/index.html` (`<div id="pieceButtons" class="piece-buttons">` after Road); `src/client/styles.css` (`.piece-buttons { display: contents }`, `.vis-rim`); `src/client/main.ts` (`clickSpot` in `Object.assign(window, ...)`); `src/client/actions.ts` (`setBuildMode` shows `pieceModeHint`); `src/client/render/index.ts` (`renderPieceButtons(badgeTarget, isMyTurn)`); `src/client/render/board.ts` (`#boardPieceSpotsLayer` above the vertices, `isPieceMode` skips the settlement spots, placed shapes through `placedVertexMarkup` and `placedEdgeMarkup`, the settle sound also for a manifest vertex piece).
- `tests/pieceModel.test.ts` (new): buttons, grouping, icons, recipe strip, `canPay`, the hint order including groups, spots (mode, no mode, shared location, no data, chooser), generic markers, shapes and rim, edge placement maths (zero-length segment), `placedEntry`.
- Read-through check (nothing run): every expectation in `tests/pieceModel.test.ts` was traced against `pieceModel.ts`, `icons.ts` (`uiIcon`, `getMiniSvg`, `shade` gives `rgb(179,0,0)` for `#ff0000`) and `shared/visual.ts`; no mismatch found.
### Not done
- Nothing was run (no shell). Commands, one per line: `npx vitest run tests/pieceModel.test.ts`, `npm run headers:write`, `npm run index`, `npm run typecheck`, `npm test`. `tests/view.snapshot.json` and `tests/golden.snapshot.json` must not change (no visual is registered, so `pieces` is undefined and the manifest is empty).
- Likely first failures: `tests/architecture.test.ts` if it dislikes `client/pieceui.ts` importing `client/ui` (the `showToast` import in `pieceui.ts` is unused, delete it if the header check complains); a `BoardGeom` type mismatch where `pieceui.ts` passes `state.board`; `headers.test.ts` until `headers:write` is run for the two new files.
- The hand-written net, harbor, feed and bridge code is untouched on purpose. R8.8 migrates them one by one and deletes each old special case.

## 2026-10-31 (Pass 91: Modular rework R8.3, R8.4, R8.5: visual types, the `visuals` event and the client manifest; NOT run, no shell; no real piece has a visual yet, so behavior is unchanged)
### Changed
- R8.3: `src/shared/visual.ts` (new: manifest types, `OVERLAY_KINDS`, `PiecePlayerData`, `emptyManifest`); `src/shared/registry.ts` (`PieceDef.visual`, `ActionDef.visual`, `ActionDef.price`, `ActionDef.available`); `src/shared/index.ts` exports; `EXTENSION POINTS.md` (piece, action and `OVERLAY_KINDS` rows); `tests/visual.test.ts`.
- R8.4: `src/shared/visualManifest.ts` (new: `buildVisualManifest`, and checks for scripts, event attributes, stray braces, non-JSON values, empty hints, overlay without pattern, duplicate ids, group mixing slots); `src/server/runtime.ts` (`visualToggles`, `visualManifestFor`); `src/server/net.ts` (`syncVisuals` in `broadcastRoom`: before `gameState`, in the lobby and in a game, once per addon-set key per socket, always on a socket's first broadcast); `EXTENSION POINTS.md` (new section "What the server sends besides `gameState`"); `tests/visualManifest.test.ts`, `tests/visualsEvent.test.ts`.
- R8.5: `src/client/visuals.ts` (new: the manifest, safe to read when empty or late, junk gives the empty one, `onVisualsEvent` asks for one re-render only when it changed); `src/client/main.ts` (`socket.on('visuals')`, reset on disconnect); `src/client/types.ts` (`PlayerView.pieces?`); `tests/visuals.test.ts`.
- `Visual Manifest Design.md`: status set to OK; the transport note now says nothing is sent on connect.
### Not done
- Nothing was run (no shell). Commands: `npx vitest run tests/visual.test.ts tests/visualManifest.test.ts tests/visualsEvent.test.ts tests/visuals.test.ts`, `npm run headers:write`, `npm run index`, `npm run typecheck`, `npm test`.
- R8.7 not started. The generic `pieces[id]` data is R8.6 (another agent). `INDEX.md` Root and `tests/` rows for the new files are not added yet (`npm run index` handles the `src/` tables).

## 2026-10-31 (Pass 90: Modular rework R8.2, visual manifest design doc; docs only, no code, nothing to run)
### Changed
- `Visual Manifest Design.md` (new, project root): the manifest types (`shared/visual.ts`, plain data), slots, SVG shape with `{color}` and `{dark}`, button, badge and hint rules, optional `css`, overlay kinds, the tier 2 render module contract, the exact `pieces[id] = { left, cost, spots }` shape (null versus undefined spelled out), server-listed edge spots, the `visuals` event transport, and an open decisions table.
- `Rework Progress.md`: R8.2 set to `[~]` (written, waiting for the owner's OK), Log line added.
### Found while reading
- The brief's three slots are not enough: feed spots are sea tiles, so a `hex` slot is proposed.
- `mergeViewPlayer` keeps only the first entry per top-level key, so `pieces` cannot come from each addon. The design uses one always-on entry in the base pack.
- `hand.ts` recipe popups are per-piece code that the R8.8 deletion list in `Rework Progress.md` does not name (already noted in `R8.1 Findings.md`).
### Not done
- No `src/` file changed. R8.3 to R8.7 wait for the owner's OK.
## 2026-10-31 (Pass 92: Modular rework R8.6 generic per-player piece data `base.pieces_view`)
### Changed
- `src/packs/base/piecesView.ts` (new) & `src/packs/base/index.ts`: added always-on `VIEW_DATA` entry `base.pieces_view` (`piecesViewData`, `piecesForPlayer`, `registerPiecesView`) registered in `basePack.register`. Loops over `reg.pieces` and `reg.actions` with a `visual`, skips entries where `available(g, p.id)` is `false`, returns `pieces: undefined` when no piece or action in `reg` has a `visual`, and populates `pieces[id] = { left, cost, spots }` (`spots` computed only when `who.self && !who.over` and the phase/actor gate allows the action right now; `null` otherwise; `[]` when on turn with nothing legal).
- `tests/piecesView.test.ts` (new) & `INDEX.md`: added 5 tests attaching `visual` in-test to `net`, `rickety_bridge`, `feed_sea`, and `upgrade_harbor`, covering base-game `undefined`, parity with `netSpots`/`feedSpots`/`harborSpots`, `rickety_bridge` ocean-edge validation, absent keys when `available` is `false`, `left: null` for actions, `spots: null` vs `[]`, ascending spots, JSON serialization, and zero `g.rng` draws.

## 2026-10-31 (Pass 89: Modular rework R8.1 findings & R9.1 auto-generated pack addon lists)
### Changed
- **Task A (R8.1)**: Wrote `R8.1 Findings.md` in the project root with exact identifiers and line numbers across 9 sections (`src/client/icons.ts` piece/marker functions and `PieceDef.icon` usage, `public/index.html` build-bar buttons and badges, `src/client/styles.css` and inline per-piece CSS rules, one-paragraph summaries of `bridgepicker.ts`, `pirates.ts`, `drawer.ts`, `hand.ts`, and `techpanel.ts`, `src/server/runtime.ts` `gameRegistry` and `mapRegistryKey` caching, the R8.8 deletion table, placeholder defaults in `lobbyPlayerView` and `renderAll`, variable-`emit` grep hits, and Surprises).
- **Task B (R9.1)**:
  - `scripts/addons.mjs` (new) & `package.json`: added `npm run addons` (`node scripts/addons.mjs`) and `npm run addons:check` (`node scripts/addons.mjs --check`). Scans each DLC folder under `src/packs/<dlc>/` for exported `AddonDef` objects, validates that every addon `id` starts with `<packId>.`, checks for missing dependencies and dependency cycles, and generates `src/packs/<dlc>/addons.generated.ts` in deterministic topological order (preserving Tidebound's exact 8-addon order).
  - `src/packs/tidebound/addons.generated.ts`, `src/packs/_template/addons.generated.ts` (generated) & `src/packs/tidebound/index.ts`, `src/packs/_template/index.ts`: replaced hand-written `addons` arrays with `tideboundAddons` and `templateAddons` imported from `./addons.generated`.
  - `tests/index.test.ts` & `tests/tidebound.test.ts`: added `addons.generated.ts (R9.1)` guard test running `scripts/addons.mjs --check` plus failure-mode checks for stale generated files, dependency cycles, missing dependencies, and wrong pack prefixes; updated `tests/tidebound.test.ts` to compare `src/client/render/setup.ts` fallback Tidebound card ids directly against `mapOptionsView().addons`.
  - Docs: updated `ROUTER.md` (`New addon` row and `Always`), `RECIPES.md` (header and recipe 3 steps 3 and 4), `EXTENSION POINTS.md` (`AddonDef` note and rules), `src/packs/_template/demo.ts` header comment, `INDEX.md`, and `Rework Progress.md`.

## 2026-10-31 (Pass 88: Modular rework R6.4, R6.5, R6.7: the nine events and the piece clicks moved to `act` and `place`; R6.6 skipped on purpose; the user ran Pass 87 clean, this pass NOT run, no shell)
### Changed
- R6.4 (found already done, not edited this pass): `socket.ts` has no handler for `researchTech`, `upgradePort`, `upgradeHarbor`, `upgradeBridge`, `demolishBridge`, `convertTile`, `spendFish`, `feedSea`, `drivePirate`. The client emits `act` for all nine (checked by reading: `techpanel.ts` x3, `drawer.ts` `spendFishPick`, `pirates.ts` `clickPirate` with `drive_off_pirate`, `bridgepicker.ts` upgrade and demolish, `board.ts` `clickFeedSpot` and `clickHarborSpot`). The user's `git grep` for the nine camelCase names in `src/client`, `src/packs`, `src/server`, `tests` and `scripts` found no emit left.
- R6.5, `src/server/socket.ts`: new `place` handler `{ code, piece, loc }` runs `act(code, 'build', { piece, loc }, true)` (`code` and `piece` must be strings, anything else is dropped; `loc` is checked by `validateBuild`). `clickVertex` lost its `piece` parameter and the `NET` branch; `clickEdge` lost its `piece` parameter (road, or bridge on an ocean edge). The `NET` import is gone, so `socket.ts` no longer imports from `packs/tidebound`.
- R6.5, client: `clickNetSpot` (`board.ts`) emits `place` with `piece: 'net'`; `chooseBridgeType` (`bridgepicker.ts`) emits `place` with the chosen piece. `clickVertex` and `clickEdge` in `board.ts` still emit the base events.
- Behavior difference: a net on an occupied vertex used to be dropped silently by the `!v.piece` check, now `canPlace` refuses it and the player sees the reason toast.
- `tests/socketAct.test.ts`: new `place` block. Handler present; `place road` answers like `clickEdge` on the same edge; a `piece` sent to `clickVertex` or `clickEdge` is ignored (twin rooms give the same errors and state); unknown pieces (`__proto__`, `constructor`, ...); eleven junk `loc` values for six pieces (one error, never "Internal error", state unchanged); malformed envelopes (no toast, no `console.error`, no change).
- R6.7 docs: `ROUTER.md` (New piece, New action, New socket event rows and the Glue names `socket.ts` bullet), `RECIPES.md` (recipe 1 step 4, recipe 2 steps 3 and 4, recipe 5 steps 2 and 4, header note), `EXTENSION POINTS.md` (new "What the client sends" section: `act` and `place`). The D note for `clickEdge` is gone.
### Skipped on purpose
- R6.6 (the 22 base game events stay as they are). The traps are in `Rework Progress.md`.
### To run, one command per line
- `npx vitest run tests/socketAct.test.ts`, `npm run headers:write`, `npm run index`, `npm run typecheck`, `npm test`. Then `git grep -nE "emit\('(clickVertex|clickEdge)'" -- src tests scripts` and check that no hit sends a `piece`.
## 2026-10-31 (Pass 88: Merged Live Log & Turn History with RS card icons and click-to-filter, Chat leaf at combined height, and top-right ocean Game Timer & Round HUD)
### Changed
- `src/server/turnHistory.ts` & `src/client/types.ts`: added `TurnActionResource` (`res`, `count`, `dir`) and optional structured fields (`resources`, `piece`, `devCard`, `diceSum`) to `TurnActionItem`; replaced resource emoji strings across productions (all players), discards, bank trades, player trades, monopoly, gold/fish picks, pirate loot, bridge demolition, and sea feeding with structured resource card entries.
- `src/client/render/sidebar.ts`, `src/client/store.ts`, `src/client/main.ts`, `public/index.html`, `src/client/styles.css`:
  - Replaced emoji resource indicators in Turn History & Live Log with mini RS cards (`card-wood`, `card-brick`, `card-sheep`, `card-wheat`, `card-ore`, `card-gold`, `card-fish`, `card-dev`) using SVG glyphs (`th-rs-card`, `th-rs-pill`, `th-inline-rs-word`).
  - Added click-to-filter (`toggleLogFilter`) across resource cards, dice roll badges, piece/action badges, category icons, player avatars/names, and round badges, plus a top filter bar (`#logFilterBar`) with one-click clear.
  - Merged Live Log and Turn History into the **Live Log** leaf (tab 1) and moved **Chat** into the second leaf (tab 2) with an unread message badge, extending `#logSection` to the full combined height of Live Log/Turn History + Chat.
- `src/client/render/turnclock.ts`, `src/server/view.ts`, `public/index.html`, `src/client/styles.css`: added `#gameClockHud` in the top-right ocean of `.board-stage` (next to the Live Log sidebar, outside on the ocean) showing the current round (`Round N`, incremented when all players finish their turn in a cycle) and a live 250ms-polled elapsed game timer (`MM:SS` / `H:MM:SS`) that ticks continuously through both `SETUP` and `PLAYING` anchored to server `elapsedMs` via `performance.now()`.

## 2026-10-31 (Pass 87: Modular rework R6.1 to R6.3: the generic `act` socket event and its test; written and NOT run; nothing moved yet, no shipped behavior change)
### Changed
- `src/server/socket.ts`: one new handler under "Turn actions": `socket.on('act', ({ code, type, payload }) => ...)`. `type` and `code` must be strings (else ignored); `payload` must be a plain object (else `{}`); it calls `act(code, type, payload, true)`, so `dispatch` refuses unknown or illegal types and the reason goes back to the player. No registry pre-check. A malformed envelope (`null`, string, array, missing fields) is dropped silently, and nothing reaches `console.error`. All 25 legacy events are still there.
- `tests/socketAct.test.ts` (new): fake io and fake socket (Bob, `socket.id` = `'b'`), two-player Tidebound game in Bob's main phase. Cases: `act end_turn` equals a direct `runAction`; a refusal sends the engine reason and changes nothing; unknown types (`no_such_action`, `__proto__`, `constructor`, `toString`, empty); malformed envelopes; eleven junk payloads for each of the nine moved action types (one error, never "Internal error", state unchanged); and for each of the nine legacy events, while its handler exists, the same refusal text as `act`. Once R6.4 deletes a handler, its case passes without comparing.
- `INDEX.md`: `socketAct.test.ts` row in the tests table.
### R6.1 findings
- Callers of `runAction` (read, not searched; no content search was available): `server/socket.ts` (`act`) and `server/bots/scheduler.ts` (4 sites: trade timer `cancel_trade`; turn-clock expiry, auto-discard and the forced `end_turn` or bot move; `runBotStep` and its fallback). The `game.ts` header lists only these two as users. Not checked: `tests/`, `scripts/`, `server/bots/sim.ts` (probably `dispatch` direct). Run `git grep -n runAction -- tests scripts src` to confirm.
- Registered action types: 18 base (`build`, `roll`, `buy_dev`, `play_dev`, `bank_trade`, `propose_trade`, `respond_trade`, `counter_trade`, `confirm_trade`, `cancel_trade`, `discard`, `pick`, `move_robber`, `steal`, `end_turn`, `research_tech`, `upgrade_port`, `convert_tile`) and 6 Tidebound (`upgrade_harbor`, `upgrade_bridge`, `demolish_bridge`, `spend_fish`, `feed_sea`, `drive_off_pirate`). `gold`, `fog`, `tides`, `wrecks`, `risingSea` and `tech` register none. Every one of the 24 already has a client event, so the generic handler opens nothing a client could not already send. **`ActionDef.serverOnly` is not added**: no type needs it. Add it when a server-driven action appears (the template's `template_tip_beacon` is client-reachable on purpose).
- Rule that follows: with `act` a client can name any registered type, so every `validate` must treat the payload as untrusted (wrong types, `null`, arrays). The junk test above checks this for the nine moved types.
### The 25 socket game events
| # | Event | Action type | Client payload -> engine payload | Report |
|---|---|---|---|---|
| 1 | `clickVertex` | `build` (or `steal`) | `{ vertexId, piece? }` -> `build { piece, loc }` for a net, a city on your settlement, or a settlement on an empty vertex; `steal { victimId }` in `robber_steal` | build yes, steal no |
| 2 | `clickEdge` | `build` | `{ edgeId, piece? }` -> `{ piece, loc }`; default piece is `bridge` on an edge with no hex, else `road` | yes |
| 3 | `clickHex` | `move_robber` | `{ hexId }` | no |
| 4 | `stealFromPlayer` | `steal` | `{ victimId }` | no |
| 5 | `rollDice` | `roll` | `{}` | no |
| 6 | `endTurn` | `end_turn` | `{}` | no |
| 7 | `buyDevCard` | `buy_dev` | `{}` | no |
| 8 | `researchTech` | `research_tech` | `{ techId }` (same keys) | yes |
| 9 | `upgradePort` | `upgrade_port` | `{ vertexId }` | yes |
| 10 | `upgradeHarbor` | `upgrade_harbor` | `{ vertexId }` | yes |
| 11 | `upgradeBridge` | `upgrade_bridge` | `{ edgeId }` | yes |
| 12 | `demolishBridge` | `demolish_bridge` | `{ edgeId }` | yes |
| 13 | `convertTile` | `convert_tile` | `{ hexId, resource }` | yes |
| 14 | `pickGoldResource` | `pick` | `{ resource }` | yes |
| 15 | `spendFish` | `spend_fish` | `{ resource }` | yes |
| 16 | `feedSea` | `feed_sea` | `{ hexId }` | yes |
| 17 | `drivePirate` | `drive_off_pirate` | `{ hexId }` | yes |
| 18 | `discardCards` | `discard` | `{ discards, wild }` -> `{ cards, wild }` (renamed) | no |
| 19 | `playDevCard` | `play_dev` | `{ cardType, monopolyResource }` -> `{ card, resource }` (renamed) | yes |
| 20 | `bankTrade` | `bank_trade` | `{ give, get }` | yes |
| 21 | `proposeTrade` | `propose_trade` | `{ offer, request }` | yes |
| 22 | `respondTrade` | `respond_trade` | `{ decision, tradeId }` | yes |
| 23 | `counterTrade` | `counter_trade` | `{ offer, request, tradeId }` | yes |
| 24 | `confirmTradeWithPartner` | `confirm_trade` | `{ partnerId, tradeId }` | yes |
| 25 | `cancelTrade` | `cancel_trade` (proposer) or `respond_trade { decision: 'declined' }` (anyone else) | `{ tradeId }`, finds the trade first | no |
- The nine R6.4 moves are rows 8 to 13 and 15 to 17: same payload keys as the engine, all `report = true`, so `act` (always reports) behaves exactly like them.
- Logic events (rows 1, 2, 25) stay on the server. Rows 1 and 2 are cut down in R6.5; R6.6 (the other 22 base events) is skipped on purpose.
### Not run
- Everything. Commands, one per line: `npx vitest run tests/socketAct.test.ts`, `npm run headers:write`, `npm run index`, `npm run typecheck`, `npm test`. `headers:write` adds the `DEPENDS ON` and `USED BY` lists to the new test header only if the script covers `tests/`; `npm run index` should not change the `src/` tables for this pass (no new imports in `socket.ts`).
- Likely first failures: a `validate` that throws on a wrong-typed field (the junk test names the action type and payload, so the fix is in that action's `validate`, not in `socket.ts`); `end_turn` refused or throwing in the hand-built game (swap it for another cheap main-phase action); `createGame` or `buildTopology` arguments if `viewState.test.ts` changed since I copied its fixture.

## 2026-10-31 (Pass 86: Modular rework R7a.6 and R7a.8: new viewState tests, VIEW_DATA docs, template view entry; written and NOT run; no shipped behavior change)
### Changed
- `tests/viewState.test.ts`: new inline-expect blocks (the snapshot file is untouched): a raised port with Tidebound off, the lobby state, tech gates, and each of seven addons off on its own.
- `src/packs/_template/demo.ts`: `demoViewData` (`template.demo.view`, `player`: `beaconsLeft`, `beaconSpots`), registered in `register`; exported from `_template/index.ts`. `tests/template.test.ts`: one new case.
- Docs: `ROUTER.md`, `RECIPES.md`, `EXTENSION POINTS.md` now describe `VIEW_DATA` and `PieceDef.available`; the D notes for `view.ts` are removed. Recipe 5 step 1 holds the three R7a.5 rules (null default at pack level, pack-level fields, per-player gates).
### Checked
- R7a.7: `server/view.ts` has no `../packs/tidebound` import.
### Not run
- (Superseded: the user ran `viewState`, `template`, `headers:write`, `index`, `typecheck` and `npm test` from the project folder, all clean. Pass 85 groups 5 to 12 are green too. R7a is done.)

## 2026-10-31 (Pass 85: Modular rework R7a.5: the Tidebound view groups moved from `server/view.ts` into VIEW_DATA entries; groups 1 to 4 run and green, groups 5 to 12 written and NOT run; no behavior change intended)
### Changed
Each group is one entry (`api.define(VIEW_DATA, ...)`), so a failing snapshot can be traced to a group. `tests/view.snapshot.json` was not touched and `-u` was never used.
- **Group 1, `fishIcons`**: `fishViewData` (`tidebound.fishing.view`, `shared`) in `fishing.ts`, registered in the fishing addon.
- **Group 2, `portLevels`**: `portLevelsViewData` (`tidebound.port_levels`, `shared`) in `harbor.ts`, registered in `tideboundPack.register`, NOT in the harbor addon (see Deviations).
- **Group 3, `wrecks`**: `wreckViewData` (`tidebound.wrecks.view`) in `wrecks.ts`, wrecks addon.
- **Group 4, `pirates`**: `pirateViewData` (`tidebound.pirates.view`) in `pirates.ts`, pirates addon.
- **Group 5, `tide` and `hexOverlays`**: `tideViewData` (`tidebound.tides.view`: `shared` returns `tide`, `overlays` returns the overlays or `undefined`) in `tides.ts`, tides addon. The legacy `?? tideView...` fallback and the `tideView` local are gone; `hexOverlays` is the merged overlays (`null` while no entry takes part, `{}` with Tides on and nothing marked).
- **Group 6, `netsLeft`, `netSpots`**: `netViewData` (`tidebound.fishing.nets_view`, `player`) in `fishing.ts`.
- **Group 7, `feedCost`, `feedSpots`**: `feedViewData` (`tidebound.fishing.feed_view`) in `fishing.ts`.
- **Group 8, `harborCost`, `harborSpots`, `harborsLeft`, `harborTradesLeft`**: `harborViewData` (`tidebound.harbor.view`) in `harbor.ts`, harbor addon.
- **Group 9, `pirateDrives`**: `pirateDriveViewData` (`tidebound.pirates.drive_view`) in `pirates.ts`.
- **Group 10, `bridgeUpgradeCost` and `canDemolishBridge`**: two entries, one per owning addon: `ricketyViewData` (`tidebound.rickety_bridges.view`) in `ricketyBridges.ts` and `bridgesViewData` (`tidebound.bridges.view`) in `bridges.ts`.
- **Group 11, `pieceCosts` filter**: `PieceDef.available` on `net` (`techGate(g, pid, TECH_FISHING_NETS)`, `fishing.ts`) and `rickety_bridge` (`techGate(g, pid, TECH_RICKETY_BRIDGES)`, `ricketyBridges.ts`). The two hard-coded lines in `view.ts` are gone; the filter is `!def.available || def.available(g, p.id)`.
- **Group 12, Grand Causeway bonus**: `grandCausewayViewData` (`tidebound.grand_causeway.view`, `vpBonus`) in `tech.ts`, registered in the bridges addon next to `grandCausewayVpHook`. `view.ts` keeps the base `2`.
- **Null when off (trap 1)**: `tideboundViewDefaults` (`tidebound.view_defaults`, priority -100) in `packs/tidebound/index.ts`, registered in `tideboundPack.register`, supplies `fishIcons`, `wrecks`, `pirates`, `tide` as `null`. Per-player fields need no default (`undefined` when off).
- **Trap 2 (gates)**: each player entry recomputes the old `enginePlayerView` expressions unchanged (`netTechOk`, `feedTechOk`, `harborsOn`, `harborTechOk`, `who.self` where the old line had `self`; `netsLeft`, `harborsLeft` have no `self`, as before).
- **`server/view.ts`**: no import from `../packs/tidebound` any more (R7a.7 in code), `hasTech` import dropped, locals `harborsOn`, `harborTechOk`, `netTechOk`, `ricketyTechOk`, `feedTechOk`, `canDemolish` removed.
### Deviations from the handoff
- **Lobby nulls**: with no game `view.ts` never calls the registry, so the moved public fields would be missing instead of `null` in the lobby state (the snapshot only covers games, so it would not catch it). A temporary `lobbyNulls` (`g ? {} : { fishIcons, portLevels, wrecks, pirates, tide: null }`) keeps the wire format. R8 removes it.
- **`portLevels` is pack-level, not in the harbor addon**: `harborClientView` has no addon check and reads the base port-upgrade ladder (`g.ext.core.portUpgrades`, also written by the base Harbor charters tech), so the old output could be set with the harbor addon off. The entry is registered in `tideboundPack.register` and computes the real value; it has no `null` default.
- **Group 10 is two entries** (the two fields belong to two addons). Group 12 returns a bonus only while `g.awards.longestRoad === pid`, the same guard `view.ts` had, so a bonus is never added for someone who does not hold Longest Road.
- The tide view is built twice per player per broadcast (once for `tide`, once for `overlays`). It is pure; memoize only if it ever shows up in a profile.
### Not verified
- Groups 1 to 3: run by the user, green (`npx vitest run tests/viewState.test.ts`). Group 4: the user answered "done", taken as green. Groups 5 to 12 were written in one go (the user asked to finish the rest), so nothing was run after group 4: not `viewState`, not `headers:write`, `index`, `typecheck` or `npm test`.
- No test covers: a raised port with Tidebound off (the reason `portLevels` is pack-level), the lobby state, or an addon switched off on its own. R7a.6 adds them.

## 2026-10-31 (Pass 84: Modular rework R7a.1 to R7a.4: view data registry on the server, snapshot test; no behavior change intended; typecheck and tests not yet run on this pass)
### Added
- **`src/shared/viewData.ts`**: `VIEW_DATA` keyed registry (`api.define(VIEW_DATA, def)`, no `PackApi` change). `ViewDataDef { id, priority?, shared?, overlays?, player?, vpBonus? }`, plus `mergeViewShared`, `mergeViewOverlays` (one overlay per hex, higher priority wins, ties by lower id; `null` while no entry takes part), `mergeViewPlayer` (undefined values kept), `mergeViewVpBonus` (record keyed by breakdown key). Exported from `shared/index.ts`.
- **`PieceDef.available?(g, pid)`** in `shared/registry.ts`: whether a piece is on offer to a player (shows in `pieceCosts`). Not read by the build action.
- **`tests/viewState.test.ts`**: `makeStateBuilder(room)(viewerId)` for the player on turn, another player and a spectator, Tidebound fully on (net, fish icon, harbor, wreck, pirate, flood, warning, Grand causeway) and off, compared with `tests/view.snapshot.json` (written on the first run). Clock pinned, board summarized, keys sorted.
### Changed
- `server/view.ts` merges the registry into `shared`, `hexOverlays`, each player's view and `vpBreakdown`, and the `pieceCosts` filter honors `PieceDef.available`. Nothing is registered yet, so the output is the same as before. The Tidebound groups move in R7a.5.

## 2026-10-31 (Pass 83: Modular rework R5: template addon, five recipes, CLAUDE.md; no behavior change; typecheck and tests not yet run on this pass)
### Added
- **`src/packs/_template/demo.ts`**: example addon `template.demo` to copy: a vertex piece (`template_beacon`, supply through `rules.pieceLimits`), an action (`template_tip_beacon`, registered in the `main` phase), a tech node (`template.demo_tech`), a client view function (`beaconSpotsView`), a bot goal stub. Registers everything inside `register`; no `g.rng` draws.
- **`src/packs/_template/index.ts`**: `templatePack` (id `template`) that holds the addon so a test can load it. Not in `allPacks`, so it ships nothing.
- **`tests/template.test.ts`**: the template passes `auditAddons`, registers nothing with its DLC or addon off, and builds, tips and reports spots when on.
- **`RECIPES.md`**: five recipes (piece, action, addon, tech node, client overlay) with the files to touch in order, the real file to copy and where hand-written glue still is. The parts it did not open (`board.ts`, `icons.ts`, `client/types.ts`, `setup.ts`) say "search first".
- **`CLAUDE.md`**: read `ROUTER.md` first, never read whole folders, search for a symbol before opening a file, layer rules, header rule, and the commands to run after a change.
### Changed
- `ROUTER.md`: pointers to `RECIPES.md` and the template. `INDEX.md` Docs and `tests/` rows. `README.md` links.

## 2026-10-31 (Pass 82: Modular rework R2 index generator and R4 router docs; no behavior change; typecheck and tests passed: 46 test files, 627 tests)
### Added
- **`scripts/index.mjs`, npm scripts `index` and `index:check`**: rewrites the five `src/` tables in `INDEX.md` (shared, packs, server, server/bots, client) from the `// MODULE:` description of every file. Tables are found by heading; Root, Docs and `tests/` stay hand-written. `--check` exits 1 when `INDEX.md` is stale.
- **`tests/index.test.ts`**: runs `scripts/index.mjs --check`. Fails when a src file is added, moved, deleted or re-described without `npm run index`; import changes never trigger it.
- **`ROUTER.md`**: task kind to the files to open and the file to copy as a pattern, with the hand-written glue (`socket.ts`, `view.ts`, `icons.ts`, `board.ts`) marked.
- **`EXTENSION POINTS.md`**: `AddonDef` fields, every `PackApi` method, the 11 hooks with signatures and call sites, and the 16 keyed registries with their def shapes.
### Changed
- `INDEX.md` intro, Root, Docs and tests rows; `README.md` quick start, folder table and header notes.

## 2026-10-31 (Pass 81: Modular rework R1 to R3: file headers, header and architecture guards, Tidebound bridge cycle removed; no behavior change; typecheck and tests passed)
### Added
- **`scripts/headers.mjs` and npm scripts `headers`, `headers:write`, `headers:check`**: keeps a one-line `// MODULE: what | DEPENDS ON: a, b | USED BY: c, d` header on every `src/**/*.ts` file. The description is hand-written; the two lists are computed from the import graph. `--check` fails on a missing or TODO header, `--check --strict` also on stale lists.
- **`tests/headers.test.ts`**: fails if any file has no header or a TODO description.
- **`tests/architecture.test.ts`**: layer rules (`shared` imports only `shared`; `packs/<x>` imports `shared`, its own pack and `packs/base`; `server` imports `server`, `shared`, `packs`; `client` imports `client`, `shared`) and a cycle check that ignores type-only imports. `KNOWN_CYCLES` holds the two existing cycles (client `actions` with `render/*`, server `bots/scheduler` with `net` and `view`); a new cycle fails, and a fixed one must be deleted from the list.
- **`src/packs/tidebound/bridgeConsts.ts`**: leaf module with `BRIDGE`, `BRIDGE_BASE_LIMIT`, `BRIDGE_COST`.
- **`src/packs/tidebound/bridgeCore.ts`**: `isOceanEdge`, `canPlaceBridge`, `bridgePiece`, `bridgeBotGoal`, moved out of `bridges.ts` unchanged.
- **Docs**: `Modular Rework Plan.md`, `Rework Progress.md`, `Handoff - Modular Rework.md`.
### Fixed
- **13 Tidebound test failures (rickety bridge supply was `undefined` / `NaN`)**: `bridges.ts` and `ricketyBridges.ts` imported each other, so `ricketyBridges.ts` read `BRIDGE_BASE_LIMIT` before `bridges.ts` had defined it. The constants moved to `bridgeConsts.ts`.
### Changed
- `ricketyBridges.ts` imports the bridge rule, piece and bot goal from `bridgeCore.ts`, and `tech.ts` imports the constants from `bridgeConsts.ts`, so `bridges`, `ricketyBridges` and `tech` no longer form an import cycle. `bridges.ts` re-exports the moved names, so existing imports are unchanged.
- All 140 file headers rewritten to the new format (header comments only).
- `INDEX.md` and `README.md` describe the new header format, scripts and tests.

## 2026-10-30 (Pass 80: Tidebound T11a tech tree fork layout & cost divisor, T11b techGate helper, T11c nodes 1–3, T11d nodes 4–6, T11e nodes 7–9, T11f demolish_bridge, Grand Causeway & Harbor Empire; typecheck and tests passed)
### Added
- **T11a Tech tree fork layout, `path` field, and 25+ VP cost divisor (`src/shared/stage1.ts`, `src/client/types.ts`, `src/client/render/techpanel.ts`)**:
  - Added `export type TechPath = 'expansion' | 'industrial'` and widened `tier` to `1 | 2 | 3 | 4` on `TechDef`, `TechRow`, `TechRowView`, and `techCostCards`.
  - Updated `layout(rows, branches)` in `src/client/render/techpanel.ts` so branches fork into two parallel lanes (`'expansion'` at `-8.5°` and `'industrial'` at `+8.5°`, `17°` separation) with concentric ring depth derived from the prerequisite chain (`ringOf(r)` = 1 for root, 2 for Tier 2, 3 for Tier 3a, 4 for Tier 3b, 5 for Tier 4), compact `.tp-deep` styling when `maxRing >= 4`, Tidebound icons in `TECH_ICONS`, and path badge (`Expansion · Tier ...` / `Industrial · Tier ...`) in node tooltips.
  - `techCostCards` scales the building-value divisor as `Math.max(TECH_COST.divisor, Math.round(0.3 * vpToWin))` so 25–30 VP games (`divisor = 8..9`) do not inflate tech prices.
- **T11b `techGate` helper (`src/shared/stage1.ts`, `src/packs/tidebound/tech.ts`)**:
  - `techGate(g, pid, techId)` returns `true` when `!g.rules?.techTreeOn || hasTech(g, pid, techId)`, leaving all Tidebound content ungated when the tech tree is off and gating each feature behind its node when the tech tree is on.
- **T11c Nodes 1–3 (`tidebound.harbor_charters`, `tidebound.rickety_bridges`, `tidebound.fishing_nets`) (`src/packs/tidebound/tech.ts`, `src/packs/tidebound/ricketyBridges.ts`, `src/packs/tidebound/fishing.ts`, `src/packs/base/techEffects.ts`, `src/packs/base/actions/techActions.ts`)**:
  - `tidebound.rickety_bridges` (Tier 2, `expansion`, `costOffset: 3`): gates `rickety_bridge` build and `upgrade_bridge`, and raises the player's normal bridge limit before 2x price (and total supply cap) by `RICKETY_TECH_CAP_BONUS = 4` (`10 -> 14`, synced on unlock via `syncBridgePool`).
  - `tidebound.fishing_nets` (Tier 2, `industrial`, `costOffset: 3`): gates `net` build, and allows `upgrade_port` (`Harbor charters`) to raise a `3:1` generic port with a **settlement** (not just a city) to `2:1` for all resources (`harborCharterModifier`, `techActionsFor`, `upgradePortAction`, and `harborHtml` in `techpanel.ts`).
- **T11d Nodes 4–6 (`tidebound.salvage_crew`, `tidebound.net_works`, `tidebound.pirate_hunter`) (`src/packs/tidebound/tech.ts`, `src/packs/tidebound/wrecks.ts`, `src/packs/tidebound/fishing.ts`, `src/packs/tidebound/pirates.ts`)**:
  - `tidebound.salvage_crew` (Tier 3a, `expansion`, `costOffset: 5`, prereq `rickety_bridges`): +25% shipwreck loot (`SALVAGE_CREW_LOOT_MULT = 1.25`), higher sea-wreck dev card drop chance (`WRECK_SEA_DEV_TECH_CHANCE = 0.25`), and unlocks `demolish_bridge`.
  - `tidebound.net_works` (Tier 3a, `industrial`, `costOffset: 5`, prereq `fishing_nets`): registers `netWorksCostMod` (`COST_MODS`, `-1 wood` on `net`), raises unboosted net catch chance to `NET_WORKS_CATCH_CHANCE = 1/4` and boosted catch chance to `NET_WORKS_BOOSTED_CHANCE = 1/2`, and gives a `NET_WORKS_SAVE_BOOST_CHANCE = 1/3` hash draw on a boosted catch not to consume a fish boost.
  - `tidebound.pirate_hunter` (Tier 3b, `expansion`, `costOffset: 7`, prereq `salvage_crew`): reduces played knights needed to drive off a pirate by `2` (minimum `1` via `pirateKnightsNeeded`) and increases pirate loot by `+50%` (`driveOffPirateAction`).
- **T11e Nodes 7–9 (`tidebound.harbor_master`, `tidebound.grand_causeway`, `tidebound.harbor_empire`) (`src/packs/tidebound/tech.ts`, `src/packs/tidebound/harbor.ts`, `src/packs/tidebound/fishing.ts`)**:
  - `tidebound.harbor_master` (Tier 3b, `industrial`, `costOffset: 7`, prereq `net_works`): gates `upgrade_harbor` (1:1 Harbor upgrade, up to 4 trades/turn) and `feed_sea` (Feed the Sea).
  - `tidebound.grand_causeway` (Tier 4, `expansion`, `costOffset: 10`, prereq `pirate_hunter`) and `tidebound.harbor_empire` (Tier 4, `industrial`, `costOffset: 10`, prereq `harbor_master`) registered in `TIDEBOUND_TECH_DEFS`.
- **T11f `demolish_bridge` action, Grand Causeway 16 VP, and Harbor Empire (`src/packs/tidebound/bridges.ts`, `src/packs/tidebound/tech.ts`, `src/packs/tidebound/harbor.ts`, `src/server/view.ts`, `src/server/socket.ts`, `src/server/bots/brain.ts`, `src/client/render/bridgepicker.ts`, `src/client/render/board.ts`, `src/client/main.ts`)**:
  - `demolish_bridge` (`DEMOLISH_BRIDGE`, `{ edgeId }`, main phase): requires `hasTech(g, pid, 'tidebound.salvage_crew')`, removes the player's own `bridge` or `rickety_bridge`, refunds `Math.floor(paidCards / 2)` cards from the bank (`bridgeDemolishRefund`), calls `syncBridgePool(g, pid)` and `updateAwards(ctx)`, and wires `demolishBridge` socket event + `Demolish bridge` button in `bridgePicker`.
  - **Grand Causeway (`grandCausewayVpHook`, `grandCausewayBonusVp`, `longestRoadHasBridge`)**: grants `+14` public VP (`GRAND_CAUSEWAY_BONUS_VP = 14`, making Longest Road worth `GRAND_CAUSEWAY_VP = 16` VP total) while the player holds Longest Road and has at least one `bridge` or `rickety_bridge` in their longest road chain; immediately drops back to `0` if Longest Road or its bridge is lost.
  - **Harbor Empire (`harborLimitFor`, `grantHarborEmpireCards`, `deriveHarborEmpireRng`)**: raises the player's Harbor limit from `1` to `2` (`2` Harbors total) and immediately grants `Math.ceil(V / 2)` random resource cards from the bank on unlock using a derived RNG stream (`deriveHarborEmpireRng`, zero `g.rng` draws).
### Tests
- `tests/tideboundtech.test.ts` (new): covers T11a fork layout & 25+ VP cost divisor, T11b `techGate`, T11c nodes 1–3 (`rickety_bridges` gate & +4 pool cap, `fishing_nets` gate & settlement 3:1->2:1 port upgrade), T11d nodes 4–6 (`salvage_crew` +25% wreck loot, `net_works` -1 wood cost, `pirate_hunter` -2 knights & +50% loot), T11e `harbor_master` gating `upgrade_harbor` & `feed_sea`, and T11f `demolish_bridge`, Grand Causeway 16 VP, and Harbor Empire (`harborLimitFor = 2` + `ceil(V / 2)` bank cards with zero `g.rng` draws).

## 2026-10-30 (Pass 79: Tidebound T10a pirate marker, T10b strength and drive off, T10c rob 2x, T10d flee mode and avoiding stronger players; typecheck and tests ran and yield no error)
### Added
- **T10a Pirate marker, max 2, ocean only, random move (`src/packs/tidebound/pirates.ts`)**:
  - `tidebound.pirate_raid` event card in `EVENT_CARDS` (1 copy); when `rules.eventsOn` is off, `onRoundStart` spawns the first pirate on round `PIRATE_FIRST_ROUND = 4`, then every `PIRATE_CADENCE_ROUNDS = 4`.
  - Public `pirate` markers (no countdown, they stay until driven off), at most `PIRATE_MAX = 2` across the table, on ocean tiles only (`isWreckSeaHex`) within `WRECK_MAX_PLAYER_DIST = 4` tiles of a player. Own derived RNG stream (`derivePirateRng` / `ensurePirateRng`, `g.ext.tidebound.pirates.rng`), zero `g.rng` draws.
  - Each round start every pirate takes one random step to a free neighbouring sea tile (`pirateRoundStep`); a new pirate does not move or rob until the next round.
- **T10b Strength and knights needed (`pirates.ts`)**: `pirateStrengthAt` (1 at first, +1 every `PIRATE_GROWTH_ROUNDS = 6` rounds after round 4, cap 5, refreshed on every pirate each round). `drive_off_pirate` (`{ hexId }`, main phase) needs played knights (the Largest Army count) equal to the strength (`pirateKnightsNeeded`, 2 fewer with Pirate hunter, never below 1) and a road, bridge or port touching the tile (`playerTouchesWreck`). Loot is `PIRATE_LOOT_BASE + strength` cards of one resource from the bank (`pirateLootCards`, +50% with Pirate hunter); `piratesDriven` stat.
- **T10c Rob 2x (`pirates.ts`)**: after its step a pirate robs every settlement and city touching its tile for `PIRATE_ROB_CARDS = 2` random cards each (the robber takes 1), paid to the bank. Emitted as `transferred` kind `pirate` (not `steal`, so the history and bot grudges do not read it as a player taking a card), plus `pirateRobbed` in the public history. `piratesRobbedCards` / `piratesRobbedTimes` stats.
- **T10d Flee mode and avoiding stronger players (`pirates.ts`)**: after a rob the pirate decides each round between robbing again and fleeing; the flee chance starts at `PIRATE_FLEE_BASE` 0.1, rises by `PIRATE_FLEE_ROB_STEP` 0.3 after EVERY rob, plus up to `PIRATE_FLEE_CLOSE_STEP` 0.3 when the victim's knights are close to its strength (cap 0.95). Fleeing runs up to 2 tiles a round away from the robbed city until it is `PIRATE_FLEE_DISTANCE` 2 tiles off, and does not rob on the way. A pirate never spawns on or steps into a tile within `PIRATE_AVOID_RADIUS` 2 of a settlement or city of a player with MORE played knights than its strength (`guardedVertices`, `isGuardedHex`).
- **Client and wiring**: `pirateClientView` (public `pirates` in the `gameState`: id, tile, strength, mode) and `pirateDriveView` (your own `pirateDrives` on your main-phase turn); socket `drivePirate`; `client/render/pirates.ts` (ship markup with a strength badge, bobbing, calmer sails while fleeing, a pulsing ring and click on the pirates you can drive off, its own styles); `boardPiratesLayer` in `render/board.ts`; `clickPirate` bound in `client/main.ts`; client types `PirateView`, `pirates`, `piratesDrives` and transfer kind `'pirate'`; turn history lines for `pirateSpawned`, `pirateRobbed`, `pirateFleeing`, `pirateDriven`; `pirateBotGoal` (drives off a pirate whenever it can). Repaired a broken edit in `render/board.ts` (the `HexGeomCache` interface line).
- Tests: `tests/tideboundpirates.test.ts`.

## 2026-10-30 (Pass 78: Tidebound T9a storm event & wreck marker, T9b 65/35 sea/shore fair spawn within 4 tiles, T9c connecting road/bridge/port claim, T9d loot floor rule & slow scaling, T9e two spawn animations; typecheck and tests passed)
### Added
- **T9a Storm event & wreck marker (`src/packs/tidebound/wrecks.ts`)**:
  - `stormEventCard` (`id: 'tidebound.storm'`, `copies: 2`, `pack: 'tidebound.wrecks'`) registered in `EVENT_CARDS` (`drawAndApplyRoundEvent` triggers `spawnStormWreck`; `peekNextEvent` previews `'Storm at Sea'`). When `rules.eventsOn` is false, `onRoundStart` spawns a passive storm wreck every `STORM_CADENCE_ROUNDS = 3` rounds starting at `STORM_FIRST_ROUND = 3`.
  - Uses an independent derived RNG stream (`deriveWreckRng` / `ensureWreckRng` stored in `g.ext.tidebound.wrecks.rng`), drawing zero values from `g.rng`.
  - Spawns a timed marker (`kind: 'wreck'`, `target: 'hex'`, `countdown: WRECK_COUNTDOWN_ROUNDS = 4`, `public: true`) via `addMarker`; `tickMarkers` decrements and removes unclaimed wrecks after 4 rounds.
- **T9b Sea/shore 65/35 placement & fair spawn within 4 tiles (`src/packs/tidebound/wrecks.ts`)**:
  - `pickWreckHex` rolls `WRECK_SEA_CHANCE = 0.65` (`'sea'` 65% vs `'shore'` 35%, falling back to the other site type if needed).
  - `wreckCandidates` restricts spawns to non-hidden sea/shore tiles within `WRECK_MAX_PLAYER_DIST = 4` hexes of at least one player (`minPlayerDistanceToHex <= 4`).
  - Fairness ranking prefers untouched tiles first, then tiles reachable within 4 hexes by the most players, then tiles with the smallest inter-player distance spread (`maxDist - minDist`) and a racing distance around 2 hexes.
- **T9c First connecting road, bridge, or port claims the wreck (`src/packs/tidebound/wrecks.ts`)**:
  - `playerTouchesWreck` checks whether a player owns a road, bridge, or rickety bridge touching a corner vertex or border edge of the wreck tile, or owns a port building / settlement / city on a corner vertex of the wreck tile.
  - `onBuild` claims any touched wreck immediately when a connecting road, bridge, rickety bridge, or port building is placed; `spawnWreckAt` also pays out immediately if a player already touches the tile when the wreck spawns.
- **T9d Loot with 2x-cost floor rule & slow time scaling (`src/packs/tidebound/wrecks.ts`)**:
  - Base cards: `3..5` (`WRECK_SEA_MIN_CARDS..WRECK_SEA_MAX_CARDS`) for sea wrecks and `1..2` (`WRECK_SHORE_MIN_CARDS..WRECK_SHORE_MAX_CARDS`) for shore wrecks, plus a small sea-wreck bonus chance (`15%` fish token when Fishing is on, `10%` dev card raised to `25%` with `tidebound.salvage_crew`).
  - `wreckTimeMultiplier(turnCount)` scales linearly from `1.0` at turn 0 up to `1.4` (`+40%` cap) at `WRECK_SCALE_TURNS = 50` turns; `tidebound.salvage_crew` multiplies loot by `SALVAGE_CREW_LOOT_MULT = 1.25`.
  - `computeWreckLootCount` enforces the floor rule (`Math.max(scaled, builtCostCards + 1)`), so even a doubled-cost bridge (6 cards) built to claim a wreck nets at least `6 + 1 = 7` cards. Pays from the bank (`bankGive`), or whatever the bank has left when short.
  - `wreckBotGoal` (`BOT_GOALS`, `generic`): adds `edgeDelta` bonuses for edges touching an active wreck and emits a `'tidebound.wrecks.salvage'` build goal when a road, bridge, or rickety bridge can claim a wreck.
- **T9e Two spawn animations & client view (`src/server/view.ts`, `src/client/types.ts`, `src/client/icons.ts`, `src/client/audio.ts`, `src/client/render/board.ts`, `src/client/styles.css`)**:
  - `wreckClientView` sends public `wrecks` (`id`, `hexId`, `site`, `countdown`, and `shoreDir` pointing toward the adjacent sea tile so shore wrecks beach toward the ocean side rather than inland) without leaking secret loot.
  - Added `wreckMarkup`, `playWreckSpawnSound`, `boardWrecksLayer`, and two distinct CSS/SVG spawn animations: `.wreck-spawn-sea-anim` + `.wreck-sea-whirlpool-ring` for ocean wrecks, and `.wreck-spawn-shore-anim` + `.wreck-shore-surf-wave` for shore wrecks.
### Tests
- `tests/tideboundwrecks.test.ts` (new): DLC/addon off = nothing registered, `tidebound.storm` event card & 4-round marker countdown with zero `g.rng` draws, passive storm cadence, 65/35 sea/shore distribution, `<= 4` hex distance cap & fairness ranking, claiming via road/bridge/rickety bridge/port and immediate spawn claim, slow time scaling (+40% at 50 turns), Salvage crew (+25%), 2x-cost floor rule, bank-short handling, fish/dev bonus drops, `wreckClientView` (`shoreDir`), `wreckMarkup`, and `wreckBotGoal`.

## 2026-10-30 (Pass 77: Tidebound T8a Harbor 1:1 upgrade, limit 1, works while flooded, and T8b max 4 trades/turn + invalid-ratio prompt; typecheck and tests passed)
### Added
- **T8a Harbor (`src/packs/tidebound/harbor.ts`)**: `upgrade_harbor` action (`UPGRADE_HARBOR`, `{ vertexId }`, main phase via `api.phaseAction('main', UPGRADE_HARBOR)`). Upgrades a player's own `city` on any port (`3:1` generic or `2:1` resource port) to `HARBOR_LEVEL = 2` in `g.ext.core.portUpgrades[vertexId]` for `HARBOR_COST` (`2 wood + 1 brick + 1 ore`, routed through `priceOfUpgrade(g, reg, p, HARBOR_UPGRADE_ID, HARBOR_COST)`).
  - **1:1 trade ratio (`harborRatioMod` in `HARBOR_RATIO_MODS`)**: a `3:1` generic harbor trades all 5 resources at `1:1`; a `2:1` resource harbor trades that resource at `1:1`.
  - **Limit 1 per player (`HARBOR_LIMIT = 1`)**: enforced by `harborLimitFor(g, pid)` (`1` by default, or `2` when `tidebound.harbor_empire` is owned).
  - **Works while flooded**: `PortIdleCheck.exempt` added to `PORT_IDLE_CHECKS` in `src/shared/tradeRatio.ts`; `harborIdleExemption` and `isPortFlooded` in `src/packs/tidebound/tides.ts` keep a harbor active (both at `1:1` and at its `2:1` fallback) while every land tile at its corner is flooded. `harborCharterModifier` in `src/packs/base/techEffects.ts` also checks `isPortIdle` so a flooded level-1 port is idle while a flooded level-2 harbor stays active.
  - **Minimal bot support (`harborBotGoal`)**: registered in `BOT_GOALS` (`generic`), upgrades an eligible port city when the bot will keep at least `HARBOR_BOT_SPARE = 2` cards after paying, preferring a `3:1` port over a `2:1` port.
- **T8b Max 4 `1:1` trades per turn per harbor & invalid-ratio prompt (`src/packs/tidebound/harbor.ts`, `src/shared/tradeRatio.ts`, `src/packs/base/actions/bankTrade.ts`, `src/client/render/drawer.ts`)**:
  - `HARBOR_MAX_TRADES = 4`: each harbor allows up to 4 `1:1` trades per turn (`g.ext.tidebound.harborTrades`, cleared on `onTurnStart` and keyed by `g.turnCount`). Specialised harbors are allocated before generic harbors when a player owns two harbors.
  - Once a harbor's 4 `1:1` trades for the turn are used, `harborRatioMod` yields `null` and the port falls back to its `2:1` ratio for the rest of the turn.
  - `explainInvalidBankRatio` (`src/shared/tradeRatio.ts`), `bank_trade` (`src/packs/base/actions/bankTrade.ts`), and `bankTradeAdvice` (`src/client/render/drawer.ts`) explain harbors whenever a proposed bank trade is invalid (`1:1 requires a harbor` or `harbor 1:1 limit of 4 trades per turn reached`).
- **Server & Client (`src/server/view.ts`, `src/server/socket.ts`, `src/client/types.ts`, `src/client/icons.ts`, `src/client/render/board.ts`, `src/client/render/hand.ts`, `src/client/render/index.ts`, `src/client/actions.ts`, `src/client/main.ts`, `public/index.html`)**:
  - `portLevels` (`harborClientView`) sent in shared state so port badges on the board update dynamically to `2:1` (level 1) or `1:1` (level 2 Harbor).
  - `harborCost`, `harborSpots`, `harborsLeft`, and `harborTradesLeft` sent in the player view; `upgradeHarbor` socket handler added; `#btnBuildHarbor` button, recipe popup, harbor build mode, and `clickHarborSpot` wired on the client.
### Tests
- `tests/tideboundharbor.test.ts` (new): DLC/addon off = nothing registered, `upgrade_harbor` validation & `1:1` ratios on generic and specialised ports with zero `g.rng` draws, `HARBOR_LIMIT = 1` (and `2` with `tidebound.harbor_empire`), flood exemption (`isPortFlooded` and `isPortIdle`), `harborSpotsView`/`harborClientView`/`harborBotGoal`, `HARBOR_MAX_TRADES = 4` per turn with `2:1` fallback and next-turn reset, batch cap validation, and `explainInvalidBankRatio` harbor prompts.

## 2026-10-30 (Pass 76: Tidebound T7c fish icon boosts, T7d tide replenish, T7e feed the sea; typecheck and tests passed)
### Added
- **T7c boosts (`netCatchOnRoll` in `fishing.ts`)**: a sea tile at the net with `ext.fish` > 0 doubles the catch chance (`NET_BOOSTED_CHANCE` = 1/3, `FISH_ICON_MULTIPLIER` = 2). Every fish caught that way uses up one boost of the richest tile at the net (ties go to the lowest id), so a full icon (`FISH_BOOSTS` = 4) is good for 4 fish. Same draw number as before, so every roll that catches at 1 in 6 also catches at 1 in 3. An icon that ran out stays on the tile at 0 (drawn faded); a tile with no icon never gets one from catching. `fishLeft(hex)` reads the count (null = no icon, clamped 0 to 4).
- **T7d replenish (`replenishFish`, an `onRoundStart` hook)**: every sea tile the tide reaches this round (`tideReachOnSea`: the sea around the coast tiles of each cluster that floods, depth 1 on a normal tide and 2 on a spring tide or a Very high one) that has an icon and fewer than 4 boosts regains one with chance `FISH_REPLENISH_CHANCE` = [0, 0.2, 0.45] by depth. The draw is a hash of seed, round and tile (`FISH_REPLENISH_SALT`), so no `g.rng` draw and nothing stored. Does nothing with Tides off. Event `fishReplenished`, log line.
- **T7e feed the sea (`feedSeaAction`, `FEED_SEA`)**: payload `{ hexId }`, main phase of your turn (`api.phaseAction`). Pays `FEED_SEA_COST` = 1 wheat into the bank and sets an open sea tile next to one of YOUR nets to full (4): no icon gets one, an empty one is refilled, a half-full one is topped up. Refuses a full ground, a river channel, a fogged tile, land and a tile not next to your net. No RNG. `stats.seaFed`, event `seaFed`, log line. Bot: `feedSeaScore` in `fishBotGoal` (12 for an empty ground, 10 for none yet, never a ground with boosts left, needs a spare wheat and `FEED_BOT_SPARE` = 4 cards after paying).
- **Server**: `fishClientView` (public map of sea tile id to boosts left, sent as `fishIcons`, null when Fishing is off or no icon), `feedSpotsView` and `FEED_SEA_COST` (player view `feedSpots` and `feedCost`, yourself only), socket `feedSea` (`{ hexId }` runs `feed_sea`).
- **Client**: new `boardFishLayer` drawing a fish with 4 pips on every icon tile (`fishGroundMarkup` in `icons.ts`; filled pip = boost left, dashed outline = used up), Feed button (`#btnFeedSea`, recipe popup from `feedCost`, `fish` UI icon), feed mode (`setBuildMode('feed')`, toast saying why when nothing can be fed) drawing a clickable ring on every ground in `feedSpots` and an empty fish on a spot with no icon yet, `clickFeedSpot`, `canClientAffordFeed`. Feed mode draws no road, bridge, net or settlement spots.
- **`tidebound/index.ts`** exports the T7c to T7e names (`FEED_SEA`, `FEED_SEA_COST`, `FEED_BOT_SPARE`, `NET_BOOSTED_CHANCE`, `FISH_ICON_MULTIPLIER`, `FISH_REPLENISH_CHANCE`, `feedSeaAction`, `feedSpotsView`, `feedableHexIds`, `fishClientView`, `fishLeft`, `netSeaHexIds`, `replenishFish`, `tideReachOnSea`).
### Tests
- `tests/tideboundfishgrounds.test.ts` (new): boosts (reading, doubled chance, earlier first catch on the same seed, one boost per catch and the icon stays at 0, richest tile first and lowest id on a tie, a spent icon gives nothing and no `g.rng` draw); replenish (tide reach by depth, nothing without a tide state, slow and faster on a spring tide and none when dry, no growth past 4, none for a tile without an icon, a spent one refills, seeded and no `g.rng` draw); feed (registration, cost, listing and fog, fills and pays the bank, no icon and half full, every refusal changes nothing, river and fog, main phase only, legal list, no `g.rng` draw); client views (`fishClientView`, `feedSpotsView`); bot scores.
### Decisions
- Feed price is 1 wheat (from the plan), the boost doubles the chance (1 in 6 to 1 in 3), icons hold 4 boosts, replenish is slow (about 1 boost per 10 rounds beside a flooding coast at Medium). All starting guesses: tune in T14.
- Feeding is tied to your own nets, so a net is what makes a ground yours to feed; nobody can pay to fill a ground far from every net.
- Tides refill only tiles that already have an icon; a new icon comes only from feeding.
- No `g.version` bump: `ext.fish` was already stored (T2c) and nothing new is stored.
### Not in this chunk
- Net works tech (base 1 in 4, 1 off the net price) is T11. Sound and animation for a fish caught or a ground fed. A turn-history entry for `fishCaught`, `fishReplenished` and `seaFed`.

## 2026-10-30 (Pass 75: Tidebound T7b2 nets client, net spots and net bot goal; typecheck and tests passed)
### Added
- **Net spots (`netSpotsView` in `fishing.ts`)**: the vertices where this player could put a net right now (`canPlaceNet` over every vertex). `undefined` when nets are not in the game, off your own turn, or outside the main phase; `[]` when the supply is used up. The price is not checked here (the client reads it from `pieceCosts`, the server checks again on the build). Sent in the player view as `netSpots` (yourself only) with `netsLeft` (`view.ts`), typed in `client/types.ts`.
- **No net on a port vertex**: `canPlaceNet` now refuses `v.port`. `ratioFor` gives a port to ANY piece of yours on its vertex, so a 2 wood + 1 sheep net there would be a port without a settlement.
- **Net bot goal (`netBotGoal`, `NET_BOT_MAX` = 3)**: registered by `tidebound.fishing` (`goalClass: 'generic'`, so every tier). A side build: at most 3 nets, only with the price plus 2 spare cards, only next to its own roads and bridges. Scores a vertex by sea tiles around it, +6 per sea tile with a fish icon (T2c), -8 where it could still settle. Priority 42 to 58, so a city or settlement goal wins.
- **Socket (`server/socket.ts`)**: `clickVertex` with `piece: 'net'` runs `build` for a net on an empty vertex. The client never sends another piece id there.
- **Client**: Net button (`#btnBuildNet`, recipe popup, supply badge, shown while the server sends a net price or in the lobby with Fishing on), net build mode (`setBuildMode('net')` with a toast saying why when there is nothing to click), spots drawn as dashed diamonds (`.net-spot`) from the server list only (no settlement spots in net mode), `clickNetSpot`, net drawn with `netMarkup` (post and mesh diamond in the owner's colour), `net` UI icon, net recipe and 2x price from `pieceCosts`.
- **`tidebound/index.ts`**: also exports `NET_BOT_MAX`, `netBotGoal`, `netSpotsView`.
### Tests
- `tests/tideboundnetsclient.test.ts` (new): no net on a port vertex (and back without the port); `netSpotsView` (same set as `canPlaceNet` and the legal build list, empty without your own road, `undefined` when nets are off, off your turn or outside main, empty with no supply); the bot goal (registered only with Fishing on, offers a build with the price and 2 spare cards, nothing with just the price, without a spot, without supply or at the limit, prefers a fish icon, and `chooseBotAction` really builds the net).
### Decisions
- Bots stop at 3 nets (below the base limit of 4), so a bot never pays double. Tuning is T13.
- The net spot list is built on the server and drawn as is, so the client has no copy of the placement rule.
- No `g.version` bump: nothing new is stored in the game state.
### Not in this chunk
- Fish icon boost and countdown (T7c), tide replenish (T7d), feed the sea (T7e). `robberScore` still reads a net as a settlement-weight target; checked at T13.

## 2026-10-30 (Pass 74: Tidebound T7b1 fishing nets engine; typecheck and tests passed)
### Added
- **Net piece (`src/packs/tidebound/fishing.ts`)**: `NET = 'net'`, `netPiece` (`target: 'vertex'`, `vp: 0`, `produces: 0`, `baseLimit: NET_BASE_LIMIT`, `scaleWithRadius: true`), registered by `tidebound.fishing` with `rules.pieceLimits.net` (same supply rule as bridges). Price `NET_COST` = 2 wood + 1 sheep, base limit 4, so the 5th net on the board costs double (`priceOf`, nothing new).
- **Placement (`canPlaceNet`)**: build phase only; an empty vertex that touches land and at least one sea tile; next to a road, bridge or rickety bridge you own (`ownsRoadAt`). No distance rule of its own. Cheap checks first, because the build action tries every vertex.
- **Sea tiles at a vertex (`seaHexIdsAt`, `isSeaHex`)**: `v.hexIds` holds land only, so the sea side is read from the land tile's own corner (the two neighbours across the edges that meet there). Same sea test as the fish icons (not land, no `noPort`, not a river channel). Needs no water topology, so Fishing works with Bridges off. T7c reads the same list.
- **Catch (`netCatchOnRoll`, an `onRoll` hook)**: each net rolls once per roll, a 7 included; hit chance `NET_CATCH_CHANCE` = 1/6; a hit gives the owner one fish (`grantWildToken`), `stats.fishCaught`, event `fishCaught`, log line. The draw is `netDraw(seed, rollCount, vertexId)`, a hash through `createRng`, so it draws nothing from `g.rng`, stores nothing and ignores the tile state (a net keeps fishing under a flood). Roll count = sum of `g.diceStats` (the roll action adds one before the hooks run).
- **`tidebound/index.ts`**: exports `NET`, `NET_BASE_LIMIT`, `NET_CATCH_CHANCE`, `NET_COST`, `canPlaceNet`, `isSeaHex`, `netCatchOnRoll`, `netPiece`, `seaHexIdsAt`.
### Tests
- `tests/tideboundnets.test.ts` (new): registration (on, DLC off, Fishing off), sea tiles by geometry on a lone island, none inland or in open water, river excluded; placement (road, bridge, owner, phase, taken, inland, open water); build (price to the bank, supply, refusals change nothing, legal list, 2x at the base limit); the catch (rate about 1 in 6 over 1200 rolls, per owner, none without sea, seeded, same under a flood, no `g.rng` draw, a real roll gives the same dice and generator state with nets on the board).
### Decisions
- Price (2 wood + 1 sheep) and base limit (4) are placeholders, not in `Ideas.md`: no brick, ore or wheat, so a net does not compete with a settlement. Tune in T14. Net works (later tech) takes 1 off the price.
- Every roll counts, a 7 included. A fish caught on a 7 counts toward that 7's discard like any card.
- A net is a vertex piece, so like a settlement it blocks the distance rule for settlements next to it, blocks an opponent's road through its corner (Longest Road), and its owner can be picked as a robber victim. Accepted for now; revisit with the T7b2 playtest.
- No `g.version` bump: nothing new is stored in the game state.
### Not in this chunk
- No build button, no net drawing (a net would be drawn as a settlement), no bot goal: T7b2. So nobody builds a net in a real game yet.
- Fish icon boost and the icon countdown (T7c), tide replenish (T7d), feed the sea (T7e), `robberScore` still reads a net as a settlement-weight target (`produces || 1`), checked at T13.

## 2026-10-30 (Pass 73: Tidebound T7a fish wild token; typecheck and tests passed)
### Added
- **T7a fish token (`src/packs/tidebound/fishing.ts`)**: `FISH = 'fish'`, `fishToken` (`WildTokenDef`: `countInDiscard`, `stealable`), registered through `api.define(WILD_TOKENS, ...)`. The token lives in `g.ext.core.wildTokens[playerId].fish`, never in `p.resources` or the bank, so it cannot be traded, `g.bank` has no fish key and nothing caps it.
  - `spend_fish` action (`SPEND_FISH`, `{ resource }`, main phase of your own turn via `api.phaseAction('main', ...)`): one fish becomes 1 card of any resource the bank still has. The fish is only spent when the bank can pay. Counts `p.stats.fishSpent`, emits `fishSpent`, logs. `legal()` gives one entry per resource the bank still holds, none without a fish.
  - `fishBotGoal` (`BOT_GOALS`, `generic`): a bot spends a fish only when that one card finishes its next city (40), settlement (35) or development card (25). Holding fish is not punished. Tuning is T13.
- **Wild token helpers (`src/shared/tileState.ts`)**: `wildTokensOf`, `countableWildTokens`, `stealableWildTokens`, `visibleWildCards` (tokens that make a hand look bigger) and `takeWildToken` (remove with nothing given back).
- **7 discard (`src/shared/sevenResolver.ts`, `src/packs/base/actions/owed.ts`)**: `countableCardsForSeven` adds held `countInDiscard` tokens to the hand, so a fish counts toward the limit and the amount owed. `discard` takes an optional `payload.wild` (`{ fish: n }`): checked against what is held, total must equal the amount owed, fish leave the hand and do not go to the bank. No `wild` = resources only, exactly as before. `legal()` falls back to fish only when the hand is mostly tokens.
- **Robber (`src/packs/base/robbing.ts`)**: `stealOne` adds held `stealable` tokens to the steal pool after the resource cards (so a game with no such token draws the same numbers as before). A stolen fish moves to the thief (`wildTokenStolen`, no `transferred` event, so no card flight). With a stealable token in the game the log always says "card", so a fish does not give itself away.
- **Views and socket**: `playerView` (`shared/views.ts`) hides other players' `ext.core.wildTokens` until game over and adds fish to `resourceCount`. `server/view.ts` sends `wildTokens` on each player (same visibility as the hand, undefined when none) and counts fish in `resourceCount`. Socket events `spendFish { code, resource }` and `discardCards { code, discards, wild }`.
- **Client**:
  - `icons.ts` fish glyph, `styles.css` `.card-fish`, `.g-fish`, `.g-fish-eye` (cream fish on the water tile colour, no new tokens).
  - `store.ts` `discardWild`, `clearDiscardWild`, `wildDiscardCount`; `types.ts` `PlayerView.wildTokens`.
  - `hand.ts`: a fish stack after the resources (your hand, and the spectator hand view). `onClickHandWild`: during a discard it picks a fish, on your main phase it opens the spend sheet.
  - `drawer.ts`: new `fish` sheet ("Spend a fish": one card per resource, bank-empty toast), `spendFishPick`; the discard sheet counts fish, shows them in the tray (`removeWildFromDiscard`) and sends `wild`.
  - `main.ts`: binds `onClickHandWild`, `spendFishPick`, `removeWildFromDiscard`; clears the fish pick when a discard opens; closes the spend sheet when it no longer applies (not your main phase, or no fish left).
- **`tidebound/index.ts`**: exports `FISH`, `SPEND_FISH`, `fishToken`, `spendFishAction`, `fishBotGoal`, `fishingAddon`.
### Tests
- `tests/tideboundfishing.test.ts` (new): registration (on, DLC off, Fishing off), spend (bank, hand, fish, `fishSpent`), refusals (no fish, bad or empty resource, not your turn; fish kept), legal list, 7 count (7 vs 8 cards), discard with fish (wrong total or too many fish refused, fish do not reach the bank, phase returns to main), robber steals a fish, DLC off steal pool unchanged, view hiding and `resourceCount`, bot score.
### Decisions
- Nothing in this chunk draws from `g.rng` (spend and discard are formulas; the steal pool only grows when a stealable token is held). No `g.version` bump: the data sits under `g.ext.core.wildTokens`, which already existed, and appears only after a fish is granted.
- The sidebar in-flight count needs no change: spend and steal emit no `transferred` event, so no flight starts and the shown hand size never dips.
### Not in this chunk
- Nothing grants a fish yet (nets are T7b, icon boosts T7c, tide replenish T7d, feed-the-sea T7e). To try it in a game, grant one from a test or the console.
- The spend sheet closes after each spend; a player with several fish reopens it. A fish steal has no flight animation.
- Not looked at in the browser: the fish card, the spend sheet and the discard tray.

## 2026-10-30 (Pass 72: Tidebound T5e ports idle while flooded, T6 tides UI; typecheck and tests passed)
### Fixed
- `tests/tideboundtides.test.ts` (T5b): the spring-tide cadence line was written `[1, 2, 3, 4, 5, 6, 7, 8, 12].map(isSpringTide)`. `Array.map` passes the index as the second argument, so `isSpringTide` read it as the tide level (index 5 = Very high, spring every 3rd round, round 6 came out as a spring tide). Not a bug in the engine; the test now calls `isSpringTide(r)`. No other test had the pattern.
### Added
- **T5e ports idle while flooded (`src/shared/tradeRatio.ts`, `src/packs/tidebound/tides.ts`)**:
  - New keyed registry `PORT_IDLE_CHECKS` (`PortIdleCheck`, `isPortIdle`) in the trade ratio service. `ratioFor` skips a port whose vertex any registered check calls idle, so its ratio simply does not apply (the player falls back to the bank ratio and the other modifiers). Nothing registered = nothing changes. This is the same shape as `HARBOR_RATIO_MODS`: a DLC registers into it, the base never learns about the DLC.
  - Tides registers `tidebound.tides.flooded`: `isPortFlooded(g, reg, vertexId)`. A port is idle when the corner touches at least one land tile and every land tile it touches is flooded. A corner between a flooded and a dry tile keeps trading (assumption, tune in T14). Fog land never floods, so it keeps the port working.
  - T8 (Harbor) is the intended opt-out: a harbor works while flooded, so it will register an exemption in front of this check (the harbor vertex returns not idle). Nothing to change here for that.
  - The production half of T5e needed no change: the S0.6 pipeline already blocks on the `flooded` state, covered by the T5a test `a flooded tile produces nothing`.
- **T6 tides UI**:
  - Server: `tideClientView(g, reg)` (`tides.ts`) builds public tide data for the `gameState` (`src/server/view.ts` sends `hexOverlays` and `tide`; both null when Tides is off). `hexOverlays` is `flood` for each flooded visible tile and `flood-warn` for each tile the warning is about. `tide` carries the level name, the round, `rose` (tiles that went under at the start of this round, for the title card), `warning` and `elevation` (height of every visible land tile, null when all tiles are equal so the toggle stays hidden). Fogged tiles are never in any of it. Plain JSON, no state change, no `g.rng` draw, no `g.version` bump.
  - T6a warning one turn ahead: `tideWarning(g)` shows during the last seat's turn of a round (the next event is the round start, where the tide rises), for tiles that are dry now and will flood then (`floodPlan(g, round)`, the same rules as `applyTides` but pure). Not shown in setup, at game over, or before the first tide. Tiles that already hold a state are not warned about. Client draws them with the new overlay kind `flood-warn`: dashed lighter waves, with a slow fade up and down (`floodWarnFlash`). The overlay layer is rewritten only when its markup changes, so state updates do not restart the flash.
  - T6b rise title card: `render/index.ts` `syncTideUi` shows the existing event title card (`The tide rises`, or `Spring tide!` in the danger tone) once when a new round arrives with `tide.rose`. A screen that joins or reconnects mid-game does not replay the card.
  - T6c flooded tint for both themes: the `flood` pattern now reads `--flood-tint` and `--flood-line`, with light and dark values (and `--flood-warn-*` for the warning), instead of fixed colors. Pattern as well as color, as the colorblind rule asks.
  - T6d elevation heat map: a nav button (`#btnElevation`, shown only when tiles differ in height) toggles `elevationView` (client store only). The overlay layer then draws one flat tint per height (`--elev-1` to `--elev-3`, darker = higher) with 1 to 3 triangles as the label, instead of the tide overlays.
### Tests
- `tests/tideboundtides.test.ts`: new `ports idle while flooded (T5e)` block (port idles on a flooded tile and works again, a second port is unaffected, a corner between a flooded and a dry tile keeps trading, other tile states and Tides off leave the port alone) and `tide view for the client (T6)` block (`floodPlan` equals `applyTides` at every level with mixed elevations, the warning window and its edge cases, `tideClientView` overlays, `rose` counts including a spring tide, elevation data and fog, plain JSON, no RNG draw and no state change).
### Not in this chunk
- A visual cue on a port that is idle (it is covered by the flood tint of its tile; the bank ratio shown in the trade panel already reflects it). A bot that reads the warning is T13.

## 2026-10-30 (Pass 71: Tidebound T5c tide level slider, T5d elevation resistance; typecheck and tests passed)
### Added
- **T5c tide level (`src/packs/tidebound/tides.ts`, `src/server/{types,runtime,lobby}.ts`, `src/client/{actions,main}.ts`, `src/client/render/setup.ts`, `styles.css`)**:
  - `TIDE_LEVELS`: five slider positions (Very low, Low, Medium, High, Very high). Each sets `period` and `duration` (a cluster is flooded `duration` rounds of every `period`, the two phases half a period apart), `springEvery`, `reach` (rings a normal tide covers, 1 or 2; a spring tide is always 2) and, for T5d, `strength` and `springStrength`. Medium (3, the default) is exactly the T5a/T5b behaviour: period 2, duration 1, spring every 4th round, coast ring only. Higher = more often, longer, deeper, stronger. The numbers other than Medium are starting guesses for the T14 balance gate.
  - `isFloodedAt`, `isSpringTide`, `floodDepthAt` take an optional `level` (default Medium), so every earlier call and test is unchanged. `tideLevelDef` and `tideLevelOf` clamp any bad value, so a bad level cannot break a round.
  - Tides on or off is the existing Tides addon checkbox in the Tidebound card (nothing new needed). New lobby setting `tideLevel` (1 to 5, default 3): `Settings.tideLevel`, clamped in `mergeSettingsDetailed`, sent to the engine as `rules.tideLevel` by `rulesFromSettings` only while the Tides addon is on and the slider is off Medium, so every other game carries nothing new.
  - Setup page: a "Tide level" slider (Low to High, name of the position shown while dragging, sent on release) under the Tides row while Tides is on, and a `Tides · <level>` pill in the active summary strip. Host only, like the rest of the page.
- **T5d elevation resistance (`tides.ts`)**: `hexElevation(hex)` reads `ext.elevation` (1 to 3, a tile without it counts as 1) and `tideStrengthAt(round, level)` gives how high the water stands. A tile in the water's reach floods only when the tide strength is at least its elevation, so elevation 1 goes under in any tide, elevation 2 needs a spring tide at Medium (or any tide at High), elevation 3 needs a spring tide at High or Very high. The same rule covers the inland ring. A tile that was flooded by a strong tide and is reached by a weaker one is drained that round. The `tideChanged` event carries `held` (hex ids the water reached but could not flood; left out when empty, so older consumers and tests see the same event), and the log line adds "; N higher tiles hold".
  - Assumption: "elevation = how many tides the tile can resist" is read as a strength comparison, not a per-tile counter (no new per-tile state, no save change, fully testable). A counter version (a tile stays dry for its first N tides) would be a change to `applyTides` only.
### Tests
- `tests/tideboundtides.test.ts`: new `tide level (T5c)` and `elevation resistance (T5d)` blocks: table shape and Medium = old behaviour, clamping, duration per period and phases per level, spring cadence per level, reach, more flooded tile-rounds at every step up, Very high covers the inland ring on a normal tide, no `g.rng` draws, lobby setting clamping and the rule mapping (only with Tides on and off Medium), elevation reads, strength per level, held tiles at Medium and High, draining, the inland ring, production on a held tile, elevation never moves the clusters or an RNG stream.
### Not in this chunk
- Ports idle while flooded and a production stage (T5e), and everything visible (T6). The client does not get `ext.elevation` yet (`clientBoard` strips `ext`), which T6d needs for the heat map.
- No `g.version` bump, no `GEN_VERSION` bump: the new rule exists only while Tides is on and the slider is off Medium.

## 2026-10-30 (Pass 70: Tidebound T5a flooded tile state and seeded per-cluster tide schedule, T5b spring tide; typecheck and tests passed)
### Added
- **T5b spring tide (`src/packs/tidebound/tides.ts`)**: every 4th round (`TIDE_SPRING_EVERY = 4`, so rounds 4, 8, 12...) every cluster floods whatever its phase, and the water reaches two rings: the coast and the land one step behind it (`TideCluster.inner`, each inland tile belongs to one cluster, fog tiles left out). `floodDepthAt(cluster, round)` gives 0 dry, 1 coast, 2 coast and inland; `applyTides` reads it, so T5c (slider) and T5d (elevation) change that one function. `tideChanged` now carries `spring`, and a spring tide has its own log line. Saves made with T5a data (no `inner`) still run. Assumption: a spring tide overrides the phase (a cluster that would be dry floods anyway), which is what makes the preview worth reading.
### Fixed
- `clankerton_s0.test.ts` expects the base `flooded` state to block robber placement. T5a had registered its own `flooded` def with `blocksRobber: false`, which replaced the base one whenever an addon set included Tides. Removed: Tides now uses the base def (blocks production and robber placement; a robber already standing on a tile that floods stays, nothing moves it). The base def's silt hand-off only happens when `until` runs out and tides never set `until`.
### T5a (added earlier in this pass)
- **T5a (`src/packs/tidebound/tides.ts`, `src/packs/tidebound/index.ts`, `tests/tideboundtides.test.ts`)**:
  - `flooded` tile state for Tidebound: the base def is used as it is (blocks production and robber placement), set and cleared by the schedule, no `until`.
  - Coast clusters: `coastHexIds` (visible land with a water or off-board neighbour; fog tiles are left out and a hidden neighbour does not count as sea, so nothing leaks), `buildTideClusters` (connected coast stretches cut into pieces of about `TIDE_CLUSTER_SIZE = 6` by spread-out seeds and nearest-seed growth), phases 0 or 1 dealt half and half by a seeded shuffle, so two or more clusters always have both phases.
  - Schedule `isFloodedAt(cluster, round)`: dry before `TIDE_FIRST_ROUND = 2`, then flooded when `(round + phase) % TIDE_PERIOD === 0` (`TIDE_PERIOD = 2`, every other round). Spring tide (T5b) and the slider (T5c) change this one function.
  - `ensureTides` keeps the clusters in `g.ext.tidebound.tides` (plain JSON, built at game start, or on the first round of an older save). `applyTides` runs on `onRoundStart`: sets `flooded` on the clusters whose round it is and clears it on the rest, never overwrites another tile state and never clears one it did not set, emits `tileStateChanged` per tile and one `tideChanged { round, risen, fell }`, and logs when a tide rises.
  - Seed discipline: clusters use a derived stream (`deriveTideRng`, salt `0x71de5eed`), the schedule is a formula, so `g.rng` is never touched. Same seed, same tides.
  - Production needed no change: the S0.6 pipeline already blocks on `blocksProduction` tile states.
### Not in this chunk
- Settings and slider (T5c), elevation resistance (T5d), ports idle and a production stage (T5e), and everything visible (T6: warning, title card, tint, heat map). Flooded tiles have no look yet; the log line and the missing production are the only signs.
- No `g.version` bump: the new data lives under `g.ext.tidebound` and exists only while the addon is on.

## 2026-10-29 (Pass 69: Tidebound T4d collapse on a 7, T4e Longest Road recalculation, T4f collapse animation; typecheck and tests passed)
### Added
- **T4d, Collapse on a 7 in the Seven Resolver (`src/packs/tidebound/ricketyBridges.ts`, `src/packs/tidebound/index.ts`, `src/packs/base/actions/roll.ts`)**:
  - `RICKETY_SEVEN_STEP_ID = 'tidebound.rickety_collapse'` and `ricketyCollapseStep: SevenStepDef` (`order: SEVEN_STEP_ORDER.decay`, `isDlcSideEffect: true`, `priority: 85`), registered in `ricketyBridgesAddon` via `api.define(SEVEN_STEPS, ricketyCollapseStep)`.
  - `canFire(ctx)` returns `true` only when at least one `rickety_bridge` is on the board, so it does not consume a `maxSevenSideEffects` slot when none are placed.
  - `run(ctx)` applies 1 damage (`damagePiece(ctx, 'edge', e.id, 1)`) to every rickety bridge on the board, calls `syncBridgePool(g, ownerId)` for each affected owner so both `p.pieces.bridge` and `p.pieces.rickety_bridge` stay mirrored, increments `p.stats.ricketyCollapsed`, logs the collapse, and calls `updateAwards(ctx)`. Draws zero values from `g.rng`.
  - `handleSeven(ctx)` in `src/packs/base/actions/roll.ts` now delegates to `resolveSeven(ctx)` (with zero `SEVEN_STEPS` / `DISCARD_LIMIT_MODS` / `WILD_TOKENS` active in base games, `resolveSeven` runs the exact base robber + discard flow with zero RNG drift).
  - Updated the Rickety bridge note in `src/client/render/bridgepicker.ts` from `"Cheap, 1 health"` to `"Cheap, breaks on a 7"`.
- **T4e, Longest Road recalculation through the change log (`src/shared/engine.ts`, `src/shared/history.ts`, `src/server/turnHistory.ts`)**:
  - `updateAwards(ctx, actionType?)` now recomputes `build` awards whenever `ctx.events` contains `pieceBroken` (or when `actionType` is omitted).
  - Properly handles Longest Road shrinkage when a rickety bridge collapses: holder retains the award if still tied/ahead `>= 5`; sole new leader `>= 5` claims the award; award drops to `null` if nobody has `>= 5` or if 2+ other players are tied for the lead after the holder falls below them.
  - Emits `awardChanged` (`{ award, playerId, previousHolderId, value, summary }`) on both award handoff and award loss (`playerId: null`), which is recorded alongside `pieceBroken` (`actorId: ownerId`) in the S0.10 public history ring buffer (`getPublicHistory(g)`) and in the server turn history (`src/server/turnHistory.ts`).
- **T4f, Collapse animation (`src/client/render/board.ts`, `src/client/audio.ts`, `src/client/styles.css`)**:
  - `renderBoard` tracks placed edge pieces in `knownRoadPieces` and records any edge piece removed during gameplay into `collapsingBridges` (`COLLAPSE_ANIM_MS = 620`), playing `playBridgeCollapseSound()` (wood snap + water splash) and rendering the splintering/sinking SVG bridge animation (`.bridge-collapse-anim`) and expanding water splash ring (`.bridge-collapse-ring`). Also plays the drop animation when a rickety bridge is upgraded to a full bridge in place.
### Tests
- `tests/tideboundrickety.test.ts`: added `T4d collapse on a 7 (Seven Resolver)` and `T4e Longest Road recalculation through the change log` covering collapse on `resolveSeven` and `roll` action (sum 7), full bridges/roads untouched, shared pool sync, zero RNG draws, `canFire` false when no rickety bridges are placed, chain splitting and Longest Road loss to `null`, Longest Road transfer to another player, holder retention on tie at 5, loss to `null` on multi-player tie after holder drops below 5, and `pieceBroken` + `awardChanged` entries in `getPublicHistory(g)`. **T4 is closed.**

## 2026-10-29 (Pass 68: Tidebound T4c bridge type picker and upgrade popup; typecheck and tests passed)
### Added
- **`client/render/bridgepicker.ts` (new)**: one popup that sits over an ocean edge.
  - **Type picker**: clicking an empty ocean edge, with rickety bridges in the game, opens "Build on this edge" with two buttons, Bridge (sturdy) and Rickety bridge (cheap, 1 health), each with its price as mini cards. A button is disabled with the reason when the pool is empty or the hand cannot pay. Choosing sends `clickEdge { edgeId, piece }` (the server handler already took `piece`). With rickety bridges off (or Tidebound off) the click builds a bridge at once, as in T3.
  - **Upgrade popup**: clicking one of your own rickety bridges (the bridge itself, or the accent marker that shows while you can pay) opens "Upgrade to a full bridge" with the price; confirming sends the new `upgradeBridge` socket event.
  - Closes on a press elsewhere, wheel, Escape, or when a state arrives that no longer fits (not your turn, not the main phase, edge taken). Redraws only when its HTML changed.
- **`server/socket.ts`**: `upgradeBridge { code, edgeId }` runs `upgrade_bridge` (errors go back to the player).
- **`server/view.ts`**: `bridgeUpgradeCost` on your own player view, from the new `bridgeUpgradeView(g, reg, p)` in `tidebound/ricketyBridges.ts` (your upgrade price, doubled at the pool limit; `undefined` when rickety bridges are not in the game, so other games send nothing new).
- **`client/render/board.ts`**: rickety bridges drawn with a dashed body and two planks (full bridges keep three); `isRicketyEnabled` and `canClientAffordBridgeUpgrade` helpers; a bridge spot now counts as buildable when either kind is affordable; `rickety_bridge` added to the client piece keys, base limit and base cost; the client 2x counter treats bridges and rickety bridges as one pool (like the server).
- **`client/render/index.ts`, `main.ts`**: `renderBridgePicker` runs after each render; `clickPlacedBridge`, `chooseBridgeType`, `confirmBridgeUpgrade`, `closeBridgePicker` are on `window`; the Bridge button tooltip mentions the choice when rickety bridges are on.
- **`client/render/techpanel.ts`**: `costStripHtml` is now exported (the picker reuses it).
### Tests
- `tests/tideboundrickety.test.ts`, `T4c view data`: `bridgeUpgradeView` gives the plain price, doubles with the pool, is `undefined` with the DLC or the addon off. The popup itself is client DOM and is not covered by a test.
### Not done
- `npm run typecheck; npm test` passed and John reported T4c done (2026-10-29). **T4c is closed.** Next is T4d.
- The note under Rickety bridge says "Cheap, 1 health" on purpose: nothing breaks it until T4d. T4d should change it to say it breaks on a 7.
- The popup is not tied to the camera: it closes on a wheel press or a pan, it does not follow the edge.
- Bots are unchanged (they do not use the UI).

## 2026-10-29 (Pass 67: Tidebound T4a rickety bridge and T4b upgrade; typecheck and tests passed)
### Added
- **T4a (`tidebound/ricketyBridges.ts`)**: `rickety_bridge` piece: 1 wood, health 1 (`DURABILITY_DEFS`), road-like, bridge placement rule, cap 10 scaled like bridges.
- **Shared pool**: two mirrored supply counters kept equal by `syncBridgePool` (runs on every bridge or rickety build). **T4d must call it after `damagePiece` breaks one**, because `damagePiece` refunds only the rickety counter.
- **Shared 2x cost**: `ricketyPoolCostMod` doubles the next bridge or rickety bridge once both kinds together reach 10.
- **T4b**: `upgrade_bridge` `{ edgeId }`: rickety to full bridge in place for 1 brick + 1 ore, doubled at the pool limit.
- **`api.phaseAction(phase, action)` (`shared/registry.ts`)**: lets an addon add an action to an existing phase. Used here for `main`; DLC off changes nothing.
- **Bots**: `ricketyBotGoal` builds rickety when a full bridge is unaffordable and upgrades with 3+ spare cards. Tuning is T13.
### Tests
- `tests/tideboundrickety.test.ts` (new).
### Not done
- No UI until T4c (type picker, plus an upgrade button). Collapse on a 7 is T4d, Longest Road recalculation T4e, collapse animation T4f.

## 2026-10-29 (Pass 66: Tidebound T3, Bridges — T3a to T3e; typecheck and tests passed)
### Added
- **T3a, Bridge piece & ocean-only placement rule (`src/packs/tidebound/bridges.ts`, `src/packs/tidebound/index.ts`)**: `BRIDGE = 'bridge'`, `BRIDGE_BASE_LIMIT = 10`, `BRIDGE_COST = { wood: 1, brick: 1, ore: 1 }`, `isOceanEdge(ctx, edgeId)` (`e.hexIds.length === 0`), `canPlaceBridge(ctx, pid, edgeId, mode)` (build phase only; both sides of the edge must touch ocean tiles; endpoint vertex must have player's building or be unblocked with at least one adjacent road-like edge piece), and `bridgePiece` (`target: 'edge'`, `vp: 0`, `produces: 0`, `baseLimit: 10`, `roadLike: true`, `scaleWithRadius: true`). `bridgesAddon` registers `api.capability('crossing')`, `api.piece(bridgePiece)`, `api.define(BOT_GOALS, bridgeBotGoal)`, `rules: { pieceLimits: { bridge: 10 } }`, and an `onGameStart` hook calling `addWaterTopology`.
- **Water edge topology (`src/shared/topology.ts`, `src/shared/mapgen.ts`)**: `TopologyOptions.waterEdges` and idempotent `addWaterTopology(board, isLand, blocked)`. Water vertices (`v.hexIds.length === 0`) and ocean edges between two water tiles (`e.hexIds.length === 0`) are added only when `reg.capabilities.has('crossing')` (or `opts.waterEdges`), keeping `v.hexIds` and `e.hexIds` strictly for land hexes so coastal edges remain `e.hexIds.length === 1` and DLC-off boards are 100% unchanged. In `generateMap`, `addWaterTopology` runs after `validateBoard` so `MapReport` counts and attempt validation stay identical.
- **T3b, Supply cap scaling & 2x cost past 10 (`src/shared/pricing.ts`, `src/shared/engine.ts`, `src/shared/registry.ts`)**: `scaledPieceLimit(base, vpToWin, boardRadius)` scales by `Math.max(1, vpToWin / 10) * Math.sqrt(hexCount(boardRadius) / 19)` using the land radius (`rules.boardRadius`). `PieceDef.scaleWithRadius` triggers `scaledPieceLimit` in `createGame` when `vpToWin > 10 || boardRadius > 2` (leaving base pieces scaling only with `vpToWin > 10` as before). Bridges 11+ on the board automatically cost double (`2 wood, 2 brick, 2 ore`) via `priceOf` and `baseLimit: 10`.
- **T3c, Longest Road (`src/packs/base/longestRoad.ts`, `src/packs/base/placement.ts`, `src/packs/base/pieces.ts`)**: `PieceDef.roadLike`, `isRoadPiece(ctx, type)`, and `ownsRoadAt(ctx, pid, edgeId)`. Both `road` and `bridge` set `roadLike: true`, so bridges and roads form a single continuous network for Longest Road and road/settlement/bridge connectivity. `canPlaceSettlement` requires `v.hexIds.length > 0` (land/coastal vertices only) and `canPlaceRoad` requires `e.hexIds.length > 0` (land/coastal edges only).
- **T3d, Build UI for bridges (`src/server/view.ts`, `src/server/socket.ts`, `src/server/game.ts`, `src/client/types.ts`, `src/client/icons.ts`, `public/index.html`, `src/client/render/index.ts`, `src/client/render/hand.ts`, `src/client/render/board.ts`)**: `clientBoard` sends `pieceType` on edges; `PlayerView` sends `bridgesLeft` and `pieceCosts.bridge`; `clickEdge` routes ocean edges (`e.hexIds.length === 0`) to `'bridge'`; `#btnBuildBridge` in `.action-bar` shows when `tidebound.bridges` is enabled with recipe popup (`wood + brick + ore`, `2x` badge past 10) and remaining count badge; `renderBoard` draws cross-planks on placed bridges and highlights buildable ocean edges.
- **T3e, Minimal bot support (`src/packs/tidebound/bridges.ts`, `src/server/bots/brain.ts`)**: `bridgeBotGoal` (`BOT_GOALS`, `goalClass: 'generic'`) scores legal ocean edges that reach or step toward open coastal settlement spots and returns a build goal with `priceOf(ctx.g, ctx.reg, p, bridgePiece)`. `hasReachableSpot` in `brain.ts` accounts for `p.pieces.bridge` on ocean edges and `p.pieces.road` on land edges.
### Decisions
- **Bridge cap scaling (`Development Plan.md` §4)**: resolved to scale by land radius (`rules.boardRadius`), not the grown `wide_water` canvas radius.
### Tests
- `tests/tidebound.test.ts`: updated `Tidebound on` and added `T3 Bridges (T3a, T3b, T3c, T3d, T3e)` covering ocean-only placement, coastal settlement/road/bridge chaining, open-ocean settlement rejection, opponent vertex blocking, cost `{ wood: 1, brick: 1, ore: 1 }`, radius/VP cap scaling, 2x cost past 10, Longest Road across mixed road + bridge chains, `clientBoard` `pieceType`, and bot bridge building in `main` phase.

## 2026-10-29 (Pass 65: Tidebound T2c, seeded fish icons on sea tiles; typecheck and tests passed)
Built in the same sitting as Pass 64 and shares its plumbing (the perk hook and `seaData.ts`). Closes T2.
### Added
- **`placeFish(inits, ctx)` (`packs/tidebound/seaData.ts`)**: writes `ext.fish = FISH_BOOSTS` (4) on some sea tiles. A sea tile is not land, has no `noPort` flag and is not a river channel (lakes count). Shore sea (next to land, where nets will sit) holds fish on 25% of its tiles (`FISH_SHARE_SHORE`), open sea on 8% (`FISH_SHARE_OPEN`). The counts are fixed by the share; which tiles is the extras-stage noise ranked, so fish gather a little into shoals. **No RNG draws** (the `extras` stream is untouched, so fog and other hooks after it draw what they drew before). Both shares are starting guesses for the gallery.
- `wide_water.afterGenerated` calls it after `applyElevation`. Data only: nothing reads `ext.fish` until T7b and T7c.
### Decisions
- **`recipeKey` (`server/lobby.ts`) is left as it is.** The question from Pass 62 was whether the key must include the room's addon set. It does not: the only map change an addon makes in T2 is a pick (`wide_water`), picks are in the key, and `mergeSettingsDetailed` drops a pick when its DLC or addon goes off, so any toggle that changes the map changes the key. Adding the addon set would rebuild the board, and drop painted edits, whenever any DLC is toggled. Revisit when an addon changes the map without a pick (T12 Rising sea).
- **Golden test**: not touched. No code path runs without the pick, and the golden games do not use Tidebound. A recheck means running it once, in the final command below.
### Tests
- `tests/tideboundmap.test.ts`, `sea data: fish`: exact counts on a built canvas (shore 3 of 11, open 3 of 42), none on land, river or in the first two rings of land, no RNG advance, same noise = same tiles, other noise = other tiles, and on real maps fish sit on sea only at 5% to 40% density. `sea data: nothing without the pick` covers the DLC-off and no-pick case.
### Not done
- `npm run typecheck; npm test` passed for Passes 62 to 65 (one run, 2026-10-29), golden included.
- A host can repaint a tile in the lobby and the old `ext.fish` or `ext.elevation` stays on it. Readers (T5d, T7b) must check the tile type first.
- Fish under fog: sea tiles are never hidden, so the icons are visible. Fine until a fog-and-Tidebound scenario is built.

## 2026-10-29 (Pass 64: Tidebound T2b2, elevation 1 to 3 on land; typecheck and tests passed)
### Added
- **`src/packs/tidebound/seaData.ts`** (new): `elevationOf(h)` (1 below 0.65, 2 from 0.65, 3 from 0.9; `ELEVATION_2_FROM`, `ELEVATION_3_FROM`) and `applyElevation(inits, cells)`, which writes `ext.elevation` on every land hex. `h` is rank-normalized over the land cells, so about 10% of the land is elevation 3, 25% is 2 and 65% is 1 on any shape (higher is rarer). It uses the shape's own height field when the shape drew one, else the terrain noise, so the realistic terrain style and the elevation agree. Cells are matched to hexes by position, never by order. **No RNG draws.**
- **`PerkDef.afterGenerated(inits, ctx, cells)`** (`shared/mapoptions.ts`): third argument, the land cells with their ranked `h`. Optional to read, so existing perks are unchanged. **`shared/mapgen.ts`** passes `cells0` (not the current terrain attempt's cells, so a terrain redraw never moves elevation).
- **`tidebound/bridges.ts`**: `wide_water` now has `afterGenerated` (elevation, then fish). Menu text mentions both.
- **`shared/maprecipe.ts`**: the `GEN_VERSION` 6 note lists the new `ext` keys. Still 6, because 6 has not shipped.
### Where it is stored
`hex.ext.elevation` (1 to 3) on land hexes only, only with the wide-water pick on. Nothing reads it yet: tides resist by it in T5d, the heat map shows it in T6d, Rising sea drowns lowest first in T12.
### Tests
- `tests/tideboundmap.test.ts`, `sea data: elevation`: thresholds, position matching, every land hex 1 to 3 and no water hex, higher is rarer (count 3 < count 2 < count 1 on a radius 8 continent), every shape, same recipe = same data. The header of the file now covers T2b2 and T2c.
### Not done
- `npm run typecheck; npm test` passed (see Pass 65).
- The thresholds (0.65 and 0.9) are starting guesses. Tune with the gallery once T5 reads them: three tide levels should each drown a visibly different share of the land.

## 2026-10-29 (Pass 63: Tidebound T2b1, wide water grows the canvas; typecheck and tests passed)
### Decision (Development Plan section 4)
- **The canvas grows.** Tidebound's map is bigger than base Catan by default. The land count stays what the radius gives; the extra room is sea. Rivers and continents reuse the existing logic, only widened.
### Changed
- **`shared/mapshape.ts`**: `SEA_LAND_CUT` and `WIDE_WATER_MIN_RADIUS` removed. New `SEA_GROW_PER_EXTRA` (1.5), `cellsWithin`, `seaExtraOf`, `seaGrow` (4 extra = 6 rings) and `canvasRadiusFor(radius, extra)` (capped at `MAX_RADIUS`). `LandField.baseRadius` (the normal map's radius; equals `radius` without the pick). `createLandField` takes it as a 4th argument. `ShapeInput.landRadius`, `ShapeResult.radius` (a failed shape falls back to the hexagon of the normal size, not the grown canvas). The land share is now `cellsWithin(baseRadius) x density`, the same number as before without the pick. `fillHeight` pull reads `baseRadius`.
- **`shared/mapgen.ts`**: canvas radius from `canvasRadiusFor`, canvas built from `shape.radius`, board attempts sized by the canvas. `wide-water-small` now only fires when the radius cap holds the sea back.
- **`packs/base/map/shapes.ts`**: noise size, river length, island count, archipelago count and ring size read `baseRadius`, so the grown canvas does not add islands or lengthen rivers.
- **`shared/maprecipe.ts`**: `GEN_VERSION` 6. **`tidebound/bridges.ts`**: perk text. **`tests/tideboundmap.test.ts`**: land-count and canvas-size tests rewritten, standard-size boards added, warning test narrowed.
### Not changed
- Without the pick every value is identical (`baseRadius === radius`), so the golden test and `mapshapes.test.ts` should pass untouched. No new RNG draws, no state shape change, no `g.version` bump.
### Not done
- `npm run typecheck; npm test` passed in the Pass 65 run. Before it, this was the open list: anything that pinned `GEN_VERSION` to 5 or the old wide-water land counts (`tideboundlobby.test.ts`, `mapbudget.test.ts`, share-code fixtures) may need the new numbers.
- Not checked: UI zoom and bot map reads with a board larger than `rules.boardRadius`; bridge cap scaling (T3) must pick land radius or canvas.
- Starting guesses to tune with the gallery: 1.5 rings per extra tile, and sparse spacing of islands on a big canvas.

## 2026-10-29 (Pass 62: Tidebound T2a2, the lobby sees DLC map perks; typecheck and tests passed)
T1 and T2a (Passes 60 and 61) ran clean: `npm run typecheck; npm test` passed before this pass.
### Decision (Development Plan section 4)
- **Option A**, with one change to its wording: the lobby uses the room's DLC-aware registry for the map, picks and menu, and the client needs **no change** (its `mapOptions` handler already redraws from whatever list arrives). Option B (perks in the static registry behind a capability) is dropped: it would put an addon perk in the base registry and break "DLC off = nothing registered".
### Added
- **`mapRegistryKey(settings)` and `mapRegistryFor(settings)` (`server/runtime.ts`)**: the key is the sorted list of addons the DLC and addon toggles turn on (`resolveAddons`); `mapRegistryFor` returns the plain `registry` itself while that list is empty, otherwise `registryFor(allPacks, ...)`, cached per addon set (cap 32, cleared when full, because a client can send any toggle combination).
- **`mapOptionsForSettings(settings)` (`server/mapmenu.ts`)**: the menu data for one room, cached per addon set. `mapOptionsView(reg = registry)` is unchanged, so with no addon on both give the same data.
- **Per-socket option list (`server/net.ts`)**: in the lobby, `broadcastRoom` sends a socket `mapOptions` before its `gameState` whenever the room's addon-set key differs from the one that socket last got (`socket.data.mapOptionsKey`, set to `''` on connect, where the plain list is sent as before). This covers a join, a reconnect, a DLC or addon toggle, a scenario and a loaded preset in one place. Nothing is sent during a game.
- **`tests/tideboundlobby.test.ts`**: room registry (plain object with no addon, perk only with Tidebound and bridges, cache), menu data (same as plain without the DLC; with it only `wide_water` is added, dlcs, addons, quick starts and scenarios equal), settings merge (pick and param dropped with the DLC off, kept and clamped when the same patch turns it on, dropped again when the DLC or only the bridges addon goes off, share code with the perk dropped or applied), `isPreset` with settings, the lobby map (less land with the perk on, a stray pick ignored with the DLC off and the plain continent drawn, DLC off = same map as before) and the option list sent once per change and before the state, with a fake `io`.
### Changed
- **`server/lobby.ts`**: `generateLobbyMap`, `newBoard` and `applyMapStart` build and resolve quick starts from `mapRegistryFor(settings)`. `mergeSettingsDetailed` now reads the `dlc` and `addons` toggles **first** and resolves share-code ids, picks and params against that room's registry, so a DLC switched off drops its picks and params in the same merge. `isPreset(id, settings?)` takes the room settings (the old one-argument call still works). Blank and legacy presets (`generateBoard`) still use the plain registry.
- **`server/socket.ts`**: `isPreset` calls pass `room.settings`; the connection handler sets `socket.data.mapOptionsKey`.
- `tests/tideboundmap.test.ts`: header comment updated.
### Not changed
- `GEN_VERSION` stays 5, no state shape change, no `g.version` bump, no new RNG draws. With no addon on, every lobby call gets the same registry object as before.
- `recipeKey` does not include the addon set, so switching a DLC on or off does not by itself rebuild the map (it would wipe painted edits). Nothing registered by an addon changes the map outside its picks yet. **T2c (fish icons) must revisit this** if icons are drawn without a pick.
- `gameRegistry(rules)` still builds a fresh registry on every action (existing behaviour). `mapRegistryFor`'s cache could serve it too; left alone because games share nothing today.
### Not done
- `npm run typecheck; npm test` has not been run for this pass.
- Not checked in a browser: tick Tidebound on the setup page, open the map menu, find "Wide water" under Perks with its "Extra water width" slider; switch Tidebound off and see it vanish and the pick clear.
- A share code that carries `wide_water` pasted into a room where Tidebound is off drops the perk and logs it ("Map code: ignored wide_water"). Turn the DLC on first, then paste.

## 2026-10-29 (Pass 61: Tidebound T2a, wide-water map perk; typecheck and tests passed)
### Added
- **`wide_water` perk (`src/packs/tidebound/bridges.ts`)**: registered by the `tidebound.bridges` addon, so it exists only while the DLC and that addon are on. Stage `extras`, conflicts with `hexagon` (no sea to widen, so with the pick the map sits on a continent, like the ragged coast), one param `water.extra` ("Extra water width (tiles)", 1 to 5, default 4). It has no game-time code: the shape stage reads the param.
- **`LandField.seaExtra` (`src/shared/mapshape.ts`)**: set by `tryShape` from `ctx.param('water.extra')` (0 when no active option declares it, so nothing changes without the pick). New constants `SEA_EXTRA_MAX` (5), `SEA_LAND_CUT` (10) and `WIDE_WATER_MIN_RADIUS` (6), and three helpers: `gapRoom(f, k, land)` (rough hex-packing estimate of the widest gap `k` landmasses can keep), `wideGap(f, baseGap, k, land, minK)` (base gap plus the extra, kept within `gapRoom`; drops landmasses down to `minK` before it gives up gap) and `centersTooClose`.
- **`tests/tideboundmap.test.ts`**: registration (exists only with the DLC and bridges addon on, param shape), perk off = same map and report as a registry without it (8 recipes, 2 radii), exact land counts (continent r8: 91 at the default, 76 at 5, 137 at 1 clamped from the recipe), determinism, island and continent gaps, no-fallback bound on big boards (loose, prints the reasons), river wider and still water and one landmass, hexagon conflict both ways, small-board warning, never throws, and unit tests for the three helpers.
### Changed
- **Land share (`tryShape`)**: with the pick on, land cells = canvas x density x (100 - 10 x extra) / 10000 (default extra 4: 60% of the normal land). The old formula is kept as its own branch, so the number is identical without the pick.
- **Islands, archipelago, continents (`packs/base/map/shapes.ts`)**: after their own count and size checks they call `wideGap`; the result replaces the count `k` and the blob gap (`growBlobs`). Islands and archipelago also fail an attempt whose centres are too close for the new gap (continents already did). Without the pick `wideGap` returns its input, so the draws and the gap are unchanged.
- **River (`shapes.ts`)**: `riverBudget` = length on a normal map; with the pick it is length x (1 + 2 per ring), never above a quarter of the land (rings = floor(extra / 2): 4 or 5 extra = 2 rings = 5 tiles across). After the centre line is carved, `widenRiver` adds the rings: a ring is the land next to the water so far, in cell order; a tile joins only if it touches no water but the river, is not on the canvas edge and keeps one arc of land (`widenOk`). So the sea and lakes stay out of reach (the mouth stays narrow), and the land never splits. A short ring adds a `shape-partial` note ("river: widened N of M rings").
- **`src/shared/mapgen.ts`**: a `wide-water-small` warning when the pick is on and the radius is under 6 ("on radius N the seas stay narrow").
### Not changed
- `GEN_VERSION` stays 5: with the pick off the output is the same (the golden test and `mapshapes.test.ts` should pass untouched). T2b bumps it.
- No new RNG draws without the pick; with it the stream names are the same, only `k`, gaps and the land count differ.
- No state shape change, no `g.version` bump.
### Not done
- `npm run typecheck; npm test` ran clean (2026-10-29). The numbers (land cut 10 per tile, the 1.6 safety factor in `gapRoom`, rings = extra / 2) are starting guesses: look at a few generated maps (the gallery idea in `Map Generation Design.md` section 15) before trusting them.
- **Not reachable from the lobby yet.** `server/lobby.ts` and `mapOptionsView()` use the process-wide registry, which has no addons, so the lobby drops `wide_water` as an unknown pick. Fixed in Pass 62 (T2a2). Tests call `generateMap` with `registryFor(allPacks, { dlc: { tidebound: true } })` directly.
- Honest limit: the canvas does not grow. At radius 10 islands get a gap of about 3 and continents stay at their own gap; 4 to 5 tiles of extra water need radius 12 to 14 or more (see the T2b question in the plan).

## 2026-10-29 (Pass 60: Tidebound T1b to T1d, Raise the Port upgrades the whole port; harbor-only 1:1 floor; panel and tests; typecheck and tests passed)
### Changed
- **T1b, whole-port upgrade (`src/packs/base/techEffects.ts`, `actions/techActions.ts`)**: Harbor charters no longer asks for a resource. `upgrade_port` takes `{ vertexId }`, stores `{ level: 1, by }` and drops the whole 3:1 port to 2:1 for every resource (still 2 wood + 1 brick + 1 ore, city only). `harborCharterModifier` reads the level and lowers the ratio for all resources (`min(current, 2)`), so a better specialised 2:1 port is never made worse. `PortUpgrade.resource` is gone; an old entry that still has one is read as a plain level 1 (whole port). The `resource` checks ("choose a resource", "already trade X at 2:1") are removed; the event is now `portUpgraded { playerId, vertexId, level }`. `legal()` gives one `{ vertexId }` per port city. `techActionsFor().harbor` drops `resources`, and each port row is `{ vertexId, level }`.
- **T1b, wiring**: `server/socket.ts` `upgradePort` forwards only `vertexId`. `base/techRoots.ts` description now says every resource trades 2:1. `server/bots/brain.ts`: the port goal and `pickUpgradePortMove` no longer pick a resource; they ask whether the bot makes (2+ pips) or holds (3+ cards) any resource it still trades above 2:1, and use the first legal port. Still Secondary and up only, still gated by `techTreeOn`.
- **T1c, harbor-only 1:1 floor (`src/shared/tradeRatio.ts`)**: new keyed registry `HARBOR_RATIO_MODS` (`HarborRatioModifier.apply(g, reg, pid, resource)` returns a ratio or null) and `HARBOR_MIN_RATIO = 1`. `ratioFor` runs it after the 2:1 floor, so a harbor is the only thing (besides gem ports) that can go under 2:1 and Market, War weariness and the rest still stop at 2:1. A harbor mod can only lower the result and never below 1:1. Nothing registers into it yet (the Harbor is T8), so every ratio is unchanged.
- **T1d, panel and tests**: `client/render/techpanel.ts` shows one "Raise to 2:1" button per port city (and "2:1 any resource" once raised), `upgradePortClick(vertexId)` has no resource; `client/types.ts` `TechActionsView.harbor` matches the server. `tests/techroots.test.ts`: Harbor charters tests rewritten for the whole port (all 5 resources 2:1, owner only, a specialised 2:1 port stays 2:1, refusals, one legal entry per port city), the T1a level tests use the new shape (an old `resource` entry is read as the whole port), the panel and tree-off lists lose `resources`, the bot test checks `{ vertexId }` and 2:1 on every resource, and a new T1c block (6 tests with a probe pack) covers the harbor floor.
- **Uniform upgrade pricing (`shared/pricing.ts`)**: new `priceOfUpgrade(g, reg, p, upgradeId, baseCost)` runs a non-piece upgrade's base cost through the same `COST_MODS` as a piece (no base limit, no doubling). The port upgrade (`upgrade_port` validate, apply, panel `harbor.cost` and `affordable`, and the bot's port goal) now reads its price through it, with `PORT_UPGRADE_ID = 'upgrade_port'` as the id modifiers see. Use the same helper for every later upgrade that costs resources (Harbor in T8, and so on). New test with a probe cost modifier.
### Not changed
- No `g.version` bump: T1a already moved it to 2 for the level shape, and dropping `resource` only removes an optional field that is still read safely.
- The tech name stays "Harbor charters" (T11 renames it to Raise the Port).
- No RNG draws added; golden snapshot should be unchanged.
### Not done
- `npm run typecheck; npm test` ran clean for T1b to T1d (2026-10-29). Settlement-only upgrade with Fishing nets is T11. The Harbor (level 2, 1:1) is T8.

## 2026-10-29 (Pass 59: Tidebound T1a, port upgrades get a level; state version 2)
### Changed
- **Port upgrade state (`src/packs/base/techEffects.ts`, `actions/techActions.ts`)**: `g.ext.core.portUpgrades[vertexId]` is now `{ level, resource?, by }` (was `{ resource, by }`). `level` is the step on the port ladder: 1 = Raise the Port (3:1 -> 2:1), 2 = Harbor (T8). New `portLevel(g, vertexId)` returns 0 for no upgrade, and counts an entry with no `level` as 1. `upgrade_port` writes `level: 1` and uses `portLevel` for the "already upgraded" check. The tech panel's `harbor.ports` rows gain `level`.
- **`src/shared/engine.ts`**: new games start at `version: 2`.
- **`tests/golden.test.ts`**: `version` joins `packs` and `round` in the fields left out of the state hash (it is a schema marker). Snapshot re-recorded once: only the `state` hashes changed.
- **`tests/techroots.test.ts`**: new stored shape, panel `level`, a legacy entry with no `level` still counts as level 1, and `g.version` is 2.
### Not changed
- Play is the same: the player still picks one resource that trades 2:1 (T1b makes it the whole port). `resource` stays on the entry until then. Games with no upgrade carry no `portUpgrades` at all.

## 2026-10-29 (Pass 58: Tidebound T0b, lobby card data, DLC-off test, placeholder ids replaced)
### Changed
- **`src/client/render/setup.ts`**: the built-in fallback catalog listed 10 made-up Tidebound addons (`shipwreck`, `flood_warnings`, `lighthouse_sight` and others with old descriptions and links). It now lists the 8 real ids from the pack, with the same names, descriptions and links. The lobby card itself needs no new code: it is drawn from the server manifest (`mapOptionsView`), which has sent `tidebound` since T0a.
### Added
- **`tests/tidebound.test.ts`**: manifest (8 addons in order, audit, 2+ links, only rickety bridges has a dependency); lobby data (server DLC and addons, and the client fallback ids must equal the server ids, so placeholders cannot return); DLC off (same new game as a registry without the pack, master switch off by default, a lone addon flag cannot enable it); DLC on (8 addons enabled but no tiles, hooks or rules added, bridges off blocks rickety bridges).
### Not changed
- The tech id `tidebound.harbor_charters` in `techRoots.ts` is a tech, not an addon, so it stays until T1 and T11 rework the root.
- No `g.version` bump (no state shape change).

## 2026-10-29 (Pass 57: Tidebound T0a, pack skeleton with 8 addon stubs)
### Added
- **`src/packs/tidebound/`**: `index.ts` (`tideboundPack`, `deps: ['base']`, empty `register()`) and one stub file per addon: `tidebound.bridges`, `tidebound.rickety_bridges` (deps bridges), `tidebound.tides`, `tidebound.rising_sea`, `tidebound.harbor`, `tidebound.fishing`, `tidebound.wrecks`, `tidebound.pirates`. Each has a description and 3 to 4 `links` (always at least one General service, so `auditAddons` passes). No `register()` on any addon: no tiles, pieces, actions, hooks or rules.
### Changed
- **`src/packs/index.ts`**: `allPacks` is now base, gold, fog, tidebound. The lobby DLC card and addon list come from the manifest, so they appear with no client change.
### Not done (next: T0b)
- No lobby card work, DLC-off test or placeholder id replacement yet. No `g.version` bump (no state shape change).

## 2026-10-28 (Pass 56: Bot tech tree support, pre-roll dev card restriction, fair dice option, tech tree cost & resource variety rebalancing, client trade auto-deny, and bot-replacement seat reconnect)
### Added & Changed
- **Bot Tech Tree Research & Root Tech Usage (`src/server/bots/brain.ts`, `tests/techroots.test.ts`)**:
  - Enabled bots to evaluate, save for, and research techs (`research_tech`) and use tech actions (`convert_tile` for Wild Earth Ground work, `upgrade_port` for Tidebound Harbor charters) as well as respect `bulwark.stockpiling` (+2 discard limit) and `warlords.plunder` (higher knight play valuation) whenever `g.rules?.techTreeOn` is enabled.
  - Gated all bot tech tree logic behind `g.rules?.techTreeOn` so tree-off games and `tests/golden.test.ts` remain 100% unchanged.
- **Pre-Roll Development Card Restriction (`src/packs/base/actions/devCards.ts`, `src/client/render/hand.ts`, `tests/rules.test.ts`)**:
  - Updated `playDevAction.validate` and `playDevAction.legal` in `src/packs/base/actions/devCards.ts` and client hand UI (`renderHand`, `onClickDevCard` in `src/client/render/hand.ts`) so only `knight` can be played during the `roll` phase before rolling the dice; `monopoly`, `yearOfPlenty`, and `roadBuilding` require the `main` phase.
- **Fair Dice Option (`src/packs/base/actions/roll.ts`, `src/server/types.ts`, `src/server/runtime.ts`, `src/server/lobby.ts`, `public/index.html`, `src/client/actions.ts`, `src/client/render/index.ts`, `src/client/render/setup.ts`, `tests/rules.test.ts`)**:
  - Added a `fairDice` lobby/game rule toggle (`#setFairDice` in World Setup) that draws 2d6 rolls from a seeded 36-combination 2d6 shoe (`g.ext.base.fairDiceDeck`, reshuffled with a 6-card cut) so dice rolls follow the 2d6 bell curve (`1,2,3,4,5,6,5,4,3,2,1`) and prevent extreme streaks while leaving default `fairDice: false` games untouched.
- **Tech Tree Cost & Resource Variety Rebalancing (`src/shared/stage1.ts`, `src/packs/base/techRoots.ts`, `tests/stage1.test.ts`)**:
  - Added branch-specific resource rotations (`BRANCH_TECH_RESOURCES` and `TechDef.costResources`) across all 5 resources (`tidebound`: wood/sheep/ore, `bulwark`: brick/ore/wood, `warlords`: ore/wheat/sheep, `wildearth`: wood/brick/wheat, `guildhall`: sheep/wheat/brick) instead of charging only wheat and ore.
  - Scaled the building-value divisor in `techCostCards` with `vpToWin` (`max(3, round(0.3 * vpToWin))`, e.g., `3` at 10 VP and `8` at 25 VP) and lowered `wildearth.ground_work` `costOffset` from `2` to `1`.
- **Auto-Deny Trade When Client Lacks Requested Resources (`src/packs/base/actions/tradeOffers.ts`, `src/packs/base/trading.ts`, `src/client/render/trade.ts`, `tests/rules.test.ts`)**:
  - Automatically sets human responder status to `'declined'` on `propose_trade`, `counter_trade`, and `pruneInvalidTrades` when the human player does not hold the requested resources, and auto-emits `respondTrade: 'declined'` on the client in `renderActiveTradeModal`.
- **Reconnect Player Back to Bot Replacement Seat (`src/server/rooms.ts`, `src/server/socket.ts`, `src/client/main.ts`, `tests/rules.test.ts`)**:
  - Updated `rebindPlayerId` in `src/server/rooms.ts` to rebind `g.ext.core` per-player state (`techs`, `groundWork`, `portUpgrades`, `eventDeck.fateTokens`).
  - Updated `tryReclaimSeat`, `joinRoom`, `toggleSpectate`, and `reconnectRoom` in `src/server/socket.ts` (plus automatic socket reconnect in `src/client/main.ts`) so a disconnected player reconnecting via Reconnect, Join Game, auto-reconnect, or spectator toggle reclaims their bot replacement seat instead of being routed to spectator mode.

## 2026-10-28 (Pass 55: Tech tree tiers, the two-lane split and the Tidebound tree; docs only, no code)
### Added
- **`Tech Tree Design.md`**: section 6 (the 4 tiers: base, lock-in, boost, defining, each with an offset band and a price at V = 2), section 7 (every DLC branch forks into two lanes after its root; the lock is economic, not a rule; tech panel needs fork layout), section 8 (the full Tidebound tree: root Raise the Port, Expansion lane with Rickety bridges, Salvage crew, Pirate hunter and Grand Causeway, Industrial lane with Fishing nets, Net works, Harbor master and Harbor empire; port ladder; lane identity; code impact list), section 9 (5 open questions), section 10 (later).
- **`Ideas.md`**: a General bullet for the tiers and lanes, and a Tidebound skill tree block with 10 new ideas (each with links): Raise the Port, Port ladder, settlement-only port upgrades, Net tiers, Feed the sea, Harbor limit and Harbor +1, Demolish a bridge, wreck and pirate scaling, Grand Causeway, Harbor empire.
### Changed (design only)
- The root now upgrades a whole port 3:1 -> 2:1 'any resource' (ratio only). The step 6 code still lets the player pick one resource; this is listed in the code impact of section 8.
### Not done
- No code changed. The nodes beyond the root are not registered. Open: 5 levels vs 4 tiers, whether the tree gates DLC content, and the cost divisor at 25+ VP (see section 9).

## 2026-10-28 (Pass 54: Tech tree step 7, sim matrix with the tree on and off)
### Changed
- **Sim matrix (`src/server/bots/sim.ts`)**: added `techTreeOn` and optional `scenarioIds` filtering to `SimMatrixDlcComboSpec` and `techTreeOn` to `SimMatrixCellResult`. `runSimMatrix` only sets `rules.techTreeOn = true` when a combo enables it, leaving tree-off rows and their rules untouched.
- **Matrix tests (`tests/simmatrix.test.ts`)**: kept the 4 existing tree-off cells (`standard` and `islands` × `base` and `events_on`, 8 games) unchanged and added 2 tree-on cells on the `standard` map (`tech_base` and `tech_events_on`, 4 extra games, 12 total), running full invariant and completion checks on all rows.
- **Docs (`INDEX.md`, `Ideas.md`)**: updated `sim.ts` and `simmatrix.test.ts` descriptions in `INDEX.md`, and noted bot research/use of root techs in `Ideas.md`.

## 2026-10-28 (Pass 53: Tech tree UI rework, radial tree and Tech button in the action bar; untested)
### Changed
- **Tech button** (`render/techpanel.ts`): moved from the left edge into the action bar, left of Trade (`.act-btn` with a new `tech` icon in `icons.ts`). Shown only while the tree is on; lit (`active-mode`) while the panel is open.
- **Tech panel** (`render/techpanel.ts`): now a radial tree (hub in the middle, one spoke per branch, one ring per tier), flat circles with a pictogram, tinted by branch with muted tile tokens. Only ring 1 exists today (the 5 roots). Later tiers fill the rings from `TechRowView.tier` and `prereqs` (lines run to the first prereq, or to the hub), so a DLC branch needs no panel edit.
  - **Description hidden**: shown only on hover or keyboard focus, in the same dark tooltip style as the road price tooltip. The tooltip opens toward the hub so it never leaves the panel.
  - **Costs as cards**: each tech shows its price as mini resource cards (the build recipe style, dimmed for what the hand cannot cover) instead of text. The Harbor upgrade price uses the same card strip.
  - **States** (never color alone): owned = green ring and check badge; researchable now = accent ring, click to research; otherwise dimmed.
  - The Harbor charters and Ground work controls moved to a row under the tree.
  - The panel is redrawn only when its content changed, so a hovered description does not flicker on each broadcast.
### Fixed
- **Typecheck error** (`src/client/types.ts`): `AddonInfoView` gained an optional `allowCrossDlcDep` field, which the placeholder DLC catalog in `render/setup.ts` already used (TS2353).
### Not done
- Not looked at in the browser yet. Later rings (tier 2 and 3) are untested because no such techs exist yet.

## 2026-10-28 02:20:00 ICT (UTC+7) (Pass 52: Fix trade offer button alignment, restore clean card stack numbers, and eliminate trade editor reload flicker)
### Fixed
- **Trade Proposal Button & Header Alignment (`src/client/render/trade.ts`, `src/client/styles.css`, `src/client/icons.ts`)**:
  - Restored the two-column `.trade-offer-main` layout (`badge + cards rows on the left, buttons on the right`, vertically centered) so the trade proposal action buttons (`[✓]`, `[✏️]`, `[✕]`) sit cleanly aligned on the right side of the offer card instead of hanging offset in the bottom row.
  - Centered the `pencil` SVG icon path (`UI_ICONS.pencil` in `src/client/icons.ts`) inside the `0 0 24 24` viewBox so it is no longer shifted to the top-right corner of the edit button.
  - Positioned `.trade-collapse-btn` with `position: absolute; right: 10px` inside `.trade-top-avatars` so the opponent avatars in the top header strip stay dead-center.
- **Trade Card Number Display (`src/client/render/trade.ts`, `src/client/styles.css`)**:
  - Replaced the overlapping top-right `.trade-card-count` badge (which covered and blocked the resource pictogram icon) with `buildOverlappingStackHtml` from `src/client/icons.ts`, matching `Design UI Philosophy.md` and the player hand / trade drawer (resource glyph on top, count cleanly below the glyph, and overlapping card slices when count > 1).
  - Restored `.mini-res-card` in `.counter-picker`.
- **In-Place Trade Counter-Offer Editing Without Flicker (`src/client/render/trade.ts`)**:
  - Removed the `.trade-card-enter` slide-in animation from `.trade-counter` and updated `refreshCounterView()` to patch `[data-counter-get]`, `[data-counter-give]`, and `[data-counter-send]` in place when editing a trade, preventing the trade window from disappearing and re-animating on every card click.


## 2026-10-28 (Pass 51: Tech tree step 6, effects of all 5 root techs; untested)
### Added
- **`techEffects.ts`** (`src/packs/base/techEffects.ts`, registered by `registerTechRoots`): one modifier or helper per root, each asking `hasTech` first, so a game where nobody researched it is unchanged.
  - **Bulwark Stockpiling**: `stockpilingModifier` on `DISCARD_LIMIT_MODS`, +2, stacks with Catch-up.
  - **Guildhall Road levy**: `roadLevyModifier` on `COST_MODS`. Only past the road cap (2x price): 1 less brick or wood, taken from whichever the player holds fewer of (wood on a tie).
  - **Tidebound Harbor charters**: `harborCharterModifier` on `RATIO_MODS`. An upgraded 3:1 port trades one chosen resource 2:1 for the city's owner. State in `g.ext.core.portUpgrades[vertexId]`.
  - **Warlords Plunder**: `plunderModifier` on the new `STEAL_COUNT_MODS`. A played Knight steals 1 extra card; a rolled 7 is unchanged.
  - **Wild Earth Ground work**: helpers `groundWorkSourceError`, `basicTileIds`, `rollTileNumber`. State in `g.ext.core.groundWork[pid]`.
  - `techActionsFor(g, reg, pid)`: read-only lists for the panel (harbor cities, Ground work tiles). Never touches the RNG.
- **Actions** (`actions/techActions.ts`, in the `main` phase): `upgrade_port` (city on a 3:1 port, 2 wood + 1 brick + 1 ore, one resource of choice) and `convert_tile` (once per player; land tile touching your settlement or city; basic target only; number kept; a desert gets a rolled number, never 7). Both return no legal actions without the tech.
- **Robbing refactor** (`robbing.ts`): `STEAL_COUNT_MODS`, `stealCount`, `setStealSource` / `stealSourceOf` / `clearStealSource`. `stealOne` asks the registry for the count (1 with no modifier, so one draw exactly as before). The Knight sets the source in `devcards.ts`; `robber.ts` clears it when the steal ends.
- **Server and client**: socket events `upgradePort` and `convertTile` (`socket.ts`); `techActions` per viewer in the state (`view.ts`, null on the same terms as `techTree`); `TechActionsView` in `client/types.ts`; `techpanel.ts` shows the harbor upgrade buttons under Tidebound and the Ground work tile + resource picker under Wild Earth.
### Tests (`tests/techroots.test.ts`, new)
- Stockpiling 7 to 9, stacking with Catch-up; Road levy below and above the cap and the adaptive pick; Harbor charters (upgrade, refusals, only the chosen resource and owner); Plunder (Knight 2, 7 steals 1, small hand, marker cleared); Ground work (once, number kept, desert roll, sea and hidden refused, RNG untouched); tree off adds no actions and no state.
### Not done
- Bots never research or use these techs. Tile click on the board for Ground work (the panel list is used instead). Sim matrix is step 7. Not run: needs `npm run typecheck` and `npm test`.

## 2026-10-28 (Pass 50: Tech tree step 5, research action and tech panel; red-number flake fixed; untested)
### Added
- **`research_tech` action** (`src/packs/base/actions/research.ts`, listed in the `main` phase in `phases.ts`): validates and applies through the shared `techResearchCheck` / `researchTech`. `legal` returns nothing while `rules.techTreeOn` is off, so games without the tree gain no legal actions and no state.
- **`techResearchCheck(g, reg, pid, techId, payment?)`** (`src/shared/stage1.ts`): every research rule in one side-effect-free function (same messages and order as before). `researchTech` now calls it, so the action and the panel cannot disagree.
- **`techPanelFor(g, reg, pid)`** (`stage1.ts`): one row per tech the game offers (disabled-DLC techs left out) with this player's price, the wheat + ore payment, `owned`, `canResearch` and the reason. Generated from `allTechDefs`, so a DLC branch needs no panel edit.
- **The 5 root techs** (`src/packs/base/techRoots.ts`, registered by the base pack through `api.define(TECH_DEFS, ...)`): Tidebound Harbor charters, Bulwark Stockpiling, Warlords Plunder (+1), Wild Earth Ground work (+2), Guildhall Road levy. No `dlc`, no `prereq`, tier 1. **Data only:** until step 6 wires each effect, researching one just spends the cards and records it. The tree is off by default.
- **Server and client**: socket event `researchTech` (`socket.ts`); per-viewer `techTree` rows in the state (`view.ts`, null when the tree is off or the viewer spectates); `TechRowView` in `client/types.ts`; new `client/render/techpanel.ts` (Tech button on the left edge, hub-and-spoke modal with one spoke per branch, Research button enabled on your own turn in the main phase). Draws its own DOM and styles, so `index.html` and `styles.css` are unchanged.
### Fixed
- **Two red numbers touching on a standard board** (`numbers.ts`, `numbers.test.ts` failure "standard r4: expected 1 to be greater than 1"): the random swap loop is best effort and rarely stalls with one 6/8 pair left, and a board with only that warning still passes the generator. `settleNumbers` now ends with a deterministic sweep (no RNG draws) that moves a touching red token to any allowed tile where it touches no other red. Boards that were already clean come out the same.
### Tests (`tests/stage1.test.ts`)
- The "no built-in techs" test now expects exactly the 5 roots in build order; new tech audit (unique ids, prereqs exist, tier 1 to 3, roots have no `dlc`, every `dlc` is a known pack); new research action + panel test (prices at V = 2, payment, refusals, per-player); new "tree off adds no legal actions and no state" test.
### Not done
- No bot research logic (bots never research). Roots have no effect yet (step 6). Sim matrix with the tree on and off is step 7. Not run: needs `npm run typecheck` and `npm test`.

## 2026-10-28 (Pass 49: Tech tree step 4, rules.techTreeOn toggle)
### Added
- **`techTreeOn` setting (default off)**: `Settings.techTreeOn` (`src/server/types.ts`), default `false` in `defaultSettings`, validated in `mergeSettingsDetailed` (`src/server/lobby.ts`: a non-boolean keeps the old value), and mapped by `rulesFromSettings` (`src/server/runtime.ts`) to `rules.techTreeOn = true` only when on. Off adds nothing to the rules, so existing games and the golden test are unchanged.
- **Lobby UI**: a "Tech tree" checkbox (`#setTechTreeOn`) in the world setup page under Map and rules (`public/index.html`), sent by `pushSettings` (`src/client/actions.ts`), kept in sync in `src/client/render/index.ts`, and shown as a "Tech tree ON / off" pill in the Active summary (`src/client/render/setup.ts`).
### Changed
- **`researchTech` (`src/shared/stage1.ts`)** refuses with "The tech tree is off in this game" when `rules.techTreeOn` is not set, before it touches resources or state. Turning DLCs off does not turn the tree off.
- **Tests (`tests/stage1.test.ts`)**: the research test now runs with `techTreeOn: true`; new tests for the off refusal (nothing spent, nothing stored) and for the setting (default off, merge rules, only reaches the rules when on).

## 2026-10-28 (Pass 48: Tech tree step 3, remove the 4 old base techs)
### Removed
- **Old base techs (`src/shared/stage1.ts`)**: `base.road_engineering`, `base.harbor_charters`, `base.literacy` and `base.fortified_towns`. `BASE_TECH_DEFS` is now an empty list; every tech is added with `api.define(TECH_DEFS, ...)`.
- **Their modifiers**: `techRoadCostModifier` and `techHarborCharterRatioModifier`, and their two `api.define` lines in `registerStage1Definitions`. Unused imports went with them (`addGarrison`, `COST_MODS`, `CostModifier`, `PieceDef`, `RATIO_MOD_ORDER`, `RATIO_MODS`, `RatioModifier`).
### Changed
- **Tests (`tests/stage1.test.ts`)**: the combined old-tech test is replaced by two tests: no built-in techs, and a research test with three test-only techs (single prereq, list prereq, `costOffset`, `onUnlock`, cost, already-researched). `makeStage1Game` takes an optional third argument to register extra defs.

## 2026-10-28 (Pass 47: Tech tree step 2, per-player cost formula)
### Changed
- **Tech cost formula (`src/shared/stage1.ts`)**:
  - `techCostCards(g, reg, pid, tier, offset = 0)` now returns `max(floor, tier + offset + ceil(V / divisor))`, where V = settlements x1 + cities x2 + castles x3 (`techBuildingValue`).
  - New `TECH_COST` constants object (`settlement 1, city 2, castle 3, divisor 3, floor 2`), the single place to tune prices in the sim matrix.
  - Removed the Literacy clause. The Catch-up discount stays (0 techs and eligible pays 1 less, never below the floor).
  - `TechDef` gained `costOffset?: number`; `researchTech` passes it to the formula.
  - `TechDef.prereq` is now `string | string[]` (new helper `techPrereqs`); `researchTech` checks every listed prereq.
- **Tests (`tests/stage1.test.ts`)**: the old combined tech test now expects Literacy to give no discount (cost stays 3). Added a formula test over V = 0 / 2 / 5 / 9 / 14 with offsets 0 to 2, and a Catch-up discount test.
- Old base techs and their modifiers are still in place (removed in step 3).
## 2026-10-28 01:12:00 ICT (UTC+7) (Pass 47: Align DLC catalog and Scenario presets strictly with the 6 DLCs in Ideas.md)
### Fixed & Changed
- **DLC & Addon Setup Catalog (`src/client/render/setup.ts`)**:
  - Removed the invented 8-DLC placeholder catalog (`heartland`, `ledger`, `wayfarers`, `crimson`, `whispers`, `wildlands`) and replaced it with the exact 6 DLC packs from `Ideas.md`:
    1. **Tidebound** (`tidebound`): Bridges, Rickety Bridges, Tides, Rising Sea, Harbor Upgrade, Shipwreck Salvage, Flood Warnings, Fishing, Pirates, Lighthouse Tide Sight.
    2. **Bulwark** (`bulwark`): Walls & Zone Control, Wall Tiers, Siege, Castle, Wall Decay, Gatehouse, Castle Sieges, Sea Wall.
    3. **Warlords** (`warlords`): Knights as Armies, Mercenaries, War Mechanic, Diplomacy & Embassies, Alliances & Betrayal, Wave Defense (Co-op), King vs. Peasant, Player vs. AI Warlord, War Weariness.
    4. **Wild Earth** (`wildearth`): Emerald & Diamond Tiles, Gem Market, Volcano, Oasis in the Desert, Seasons, Meteor Crater, Plague, Aftermath & Ground Work, Biome Tags, Quarantine Card, Plague Doctor Tech.
    5. **Guildhall** (`guildhall`): Sheep Economy, Debt, Debt Tie-ins, Landmarks, Landmark Set Bonus, Ruins (Landmark), Monuments, Trade Caravans.
    6. **Rowdy Tavern** (`rowdy`): Hat Day, Drunk Robber, Karaoke 7, Robbery Minigames, Bot Drinking Game, Instigation, Hat Unlocks, Hat of Shame.
- **Scenario Presets (`src/server/mapmenu.ts`)**:
  - Replaced placeholder scenarios with the exact scenario presets from `Ideas.md`: **Standard Catan**, **Kingdoms** (`bulwark` + `warlords`), **Drowned World** (`tidebound` + `wildearth`), **Party Night** (`rowdy`), **Merchant Republic** (`guildhall` + `tidebound`), **Cataclysm** (`wildearth`), and **Everything Bagel** (all 6 DLCs).
- **Tech Tree Spec, Handoff & Docs (`Tech Tree Design.md`, `Handoff - Tech Tree Roots.md`, `Development Plan.md`, `Ideas.md`, `INDEX.md`)**:
  - Added `Tech Tree Design.md` locking the 5 root techs (`tidebound.harbor_charters`, `bulwark.stockpiling`, `warlords.plunder`, `wildearth.ground_work`, `guildhall.road_levy`), per-player building-value cost formula, and per-tech hook specifications.
  - Added `Handoff - Tech Tree Roots.md` with the 7-step implementation order and DLC extensibility rules.
  - Updated `Development Plan.md` and `Ideas.md` to mark completed Stage 0 items, partial Stage 1 infrastructure, and link Stage 1 step 1 to `Tech Tree Design.md`.
  - Registered `Tech Tree Design.md` and `Handoff - Tech Tree Roots.md` in `INDEX.md`.

## 2026-10-28 00:18:00 ICT (UTC+7) (Pass 46: Restore rich player avatars and game theme colors in trading modal)
### Fixed & Improved
- **Avatar Background & Contrast Restoration (`src/client/render/trade.ts`, `src/client/styles.css`, `src/client/avatars.ts`)**:
  - Removed the white background circle and radial gradients that washed out the cream animal avatars (`🦊`, `🐼`, `🦁`, `🐸`).
  - Restored classic round `.avatar` styling with solid player-color backgrounds (`style="background:${p.color}"`), ensuring crisp contrast for both player and bot faces in the trade header and proposer rows, consistent with the sidebar player roster.
  - Restored `avatars.ts` glyphs.
- **Trade Modal Theme Harmonization (`src/client/styles.css`, `src/client/render/trade.ts`)**:
  - Replaced hardcoded electric blue border (`#2772b0`) and harsh tan/cream backgrounds (`#ede4d4` / `#fbf8f2`) with the project's native theme tokens (`var(--surface)`, `var(--surface-2)`, `var(--line)`, `var(--shadow)`, `var(--r-lg)`).
  - Preserved the streamlined 2-row layout from Colonist (Row 1 receiving with green arrow; Row 2 offering with red arrow and action buttons on the right).
  - Used theme resource colors (`--tile-wood`, `--tile-wheat`, `--tile-ore`, etc.) for trade cards and standard theme action button colors (`--ok`, `--danger`, `--accent`).
  - Maintained all rapid bot trading, instant trade resolution, counter offering, and multiplayer confirmation capabilities.

## 2026-10-28 00:05:00 ICT (UTC+7) (Pass 45: Complete Colonist trade card UI overhaul following visual spec and Design UI Philosophy)
### Added & Changed
- **Colonist Trade Card Layout & Framing (`src/client/render/trade.ts`, `src/client/styles.css`)**:
  - Restructured `#activeTradeModal` to match the exact Colonist 2-row layout with signature blue framing border (`#2772b0`), warm tan/cream header (`#ede4d4`), and off-white parchment card body (`#fbf8f2`).
  - Top header strip now centers circular opponent/bot avatars (`.colonist-header-avatar`) with color-accented rings, radial gradients, and response indicators.
  - Positioned collapse toggle on header right edge to keep player avatars centered.
- **2-Row Directional Trade View (`src/client/render/trade.ts`, `src/client/styles.css`)**:
  - **Row 1 (Receiving)**: Clean 3-person silhouette group outline icon (`trade-who-group-svg`), chunky solid green down arrow (`.colonist-arrow-down`), and requested resource card tiles.
  - **Row 2 (Offering & Actions)**: Proposer avatar circle with player color outline and silhouette face (`.colonist-who-avatar`), chunky solid red up arrow (`.colonist-arrow-up`), offered resource card tiles, and the full strip of square action buttons on the right.
- **Colonist Resource Card Tiles (`src/client/render/trade.ts`, `src/client/styles.css`)**:
  - Rendered distinct vertical card tiles (`.colonist-card`) per resource with color-coded borders (e.g. gold wheat border `#dfa612`, forest wood `#2e7d32`, slate ore `#546e7a`).
  - Added royal-blue square count badge (`.colonist-card-badge`) docked in the top-right corner of each card displaying quantity (e.g. `[1]`), matching the screenshot.
  - High-contrast, clean matte vector pictograms following `Design UI Philosophy.md`.
- **Colonist Square Action Buttons (`src/client/render/trade.ts`, `src/client/styles.css`, `src/client/icons.ts`)**:
  - Rounded square buttons (`36x36px`, `border-radius: 8px`, white outer bevel/border, bold icons):
    - **Declined responder**: Pastel salmon/pink square with soft red `✖` (`.colonist-act-btn.resp-declined`).
    - **Accepted responder**: Vibrant player-color square with bold white checkmark `✔` (`.colonist-act-btn.resp-accepted`) enabling the proposer to complete the trade in one click.
    - **Pending responder**: Subtle dashed square with pulsing player-color dot (`.colonist-act-btn.resp-pending`).
    - **Counter / Edit**: Vibrant cyan square with crisp white pencil icon (`.colonist-act-btn.btn-counter`).
    - **Cancel offer**: Teal square with crisp white `✖` (`.colonist-act-btn.btn-cancel`).
    - **Responder Accept/Decline**: Solid green checkmark and red X buttons for active trade responders.
- **Avatars & Icons (`src/client/avatars.ts`, `src/client/icons.ts`)**:
  - Enhanced retro computer robot avatar glyph (`🤖`) with monitor screen, eyes, mouth, and keyboard base matching the screenshot.
  - Added hat avatar glyph (`🤠`) for bowler/farmer hat proposer avatars.
  - Added `pencil` SVG icon to `UI_ICONS` in `src/client/icons.ts`.

## 2026-10-27 23:59:00 ICT (UTC+7) (Pass 44: Colonist-paced bot trading - snappy responses, natural seat stagger, and prompt trade resolution)
### Changed & Fixed
- **Bot Trade Response Speed (`src/server/bots/scheduler.ts`)**:
  - Reduced `BASE_DELAY.respond_trade` from `1250ms` down to `320ms` so bot responses pop in swiftly like in Colonist.io.
  - Replaced the previous 900ms–1800ms artificial settle delay with a subtle, natural seat stagger (`botIndex * 60ms`), ensuring all bots respond within ~0.5s–0.8s without simultaneously flashing on the exact same frame.
- **Bot Trade Proposal Window & Resolution (`src/server/bots/scheduler.ts`, `src/server/bots/brain.ts`)**:
  - Reduced `BOT_TRADE_WAIT` from `12000ms` (and 6s minimum) down to `3600ms` (3.6s, standard Colonist trade window).
  - When all responses have arrived or when a player accepts the bot's trade, the bot now resolves immediately (~300ms) rather than idling for seconds.
  - Updated bot `mainPhase` in `src/server/bots/brain.ts` so bots execute `confirm_trade` immediately when an offer is accepted by a partner instead of prematurely cancelling.

## 2026-10-27 23:53:00 ICT (UTC+7) (Pass 43: Fix dice rolling trigger and immediate rolling animation feedback)
### Fixed
- **Dice Roll Emit Blockage (`src/client/actions.ts`, `src/client/render/index.ts`, `public/index.html`, `src/client/styles.css`)**:
  - Fixed client-side `rollDice()` which was blocked from emitting `rollDice` because of references to non-existent properties (`state.myId`, `state.turnPlayerId`).
  - Restored clean `socket.emit('rollDice', { code: state.code })` emit and added immediate tactile dice roll shake feedback upon click.
  - Attached direct `onclick="rollDice()"` to `#die1` and `#die2` in addition to `#dicePair` container so clicks anywhere on the dice or faces register instantly.
  - Fixed `isMyTurn` check in `src/client/render/index.ts` to check `(state.currentPlayerId === socket.id) || (current && current.id === socket.id)`.
  - Added `cursor: pointer; pointer-events: auto;` to `.dice-pair` and `.die-box`.

## 2026-10-27 23:45:00 ICT (UTC+7) (Pass 42: Interactive physical dice roll & decouple dice rolling from pass turn button)
### Changed
- **Decoupled Dice Rolling from Pass Turn Button (`public/index.html`, `src/client/render/index.ts`, `src/client/actions.ts`)**:
  - Removed dice rolling trigger, dice icon, and "Roll" text from the pass turn button (`#btnMainTurnAction`).
  - Pass button is now strictly dedicated to passing/ending turns (`mainBtnIcon` set to `uiIcon('pass')` and label "Pass").
  - The pass button is enabled only during the active player's `MAIN` phase and disabled during `ROLL` (or non-turn) phases.
  - Updated `mainTurnButton()` in `src/client/actions.ts` to only execute `endTurn()` during `MAIN` phase.
- **Interactive Board Dice Trigger & Visual Affordances (`public/index.html`, `src/client/styles.css`, `src/client/actions.ts`, `src/client/render/index.ts`)**:
  - The physical dice pair element (`#dicePair` / `.dice-pair`) is now the direct trigger for rolling.
  - When in the active player's `ROLL` phase, `#dicePair` dynamically receives `.can-roll`, `title="Click dice to roll!"`, `role="button"`, and keyboard triggers (`Enter` / `Space`).
  - Added CSS styling and animations: pulsing accent glow (`diceRollPulse`), hover lift and scale, active click compression, and a floating `"CLICK TO ROLL"` prompt badge above the dice.
  - Guarded client-side `rollDice()` in `src/client/actions.ts` to verify active player turn and `ROLL` phase before emitting to server.

## 2026-10-27 23:35:00 ICT (UTC+7) (Pass 41: Fix darkened display and blocked clicks caused by unhidden round-recap mount overlay)
### Fixed
- **Screen Darkening and Click Interception Bug (`public/index.html`, `src/client/styles.css`, `src/client/render/overlay.ts`)**:
  - Identified that `#roundRecapMount` was declared in `public/index.html` without `style="display:none;"`, while `.round-recap-mount` in `src/client/styles.css` was styled with `position: fixed; inset: 0; z-index: 66; display: flex; background: rgba(0, 0, 0, 0.38);`.
  - On page load, this mounted an empty, full-screen dark backdrop overlay across the entire viewport at `z-index: 66`, intercepting all pointer events and darkening the board, map painter, and game controls.
  - Added `style="display:none;"` to `<div id="roundRecapMount">` in `public/index.html`, updated `.round-recap-mount` to `display: none` by default in `src/client/styles.css`, and added `.round-recap-mount:empty { display: none !important; pointer-events: none !important; }` to guard against any lingering overlays.
  - Resolved TypeScript import and type signatures in `src/shared/botGoals.ts`, `tests/botgoals.test.ts`, and `tests/setuppage.test.ts`. All 339 tests across 29 suites pass cleanly.

## 2026-10-27 23:25:00 ICT (UTC+7) (Pass 40: Implement 'Turn History' view within log section summarizing key player actions across previous rounds)
### Added & Changed
- **Turn History Recorder & Engine (`src/server/turnHistory.ts`, `src/server/game.ts`, `src/server/types.ts`, `src/server/view.ts`, `tests/turnhistory.test.ts`)**:
  - Created `src/server/turnHistory.ts` providing `recordTurnHistory`, `RoundSummary`, `PlayerTurnSummary`, and `TurnActionItem` to structure player actions by round and turn count.
  - Automatically records and aggregates key actions in each round:
    - 🎲 **Dice rolls**: roll values, dice pair Breakdown, and 7-robber activation.
    - 🌾 **Production**: consolidated resource yields per turn (e.g., `+2 Wheat, +1 Wood`).
    - 🏠/🏰/🛣️ **Buildings**: initial settlement/road draft placements, settlements, cities, and roads.
    - 🥷/⚔️ **Robber & Knights**: robber hex movement, knight card plays, and stolen cards from victims.
    - 🃏 **Development cards**: card purchases and plays (Knight, Road Building, Year of Plenty, Monopoly).
    - 🤝/🏦 **Trading**: player-to-player trades with partners, and 4:1/port bank trades.
    - 🗑️ **Discards**: cards discarded when a 7 is rolled.
    - 🏆 **Achievements & Victory**: Longest Road, Largest Army, DLC events, and victory claims.
  - Wired `recordTurnHistory` into `runAction` in `src/server/game.ts` and initialized `room.turnHistory = []` on `startGame`.
  - Added `turnHistory` and `round` to room state broadcast in `src/server/view.ts`.
- **Turn History UI within Log Section (`public/index.html`, `src/client/render/sidebar.ts`, `src/client/store.ts`, `src/client/main.ts`, `src/client/types.ts`, `src/client/styles.css`)**:
  - Embedded tab toggles inside `#logSection`: `[Live Log]` and `[Turn History]`, allowing seamless switching between the real-time continuous event feed and the structured round-by-round turn history.
  - Rendered interactive round cards grouped in reverse chronological order (current/newest round at top with `Current` tag) showing player avatar face, color border, player name, bot tag, turn number, and categorized action rows with icons and badges.
  - Added collapsible/expandable round accordions with one-click toggles (`toggleRoundCollapse`).
  - Added an informative empty state when in the lobby or before rounds start.
  - Added comprehensive CSS styling for `.log-head-tabs`, `.log-tab-btn`, `.turn-history-feed`, `.th-round-group`, `.th-turn-card`, and color-coded action category badges (`cat-roll`, `cat-build`, `cat-rob`, `cat-dev`, `cat-award`).
- **Tests & Verification (`tests/turnhistory.test.ts`)**:
  - Added comprehensive unit tests in `tests/turnhistory.test.ts` covering setup phase draft placement tracking, dice rolls, production consolidation, road/settlement/city builds, dev card plays, bank/player trading, and multi-round advancement.
  - All 66 tests across 6 test suites passed including `tests/golden.test.ts` baselines; `compile_applet` passed cleanly.

## 2026-10-27 22:38:00 ICT (UTC+7) (Pass 39: Fix second Knight playability on next turn, restore map-size scaling of resources/dev cards/build limits, stack counter-trades down & pace bot trading, and randomize player turn order preserving colors)
### Fixed & Added
- **Second Knight playability after obtaining two Knights in the same turn** (`src/shared/state.ts`, `src/server/bots/brain.ts`, `src/client/main.ts`, `src/server/socket.ts`):
  - `startTurn` in `src/shared/state.ts` now promotes any remaining `p.newDevCards` into `p.devCards` for all players and resets `ctx.g.phaseStack = []` alongside `p.flags = {}`.
  - Updated `knightBeforeRoll` and `shouldPlayKnight` in `src/server/bots/brain.ts` so Secondary and Overload bots also play their second Knight on the turn after playing their first Knight (`chase.army` or `knightsPlayed >= 1`).
  - Cleared in-flight card counters on turn transitions and excluded UI overlays (`#myHandPanel`, `#activeTradeModal`, `#inlineDrawerWrap`, `#gameSettingsMenu`) from map-drag click suppression in `src/client/main.ts`; enabled error toast reporting on `playDevCard` in `src/server/socket.ts`.
- **Map-size scaling of resources, dev cards, and build limits** (`src/server/runtime.ts`, `src/server/lobby.ts`, `src/server/socket.ts`, `src/server/game.ts`):
  - Updated `scaledPieces(vpToWin, landHexes)` and `scaledSupply(players, landHexes)` in `src/server/runtime.ts` so build limits (`maxRoads`, `maxSettlements`, `maxCities`), bank resources (`bankResourcePerType`), and dev card counts (`devKnights`, `devVp`, `devRoadBuilding`, `devYearOfPlenty`, `devMonopoly`) scale with map land hex count (`landHexes > 19`) as well as player count and `vpToWin`.
  - Added `countLandHexes` and `syncSettingsToBoard` in `src/server/lobby.ts` and wired them into `refreshMap`, `applyMapStart`, `applyRecipeStyle`, `updateSettings`, `addBot`, `removeBot`, and `paintHex` so lobby settings and inputs automatically scale whenever the map size changes.
- **Counter-trade vertical stacking & bot trade pacing** (`src/packs/base/actions/tradeOffers.ts`, `src/client/render/trade.ts`, `src/server/bots/scheduler.ts`):
  - `counterTradeAction` in `src/packs/base/actions/tradeOffers.ts` now marks `previous.responses[pid] = 'declined'` and pushes the counter offer onto the trade stack (`pushTrade(g, counter)`) instead of deleting the original offer card.
  - `renderOneTradeCard` in `src/client/render/trade.ts` renders the counter-offer composer card stacked down underneath the original trade offer card rather than replacing it in place.
  - Increased bot trade response and proposal delays (`respond_trade: 1250ms`, minimum settle lead-in `900ms–1800ms`, `BOT_TRADE_WAIT: 12000ms` with 6s minimum) in `src/server/bots/scheduler.ts` so bot trades are readable and give human players ample time to react.
- **Randomize player turn order at game start** (`src/shared/engine.ts`, `src/server/game.ts`):
  - `PlayerInit` and `createGame` in `src/shared/engine.ts` preserve each player's chosen `color` across seat shuffling (`shuffleSeats: true`), and `startGame` in `src/server/game.ts` syncs `room.lobbyPlayers` to the randomized turn order.

## 2026-10-27 21:55:00 ICT (UTC+7) (Pass 38: Clankerton's Stage 0 S0.5–S0.11 & Stage 1 Foundation)
### Added & Changed
- **S0.5–S0.11 Core Services (`src/shared/tradeRatio.ts`, `src/shared/production.ts`, `src/shared/tileState.ts`, `src/shared/sevenResolver.ts`, `src/shared/coreServices.ts`, `src/shared/history.ts`, `src/shared/eventDeck.ts`, `tests/clankerton_s0.test.ts`)**:
  - Verified and completed Stage 0 services: Trade Ratio (`bestTradeRatio`), Production Pipeline (`PROD_MODS`, `PROD_TRIGGERS`), Tile State (`wild` token, durability, `setTileState`), Seven Resolver (`SEVEN_HOOKS`, `resolveSeven`), Markers/Ledger/Strength/Relations (`coreServices.ts`), History Buffer & Stats Registry (`history.ts`), and Seeded Event Deck (`eventDeck.ts`).
- **Stage 1 Addons (`src/shared/stage1.ts`, `tests/stage1.test.ts`, `INDEX.md`, `Development Plan.md`)**:
  - Implemented 9 Stage 1 addons across 6 DLC packs (`heartland.estates`, `heartland.harvest_festival`, `tidebound.ships`, `tidebound.bridges`, `bulwark.walls`, `ledger.coins`, `wayfarers.outposts`, `crimson.raiders`, `whispers.pacts`, `wildlands.seasons`).

## 2026-10-27 16:12:00 ICT (UTC+7) (Pass 37: Fix map radius to 5 for non-standard presets and scenarios & sync Map radius (1-50) input)
### Changed
- **Map presets & quick starts radius (`src/server/lobby.ts`)**: `applyMapStart(room, id)` now sets `room.settings.boardRadius = 5` for every preset apart from `'standard'` (which sets `room.settings.boardRadius = 2`).
- **Scenario presets radius (`src/server/mapmenu.ts`)**: Updated all non-standard scenarios in `SCENARIO_PRESETS` (`islandHoppers`, `siegeOfCatan`, `merchantRepublic`, `realmOfWhispers`, `ageOfWonders`, `wildFrontier`, `kitchenSink`) to `boardRadius: 5` while keeping `standardCatan` at `boardRadius: 2`.
- **Map radius `(1-50)` input sync (`src/client/actions.ts`)**: `applyPreset` and `applyScenario` clear any pending wheel settings push timer and immediately set `#setRadius` (`Map radius (1-50)`) to `5` (or `2` for `standard` / `standardCatan`), in addition to server state broadcast sync in `renderAll()`.
- **Tests (`tests/mapsettings.test.ts`)**: Updated `applyMapStart` unit tests to assert `boardRadius === 5` (91 hexes) on non-standard presets and `boardRadius === 2` (19 hexes) on `standard`.

## 2026-10-27 13:22:00 ICT (UTC+7) (Pass 36: Zane's Stage 0 Tasks — Rounds 1–9: `computeVP` audit, `pieceCost(..., reg)` wiring, `dlc`/`addons` settings block, S0.12 Setup UI rework, S0.13 Overlay & popup kit, S0.14 Bot goal registry, S0.15 Persistence, S0.16 Sim matrix)
### Added & Changed
- **Round 1 — `computeVP` audit -> `publicVP` / `score`** (`src/packs/base/actions/robber.ts`, `src/server/view.ts`, `src/server/bots/trainingLog.ts`, `src/server/bots/brain.ts`):
  - Replaced `computeVP(g, reg, b, false)` in `robber.ts` victim ordering with `publicVP(g, reg, b)`.
  - Replaced `computeVP` in `view.ts` and `trainingLog.ts` with `score(g, reg, p, true)` (for self/revealed/final score) and `publicVP(g, reg, p)` (for hidden opponents). Removed unused `computeVP` import from `brain.ts`.
- **Round 2 — Pass `reg` to `pieceCost` in bots and client** (`src/server/bots/brain.ts`, `src/server/view.ts`, `src/client/types.ts`, `src/client/render/hand.ts`, `src/client/render/board.ts`):
  - `brain.ts` (`planList` and `mainPhase` road affordability) now calls `pieceCost(g, p, def, reg)` so DLC/addon `COST_MODS` apply to bot planning and building.
  - `view.ts` computes per-player `pieceCosts` using `pieceCost(g, p, def, reg)` and sends them in `PlayerView`. Client `hand.ts` and `board.ts` use `getClientPieceCost` / `canClientAffordPiece` so custom cost modifiers and 2× over-limit pricing match the server.
- **Round 3 — `dlc` / `addons` settings block & dynamic registry** (`src/server/types.ts`, `src/server/runtime.ts`, `src/server/lobby.ts`, `src/server/presets.ts`, `src/server/game.ts`, `src/server/bots/scheduler.ts`, `src/server/bots/sim.ts`):
  - Added `dlc: Record<string, boolean>`, `addons: Record<string, boolean>`, `eventsOn: boolean`, and `fateTokens: number` to `Settings`, `defaultSettings()`, `rulesFromSettings()`, `mergeSettingsDetailed()`, and custom preset save/load (`presets.ts`).
  - Added `gameRegistry(rules)` in `runtime.ts` (builds an addon-enabled registry via `registryFor(allPacks, rules)` when any DLC/addon is enabled, or returns the shared base registry when none are set so `tests/golden.test.ts` hashes remain identical). Wired `gameRegistry` through `game.ts`, `view.ts`, `scheduler.ts`, and `sim.ts`.
- **Round 4 — S0.12 Setup page UI rework** (`src/server/mapmenu.ts`, `src/server/socket.ts`, `src/client/types.ts`, `public/index.html`, `src/client/render/setup.ts`, `src/client/render/index.ts`, `src/client/actions.ts`, `src/client/main.ts`, `src/client/styles.css`):
  - Added `SCENARIO_PRESETS` (`standard`, `islands`, `gold_rush`, `fog_islands`, `continent_river`, `high_vp`), `dlcs`, and `addons` to `mapOptionsView()` and socket action `applyScenario`.
  - Added Scenario Presets row (`#scenarioRow`), live "Active Configuration" summary pill strip (`#setupActiveSummary`), DLC & Addon cards with `Bot-tested` / `Bots untested` badges and missing-dependency one-click prompt (`#setupDlcSection`), plus Events deck (`#setEventsOn`) and Starting Fate tokens (`#setFateTokens`) controls on the World Setup page.
- **Round 5 — S0.13 Overlay and popup kit (Service 11)** (`src/client/render/overlay.ts`, `src/client/render/board.ts`, `src/client/render/index.ts`, `src/client/main.ts`, `public/index.html`, `src/client/styles.css`):
  - Created `src/client/render/overlay.ts` providing 6 colorblind-safe SVG pattern fills (`diagonal-hatch`, `cross-hatch`, `dots`, `waves`, `chevrons`, `grid`) with shape + icon + label (`setHexOverlay`, `clearHexOverlays`, `renderBoardOverlays`), a stacked timer-bar popup queue (`showTimerPopup`, `dismissTimerPopup`, `renderTimerPopups`), dramatic Event Title cards (`showEventTitleCard`), and Round-End Recap cards (`showRoundRecapCard`, `dismissRoundRecapCard`).
- **Round 6 — S0.15 Persistence (Service 19)** (`src/server/persistence.ts`, `data/bots/_schema.md`, `src/server/main.ts`, `tests/persistence.test.ts`):
  - Documented Render free-tier host persistence architecture in `data/bots/_schema.md`.
  - Implemented `loadBotMemory`, `saveBotMemory`, `appendBotMemoryEvent`, `loadPlayerProfile`, `savePlayerProfile`, `migrateBotMemory` (`CURRENT_SCHEMA_VERSION = 2`), and portable `CTMEM1.<base64url>` export/import (`exportMemoryCode`, `importMemoryCode`, `GET /api/memory/export`, `POST /api/memory/import`).
  - Enforced strict caps (`MAX_MEMORY_EVENTS = 50`, `MAX_RELATIONSHIPS = 24`, `MAX_FILE_BYTES = 16384`) and public-only event validation (`sanitizePublicMemoryEvent` rejects `resources`, `devCards`, `newDevCards`, `hand`, `secret`, and non-public event types).
- **Round 7 & Round 8 — S0.14 Bot goal registry (Service 18)** (`src/shared/botGoals.ts`, `src/shared/index.ts`, `src/server/bots/brain.ts`, `tests/botgoals.test.ts`):
  - Added `BOT_GOALS` keyed registry table, `BotGoalDef`, `BotGoalItem`, and tier-gated evaluators (`evaluateBotGoals`, `botGoalVertexDelta`, `botGoalEdgeDelta`, `botGoalActionScore`, `botGoalThreatDelta` where `main` reads `generic`, `secondary` reads `generic` + `basic`, and `overload` reads all including `advanced`).
  - Integrated `BOT_GOALS` into `brain.ts` (`vertexScore`, `roadScore`, `robberScore`, `planList` missing-card pipeline for bank trades / player trades / discard / gold pick / dev cards, and `mainPhase` custom actions).
- **Round 9 — S0.16 Sim matrix (Service 20)** (`src/server/bots/sim.ts`, `tests/simmatrix.test.ts`):
  - Added `runSimMatrix(opts)` running scenarios × DLC/addon combinations × bot tier lineups across seeds, verifying invariants and action legality, and reporting per-cell stats plus `botTestedByCombo`.

## 2026-10-27 (Pass 35: Stage 0 start: DLC/addon layer, keyed registries, round clock, golden baseline test)
### Added
- **DLC and addon layer** (`src/shared/addons.ts`, new; S0.1, service 1): `AddonDef` (id, deps, links, rules, `register`), `AddonInfo`/`DlcInfo` for the lobby, `LINK_KINDS`, the 20 `GENERAL_SERVICE_IDS`, `resolveAddons(packs, rules)` (DLC master switch `rules.dlc[packId]`, per-addon `rules.addons[id] === false`, blocked-by-dependency list), `addonOn(reg, id)`, `registryFor(packs, rules, overrides)`, and `auditAddons(packs)` (Rule of Two: 2+ distinct links, one to a General service; no unknown targets or kinds, no self links; DLC must list `base`; cross-DLC dependency needs `allowCrossDlcDep`).
- **Keyed registries**: `api.define(kind, def)` and `defsOf(reg, kind)`. Kinds are separate namespaces, duplicate ids throw unless `replace: true`. New kinds (events, techs, contract conditions, stats...) need no edit to `registry.ts`.
- **Golden baseline** (`tests/golden.test.ts`, S0.0): five seeded bot-vs-bot games hashed (final state, log, turns, steps) against `tests/golden.snapshot.json`. First run records the snapshot; `UPDATE_GOLDEN=1` re-records on purpose.
- `tests/addons.test.ts`: manifest, enabled sets, master switch, bad-manifest errors, keyed registries, "DLC off changes nothing", and the audit.
### Changed
- `src/shared/registry.ts`: `Pack.addons`; `Registry.addons`, `dlcs`, `enabled`, `defs`; `createRegistry(packs, overrides, enabled)` takes a set of addon ids or `'all'` (default none, so plain calls build the base game). Addon content, hooks and rules register only for enabled addons. Load-time errors for wrong id prefix, duplicate addon, dependency not declared earlier, enabled addon whose dependency is off, unknown id in the enabled set.
- `src/shared/index.ts` exports `addons`.
- `INDEX.md` lists the new source and test files and `Development Plan.md`.
### Added (S0.2 round clock, service 2)
- `g.round` (0 in setup; round 1 starts with the first normal turn; a new round each time seat 0 comes up). Robber, discard and pick sub-phases never start a round.
- Hooks `onRoundStart` (g.round already the new round) and `onRoundEnd` (g.round still the finished round, fires when the last seat ends its turn, not after a winning turn), events `roundStarted` / `roundEnded`, helper `everyNRounds(n, fn, offset)`, `endRoundIfLastSeat(ctx)` called by `end_turn`. Code: `types.ts`, `registry.ts`, `engine.ts` (`round: 0`), `state.ts` (`startTurn`), `packs/base/actions/endTurn.ts`.
- `tests/rounds.test.ts`. `tests/golden.test.ts` leaves `round` and `ext.core` out of the state hash so additive services do not break the baseline.
### Added (S0.3 score and publicVP, service 3)
- `score(g, reg, p, includeHidden = true)` in `state.ts`: ranks by `rules.scoreMode` (`'vp'` default = `computeVP`; `'produced'` = `stats.resProduced`, for Sandbox). `publicVP(g, reg, p)` = victory points without hidden dev cards.
- Routed through them: `checkWinner` (`engine.ts`), bot decision context `makeDc` (`bots/brain.ts`: own hidden VP counted, opponents public only), dialogue `publicStanding` (`bots/dialogue/context.ts`). Behavior in `vp` mode is unchanged.
- `tests/score.test.ts`.
### Added (S0.4 piece cost and limit service, service 4)
- `src/shared/pricing.ts` (new): `placedCount`, `aboveBaseLimit`, `doubledCost`, `priceOf(g, reg, p, def)`, `CostModifier`, `COST_MODS`. Rule: double cost once a player has `PieceDef.baseLimit` of that piece on the board, then every registered cost modifier runs in order. DLCs register one with `api.define(COST_MODS, { id, apply })`; a disabled addon registers nothing.
- `PieceDef.baseLimit` (road 15, settlement 5, city 4) replaces the hardcoded lookup. `BASE_PIECE_LIMITS` moved to `base/constants.ts` and is still re-exported from `base/building.ts`.
- `base/building.ts`: `pieceCost(g, p, def, reg?)` (with `reg` it applies modifiers), `isAboveBaseLimit` kept as a wrapper. `validateBuild`, `placePiece` and the `build` action's `legal` pass the registry. The `vpToWin` supply scaling in `createGame` is untouched.
- `tests/pricing.test.ts`.
### Verified
- `npm run typecheck`, `addons.test.ts`, `rounds.test.ts`, `golden.test.ts` and the full `npm test` pass (user-run, 2026-10-27). Golden snapshot recorded in `tests/golden.snapshot.json`.

## 2026-10-27 11:42:21 ICT (UTC+7) (Pass 34: Spectate Game Mode when joining or hosting)
### Added
- **Spectate Game Mode (`spectateRoom`, `toggleSpectate`, `room.spectators`)**:
  - **Landing screen & Auto-Spectate on Join** (`public/index.html`, `src/client/actions.ts`, `src/server/socket.ts`): Added a dedicated **Spectate game** button on `#authScreen`. Clicking **Join game** when a game has already started or all player seats are full now automatically joins the user as a **Spectator** instead of blocking them with `"Game already started!"` or `"Room is full!"`.
  - **Host & Player Spectate Toggle** (`public/index.html`, `src/server/socket.ts`, `src/client/render/setup.ts`, `src/client/render/hand.ts`, `src/client/render/index.ts`): Added **Spectate / Join seat** buttons on the **World Setup** screen (`#btnSetupSpectate`), **Lobby Map Painter dock** (`#btnDockSpectate`), **Bottom Hand Bar** (`#myHandPanel`), and **In-Game Menu** (`#btnMenuSpectate`). When the host switches to spectator, they leave `room.lobbyPlayers` and move to `room.spectators` while keeping `room.hostId` so they can configure rules, paint the map, add up to 8 bots, and start a 100% bot match. Seated human players in an active match can also switch to spectator mid-game, handing their seat to a takeover bot.
  - **Live Spectator Hand Inspector & Bot Keep-Alive** (`src/server/rooms.ts`, `src/server/view.ts`, `src/client/render/hand.ts`, `src/client/render/sidebar.ts`, `src/client/render/trade.ts`, `src/client/styles.css`): Included `room.spectators` in `humanIds(room)` so `broadcastRoom` streams live state updates and keeps bot-only games running while spectators are connected. Spectators receive full resource and development card visibility (`reveal = self || over || isSpectator`) and can inspect any player's hand and piece counts by clicking `Turn` (auto-follow active player), player chips in `#myHandPanel`, or any player row in `#playersStack`.
- **Tests** (`tests/setuppage.test.ts`): Added unit test covering a host spectating a bot-only game, `humanIds(room)` spectator inclusion, and full resource card visibility in `makeStateBuilder`.

## 2026-10-26 (Pass 33: world setup page between the name page and the board)
### Added
- **Setup page** (`public/index.html` `#setupScreen`, `src/client/render/setup.ts`, `styles.css`): host only. Three boxes: bots and bot chat (with a player strip: avatar click, bot tier tag click), a tiles-only map preview, and map presets, map menu (seed) and all rules (game, timers, special tiles, bank and dev cards, pieces). Buttons: Continue to board, Start now. Controls keep their ids and handlers, so settings sync, presets and the seed work unchanged.
- **Waiting screen**: everyone but the host sees "Host is creating world" over the board while the page is open. A new player who tries to join (or rejoin without a seat) gets the same message as a toast and stays on the name page. Players who already have a seat can still reclaim it.
- Server: `room.setup` (true on create), socket `setSetup`, `setup` in the client state. Rematch leaves it off, so Play again still goes straight to the board; the board dock has a **World setup** button to go back.
### Changed
- The board dock is the map painter only (plus World setup and Start). The Rules and cards tab and the bot controls moved to the setup page. Mouse-wheel editing of number fields and sliders works on the setup page too.
- Tests: `tests/setuppage.test.ts`.
### Not verified
- Written without a shell: run typecheck and test, then check: create game (setup page), add bots, change a preset and the seed (preview updates), Continue to board, World setup (back), second browser join during setup (toast) and after Continue (joins).

## 2026-10-26 (Pass 32: fixed-size player list that follows the turn, hexagon-only port layout)
### Changed
- **Sidebar** (`src/client/render/sidebar.ts`, `src/client/styles.css`): log, chat and bank keep a fixed size for 1 to 8 players. The player list always shows 4 rows (`--p-row-h`) with a thin scrollbar on its right edge when there are more. On every turn change the current player's row scrolls into view by the smallest move (player 5 = one row down, back to player 1 = up to the top). The list keeps its scroll position across re-renders, wheel/touch/drag stops the auto-scroll, and the robber victim row is scrolled into view when the steal choice opens.
- **Animations keep working with a scrolled list**: `visibleRect()` clamps a player row that is scrolled out of view to the nearest edge of the visible list, so production, steal, trade and dev-card flights land on the list edge instead of over the chat or off screen (used in `triggerCardTransferAnimations` and `triggerFlyingResourceAnimations`). Rolled-tile dim, in-flight card counts, rob highlight, turn marker, tier tags and avatar picking are unchanged.
- **Ports** (`src/shared/topology.ts`, `src/shared/mapgen.ts`): the real-board layout (`portLayout: 'hexagon'`: a harbor on every second sea tile of the frame, on the edge away from the corner tile, 3 x (R + 1) ports) applies only to the plain full hexagon. Every other shape keeps the general coast placement. `tests/ports.test.ts` checks gaps 2-2-3 on the standard board, corner harbors with gaps of 2 on both sides, and 3 (R + 1) ports on radius 3 and 4.
### Not verified
- Written without a shell: run `npm run typecheck` and `npm test`, restart `npm run dev`, hard refresh, then roll a few seeds on radius 2, 3 and 4 and compare with the reference images.

## 2026-10-26 10:14:20 ICT (UTC+7) (Pass 30: Road zoom-out scaling, session reconnect, bot setup optimization, AI training data log, VP-scaled pieces with 2× cost above base limit)
### Added
- **Road Zoom-Out Scaling** (`src/client/render/board.ts`, `src/client/styles.css`) — `2026-10-26 10:14:20 ICT`:
  - Added dynamic `--road-scale` CSS custom property calculation in `updateCameraViewBox()` (`ROAD_BASE_SCALE = 1.15`, up to `2.45×` when zoomed out or on large maps) alongside `--building-scale`.
  - Placed road rims (`.road-rim-line`), road bodies (`.road-body-line`), hover hit targets (`.road-hit`), road network glow halos (`.road-glow-net line`, `.road-glow-best line`), and buildable road spots (`.road-spot-line`, `.road-spot-dot`) all scale smoothly when zooming out without rebuilding SVG DOM.
- **Disconnect / Logout Reconnect System** (`src/server/types.ts`, `src/server/rooms.ts`, `src/server/socket.ts`, `src/client/actions.ts`, `src/client/main.ts`, `public/index.html`) — `2026-10-26 10:14:20 ICT`:
  - Added persistent `catan_client_id`, `catan_player_name`, and `catan_last_room` in `localStorage`.
  - Added `rebindPlayerId()` in `src/server/rooms.ts` and `tryReclaimSeat()` / `reconnectRoom` in `src/server/socket.ts` so a player who refreshes, closes the tab, or temporarily disconnects reclaims their seat (converting a takeover bot back into the human player and restoring their name, avatar, pieces, trades, and host status).
  - Rooms with all humans temporarily disconnected stay alive for a 10-minute grace period (`ROOM_DISCONNECT_TTL_MS`) instead of being deleted immediately, and `#authScreen` shows a **Rejoin game** button plus automatic socket reconnect on reload.
- **Optimized Bot Initial Placement Strategy** (`src/server/bots/mapProfile.ts`, `src/server/bots/brain.ts`) — `2026-10-26 10:14:20 ICT`:
  - Added board-wide resource pip scarcity analysis (`resourcePips`, `scarcityBonus`) to `MapProfile`.
  - Upgraded `vertexScore` with resource scarcity weighting, 3-hex intersection volume and number-diversity bonuses, wheat anchor evaluation, 4/5-resource coverage bonuses, and 2nd-settlement starting hand tempo bonuses (immediate Turn 1 road from wood+brick, immediate Dev card from wheat+ore+sheep, or 3/4 of a settlement).
  - Upgraded `planOpening` with snake-draft turn-order lookahead (`picksBetween` opponent picks before the 2nd settlement) and enabled it for `setupPlanning >= 1` (`Secondary` and `Overload`).
  - Upgraded `roadScore` during `setup_road` so setup roads evaluate 2-step and 3-step open settlement vertices reachable from the road's outer endpoint (`step1`), coastal ports, and penalize dead-end roads.
- **AI Bot Training Data Logger & Exporter** (`src/server/bots/trainingLog.ts`, `src/server/game.ts`, `src/server/bots/sim.ts`, `src/server/main.ts`, `src/client/actions.ts`, `public/index.html`) — `2026-10-26 10:14:20 ICT`:
  - Records every human and bot decision step with state features (`vp`, `pipYield`, `portAccess`, `resources`, `resourceTotal`, `devCardCount`, `knightsPlayed`, `longestRoadLength`, `piecesLeft`, `legalActionCount`), chosen action, events, and end-of-game outcome labels (`finalVp`, `wonGame`, RL `reward`).
  - Persists completed game trajectories to `data/bot_training_logs.jsonl` and exposes `GET /api/bot-training-logs` (`.json` or `.jsonl`), `POST /api/bot-training-sim` (headless self-play batch generator), and **AI Log** download buttons in the in-game menu and Victory screen.
- **Scale Settlement, City & Road Limits with VP Setting (2× Cost Above Base Limit)** (`src/packs/base/building.ts`, `src/packs/base/actions/build.ts`, `src/shared/engine.ts`, `src/server/runtime.ts`, `src/server/lobby.ts`, `src/server/bots/brain.ts`, `src/client/render/board.ts`, `src/client/render/hand.ts`, `public/index.html`) — `2026-10-26 10:14:20 ICT`:
  - `maxRoads`, `maxSettlements`, and `maxCities` scale proportionally with `vpToWin` when `vpToWin > 10` (`ceil(base * vpToWin / 10)`).
  - Building any piece above its base limit (`15` roads, `5` settlements, `4` cities on the board) costs **double resources** (`2×`), enforced in the game engine (`pieceCost`), bot planner (`brain.ts`), client board affordability checks, and action-bar hover recipe strips (which display `2×` and the doubled card recipe).

## 2026-10-26 (Pass 29: server-side "no one has X" check, discard clock keeps turn time, port rework; untested)
### Fixed
- **"No one has any X to trade" still fired after Pass 27** (`tradeOffers.ts`, `drawer.ts`): the client guess from `bankSupply - bank - my hand` is gone. `propose_trade` now checks the real hands (human proposers) and answers through the error toast only when nobody else holds the card. If it still shows, hard refresh and restart `npm run dev` (a stale bundle or server gives the same symptom).
### Changed
- **Discard clock returns the turn's time** (`turnClock.ts`): the time left is parked in `room.savedTurnClock` and restored (at least 3 s) when the turn owner is on the clock again. Auto-discard unchanged.
- **Port rework, `GEN_VERSION` now 3** (`topology.ts`, `registry.ts`, `mapgen.ts`, `maprecipe.ts`):
  - Cap per landmass: `portCap(size)` = 0 under 3 tiles, 1 under 6, else `round(size x 0.45)`. Standard board unchanged at 9; bigger hexagons stay near 1 port per 3.3 coast edges.
  - Ports past the ninth keep the 4 generic : 5 resource mix (pool redealt as fresh shuffles).
  - New `TileDef.noPort` for modded terrain (no port on its coast; a non-sea, non-land tile does not count as sea). No shipped tile uses it yet.
### Added
- Tests: server refuses a request nobody holds (`rules.test.ts`); port caps, port mix, `noPort` (`mapshapes.test.ts`). `GEN_VERSION` test in `mapmix.test.ts` now expects 3.
### Checked, not changed
- Invalid bank trade prompt (Pass 25) already names a better port rate and "Fix amounts" rounds the give pile.

## 2026-10-26 (Pass 28: bank / dev deck auto-scale tests; not run)
- `rules.test.ts`: standard board stays 19 bank and 14/5/2/2/2; 5-6 player floor holds; a 61-tile board grows bank and deck; host-changed numbers are left alone.

## 2026-10-26 (Pass 27: "No one has X" used the lobby bank setting)
- Client used `bankResourcePerType` (19) instead of the real, possibly scaled bank, so trades were refused on Scaled Games. Server now sends `bankSupply`. Replaced by the Pass 29 server check.

## 2026-10-26 (Pass 26: shape add-ons no longer drop to the hexagon; tests pass)
### Fixed
- **River / lake / islets falling back to the hexagon** (`mapshape.ts`, `shapes.ts`):
  - The exact land count check after every carve or scatter rejected attempts that cleanup never repaired; it now applies to the base shape only.
  - Carves run only in the biggest landmass (`biggestLand`), and islands/continents reserve room for it (`bigNeed`) so no island drops under its minimum.
  - A river starts only on a shore tile with a way inland. Islets place what fits instead of failing.
  - River tiles now come out of the land budget, so continents + river fits its water gap.
### Added
- `shape-partial` warning when an op did only part of its work ("river: 2 of 6 tiles fit"); `runShape` looks up to 10 attempts for a clean one.
- "shape not applied" tooltip names the two most common failure reasons.
- Tests in `mapshapes.test.ts`: fallback rate over base x add-on x radius, default radius 2, river on islands/continents, `shape-partial`.

## 2026-10-26 (Pass 25: bank trade advice, board-scaled bank and dev deck, turn clock bar, human discard clock; untested)
### Added
- **Bank trade ratio advice + "Fix amounts"** (`drawer.ts`): explains an illegal give/get using the player's own rate (4:1, 3:1, 2:1), names a better port rate, and rounds the give piles.
- **Turn clock countdown bar** (`turnclock.ts`): draining bar in the turn pill, red in the last 10 s.
- **Shape fallback tag** in the map report when the generator falls back to the hexagon.
### Changed
- **Bank and dev deck scale with the board** (`runtime.ts`, `game.ts`): only when the host left the standard numbers. Bank = max(table floor, 0.8 x land tiles), dev deck = max(table floor, 1.2 x land tiles). The 19-tile board is unchanged.
- **Discard clock for humans** (`turnClock.ts`, `scheduler.ts`): a human who owes a discard after a 7 is on the clock even on a bot's turn; on expiry they are auto-discarded.

## 2026-10-26 (Pass 24: seed toggle, bigger pieces, scrolling lobby dock, more presets)
- Seed hide/show toggle (stored in `localStorage`).
- 11 more built-in preset chips: Beginner, Realistic continent, Balanced continent, Island hopper, Ring lagoon, Lakeland, Chaos; Mountain gold, Gold islands; Fog ring, Fog continents.
- Settlements and cities bigger (`BUILDING_BASE_SCALE` 1.5, cap 2.8).
- Lobby dock scrolls instead of growing, so chat and log stay visible.
- Fixed a leftover `syncBoardBuildPopup()` call after Pass 23.

## 2026-10-26 (Passes 19 to 23: build popups tried, then reverted)
- Added (Pass 19): road length tooltip on hover, hover recipe strips on the action bar buttons (Dev, Road, Settle, City).
- Added then removed (Passes 19, 20, 23): on-board click-to-select popups for roads, settlements and cities. Clicking a build spot builds at once again. Hover recipes and the road tooltip stay.
- Pass 21: settlements and cities scale with zoom and board size.
- Pass 22:
  - **Performance**: board split into persistent SVG layers with dirty-key caching, merged water and sand paths, no SVG blur filters, rAF-coalesced pan/zoom, cached road analysis.
  - **Bot pacing**: bots wait for roll and card animations (`animatingUntil`, `animDelayMs`) before acting.
  - Mouse wheel changes numbers in the Rules and Cards menu (Shift = 5x step).

## 2026-10-25 (Passes 17 and 18)
- Pass 18: cards are held out of the hand and sidebar counts until their flying animation lands.
- Pass 17: "your turn" chime; unified pictogram icons on the victory screen; nickname required before create or join (no default); game speed locked at 0.5x and the speed UI removed; victory screen and confetti made lighter (no backdrop blur, paused board animations, memoized render).

## 2026-10-25 (Passes 10 to 16: Map Generation M1 to M6)
Design in `Map Generation Design.md`.
- **M1 foundations** (P10): seeded noise, `MapRecipe` and share code (`hx1;g=..;r=..;picks=..;seed=..`), per-stage RNG streams, `validateBoard` -> `MapReport`, `generateMap` for the classic pipeline.
- **M2 registry and settings** (P11): pack API for shapes, terrain, numbers, perks and quick starts; settings `mapSeed`, `mapSeedLocked`, `mapPicks`, `mapParams`; a map-affecting change rebuilds from the recipe and keeps the seed; `mapMeta` goes to the client.
- **M3 shapes and ports** (P12): shape stage decides land (`continent`, `ring`, `islands`, `archipelago`, `continents`; carve ops `lake`, `river`; scatter `satellites`; tweak `ragged`); ports per landmass on open-sea coast; falls back to the hexagon, never throws.
- **M4 terrain and numbers** (P13): `spread`, `clustered`, `realistic` (habitat per tile) terrain; `balanced` and `feast_famine` numbers; flags `hotTouch` and `equalTouch`.
- **M5 validation** (P14): board loop retries stages 5 to 8 (12 attempts up to radius 20) and keeps the best, `degraded` when none pass; new `not-connected` and `one-resource-island` checks; bot sims on every shape; budget test.
- **M6 lobby map menu** (P15): menu drawn from `mapOptions` (a pack's new option appears with no client change); seed line with copy, edit, lock and save; report tags; presets v2 keep the recipe ("same style, new seed"). A painted map needs a second click before a reroll replaces it.
- **Finishing pass** (P16): `GEN_VERSION` 2; ring band at least 2 tiles thick from radius 4 (`thin-neck` warning); `island_mix` perk ("Mixed islands"); per-param sliders in the menu; budget limits tightened (median under 60 ms up to radius 8, under 300 ms at radius 20).
- Not checked in a browser: the map menu and its sliders (open/close, picks, seed row, presets, phone layout). The gallery script `tools/mapgallery.ts` is still to do and is the way to tune the noise numbers.

## 2026-10-25 (Pass 9: victory screen and confetti)
- 6-tab post-game screen: Overview, Dice Stats, Res Card Stats, Dev Card Stats, Activity Stats, Resource Stats (leader highlights, table totals). Stats come from the `recordActionStats` hook, with no RNG use.
- Confetti and fanfare on game over (respects reduced motion).

## 2026-10-25 (Pass 8: 8 players, number tokens, lobby overlap)
- 8-player lobbies (8th color pink). Bank and dev deck grow at game start for 5-8 players if left at standard. Start check for 5+ players needs `players * 8` vertices.
- Number pool follows the real 18 tokens (the standard board no longer gets a 19th); bigger boards use the real shares tilted slightly; no touching 6/8.
- Game menu and lobby dock never open together.

## 2026-10-25 (Pass 7: bot dialogue)
- New dialogue engine (`bots/dialogue/`): 40 events, three voices, data-driven lines, personality overlays, repeat memory, rate limits.
- Leak rules: public information only; steal, discard and dev-card lines never name a resource.
- Host setting Bot chat: Off / Quiet / Normal / Chatty. Canned replies to human chat.
- Not done: "turn timer is low" line; callbacks to earlier events.

## 2026-10-25 (Pass 6: bot tiers)
- Tiers **Main / Secondary / Overload**, chosen per bot (a bot replacing a disconnected human is Secondary). Profiles in `bots/tiers.ts`, map profile in `bots/mapProfile.ts`, `runLadder` in the sim.
- Fixed: offering a trade for a resource nobody holds (client check); end-game dice chart bars squashed to one height.
- Not started: bot addon system (`Bot AI Design.md` sections 4 to 6). Tier numbers are starting guesses.

## 2026-10-25 (Pass 5)
- Turn timer (turn time, per-action increment, trade offer time; humans only) with time shown in the turn pill.
- Custom presets: save, apply, delete (host `localStorage`, max 30).
- Orange tint on robber targets; slate cast on hover. Road hover is a flat dark halo.
- Counter offer editor follows Colonist.
- Fixed: trade time bar vanished on clock skew; the server now sends time left.

## 2026-10-24 (Passes 1 to 4)
- Counter trade, up to 5 stacked offers with timers, pictogram avatars, lobby cursors and Shift laser trail.
- Roads merge into one line with a longest-stretch tooltip; Longest Road / Largest Army banner; bot chat lines; drag-to-pan.
- Single "Join game" button, own VP shown as `8(9)`, glowing build spots, rolled tiles darken, sand under land tiles, thicker port piers.
- No gold in normal games; no number dots; 3:1 port readable in dark mode; host-only game speed.

## 2026-10-24 (Step 2: engine and base game)
- `src/shared/` (RNG, registry, topology, mapgen, dispatch, `legalActions`), packs `base`, `gold`, `fog`, server adapter and bots. `Design UI Philosophy.md` and the design-token CSS layer.

## 2026-10-23 (Step 1: infrastructure)
- `server.js` and `index.html` split into TypeScript (`src/server/`, `src/client/`), originals in `legacy/`; esbuild to `dist/`; scripts, Dockerfile, `render.yaml`, README.

## Step 0
- Skeleton deploy: old version tagged, Render host, `/health`, tested on phones.

