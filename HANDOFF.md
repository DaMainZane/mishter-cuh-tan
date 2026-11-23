# Session Handoff — Colonist Custom (`mishter-cuh-tan`) Mobile Port

Last updated: 2026-11-20  
Repo: `https://github.com/DaMainZane/mishter-cuh-tan.git` (based on `main` @ `aa7bc9a`, all work below is currently uncommitted on `main`)

---

## 1. Before Leaving This PC (Push Work to GitHub)

Run these commands so your home PC can pull everything (code + this `HANDOFF.md`):

```powershell
cd C:\Users\lab2-22\.gemini\antigravity\scratch\mishter-cuh-tan
git checkout -b mobile-port
git add .
git commit -m "feat(mobile): Capacitor Android app, P2P invite codes, Colonist mobile HUD & trade UI, Tidebound-only setup"
git push -u origin mobile-port
```

> **Note for your home PC:** `android/gradle.properties` currently pins `org.gradle.java.home=C:/Users/lab2-22/AppData/Local/Android/jdk-21` (Gradle 8.14.3 requires **JDK 21**, not JDK 25). On your home PC, update or remove that line to match your local JDK 21 path, and set `sdk.dir` in `android/local.properties` if building Android APKs there.

---

## 2. Copy-Paste Prompt to Resume at Home

Open `mishter-cuh-tan` (branch `mobile-port`) in Antigravity at home and paste:

```text
Read HANDOFF.md and Design UI Philosophy.md in this repo. We are continuing the mobile port of Colonist Custom (Android APK + iPhone PWA + serverless P2P invite codes). Tell me you're caught up and ready for the next task.
```

---

## 3. What Is Built & Verified

### A. Serverless P2P Multiplayer (No Backend Server Required)
- **`src/server/p2pHost.ts`**: Authoritative embedded server (`window.__HEX_EMBEDDED_HOST__`) using `VirtualIoServer` / `VirtualServerSocket`.
- **`esbuild.config.mjs`**: Bundles `dist/main.js`, `dist/public/host.js` (with `browserNodeShimPlugin` shimming `fs`/`path` to `localStorage` and `process.cwd` via `banner`), and `dist/public/app.js`.
- **`src/client/socket.ts`**: `HybridP2PSocket` supporting local embedded host, WebRTC PeerJS (`mct-room-<CODE>`), same-device `BroadcastChannel` (`mct-p2p-<CODE>`), and fallback Socket.io.
- **`src/server/socket.ts`**: Allows explicit 5-character invite codes to join/reconnect during `room.setup === true`, and supports `rematchLobby` with `openSetup: true` for returning to World Setup mid-game.
- **Tests:** `tests/mobileP2P.test.ts` (2 tests passing).

### B. Compact Colonist.io-Style Mobile HUD (Matching `Design UI Philosophy.md`)
- **`public/index.html`, `src/client/styles.css`, `src/client/render/index.ts`, `src/client/render/sidebar.ts`, `src/client/actions.ts`, `src/client/main.ts`, `src/client/icons.ts`**:
  - Top Row 1: Single gear menu button (`#mobileGearBtn`) + centered live Bank Strip (`#mobileBankStrip`). All menu actions are consolidated into `#gameSettingsMenu` (Invite code + native `navigator.share`, **World setup** button, Back to lobby, Map painter, Elevation, Fit board, Sound, Theme, Spectate, AI Log, Debug Mode).
  - Top Row 2: 4-across compact player cards (`#mobilePlayersStrip`) with VP badge, card/knight/road stats, remaining piece counters, and active-turn footer (`Your Turn`).
  - Bottom-left: Floating Log & Chat buttons (`#mobileBottomLeftFloat`) with unread badge.
  - Bottom-right: Compact Dice + Action Bar (`.center-hud`).
  - Bottom edge: Full-width compact Hand Strip (`#myHandPanel`).
  - Touch ergonomics: 1-finger pan, 2-finger pinch-to-zoom, 44 px invisible hit slop (`nearestDist = 22`), swipe-to-dismiss sheets, Android back-gesture guard (`popstate`), and flying card animations preserved.

### C. Compact Colonist.io-Style Trading UI (Verified at `390×844`)
- **`public/index.html`, `src/client/render/drawer.ts`, `src/client/icons.ts`, `src/client/styles.css`**:
  - Fixed-height (`141px`) 2-column Trade Composer (`#inlineDrawerWrap.is-trade-mode`) docked 6 px above the Hand Strip (hiding `.center-hud` while open):
    - Left: 1-row resource picker strip with port ratios + compact `Fix bank` pill + bank icon, over a 2-row Get/Give tray.
    - Right: 3 stacked square buttons — **Bank**, **Players** (`--accent` when ready, quiet `--surface` when unavailable), and **Close (`✕`)**.
  - Slim Active Trade Offer (`#activeTradeModal`) positioned 6 px below the active player's `Your Turn` badge, with flush alignment and compact responder/action boxes.
  - Leaves **388 px** of unobstructed open hex board visible even when both active offer and trade composer are open simultaneously, with Log/Chat floating 9 px clear above the composer.
  - `buildOverlappingStackHtml` in `src/client/icons.ts` now uses CSS vars (`--card-w`, `--card-step`) instead of hardcoded 48 px widths.

### D. World Setup Cleanup (Tidebound Only Live; Others Marked "Coming soon")
- **`src/client/render/setup.ts`, `src/server/mapmenu.ts`, `src/server/lobby.ts`, `src/server/socket.ts`, `src/client/actions.ts`, `src/client/styles.css`, `tests/setuppage.test.ts`**:
  - Removed all 5 unimplemented expansion definitions and 44 fake addon specs (`Bulwark`, `Warlords`, `Wild Earth`, `Guildhall`, `Rowdy Tavern`) from `setup.ts`, removed their broken scenarios from `SCENARIO_PRESETS`, removed dead deps from `actions.ts`, and restricted `mergeSettingsDetailed` in `lobby.ts` to registered packs only (`tidebound`).
  - **World tab → Scenarios:** Only **Standard Catan** and **Tidebound** (activates wide-water islands, radius 7, tech tree, events).
  - **Rules tab → Expansions:** **Tidebound** is live & toggleable (8 addons + Tide/Rising sea sliders); **Bulwark**, **Warlords**, **Wild Earth**, **Guildhall**, and **Rowdy Tavern** render below it as quiet muted `"Coming soon"` rows (no switches or checkboxes).
  - Base-tier root techs in `src/packs/base/techRoots.ts` and core `src/shared/stage1.ts` services remain intact.

### E. Performance & Android Native App
- **Fast Drag/Pan on Big & Tidebound Maps (`src/client/render/terrainCanvas.ts`, `src/client/render/board.ts`):** Pre-renders the entire terrain layer to a single offscreen bitmap atlas (`atlasCanvas`, max 2400 px) so dragging blits in 1 `drawImage` call (<0.2 ms, zero chunk loading), paired with GPU `translate(...)` drag preview and paused SVG pulse animations while dragging.
- **Capacitor Android & PWA (`capacitor.config.json`, `android/`, `public/manifest.json`, `public/sw.js`, `public/icon.svg`):**
  - `android/app/src/main/java/com/colonistcustom/hexsettlers/MainActivity.java` enables immersive fullscreen (`WindowInsetsControllerCompat.hide(systemBars())` + transient swipe bars) with safe cutout padding for iOS/Android.
  - Latest built APK: `android/app/build/outputs/apk/debug/app-debug.apk`.

---

## 4. Critical Rules & Gotchas

- **Design Philosophy is binding (`Design UI Philosophy.md`):** Lichess board-first neutral shell + Mini Metro flat pictograms + Dorfromantik warm muted matte palette. **No gradients, no glossy highlights, no decorative borders, no hardcoded hex colors** — use CSS tokens (`--surface`, `--surface-2`, `--surface-3`, `--ink`, `--ink-dim`, `--accent`, `--ok`, `--danger`, `--r`, `--r-lg`, `--shadow`) so light and dark modes stay consistent.
- **Keep flying card animations intact** across production, bank trades, player trades, and steals.
- **Repo guard checks (run after every code change):**
  ```powershell
  npm run headers:write
  npm run index
  npm run typecheck
  npm run build:mobile
  ```
- **Test constraints:**
  - `tests/architecture.test.ts`: `client` may only import `client` and `shared`; `server` never imports `client`.
  - `tests/terrainCanvas.test.ts`: `board.ts` must NOT contain `translate3d(` (use plain `translate(`).
  - `tests/tideboundtides.test.ts`: `overlay.ts` must keep class `hex-overlay-pulse` (disable mobile/drag pulse in CSS, not by stripping the class).
  - `tests/mindmap.test.ts`: already fails at upstream HEAD (`aa7bc9a`) because `ARCHITECTURE.md` moved to `Architecture/Architecture of Code.md`.
- **Last verified test run:** 10 suites / 90 tests passing (`setuppage`, `tideboundlobby`, `tideboundmapdefaults`, `addons`, `stage1`, `techroots`, `mobileP2P`, `architecture`, `headers`, `index`) + `terrainCanvas` passing + `tsc --noEmit` passing + `gradlew.bat assembleDebug` passing.

---

## 5. Next Steps (Where We Left Off)

The user just asked how to share the game so a friend can download/install it on their **iPhone**. Ready-to-do next tasks:

1. **Shareable Free iPhone PWA Setup (Recommended):**
   - Generate a `180×180` PNG `apple-touch-icon` (plus `192×192` and `512×512` PNG icons) and wire them into `public/index.html` and `public/manifest.json` (iOS ignores SVG for Home Screen icons).
   - Add a GitHub Actions workflow to deploy `dist/public/` to **GitHub Pages** (or deploy to Cloudflare Pages / Netlify) so the user gets a permanent `https://...` URL that friends open in Safari → **Share → Add to Home Screen** and cross-play with the Android APK via 5-character invite codes.
2. **Real-Device Testing:**
   - Test cross-play between the Android APK (`app-debug.apk`) and an iPhone Safari PWA over two different networks (Wi-Fi + cellular) to verify WebRTC PeerJS connectivity and STUN/ICE behavior.
3. **Optional Native iOS Project:**
   - If the user later wants TestFlight / App Store: install `@capacitor/ios`, run `npx cap add ios`, configure fullscreen status-bar / home-indicator hiding in `ios/`, and add a `macos-latest` GitHub Actions workflow.
