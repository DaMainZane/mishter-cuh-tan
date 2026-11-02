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

step 1 and 2 are done

### Step 3: cleanup

- Remove `netSeaTiles` and its tests (`pieceModel.ts`, `tests/pieceModel.test.ts`).
- Remove `netMarkup` if unused.
- Update `INDEX.md`, `RECIPES.md` and `ROUTER.md` net mentions, and add a change log pass.

## After every step

```
npm run headers:write; npm run index; npm run typecheck; npm test
```

Never regenerate `tests/golden.snapshot.json` or `tests/view.snapshot.json`. Nets are off in the default game, so the golden should not move. If it does, stop and say why.


