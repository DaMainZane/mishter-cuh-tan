// MODULE: world setup page (host only, between the name page and the board): Players / World / Rules tabs, tile preview, roster, scenario cards, compact DLC rows, rule fold values | DEPENDS ON: client/avatars, client/icons, client/socket, client/store, client/types, client/util | USED BY: client/main, client/render/index
// The controls on the page (bots, presets, map menu, rules) keep their ids and handlers; this file decides what is visible
// and draws the preview, player strip, scenario cards, live "what is on" summary, DLC rows from mapOptions, and the
// current value beside each folded rule group's title.
import { socket } from '../socket';
import { mapOptions, state } from '../store';
import { avatarFace } from '../avatars';
import { uiIcon } from '../icons';
import { esc } from '../util';
import type { AddonInfoView, DlcInfoView, ScenarioPresetView } from '../types';

let lastPreviewSig = '';
let lastRosterSig = '';
let lastDlcSig = '';

type SetupTab = 'players' | 'world' | 'rules';
const SETUP_TABS: SetupTab[] = ['players', 'world', 'rules'];
let setupTab: SetupTab = 'players';
/** DLC rows the host opened. A row only opens while its DLC is on. */
const openDlcs = new Set<string>();
type PreviewDrawer = 'tidebound' | 'rules' | null;
let previewDrawer: PreviewDrawer = null;

/** Shows one tab's panel and marks its tab selected (roving tabindex, so arrow keys move between tabs). */
function applySetupTab(): void {
  for (const t of SETUP_TABS) {
    const tab = document.getElementById(`setupTab-${t}`);
    const panel = document.getElementById(`setupPanel-${t}`);
    const on = t === setupTab;
    if (tab) {
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    if (panel) panel.hidden = !on;
  }
}

export function setSetupTab(tab: string): void {
  if (!SETUP_TABS.includes(tab as SetupTab)) return;
  setupTab = tab as SetupTab;
  applySetupTab();
}

/** Arrow keys, Home and End move between the tabs (WAI-ARIA tabs pattern). */
export function setupTabKey(ev: KeyboardEvent): void {
  const i = SETUP_TABS.indexOf(setupTab);
  const next =
    ev.key === 'ArrowRight' ? SETUP_TABS[(i + 1) % SETUP_TABS.length] :
    ev.key === 'ArrowLeft' ? SETUP_TABS[(i + SETUP_TABS.length - 1) % SETUP_TABS.length] :
    ev.key === 'Home' ? SETUP_TABS[0] :
    ev.key === 'End' ? SETUP_TABS[SETUP_TABS.length - 1] : null;
  if (!next) return;
  ev.preventDefault();
  setSetupTab(next);
  document.getElementById(`setupTab-${next}`)?.focus();
}

export function toggleDlcOpen(id: string): void {
  if (openDlcs.has(id)) openDlcs.delete(id);
  else openDlcs.add(id);
  drawScenariosAndDlcs();
  document.querySelector<HTMLElement>(`#setupDlcGrid [aria-controls="dlcBody-${CSS.escape(id)}"]`)?.focus();
}

/** Called just before the switch turns a DLC on, so the host sees its addons straight away. */
export function openDlcRow(id: string, turningOn: boolean): void {
  if (turningOn) openDlcs.add(id);
}

/** Toggle the compact Tidebound or Rules quick-edit drawer inside the sticky map preview card. */
export function togglePreviewDrawer(mode: 'tidebound' | 'rules'): void {
  previewDrawer = previewDrawer === mode ? null : mode;
  drawScenariosAndDlcs();
}

export function closePreviewDrawer(): void {
  if (previewDrawer === null) return;
  previewDrawer = null;
  drawScenariosAndDlcs();
}

/** Jump from the map preview quick-rules drawer to the full Rules tab. */
export function openAllRulesFromPreview(): void {
  previewDrawer = null;
  setSetupTab('rules');
  drawScenariosAndDlcs();
  requestAnimationFrame(() => {
    document.getElementById('setupRulesHeading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

/** Names of the Tides slider positions (1 to 5). Must match TIDE_LEVELS in packs/tidebound/tides.ts. */
const TIDE_LEVEL_NAMES = ['Very low', 'Low', 'Medium', 'High', 'Very high'];
/** Names of the Rising sea slider positions (1 to 5). Must match RISING_SEA_LEVELS in packs/tidebound/risingSea.ts. */
const RISING_SEA_LEVEL_NAMES = ['Very slow', 'Slow', 'Medium', 'Fast', 'Very fast'];

/** Fallback for the only shipped expansion (Tidebound) before `mapOptions` arrives from the server. */
const TIDEBOUND_FALLBACK_DLC: DlcInfoView = {
  id: 'tidebound',
  name: 'Tidebound',
  addons: [
    'tidebound.bridges',
    'tidebound.rickety_bridges',
    'tidebound.tides',
    'tidebound.rising_sea',
    'tidebound.harbor',
    'tidebound.fishing',
    'tidebound.wrecks',
    'tidebound.pirates'
  ]
};

const TIDEBOUND_FALLBACK_ADDONS: AddonInfoView[] = [
  { id: 'tidebound.bridges', name: 'Bridges', description: 'Roads across the sea. Both ends must touch ocean; they count toward Longest Road.', pack: 'tidebound', deps: [], links: [{ target: 'piece-cost', kind: 'mechanic' }, { target: 'history', kind: 'mechanic' }, { target: 'bot-goals', kind: 'bot' }] },
  { id: 'tidebound.rickety_bridges', name: 'Rickety bridges', description: 'A cheap bridge with 1 health that collapses on a 7. Upgrade it to a full bridge later.', pack: 'tidebound', deps: ['tidebound.bridges'], links: [{ target: 'durability', kind: 'mechanic' }, { target: 'seven-resolver', kind: 'mechanic' }, { target: 'overlay', kind: 'ui' }, { target: 'tidebound.bridges', kind: 'content' }] },
  { id: 'tidebound.tides', name: 'Tides', description: 'Coast tiles flood on a seeded schedule; a flooded tile yields half, rounded up, for every settlement and city on it. Higher ground resists.', pack: 'tidebound', deps: [], links: [{ target: 'round-clock', kind: 'mechanic' }, { target: 'tile-state', kind: 'mechanic' }, { target: 'production', kind: 'mechanic' }, { target: 'overlay', kind: 'ui' }] },
  { id: 'tidebound.rising_sea', name: 'Rising sea', description: 'Land drowns from the lowest ground up. Bridges become the only roads. Works alone or with Tides.', pack: 'tidebound', deps: [], links: [{ target: 'tile-state', kind: 'mechanic' }, { target: 'round-clock', kind: 'mechanic' }, { target: 'tidebound.tides', kind: 'content' }] },
  { id: 'tidebound.harbor', name: 'Harbor', description: 'Upgrade a port city to a harbor for 1:1 trades: click the port itself. One per player. A harbor, and any port raised to 2:1, keeps working while flooded.', pack: 'tidebound', deps: [], links: [{ target: 'trade-ratio', kind: 'mechanic' }, { target: 'piece-cost', kind: 'mechanic' }, { target: 'tidebound.tides', kind: 'mechanic' }] },
  { id: 'tidebound.fishing', name: 'Fishing', description: 'A net on a sea tile catches fish, a token that counts as any one resource. Fish icons on the sea boost the catch; feed the sea to refill them.', pack: 'tidebound', deps: [], links: [{ target: 'wild-token', kind: 'mechanic' }, { target: 'marker', kind: 'mechanic' }, { target: 'piece-cost', kind: 'mechanic' }, { target: 'tidebound.tides', kind: 'content' }] },
  { id: 'tidebound.wrecks', name: 'Shipwreck salvage', description: 'A storm leaves a wreck at sea or on the shore. The first road, bridge or port to reach it claims the loot.', pack: 'tidebound', deps: [], links: [{ target: 'marker', kind: 'mechanic' }, { target: 'event-deck', kind: 'content' }, { target: 'overlay', kind: 'ui' }, { target: 'tidebound.bridges', kind: 'mechanic' }] },
  { id: 'tidebound.pirates', name: 'Pirates', description: 'Up to 2 pirates roam the ocean and rob coastal settlements. Beating one takes knights, and it pays more than a wreck.', pack: 'tidebound', deps: [], links: [{ target: 'strength', kind: 'mechanic' }, { target: 'marker', kind: 'mechanic' }, { target: 'bot-goals', kind: 'bot' }, { target: 'tidebound.wrecks', kind: 'content' }] }
];

/** Upcoming expansions displayed in World Setup as non-interactive "Coming soon" placeholders. */
export const COMING_SOON_EXPANSIONS: readonly { id: string; name: string }[] = [
  { id: 'bulwark', name: 'Bulwark' },
  { id: 'warlords', name: 'Warlords' },
  { id: 'wildearth', name: 'Wild Earth' },
  { id: 'guildhall', name: 'Guildhall' },
  { id: 'rowdy', name: 'Rowdy Tavern' }
];

function effectiveDlcsAndAddons(): { dlcs: DlcInfoView[]; addons: Map<string, AddonInfoView> } {
  const srvDlcs = mapOptions?.dlcs && mapOptions.dlcs.length > 0 ? mapOptions.dlcs : [TIDEBOUND_FALLBACK_DLC];
  const srvAddons = mapOptions?.addons && mapOptions.addons.length > 0 ? mapOptions.addons : TIDEBOUND_FALLBACK_ADDONS;

  const dlcMap = new Map<string, DlcInfoView>();
  for (const d of srvDlcs) dlcMap.set(d.id, d);

  const addonMap = new Map<string, AddonInfoView>();
  for (const a of srvAddons) addonMap.set(a.id, a);
  return { dlcs: [...dlcMap.values()], addons: addonMap };
}

/** Tiles only: no number tokens, ports, robber or pieces. Water stays empty so the shape reads on its own. */
function drawPreview(svg: Element): void {
  const hexes = (state?.board?.hexes || []).filter((h: any) => h.type !== 'water' && Array.isArray(h.corners) && h.corners.length === 6);
  const sig = hexes.map((h: any) => `${h.q},${h.r},${h.type}`).join('|');
  if (sig === lastPreviewSig) return;
  lastPreviewSig = sig;
  if (hexes.length === 0) {
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.innerHTML = '<text x="50" y="52" text-anchor="middle" class="pv-empty">No land</text>';
    return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const h of hexes) {
    for (const c of h.corners) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
    }
  }
  const pad = 12;
  svg.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`);
  svg.innerHTML = hexes.map((h: any) => {
    const pts = h.corners.map((c: any) => `${c.x},${c.y}`).join(' ');
    return `<polygon class="pv-hex" points="${pts}" style="fill:var(--tile-${esc(h.type)}, var(--surface-3))"></polygon>`;
  }).join('');
}

function drawRoster(el: HTMLElement): void {
  const players = state?.players || [];
  const spectators = state?.spectators || [];
  const sig =
    players.map(p => `${p.id}|${p.name}|${p.avatar}|${p.color}|${p.difficulty ?? ''}`).join(';') +
    '||' +
    spectators.map(s => `${s.id}|${s.name}|${s.avatar}|${s.color}`).join(';') +
    `|${state?.settings?.maxPlayers}|${state?.hostId}|${state?.code ?? ''}`;
  if (sig === lastRosterSig) return;
  lastRosterSig = sig;
  const code = state?.code || '';
  const inviteBanner = code
    ? `<div class="setup-invite-banner">
        <div class="setup-invite-meta">
          <span class="setup-invite-label">Invite code</span>
          <strong class="setup-invite-code" id="setupRoomCodeDisplay">${esc(code)}</strong>
        </div>
        <div class="setup-invite-actions">
          <button type="button" class="btn sm" onclick="copyInviteCodeOnly()" title="Copy invite code">Copy code</button>
          <button type="button" class="btn sm primary" onclick="shareInviteCode()" title="Share invite code or link with friends">${uiIcon('link', 14)}<span>Share invite</span></button>
        </div>
      </div>`
    : '';
  const chips = players.map(p => {
    const key = String(p.difficulty || '').toLowerCase();
    const tag = p.isBot
      ? `<span class="tag tier-${esc(key)} tier-pick" onclick="cycleBotTier('${esc(p.id)}')" title="Click to change difficulty">Bot · ${esc(p.difficulty || '')}</span>`
      : p.id === state?.hostId ? '<span class="tag accent">Host</span>' : '';
    const pick = p.isBot || p.id === socket.id;
    return `<div class="setup-chip">
      <div class="avatar p-avatar ${pick ? 'avatar-pick' : ''}" style="background:${esc(p.color)}"
        ${pick ? `onclick="cycleAvatar('${esc(p.id)}')" title="Click to change avatar"` : ''}>${avatarFace(p.avatar, p.name)}</div>
      <span class="nm">${esc(p.name)}</span>${tag}
    </div>`;
  }).join('');
  const specChips = spectators.map(s => {
    const hostTag = s.id === state?.hostId ? '<span class="tag accent">Host</span>' : '';
    const pick = s.id === socket.id;
    return `<div class="setup-chip is-spectator">
      <div class="avatar p-avatar ${pick ? 'avatar-pick' : ''}" style="background:${esc(s.color)}"
        ${pick ? `onclick="cycleAvatar('${esc(s.id)}')" title="Click to change avatar"` : ''}>${avatarFace(s.avatar, s.name)}</div>
      <span class="nm">${esc(s.name)}</span>${hostTag}<span class="tag">${uiIcon('eye', 12)} Spectating</span>
    </div>`;
  }).join('');
  const specCount = spectators.length > 0 ? ` · ${spectators.length} spectating` : '';
  el.innerHTML = `${inviteBanner}<div class="setup-count">${players.length} / ${esc(state?.settings?.maxPlayers ?? '')} seats${specCount}</div>${chips}${specChips}`;
}

function drawScenariosAndDlcs(): void {
  const s = state?.settings || {};
  const dlcMap: Record<string, boolean> = s.dlc && typeof s.dlc === 'object' ? s.dlc : {};
  const addonFlags: Record<string, boolean> = s.addons && typeof s.addons === 'object' ? s.addons : {};
  const eventsOn = !!s.eventsOn;
  const fateTokens = s.fateTokens ?? 2;
  const techTreeOn = !!s.techTreeOn;
  const fairDice = !!s.fairDice;
  const tideLevel = Math.min(5, Math.max(1, Math.round(Number(s.tideLevel)) || 3));
  const risingSeaLevel = Math.min(5, Math.max(1, Math.round(Number(s.risingSeaLevel)) || 3));
  const scenarios: ScenarioPresetView[] = mapOptions?.scenarios || [];
  const { dlcs, addons } = effectiveDlcsAndAddons();

  const sig = JSON.stringify([
    dlcMap, addonFlags, eventsOn, fateTokens, techTreeOn, fairDice, tideLevel, risingSeaLevel,
    s.vpToWin, s.boardRadius, s.cardDiscardLimit, s.desertTiles, s.goldTiles, s.fogTiles,
    scenarios.length, dlcs.length, [...openDlcs], previewDrawer
  ]);
  if (sig === lastDlcSig) return;
  lastDlcSig = sig;

  // 1. Scenario cards: the main World choice (name, one line, the DLCs it turns on)
  const scenBox = document.getElementById('scenarioPresets');
  if (scenBox) {
    const dlcName = (id: string) => dlcs.find(d => d.id === id)?.name || id;
    scenBox.innerHTML = scenarios
      .map(sc => {
        const dlcKeys = Object.keys(sc.dlc).filter(k => sc.dlc[k]);
        const isCurrent =
          s.boardRadius === sc.boardRadius &&
          s.vpToWin === sc.vpToWin &&
          Boolean(s.eventsOn) === Boolean(sc.eventsOn) &&
          dlcKeys.every(k => dlcMap[k] === true) &&
          Object.keys(dlcMap).filter(k => dlcMap[k]).length === dlcKeys.length;
        const tags = (dlcKeys.length > 0 ? dlcKeys.map(dlcName) : ['Base game']).concat(sc.eventsOn ? ['Events'] : []);
        return `<button type="button" class="scenario-card${isCurrent ? ' is-current' : ''}" aria-pressed="${isCurrent}" onclick="applyScenario('${esc(sc.id)}')">
          <span class="scenario-name">${esc(sc.label)}</span>
          <span class="scenario-desc">${esc(sc.description)}</span>
          <span class="scenario-tags">${tags.map(t => `<span class="scenario-tag">${esc(t)}</span>`).join('')}</span>
        </button>`;
      })
      .join('');
  }

  // 2. Compute enabled & blocked addons (mirrors shared resolveAddons)
  const enabledAddons = new Set<string>();
  const blockedAddons: { addon: AddonInfoView; missing: string[] }[] = [];
  for (const d of dlcs) {
    if (dlcMap[d.id] !== true) continue;
    for (const aId of d.addons) {
      const a = addons.get(aId);
      if (!a) continue;
      if (addonFlags[a.id] === false) continue;
      const missing = (a.deps || []).filter(depId => !enabledAddons.has(depId));
      if (missing.length > 0) blockedAddons.push({ addon: a, missing });
      else enabledAddons.add(a.id);
    }
  }

  // 3. Live "what is on" summary strip
  const summaryBox = document.getElementById('setupActiveSummary');
  if (summaryBox) {
    const activeDlcNames = dlcs.filter(d => dlcMap[d.id] === true).map(d => d.name);
    const pills: string[] = [];
    pills.push(`<span class="summary-pill accent">${esc(s.vpToWin ?? 10)} VP · Radius ${esc(s.boardRadius ?? 2)}</span>`);
    if (activeDlcNames.length === 0) {
      pills.push(`<span class="summary-pill">Base game only (0 DLCs)</span>`);
    } else {
      pills.push(`<span class="summary-pill on">${activeDlcNames.length} DLC${activeDlcNames.length === 1 ? '' : 's'}: ${esc(activeDlcNames.join(', '))}</span>`);
      pills.push(`<span class="summary-pill">${enabledAddons.size} addon${enabledAddons.size === 1 ? '' : 's'} active</span>`);
    }
    pills.push(
      eventsOn
        ? `<span class="summary-pill on">Events ON · ${esc(fateTokens)} Fate token${fateTokens === 1 ? '' : 's'}</span>`
        : `<span class="summary-pill">Events off</span>`
    );
    pills.push(techTreeOn ? `<span class="summary-pill on">Tech tree ON</span>` : `<span class="summary-pill">Tech tree off</span>`);
    if (fairDice) pills.push(`<span class="summary-pill on">Fair dice ON</span>`);
    if (enabledAddons.has('tidebound.tides')) pills.push(`<span class="summary-pill on">Tides · ${esc(TIDE_LEVEL_NAMES[tideLevel - 1])}</span>`);
    if (enabledAddons.has('tidebound.rising_sea')) pills.push(`<span class="summary-pill on">Rising sea · ${esc(RISING_SEA_LEVEL_NAMES[risingSeaLevel - 1])}</span>`);

    const blockedHtml = blockedAddons
      .map(b => {
        const missNames = b.missing.map(m => addons.get(m)?.name || m).join(', ');
        return `<div class="dlc-dep-prompt">
          <span><strong>${esc(b.addon.name)}</strong> needs <strong>${esc(missNames)}</strong> to activate.</span>
          <button type="button" class="chip-btn chip-accent" onclick="enableAddonWithDeps('${esc(b.addon.id)}')">Enable ${esc(missNames)}</button>
        </div>`;
      })
      .join('');

    summaryBox.innerHTML = `<div class="summary-pills-row"><span class="tool-label">Active</span>${pills.join('')}</div>${blockedHtml}`;
    summaryBox.classList.toggle('has-dep-prompt', blockedAddons.length > 0);
  }

  // 3b. Quick Tidebound & Rules controls embedded inside the sticky map preview card
  const previewCard = document.getElementById('setupPreviewCard');
  const setupSide = document.getElementById('setupSide');
  const previewBar = document.getElementById('setupPreviewBar');
  const previewDrawerEl = document.getElementById('setupPreviewDrawer');
  const hasDrawer = previewDrawer !== null;
  if (previewCard) previewCard.classList.toggle('has-drawer', hasDrawer);
  if (setupSide) setupSide.classList.toggle('has-drawer', hasDrawer);

  const tideDlc = dlcs.find(d => d.id === 'tidebound') || TIDEBOUND_FALLBACK_DLC;
  const isTideOn = dlcMap.tidebound === true;
  const tideAddonList = tideDlc.addons.map(id => addons.get(id)).filter((a): a is AddonInfoView => !!a);
  const activeTideCount = tideAddonList.filter(a => enabledAddons.has(a.id)).length;
  const vpVal = Number.isFinite(Number(s.vpToWin)) ? Number(s.vpToWin) : 10;
  const radVal = Number.isFinite(Number(s.boardRadius)) ? Number(s.boardRadius) : 2;
  const discardVal = Number.isFinite(Number(s.cardDiscardLimit)) ? Number(s.cardDiscardLimit) : 7;
  const desertVal = Number.isFinite(Number(s.desertTiles)) ? Number(s.desertTiles) : 1;
  const goldVal = Number.isFinite(Number(s.goldTiles)) ? Number(s.goldTiles) : 0;
  const fogVal = Number.isFinite(Number(s.fogTiles)) ? Number(s.fogTiles) : 0;

  if (previewBar) {
    const tideMeta = isTideOn ? `${activeTideCount}/${tideAddonList.length}` : 'Off';
    previewBar.innerHTML = `
      <div class="sp-btn-group sp-tidebound${isTideOn ? ' is-on' : ''}${previewDrawer === 'tidebound' ? ' is-open' : ''}">
        <button type="button" class="sp-action-btn" aria-expanded="${previewDrawer === 'tidebound'}" aria-controls="setupPreviewDrawer" onclick="togglePreviewDrawer('tidebound')">
          <span class="sp-btn-icon">${uiIcon('waves', 15)}</span>
          <span class="sp-btn-title">Tidebound</span>
          <span class="sp-btn-meta">${esc(tideMeta)}</span>
          <span class="sp-caret">${uiIcon('chevronDown', 14)}</span>
        </button>
        <label class="sp-inline-switch" title="Toggle Tidebound expansion">
          <input type="checkbox" class="setup-switch sp-switch" role="switch" aria-label="Toggle Tidebound" ${isTideOn ? 'checked' : ''}
            onclick="event.preventDefault(); openDlcRow('tidebound', ${!isTideOn}); toggleDlc('tidebound')" />
        </label>
      </div>
      <button type="button" class="sp-action-btn sp-rules${previewDrawer === 'rules' ? ' is-open' : ''}" aria-expanded="${previewDrawer === 'rules'}" aria-controls="setupPreviewDrawer" onclick="togglePreviewDrawer('rules')">
        <span class="sp-btn-icon">${uiIcon('sliders', 15)}</span>
        <span class="sp-btn-title">Rules</span>
        <span class="sp-btn-meta">${esc(vpVal)} VP · R${esc(radVal)}</span>
        <span class="sp-caret">${uiIcon('chevronDown', 14)}</span>
      </button>`;
  }

  if (previewDrawerEl) {
    previewDrawerEl.hidden = !hasDrawer;
    if (previewDrawer === 'tidebound') {
      const addonChips = tideAddonList
        .map(a => {
          const rawWanted = addonFlags[a.id] !== false;
          const isActuallyOn = enabledAddons.has(a.id);
          const missingDeps = (a.deps || []).filter(depId => !enabledAddons.has(depId));
          const isBlocked = isTideOn && rawWanted && missingDeps.length > 0;
          const onClick = isBlocked ? `enableAddonWithDeps('${esc(a.id)}')` : `toggleAddon('${esc(a.id)}')`;
          const depNote = isBlocked
            ? `<span class="sp-addon-dep">Needs ${esc(missingDeps.map(m => addons.get(m)?.name || m).join(', '))}</span>`
            : '';
          return `<button type="button" class="sp-addon-chip${isActuallyOn ? ' is-on' : ''}${isBlocked ? ' is-blocked' : ''}" aria-pressed="${isActuallyOn}" onclick="${onClick}" title="${esc(a.description || a.name)}">
            <span class="sp-addon-dot" aria-hidden="true">${isActuallyOn ? uiIcon('check', 12) : ''}</span>
            <span class="sp-addon-name">${esc(a.name)}${depNote}</span>
          </button>`;
        })
        .join('');

      const sliders: string[] = [];
      if (enabledAddons.has('tidebound.tides')) {
        sliders.push(`<label class="sp-slider-row">
          <span class="sp-slider-label">Tide level <strong id="pvTideLevelName">${esc(TIDE_LEVEL_NAMES[tideLevel - 1])}</strong></span>
          <input type="range" min="1" max="5" step="1" value="${tideLevel}" aria-label="Tide level"
            oninput="previewTideLevel(this.value)" onchange="setTideLevel(this.value)" />
        </label>`);
      }
      if (enabledAddons.has('tidebound.rising_sea')) {
        sliders.push(`<label class="sp-slider-row">
          <span class="sp-slider-label">Rising rate <strong id="pvRisingSeaLevelName">${esc(RISING_SEA_LEVEL_NAMES[risingSeaLevel - 1])}</strong></span>
          <input type="range" min="1" max="5" step="1" value="${risingSeaLevel}" aria-label="Rising sea rate"
            oninput="previewRisingSeaLevel(this.value)" onchange="setRisingSeaLevel(this.value)" />
        </label>`);
      }

      const bodyHtml = isTideOn
        ? `<div class="sp-addon-grid">${addonChips}</div>
           ${sliders.length > 0 ? `<div class="sp-sliders">${sliders.join('')}</div>` : ''}
           <div class="sp-drawer-foot">
             <button type="button" class="sp-foot-btn" onclick="applyScenario('tidebound')">${uiIcon('map', 14)}<span>Load Tidebound Islands map</span></button>
           </div>`
        : `<p class="sp-drawer-hint">Adds bridges, tides, rising sea, harbors, fishing, shipwrecks and pirates.</p>
           <div class="sp-cta-row">
             <button type="button" class="btn sm" onclick="openDlcRow('tidebound', true); toggleDlc('tidebound')">Enable on this map</button>
             <button type="button" class="btn sm primary" onclick="applyScenario('tidebound')">Tidebound Islands</button>
           </div>`;

      previewDrawerEl.innerHTML = `
        <div class="sp-drawer-head">
          <span class="sp-drawer-title">${uiIcon('waves', 14)}<span>Tidebound</span></span>
          <button type="button" class="sp-drawer-close" aria-label="Close Tidebound panel" onclick="closePreviewDrawer()">${uiIcon('close', 14)}</button>
        </div>
        ${bodyHtml}`;
    } else if (previewDrawer === 'rules') {
      const stepper = (key: string, label: string, val: number, min: number, max: number) => `
        <div class="sp-stepper-cell">
          <span class="sp-stepper-label">${esc(label)}</span>
          <div class="sp-stepper">
            <button type="button" class="sp-step-btn" aria-label="Decrease ${esc(label)}" onclick="stepQuickRule('${esc(key)}', -1)" ${val <= min ? 'disabled' : ''}>${uiIcon('minus', 13)}</button>
            <input type="number" class="sp-num" value="${esc(val)}" min="${min}" max="${max}" aria-label="${esc(label)}" onchange="updateQuickRule('${esc(key)}', this.value)" />
            <button type="button" class="sp-step-btn" aria-label="Increase ${esc(label)}" onclick="stepQuickRule('${esc(key)}', 1)" ${val >= max ? 'disabled' : ''}>${uiIcon('plus', 13)}</button>
          </div>
        </div>`;

      previewDrawerEl.innerHTML = `
        <div class="sp-drawer-head">
          <span class="sp-drawer-title">${uiIcon('sliders', 14)}<span>Quick rules</span></span>
          <button type="button" class="sp-drawer-close" aria-label="Close Rules panel" onclick="closePreviewDrawer()">${uiIcon('close', 14)}</button>
        </div>
        <div class="sp-rules-grid">
          ${stepper('boardRadius', 'Radius', radVal, 1, 50)}
          ${stepper('vpToWin', 'VP to win', vpVal, 3, 50)}
          ${stepper('cardDiscardLimit', 'Discard >', discardVal, 3, 50)}
          ${stepper('desertTiles', 'Desert', desertVal, 0, 200)}
          ${stepper('goldTiles', 'Gold', goldVal, 0, 500)}
          ${stepper('fogTiles', 'Fog', fogVal, 0, 2000)}
        </div>
        <div class="sp-toggles-row">
          <button type="button" class="sp-toggle-pill${fairDice ? ' is-on' : ''}" aria-pressed="${fairDice}" onclick="updateQuickRule('fairDice', ${!fairDice})">Fair dice</button>
          <button type="button" class="sp-toggle-pill${eventsOn ? ' is-on' : ''}" aria-pressed="${eventsOn}" onclick="updateQuickRule('eventsOn', ${!eventsOn})">Events</button>
          <button type="button" class="sp-toggle-pill${techTreeOn ? ' is-on' : ''}" aria-pressed="${techTreeOn}" onclick="updateQuickRule('techTreeOn', ${!techTreeOn})">Tech tree</button>
        </div>
        <div class="sp-drawer-foot">
          <button type="button" class="sp-foot-btn" onclick="openAllRulesFromPreview()">${uiIcon('sliders', 14)}<span>All rules (Timers, Bank, Pieces)</span></button>
        </div>`;
    } else {
      previewDrawerEl.innerHTML = '';
    }
  }

  // 4. Expansions: one compact row per DLC (switch, "n of m addons"); its addons and settings show only when it is on and opened
  const grid = document.getElementById('setupDlcGrid');
  if (grid) {
    grid.innerHTML = dlcs
      .map(d => {
        const isDlcOn = dlcMap[d.id] === true;
        const isOpen = isDlcOn && openDlcs.has(d.id);
        const addonList = d.addons.map(id => addons.get(id)).filter((a): a is AddonInfoView => !!a);
        const activeCount = addonList.filter(a => enabledAddons.has(a.id)).length;
        const waiting = blockedAddons.filter(b => b.addon.pack === d.id).length;
        const count = isDlcOn
          ? `${activeCount} of ${addonList.length} addons${waiting > 0 ? ` · ${waiting} waiting` : ''}`
          : `${addonList.length} addons`;
        const switchHtml = `<label class="dlc-switch"><input type="checkbox" class="setup-switch" role="switch" aria-label="${esc(d.name)}" ${isDlcOn ? 'checked' : ''}
          onclick="event.preventDefault(); openDlcRow('${esc(d.id)}', ${!isDlcOn}); toggleDlc('${esc(d.id)}')" /></label>`;
        const head = isDlcOn
          ? `<button type="button" class="dlc-expand" aria-expanded="${isOpen}" aria-controls="dlcBody-${esc(d.id)}" onclick="toggleDlcOpen('${esc(d.id)}')">
              <span class="dlc-name">${esc(d.name)}</span><span class="dlc-count">${esc(count)}</span>
              <span class="dlc-caret">${uiIcon('chevronDown', 16)}</span>
            </button>`
          : `<span class="dlc-expand is-static"><span class="dlc-name">${esc(d.name)}</span><span class="dlc-count">${esc(count)}</span></span>`;
        if (!isOpen) return `<div class="dlc-row${isDlcOn ? ' is-on' : ''}"><div class="dlc-head">${head}${switchHtml}</div></div>`;

        const rowsHtml = addonList
          .map(a => {
            const rawWanted = addonFlags[a.id] !== false;
            const isActuallyOn = enabledAddons.has(a.id);
            const missingDeps = (a.deps || []).filter(depId => !enabledAddons.has(depId));
            const isBlocked = rawWanted && missingDeps.length > 0;
            const depLabels = missingDeps.map(m => addons.get(m)?.name || m).join(', ');
            return `
              <div class="dlc-addon${isActuallyOn ? ' on' : ''}${isBlocked ? ' blocked' : ''}">
                <label class="dlc-addon-label">
                  <input type="checkbox" ${rawWanted ? 'checked' : ''} onclick="event.preventDefault(); toggleAddon('${esc(a.id)}')" />
                  <span class="dlc-addon-text">
                    <span class="dlc-addon-name">${esc(a.name)}</span>
                    ${a.description ? `<span class="dlc-addon-desc">${esc(a.description)}</span>` : ''}
                  </span>
                </label>
                ${isBlocked ? `<button type="button" class="chip-btn dlc-dep-btn" onclick="enableAddonWithDeps('${esc(a.id)}')">Needs ${esc(depLabels)} · Enable</button>` : ''}
              </div>`;
          })
          .join('');

        // Settings that belong to this DLC's addons sit together under the list, not inside an addon's text.
        const settings: string[] = [];
        if (enabledAddons.has('tidebound.tides') && d.id === 'tidebound') {
          settings.push(`<label class="dlc-opt" title="High tides come more often, stay longer, reach deeper inland and flood higher ground. Low tides are the opposite.">
            <span class="dlc-opt-label">Tide level <strong id="tideLevelName">${esc(TIDE_LEVEL_NAMES[tideLevel - 1])}</strong></span>
            <input type="range" min="1" max="5" step="1" value="${tideLevel}" aria-label="Tide level"
              oninput="previewTideLevel(this.value)" onchange="setTideLevel(this.value)" />
          </label>`);
        }
        if (enabledAddons.has('tidebound.rising_sea') && d.id === 'tidebound') {
          settings.push(`<label class="dlc-opt" title="Faster rising sea starts earlier and drowns coastal land more often. Slower gives more rounds before the coast shrinks.">
            <span class="dlc-opt-label">Rising rate <strong id="risingSeaLevelName">${esc(RISING_SEA_LEVEL_NAMES[risingSeaLevel - 1])}</strong></span>
            <input type="range" min="1" max="5" step="1" value="${risingSeaLevel}" aria-label="Rising sea rate"
              oninput="previewRisingSeaLevel(this.value)" onchange="setRisingSeaLevel(this.value)" />
          </label>`);
        }

        return `
          <div class="dlc-row is-on is-open">
            <div class="dlc-head">${head}${switchHtml}</div>
            <div class="dlc-body" id="dlcBody-${esc(d.id)}">
              ${rowsHtml}
              ${settings.length > 0 ? `<div class="dlc-settings"><span class="dlc-settings-title">${esc(d.name)} settings</span>${settings.join('')}</div>` : ''}
            </div>
          </div>`;
      })
      .join('') +
      COMING_SOON_EXPANSIONS.filter(c => !dlcs.some(d => d.id === c.id))
        .map(
          c => `<div class="dlc-row is-coming-soon" aria-disabled="true">
            <div class="dlc-head">
              <span class="dlc-expand is-static"><span class="dlc-name">${esc(c.name)}</span></span>
              <span class="dlc-coming-pill">Coming soon</span>
            </div>
          </div>`
        )
        .join('');
  }
}

/** Short text for each folded rule group's title, so a closed group still says what it is set to. Pure, for tests. */
export function ruleFoldValues(s: Record<string, any>): Record<string, string> {
  const n = (v: any, d: number) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
  const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const turn = n(s.turnTimerSec, 0);
  const inc = n(s.turnIncrementSec, 0);
  const fate = n(s.fateTokens, 2);
  const dev = n(s.devKnights, 14) + n(s.devVp, 5) + n(s.devRoadBuilding, 2) + n(s.devYearOfPlenty, 2) + n(s.devMonopoly, 2);
  return {
    foldValGame: `${n(s.vpToWin, 10)} VP · radius ${n(s.boardRadius, 2)} · discard above ${n(s.cardDiscardLimit, 7)}${s.fairDice ? ' · fair dice' : ''}`,
    foldValTimers: `${turn > 0 ? `${turn} s turns${inc > 0 ? ` +${inc} s` : ''}` : 'No turn timer'} · trades ${n(s.tradeTimerSec, 20)} s`,
    foldValEvents: `${s.eventsOn ? `Events on, ${plural(fate, 'fate token')}` : 'Events off'} · tech tree ${s.techTreeOn ? 'on' : 'off'}`,
    foldValTiles: `${n(s.desertTiles, 1)} desert · ${n(s.goldTiles, 0)} gold · ${n(s.fogTiles, 0)} fog`,
    foldValBank: `${n(s.bankResourcePerType, 19)} per resource · ${plural(dev, 'dev card')}`,
    foldValPieces: `${plural(n(s.maxRoads, 15), 'road')} · ${plural(n(s.maxSettlements, 5), 'settlement')} · ${plural(n(s.maxCities, 4), 'city', 'cities')}`
  };
}

function drawFoldValues(): void {
  const vals = ruleFoldValues(state?.settings || {});
  for (const id of Object.keys(vals)) {
    const el = document.getElementById(id);
    if (el && el.textContent !== vals[id]) el.textContent = vals[id];
  }
  const count = document.getElementById('setupTabCount');
  const players = state?.players.length ?? 0;
  const text = `${players}/${state?.settings?.maxPlayers ?? ''}`;
  if (count && count.textContent !== text) count.textContent = text;
}

/** Host sees the setup page while `state.setup` is on; everyone else sees "Host is creating world" over the board. */
export function renderSetupPage(): void {
  const page = document.getElementById('setupScreen');
  const wait = document.getElementById('hostWaiting');
  if (!page || !wait) return;
  const inLobby = !!state && state.status === 'LOBBY';
  const showSetup = inLobby && !!state!.setup && state!.hostId === socket.id;
  const showWait = inLobby && !!state!.setup && state!.hostId !== socket.id;
  page.style.display = showSetup ? 'flex' : 'none';
  wait.style.display = showWait ? 'flex' : 'none';
  if (!showSetup) return;
  const specBtn = document.getElementById('btnSetupSpectate');
  if (specBtn) {
    const isSpec = !!state?.isSpectator;
    specBtn.classList.toggle('primary', isSpec);
    specBtn.innerHTML = `${uiIcon(isSpec ? 'users' : 'eye', 16)}<span>${isSpec ? 'Join seat' : 'Spectate'}</span>`;
  }
  const svg = document.getElementById('setupPreview');
  const roster = document.getElementById('setupRoster');
  if (svg) drawPreview(svg);
  if (roster) drawRoster(roster);
  applySetupTab();
  drawScenariosAndDlcs();
  drawFoldValues();
}

export { effectiveDlcsAndAddons };
