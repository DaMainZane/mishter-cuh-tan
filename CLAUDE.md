# CLAUDE.md

Instructions for Claude Code (and any other agent) working in this repo. Keep this file short; the details live in the files it points to.

## Before you change code

1. Read `ROUTER.md` first. It maps a kind of task to the files to open and one file to copy as a pattern. If you do not know which part of the game a change belongs to, read `ARCHITECTURE.md` (the concept map: tile, world generation, engine, packs, views, server, bots, client) before `ROUTER.md`.
2. Then `EXTENSION POINTS.md` (registration calls, hooks, keyed registries) and `RECIPES.md` (step-by-step for a new piece, action, addon, tech node, client overlay).
3. Do not read whole folders or whole large files. Search for a symbol (`grep`, your editor's search) and open only the file that holds it. `INDEX.md` has one line per file.
4. For Tidebound feature work read `change log.md` and `Development Plan.md` (the chunk list T0 to T14).

## Rules

- Content is data: add pieces, actions, hooks and rules through `PackApi` inside an addon, registered only while the addon is on. A disabled addon must change nothing. Do not edit `src/shared` to add content.
- The bot brain (`src/server/bots/brain.ts`) names no DLC content: no DLC tech id, piece id, marker kind or rule switch. A DLC tells it what its content is worth through `BotGoalDef` hooks (`techValue`, `wantsKnight`, `mainPortUpgrades`, `portUpgradeOnSettlement`, `edgeReach`, plus the tier-gated goals and deltas), registered with `api.define(BOT_GOALS, ...)`. Tidebound's live in `tidebound/tech.ts` (`tideboundTechBotGoal`), `tidebound/pirates.ts` and `tidebound/bridgeCore.ts`. `tests/tideboundbots.test.ts` checks that with the DLC off the brain picks the same moves as a registry without the pack.
- Layers (enforced by `tests/architecture.test.ts`): `shared` imports only `shared`; a pack imports `shared`, itself and `packs/base`; `server` never imports `client`; `client` imports only `client` and `shared`. No new circular imports.
- No `g.rng` draws in addon code unless the base game already draws there. Use a derived stream. `tests/golden.snapshot.json` must stay untouched unless the task is a deliberate behavior change.
- Every `src/**/*.ts` file starts with one line: `// MODULE: what | DEPENDS ON: a, b | USED BY: c, d`. Write only the description. The two lists are generated.
- `INDEX.md`'s `src/` tables are generated from those headers: never edit them by hand. Root, Docs and `tests/` tables are hand-written; update them when you add a file there.
- Hand-written glue still exists for the net, harbor, feed and bridge pieces (R8.8 migrates them), in `client/icons.ts`, `client/render/board.ts` and `client/main.ts`. A new piece with a `visual` needs none (`src/packs/_template/lantern.ts` is the proof; recipe 1 in `RECIPES.md`). Actions need none (the client emits `act`).
- Removable files get a `[del.]` name prefix instead of being deleted.

## When I report a bug

The report follows `BUGS/Bug Report Template.md` (Saw, Expected, Actual, Before it, Repro, Severity). Follow its rules:

1. Triage first: before reading code, name the likely area and the first file to open in one line. If "Saw" is "Don't know", guess from Before it and Repro. Open at most 2 files to confirm; if still unsure, ask one question instead of searching further.
2. Stay in that area (`ROUTER.md`). Search for a symbol before opening a file.
3. Write a failing test first, then the fix. A fix with no new test is not done.
4. Expect 3 files or fewer; if more, say why (it may be a wrong diagnosis).
5. Never regenerate `tests/golden.snapshot.json` or `tests/view.snapshot.json` to make a fix pass.
6. Answer in the fix-report shape from the template: CAUSE, FIX, REGRESSION, NOT VERIFIED, COMMANDS.

## After every change

```
npm run headers:write
npm run index
npm run mindmap:check
npm run typecheck
npm test
```

Add a pass to `change log.md` and update `INDEX.md` Root, Docs and `tests/` rows when files were added. Say what you did not verify. If you cannot run the commands, give the exact commands and ask for the output instead of claiming they pass.
