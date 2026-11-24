# Handoff: tides become events in the Tidebound deck

Written 2026-11-24. Read `CLAUDE.md` first. Suggested setup: Opus 5.5, high effort, fresh session. **Build this after `Handoff - Tidebound Event Deck.md`**: it adds the tide as the third event in that deck and on its timeline.

## The change

Today tides follow a fixed, seeded schedule per coast cluster. The user wants the tide to be an **event** drawn from the Tidebound deck: "tide rises (fixed turn when it retreats, 2-5, and it also dictates tide elevation too)". So a tide event says how high the water rises and for how many rounds (2 to 5) it stays, and it appears on the event timeline like a pirate or a shipwreck.

## What reads the tide today (check every one before changing it)

All in or around `src/packs/tidebound/tides.ts` unless noted:
- The schedule: `TIDE_PERIOD`, `TIDE_FIRST_ROUND`, clusters (`buildTideClusters`, `TIDE_CLUSTER_SIZE`), `isFloodedAt`, `floodPlan`, `applyTides` (runs at round start, sets and clears the `flooded` tile state).
- Spring tides: `TIDE_SPRING_EVERY`, `isSpringTide` (the water reaches one ring further inland).
- Strength by elevation: `floodDepthAt`, `tideStrengthAt`, `hexElevation` (land elevation 1 to 3 from `seaData.ts`; higher ground resists).
- The lobby **Tide level** slider (`rules.tideLevel`, `TIDE_LEVELS`, 1 to 5) in `server/runtime.ts`, `client/render/setup.ts`.
- The one-turn-ahead warning and title card: `tideWarning`, `tideClientView`, flood overlays in `client/render/overlay.ts` and the canvas board.
- Ports idle while flooded (`isPortFlooded`; raised ports and harbors keep working).
- Fish replenish by tide depth (`tideReachOnSea`, `replenishFish` in `fishing.ts`).
- Rising sea (`risingSea.ts`) counts flooded tiles when Tides is on.
- Bot goals: `tidesBotGoal` (flood exposure in vertex scoring, now cached with a `WeakMap<Ctx>`).
- Tests: `tests/tideboundtides.test.ts`, `tests/tideboundrisingsea.test.ts`, `tests/tideboundfishgrounds.test.ts`, `tests/tideboundharbor.test.ts`, `tests/viewState.test.ts`.

## Decided by the user

- The tide is one of the deck's events, shown on the timeline (icon + turn number).
- Each tide event fixes **how long it stays (2 to 5 rounds)** and **how high it rises (its elevation)**.

## Open questions (ask the user first)

1. **Where does it flood:** every coast at once, or one coast cluster (or a few) per event?
2. **What the elevation means:** does elevation N flood land of elevation N and below (so 1 floods only low coast, 3 floods everything that touches the sea), and how far inland does it reach (one ring, like today's normal tide, or more)?
3. **Spring tides:** keep them as a rarer, higher tide card, or drop them?
4. **The Tide level slider:** what should it control now? Options: how many tide cards are in the deck, how high tides can rise, or remove it.
5. **Overlapping tides:** if a new tide arrives while one is still up, does the higher one win, or do they stack?
6. **The warning:** the timeline already shows when a tide comes. Keep the one-turn-ahead warning overlay as well?

## Acceptance

- With Tidebound or Tides off, nothing changes.
- Seeded and deterministic; no `g.rng` draws.
- Flooded tiles still yield half rounded up per building (pass 113), ports idle while flooded (raised ports and harbors keep working), fish replenish, Rising sea and bots still behave.
- The timeline shows tide events with their round, elevation and duration.

## Finish

Same checks and bookkeeping as the other two specs; `Tech Tree Design.md` and the Tides addon description (`tides.ts` and the copy in `client/render/setup.ts`) must describe the new rule.
