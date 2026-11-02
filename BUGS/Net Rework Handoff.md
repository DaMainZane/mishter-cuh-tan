# Handoff: fishing net rework (one net per tile)

Date: 2026-11-02. Read `CLAUDE.md`, `ROUTER.md`, `BUGS/Bug Report Template.md` first. The bug rules there apply (triage, test first, fix-report shape, never regenerate the snapshots).

## Where we are

| Item | State |
|---|---|
| Bug 4 (port upgrade node) | Done. Pass 106. Headers, index, typecheck and tests passed. Not seen in the game. |
| Fishing net icon | Pass 107 is in the code but NOT run (no typecheck, no tests). It is a stopgap: a net is drawn on every sea tile at its vertex. Superseded by this rework. |
| Bug 3 (tech cost balance) | Not started. Order advised: Bug 4, net, Bug 3. |
| Bug 5 (build UI rework) | Not started. Reuse `portRaiseSpots` (`pieceModel.ts`: cost and `affordable` per node) for the popover and cost tooltip. |

## The rule (decided)

- A net takes **exactly one sea tile** and fishes **only that tile**. A tile holds **at most one net**.
- The player picks the tile.
- Reference: `BUGS/Image/8.png` (a net fills one tile) and `9.png` (mesh, rope border, floats).

## Why it is big

Today a net is a vertex piece (`fishing.ts`: `NET`, `canPlaceNet`, `netSpotsView`). `Piece` is only `{ type, owner }`. It fishes every sea tile at its vertex (`seaHexIdsAt`, 1 or 2 tiles). Nothing stops two nets sharing a tile.

## Plan (3 steps, run the commands after each)

### Step 1: server rule (`src/packs/tidebound/fishing.ts` and its tests)

- Store the net on the sea tile: `hex.ext.net = { owner }`.
- New action `place_net { hexId }` replaces the net piece. Pattern: `feed_sea` (kind action, slot hex, `spotKey: 'hexId'`) and `ricketyBridges`/`harbor.ts` for registration.
- Keep: cost (`NET_COST`, Net works wood discount `netWorksCostMod`), supply and limit (`NET_BASE_LIMIT`, scales with radius), tech gate `TECH_FISHING_NETS`, the "needs a settlement or city, connected by road" idea.
- Legal tile: a sea tile (`isSeaHex`) that touches a coast vertex next to your own road or bridge, with no net on it yet. Decide the exact vertex rule while reading `canPlaceNet`.
- The "no net on a port vertex" rule goes away (the net no longer takes a vertex).
- Supply is now counted from tiles. `placedCount(g, pid, NET)` counts vertex pieces, so it needs replacing.
- Read the one tile: `netCatchOnRoll` (chance, richest ground, boost use), `feedSeaScore` (`ownNetsAtHex`), feed spots ("sea tiles next to one of your nets"), `netBotGoal`, `NET_BOT_MAX`.
- Check `netWorksCostMod` and the pricing path, since they match on `def.id === NET` (a `PieceDef`). An action may need a price another way.
- Old saves with vertex nets: migrate to a tile or drop them. Check `tests/persistence.test.ts`.
- Rewrite the tests: `tideboundnets`, `tideboundnetsclient`, `tideboundfishing`, check `tideboundfishgrounds`, `botgoals`, `tideboundbots`. They were written for vertex nets.

### Step 2: client

- Net mode becomes tile picking, like feed mode (`clickFeedSpot`, `feedSpotSet` in `client/render/board.ts`).
- Replace `clickNetSpot` (emits `place`, piece net) with an `act` `place_net` emit.
- Spots come from VIEW_DATA (`netSpots` is vertices today; make it hex ids).
- Hand-written net glue to check: `canClientAffordPiece('net')`, `isClientPieceDoubleCost` net branch, `CLIENT_BASE_PIECE_COSTS`, the net mode toasts in `setBuildMode` (`actions.ts`), the Net build button (`public/index.html` or generated), `techpanel.ts` text "coastal tile modification".
- Draw from the tile data with `netTileMarkup` (`icons.ts`, Pass 107, keep).
- Also decide: the net takes no vertex anymore, so the old small `netMarkup` piece and the vertex skip in `board.ts` go.

### Step 3: cleanup

- Remove `netSeaTiles` and its tests (`pieceModel.ts`, `tests/pieceModel.test.ts`).
- Remove `netMarkup` if unused.
- Update `INDEX.md`, `RECIPES.md` and `ROUTER.md` net mentions, and add a change log pass.

## After every step

```
npm run headers:write; npm run index; npm run typecheck; npm test
```

Never regenerate `tests/golden.snapshot.json` or `tests/view.snapshot.json`. Nets are off in the default game, so the golden should not move. If it does, stop and say why.

## Not verified / not read

- I did not open: `server/view.ts`, `packs/base/building.ts`, the pricing path for pieces, the three net test files, `public/index.html`, `persistence.test.ts`. The file list above is from what I did read plus the router.
- Pass 107 and the whole net rework were never run.
- Bug 4 was not tried in the game.
