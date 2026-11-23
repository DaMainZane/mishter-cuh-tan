# Colonist Custom (`HexSettlers Online`)

A customizable Catan-style board game for private groups (up to 8 players), playable as a native **Android APK** or in phone and PC browsers with **serverless P2P invite codes** (no backend required). Includes bots with three difficulty tiers, a seeded map generator with a map menu, custom map presets, full trading with counter offers, gold and fog modes, and the **Tidebound** expansion.

## Download Android APK

- **[Download `project-colonist-custom-1.0.apk` (v1.0)](https://github.com/DaMainZane/mishter-cuh-tan/releases/latest/download/project-colonist-custom-1.0.apk)** · [View all releases](https://github.com/DaMainZane/mishter-cuh-tan/releases/latest)

**How to install on Android:**
1. Tap the download link above on your Android phone (or download on PC and transfer the `.apk` file).
2. Open `project-colonist-custom-1.0.apk` and allow installing from unknown sources if prompted.
3. Launch **Colonist Custom** — create a room to get a 5-character invite code, or enter a friend's invite code to join via P2P.

Current state: see `change log.md` and `HANDOFF.md`. Next work: see `Backlog Priority.md`.

## Quick start

```
npm install
npm run dev        # watch, rebuild and restart on http://localhost:3000
npm run build      # production bundle in dist/
npm start          # run dist/main.js
npm test           # vitest
npm run typecheck
npm run headers    # report file headers that are missing or out of date
npm run headers:write   # fix them (adds DEPENDS ON / USED BY from the imports)
npm run index      # regenerate the src tables in INDEX.md from the file headers
```

## Where things are

| Folder | What lives there |
|---|---|
| `src/shared/` | Pure game engine and map generator (no sockets, DOM or timers). Runs on server and client |
| `src/packs/` | Game content registered as packs: `base`, `gold`, `fog`, `tidebound`; `_template` is an example, not shipped |
| `src/server/` | Express and Socket.io adapter over the engine, rooms and lobby, bots in `bots/` |
| `src/client/` | Browser client (TypeScript, SVG board, `render/` for screens) |
| `public/` | Static page (`index.html`), copied to `dist/public` |
| `tests/` | Unit tests and bot-vs-bot simulations, plus the header and architecture guards |
| `scripts/` | `headers.mjs` (file header tool), `index.mjs` (generates the `src/` tables in `INDEX.md`) |

`INDEX.md` lists every file and what it does. **To change something, start with `ROUTER.md`** (task to files), then `EXTENSION POINTS.md` (every registration method, hook and registry) and `RECIPES.md` (five step-by-step recipes: piece, action, addon, tech node, client overlay). `src/packs/_template/` is a copyable example addon that is never shipped. `CLAUDE.md` tells Claude Code how to work in this repo.

## How it works

- **Content is data.** Resources, tiles, pieces, dev cards, awards, ports, phases and actions are definitions registered by packs. A pack can add content without changing the engine.
- **The engine is pure.** State is plain JSON, randomness comes from a seeded RNG, and every change goes through `dispatch`. Humans and bots use the same path.
- **The server is authoritative.** It sends each player a filtered view, so hidden hands, hidden tiles and dev cards never leak.
- **Maps are recipes.** A recipe (seed, radius, picks, params) is turned into a board by `generateMap`, with each stage on its own RNG stream. The same share code gives the same map. Details in `Map Generation Design.md`.
- **Bots.** Tiers (Main, Secondary, Overload) are plain data profiles that the brain reads. `sim.ts` runs bot-vs-bot games for testing and tier tuning. Details in `Bot AI Design.md` and `Bot Dialogue Design.md`.
- **Every source file** starts with `// MODULE: what | DEPENDS ON: a, b | USED BY: c, d`. Write the description for a new file and run `npm run headers:write` to fill in the two lists, then `npm run index` to update `INDEX.md`. `tests/headers.test.ts` fails if a file has no description, and `tests/index.test.ts` fails if `INDEX.md` is stale.
- **Import boundaries are tested.** `tests/architecture.test.ts` enforces which folder may import which, and fails on new circular imports. Rules are at the top of that file.
- **Rework in progress.** See `Handoff - Modular Rework.md` before changing structure.

## Server endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | Health check (used by the host) |
| `GET /api/bot-training-logs` | Export bot training data (`?room=CODE`, `?format=json` or `jsonl`) |
| `POST /api/bot-training-sim` | Run a headless self-play batch for training data |

Training data is stored in `data/bot_training_logs.jsonl`.

## Hosting

`render.yaml` deploys to Render (Singapore, free plan, auto deploy). The `Dockerfile` builds a Node 20 image that runs `dist/main.js` on port 3000. Set `PORT` in the environment to change it (see `.env.example`).

## Design docs

| File | Topic |
|---|---|
| `Design UI Philosophy.md` | Visual direction and design tokens |
| `Map Generation Design.md` | Map generator |
| `Bot AI Design.md` | Bot tiers and brain |
| `Bot Dialogue Design.md` | Bot chat |
