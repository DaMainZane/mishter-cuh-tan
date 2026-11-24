# Handoff: Tidebound event deck, event timeline, shipwreck and pirate events

Written 2026-11-24. Read `CLAUDE.md` first (failing test first, never regenerate `tests/golden.snapshot.json`, `tests/view.snapshot.json` only as a reviewed diff, five checks after every change). Suggested setup: Opus 5.5, high effort, fresh session. Build this **before** `Handoff - Tidebound Tide Events.md`, which adds a third event to this deck. The map spec (`Handoff - Tidebound Island Clusters Map.md`) is independent.

## The change in one paragraph

Shipwrecks and pirates stop being pieces on the board and become **events** that hit every player at once. Tidebound's events come from **one deck**; the game draws from it and shows the upcoming events on a **timeline** on screen (an icon and the turn number). Later the tide joins the same deck as a third event.

## How it works today (read these before changing them)

- `src/shared/eventDeck.ts`: the optional base Event Deck (`rules.eventsOn`): base and DLC cards (`EVENT_CARDS`), one card drawn and applied at round start (`drawAndApplyRoundEvent`), a preview of the top card, Fate tokens to veto or uphold it, its own derived RNG stream (`deriveEventRng`).
- `src/packs/tidebound/wrecks.ts`: storm event card (`stormEventCard`, `tidebound.storm`) puts a wreck marker on a sea or shore tile near players (65/35); the first road, bridge or port to touch it claims loot (`claimWreck`, `computeWreckLootCount`); a countdown removes it; client view with spawn animation; a bot salvage goal.
- `src/packs/tidebound/pirates.ts`: pirate markers (max 2) move every round, rob 2 cards from every settlement/city in contact, flee logic, `drive_off_pirate` action needs played knights and a touching road; event card `tidebound.pirate_raid` plus a passive spawn schedule when the Event Deck is off (`PIRATE_FIRST_ROUND` 4, every `PIRATE_CADENCE_ROUNDS` 4). Strength: `1 + floor((round - 4) / 6)`, max 5. Played knights: `pirateKnights` (the Largest Army count).
- `src/packs/tidebound/tech.ts`: Salvage crew (+25% wreck loot, dev-card chance on sea wrecks, unlocks Demolish Bridge) and Pirate hunter (2 fewer knights needed, +50% loot; it is the prerequisite of Grand causeway).

## Decided by the user (2026-11-24)

1. **One deck.** "Group the events into one deck, and the game pulls from the deck to see what it has." The deck holds tide rises, pirates and shipwrecks (tide arrives in the second spec). "The game picks events, then those events show up as a timeline somewhere on the screen, icon + turn number."
2. **Shipwreck:** every player rolls their own d20; a higher roll gives more resources, 2 to 6 cards, random resources from the bank. My bands: 1-4 gives 2, 5-8 gives 3, 9-12 gives 4, 13-16 gives 5, 17-20 gives 6; an empty bank pile is skipped.
3. **Pirates, global:** each player's strength against the pirate is their **played knights** (the ones counting toward Largest Army), not cards in hand. Same comparison as before, now applied to every player at once. Knights are not spent.
4. **Tie = the player wins** and gets the reward.
5. **Losing:** the pirate takes 2 random cards from the player's hand; resources go back to the bank; a fish taken is deleted (fish have no bank).
6. **Reward when winning:** "the game is won around cycle 40, and by then a roll gives about 7 resources if it hits", so the reward scales with **both the pirate's strength and the round**, at most 8. Random resources from the bank.
7. **Strength** keeps growing with the round, but **slower** than today.
8. **Techs:** Salvage crew becomes +1 card from shipwreck events (keeps Demolish Bridge). Pirate hunter becomes +2 effective knights against pirates and +1 reward card.
9. **Removed entirely:** wreck and pirate pieces on the map, the `drive_off_pirate` action, wreck claiming, their view fields and client layers/icons, the matching bot goals and debug-brush entries.
10. **Announcement:** a title card plus one log line per player saying what they rolled, got or lost.

## Proposed numbers (show the user this table before building; it was not approved yet)

Strength: `min(5, 1 + floor(max(0, round - 4) / 10))` (one step every 10 rounds instead of 6).
Reward: `min(8, 2 + strength + floor(round / 15))`; Pirate hunter adds 1 (question: may it go past 8?).

| Round | Strength | Reward |
|---|---|---|
| 5 | 1 | 3 |
| 14 | 2 | 4 |
| 20 | 2 | 5 |
| 30 | 3 | 7 |
| 40 | 4 | 8 |

## Open questions (ask the user first; each changes the build)

1. **Which deck:** the existing optional base Event Deck (lobby switch, Fate token veto, other DLCs' cards share it), or a separate Tidebound deck that always runs when Tidebound is on? My default: a Tidebound deck that always runs with Tidebound, independent of `eventsOn`, because the timeline needs several cards known in advance while the base deck only previews one.
2. **Cadence and horizon:** how often an event fires (my default: one every 2 to 4 rounds, random), how many upcoming events the timeline shows (default 3), and whether "turn number" means round (default: round).
3. **Reward cap with Pirate hunter:** 8 including the tech, or 9?

## What to build

1. A Tidebound event deck module in the pack (`src/packs/tidebound/`), seeded from its own derived stream (never `g.rng`), that schedules the next N events with their rounds and resolves each at round start. State lives under `g.ext.tidebound`.
2. Shipwreck event and pirate event as resolvers on that deck, as decided above; Salvage crew and Pirate hunter changed to the new bonuses (tech descriptions too; `tests/view.snapshot.json` will change only in those texts and fields, review the diff).
3. A `VIEW_DATA` entry with the timeline (event id, round, and any visible detail such as pirate strength) so the client draws it.
4. Client: a timeline strip (icon + round per upcoming event), flat and quiet per `Design UI Philosophy.md`; a title card when an event resolves; log lines per player. Use the existing title card (`showEventTitleCard` in `client/render/overlay.ts`).
5. Retire the wreck and pirate pieces: rename retired files with a `[del.]` prefix instead of deleting them (`CLAUDE.md` rule), remove the action, markers, view fields, client layers and icons, debug brushes (`server/debug.ts`, `client/debug.ts`), the bot goals in `wrecks.ts` / `pirates.ts`, and update or retire their tests (`tests/tideboundwrecks.test.ts`, `tests/tideboundpirates.test.ts`, parts of `tests/tideboundtech.test.ts`, `tests/pirateicon.test.ts`, debug tests).
6. Old saves: strip leftover wreck and pirate markers when a game loads.
7. Bots: `server/bots/brain.ts` names no DLC content. If bots should value knights more because of pirates, do it through the pack's `BOT_GOALS` hooks (`wantsKnight`).
8. The lobby addon card list in `client/render/setup.ts` must keep matching the server's addon list if addon names or descriptions change.

## Acceptance

- With Tidebound off nothing changes (golden snapshot untouched).
- Seeded: the same seed gives the same events, rounds, d20 rolls and resources.
- Shipwreck: every player gets 2 to 6 cards by their own d20; empty bank piles skipped; Salvage crew +1.
- Pirate: each player with played knights at or above the strength (Pirate hunter +2) gets the reward; everyone else loses 2 random cards (fish deleted, resources to the bank).
- Timeline shows the next events with icon and round; a title card and log lines on resolve.
- No wreck or pirate piece, action or board layer remains.

## Finish

Same checks and bookkeeping as the map spec: `npm run headers:write`, `npm run index`, `npm run addons` if addons changed, `npm run mindmap:check`, `npm run typecheck`, `npx vitest run`; change log pass; commit with the session's `Co-Authored-By` line. Remove the "pirate tile glow" item from `BUGS/Bug List.md` (pirates no longer sit on a tile).
