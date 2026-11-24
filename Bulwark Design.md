# Bulwark Design

Decided with the user on 2026-11-24, in chat, question by question. This is the spec for building the Bulwark DLC. Read `CLAUDE.md` first: content goes through `PackApi` inside addons, the bot brain names no Bulwark content, no `g.rng` draws in addon code, and the layer rules apply (Bulwark and Tidebound never import each other; a cross-DLC effect goes through a shared hook).

Bulwark is the player-against-player DLC: territory, tax, gates, rebellion and castles. Tidebound was the board against everyone.

## Scope

**In the first version:** castle, walls and zone control, tax, wall tiers (palisade and stone), wall decay and rot, gatehouse with rebellion, the elevation bonus inside zones, two event cards, bots, a placeholder tech branch.

**Not yet:** Siege and Castle sieges (they need the Warlords strength model), the siege wall tier, zones in the lobby map preview. Take `bulwark.siege` and `bulwark.castle_sieges` out of the lobby list until Warlords.

**Build order:** castle first (small, standalone), then walls and zones, then tiers, decay and rot, then the gatehouse, then events, bots and the tech placeholder.

## Castle

- The step after city: settlement, city, castle. Built as an upgrade of your own city.
- Cost: 1 of each resource + 1 wheat + 2 ore + 1 brick (9 cards; a city is 5).
- Produces **4x** (4 cards per hit). Worth **3 VP**, public.
- Limit: 2 per player before the doubled price (the usual cap rule, scaled the usual way).
- Risk built in: 4 cards per hit pushes the hand toward the discard limit, and the castle is the robber's favourite target.
- A rival's castle inside your zone is taxed at **half** the normal rate (see Tax). Your own castle inside your own zone is never taxed (nothing is).

## Walls

- **A wall piece sits on an edge** and replaces the road slot there. Wall is wall, road is road: a road can never sit on a wall edge, and wall pieces never count toward Longest Road.
- **No buildings on the wall.** No settlement, city or castle may sit on a corner of a wall piece. The wall is wall all the way round. Only a gate may sit on a wall corner.
- **Spawned by the map.** With Bulwark on, the map generator places wall rings as a perk:
  - never a single zone: at least 4 zones on any map that has walls, more as the radius grows (starting guess: 4 at radius 4, +1 for every 2 radius);
  - a mix of complete and broken rings (about 1 in 3 broken);
  - each zone holds 3 to 7 land tiles at small radius, growing with the radius;
  - no walls below radius 4;
  - rings go on land with average or better numbers, never touch the map edge, and keep at least 2 tiles of outside land around them;
  - when the map has no good spot, the generator may move number tokens so ring land is average or better (Bulwark on only).
- **Built by players, but only from an existing wall.** A new piece must touch an existing wall piece at a corner, so walls grow outward slowly. You may build on a wall only if you have at least a settlement inside its zone.
- **Cost:** palisade 1 wood + 1 brick. Cap **12** per player before the doubled price, scaled with map radius like roads.
- **A player-built wall can close a brand-new zone** if the new ring holds 3 or more land tiles.

## Zones

- **A complete zone** is the land enclosed by a closed wall ring, sea edges included. A coastal zone must wall its sea edges too, which is why it is expensive.
- **A broken wall's zone** is the wall line plus a straight line joining its two open ends: everything inside that shape (the user's sketch). On the hex grid, the joining line is a row of hexes between the two end corners. Rings spawned broken in several places use the outline they were planned with.
- **The UI highlights the tiles that would be inside if the wall closed now.** No faint outline for missing pieces, so nobody thinks they have to close it along a given path.
- **An incomplete zone** shows the red incomplete tint up to the opening. Anyone may build inside it.
- **Control:** whoever has the most public VP from buildings inside a complete zone controls it.
  - **Tie when closing:** the player who places the last wall piece wins the tie.
  - **Rebellion:** when a guest's local public VP passes the controller's, an "Overthrown!" title card shows, and control, tax rights, the wall pieces, the gate and repair duty all pass to them at once. A tie keeps the current controller.
- **Building inside a complete zone:** only the controller, and players with a permit (see Gatehouse).
- **Roads:** only through an open gate, or a closed gate you hold a permit for.
- **Starting placement:** your first two settlements may go inside a complete spawned zone. Whoever settles there first starts as controller; the second player inside becomes a taxed guest.
- **Robber:** normal rules inside zones (revisit with Warlords).
- **No upkeep** for controlling a zone. Repairs are the cost.

## Tax

- A guest (any non-controller with buildings in a complete zone) pays **30%** of what they produce inside it, with no randomness:
  - each guest has a tax meter per zone; every card they produce inside adds 0.3;
  - each time the meter reaches 1, one of the cards just produced goes to the controller and the meter drops by 1;
  - over a game that is exactly 30%, and the meter is shown so everyone sees the next tax coming.
- Examples: a settlement (1 card a hit) is taxed on the 4th hit, then about every 3rd. A city (2 cards) on its 2nd hit. A castle (4 cards) adds 1.2 a hit; a rival's castle counts half (0.15 per card).
- Tax pauses while the zone is broken.
- A prompt or log line says when tax is taken. Use a derived stream if any tie-break ever needs randomness; never `g.rng`.

## Wall tiers, decay and rot

- **Palisade:** durability 3. Repair costs 1 wood and restores full durability.
- **Stone:** upgrade a palisade for 2 brick + 1 ore. Permanent: no decay, no rot.
- **Decay:** every palisade loses 1 durability on every 7.
- **Rot (with Tidebound):** a palisade piece next to a flooded tile loses 1 durability each round the tide is up.
- **Breaking:** at 0 the piece is gone, the zone opens, control and tax pause, and the incomplete red tint returns until it is repaired or rebuilt. An amber crack warning shows the round before a piece breaks.

## Elevation bonus (with Tidebound)

- Every tile inside a **complete** zone counts **+1 elevation**, so it can reach 4, which no tide reaches. A broken zone loses the bonus until it is repaired.
- This replaces the earlier Sea wall idea (walls blocking water edge by edge). Keep it simple: a zone just raises its land.
- Code: Tidebound reads elevation through a shared hook (for example an elevation modifier registry in `src/shared`) that Bulwark answers. Neither pack imports the other.

## Gatehouse

- **A gate sits on a corner of the wall,** placed like a settlement but with its own distinctive sprite, in an open and a closed version.
- **It turns one of the two wall edges beside it into a gateway arch.** Roads may run through the arch; the wall still counts as closed.
- A gate may sit on a corner next to a settlement (no distance rule for gates). It is the only thing that may sit on a wall corner.
- Cost: 2 brick + 1 ore.
- **Open:** anyone may pass. **Closed:** only permit holders may pass. The state can only be switched on the owner's turn, and the zone tint shows it (pattern as well as colour).
- **Permits** are set by the controller and are **free**. Taxes are already the price of being a guest.
- **Longest Road:** a closed gate breaks every other player's road through it ("that ain't your road no more"). The owner's road passes. An open gate passes everyone.

## Event cards (Event Deck)

Values are ranges, drawn from the deck's seeded stream:
- **Palisade fire:** each palisade loses 1 to 2 durability (drawn per piece).
- **Peasant revolt:** in the biggest zone the tax meters reset, and guests skip 1 to 3 taxes (drawn per event).

## Bots

Through `BotGoalDef` hooks only:
- score zones by production times tax;
- finish walls they can win;
- repair palisades at 1 durability;
- wall off rivals only at Secondary tier and up;
- use castles (the generic planner can value them from cost and VP; avoid tiles the robber is likely to sit on).

## Tech branch

Placeholder for now: a Bulwark branch after the existing root (Stockpiling). The lanes and nodes get their own session (working names: Fortress for walls, stone and gates; Crown for castles, tax and permits).

## As built (2026-11-24)

- **Files:** `src/packs/bulwark/`: `castle.ts`, `walls.ts` (wall piece, placement rules, tax meter, Peasant revolt, view, zone bot goal), `zones.ts` (state, geometry, control, rebellion, would-be-inside tiles, the gate Longest Road rule), `spawn.ts` (map planning and game-start walls), `wallTiers.ts`, `wallDecay.ts` (decay, rot, fire, repair), `gatehouse.ts`, `highGround.ts`. Client: `client/render/bulwark.ts` (gates, arches, cracks, zone banners, the Overthrown card); the zone tints are drawn in `client/render/terrainCanvas.ts`.
- **Engine hooks added (generic):** `PLACEMENT_CHECKS` and `LONGEST_ROAD_BREAKS` (`shared/placementChecks.ts`), and `hex.ext.elevationBonus` read by `hexElevation`. Bulwark and Tidebound never import each other.
- **The map's rings are stone** (when the Stone walls addon is on). Bot simulations showed palisade rings (18 pieces, 3 durability, -1 on every 7) rot away within about five rounds and nobody can repair 18 pieces, so every zone was gone by mid-game. Decay, rot and fire now hit the palisades players build (gaps they close, rings they extend). Without the Stone walls addon the rings are palisades. Change it in `raiseSpawnedWalls` (`spawn.ts`) if you want the old rule.
- **Buttons:** Castle, Wall, Stone, Repair, Gate, Open/close and Permit all use the generic piece and action buttons (spots come from the server). Open/close: click your gate. Permit: click a guest's building inside your zone (click again to take it back).
- **Bots:** close a broken ring they would win, repair cracked palisades, build a gate in a zone they hold, keep it closed (Secondary and up), value corners by zone tax, build castles. In 4-bot sims at 25 VP every game finished; bots built 3 to 5 castles and gates in most held zones. Bots rarely settle as a guest in a zone someone already holds, so tax and rebellion seldom fire between bots (unit tests cover both).
- **Open gate:** anyone's roads may run inside the zone through it; buildings still need the lord or a permit.
- **Buttons only when useful:** Wall and Stone show to players with a building in a zone, Gate to a lord without a gate, Open/close to a gate holder, Permit to a lord with guests, Repair while a damaged palisade stands in your zone.
- **Checked:** island maps (Tidebound `island_clusters` + `wide_water`, radius 7 and 15) get 5 to 9 zones, coastal ones close and get the +1. Radius 30: a view ~20 ms, a bot decision ~35 ms.
- **Not verified:** a human clicking the Bulwark buttons in the browser (the server spots are tested; the browser was only watched as a spectator).
- **Not built:** Siege, Castle sieges and zones in the lobby map preview (left for later), the Bulwark tech lanes (the root Stockpiling is unchanged; lanes get their own session).

## Open numbers to tune in sims

Zone count and size by radius, the castle cost and 4x output against bank shortages, the wall cap of 12, palisade durability of 3, the tax rate of 30%, and the event ranges.
