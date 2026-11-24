# File Index

What every file does. Paths are relative to the repo root. Every source file starts with a `// MODULE: what | DEPENDS ON: a, b | USED BY: c, d` line (see `scripts/headers.mjs`; the two lists are generated, only the description is written by hand). The `src/` tables below are generated from those headers (description text only): run `npm run index` after you add, move, delete or re-describe a file; `tests/index.test.ts` fails when they are stale. To change a row, edit the file's header, never the table. The Root, Docs and `tests/` tables are still hand-written.

## Root

| File | What it does |
|---|---|
| `package.json` | Scripts (`dev`, `build`, `start`, `typecheck`, `test`); depends on express and socket.io |
| `esbuild.config.mjs` | Bundles `src/server/main.ts` to `dist/main.js` and `src/client/main.ts` to `dist/public/app.js`; copies `public/` and `styles.css`; `--watch` restarts the server |
| `tsconfig.json` | TypeScript settings for `src` and `tests` (`strict` off) |
| `vitest.config.ts` | Test runner settings: the defaults, minus `retired/` |
| `retired/` | Retired files kept for reference with a `[del.]` prefix (not compiled, not run): the old pirate board layer, pirate icon and their tests, the old wreck tests, the old cluster-schedule tide tests |
| `Dockerfile`, `.dockerignore` | Two-stage Node 20 image, runs `dist/main.js` on port 3000 |
| `render.yaml` | Render host (Singapore, free plan, health check `/health`, auto deploy) |
| `.env.example` | Environment variables (`PORT`) |
| `public/index.html` | The single HTML page: name page, setup page, lobby, board, menus |
| `data/bot_training_logs.jsonl` | Bot training data written by `bots/trainingLog.ts` |
| `data/bots/_schema.md` | S0.15 cross-game bot memory & player profile JSON schema, caps, and Render portable code spec |
| `scripts/addons.mjs` | Addon list generator (`npm run addons`; `npm run addons:check` fails if stale). Scans `src/packs/<dlc>/*.ts` for exported `AddonDef` objects, validates pack prefixes, missing deps and cycles, and writes `src/packs/<dlc>/addons.generated.ts` in deterministic dependency order |
| `scripts/mindmap.mjs` | Concept-map check. Compares the `owns` blocks of `ARCHITECTURE.md` with the `src/` rows of this file (`npm run mindmap`; `npm run mindmap:check` fails when a file is unowned, claimed twice or gone) |
| `scripts/index.mjs` | Index tool. Rewrites the `src/` tables in this file from the `// MODULE:` descriptions (`npm run index`; `npm run index:check` fails if they are stale). Sections and headings are listed in `SECTIONS` at the top of the script |
| `scripts/headers.mjs` | Header tool. Every `src/**/*.ts` file starts with `// MODULE: what \| DEPENDS ON: a, b \| USED BY: c, d`. You write only the text; the two lists are computed from imports. `npm run headers` reports, `headers:write` fixes, `headers:check` is the CI form (`-- --strict` also fails on stale lists) |

## Docs

| File                       | What it holds                                      |
| -------------------------- | -------------------------------------------------- |
| `README.md`                | Overview, quick start, layout                      |
| `change log.md`            | What changed, pass by pass                         |
| `Ideas.md`                 | Idea dump                                          |
| `Development Plan.md`      | Stage 0 build plan (services, order, decisions)    |
| `Bulwark Design.md` | Bulwark DLC spec decided 2026-11-24: castle, walls and zones, 30% tax meter, palisade and stone, decay and rot, elevation +1 inside zones, gatehouse and rebellion, events, bots |
| `Map Generation Design.md` | Map generator design (recipes, stages, validation) |
| `Bot AI Design.md`         | Bot tiers and brain design                         |
| `Bot Dialogue Design.md`   | Bot chat design                                    |
| `Design UI Philosophy.md`  | Visual direction and design tokens                 |
| `Tech Tree Design.md`      | Locked spec for the 5 root techs, per-player building-value cost formula, and per-tech hooks |
| `ARCHITECTURE.md` | Concept map: tile, world generation, engine, packs, views, server, bots, client, and which `src/` files belong to each (checked against this file by `npm run mindmap:check`) |
| `Spot Actions Rework.md` | Plan to move ground work, harbor upgrade and feed the sea (and nets) onto the generic spot and `act` path: findings, steps, tests |
| `ROUTER.md` | One page: task kind to the files to open and the file to copy as a pattern (read this first before changing code) |
| `EXTENSION POINTS.md` | One line per `PackApi` method, hook and keyed registry (`COST_MODS`, `BOT_GOALS`, `SEVEN_STEPS`, ...) with signatures and defining files |
| `BUGS/Bug Report Template.md` | The 5-field bug report to paste to the AI (what I saw, expected, actual, repro), the AI's triage rules and its fix-report shape |
| `RECIPES.md` | Five step-by-step recipes (new piece, action, addon, tech node, client overlay): files to touch in order, the real file to copy, where hand-written glue still is |
| `CLAUDE.md` | Instructions for Claude Code: read `ROUTER.md` first, never read whole folders, search for a symbol first, layer rules, the commands to run after a change |
| `.claude/skills/impeccable/` | The Impeccable design skill (Apache 2.0, copied from pbakaus/impeccable without its hook): `/impeccable critique`, `distill`, `polish` and so on. `Design UI Philosophy.md` wins where they disagree (flat, matte, one accent) |

## `src/shared/` (pure engine: no sockets, DOM or timers; runs on server and client)

| File | What it does |
|---|---|
| `index.ts` | public entry of the shared engine |
| `addons.ts` | DLC and addon manifest (types, General service ids, enabled-set resolution, link audit) |
| `botGoals.ts` | bot goal registry (Service 18 — S0.14; lets addons publish bot goals, vertex/edge deltas, action scores, and threat deltas) |
| `coreServices.ts` | S0.9 Marker system (10), Ledger (13), Strength & defense model (9), Relations matrix (14) |
| `ctx.ts` | action context (state + registry + event/log emitters) |
| `engine.ts` | game engine (createGame, dispatch pipeline, legal actions, awards, win check) |
| `eventDeck.ts` | S0.11 seeded event deck (service 16: `event-deck`, base + DLC cards, top-card preview, fate token veto/uphold, derived RNG stream) |
| `history.ts` | S0.10 public history ring buffer, change log, and stats registry (service 15: `history`) |
| `mapcells.ts` | per-cell data for terrain and number styles (height, moisture, coast distance, landmass) and neighbour lists |
| `mapcheck.ts` | board checks (landmasses, lakes, usable spots, fairness, MapReport) |
| `mapgen.ts` | board generator (staged pipeline: shape, terrain, numbers, extras, ports; plus the old generateBoard) driven by the registry |
| `mapmix.ts` | island resource mix (terrain fix-up: every landmass of 4 or more tiles gets at least two resource types) |
| `mapoptions.ts` | map option definitions (shape ops, terrain and number styles, perks, quick starts), generator flags, pick resolution |
| `maprecipe.ts` | map recipe (seed + radius + picks + params), share code, per-stage RNG streams, GEN_VERSION |
| `mapshape.ts` | land field for the shape stage (heightfield, cleanup, exact count fix, blob growth, retry loop) |
| `mapterrain.ts` | terrain placement algorithms (swap energy for spread and clustered, habitat fit for realistic) |
| `noise.ts` | seeded lattice value noise (integer hash, only + - * / and floor, so a saved seed gives the same map on any engine) |
| `numbers.ts` | number tokens (real-game pool, scaled to any board size, red numbers never touch) |
| `palette.ts` | player colors and avatars |
| `placementChecks.ts` | placement vetoes and Longest Road breaks (generic extension points: an addon can forbid a piece on a spot, or break a road at a corner, without the base rules naming it) |
| `pricing.ts` | piece cost and limit service (placed counts, base limit with doubled cost above it, registered cost modifiers) |
| `production.ts` | S0.6 production pipeline (service 6: ordered stages for number shift, tile state, base yield, piece multiplier, wild token, tax, bank-short, discard check) |
| `registry.ts` | registry + pack loader (all game content is registered here) |
| `rng.ts` | seeded RNG (mulberry32), state is plain JSON |
| `sevenResolver.ts` | S0.8 Seven Resolver (service 17: ordered pipeline for discard, karaoke, robber, volcano, decay with max DLC side-effects cap) |
| `stage1.ts` | Stage 1 General features (Taxes & Catch-up levers, Public Contract Board & Rarity Tiers, Spies & Intel Ladder, Tech Tree with Empire-Size Pricing, Local Nemesis & Round Recap, Proving-Ground Content & Sandbox Economy) |
| `state.ts` | engine helpers (players, bank, costs, phases, production, VP, turn start) |
| `tileState.ts` | S0.7 tile state layer (service 7), durability & repair (service 8), and wild token (service 12) |
| `topology.ts` | pure hex-grid topology (vertices, edges, ports, robber start) |
| `tradeRatio.ts` | trade ratio service (ratioFor with ordered modifier chain, 2:1 floor, gem-port floor exemption, harbor-only 1:1 pass, idle-port checks, invalid-ratio advice) |
| `types.ts` | core engine types (game state, board, players, rules) |
| `viewData.ts` | view data registry (VIEW_DATA: a piece or addon adds public fields, tile overlays, per-player fields and VP breakdown bonuses to the state the client gets, from its own file) |
| `views.ts` | per-player filtered view of the game state (hides other hands, hidden tiles, dev cards) |
| `visual.ts` | visual manifest types (what a piece, action or overlay kind looks like, as plain data the server sends to the client; no functions) |
| `visualManifest.ts` | builds the visual manifest from a registry (pieces, actions and overlay kinds with a visual) and checks visuals for unsafe markup and non-JSON values |

## `src/packs/` (game content registered as packs; load order: base, gold, fog, tidebound)

| File | What it does |
|---|---|
| `index.ts` | pack list entry point |
| `_template/index.ts` | template pack (loads the template addon so a test can build a registry from it; not in allPacks, so nothing ships) |
| `_template/addons.generated.ts` | generated addon list for template (dependency-ordered by scripts/addons.mjs; do not edit by hand) |
| `_template/demo.ts` | template addon (copy this file to start a new addon: one vertex piece, one action, one tech node, a bot goal stub, a client view function; not part of any shipped pack) |
| `_template/lantern.ts` | template lantern addon (R9 proof piece: a one-file vertex piece with a visual, a score and a bot goal; needs no edit outside this file and its test) |
| `base/index.ts` | base game pack (resources, tiles, pieces, dev cards, awards, ports, presets, phases, actions) |
| `base/actions/index.ts` | registers every base action |
| `base/actions/bankTrade.ts` | action "bank_trade" (4:1 or better with ports; registry resources only) |
| `base/actions/build.ts` | action "build" (any registered piece, setup or paid, free roads) |
| `base/actions/devCards.ts` | actions "buy_dev" and "play_dev" (dev cards are looked up in the registry) |
| `base/actions/endTurn.ts` | action "end_turn" (new dev cards become playable, next player rolls) |
| `base/actions/owed.ts` | actions "discard" and "pick" (resources owed after a seven / gold / Year of Plenty); a discard may also give up held wild tokens that count toward the hand (fish) |
| `base/actions/research.ts` | action "research_tech" (spend wheat + ore on a tech; the rules live in shared/stage1.ts) |
| `base/actions/robber.ts` | actions "move_robber" and "steal" (victim choice when 2+ players are on the hex) |
| `base/actions/roll.ts` | action "roll" (seeded dice, production, seven -> Seven Resolver pipeline) |
| `base/actions/techActions.ts` | actions "upgrade_port" (Tidebound Harbor charters: raise a whole port 3:1 to 2:1) and "convert_tile" (Wild Earth Ground work) |
| `base/actions/tradeOffers.ts` | actions "propose_trade", "respond_trade", "counter_trade", "confirm_trade", "cancel_trade" (player-to-player trading) |
| `base/awards.ts` | awards (Longest Road, Largest Army) |
| `base/building.ts` | build validation and piece placement (cost, supply, upgrade, onBuild hooks) |
| `base/constants.ts` | ids and small maps shared inside the base pack |
| `base/content.ts` | base resources and tiles (wood, brick, sheep, wheat, ore, desert, water) |
| `base/devcards.ts` | base development cards (knight, victory point, road building, year of plenty, monopoly) |
| `base/eventTimelineView.ts` | event timeline view (shared field `eventTimeline` while the Event Deck is on: the next events with the rounds they fire in, and the last one that fired) |
| `base/hooks.ts` | base hooks (game start state, S0.10 per-pack stats handler, round hooks, pick settling and trade pruning) |
| `base/longestRoad.ts` | longest road metric (DFS over a player's roads and road-like edge pieces, blocked by opponent pieces) |
| `base/map/index.ts` | base map content (hexagon shape, random terrain, standard numbers, Standard and Blank quick starts) |
| `base/map/clusters.ts` | island clusters (the Tidebound default map shape: island sizes 4 to 20 drawn about 65% small, 25% medium, 10% large; islands grouped in clusters that merge when they meet; 1 or 2 tiles of water inside a cluster, at least 3 between clusters) |
| `base/map/numbers.ts` | base number styles (balanced; `standard` lives in index.ts) |
| `base/map/shapes.ts` | base map shapes (continent, ring, islands, archipelago, continents; lake, river, satellites, ragged) |
| `base/map/terrain.ts` | base terrain styles (spread, clustered, realistic; `random` lives in index.ts) |
| `base/phases.ts` | base phases (setup, roll, main, discard, robber, robber steal, pick, game over) |
| `base/picks.ts` | pending picks (gold, Year of Plenty) -> enters/leaves the pick phase, empties picks when the bank is dry |
| `base/pieces.ts` | base pieces (road, settlement, city) |
| `base/piecesView.ts` | generic per-player piece and action view data (R8.6: pieces[id] = { left, cost, spots } for every PieceDef and ActionDef with a visual) |
| `base/placement.ts` | piece placement rules (settlement, road, city geometry/ownership) |
| `base/ports.ts` | base ports and map presets (standard, blank, archipelago) |
| `base/robbing.ts` | robber helpers (victims on a hex, random steal using the seeded RNG, steal-count modifiers, what set the robber off); a steal can also take a held wild token that is `stealable` (fish) |
| `base/setup.ts` | setup flow (snake order, second-round resources, hand-off to the first turn) |
| `base/techEffects.ts` | effects of the 5 root techs (Stockpiling, Road levy, Harbor charters = raise a whole port 3:1 to 2:1, Plunder, Ground work): modifiers, state helpers, and the lists the tech panel shows |
| `base/techRoots.ts` | the 5 root techs of the tech tree (one per DLC branch, base-tier so they never need their DLC) and their effects |
| `base/trading.ts` | trade helpers (bank ratios from ratioFor service, resource parsing, multi-offer stack, player trade execution) |
| `bulwark/index.ts` | bulwark pack (DLC: castle, walls and zones with tax and rebellion, stone walls, wall decay and rot, gatehouse with permits, high ground; spec in Bulwark Design.md) |
| `bulwark/addons.generated.ts` | generated addon list for bulwark (dependency-ordered by scripts/addons.mjs; do not edit by hand) |
| `bulwark/castle.ts` | bulwark.castle addon (the step after a city: 9 cards, 4x production, 3 public VP, 2 before the doubled price; the robber's favourite target; a bot goal to build one) |
| `bulwark/constants.ts` | Bulwark ids and numbers (piece ids, action ids, prices, durability, tax rate, zone sizes; spec in Bulwark Design.md) |
| `bulwark/gatehouse.ts` | bulwark.gatehouse addon (a gate on a wall corner turns one wall edge beside it into a gateway arch roads can pass; open lets anyone through, closed only the lord and permit holders; free permits by clicking a guest's building; a closed gate cuts other players' Longest Road; bots build a gate to get out and keep it closed) |
| `bulwark/highGround.ts` | bulwark.high_ground addon (land inside a finished wall zone counts +1 elevation, through the generic `ext.elevationBonus` tides and rising sea read; a broken zone loses it; replaces the old Sea wall idea) |
| `bulwark/spawn.ts` | Bulwark map spawn (plans walled zones while the map generates: count and size grow with the radius, never a lone zone, a mix of whole and broken rings, good numbers moved in when needed; then puts the walls up at game start, broken rings with 1 or 2 gaps) |
| `bulwark/wallDecay.ts` | bulwark.wall_decay addon (palisades have 3 durability: each 7 takes 1, each round a tide floods a tile next to one takes 1 (rot), the Palisade fire event takes 1 to 2; at 0 the piece is gone and the zone opens; repair for 1 wood back to full; bots repair at 1) |
| `bulwark/wallTiers.ts` | bulwark.wall_tiers addon (stone: a palisade upgrade for 2 brick + 1 ore that never decays or rots; only a player with a building inside one of its zones may upgrade it) |
| `bulwark/walls.ts` | bulwark.walls addon (wall rings the map spawns, palisade wall pieces players extend from an existing wall, zones and control by public VP, rebellion, building only for the lord and permit holders, the 30% tax meter, the Peasant revolt event, the client view and the zone bot goal) |
| `bulwark/zones.ts` | Bulwark zone state and board geometry (wall edges, gate arches, zone records, enclosure flood, interior corners, controllers, rebellion, the would-be-inside tiles of an open wall, the elevation bonus) |
| `fog/index.ts` | fog pack (hidden tiles, revealed by building next to them, Fog Island preset) |
| `gold/index.ts` | gold pack (gold tile = pick-a-resource on production, Gold Rush preset) |
| `tidebound/index.ts` | tidebound pack (DLC: 8 addons with links; T1 sea tiles, T2 wide water + sea data, T3 bridges, T4 rickety bridges, T5a tides schedule, T5b spring tide, T5c tide level, T5d elevation, T5e idle ports, T6 tide view for the client, T7a fish token, T7b1 fishing nets, T7b2 net spots + net bot goal, T7c fish icon boosts, T7d tide replenish, T7e feed the sea, T8a harbor 1:1 upgrade, T8b 4 trades/turn + invalid-ratio prompt, T9 wrecks, T10 pirates, T11 tech tree nodes & gates, T12 rising sea lowest-elevation drowning & rate settings) |
| `tidebound/addons.generated.ts` | generated addon list for tidebound (dependency-ordered by scripts/addons.mjs; do not edit by hand) |
| `tidebound/bridgeConsts.ts` | tidebound bridge constants (leaf module with no imports, so bridges.ts and ricketyBridges.ts can both read them at load time without a circular-import hole) |
| `tidebound/bridgeCore.ts` | bridge placement rule, Bridge piece def and bridge bot goal (the base of the bridge addons, so rickety bridges need not import bridges.ts) |
| `tidebound/bridges.ts` | tidebound.bridges addon (wide-water map perk + T3 Bridge piece, ocean placement rule, 2x cost past 10 or 14 with Rickety bridges tech, Longest Road, bot goal, T11f demolish_bridge action & Grand Causeway 6 VP hook) |
| `tidebound/fishing.ts` | tidebound.fishing addon (T7a fish wild token: spend action, counts for a 7 discard, can be stolen, never in the bank; T7b1 fishing net rework: one net sits on one sea tile (`hex.ext.net`, `place_net` action), coast placement rule, catch on every roll; T7b2 net tiles for the client view and the net bot goal; T7c fish icon boosts: a net on a tile with boosts left doubles its catch chance and the tile loses one boost per catch; T7d tide replenish: tides refill icons slowly, a deeper tide faster; T7e feed the sea: 1 wheat fills the ground under your net; T11c/d/e tech gates & Net works) |
| `tidebound/harbor.ts` | tidebound.harbor addon (T8a: 1:1 port upgrade on a city, limit 1 per player or 2 with Harbor empire, works while flooded, minimal bot goal; T8b: max 4 1:1 trades per turn per harbor, falls back to 2:1 for the rest of the turn, invalid-ratio prompt explains harbors; T11e Harbor master tech gate) |
| `tidebound/pirates.ts` | tidebound.pirates addon (pirate raid event in the Event Deck, 2026-11-24 rework: every player at once compares their played knights with the pirates' strength; equal or more wins loot scaled by strength and round, fewer loses 2 random cards; Pirate hunter +2 knights and +1 loot; no pirate pieces on the board any more, old ones are cleared; bots want knights before a raid) |
| `tidebound/ricketyBridges.ts` | tidebound.rickety_bridges addon (T4a rickety bridge piece: 1 wood, health 1, shared pool and shared 2x cost with bridges, bot goal; T4b upgrade to a full bridge; T4d collapse on a 7 in Seven Resolver; T4e Longest Road recalc; T11c tech gate + +4 bridge cap bonus) |
| `tidebound/risingSea.ts` | tidebound.rising_sea addon (T12a: coast-inward drowning of the lowest elevation land tiles first using a derived RNG stream, `drowned` tile state blocking production and robber, and idle checks for submerged non-harbor ports; T12b: works standalone or alongside Tides, `risingSeaLevel` 1-5 rate settings, and drowned tile client overlays; T13a: rising-sea drowning exposure in scoreVertex) |
| `tidebound/seaData.ts` | Tidebound map data (elevation 1 to 3 on land, seeded fish icons on sea tiles), written by the wide_water perk |
| `tidebound/seaEvents.ts` | Tidebound sea event helpers (a seeded stream per event and round, random resources from the bank, card lists for the log; shared by the shipwreck, pirate and tide events) |
| `tidebound/tech.ts` | Tidebound tech tree nodes (T11a-T11f: 8 extension nodes across Expansion & Industrial paths, techGate re-export, Grand Causeway 6 VP hook, Harbor Empire ceil(V/2) bank card grant) |
| `tidebound/tides.ts` | tidebound.tides addon (2026-11-24 rework: the tide is an Event Deck card that picks a height 1 to 3 and a duration of 2 to 5 rounds; every land tile joined to the coast through tiles no higher than the height floods at once; a tide during a tide rises 1 and keeps the longer time left; it retreats when its rounds are over; the Tide level slider sets how many tide cards are in the deck; the `flooded` tile state, ports idle while flooded, the one-turn warning, the title card facts, overlays, elevation data and flood exposure for bots) |
| `tidebound/wrecks.ts` | tidebound.wrecks addon (shipwreck event in the Event Deck, 2026-11-24 rework: every player rolls a d20 and salvages 2 to 6 random resources from the bank by the roll, +1 with Salvage crew; no wreck pieces on the board any more, old ones are cleared; the Salvage crew demolish-bridge bot score) |

## `src/server/` (thin adapter over the engine, plus bots)

| File | What it does |
|---|---|
| `debug.ts` | server debug mode (sandbox grants, forced dice rolls, board piece brush, state/award/supply invariant auditor, and repro snapshot exporter) |
| `game.ts` | game runner (start/rematch, dispatch one action, turn engine events into client effects) |
| `lobby.ts` | lobby board tools (generate from a recipe, quick starts, settings merge, paint terrain/numbers/robber/ports) on the engine board |
| `main.ts` | server entry (Express and Socket.io, /health, bot training log endpoints, serves the client) |
| `mapmenu.ts` | map menu data (the registry's map options, quick starts, DLC/addon catalog and scenarios as plain JSON) |
| `net.ts` | socket broadcast (sends each human player their own view, clears one-shot effects, wakes the bots) |
| `persistence.ts` | S0.15 cross-game bot memory & player profile persistence (Service 19; JSON disk store + portable base64url export/import for Render free tier) |
| `presets.ts` | custom map presets (the lobby map as plain JSON: save, validate, rebuild) |
| `rooms.ts` | rooms (registry of rooms, lobby roster, status, helpers over the engine game) |
| `runtime.ts` | engine runtime for the server (registry, settings -> rules mapping, defaults) |
| `socket.ts` | socket handlers (lobby editing + game actions; every game action goes through engine dispatch) |
| `turnClock.ts` | per-turn clock for human players (base time per turn, plus an increment for each completed action) |
| `turnHistory.ts` | Turn history recorder & round summarizer |
| `types.ts` | server room types (lobby settings, room, client-facing effects) |
| `util.ts` | small pure helpers (clamp, pips) |
| `view.ts` | client state builder (engine state -> the `gameState` shape the current client renders) |

### `src/server/bots/`

| File | What it does |
|---|---|
| `brain.ts` | bot brain (pure: game state -> the one action a bot wants to take; reads the bot's tier, the map profile and grudges; no timers, no sockets) |
| `dialogue.ts` | bot dialogue (re-export, the engine lives in bots/dialogue/) |
| `dialogue/index.ts` | bot dialogue entry (engine events -> chat lines, game start, replies to human chat) |
| `dialogue/context.ts` | builds the public-only DialogueCtx a line is filled from (no hidden information is read here) |
| `dialogue/engine.ts` | dialogue engine (filter, weighted pick, repeat memory, slot fill, alternation, rate limit, chat post) |
| `dialogue/events.ts` | dialogue event table (chance, major flag, allowed slots, private-risk set, chat levels) |
| `dialogue/lines/index.ts` | all dialogue lines, plus which (event, style) pairs are silent on purpose |
| `dialogue/lines/awards.ts` | dialogue lines for awards and the score race |
| `dialogue/lines/build.ts` | dialogue lines for building and development cards |
| `dialogue/lines/robber.ts` | dialogue lines for the robber (moved onto a bot, placed by a bot) and steals |
| `dialogue/lines/roll.ts` | dialogue lines for dice results (sevens, discards, good and dry rolls) |
| `dialogue/lines/table.ts` | dialogue lines for the start and end of a game, the map, fog reveals and replies to human chat |
| `dialogue/lines/tidebound.ts` | dialogue lines for Tidebound DLC events (tides, bridges, harbors, nets, wrecks, pirates; public info only) |
| `dialogue/lines/trade.ts` | dialogue lines for trading and the bank |
| `dialogue/types.ts` | bot dialogue types (events, line data shape, public context) |
| `mapProfile.ts` | map profile (landmasses, fog and gold share, average pips, port count; built once per board, refreshed when fog is revealed) |
| `scheduler.ts` | bot scheduler (waits a game-speed-scaled delay, then lets one bot act, after every broadcast) |
| `sim.ts` | bot-vs-bot simulator (runs whole games without sockets or timers, checks invariants, tier ladder and S0.16 sim matrix) |
| `tiers.ts` | bot tier profiles (Main / Secondary / Overload), personalities, small hash helper |
| `trainingLog.ts` | AI bot training data logger (captures pre-action state features, legal action counts, chosen actions, and terminal VP/win rewards) |

## `src/client/` (browser client)

| File | What it does |
|---|---|
| `actions.ts` | client UI actions (host-only edit guard, build mode and brush selection, affordability checks, requests sent to the server) |
| `audio.ts` | WebAudio sound effects (tones, dice roll, discard, your turn, victory fanfare) and the sound toggle |
| `avatars.ts` | player avatars (flat pictogram faces keyed by the shared avatar id, falls back to the name initial) |
| `buildMenu.ts` | build menu model (BUG 5: which pieces a board corner or edge offers, with their price and whether you can pay; the cost tooltip markup, its delay, and where the popover sits; pure, no DOM) |
| `constants.ts` | resource and dev card metadata (names, token colors) |
| `cursors.ts` | lobby cursors and laser pointer (non-hosts cannot edit the map, they point at it instead) |
| `debug.ts` | client debug mode HUD, FPS/SVG node profiler, client-vs-server spot desync checker, sandbox controls, and board ID/icon-stress overlays |
| `fishSpend.ts` | fish spend picks (pure: how many cards a stack of fish buys, adding and removing picks within the bank's supply, the list to send) |
| `globals.d.ts` | type declaration for the global socket.io `io`, loaded by a script tag in index.html |
| `icons.ts` | flat resource pictograms, dev card glyphs, UI icons, piece shapes |
| `logFilter.ts` | live log filter matching (pure: splits a filter key and decides whether a turn action matches it) |
| `main.ts` | client entry point (wires DOM events, camera pan and zoom, and socket messages to the renderers) |
| `mapmenu.ts` | lobby map menu (summary line, option dropdown drawn from the server's option list, seed line, report, quick start chips) |
| `panPreview.ts` | drag-pan preview math (BUG 1: how much board lies off-screen at the last repaint, and whether a CSS-translated board would now show a gap, so it must repaint) |
| `pieceModel.ts` | generic piece UI model (R8.7: pure functions that turn the visual manifest and a player's `pieces[id]` data into buttons, badges, hints, recipe strips with their stacked cost cards, spots and shapes; no DOM, no socket, no store) |
| `pieceui.ts` | generic piece UI (R8.7: draws the build-bar buttons, the spot layer and the placed shapes of manifest pieces and actions, shows their hints and sends their clicks; the logic is in client/pieceModel) |
| `presets.ts` | custom map presets (list saved in this browser, preset row in the lobby dock) |
| `render/index.ts` | renderAll, draws every client panel (board, hand, sidebar, trade, tech, overlays) from the current state |
| `render/board.ts` | board SVG renderer, camera, board input and board animations |
| `render/bridgepicker.ts` | bridge picker (Tidebound T4c: type picker popup on an empty ocean edge, upgrade popup on your own rickety bridge, one popup that sits over the edge) |
| `render/buildmenu.ts` | build menu popover and cost tooltip (BUG 5: a click on a board hotspot opens a popover of the pieces that may go there; one cost tooltip, shown after a short hover or a long press, serves the popover and the build bar) |
| `render/drawer.ts` | bottom-left sheet (trade, discard, gold, monopoly, robber victim picker) |
| `render/eventTimeline.ts` | Event Deck timeline strip (the next events: icon, round and a detail such as a pirate's strength, under the round clock) and the title card when an event fires |
| `render/hand.ts` | player hand (resource stacks + dev cards) and hand click handlers |
| `render/overlay.ts` | S0.13 overlay and popup kit (Service 11: hex tint/pattern layer, timer-bar popups, dramatic event title card, round-end recap card; T6: theme-aware flood and flood-warning patterns, elevation heat map) |
| `render/setup.ts` | world setup page (host only, between the name page and the board): Players / World / Rules tabs, tile preview, roster, scenario cards, compact DLC rows, rule fold values |
| `render/sidebar.ts` | right sidebar (merged live log & turn history with RS card icons and click-to-filter, chat leaf, bank, player rows) |
| `render/techpanel.ts` | tech panel (hub-and-spoke tree: a hub, one ring of techs per tier, one spoke per branch, all generated from the server's `techTree` rows; costs as mini resource cards; hover for the description; plus the Harbor charters (raise a whole port to 2:1) and Ground work controls) and the Tech button in the action bar |
| `render/terrainCanvas.ts` | 2D canvas board renderer (full-board static atlas + crisp vector zoom for terrain, coastlines, ports, fish, overlays, and frustum-culled build spots) |
| `render/trade.ts` | active trade offer stack (top right), per-offer timers, trade responses and counter-offer editor |
| `render/turnclock.ts` | turn clock readout and countdown bar in the turn pill, plus the top-right ocean game timer & round number HUD |
| `socket.ts` | the single socket.io connection shared by all client modules |
| `store.ts` | shared mutable client UI state (game state, build and drawer modes, camera, selections) with setters |
| `techView.ts` | tech tree pan and zoom (pure view maths: clamp, zoom about a point, pan, and when the costs show) |
| `types.ts` | loose client-side view types (PlayerView, GameState, Resources) |
| `ui.ts` | small UI actions (theme switch, toast, victory confetti overlay) |
| `util.ts` | small client helpers (HTML escaping, initials) |
| `visuals.ts` | client copy of the visual manifest (set when the server's `visuals` event arrives, read by the renderers; empty before it arrives and when it never does) |

## `tests/` (node:test / tsx)

| File | What it covers |
|---|---|
| `rules.test.ts` | Engine rules, scaled bank and dev deck |
| `topology.test.ts` | Board topology and standard board |
| `ports.test.ts` | Port layout on hexagons |
| `presets.test.ts` | Custom preset save and load |
| `setuppage.test.ts` | World setup page flag and spectator mode; the Players / World / Rules tab markup (every settings control once, one "Save map as preset") and the rule fold titles (`ruleFoldValues`) |
| `numbers.test.ts` | Number token pool and placement |
| `bots.test.ts` | Bot tiers and the tier ladder |
| `dialogue.test.ts` | Bot dialogue engine and lines |
| `sim.test.ts` | Bot-vs-bot games on the standard, goldRush and fogIsland presets |
| `mapsims.test.ts` | Bot games on every map shape |
| `mapgen.test.ts` | Recipes, noise, validation, generator |
| `mapshapes.test.ts` | Shape ops, land counts, per-landmass ports |
| `maptiles.test.ts` | Terrain and number styles |
| `mapmix.test.ts` | `island_mix` perk, ring check, `GEN_VERSION` |
| `mapretry.test.ts` | Board retry loop and `degraded` flag |
| `mapsettings.test.ts` | Map settings and option resolution |
| `mapmenu.test.ts` | Map menu data and presets v2 |
| `mapbudget.test.ts` | Generation time budget |
| `addons.test.ts` | DLC and addon manifest, enabled sets, keyed registries, Rule of Two audit |
| `tidebound.test.ts` | Tidebound manifest (T0) and Bridges (T3a–T3e): 8 addons and links, lobby card data, DLC off changes nothing, bridge piece & ocean-only placement rule, cost & radius/VP scaling, 2x cost past 10, Longest Road across roads + bridges, `clientBoard` `pieceType`, and bot bridge building |
| `tideboundmap.test.ts` | T2a to T2c wide-water perk: registered only with the DLC, perk off = same map, canvas grows and land stays, island and continent gaps, wider river, warnings, helpers; `ext.elevation` and `ext.fish` data (counts, rarity, no draws, nothing without the pick) |
| `tideboundrickety.test.ts` | T4a to T4e rickety bridges: registration (on, off, rickety off), 1 wood cost and bridge placement rule, health 1, shared pool and supply mirror, pooled 2x cost, pool sync after a break, upgrade action (cost, refusals, double cost, legal list), bot build and bot upgrade, `bridgeUpgradeView` data, T4d collapse on a 7 in the Seven Resolver (`resolveSeven` and `roll` action, zero RNG draws, shared pool sync), and T4e Longest Road recalculation through the S0.10 change log (`pieceBroken` and `awardChanged` on loss, transfer, and ties) |
| `tideboundlobby.test.ts` | T2a2 lobby sees DLC map perks: room registry, per-room menu list, settings merge and share code follow the DLC toggles, lobby map, option list sent per socket |
| `tideboundtides.test.ts` | Tides as Event Deck cards (2026-11-24): the tide card (waves icon, copies = Tide level), nothing with the DLC, the addon or the deck off, height 1 to 3 and 2 to 5 rounds seeded by round, the flood rule (every tile joined to the coast through tiles no higher than the height; a low basin floods through a low channel and stays dry without one; fog blocks the water), rising at once, staying and retreating, stacking (+1 height, the longer time left, at most 3), other tile states untouched, the round clock, half yield, the robber, idle ports, the timeline detail, the one-turn warning (and none when the card is vetoed), the client view, no `g.rng`, old cluster saves cleared, the lobby slider, flood overlay kinds |
| `tideboundfishing.test.ts` | T7a fish token: registration (DLC off or Fishing off = no action, no state), `spend_fish` (bank, hand, refusals that keep the fish, legal list), a 7 counts fish and a discard can give fish up, the robber steals a fish, DLC-off steal pool unchanged, other players' fish hidden in `playerView` but counted in hand size, bot score |
| `tideboundnets.test.ts` | T7b1 fishing nets (net rework: one net on one sea tile, `hex.ext.net`, `place_net`): registration (DLC off or Fishing off = no action, no hook; the net is no piece), sea tiles at a vertex (by geometry on a lone island, none inland or in open water, river excluded), placement (a coast tile next to your own road or bridge, build phase only, one net per tile, no vertex taken so a port or another player's settlement does not block, needs a settlement or city of yours first), `place_net` (price into the bank, supply counted from tiles, refusals change nothing, legal list, 2x at the base limit), old saves with vertex nets moved onto a tile, the catch (about 1 in 6 per net, per owner, only the tile it sits on, fish icon doubles it and loses a boost, seeded, same under a flood, a real roll draws the same dice and `g.rng` with nets on the board) |
| `tideboundnetsclient.test.ts` | T7b2 nets for the client: a port vertex does not block a tile, `netSpotsView` (sea tile ids, same set as `canPlaceNet` and the legal `place_net` list, no taken tile, empty without your own road or supply, `undefined` when nets are off, off your turn or outside main), `netViewData` (`netTiles` public, `netSpots` and `netCost` yourself only, nothing with nets off), the net bot goal (registered only with Fishing on, price + 2 spare cards, nothing without a spot or at the limit, prefers a fish icon, the brain places it) |
| `tideboundfishgrounds.test.ts` | T7c to T7e fishing grounds: boosts (reading, doubled chance, earlier first catch on the same seed, one boost per catch and the icon stays at 0, richest tile first), tide replenish (reach by depth, slow, faster on a spring tide, none when dry, no growth past 4, seeded, no `g.rng` draw), feed the sea (registration, 1 wheat to the bank, fills no icon, empty and half-full grounds, every refusal changes nothing, main phase only, legal list), `fishClientView`, `feedSpotsView` and the feed bot score |
| `tideboundharbor.test.ts` | T8a and T8b harbors: DLC/addon off = nothing registered, `upgrade_harbor` (requires own city on a port and `HARBOR_COST`, sets `level: 2`, 1:1 on generic or resource port, zero `g.rng` draws), `HARBOR_LIMIT = 1` per player (2 with `tidebound.harbor_empire`), works while flooded (`PORT_IDLE_CHECKS` exemption and `isPortFlooded`), `harborSpotsView`/`harborClientView`/`harborBotGoal`, `HARBOR_MAX_TRADES = 4` per turn per harbor with 2:1 fallback and turn reset, and `explainInvalidBankRatio` harbor explanations |
| `tideboundseaevents.test.ts` | Tidebound sea events (2026-11-24): 2 shipwreck and 2 pirate raid cards with icons, none with the DLC or the addon off, the 3-event timeline 2 to 4 rounds apart, firing on its round with `lastEvent` and a refill and no `g.rng` draws, pirate strength in the timeline detail, d20 bands and seeded shipwreck salvage from the bank, pirate strength growth and loot cap (Pirate hunter past it), a tie wins, losers give 2 random cards (resources to the bank, fish gone), old wreck and pirate pieces cleared |
| `tideboundtech.test.ts` | T11a to T11f Tidebound tech nodes: 9 nodes across 4 tiers and 2 paths (`expansion` vs `industrial`) in `techpanel` fork layout, 25+ VP cost divisor scaling, `techGate` helper, `rickety_bridges` gate & +4 bridge cap, `fishing_nets` gate & settlement 3:1->2:1 port upgrade, `salvage_crew` +1 shipwreck card & `demolish_bridge` refund, `net_works` -1 wood cost, `pirate_hunter` +2 knights against a raid & +1 loot, `harbor_master` gating `upgrade_harbor` & `feed_sea`, `grand_causeway` 6 VP Longest Road with a bridge, and `harbor_empire` 2-harbor limit & `ceil(V / 2)` bank card grant with zero `g.rng` draws |
| `tideboundrisingsea.test.ts` | T12a and T12b Rising sea: DLC/addon off = nothing registered, coast-inward frontier expansion (sea or already-drowned neighbours, fog excluded), lowest elevation first (`1` -> `2` -> `3`), round-clock cadence from round 3 with derived RNG stream (`deriveRisingSeaRng`, zero `g.rng` draws), permanent `drowned` tile state blocking production and robber placement, non-harbor port idleness (`PORT_IDLE_CHECKS`), standalone (`tidebound.tides: false`) and combined (`tidebound.tides: true`) operation, `risingSeaOverlays` client overlays, and `RISING_SEA_LEVELS` (1–5) rate settings & lobby mapping |
| `tideboundbots.test.ts` | T13a to T13f Tidebound bots and dialogue: flood and rising-sea exposure in vertex scoring (`tidesBotGoal`, `risingSeaBotGoal`), salvage goals (1-step claim, 2-step approach, `demolish_bridge`, rickety upgrade), harbor, net and `feed_sea` placement and scores, pirate avoidance and hunting (intercept, `drive_off_pirate`, knights), research across the 9 nodes, public-info-only Tidebound chat lines (no resource words, each trigger must post), DLC off = no goals, no RNG draws, no `tidebound` trait |
| `golden.test.ts` | Golden baseline: seeded bot games hashed against `golden.snapshot.json` |
| `rounds.test.ts` | Round clock: `g.round`, round hooks, `everyNRounds` |
| `score.test.ts` | `score()`, `publicVP()`, score modes, `checkWinner` |
| `pricing.test.ts` | Piece cost and limit service, cost modifiers |
| `botgoals.test.ts` | S0.14 Bot goal registry: tier gating (`main`/`secondary`/`overload`), missing-card integration, custom action execution |
| `persistence.test.ts` | S0.15 Persistence: save/load round-trip, hard caps, public-only event filter, schema migration, Render `CTMEM1.` export/import |
| `simmatrix.test.ts` | S0.16 Sim matrix: scenarios × DLC/addon combos × tech tree on/off × bot tiers, invariant checks, `botTested` badge flag |
| `clankerton_s0.test.ts` | S0.5–S0.11 shared engine services: trade ratios, production pipeline, tile state/durability/wild tokens, Seven Resolver, markers/ledger/strength/relations, history/stats, seeded event deck |
| `stage1.test.ts` | Stage 1 core systems & proving-ground content (S1.1–S1.5): Taxes & Catch-up, Public Contract Board, Spies, Tech Tree & Local Nemesis & Round Recap, Karaoke 7, Bot Drinking Game, Hats, Sandbox Economy |
| `techroots.test.ts` | Effects of the 5 root techs, the two tech actions, the port level (T1a), the harbor-only 1:1 floor (T1c), bot tech tree research/action decisions, and the tree-off no-effect check |
| `golden.snapshot.json` | Recorded hashes for the golden test (created on its first run) |
| `index.test.ts` | R2 & R9.1 guard: the `src/` tables in `INDEX.md` match the file headers (`scripts/index.mjs --check`; fix with `npm run index`) and `packs/<dlc>/addons.generated.ts` files match the addon files (`scripts/addons.mjs --check`; fix with `npm run addons`, plus cycle/missing-dep/prefix failure checks) |
| `headers.test.ts` | R2 header guard: every `src` file has a `// MODULE:` line with a real description (runs `scripts/headers.mjs --check`; stale `DEPENDS ON` / `USED BY` do not fail it) |
| `architecture.test.ts` | R3 architecture guard: layer import rules (`shared` imports only `shared`; `packs` import `shared`, own pack and `packs/base`; `server` never imports `client`; `client` imports only `client` and `shared`) and no new circular imports (`KNOWN_CYCLES` lists the two left: client actions/render, server scheduler/net/view) |
| `template.test.ts` | R5 template guard: the example addon in `src/packs/_template/` passes the Rule of Two audit, registers nothing when off, and its piece, action and client view work when on |
| `socketAct.test.ts` | R6 generic `act` socket event: runs one engine action for the socket player, sends the engine reason when refused, ignores malformed envelopes, never answers "Internal error" to junk payloads for the nine moved actions, and (until R6.4 deletes each legacy handler) gives the same answer as the legacy event |
| `piecesView.test.ts` | R8.6 generic per-player piece and action view data (`base.pieces_view`): `undefined` in base game, spot/cost/left parity with `netSpots`/`feedSpots`/`harborSpots`, `rickety_bridge` ocean edge build validation, absent keys when `available` is false, `spots: null` for other/spectator/off-turn/gameover and `[]` when broke, ascending spots, JSON round-trip and zero `g.rng` draws |
| `lantern.test.ts` | R9 proof piece (`_template/lantern.ts`, one file): Rule of Two audit, nothing registered when off, visual manifest entry is safe plain JSON, `pieces[id]` from `base.pieces_view` (supply, price, spots next to your own road, no spots for other viewers, absent when off), generic `build` (1 VP, supply, zero `g.rng` draws, spot gone after building), refusal away from your roads, bot goal and the brain building it |
| `viewState.test.ts` | R7a client state builder (`makeStateBuilder`): snapshot (`view.snapshot.json`) of what the turn player, another player and a spectator get, with Tidebound on and off; addon off, tech missing and lobby cases for the VIEW_DATA fields |
| `visual.test.ts` | R8.3 `visual` on `PieceDef` and `ActionDef` and the `OVERLAY_KINDS` registry: defs with and without a visual register, plain JSON, a duplicate overlay id throws unless `replace`, nothing registered when the DLC or addon is off |
| `visualManifest.test.ts` | R8.4 `buildVisualManifest` and the safety checks: empty for base, Tides on gives `flood` and `flood-warn`, sorting, plain JSON, unsafe markup, css, labels and orders refused (`visualProblems`, `overlayProblems`, `manifestProblems`) |
| `visuals.test.ts` | R8.5 client copy of the manifest (`client/visuals.ts`): empty before it arrives, a late arrival asks for one re-render, a resend asks for none, listeners, reset, junk and malformed entries dropped, own copy |
| `visualsEvent.test.ts` | R8.4 `visuals` socket event: sent to every player and spectator before `gameState`, once per addon-set key, resent on reconnect or a new spectator, a lobby toggle changes the key, real content when a def has a visual |
| `turnhistory.test.ts` | Turn history recorder (`recordTurnHistory`): setup placements under round 0, rolls, consolidated production, builds, dev cards, robber and steals, bank trades, discards on a 7, rounds advance; trade replies make no empty turn and log on the current player's turn, Monopoly / Knight / Year of Plenty detail, engine log lines folded in once (`takeNewLogLines`) |
| `tideboundmapdefaults.test.ts` | Turning Tidebound on in the lobby (`applyTideboundMapDefaults`): islands + wide water picks, radius raised to `TIDEBOUND_MAP_RADIUS`, a bigger host radius kept, and `techTreeOn` enabled by default |
| `techpanelview.test.ts` | Tech tree pan and zoom maths (`client/techView.ts`, Bugs 2 and 3): default view, scale limits, zoom keeps the point under the cursor, zoom out and back, pan clamped to the world edges (none at scale 1, a smaller world stays inside), `viewCss`, and `costsVisible` (costs show from `COST_MIN_SCALE` up, hidden when zoomed out) |
| `elevationtint.test.ts` | Tidebound elevation heat map tint (`--elev-1` to `--elev-3` in `client/styles.css`, light and dark): three opaque levels, each clearly a different colour, orange at height 1 and green at height 3 (2026-11-24) |
| `fishtileoutline.test.ts` | Fish tile outline (`fishTileOutlineMarkup` in `client/render/overlay.ts`): unfilled tile polygon, never takes clicks, nothing without a polygon |
| `techworldspan.test.ts` | Tech tree ring spacing (`WORLD_SPAN`, `FIT_VIEW` in `client/techView.ts`): world at least 2x the stage, opening view fits it, no pan while it all fits, pan clamped to the bigger world, zoom keeps the point under the cursor, span 1 behaves as before |
| `logfilter.test.ts` | Live log filter (`client/logFilter.ts`): the player filter keeps only that player's own turns (an action in another player's turn that names them is dropped, past rounds stay), and the round, category, resource and value filters still work |
| `buildMenu.test.ts` | Build menu (`client/buildMenu.ts`, BUG 5): which pieces a corner or edge offers (settlement, city, harbor, port raise, road, bridge, rickety bridge, manifest entries) by position only, unaffordable ones listed but not payable, free roads, cost tooltip dimming and Free, 150 ms hover and long-press delay, popover placement on screen |
| `fishSpend.test.ts` | Spending a stack of fish at once (`client/fishSpend.ts`): one pick per fish, limited by the bank, add and remove picks, the list sent as `spend_fish` |
| `panPreview.test.ts` | Drag-pan layer preview (`client/panPreview.ts`, BUG 1): off-screen board edges in pixels (`hiddenEdges`), unpainted strip width when translated (`missingAfterOffset`), and mid-drag repaint threshold (`needsRepaint`, never repaints when the whole board fits) |
| `terrainCanvas.test.ts` | 2D terrain canvas (`client/render/terrainCanvas.ts`): camera transform parity with SVG `xMidYMid meet`, viewport frustum culling (`isHexVisible`), world-to-screen inversion (`screenToWorld`), polygon hit-testing (`findHexAtWorldPoint`), and `#boardTerrainCanvas` mount |
