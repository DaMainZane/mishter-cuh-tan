# Change Log

Condensed 2026-11-02 (was ~227 KB, 111 passes). Newest first. Passes 83–95 and 101–102 were written without a shell; later full runs (96, 98, 100, 103+) passed.

## Passes 104–111 (Nov 1–2)
- **111** Debug Mode: server `auditGameState` (invariants, legal spots) and `applyDebugCommand` (grant resources/fish, unlock techs, force roll, paint pieces, export snapshot); in-game board brush; FPS/SVG profiler.
- **110** Tech cost balancing (Bug 3).
- **109** Fishing net rework: one net per sea tile (supersedes 107).
- **108** Robber, shipwrecks and pirates scale when zooming out.
- **106** Port upgrade node (Bug 4).
- **105** Live log player filter.
- **104** Heat map tint, fish tile outline, tech tree ring spacing.

## Bug List passes 98–103 (Oct 31–Nov 1)
- **103** Tech tree zoom cost threshold and counter-scale; sturdy and rickety bridge designs; big-map pan/zoom optimization.
- **101–102** Tech tree pan/zoom (costs only when zoomed in); new pirate icon.
- **100** Bugs 1, 5, 8–12, 15–17.
- **99** Stacked cost cards with 4-card tally cap.
- **98** Merged Live Log and Turn History, dev card detail, no phantom "Passed turn", Tidebound map defaults.

## Modular rework R1–R9 (Passes 81–95, Oct 30–31)
- **81–82** File headers, architecture guards, index generator, router docs; Tidebound bridge cycle removed.
- **83** Template addon, five recipes, `CLAUDE.md`.
- **84–86** Server view data registry (`VIEW_DATA`), Tidebound view groups moved into it, viewState tests.
- **87–88** Generic `act` socket event; nine events and piece clicks moved to `act`/`place`.
- **88 (UI)** Merged Live Log and Turn History with RS icons and click-to-filter; top-right Game Timer and Round HUD.
- **89–95** Pack addon lists auto-generated; visual manifest design and client manifest; `base.pieces_view`; generic client code for manifest pieces; `flood` overlays on `OVERLAY_KINDS`; lantern proof piece.

## Tidebound DLC (Passes 57–97, Oct 29–31)
- **57–62** Pack skeleton (8 addon stubs), lobby card data, port upgrade levels (state v2), Raise the Port, wide-water map perk.
- **63–65** Wide water grows canvas, land elevation 1–3, seeded fish icons.
- **66–69** Bridges: rickety bridge and upgrade, type picker, collapse on a 7, Longest Road recalculation and collapse animation.
- **70–72** Flooded tiles, seeded tide schedule, spring tide, tide slider, elevation resistance, tides UI, ports idle while flooded.
- **73–76** Fish wild token, fishing nets (engine, client, bot goal), fish boosts, tide replenish, feed the sea.
- **77–78** Harbor 1:1 upgrade (limit 1), max 4 trades/turn; storm event and wrecks with fair sea/shore spawn and loot rules.
- **79** Pirates: marker, strength, drive off, rob 2x, flee mode.
- **80** Tech tree fork layout, `techGate`, nodes 1–9, `demolish_bridge`, Grand Causeway, Harbor Empire.
- **96** Lowest-elevation-first drowning, optional with Tides.
- **97** Bot goals for flood scoring, salvage, bridges, ports, nets, fish, pirates; 9-node tech research; public-info-only dialogue.

## Tech tree (Passes 47–56, Oct 28)
- Per-player cost formula, old base techs removed, `rules.techTreeOn`, research action and panel, effects of 5 root techs, radial tree UI with Tech button, sim matrix.
- **55** Tier and two-lane design (docs only).
- **56** Bot tech support, pre-roll dev card limit, fair dice option, cost rebalance, trade auto-deny, seat reconnect.

## UI and trading polish (Passes 39–52, Oct 27–28)
- Colonist-style trade card overhaul, avatars and theme colors, bot trade pacing, trade button alignment and flicker fix.
- Interactive physical dice roll decoupled from pass turn; fixed overlay blocking clicks.
- Turn History view; second Knight playable next turn; map-size scaling restored; randomized turn order.
- DLC catalog and scenario presets aligned to the 6 DLCs in `Ideas.md`.

## Stage 0–1 foundation (Passes 35–38, Oct 27)
- DLC/addon layer, keyed registries, round clock, golden baseline test, `computeVP` audit, `pieceCost(..., reg)`, `dlc`/`addons` settings, Setup UI rework, overlay and popup kit, bot goal registry, Stage 1 foundation.
- Map radius 5 for non-standard presets, radius input (1–50) synced.

## Lobby, clock, ports (Passes 24–34, Oct 26–27)
- **34** Spectate mode. **33** World setup page. **32** Fixed-size player list that follows the turn; hexagon-only port layout.
- **30** Road zoom-out scaling, session reconnect, bot setup optimization, AI training data log, VP-scaled pieces (2x cost above base limit).
- **25–29** Bank trade advice, board-scaled bank/dev deck with tests, turn clock bar, human discard clock, server-side "no one has X" check, port rework.
- **19–23** Hover recipe strips and road tooltip kept; click-to-select build popups tried and reverted; board split into persistent SVG layers; bots wait for animations.
- **24, 26** Seed toggle, bigger pieces, scrolling lobby dock, more presets; shape add-ons no longer fall back to hexagon.

## Early build (Oct 23–25)
- **17–18** Turn chime, nickname required, speed locked 0.5x, lighter victory screen; cards held until flight animation lands.
- **10–16** Map Generation M1–M6: seeded noise, `MapRecipe` and share code, registry and settings, shapes and ports, terrain and numbers (design in `Map Generation Design.md`).
- **9** Victory screen and confetti. **8** 8-player lobbies, real 18-token number pool. **7** Bot dialogue. **6** Bot tiers.
- **5** Turn timer, custom presets, counter-offer editor. **1–4** Counter trade, merged roads, Longest Road/Largest Army banner, drag-to-pan.
- **Step 2** `src/shared/` engine, packs `base`/`gold`/`fog`, bots, design tokens. **Step 1** TypeScript split, esbuild, Docker, `render.yaml`. **Step 0** Skeleton deploy on Render.
