// MODULE: client UI actions (host-only edit guard, build mode and brush selection, affordability checks, requests sent to the server) | DEPENDS ON: client/audio, client/avatars, client/pieceModel, client/pieceui, client/render/board, client/render/index, +3 more | USED BY: client/main, client/render/index
import { playTone } from './audio';
import { socket } from './socket';
import {
  state, activeBrush, buildMode, setBuildModeValue, setDrawerMode,
  setVictoryTab, setHideVictoryOverlay, spectateTargetId, setSpectateTargetId
} from './store';
import { renderAll, renderVictoryScreen } from './render/index';
import { canClientAffordPiece, canClientAffordFeed, canClientAffordHarbor } from './render/board';
import { showToast } from './ui';
import { pieceModeHint } from './pieceui';
import { portRaiseSpots } from './pieceModel';
import { AVATAR_CHOICES } from './avatars';

// Map and lobby editing belongs to the host. Everyone else points with a cursor (Shift = laser).
function requireHost(what: string): boolean {
  if (!state || state.hostId === socket.id) return true;
  showToast(`Only the host can ${what}.`);
  return false;
}

/** Click your avatar in the lobby to step to the next free one (the host can do it for bots). */
export function cycleAvatar(playerId: string): void {
  if (!state || state.status !== 'LOBBY') return;
  const player = state.players.find(p => p.id === playerId) || (state.spectators || []).find(s => s.id === playerId);
  if (!player) return;
  const taken = new Set([
    ...state.players.filter(p => p.id !== playerId).map(p => p.avatar),
    ...(state.spectators || []).filter(s => s.id !== playerId).map(s => s.avatar)
  ]);
  const start = AVATAR_CHOICES.indexOf(player.avatar);
  for (let i = 1; i <= AVATAR_CHOICES.length; i++) {
    const next = AVATAR_CHOICES[(start + i + AVATAR_CHOICES.length) % AVATAR_CHOICES.length];
    if (taken.has(next)) continue;
    socket.emit('setAvatar', { code: state.code, playerId, avatar: next });
    playTone(540, 0.05);
    return;
  }
}

// ---------- Landing / lobby / reconnect ----------

const CLIENT_ID_KEY = 'catan_client_id';
const SAVED_NAME_KEY = 'catan_player_name';
const SAVED_ROOM_KEY = 'catan_last_room';

export function getClientId(): string {
  try {
    let cid = localStorage.getItem(CLIENT_ID_KEY);
    if (!cid) {
      cid = 'cid_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString(36);
      localStorage.setItem(CLIENT_ID_KEY, cid);
    }
    return cid;
  } catch {
    return 'cid_ephemeral';
  }
}

export function saveSessionInfo(code?: string, name?: string): void {
  try {
    if (code) localStorage.setItem(SAVED_ROOM_KEY, code);
    if (name) localStorage.setItem(SAVED_NAME_KEY, name);
    syncRejoinButton();
  } catch {}
}

export function clearSavedRoom(): void {
  try {
    localStorage.removeItem(SAVED_ROOM_KEY);
    syncRejoinButton();
  } catch {}
}

export function getSavedSession(): { clientId: string; code: string; name: string } {
  try {
    return {
      clientId: getClientId(),
      code: (localStorage.getItem(SAVED_ROOM_KEY) || '').trim().toUpperCase(),
      name: (localStorage.getItem(SAVED_NAME_KEY) || '').trim()
    };
  } catch {
    return { clientId: getClientId(), code: '', name: '' };
  }
}

export function syncRejoinButton(): void {
  const btn = document.getElementById('rejoinLastGameBtn') as HTMLButtonElement | null;
  const lbl = document.getElementById('rejoinLastGameLbl');
  if (!btn) return;
  const { code, name } = getSavedSession();
  const nameInput = document.getElementById('playerNameInput') as HTMLInputElement | null;
  if (nameInput && !nameInput.value && name) {
    nameInput.value = name;
  }
  if (code) {
    btn.style.display = 'inline-flex';
    if (lbl) lbl.textContent = `Reconnect (${code})`;
  } else {
    btn.style.display = 'none';
  }
}

function getRequiredPlayerName(): string | null {
  const input = document.getElementById('playerNameInput') as HTMLInputElement | null;
  const name = (input?.value || '').trim();
  if (!name) {
    showToast('Please enter a nickname first.');
    input?.focus();
    return null;
  }
  saveSessionInfo(undefined, name);
  return name;
}

export function createRoom(spectate = false): void {
  const name = getRequiredPlayerName();
  if (!name) return;
  socket.emit('createRoom', { name, clientId: getClientId(), spectate });
}

export function joinRoom(): void {
  const name = getRequiredPlayerName();
  if (!name) return;
  socket.emit('joinRoom', {
    code: (document.getElementById('roomCodeInput') as HTMLInputElement).value,
    name,
    clientId: getClientId()
  });
}

export function spectateRoom(): void {
  const name = getRequiredPlayerName();
  if (!name) return;
  socket.emit('spectateRoom', {
    code: (document.getElementById('roomCodeInput') as HTMLInputElement).value,
    name,
    clientId: getClientId()
  });
}

export function toggleSpectate(): void {
  if (!state?.code) return;
  socket.emit('toggleSpectate', { code: state.code });
  playTone(520, 0.06);
}

export function selectSpectateTarget(playerId: string | null): void {
  const next = playerId && spectateTargetId === playerId ? null : playerId;
  setSpectateTargetId(next);
  playTone(500, 0.04);
  renderAll();
}

export function rejoinSavedRoom(): void {
  const { clientId, code, name } = getSavedSession();
  const inputName = ((document.getElementById('playerNameInput') as HTMLInputElement | null)?.value || '').trim() || name;
  if (!code && !clientId) {
    showToast('No saved game session to reconnect.');
    return;
  }
  if (inputName) {
    saveSessionInfo(code || undefined, inputName);
  }
  socket.emit('reconnectRoom', { code, clientId, name: inputName });
}

export function downloadTrainingLog(): void {
  const roomQuery = state?.code ? `?room=${encodeURIComponent(state.code)}&format=jsonl` : '?format=jsonl';
  const a = document.createElement('a');
  a.href = `/api/bot-training-logs${roomQuery}`;
  a.download = `bot-training-${state?.code || 'all'}.jsonl`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  playTone(600, 0.08);
  showToast('Downloading AI bot training log (.jsonl)');
}

export function copyInviteLink(): void {
  if (!state) return;
  const url = `${window.location.origin}/?room=${state.code}`;
  navigator.clipboard.writeText(url).then(
    () => showToast('Invite link copied'),
    () => showToast(url)
  );
  playTone(660, 0.1);
}

export function switchLobbyTab(tab: string): void {
  // The dock only holds the map painter now (rules moved to the setup page); kept so old callers do not break.
  document.getElementById('tabBtnMap')?.classList.toggle('active', tab === 'map');
  document.getElementById('tabBtnCards')?.classList.toggle('active', tab === 'cards');
  const mapTab = document.getElementById('lobbyTabMap');
  const cardsTab = document.getElementById('lobbyTabCards');
  if (mapTab) mapTab.style.display = tab === 'map' ? 'flex' : 'none';
  if (cardsTab) cardsTab.style.display = tab === 'cards' ? 'flex' : 'none';
}

/** Host: open the world setup page (true) or go on to the board (false). While it is open nobody new can join. */
export function setSetupOpen(open: boolean): void {
  if (!state || state.status !== 'LOBBY') return;
  if (!requireHost('change the world setup')) return;
  if (!open) {
    // Landing on the board: show the painter dock.
    const dock = document.getElementById('lobbyToolbar');
    if (dock) dock.style.display = 'flex';
  }
  socket.emit('setSetup', { code: state.code, open });
  playTone(open ? 460 : 560, 0.05);
}

export function toggleLobbyToolbar(): void {
  if (state && state.status !== 'LOBBY') {
    toggleGameMenu();
    return;
  }
  const el = document.getElementById('lobbyToolbar')!;
  const show = el.style.display === 'none';
  // The dock and the game menu sit in the same corner, so only one is open at a time.
  if (show) {
    const menu = document.getElementById('gameSettingsMenu');
    if (menu) menu.style.display = 'none';
  }
  el.style.display = show ? 'flex' : 'none';
}

/** After "Back to lobby" (and Play again): close the game menu and fold the dock away. The settings button brings the dock back. */
export function collapseLobbyUi(): void {
  const menu = document.getElementById('gameSettingsMenu');
  if (menu) menu.style.display = 'none';
  const dock = document.getElementById('lobbyToolbar');
  if (dock) dock.style.display = 'none';
}

export function toggleGameMenu(forceShow?: boolean): void {
  const menu = document.getElementById('gameSettingsMenu');
  if (!menu) return;
  const shouldShow = typeof forceShow === 'boolean' ? forceShow : menu.style.display === 'none';
  if (shouldShow) {
    const dock = document.getElementById('lobbyToolbar');
    if (dock) dock.style.display = 'none';
  }
  menu.style.display = shouldShow ? 'flex' : 'none';
  playTone(500, 0.05);
}

export function setBrush(type: string, value: string, btn?: HTMLElement): void {
  if (!requireHost('edit the map')) return;
  const isSame = activeBrush.type === type && activeBrush.value === value;
  activeBrush.type = isSame ? '' : type;
  activeBrush.value = isSame ? '' : value;
  document.querySelectorAll('.brush-btn').forEach(b => b.classList.remove('active'));
  if (!isSame && btn) btn.classList.add('active');
  renderAll();
}

export function applyPreset(preset: string): void {
  if (!state) return;
  if (!requireHost('apply map presets')) return;
  if (wheelSettingsTimer !== null) {
    clearTimeout(wheelSettingsTimer);
    wheelSettingsTimer = null;
  }
  lastWheelEditAt = 0;
  const targetRadius = preset === 'standard' ? 2 : 5;
  const radiusEl = document.getElementById('setRadius') as HTMLInputElement | null;
  if (radiusEl) radiusEl.value = String(targetRadius);
  socket.emit('applyMapPreset', { code: state.code, preset });
  playTone(520, 0.08);
}

export function applyScenario(scenarioId: string): void {
  if (!state) return;
  if (!requireHost('apply scenarios')) return;
  if (wheelSettingsTimer !== null) {
    clearTimeout(wheelSettingsTimer);
    wheelSettingsTimer = null;
  }
  lastWheelEditAt = 0;
  const targetRadius = scenarioId === 'standardCatan' ? 2 : 5;
  const radiusEl = document.getElementById('setRadius') as HTMLInputElement | null;
  if (radiusEl) radiusEl.value = String(targetRadius);
  socket.emit('applyScenario', { code: state.code, scenarioId });
  playTone(560, 0.08);
}

export function toggleDlc(dlcId: string): void {
  if (!state || !requireHost('change DLC settings')) return;
  const curDlc = state.settings?.dlc && typeof state.settings.dlc === 'object' ? { ...state.settings.dlc } : {};
  curDlc[dlcId] = !curDlc[dlcId];
  socket.emit('updateSettings', { code: state.code, newSettings: { dlc: curDlc } });
  playTone(curDlc[dlcId] ? 560 : 440, 0.05);
}

export function toggleAddon(addonId: string): void {
  if (!state || !requireHost('change addon settings')) return;
  const packId = addonId.split('.')[0];
  const curDlc = state.settings?.dlc && typeof state.settings.dlc === 'object' ? { ...state.settings.dlc } : {};
  if (!curDlc[packId]) curDlc[packId] = true;
  const curAddons = state.settings?.addons && typeof state.settings.addons === 'object' ? { ...state.settings.addons } : {};
  const currentlyOn = curAddons[addonId] !== false;
  curAddons[addonId] = !currentlyOn;
  socket.emit('updateSettings', { code: state.code, newSettings: { dlc: curDlc, addons: curAddons } });
  playTone(curAddons[addonId] ? 540 : 460, 0.04);
}

/** Names of the Tides slider positions (1 to 5). Must match TIDE_LEVELS in packs/tidebound/tides.ts. */
const TIDE_LEVEL_NAMES = ['Very low', 'Low', 'Medium', 'High', 'Very high'];
/** Names of the Rising sea slider positions (1 to 5). Must match RISING_SEA_LEVELS in packs/tidebound/risingSea.ts. */
const RISING_SEA_LEVEL_NAMES = ['Very slow', 'Slow', 'Medium', 'Fast', 'Very fast'];

/** While the Tides slider is dragged: show the name of the position under the thumb. Nothing is sent until it is let go. */
export function previewTideLevel(value: string | number): void {
  const n = Math.min(5, Math.max(1, Math.round(Number(value)) || 3));
  const el = document.getElementById('tideLevelName');
  if (el) el.textContent = TIDE_LEVEL_NAMES[n - 1];
}

/** Host: set the Tides level (1 low to 5 high). On or off is the Tides addon checkbox. */
export function setTideLevel(value: string | number): void {
  if (!state || !requireHost('change the tide level')) return;
  const n = Math.min(5, Math.max(1, Math.round(Number(value)) || 3));
  socket.emit('updateSettings', { code: state.code, newSettings: { tideLevel: n } });
  playTone(420 + n * 30, 0.04);
}

/** While the Rising sea slider is dragged: show the name of the position under the thumb. */
export function previewRisingSeaLevel(value: string | number): void {
  const n = Math.min(5, Math.max(1, Math.round(Number(value)) || 3));
  const el = document.getElementById('risingSeaLevelName');
  if (el) el.textContent = RISING_SEA_LEVEL_NAMES[n - 1];
}

/** Host: set the Rising sea level (1 slow to 5 fast). On or off is the Rising sea addon checkbox. */
export function setRisingSeaLevel(value: string | number): void {
  if (!state || !requireHost('change the rising sea rate')) return;
  const n = Math.min(5, Math.max(1, Math.round(Number(value)) || 3));
  socket.emit('updateSettings', { code: state.code, newSettings: { risingSeaLevel: n } });
  playTone(420 + n * 30, 0.04);
}

export function enableAddonWithDeps(addonId: string): void {
  if (!state || !requireHost('enable addon dependencies')) return;
  const curDlc = state.settings?.dlc && typeof state.settings.dlc === 'object' ? { ...state.settings.dlc } : {};
  const curAddons = state.settings?.addons && typeof state.settings.addons === 'object' ? { ...state.settings.addons } : {};
  const enableRecursive = (id: string) => {
    const packId = id.split('.')[0];
    if (packId) curDlc[packId] = true;
    curAddons[id] = true;
  };
  enableRecursive(addonId);
  // Also enable known cross-addon and cross-DLC deps
  const knownDeps: Record<string, string[]> = {
    'heartland.harvest_festival': ['heartland.estates'],
    'tidebound.harbors': ['tidebound.ships'],
    'tidebound.rising_sea': ['tidebound.bridges'],
    'bulwark.gates': ['bulwark.walls'],
    'bulwark.garrison': ['bulwark.walls'],
    'ledger.contracts': ['ledger.coins'],
    'ledger.loans': ['ledger.coins'],
    'wayfarers.relics': ['wayfarers.outposts'],
    'crimson.siege': ['bulwark.walls'],
    'crimson.bounties': ['crimson.raiders'],
    'whispers.rumors': ['whispers.pacts'],
    'whispers.overthrow': ['whispers.pacts'],
    'wildlands.plague': ['wildlands.seasons']
  };
  for (const dep of knownDeps[addonId] || []) {
    enableRecursive(dep);
  }
  socket.emit('updateSettings', { code: state.code, newSettings: { dlc: curDlc, addons: curAddons } });
  playTone(580, 0.06);
}

let wheelSettingsTimer: any = null;
let lastWheelEditAt = 0;

export function isPendingSettingsPush(): boolean {
  return wheelSettingsTimer !== null || (performance.now() - lastWheelEditAt < 260);
}

export function schedulePushSettings(): void {
  lastWheelEditAt = performance.now();
  if (wheelSettingsTimer !== null) clearTimeout(wheelSettingsTimer);
  wheelSettingsTimer = setTimeout(() => {
    wheelSettingsTimer = null;
    pushSettings();
  }, 110);
}

export function pushSettings(): void {
  if (wheelSettingsTimer !== null) {
    clearTimeout(wheelSettingsTimer);
    wheelSettingsTimer = null;
  }
  if (!state) return;
  if (state.hostId !== socket.id) {
    showToast('Only the host can change settings.');
    renderAll();
    return;
  }
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value;
  const chk = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.checked;
  socket.emit('updateSettings', {
    code: state.code,
    newSettings: {
      boardRadius: val('setRadius'),
      vpToWin: val('setVp'),
      maxPlayers: val('setMaxP'),
      cardDiscardLimit: val('setDiscard'),
      turnTimerSec: val('setTurnTime'),
      turnIncrementSec: val('setTurnInc'),
      tradeTimerSec: val('setTradeTime'),
      botChat: val('setBotChat'),
      goldTiles: val('setGold'),
      desertTiles: val('setDesert'),
      fogTiles: val('setFog'),
      bankResourcePerType: val('setBankRes'),
      devKnights: val('setDevKnight'),
      devVp: val('setDevVp'),
      devRoadBuilding: val('setDevRb'),
      devYearOfPlenty: val('setDevYop'),
      devMonopoly: val('setDevMono'),
      maxRoads: val('setMaxRoad'),
      maxSettlements: val('setMaxSettle'),
      maxCities: val('setMaxCity'),
      eventsOn: chk('setEventsOn'),
      fateTokens: val('setFateTokens'),
      techTreeOn: chk('setTechTreeOn'),
      fairDice: chk('setFairDice')
    }
  });
}

const BOT_TIERS = ['main', 'secondary', 'overload'];

export function addBot(): void {
  if (!requireHost('add bots')) return;
  const tier = (document.getElementById('botTier') as HTMLSelectElement | null)?.value || 'main';
  socket.emit('addBot', { code: state.code, tier });
}

/** Host only, lobby only: click a bot's tier tag to step Main -> Secondary -> Overload -> Main. */
export function cycleBotTier(playerId: string): void {
  if (!state || state.status !== 'LOBBY') return;
  if (!requireHost('change a bot\'s difficulty')) return;
  const bot = state.players.find(p => p.id === playerId && p.isBot);
  if (!bot) return;
  const cur = BOT_TIERS.indexOf(String(bot.difficulty || '').toLowerCase());
  const next = BOT_TIERS[(cur + 1) % BOT_TIERS.length];
  socket.emit('setBotTier', { code: state.code, playerId, tier: next });
  playTone(540, 0.05);
}
export function removeBot(): void { if (requireHost('remove bots')) socket.emit('removeBot', { code: state.code }); }
export function startGame(): void { if (requireHost('start the game')) socket.emit('startGame', { code: state.code }); }

export function rematchLobby(): void {
  setHideVictoryOverlay(false);
  socket.emit('rematchLobby', { code: state.code });
}

export function switchVictoryTab(tab: string): void {
  setVictoryTab(tab);
  document.querySelectorAll<HTMLElement>('.vic-tab[data-vtab]').forEach(el => {
    el.classList.toggle('active', el.dataset.vtab === tab);
  });
  renderVictoryScreen();
}

export function toggleVictoryMapInspect(hide: boolean): void {
  setHideVictoryOverlay(hide);
  renderVictoryScreen();
}

// ---------- Turn actions ----------

export function setBuildMode(mode: string): void {
  const turningOn = buildMode !== mode;
  setBuildModeValue(turningOn ? mode : null);
  // Net mode draws only the sea tiles the server listed, so say why when there is nothing to click.
  if (turningOn && mode === 'net' && state) {
    const me = state.players.find(p => p.id === socket.id);
    if (me && !(me.netsLeft ?? 0)) showToast('You have no nets left.');
    else if (me && !canClientAffordPiece(me, 'net')) showToast('Not enough resources for a net.');
    else if (me && !me.netSpots?.length) showToast('A net goes on a free sea tile that touches a coast corner next to your road or bridge: build one there first (a tile holds one net).');
  }
  // Feed mode draws only the sea tiles the server listed (next to one of your nets, not full).
  if (turningOn && mode === 'feed' && state) {
    const me = state.players.find(p => p.id === socket.id);
    if (me && !canClientAffordFeed(me)) showToast('You cannot pay for feeding the sea.');
    else if (me && !me.feedSpots?.length) showToast('Feed a sea tile next to one of your nets that is not full yet.');
  }
  // Harbor mode highlights your own cities on ports that can be upgraded to a 1:1 harbor.
  if (turningOn && mode === 'harbor' && state) {
    const me = state.players.find(p => p.id === socket.id);
    if (me && (me.harborsLeft ?? 1) <= 0) showToast('You have already built your harbor.');
    else if (me && !me.harborCost) {
      // Only Harbor charters so far (no 1:1 harbor tech): the nodes are the port cities that can be raised to 2:1 (BUG 4).
      const raise = portRaiseSpots(state.techActions?.harbor, true);
      if (raise.length === 0) showToast('Build a city on a 3:1 port to raise it to 2:1.');
      else if (!raise.some(s => s.affordable)) showToast('Not enough resources to raise a port.');
      else showToast('Click a glowing port to raise it to 2:1.');
    }
    else if (me && !canClientAffordHarbor(me)) showToast('Not enough resources for a harbor.');
    else if (me && !me.harborSpots?.length) showToast('Build a city on a port first to upgrade it to a harbor.');
  }
  // R8.7: a generated mode (a manifest piece or action) says why there is nothing to click, from its own hint texts. Empty for the hand-written modes above.
  if (turningOn && state) {
    const hint = pieceModeHint(mode, state.players.find(p => p.id === socket.id));
    if (hint) showToast(hint);
  }
  renderAll();
}

export function mainTurnButton(): void {
  if (state.phase === 'MAIN') endTurn();
}

export function rollDice(): void {
  if (!state || !state.code) return;
  const d1 = document.getElementById('die1');
  const d2 = document.getElementById('die2');
  if (d1 && d2) {
    d1.classList.add('rolling');
    d2.classList.add('rolling');
    setTimeout(() => {
      d1?.classList.remove('rolling');
      d2?.classList.remove('rolling');
    }, 380);
  }
  socket.emit('rollDice', { code: state.code });
}

export function buyDevCard(): void {
  socket.emit('buyDevCard', { code: state.code });
  playTone(540, 0.1);
}

export function endTurn(): void {
  setBuildModeValue(null);
  setDrawerMode(null);
  socket.emit('endTurn', { code: state.code });
}
