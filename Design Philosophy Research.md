Things I want to dive in deeper:
1. Skeleton loaders
2. Optimistic updates
3. Command menu
4. Shortcut hints
5. Undo toasts
6. Stale-while-revalidate
7. Pre-rendering
8. BlurHash placeholders
9. View transitions
10. Swip-to-dismiss sheetes
11. Interruptible animation
12. Predictive back
13. Hit slop
14. Safe area insets
15. One-time code autofill
16. Tabular numbers
17. Balanced headliners
18. Continuous corners
19. Idempotency keys
20. Amazon safe triangle

Exploring some design style:
1. Claymorphism
2. Cybercore
3. Neo brutalism
4. Pixel art
5. Swiss design
6. Minimalism design
7. Conceptual sketch
8. Cyberpunk

Some UX law:
1. Law of closure, next card peek (0% vs 32% visible)
2. Law of Figure-ground - dim what's behind the focus (17.4:1 -> 2.5:1)
3. Banner blindness - don't make important things look like ads
4. Parkinson's law - fill in what you already know (30 keys -> 7)
5. Connectedness - connect the steps of a flow
6. Choice overload - show fewer options up front
The numbers are from a script, not necessarily having anything to do with what we are developing

Some skills to check:
- Impeccable skill
- Emil Kowalski design skill
- Taste skill
- Figma MCP and playwright or vercel CLI, or even Tiny fish
- Web design guideline 
- Awesome design
- Image to code
- Skillspector

Some website to check:
- Prompt motion
- Curated database similar to prompt motion with catalogue of UI/UX elements to borrow

# AI-friendly architecture for the Catan project (Gemini advice, reviewed 2026-10-31)

Gemini's advice for building a complex game so an AI can read and debug it, checked against `colonist-custom-catan`. Verdict: most of it is already in place; one real gap; the rest is "keep doing it".

## The four ideas and where the project stands

| Idea                                                                           | Have it?                   | Where                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Decoupled architecture, single responsibility, "explain it in one sentence" | Mostly                     | Every `src/` file has a `// MODULE:` header (depends on / used by). `tests/architecture.test.ts` enforces layers (`client` may not import `packs`). DLCs are packs registered through `api.*`, no engine edits. |
| 2. Context anchor ledger (architecture note to feed the AI)                    | Yes, better than suggested | `ROUTER.md`, `EXTENSION POINTS.md`, `RECIPES.md`, `CLAUDE.md`, `INDEX.md`, `Handoff - Modular Rework.md`, `Rework Progress.md`. `tests/index.test.ts` and `tests/headers.test.ts` fail when they go stale.      |
| 3. Centralized state                                                           | Yes                        | One engine state `g`, addon data under `g.ext.<addon>`, seeded RNG, `golden.snapshot.json` and `view.snapshot.json` pin behaviour and what the client receives, `client/store.ts` on the client.                |
| 4. Interfaces before logic                                                     | Partly                     | Done for the visual manifest (`Visual Manifest Design.md`, approved, then `shared/visual.ts` types, then code). Not yet a standing rule in every prompt.                                                        |

## Gaps

1. **No "copy game state as JSON" button (the one real gap).** A bug report to any AI needs the exact state plus the seed and the action log. Today the only export is the bot training log, which is for bot data, not debugging. Add a debug action (menu button, maybe host-only) that copies: room code, seed, settings, DLC and addon set, the action log so far, and the current state or the player view (a spectator view, so no hidden hands leak into a shared paste). Cheap, and it makes every later bug report reproducible.
2. **A few files fail the one-sentence test.** `src/client/render/board.ts` (about 1,500 lines: terrain, ports, roads, vertices, animations, camera, card flights), `socket.ts` and `actions.ts` are large. R8.8 deletes a lot of per-piece code from them, so measure again afterwards before splitting anything.
3. **Prose docs can still drift.** The fresh-reader trial (2026-10-31) found four doc errors that no test caught. The fix is the habit below, not more prose.

## When to pursue each

Example
Task: T12a, drown the lowest-elevation tiles first.

Interfaces first. Give me only:
- the new fields in g.ext.tidebound.tides (names, types, who writes them)
- signatures for the new functions (inputs, outputs, which RNG they use,
  or "none")
- which existing hooks you'll register into (SEVEN_STEPS, VIEW_DATA, ...)
- which files you'll edit or create
Do not write function bodies. Stop and wait for my OK.

| What                                                                                            | When                                                                                                                                                    | Why then                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interfaces-first rule in every prompt ("write types and signatures, I approve, then the logic") | **Now.** Add one line to the prompt template. Applies from R8.8 step 6 (tier 2 registration shape), T12 onwards and every new DLC.                      | Free, and it stops an agent inventing fields that don't exist.                                                                                                                                                                                                |
| Docs-as-tests habit (when a doc rule matters, make a test enforce it)                           | **Ongoing.** R8.11 is the next natural point; R9.4 after it.                                                                                            | No separate task. Each time a doc is found wrong, add the test that would have caught it.                                                                                                                                                                     |
| Debug state button                                                                              | **After R8.11 / R9 is green and before T13** (bots and dialogue tuning, where reproducing an exact situation matters most). One small chunk of its own. | R8.8 edits `main.ts`, `actions.ts` and `public/index.html`; the button touches the same files, so do not run both at once (working rule 7, and the push rejection on 2026-10-31 shows what parallel work costs). Move it earlier only if a bug hunt needs it. |
| Split `board.ts` (and `socket.ts`, `actions.ts`)                                                | **Decide after R8.8 is green.** Check line counts then. Split only if still over about 1,000 lines or a task needs the whole file pasted.               | R8.8 removes the per-piece blocks, which is most of the size. Splitting before that is double work.                                                                                                                                                           |
| Re-architecting for AI use                                                                      | **Don't.**                                                                                                                                              | The structure is already the point of the Modular Rework. Finish R8.8 to R9.                                                                                                                                                                                  |

## Order of work these fit into

1. Finish R8.8 to R8.11 (Gemini task), then R9 (proof piece, auto-registration).
2. Debug state button chunk.
3. T12 to T14 (Tidebound close-out). If T12 comes before R8.8, do R8.8 step 1 (the `flood` overlay kinds) first so the new drowned look is registered instead of added to the closed list in `overlay.ts`.
4. Re-check `board.ts` size and decide on the split.
5. Next DLC (Bulwark) built the "one file plus its test" way.

  
  