# Map Generation Design

Design notes for the map generator: board shape, terrain, number tokens, ports, perks, seeds and playability checks. Written 2026-10-25, before any of it is built. Backend and functionality first. The lobby UI stays minimal until the settings and navigation UI rework (see `change log.md`, Planned).

## Status

**M1 built 2026-10-25** (noise, recipe and share code, stage RNG, `mapcheck.ts`, `generateMap` for the classic hexagon; see `change log.md` Pass 10). **M2 built** (registry, settings, quick starts; Pass 11). **M3 built 2026-10-25** (shapes and ports per landmass; Pass 12; written without a shell, run the tests first). M4 built 2026-10-25 (Pass 13: `spread`, `clustered`, `realistic` with `TileDef.habitat`, number flags and overrides, `balanced`, `feast_famine`; written without a shell, run the tests first). M5 built 2026-10-25 (Pass 14: board retry loop with `degraded`, `requireConnected` and the other flags in the check, `one-resource-island`, sims on every shape, budget test; written without a shell, run the tests and read the printed budget table first). M6 built 2026-10-25 (Pass 15: the lobby map menu drawn from the server's `mapOptions` list, seed line, report tags, presets v2 with recipe and "new seed"; written without a shell, run the tests and look at it in a browser first). Deviations from this text are listed in Pass 12, Pass 14 and Pass 15 (the retry loop redraws tokens, not terrain; the ring band check and the island resource-mix option are not built; `GEN_VERSION` was not bumped; the menu has no UI for params other than land). (land density is a share of the whole canvas with a soft rim penalty instead of a hard margin; `river` was added from John's sketch; the cheap shape checks ask for a landmass of about 7 tiles instead of an exact spot count). Everything below is still brainstorming, nothing is final. Open questions are in section 16. All numbers are starting guesses until a gallery of generated maps has been looked at (section 15).

It builds on code that exists today:

- `src/shared/mapgen.ts`: `generateBoard(reg, rules, rng, presetId)`. Radius clamp 1 to 50, tile multiset, number pool, ports, `afterMapGenerated` hooks.
- `src/shared/numbers.ts`: token pool for any board size, no touching 6/8.
- `src/shared/topology.ts`: `buildTopology` (vertices, edges, auto ports, robber start).
- `src/shared/rng.ts`: seeded mulberry32. String seeds are hashed with FNV-1a.
- `src/shared/registry.ts`: `PresetDef`, `PackApi`, `put()` with `replace`.
- `src/server/lobby.ts` (`newBoard`, `mergeSettings`), `src/server/presets.ts` (custom presets), `src/server/game.ts` (`startGame` capacity check).
- `src/server/bots/mapProfile.ts`: landmass union-find, to be shared with the validator.

## 1. Problems in the current generator

These are the reasons for a pipeline instead of more presets.

- **Shape is faked with water.** The `archipelago` preset turns each tile into water with 22% chance after the tile list is built. The land count is random, gold or the desert can be swallowed, and nothing guarantees the pieces are connected or big enough.
- **Presets are forgotten.** `updateSettings` and `rematch` call `newBoard(settings)` with the default preset. Click Gold Rush, change the radius, and the board is plain again.
- **One RNG stream for everything.** A change in any step reshuffles every later step. A shape cannot be kept while the terrain is re-rolled.
- **Ports assume a centered board.** `buildTopology` sorts coastal hexes by angle around the origin and prefers edges facing away from it. That means nothing for islands, and lake shores count as coast.
- **Checks are thin.** `startGame` counts vertices. It does not know landmasses, usable spots or how fair the best spots are.
- **A map cannot be replayed.** `newBoard` draws `randomSeed()` and throws it away. Custom presets store the finished tiles, not how the map was made.

## 2. Goals and non-goals

Goals

- Split **shape** (which cells are land) from **generation** (what goes on them) into stages that can be mixed freely.
- Exact land count: the host picks a size and gets that size.
- Every map is reproducible from a seed plus its settings, and changing one stage keeps the others stable.
- Playable by construction: generation retries until the checks pass, and says so when it cannot.
- New shapes, terrain styles, number styles and perks come from packs as data. `index.html` and the lobby code do not change for them.
- Works from radius 1 to 50, comfortable up to about 20 (matches `Bot AI Design.md`).

Non-goals for now

- Ships and bridges. They come in a later expansion. Until then, land split into separate islands cannot be crossed (section 6.6).
- Reworking the painter or the settings UI.
- Symmetric maps (section 17, parked).

## 3. Terms

| Term | Meaning |
|---|---|
| Canvas | The hex-shaped area of cells the generator works in. Every cell ends up land or water. |
| Radius | Tiles from the center tile to the canvas edge. The center tile is distance 0, so radius 2 is the standard 19-tile board. Same meaning as today's `boardRadius`. |
| Shape | Which canvas cells are land. |
| Terrain | Which tile type each land cell gets. |
| Numbers | Which token each numbered tile gets. |
| Ports | Where harbors sit on the coast and which type each is. |
| Perk | A stackable extra such as Gold or Fog. |
| Pick | Any menu id the host ticked: a shape op, a terrain or number style, or a perk. |
| Recipe | Seed, radius, picks and params. Enough to rebuild a map. |
| Snapshot | The finished tiles, numbers, ports and robber (what custom presets store today). |
| Land budget | Target land tile count `L = round(canvas cells x land density)`. |

Canvas size is `3R(R+1)+1`:

| Radius | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 20 | 50 |
|---|---|---|---|---|---|---|---|---|---|---|
| Cells | 7 | 19 | 37 | 61 | 91 | 127 | 217 | 331 | 1261 | 7651 |

For land with `L` tiles, `B` coast edges (land next to water), `C` landmasses and `h` lakes: **vertices = 2L + B/2 + C - h**. The standard board gives 19, 30, 1, 0, so 54. That is a cheap capacity estimate before any topology exists.

## 4. The pipeline

```
recipe
  |
  1 resolve   picks -> empty slots get defaults, conflicts resolved, effective rule flags
  2 canvas    cells within the radius
  3 shape     land set of exactly L cells, plus the height field
  4 terrain   a tile type for every land cell
  5 numbers   a token for every numbered tile
  6 extras    perks: gold, fog, whatever a pack adds
  7 topology  buildTopology + ports (per landmass)
  8 check     MapReport; errors -> next attempt
```

| # | Stage | Reads | Produces | RNG stream |
|---|---|---|---|---|
| 1 | Resolve | recipe, registry | stage list, effective flags | none |
| 2 | Canvas | radius | axial cell list | none |
| 3 | Shape | canvas, shape ops, land density | land set, height field | `shape` |
| 4 | Terrain | land set, tile counts, terrain style | type per cell | `terrain` |
| 5 | Numbers | numbered cells, pool, number style, flags | token per cell | `numbers` |
| 6 | Extras | hex inits, perks | gold, fog, others | `extras` |
| 7 | Topology | hex inits | Board | `ports` |
| 8 | Check | Board | MapReport | none |

**Counts first.** The tile multiset comes from `rules.tileCounts`, the active perks, and base tiles filling the rest cyclically (today's logic). Terrain styles decide only where each tile goes, never how many. So Gold Rush works with every terrain style without extra code.

**Two-level retry.** Stage 3 loops on cheap cell checks. Stages 4 to 8 loop on the full board checks while keeping the chosen shape. An unlucky token layout never costs the host the shape they liked (section 11).

`generateBoard(reg, rules, rng, presetId)` stays as a thin wrapper (preset id -> recipe, seed from the rng) so the engine, the sims and `tests/topology.test.ts` keep working. The new entry point is `generateMap(reg, rules, recipe)`, returning `{ board, report, recipe }`.

## 5. Seeds, determinism and recipes

### 5.1 One stream per stage

Each stage draws from its own stream: `createRng(seed + ':' + stage + ':' + attempt)`. Consequences:

- Tick Fog: shape and terrain do not change.
- Change the terrain style: the shape does not change.
- Change land density: the noise does not change, so the coast grows or shrinks in place instead of jumping to a new map.
- Retries are deterministic. The same seed walks the same attempts and lands on the same one, so the attempt number does not need to be stored (it goes in the report for debugging).

### 5.2 Portable math

A saved seed must give the same map after a Node upgrade. Generation therefore uses only integer ops, `+ - * /`, `Math.floor` and `Math.sqrt`. No `Math.sin / cos / exp / pow / hypot`: engines may differ in the last bit. Every sort comparator breaks ties on cell index. Noise is lattice value noise with an integer hash and a polynomial smoothstep, 3 to 4 octaves, no dependency.

### 5.3 Player count never feeds generation

Otherwise adding a bot would reroll the map. Seats are checked after generation (start check, lobby hint), never inside it.

### 5.4 Seed values

Text or number. Strings go through the existing `hashSeed`. Shown as 7 characters of base36 (a uint32). Random seeds come from `randomSeed()`. Typed words such as `catan-night` work.

### 5.5 When the seed changes

| Action | Seed |
|---|---|
| Change radius, picks or params | Kept. The map changes because its settings changed. |
| Regenerate button | New random seed. |
| Rematch | New random seed, unless locked. |
| Lock seed | Kept on rematch. |
| Type or paste a seed | That seed. |
| Load a preset | The preset's seed (exact snapshot), or a new one when applying its style (section 13). |

Today a settings change rerolls the whole board. This is a deliberate behavior change.

### 5.6 Recipe and share code

Stored as JSON. Shared in chat as one line:

```
hx1;g=1;r=4;picks=continent+lake+realistic+fog;land=70;seed=7K3F9Q2
```

`hx1` is the format version, `g` the generator version. The server decodes it, checks every id against the registry, clamps every number to its param range, and drops unknown ids with a lobby log line. Pasting a full code into the seed box applies the whole recipe. Pasting a bare seed applies just the seed.

### 5.7 Generator version

`GEN_VERSION` is an integer, bumped by any change that alters the output for the same recipe. Golden tests (section 15) catch an accidental change. A recipe carries `g` and the pack list. A mismatch means the seed may not give the same map. Presets keep a snapshot, so exact replay never depends on the generator. The seed is a convenience for same-version replays. Old algorithms are not kept around.

### 5.8 Fog spoiler

Decided: the seed and share code are always shown, Fog included. They do reveal the hidden tiles to anyone who rebuilds the map, but this is a private friend group. A host toggle to hide the seed can come later (the `secret` flag on Fog stays, so the toggle has something to read).

## 6. Shape layer

### 6.1 Heightfield and threshold

The core idea, shared by every noise-based shape:

1. Every canvas cell gets `h = fBm noise + shape bias` (for example a pull toward the center). Noise is sampled at the cell's position, so a larger radius shows more of the same field.
2. Cells within `margin` rings of the canvas edge are not eligible. Default 1: ocean all around, room for ports. `hexagon` uses 0.
3. Land is the top `L` eligible cells by `h`. Picking `L` directly gives the exact count.
4. Cleanup, depending on the op: keep the largest component for single-landmass shapes, fill one-cell holes, remove spikes (a land cell with at most 1 land neighbor).
5. Count fix. Cleanup changes the count, so add the best-ranked ocean cell next to land, or remove the worst-ranked coastal cell, until the count is `L`. A cell may only leave if its land neighbors form one unbroken arc around it. Then the landmass cannot split, and the test is O(1) on the six-neighbor ring.
6. Output the land set and `h`. Later stages reuse `h` (realistic terrain).

### 6.2 Ops and phases

A shape is an ordered list of ops. Each op has a phase:

| Phase | Rule | Job |
|---|---|---|
| `tweak` | stackable | Runs first. Edits params for the base op (ragged coast). |
| `base` | exactly one | Produces the main land set. |
| `carve` | stackable | Turns land inside the land set into water (lakes). |
| `scatter` | stackable | Adds land elsewhere (satellite islets). |

Cleanup and the count fix run after `scatter`. Budget accounting keeps `land` meaning the **final** count: with a lake, the base builds `L + lake cells` and the carve removes them. With satellites, the base gets `L - satellite cells`.

### 6.3 Ops in v1

| id                   | Phase   | What it does                                                                                                                                                                                                                                                                                                                            | Params (default)                                                   | Landmasses         |
| -------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------ |
| `hexagon`            | base    | The whole canvas. Today's board.                                                                                                                                                                                                                                                                                                        | none; land 100%, margin 0                                          | 1                  |
| `continent`          | base    | One blob: noise plus a pull toward the center.                                                                                                                                                                                                                                                                                          | land 70%, pull 0.9                                                 | 1                  |
| `ring`               | base    | A land band around a central lagoon (ridge function on distance from center).                                                                                                                                                                                                                                                           | land 60%, lagoon 25% of R                                          | 1                  |
| `islands`            | base    | A few big islands.                                                                                                                                                                                                                                                                                                                      | land 55%, count about R/1.5 (2 to 8), min size 6, gap 1            | many               |
| `archipelago`        | base    | Many small islands.                                                                                                                                                                                                                                                                                                                     | land 45%, count about 1.5R (4 to 20), min size 3, gap 1            | many               |
| `continents`         | base    | 2 to 4 big landmasses separated by 1 to 4 tiles of water. Each continent gets its own outline.                                                                                                                                                                                                                                          | land 65%, count 2 to 4, gap 1 to 4 (default 2), stretch 1.0 to 2.2 | many               |
| `lake`               | carve   | An enclosed lake in the biggest landmass.                                                                                                                                                                                                                                                                                               | lake share 12%, count 1                                            | same               |
| `satellites`         | scatter | 1 to 3 tile islets in open ocean around the mainland.                                                                                                                                                                                                                                                                                   | count about L/10, gap 1                                            | adds many          |
| `ragged`             | tweak   | Doubles noise frequency, raises amplitude, skips spike removal. Fjords and bays, still connected.                                                                                                                                                                                                                                       | ruggedness 0.8                                                     | same               |
| 'river' (self added) | carve   | chose a random square on the shore, start the river, the river then pick a random side of that tile hexagon, the title connected to that side is the next block in the river. the river continue. random chance to pick an extra side to split the river (low chance, scale higher the longer the river has been running without split) | need AI to dictate                                                 | need AI to dictate |

Islands and archipelago: sample `K` centers by best-candidate sampling (each new center maximizes its distance to the chosen ones). Split `L` across islands by random weights with the min size. Grow each blob through a priority queue on `h - distance penalty`. Cells within `gap` of another island are blocked. A blob that cannot reach its size fails the attempt.

Continents: place `K` centers far enough apart that every pair can keep its `gap` (hex distance between land of different continents is at least gap + 1). Split `L` across them by random weights, each at least 15% of `L`. Each continent draws its own outline so no two look alike: its own noise offset, a random stretch axis and ratio (1.0 to 2.2, so some are round and some long), and a random lobe bias (the pull toward its center is weakened in one direction, which gives peninsulas). Each grows through a priority queue on `h - stretched distance`, blocked inside another continent's gap zone. Cleanup and the count fix run per continent, then once for the whole board. A gap of 4 or less is deliberate: it is the distance ships or bridges would later cross.

Lake: grow from the cell farthest from the ocean (BFS distance transform), only into cells at distance 2 or more from the ocean. Every lake cell then keeps at least one land tile between it and the sea, so the lake never opens up. `hexagon + lake` is allowed: a full hexagon with a hole in the middle.

### 6.4 Stacking and conflicts

The menu is one checkbox grid, as in the mockup. The data decides what ticking does:

- **Same slot:** ticking one replaces the other. Radio behavior, drawn as a checkbox.
- **`conflicts`:** ticking one unticks or greys out the other.

Conflicts in v1: `satellites` with `hexagon`, `islands` and `archipelago`; `lake` with `archipelago` and `ring`; `ragged` with `hexagon`. The server applies the same resolution when it receives picks, so a stale client cannot create an invalid combination.

The mockup shows Continent and Archipelago ticked together. This design reads that as "combine them". `continent + satellites` is that combination. Plain `archipelago` as the base replaces `continent` (question 1).

### 6.5 Land density and size

Land density is a 30 to 100% slider; `hexagon` ignores it. The minimum `L` covers the shape's own minimums (for example islands x min size), and at least 7.

`recommendedRadius(players)` becomes a function of radius, shape and density: the smallest radius whose estimated vertex count (section 3) covers the table. Today it returns 2 / 3 / 4 for up to 4 / 6 / 8 players, which is only right for a full hexagon.

### 6.6 Disconnected land before ships

Roads cannot cross water, so a player is walled into the landmass they start on (trading only). Decided: split land is allowed and plays like any other map, just with more restriction until ships exist. Land nobody starts on is simply unused. Rules:

- No shape is blocked. `islands`, `archipelago` and `satellites` are selectable now.
- A pack that adds ships or bridges registers a `crossing` capability. Nothing reads it yet. It exists so later checks (for example "every landmass must be reachable") can switch on without touching shape code.
- The checker treats split land as a warning, never an error, and measures capacity per landmass (section 11): at least one landmass must hold the whole table, because players choose their own starts.
- Painted and custom maps are never blocked either. Island-per-player scenarios stay possible.
- `ring` and `continent + ragged` already give a broken-coast look that works today.

### 6.7 Trim at game start (optional)

The lobby keeps the full canvas because the painter needs water cells to paint on. At game start, water cells farther than 2 from land can be dropped and the topology rebuilt: smaller payload, tighter zoom. Cosmetic. Do it with the big-map optimization.

### 6.8 Per-shape rules (first draft)

Shapes differ enough to need their own rules, not only their own params. The pipeline stays shared. A shape op can additionally declare flag overrides (`ruleOverrides`, same as perks), a `portPolicy` and extra `checks`.

| Shape | Ports | Extra checks | Notes |
|---|---|---|---|
| `hexagon` | Today's rules. | None beyond the baseline. | Must still reproduce today's board. |
| `continent` | One coast loop, ports by coast length. | One landmass. Thin-land warning. | |
| `ring` | Outer coast. Lagoon coast only if the lagoon is open sea. | One landmass. Band at least 2 tiles thick, so roads never squeeze through a 1-wide neck. | An enclosed lagoon counts as a lake: no ports. |
| `lake` | Ocean coast only. Lake shores get no ports. | Lake enclosed (section 6.3). | |
| `islands` | Per island, at least 1 for islands of 6 or more tiles, types mixed per island. | Spots per landmass. Biggest landmass holds the table. Min island size. | Terrain and numbers are global, so a small island can end up one resource. Option: an island of 4 or more tiles gets at least 2 resource types. |
| `archipelago` | Same as islands, but never more than one port per island. | Min size 3, gap 1. | Most islets will be unused, by design. |
| `continents` | Per continent, by coast length. Each continent gets a mix of types. | Spots per continent, reported. Gap respected. Stretch ratios must not all be equal, so outlines differ. | At least one continent holds the table. Small ones may not, and that is fine. |
| `satellites` | No ports on islets under 3 tiles. | Islets are left out of capacity stats. | Bonus land, not part of the fairness math. |
| `ragged` | The no-adjacent-port rule already thins ports on a jagged coast. | Thin-land warning threshold raised, since the long coast is the point. | |

These map to the three problems in section 1: archipelago is a real shape with its own checks, picks live in settings so presets are no longer forgotten (section 12), and ports follow a per-shape policy instead of one angle sort.

## 7. Terrain layer

The multiset is fixed (section 4). A terrain style only places it.

| id | Idea |
|---|---|
| `random` (default) | Shuffle the multiset. Today's behavior. |
| `spread` | No big same-type patches. |
| `clustered` | Same-type patches. |
| `realistic` | Habitat fields: ranges, forests, plains. |

**Spread and clustered are one algorithm.** Energy `E = s x (adjacent same-type pairs)`, with `s < 0` for spread and `s > 0` for clustered. Swap the types of two random cells, keep the swap if `E` drops (or with a small Metropolis chance, so it can escape local minima). Counts are preserved by construction. Strength = number of sweeps; 0 is plain random. Cheap, and needs no noise.

**Realistic:**

- Two fields over the land cells. Height `h` is the shape's field when it has one, else fresh noise. Moisture `m` is new noise plus a coast term (wetter near the ocean, from a multi-source BFS on coast cells). Both are rank-normalized to 0..1 among land cells, so a threshold means the same on any shape or noise amplitude.
- Each tile type can carry a habitat hint: height target, moisture target, weight. Types are filled narrowest habitat first. Each takes its `n` best-fitting free cells, then 2 to 3 swap sweeps reduce the total misfit.
- Packs put `habitat` on their own `TileDef`s, so a new tile is placed sensibly with no change here. A tile without a hint is placed randomly among the leftovers.

| Tile | Height | Moisture | Note |
|---|---|---|---|
| desert | any | 0.0 | Driest cells, far from the coast. Filled first. |
| gold | 0.85 | any | Next to ore (mountain gold). |
| ore | 0.90 | any | Mountains. |
| brick | 0.65 | 0.35 | Hills beside the mountains. |
| wood | 0.50 | 0.80 | Forest. |
| sheep | 0.35 | 0.50 | Meadow. |
| wheat | 0.25 | 0.30 | Dry plains. |

`waterChance` goes away: the terrain stage never turns land into water.

## 8. Number layer

`buildNumberPool` and `assignNumbers` stay. What changes: the two hard-coded rules become flags, and the strategy is chosen by pick.

| Flag | Default | Meaning |
|---|---|---|
| `hotTouch` | forbid | 6 and 8 may not touch (today's rule). |
| `equalTouch` | avoid | Equal numbers kept apart, a soft goal. |
| `requireConnected` | off | One landmass only. A structural check for shapes that must stay whole (hexagon, continent, ring). |

A pick can declare `ruleOverrides: { hotTouch: 'allow' }`. Effective flags are the defaults, then each active pick's overrides in pack load order. Two picks that disagree on a flag must declare a conflict, so order never matters.

| id | Idea |
|---|---|
| `standard` (default) | Today's: shuffle, then swap away touching 6/8 and equal numbers. |
| `feast_famine` | Zones of rich tiles and zones of poor tiles. |
| `balanced` | Equal total pips for every resource. |

Pips: 6 and 8 = 5, 5 and 9 = 4, 4 and 10 = 3, 3 and 11 = 2, 2 and 12 = 1.

**Feast or famine.** A low-frequency noise field is the richness of each numbered cell, ranked. The pool is sorted by pips and dealt by rank (best pips to the richest cells), with jitter (`mix`, default 0.25) so zones have soft edges. It forms hot clusters, so it declares `hotTouch: allow`.

**Balanced.** Deal the pool highest pips first, each token to the resource group with the lowest running pip total that still has free tiles. Gold is its own group. Inside a group the tiles are shuffled. The existing swap pass then fixes touching reds, swapping only inside the same group so the totals hold.

## 9. Ports layer

The angle sort in `buildTopology` breaks for non-central shapes (section 1). Replacement (rewritten in Pass 31, `GEN_VERSION` 4, to follow the real board):

1. Classify water: ocean (flood fill from the canvas border) or lake. Ports go on ocean coast only. A `lakePorts` flag can allow lake shores later.
2. Per landmass, walk the coast as an ordered loop of edges and cut it into **harbor sites**: runs of edges that look out on the same sea tile. The real frame is 18 sea tiles around the island (6 corner tiles with one coast edge, 12 with two).
3. **Every second site gets a port**, spread evenly. The standard board gives 18 sites, 9 ports, in the real layout (frame pieces with 2, 1, 2, 1, 2, 1 ports). A hexagon of radius R gives 3 (R + 1); the 5-6 player shape (30 tiles, 38 coast edges) gives the real 11. Jagged coasts come out around one port per 4 to 5 edges, because a bay is one site however long it is. A landmass gets at least 1 port from 6 tiles up, at most 1 under 6 tiles, none under 3, and never more than `portCap(size)`.
4. Rules: at most one port per hex and none on a vertex next to a port. Ports on neighbouring hexes are allowed (the real board has them). A site takes its first edge (its last when mirrored); if that does not fit, its other edge, then the nearest free site.
5. `portOffset` picks which half of the sites carry ports (the real layout turned by a tile), `portFlip` mirrors it. Both come from the `ports` stream, so they follow the seed. The old even spread by edge count at a random phase gave the real layout on roughly one seed in six.
6. Deal types like cards: shuffle the pool and deal round-robin across landmasses, so every landmass gets a mix and every resource port appears at least once when `P >= 5`. Past the pool size, the pool is redealt as fresh shuffles (4 generic : 5 resource kept).

## 10. Perks and quick starts

A perk is a stackable pick in the `extras` stage:

```ts
interface PerkDef extends MapOptionBase {
  stage: 'extras';
  tileCounts?(rules, total, ctx): Record<string, number>;   // changes the multiset (gold)
  extra?(rules, total, ctx): Record<string, any>;           // handed to hooks (fogCount)
  afterGenerated?(inits: HexInit[], ctx: MapCtx): void;     // same moment as afterMapGenerated
  ruleOverrides?: Partial<GenFlags>;
}
```

The `afterMapGenerated` hook stays for packs that need no menu entry.

| Perk | From | Effect | Param (default) |
|---|---|---|---|
| `gold` | gold pack | Third of the tiles are gold (`goldRushCount`). | share 33%, min 5 |
| `fog` | fog pack | Hides numbered tiles until a road touches them (`hideTiles`). `secret`. | share 42%, min 4 |

**Count precedence.** A nonzero Rules tab count (`goldTiles`, `fogTiles`, `desertTiles`) wins over the perk's computed count. Zero means "let the perk decide". Plain games with no perk and a typed count behave as today.

**Quick starts.** Today's preset chips become recipes registered by packs and drawn from the registry:

| Old preset | Recipe |
|---|---|
| `standard` | `hexagon`, random terrain, standard numbers |
| `archipelago` | `archipelago` (replaces `waterChance`) |
| `goldRush` | `gold` |
| `fogIsland` | `fog` |
| `blank` | Stays special: an all-water canvas for the painter. Not a shape (it breaks the land minimum). |

`PresetDef` stays for compatibility and is marked deprecated. Custom presets saved today (v1 snapshots) keep working.

## 11. Validation and retries

`validateBoard(board, ctx) -> MapReport`, in `src/shared/mapcheck.ts`. Landmass detection moves out of `bots/mapProfile.ts` into shared code so the generator, the lobby and the bots use one implementation.

```ts
interface MapReport {
  ok: boolean;                 // no errors
  errors: Issue[];
  warnings: Issue[];
  degraded?: boolean;          // best attempt, checks not all passed
  stats: {
    land: number; landmasses: number[]; lakes: number;
    vertices: number; spots: number; ports: number;
    pipsByResource: Record<string, number>;
    fairness: number; attempts: number; genVersion: number;
  };
}
```

`spots` is the number of usable settlement spots: a greedy independent set under the distance rule, over vertices that touch a numbered land tile (hidden tiles count). Run a few times from random orders, keep the best. `fairness` is the pips of the 8th best spot divided by the best spot (4 players, 2 spots each).

| Level | Check | Notes |
|---|---|---|
| Error | Land count equals `L` | Internal assertion. |
| Error | The biggest landmass cannot hold the baseline (8 spots) | Players choose their own starts, so one landmass must fit everyone. |
| Error | A landmass below the min size | Default 3 tiles. |
| Error | A lake touches the ocean | Structural, for the `lake` op. |
| Error | `spots` below the baseline (8, four players) | Generation never reads the real roster. |
| Error | A base resource with no productive spot | Every resource must be reachable. |
| Error | Token count differs from numbered tile count | Internal assertion. |
| Warning | Touching 6/8 left after the swap budget | Only when `hotTouch` is forbid. Best effort on dense boards, as today. |
| Warning | `fairness` below 0.5 | Retry first, warn if it persists. |
| Warning | Thin land: over 25% of land tiles with 2 or fewer land neighbors | |
| Warning | A landmass of 6 or more tiles with no port | |
| Warning | A resource's total pips below half the mean | Off when `balanced` or `feast_famine` is active. |
| Warning | Split land | Shown in the lobby report. Landmasses nobody can start on go unused. |

**Attempt policy**

- Shape loop: up to 40 attempts, each cheap (land count, landmasses, min sizes, spike share, estimated vertices).
- Board loop: up to 12 attempts on the chosen shape (terrain, numbers, extras, topology, full report).
- A pass is no errors and `fairness` at least 0.5. Otherwise keep the best-scoring attempt.
- If nothing passes, return the best attempt with `degraded: true` and its warnings. Never throw, never loop forever. The host sees the warnings and can reroll.

**Budget.** The socket handlers are synchronous, so one slow generation blocks every room. Targets: radius 8 or below within about 20 ms, radius 20 within about 100 ms. Above 20 the attempt counts shrink. Measure in M5.

**Seats.** The generation baseline ignores players. The start check uses the real roster and stays as it is now (`players x 8` vertices above 4 players). Once tests show `spots` agrees with it on standard boards, switch to `spots >= players x 2 + slack`. The lobby shows "spots for N players" from the report, updating as players join.

## 12. Registry and data contract

Everything is data registered by packs. The same `put()` rule applies: duplicate ids throw unless `replace: true`.

```ts
export type MapStage = 'shape' | 'terrain' | 'numbers' | 'extras';

export interface ParamDef { id: string; label: string; min: number; max: number; step: number; default: number }

interface MapOptionBase {
  id: string;
  label: string;
  description?: string;
  /** Options in the same slot replace each other. No slot = a free toggle. */
  slot?: string;
  /** Used when its slot is empty (random terrain, standard numbers, hexagon). */
  default?: boolean;
  conflicts?: string[];
  /** Capabilities a pack must register, e.g. 'crossing'. Unmet = greyed in the menu, refused by the server. No v1 option uses it. */
  requires?: string[];
  params?: ParamDef[];
  /** The seed and share code reveal hidden information (fog). */
  secret?: boolean;
  replace?: boolean;
}

export interface MapCtx {
  reg: Registry;
  rules: Rules;
  radius: number;
  rng: RngState;                                       // already derived from seed + stage + attempt
  noise(x: number, y: number, octaves?: number): number; // 0..1, seeded per stage
  flags: GenFlags;
  param(id: string): number;                           // clamped, default filled
}

export interface ShapeOpDef extends MapOptionBase {
  stage: 'shape';
  phase: 'tweak' | 'base' | 'carve' | 'scatter';
  run(field: LandField, ctx: MapCtx): void;
}
export interface TerrainDef extends MapOptionBase {
  stage: 'terrain';
  /** types = the final multiset. Return one type per cell, same counts. */
  place(cells: CellInfo[], types: string[], ctx: MapCtx): string[];
}
export interface NumbersDef extends MapOptionBase {
  stage: 'numbers';
  place(cells: CellInfo[], pool: number[], ctx: MapCtx): number[];
}
// PerkDef: section 10.
```

`CellInfo` is `{ q, r, h, m, coastDist, landmass }`. `TileDef` gains an optional `habitat: { h, m, weight }` (section 7).

Pack API additions: `api.mapShape(def)`, `api.mapTerrain(def)`, `api.mapNumbers(def)`, `api.mapPerk(def)`, `api.quickStart(def)`, `api.capability(id)`. Registry additions: `mapShapes`, `mapTerrains`, `mapNumberings`, `mapPerks`, `quickStarts`, `capabilities`.

Where the content lives: base map content in `packs/base/map/` (hexagon, continent, ring, islands, archipelago, continents, lake, satellites, ragged; random, spread, clustered, realistic; standard, feast_famine, balanced). Perks in the gold and fog packs. A future ships pack registers `crossing`.

**Settings.** Per-layer fields are not needed. One flat list of picks, with slots and conflicts deciding the meaning. A new layer such as weather adds no settings field.

```ts
mapSeed: string;                       // the seed in use
mapSeedLocked: boolean;                // keep it on rematch
mapPicks: string[];                    // ['continent', 'lake', 'realistic', 'fog']
mapParams: Record<string, number>;     // 'land', 'islands.count', 'fog.share', ...
```

`mergeSettings` validates picks against the registry, resolves slots and conflicts, drops what is unknown or unmet, and clamps params to their ranges. `updateSettings` compares a recipe key (seed, radius, picks, params, counts) instead of the four fields it checks today.

**What the server sends.** `mapOptions`: the static list from the registry (id, label, stage, slot, conflicts, `requires` plus whether it is met, params, `secret`). Sent with the first lobby view and cached by the client. The dropdown draws itself from it, so a new pack appears in the menu with no client change. Plus `mapMeta`: recipe, report summary, `edited`, including the seed and share code (section 5.8).

**Room state.** `room.mapMeta = { recipe, report, edited }`. Any paint event sets `edited = true`, so the UI can later dim the seed ("edited, seed no longer applies") or confirm before a regenerate wipes the edits. No backend blocking now. When persistence arrives (Step 3), the recipe goes into the game snapshot.

## 13. Seed and preset UI (interim)

Kept small on purpose, since the UI rework replaces it. The original sketch (a dropdown that opens into two columns of checkboxes: generation type on the left, perks on the right) is redrawn here.

```
closed
  [ Continent + Lake . Realistic . Fog        v ] [ Reroll ]
    seed 7K3F9Q2    copy   lock   save as preset

open
  Shape                     Style and perks
  [x] Continent             Terrain: Random / Spread / Clustered / Realistic
  [ ] Hexagon               Numbers: Standard / Feast or famine / Balanced
  [ ] Ring                  [x] Fog
  [ ] Islands               [ ] Gold
  [ ] Archipelago
  [ ] Continents
  [x] Lake
  [ ] Satellites
  [ ] Ragged coast
  Land  [-----o--] 70%      Seed [ 7K3F9Q2 ]
```

- **Header.** One line summarizing the picks, generated from labels. One Reroll button next to it.
- **Seed line.** One muted line under the header. Click the seed to copy it. Click the seed text again to edit it (Enter applies). Paste a full share code and the whole recipe applies. `lock` toggles `mapSeedLocked`. `save as preset` starts the existing "Save map as preset" flow, so no new pattern.
- **Non-hosts** see the seed read-only, Fog or not (section 5.8).
- **Greyed items** (an option whose `requires` is unmet) show the reason. None in v1.
- **Params** (island count, lake share, fog share and so on) are in the schema and the recipe but get no UI in v1. Land density is the one slider.

**Presets v2.** `CustomPreset` gains `v: 2`, `recipe` (nullable) and `genVersion`. It still stores the snapshot (`hexes`, `ports`, `robber`, numeric settings). v1 presets load unchanged.

- Clicking the chip loads the snapshot: the exact map, as now.
- A small "new seed" action on a chip with a recipe applies the recipe with a fresh seed: same style, new map. It also replaces radius and picks in the lobby settings.
- A preset saved from an edited map has no recipe, or keeps it marked "based on".

`loadPreset` validates the recipe like any other recipe (section 5.6). Presets stay in the host's `localStorage`, and the server stays stateless about them.

## 14. Build order

Backend first (M1 to M5). The UI waits for M6, and the UI rework can swallow M6.

| Phase | Work | Done when |
|---|---|---|
| M1 Foundations | Stage RNG helper, noise, `MapRecipe`, `MapCtx`, `GEN_VERSION`, recipe codec, `mapcheck.ts` with the landmass code moved out of `mapProfile.ts`. `generateMap` for `{hexagon, random, standard}` with the old wrapper on top. | Same classic boards as today. Determinism tests pass. `MapReport` on the standard board matches known values (54 vertices). |
| M2 Registry and settings | Pack API additions, `mapSeed / mapPicks / mapParams`, `mergeSettings` validation, `newBoard` through recipes, `regenerate` event, seed lock, quick starts, gold and fog as perks. | A picked style survives a radius change. The same seed gives the same map. |
| M3 Shapes | Heightfield and count fix, then `continent`, `lake`, `ragged`, then `islands`, `archipelago`, `continents`, `satellites`, `ring`. Per-shape rules (section 6.8). Ports per landmass. | Exact land counts across 200 seeds and radii 2 to 12. Every connected shape is connected. |
| M4 Terrain and numbers | `spread / clustered` energy, `realistic` habitat, flags and overrides, `feast_famine`, `balanced`. | Counts are preserved for every style. Same shape across styles for one seed. |
| M5 Validation | Checks, two-level retry, report to the lobby, `spots`, budget measurement. Sims across shapes. | No crash and no unplayable board across the matrix. Budget met. |
| M6 Lobby UI | Dropdown from `mapOptions`, seed line, presets v2. | Section 13 works. |

Placement: independent of Step 3 (identity). It touches only `shared/`, `server/`, `packs/` and the client lobby. Do it after Step 2 closes, before the UI rework in Step 4, so the rework starts from the `mapOptions` contract instead of hand-built chips.

## 15. Tests and tools

New `tests/mapgen.test.ts` (vitest), property style over seeds, shapes, radii and picks:

- Determinism: the same recipe twice gives deep-equal boards.
- Stage independence: changing perks or terrain does not change the land set. Changing land density keeps the noise.
- Exact land count. Connected shapes are connected. Lakes never touch the ocean.
- Tile counts equal the requested multiset for every terrain style.
- No touching 6/8 unless overridden, with the best-effort exception recorded.
- Port rules: one per hex, none adjacent, ocean only.
- `spots` and `fairness` sanity on known boards. Radius 2 cannot host 7 or 8 players; radius 3 can.
- Budget: radius 8 and radius 20 under the time targets.
- **Golden seeds:** a handful of fixed recipes with their land sets hashed. A failure means the output changed, so bump `GEN_VERSION` on purpose.
- Slots and conflicts: invalid picks resolve to a valid set, unknown ids are dropped.
- Preset v1 and v2 round-trip.

Bot sims: add the shapes to `bots/sim.ts` so Main, Secondary and Overload play every shape, big radii, fog and gold without crashing. This covers the "bots must hold up across map variation" goal in `Bot AI Design.md`.

**Gallery script** (`tools/mapgallery.ts`): prints N seeds of a recipe as ASCII (one character per tile type, number tokens optional). Run it before trusting any default density, ruggedness or habitat value.

## 16. Decisions and open questions

Decided by John, 2026-10-25:

- Ships and bridges come later in an expansion.
- Radius is the board radius counted in tiles from the center tile (center = 0, the ring next to it = 1; confirmed, same as today).
- A seed field is wanted, with an easy but not intrusive way to view the seed and save it as a preset.
- Editing UI is not a focus; a rework comes. Backend and functionality first.
- Split into map shape (which cells exist) and map generation (randomization), and the menu must be easy to extend with add-ons.

Decided in this design (change them if you disagree):

- Settings are `mapPicks[]` plus `mapSeed`, `mapSeedLocked` and `mapParams`, not `mapShape` plus `mapPerks[]` (section 12).
- Presets keep a snapshot. The seed is a same-version convenience (section 5.7).
- Changing settings keeps the seed. Only Regenerate and an unlocked rematch roll a new one (section 5.5).
- Player count never feeds generation (section 5.3).
- Multi-landmass shapes are selectable now and play as normal maps with more restriction (section 6.6).

Answered 2026-10-25 (still brainstorming, nothing is final):

1. **Combining shapes.** Yes, combine, but only as a proof of concept. If a combination conflicts, make the choice unique instead of fixing it.
2. **Radius counting.** Center is 0, the next ring is 1. Nothing shifts.
3. **Multi-island shapes.** Same map, same gameplay. An island nobody starts on is inaccessible for now, and ships or bridges lift the restriction later. No greying, no blocking.
4. **Seed visibility.** Non-hosts always see a read-only seed, Fog included. A host toggle to hide it can come later.

Answered the same day:

5. **Per-shape rules.** The rows are fine. One shape was missing: `continents` (added, section 6.3).
6. **Starting on a bad island.** No warning and no restriction. Players pick their own starts and live with it.

Nothing open right now.

## 17. Parked ideas

- **Symmetry.** Rotational (2, 3, 6 fold) or mirror. Generate one wedge, copy it. Every layer would need to work per orbit of cells, and counts would need to divide evenly. It would give fair 6 and 8 player maps. The pipeline leaves room for it: layers work on cell lists, so an orbit map can be added to `MapCtx` later.
- More shapes: crescent and bay, dumbbell (two masses joined by an isthmus), atoll (a broken ring), spiral, long snake for 2 players.
- More perks: wasteland (several small deserts instead of one), scarcity (one resource halved, so bank trade matters), rich mountains (gold near ore, best with `realistic`), hidden numbers (tokens revealed by adjacent roads), fog on the rim or in the core.
- A tile pack with a volcano or swamp, to prove that `habitat` makes `realistic` terrain extensible.
- `lakePorts` flag and ports on lake shores.
- Map quality score exposed to the host ("balanced", "rich west side") from `fairness` and pip stats.
- A "daily seed" for the group.


## Island clusters (Tidebound default, 2026-11-24)

Shape `island_clusters` (`src/packs/base/map/clusters.ts`). Island sizes 4 to 20 tiles, drawn about 65% small (4 to 7), 25% medium (8 to 13) and 10% large (14 to 20) until the land count of the radius is used. Islands are grouped into clusters (a lone island now and then, otherwise 2 to 6); a cluster whose disc would come within 3 tiles of another merges into it. Inside a cluster two islands keep 1 or 2 tiles of water (random per pair; a 1-tile strait is crossed by one bridge), between clusters at least 3. Islands grow one at a time, biggest first, from a free cell of their cluster's disc (wider discs, then anywhere free, when it is full). The shape declares `canvasRadius` (optional `ShapeOpDef` hook) so the canvas grows with the radius: many islands with moats need about 3.6 canvas cells per land tile. Tidebound picks it with `wide_water` (`TIDEBOUND_MAP_PICKS`).
