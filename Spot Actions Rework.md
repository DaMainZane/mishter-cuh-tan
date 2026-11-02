# Spot Actions Rework

Written 2026-11-02. Goal: an action that acts on something already on the board (a tile, a port, a vertex) gets its highlighted spots, button, hint, price and click path from the **same generic system pieces use**, so a new tile or port action later needs only a `visual` on its `ActionDef`. Concept background: `ARCHITECTURE.md` section 9. Contract: `Visual Manifest Design.md`.

Status: **Step 1 (feed the sea) written 2026-11-02, not run (no shell).** Steps 2 to 5 not started.

## 1. What I found (this changes the first sketch)

The first sketch proposed a new `target` field on `ActionDef`. **It is not needed.** R8.3 to R8.7 already built it:

- `ActionDef.visual` with `slot` (`vertex`, `edge`, `edge:ocean`, `hex`), a button, three hint texts and `spotKey` (the payload field that carries the spot), plus `ActionDef.available(g, pid)` and `ActionDef.price(g, reg, pid)`.
- `base.pieces_view` (`packs/base/piecesView.ts`) sends every player `pieces[id] = { left, cost, spots }`. For an action, `spots` = the payloads of `legal()` that pass `validate`, mapped through `spotKey`, only on your own main-phase turn.
- `client/pieceui.ts` + `pieceModel.ts` draw the button (in `#pieceButtons`), the spot layer (`#boardPieceSpotsLayer`), the recipe popup and the hint toast, and `clickSpot` emits `act` with `{ [spotKey]: loc }` for an action.
- The `hex` slot exists (it was added for feed). A **port is a vertex** here (`vertex.port`), so a harbor upgrade is slot `vertex`; there is no separate "port" kind.

So the work is not "build the system". It is **R8.8 for the action targets**: give each action a `visual`, then delete its hand-written copy. Nothing ships a `visual` today, so none of this path is live yet except in tests (`tests/piecesView.test.ts` attaches fake visuals to prove it).

## 2. The five targets and their hand-written glue

| Action | Target | Slot | Hand-written today (to delete) |
|---|---|---|---|
| `feed_sea` | sea tile under your net, not full | `hex` | `btnFeedSea` + `recipePopupFeed` (`public/index.html`); `feedEnabled` block (`render/index.ts`); `mode === 'feed'` toast and `canClientAffordFeed` import (`actions.ts`); `feedSpotSet`, the `fish-spot` markup, the mode skip in the vertex loop, `canClientAffordFeed`, `clickFeedSpot` (`render/board.ts`); `feed` in `RecipeKey`, `BUILD_RECIPES`, the cost switch and popup map (`render/hand.ts`); `clickFeedSpot` binding (`main.ts`, to confirm) |
| `place_net` | free sea tile next to your coast road | `hex` | same shape: `btnBuildNet`, `badgeNetCnt`, `recipePopupNet`; net blocks in `render/index.ts` and `actions.ts`; `.net-spot` and `clickNetSpot` in `board.ts`; `net` in `hand.ts`. The placed net itself (`netTileMarkup`, `boardNetsLayer`) stays: it is a board layer, not a spot |
| `upgrade_harbor` | your city on a port, below harbor level | `vertex` | `btnBuildHarbor`, `badgeHarborCnt`, `recipePopupHarbor`; `harbor` blocks in `render/index.ts` and `actions.ts`; harbor ring and `canClientAffordHarbor`, `clickHarborSpot` in `board.ts`; `harbor` in `hand.ts` |
| `upgrade_port` (Harbor charters, 3:1 to 2:1) | your city (or settlement with Fishing nets) on a generic port | `vertex` | `portRaiseSpots` (`pieceModel.ts`), the ring and `upgradePortClick` (`board.ts`), the harbor-mode toast (`actions.ts`); it shares the **Harbor** button with `upgrade_harbor` today |
| `convert_tile` (Ground work) | a land tile touching your settlement or city, **plus a chosen resource** | `hex` | not read yet: a control in `render/techpanel.ts` (`techActions`). Read before step 4 |

The unread parts (net, harbor and ground work client glue) are named from `ROUTER.md`, `change log.md` and `actions.ts` / `render/index.ts`, not from the code. Each step starts by reading its files and correcting this table.

## 3. Gaps the generic path does not cover yet

1. **A second input after the spot (ground work).** `placeAt` sends only `{ [spotKey]: loc }`, but `convert_tile` needs `{ hexId, resource }`. Proposed, fully generic: an optional `visual.choiceKey` (`'resource'`) and an optional `pieces[id].choices` (spot id to the list of values), built on the server from the same `legal()` payloads. The client then shows a small chooser (one button per value) when a spot has 2 or more choices and sends the pick; one choice sends at once. No per-action client code. **Decision for you at step 4.**
2. **A badge for an action.** `left` is null for an action, so no supply badge. Nets (supply) and harbors ("1 left") had one. Proposed: optional `ActionDef.left?(g, pid)` that fills `pieces[id].left`. Small. **Decision at step 2.**
3. **Two actions on one vertex (Harbor button).** `upgrade_port` and `upgrade_harbor` can both be legal on a 3:1 port city. The manifest has a spot chooser for this (`registerSpotChooser(group, fn)`, `entriesAtSpot`) but no chooser is registered. Needs one tiny client chooser, or a rule (harbor wins, or the raise is first). **Decision at step 3.**
4. **Look of the spot.** The generic hex spot is a pulsing circle. Feed used to draw a ring with a fish; the preview of a fish on a tile that has no icon yet is lost in step 1 unless `visual.spot` carries a custom marker. Cosmetic.
5. The mode name changes from `feed` to `feed_sea` (a generated mode is the action id). Nothing else reads `'feed'` once the hand-written code is gone.

## 4. Steps

Each step: one action moves over, its hand-written glue is deleted in the same step, and the server's legacy view fields stay until step 5 (so parity tests keep running). No commit until step 5.

### Step 1: `feed_sea` (written 2026-11-02)
- Server: `feedSeaAction` in `packs/tidebound/fishing.ts` gets `available` (Harbor master gate, the same as `feedViewData`), `price` (`FEED_SEA_COST`) and a `visual` (`hex`, `spotKey: 'hexId'`, button Feed, inline fish icon, three hints).
- Client: delete the feed button, popup, mode, spots and click handler listed in the table above.
- Tests touched: `tests/visualManifest.test.ts` (Tidebound on now lists `feed_sea`), `tests/piecesView.test.ts` (a Tidebound game now has `pieces`), new cases in `tests/tideboundfishgrounds.test.ts` or a new `tests/spotactions.test.ts` (the shipped visual has no problems, `pieces.feed_sea.spots` equals `feedSpots`, key absent without the tech).
- Expected diffs you review (never `-u` blindly): `tests/view.snapshot.json` gains a `pieces` object with `feed_sea` for the Tidebound-on case only.
- Done when: `npm run typecheck`, `npm test` green; in a game with Harbor master, the Feed button appears once, shows the wheat price in its popup, glows your feedable sea tiles, and clicking one feeds it.

### Step 2: `place_net`
- `placeNetAction` already has `available` and `price`; add the `visual` (`hex`) and, if you agree to gap 2, `left` for the supply badge.
- Delete the net button, badge, popup, mode, `.net-spot` and `clickNetSpot`. The net layer stays.
- Tests: `tideboundnetsclient.test.ts` (client view parity), `piecesView.test.ts`.

### Step 3: `upgrade_harbor` and `upgrade_port`
- `upgrade_harbor` already has the pieces for `available` and `price` through `harborUpgradeCost`; add them to the def, add `visual` (`vertex`, `spotKey: 'vertexId'`). Give `upgrade_port` a `visual` in the same `group: 'harbor'`.
- Resolve gap 3, then delete the harbor button, badge, popup, mode, rings, `portRaiseSpots`, `upgradePortClick`, `canClientAffordHarbor` and the harbor toast.
- Tests: `tideboundharbor.test.ts`, `techroots.test.ts` (port level), `pieceModel.test.ts` (`portRaiseSpots` goes).

### Step 4: `convert_tile` (Ground work)
- Read `render/techpanel.ts` and the `techActions` view first. Build the choice mechanism (gap 1). Give `convert_tile` a `visual` (`hex`, `spotKey: 'hexId'`, `choiceKey: 'resource'`). Delete its panel control if the tile click replaces it.
- Tests: `techroots.test.ts`, `manifest` checks for `choiceKey`, `pieceModel` tests for the chooser.

### Step 5: cleanup and docs
- Delete the legacy server fields and their tests: `feedCost`, `feedSpots`, `netSpots`, `netCost`, `harborCost`, `harborSpots`, `harborsLeft`, the matching `feedViewData`, `netViewData`, `harborViewData` fields and the client `types.ts` fields. Delete `canClientAfford*` from `board.ts`, and the unused `RecipeKey` entries in `hand.ts`.
- Docs: `ROUTER.md` (Glue names, "New action" row), `RECIPES.md` recipe 2, `CLAUDE.md` (hand-written glue sentence), `EXTENSION POINTS.md`, `Visual Manifest Design.md` (what is now shipped), `change log.md`, `INDEX.md`, and `ARCHITECTURE.md` section 9 (remove the "plan" pointer).
- Regenerate nothing blindly: `view.snapshot.json` diff reviewed once more.

## 5. Rules for every step

- Tests and typecheck green, `tests/golden.snapshot.json` untouched (no rule changes here), `tests/view.snapshot.json` changed only by reviewed diffs.
- After each step: `npm run headers:write`, `npm run index`, `npm run mindmap:check`, `npm run typecheck`, `npm test`. The agent has no shell: it writes the code and the exact commands, and you paste back the output.
- A spot is only ever drawn from `pieces[id].spots`. Never add a client-side legality check back.

## 6. Risks

- `board.ts` (about 1850 lines, CRLF line endings) holds most of the deletions. Edit by exact text and run typecheck right after: a leftover import or window binding fails there.
- `tests/view.snapshot.json`, `tests/visualManifest.test.ts`, `tests/piecesView.test.ts` and possibly `tests/visualsEvent.test.ts` assert that no shipped piece or action has a visual. Step 1 is the first to break that on purpose.
- The preview fish on an empty ground (gap 4).
