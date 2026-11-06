# Handoff: rework the lobby / world setup UI (it is cluttered)

Written 2026-11-05. Read `CLAUDE.md` first (its rules apply). Suggested setup: **Opus 5.5, high effort, fresh session.** The user said "do not code yet" while we discussed it, so the first thing to do is **ask the user the three open questions below** (they have not answered), then build.

## The problem (what I measured on the real screen)

Open the game, type a nickname, Create game, pick the "Tidebound + Wild Earth" scenario card. On a 1024 x 768 window the setup page has about **98 visible buttons, 61 checkboxes and 85 inputs** on one long scrolling page. It serves three jobs at once and none of them well:

- **Players/lobby**: seats, bots, bot chat, Spectate, map preview.
- **World**: 7 scenario cards, 15+ map presets, map shape, seed (Hide, Copy code, Edit, Lock), "Save map as preset".
- **Rules**: Expansions & Addons (6 DLC columns, about 60 addons, each with a full paragraph under its checkbox), Game, Timers, Special tiles, Bank and dev cards, Pieces per player, Events and fate, Tech tree.

Specific complaints:
1. The Expansions section dominates: the Tidebound column alone is taller than the screen, and most addons are off and never read.
2. Scenarios and presets do the same job (a starting point) but are two separate walls of equal-weight pills.
3. Duplicates and unexplained controls: "Save map as preset" appears twice, Seed / Hide / Copy code / Edit / Lock are tiny with no explanation.
4. Settings that belong together are scattered: Tide level and Rising rate sliders live inside the Tidebound addon text; other rules sit in sections far below.

Keep: the live map preview beside the controls, the "Active" summary strip (10 VP, Radius 2, Base game only, Events off, Tech tree off ...), and the always-visible **Start now / Continue to board** bar at the bottom.

## My proposal (ordered by payoff; the user has not approved it yet)

1. **Collapse the Expansions** to one compact row per DLC: name, on/off switch, "n of m addons" count; details expand on click; sub-addons only show when the DLC is on; long descriptions move to hover or expanded text. Smallest change that removes most of the clutter: **do this first**.
2. **Split into 3 steps or tabs: Players, World, Rules.** Only Players is needed to start. Start now stays visible.
3. **Scenario cards as the main World choice** (name, one line, DLC icons it turns on); presets and map options in a "More map options" fold.
4. **Rules grouped as collapsed sections** whose titles show the current value ("Timers: 90 s"). The Active strip stays.
5. **Optional Quick / Custom switch**: Quick shows scenario, bots and Start only.

## Open questions for the user (ask these first)

1. **Tabs, or one page with collapsible sections?** (Tabs are cleaner; collapsibles keep everything on one scroll and searchable.)
2. **Quick/Custom switch wanted, or keep every option visible?**
3. **Do presets stay, or are scenarios enough?**

## Design rules (from `Design UI Philosophy.md`, binding)

Board first; everything else flat, quiet, neutral. **Flat and matte: no gradients, no glossy highlights, no 3D button shadows**; depth comes from spacing and at most one soft shadow level. Muted warm palette, **one accent colour** ("your turn" and primary actions: here Start and the selected scenario). Quiet, short motion, respect `prefers-reduced-motion`. Phone first: tap targets at least 44 px, check the page at phone width as well as desktop. Light and dark themes from the same tokens (`styles.css` custom properties, no hard-coded colours).

### The Impeccable skill (the user wants it used)

Repo: https://github.com/pbakaus/impeccable (Apache 2.0). It is a design vocabulary for coding agents: `/impeccable <command> <target>`. Commands I read from the README: review (`critique`, `audit`), steer (`bolder`, `quieter`, `distill`, `colorize`, `typeset`, `layout`, `animate`, `delight`, `overdrive`), finish (`polish`, `harden`, `clarify`, `adapt`, `optimize`, `onboard`), live (`live`, `generate`), plan/setup (`shape`, `init`, `document`, `extract`). Most relevant here: **`shape`** (plan the UX first), **`distill`** (remove what the page does not need), **`layout`**, **`adapt`** (screen sizes), **`critique`** and **`polish`** at the end.

It is **not installed in this environment** (it was not among the user's skills or plugins). Install options from the README: `/plugin marketplace add pbakaus/impeccable` then install via `/plugin`; or `npx impeccable install` from the project root (adds a design hook); or copy `skills/impeccable` into `.claude/skills/` (project) or `~/.claude/skills/` (global). **Ask the user before installing** (it adds files and possibly a hook). Then run `/impeccable init` (it writes `PRODUCT.md`) and `/impeccable document` so it captures this philosophy in `DESIGN.md`. **Where Impeccable's advice conflicts with `Design UI Philosophy.md` (for example `bolder`, `delight`, `overdrive` push toward effects), the project philosophy wins**: flat, matte, one accent.

## Do this small thing first (my own mistake to undo)

The tech tree restyle I did on 2026-11-05 (commit `a34832b`, `src/client/render/techpanel.ts`, the CSS inside it) added **radial gradients on the node discs and glow/drop-shadow on researchable and owned techs**, which breaks the "flat and matte, no gradients" rule. The user had asked to "up it a bit", and I read that too literally. Flatten it: keep the straight parallel lanes, the lane colours (gold expansion, blue industrial), the tier badges and the wider spacing; replace the gradient discs and glows with flat discs and flat rings (a solid ring in `--accent` for researchable, `--ok` for owned), and drop the dotted/gradient backdrop in favour of the plain `--surface-2`. Small job; confirm it with the user in one line.

## Where things are

- `public/index.html`: the lobby markup (ids such as `#setRadius`, `#setTechTreeOn`; search for `Map radius`, `Tech tree`).
- `src/client/render/setup.ts`: draws the setup page. It holds the DLC/addon card list (a long array near line 116), the Active summary pills (near line 320), and the signature that decides when to redraw (near line 267).
- `src/client/mapmenu.ts`, `src/client/presets.ts`: map menu and presets. `src/client/styles.css`: all styles (CRLF line endings).
- Tests that may care: `tests/setuppage.test.ts`, `tests/mapmenu.test.ts`, `tests/presets.test.ts`. The addon texts also live on the server (`description:` in each addon file under `src/packs/tidebound/`); keep the client card list and server list in step (there is a test for the Tidebound ids).

## Run and verify

```bash
npm install
npm run build
npm start
```
Open http://localhost:3000 (the preview tool config is `.claude/launch.json` in the **vault root**, not the project; if port 3000 is busy it moves to 3001). To reach the lobby: type a nickname, Create game, click a scenario card; the page scrolls inside its container (scroll the page, not the window). The Tech button in a game only appears when "Tech tree" is ticked in the lobby (`#setTechTreeOn`).

Before you call it done: screenshots at desktop width and at phone width (the browser tool's resize preset `mobile`), light and dark theme, keyboard focus on the expand/collapse controls, and `prefers-reduced-motion`.

## Finish checklist

```bash
npm run headers:write
npm run index
npm run typecheck
npx vitest run
```
Known failures that are **not** yours (they fail at HEAD): two `tests/architecture.test.ts` cycle checks (`client/debug` is in an import cycle missing from `KNOWN_CYCLES`) and `tests/mindmap.test.ts` (`ARCHITECTURE.md` moved to `Architecture/Architecture of Code.md`). `tests/mapbudget.test.ts` can fail on timing while a game server is busy; it passes alone. Add a pass **117** at the top of `change log.md` (the current top group is "Passes 112-116"), add any new test file to the `tests/` table in `INDEX.md`, and commit with the `Co-Authored-By` line the session gives you.

## Practical notes

- No Python on this machine and the Bash tool is picky about heredocs: for multi-line edits write a small Node script file and run it (this is how all the edits so far were made). `board.ts`, `main.ts`, `styles.css` and several others use CRLF line endings; read, replace on `\n` text, and write back with `\r\n` if the file had them.
- Do not touch `tests/golden.snapshot.json`. `tests/view.snapshot.json` only changes as a reviewed diff.
- Uncommitted and not yours: `BUGS/Bug List.md` (only Bug 1 is left, and it is now fixed in commit `fad3956`; the user may want that entry removed) and `data/bot_training_logs.jsonl` (the tests append to it; do not commit it).
- The user's other open item (the map size cap of 30, "Map radius (1-50)" input) was given to another agent; do not do it unless asked.
