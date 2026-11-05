# Tech Tree Design

Locked 2026-10-28, updated the same evening. This file is the spec for the next agent. Sections 1 to 5 cover the 5 roots. Sections 6 to 8 add the 4 tiers, the two-lane split and the first full branch (Tidebound). The other four branches are not designed yet, and everything beyond the roots may change.

---

## 1. Locked decisions

- **Hub and spoke.** Every branch starts at a central hub. One branch per DLC.
- **Five roots only.** The tree ships with exactly 5 techs, one root per DLC branch: Tidebound, Bulwark, Warlords, Wild Earth, Guildhall. The cosmetic DLC (Rowdy Tavern) has no branch.
- **DLC gating.** The 5 root techs are base-tier and always researchable, even with their DLC off. Every node beyond a root is hidden and not researchable unless that DLC is on. Gated nodes use the existing `dlc` field on `TechDef`; roots leave it unset.
- **No separate base branch.** The 4 old base techs in `stage1.ts` (`base.road_engineering`, `base.harbor_charters`, `base.literacy`, `base.fortified_towns`) are removed. See section 5.
- **Roots touch base gameplay only.** Each root changes something that exists with every DLC off (ports, discards, knight steals, tiles, road cost), which is why roots stay open without their DLC.
- **Game toggle.** `rules.techTreeOn` in the lobby. Off means nobody can research. This toggle is the only thing that turns the whole tree off; turning DLCs off does not.
- **Prices are per player** and scale with that player's buildings (section 2).
- **Four tiers, two lanes per branch.** Each DLC branch is a root followed by a fork into two lanes. Tiers are in section 6, the split in section 7, and Tidebound is designed in full in section 8.
- **Registration only.** Techs register through `api.define(TECH_DEFS, ...)`. Do not edit `engine.ts` or base files for tech content. A disabled DLC or tech tree must have zero effect (no `g.rng` draws, no state, no new legal actions). The golden test stays green.

---

## 2. Cost formula

```
V    = settlements * 1 + cities * 2 + castles * 3        // this player's building value
cost = max(FLOOR, round(BASE_FACTOR * (tier + offset) + SCALE_FACTOR * ceil(V / DIVISOR)))     // in cards
// Nov 2026 rebalance: BASE_FACTOR 0.65 (the tier part 35% cheaper), SCALE_FACTOR 0.2 (the building-value part 80% cheaper).
// Tables below were written for the old formula (factors 1 and 1): read the numbers as the old prices.
```

- Constants live in one object: `TECH_COST = { settlement: 1, city: 2, castle: 3, divisor: 3, floor: 2, baseFactor: 0.65, scaleFactor: 0.2 }`. Tune in the sim matrix.
- `tier` is 1 for every root. Deeper nodes add 1 per tier.
- `offset` is per tech (section 3), so impact can shift the price.
- Count pieces with `placedCount(g, pid, 'settlement' | 'city' | 'castle')`.
- Keep the existing Catch-up rule: a player with 0 techs who qualifies for Catch-up pays 1 less (never below the floor).
- Remove the old Literacy clause (cost cut by a third) from `techCostCards`.
- Payment stays wheat plus ore via `defaultTechPayment`.

Cost in cards for a tier 1 root, by building value V:

| Example player | V | ceil(V/3) | Offset 0 | Offset +1 | Offset +2 |
|---|---|---|---|---|---|
| Start (2 settlements) | 2 | 1 | 2 | 3 | 4 |
| 3 settlements, 1 city | 5 | 2 | 3 | 4 | 5 |
| 3 settlements, 3 cities | 9 | 3 | 4 | 5 | 6 |
| 2 settlements, 3 cities, 2 castles | 14 | 5 | 6 | 7 | 8 |

---

## 3. The five root techs

| DLC        | Tech id                     | Effect                                                             | Offset | Cost at V = 2 / 5 / 9 / 14 |
| ---------- | --------------------------- | ------------------------------------------------------------------ | ------ | -------------------------- |
| Tidebound  | `tidebound.harbor_charters` | Unlocks upgrading a 3:1 port to 2:1                                | 0      | 2 / 3 / 4 / 6              |
| Bulwark    | `bulwark.stockpiling`       | +2 discard limit                                                   | 0      | 2 / 3 / 4 / 6              |
| Warlords   | `warlords.plunder`          | Knight steals 1 extra card                                         | +1     | 3 / 4 / 5 / 7              |
| Wild Earth | `wildearth.ground_work`     | Convert a tile you touch into a basic resource tile of your choice | +2     | 4 / 5 / 6 / 8              |
| Guildhall  | `guildhall.road_levy`       | Past the road cap (2x price), roads cost 1 less brick or wood      | 0      | 2 / 3 / 4 / 6              |

Offsets are placeholders. Tune them in the sim matrix.

---

## 4. What to add, per tech

### Tidebound: Harbor charters
- **Rule:** a **city** on a 3:1 port vertex can be upgraded to a 2:1 port. Cost: 2 wood, 1 brick, 1 ore (from `Ideas.md`, Harbor upgrade; counted against the 2x-over-cap rule). The 2:1 floor stays.
- **Hook:** `shared/tradeRatio.ts`, a `RatioModifier` registered with `api.define(RATIO_MODS, ...)`. Replace the old `techHarborCharterRatioModifier` (it made every 3:1 port 2:1 with no upgrade).
- **Add:** per-vertex "upgraded port" state; an `upgradePort` action (server and client); cost through the piece cost service.
- **UI:** highlight upgradable port cities with the overlay kit, plus an upgrade button.
- **Bots:** Secondary and up upgrade the port that matches their main resource. Main ignores it.
- **Tests:** only cities, only 3:1 ports, ratio floor, DLC off has no effect.
- **Changed 2026-10-28:** the upgrade is a ratio change only. The whole port goes from 3:1 to 2:1 and stays 'any resource'. The first build let the player pick one resource, which is no longer wanted. See section 8.

### Bulwark: Stockpiling
- **Hook:** a `DiscardLimitModifier` registered with `api.define(DISCARD_LIMIT_MODS, ...)`, gated by `hasTech`. It stacks with the Catch-up bonus.
- **Add:** the modifier only. No new action.
- **UI:** show the new limit in the tech panel and the discard prompt.
- **Bots:** nothing; they read the limit through `effectiveDiscardLimit`.
- **Tests:** limit 7 becomes 9; stacks with Catch-up.

### Warlords: Plunder
- **Rule:** when a **knight** is played, the steal takes 1 extra card. A rolled 7 is unchanged. Capped by the victim's hand size.
- **Hook:** the steal lives in the base pack (`packs/base/robbing.ts`). Refactor it once to ask a new registry (for example `STEAL_COUNT_MODS`) for the card count, with zero change in behavior and the golden test green. Then register Plunder through `api.*`.
- **Add:** the registry, the modifier, a history entry for the bigger steal.
- **UI:** the steal result card shows the number of cards taken.
- **Bots:** Secondary and up value knight plays slightly higher.
- **Tests:** knight steals 2, a 7 steals 1, a victim with 1 card loses 1, DLC off has no effect.

### Wild Earth: Ground work
- **Rule:** single-use ability. The player converts one tile that touches their own **settlement or city** (not roads) into one of the 5 basic resources of their choice. The source tile can be any **land** tile type, desert and modded or special tiles included. Sea tiles are not valid. The number token stays. Once used, the tech has no further effect. If convert a desert tile, roll a random number. If tile already have a number, then the newly convert resource tile will inherit the number. 
- **Hook:** the tile state layer (`shared/tileState.ts`).
- **Add:** a `convertTile` action (single use, tracked per player); a **special tile filter** like the 7 filter. It tints only the tiles that qualify, in a distinct tint with a pattern as well as a color; a resource picker; persistence of the changed tile in game state and export codes.
- **UI:** overlay kit tint, tile click, then resource choice.
- **Bots:** pick the conversion with the best added pip production.
- **Tests:** only touching land tiles, any land source type (desert and modded included), sea refused, only basic targets, number kept, second use refused, DLC off has no effect.

### Guildhall: Road levy
- **Rule:** only when a road is built **past the cap** and the 2x price applies, it costs 1 less brick or wood. Adaptive: take the discount from whichever of the two the player holds fewer of. Roads at normal cost get no discount.
- **Hook:** `COST_MODS` (see `techRoadCostModifier` in `stage1.ts` as the template) and `shared/pricing.ts` for the "above cap" check.
- **Add:** the modifier. Remove the old `base.road_engineering` modifier.
- **UI:** the road cost display shows the discounted price.
- **Bots:** nothing, if they read costs through the pricing service.
- **Tests:** no discount below the cap, -1 above it, adaptive pick, DLC off has no effect.

---

## 5. General work

Verify first (not confirmed on this branch): does a `researchTech` action, a tech panel and bot research logic exist? `stage1.ts` has the logic only.

1. Remove the 4 base techs and the Literacy clause. Update any test that names them.
2. Add the cost formula and `TECH_COST` constants. Replace `techCostCards`.
3. Add `rules.techTreeOn` to the lobby (default off, so existing games stay unchanged).
4. Add the research action (server and client).
5. Build the hub-and-spoke tech panel: the 5 roots always shown, extension nodes generated from `TECH_DEFS` and hidden when their DLC is off, a cost readout per player.
6. Add the 5 techs one at a time, each ending with `npm run typecheck` and `npm test`, `MODULE:` headers, and `INDEX.md` and `change log.md` updated.
7. Sim matrix: tech tree on and off, with each DLC on and off.

The 5 roots need no DLC pack, since they only change base gameplay. Extension nodes later need their DLC pack registered (`allPacks` has only base, gold, fog today). Build order follows `Ideas.md`: Tidebound, Bulwark, Warlords, Wild Earth, Guildhall.

---

## 6. Tiers (locked 2026-10-28)

Trees are balanced for long games: 25 or more VP to win, every player with a large settlement network. Do not hold back on power.

| Tier | Role | What it does | Offset band | Price at V = 2 |
| --- | --- | --- | --- | --- |
| 1 | Base | Themed. Mostly leaves the gameplay cycle alone, still a decent power boost. The 5 roots are tier 1. | 0 to +2 | 2 to 4 |
| 2 | Lock-in | Shapes the playstyle and strongly pushes the player toward one strategy. First node of a lane. | +2 to +4 | 5 to 7 |
| 3 | Boost | Strengthens that strategy and visibly changes the pace of the mid game. | +4 to +7 | 8 to 11 |
| 4 | Defining | Game-changing. Whoever gets it defines the outcome of the game. | +7 to +11 | 12 to 16 |

- Price at V = 2 is `tier + offset + ceil(2 / 3)`, from section 2. The bands are starting points for the sim matrix.
- A lane can hold more than one node in a tier. Tidebound has two in tier 3 (3a, then 3b). Both are priced as tier 3, each with its own offset.
- Tier 4 must stay answerable: every tier 4 effect has a counter other players can use (take it, break it, or deny what it needs).

---

## 7. The two-lane split (locked 2026-10-28)

After its root, every DLC branch forks into two lanes. The fork is the strategic choice: pick a lane at tier 2 and the later tiers deepen it.

- **Names are themes, not rules.** Tidebound uses Expansion and Industrial. Another branch can use any pair of playstyles. What matters is that the two lanes pull in different directions.
- **Each lane has a tempo, a weakness and a counter.** Write all three before adding a lane (see the lane identity notes in section 8).
- **Nothing is exclusive.** A player can climb both lanes, but every tech is priced on its own, so the second lane competes with the first for the same wheat and ore. The lock is economic, not a rule. Open question 4 asks if price alone is enough.
- **Roots stay shared.** Both lanes need the root. Tier 2 is the first node of each lane.
- **Tech panel.** The panel must draw two lanes per branch. Group nodes by lane (it can be derived from the prerequisite chain, so no new row field is needed for layout), widen the angle between nodes of the same tier (9 degrees is too tight, use about 16 to 18), and let the outer rings use smaller nodes so four rings fit.

---

## 8. Tidebound tree (first full branch, designed 2026-10-28)

The root plus two lanes. All numbers are placeholders for the sim matrix. Nodes beyond the root are design only; none is registered in code yet.

```text
EXPANSION lane                 INDUSTRIAL lane
bridges, wrecks, pirates       nets, harbor

T4   Grand Causeway            Harbor empire
T3b  Pirate hunter             Harbor master
T3a  Salvage crew              Net works
T2   Rickety bridges           Fishing nets
        |_____ T1  Raise the Port _____|
```

| Tier | Node (id) | Effect | Offset | Price at V = 2 |
| --- | --- | --- | --- | --- |
| 1 | Raise the Port (`tidebound.harbor_charters`) | A port you hold with a city goes from 3:1 to 2:1. It stays 'any resource', only the ratio changes. Cost 2 wood + 1 brick + 1 ore. | 0 | 2 |
| 2 Expansion | Rickety bridges (`tidebound.rickety_bridges`) | Unlocks rickety bridges (1 wood, health 1, upgrade later for 1 brick + 1 ore). The normal bridge cap goes up by 4. | +3 | 6 |
| 2 Industrial | Fishing nets (`tidebound.fishing_nets`) | Unlocks building fishing nets. Raising a port from 3:1 to 2:1 now needs only a settlement, not a city. | +3 | 6 |
| 3a Expansion | Salvage crew (`tidebound.salvage_crew`) | Demolish one of your bridges to get back half of what you paid (rounded down) and free its slot in the cap. Wreck loot +25%. | +5 | 9 |
| 3a Industrial | Net works (`tidebound.net_works`) | Nets cost 1 less. A second net tier (catch chance about 1 in 4 instead of 1 in 6). Each catch has a 1 in 3 chance not to use up a fish icon. | +5 | 9 |
| 3b Expansion | Pirate hunter (`tidebound.pirate_hunter`) | Pirates need 2 fewer knights to beat for you (never below 1). Pirate loot +50% for you. | +7 | 11 |
| 3b Industrial | Harbor master (`tidebound.harbor_master`) | Unlocks the Harbor (see the port ladder). Unlocks feeding: pay 1 wheat to feed a sea tile next to one of your nets. A sea tile with no fish icon gets one at max; a depleted one is refilled to max at once. | +7 | 11 |
| 4 Expansion | Grand Causeway (`tidebound.grand_causeway`) | Longest Road is worth 16 VP instead of 2 while you hold it and its path contains at least one bridge (a rickety bridge counts). | +10 | 15 |
| 4 Industrial | Harbor empire (`tidebound.harbor_empire`) | One more harbor is allowed (2 in total). One time: take X random cards from the bank, X = ceil(V / 2), as many as the bank has. | +10 | 15 |

**Port ladder**
- Every port upgrade lowers the ratio by one step. A 3:1 any port becomes 2:1 any (Raise the Port), then 1:1 any (Harbor). A specialised 2:1 port (for example brick) becomes 1:1 brick (Harbor).
- Raise the Port only applies to 3:1 ports. The Harbor applies to any port, and the new ratio follows the port's current ratio.
- Raise the Port has no count limit (each one costs resources). Harbors are limited to 1 per player, 2 with Harbor empire.
- Raise the Port needs a city on the port, or a settlement once Fishing nets is researched. The Harbor always needs a city.
- The shared ratio function has a 2:1 floor. A Harbor gets a 1:1 exception. Market, War weariness and every other modifier keep the 2:1 floor.

**Lane identity**
- **Expansion** (bridge maxing, offshore play, wreck hunting, movement). Tempo: a power house in the early to mid game that fades at the end. Weakness: its income (wrecks and pirates) is capped and non-renewable, and the final payoff is a road that can be taken away. It gives no combat power, only resource drain. Counters to Grand Causeway: split the road with a settlement, a rickety bridge collapsing on a 7, or a longer road.
- **Industrial** (harbor and fishing). Tempo: less mobile and slower to start, with more production and efficiency, strong late. Weakness: nets and harbors are fixed in place. Counters: with Warlords on, knights and the robber on a harbor tile stop its trading, and Blockade drops its ratio.

**Notes**
- Grand Causeway swing: the holder gains 16 VP, a player who takes the title without the tech gains 2, so losing it is a 14 VP swing. It is public VP, so Taxes, Catch-up and the bot leaderCutoff react at once. Check this in a 25 VP sim.
- Nodes beyond the root only show when Tidebound is on (section 1). Bridges, nets, wrecks, pirates and fish are Tidebound addons that must exist before tiers 2 to 4 can work, so build these nodes after Tidebound (`Ideas.md` build order, step 3).

**Code impact for the next agent**
1. Root: the step 6 build upgrades one chosen resource (`harborCharterModifier` in `techEffects.ts`, `upgrade_port` in `actions/techActions.ts`, the Harbor controls in `techpanel.ts` and `tests/techroots.test.ts`). Change it to a whole-port 3:1 to 2:1 upgrade with no resource choice.
2. Port state: `g.ext.core.portUpgrades[vertexId]` holds a resource today. It becomes a level per vertex (raised, harbor).
3. Ratio function (`shared/tradeRatio.ts`): a 1:1 floor for harbors only.
4. Port upgrade check: read `hasTech` for Fishing nets to allow a settlement.
5. Tech panel: draw the fork (section 7).
6. Add an optional `path` ('expansion' or 'industrial') to `TechDef` and `TechRowView`, used for the lane label in the tooltip.

---

## 9. Open questions

1. **Five levels or four tiers.** The Tidebound drawing has a root plus four nodes per lane, which is five levels. There are four tiers, so tier 3 holds two nodes in a row (3a, 3b). Alternatives: merge 3a and 3b into one node, or allow five tiers. - Author note: Both. The base counts as 1 tier/level, dlc tiers are added on top of the base. Think of it as a vent diagram, with base research both belonging to base game and dlc, while tier 2 to 5 is dlc unique only. 
2. **Does the tree gate the DLC content?** Assumed yes: with the tree on, rickety bridges, fishing nets, feeding and the Harbor only exist after their tech. With the tree off they are available from the start as normal Tidebound addons.
3. **Port ladder reading.** Assumed: each upgrade lowers a port one step, the Harbor works on any port, and the settlement-only rule covers only the 3:1 to 2:1 upgrade and sits on Fishing nets (move it to Net works if it is too strong early).
4. **Soft lock.** Is rising price enough to keep a player in one lane, or add a surcharge (for example +2 cards at tiers 3 and 4 if you own a node in the other lane)?
5. **Price at 25+ VP.** At 25 or more VP, building value V reaches 25 to 35, so `ceil(V / 3)` alone is 9 to 12 cards, more than a whole tier 1 price band. Suggest the divisor scales with `vpToWin`, for example `round(0.3 x vpToWin)` (3 at 10 VP, 8 at 25 VP). Retune in the sim matrix.

---

## 10. Later (not locked)

The other four branches (each a root plus two lanes, written like section 8), a free starting tech setting, techs that need another branch, a second robber move.
