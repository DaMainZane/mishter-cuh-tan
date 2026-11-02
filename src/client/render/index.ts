// MODULE: renderAll, draws every client panel (board, hand, sidebar, trade, tech, overlays) from the current state | DEPENDS ON: client/actions, client/avatars, client/icons, client/mapmenu, client/pieceui, client/presets, +14 more | USED BY: client/actions, client/main, client/render/drawer
import { socket } from '../socket';
import { state, buildMode, victoryTab, hideVictoryOverlay, elevationView } from '../store';
import { isPendingSettingsPush } from '../actions';
import { renderActiveTradeModal } from './trade';
import { renderHand, getSpectateTargetPlayer } from './hand';
import { renderInlineDrawer } from './drawer';
import { renderSidebar } from './sidebar';
import { renderSetupPage } from './setup';
import { renderBoard } from './board';
import { renderTimerPopups, showEventTitleCard } from './overlay';
import { renderTechPanel } from './techpanel';
import { renderBridgePicker } from './bridgepicker';
import { renderPieceButtons } from '../pieceui';
import { renderPresetRow } from '../presets';
import { renderMapMenu, renderQuickStarts } from '../mapmenu';
import { turnClockHtml, syncTurnClockDisplay } from './turnclock';
import { uiIcon, dieFaceSvg } from '../icons';
import { esc } from '../util';
import { avatarFace } from '../avatars';
import type { PlayerView } from '../types';

let lastVicRenderKey = '';
let lastBoardGameOverKey = '';
// Tides (T6): the round the title card was last checked for. Empty = this screen has not seen a state of this game yet, so a join or a
// reconnect in the middle of a tide does not replay the card.
let tideSeenKey = '';

/** Tidebound Tides (T6b, T6d): the "tide rises" title card on a new round, and the elevation toggle (shown only when tiles differ in height). */
function syncTideUi(): void {
  const tide = state.tide ?? null;
  const elevBtn = document.getElementById('btnElevation');
  if (elevBtn) {
    const has = !!tide?.elevation;
    elevBtn.style.display = has ? '' : 'none';
    elevBtn.classList.toggle('on', has && elevationView);
  }
  if (!tide || state.status === 'LOBBY' || state.status === 'GAMEOVER') {
    tideSeenKey = '';
    return;
  }
  const key = `${state.code || ''}:${tide.round}`;
  if (tideSeenKey === '') {
    tideSeenKey = key;
    return;
  }
  if (key === tideSeenKey) return;
  tideSeenKey = key;
  if (!tide.rose) return;
  const n = tide.rose.count;
  const tiles = `${n} ${n === 1 ? 'tile' : 'tiles'}`;
  showEventTitleCard(tide.rose.spring
    ? { kicker: 'Round ' + tide.round, title: 'Spring tide!', subtitle: `The sea reaches two tiles inland: ${tiles} under water`, badgeText: tiles, tone: 'danger', icon: 'waves', durationMs: 3000 }
    : { kicker: 'Round ' + tide.round, title: 'The tide rises', subtitle: `${tiles} under water, no production there`, badgeText: tiles, tone: 'accent', icon: 'waves', durationMs: 2600 });
}

export function renderAll(): void {
  const me = state.players.find(p => p.id === socket.id);
  const isSpec = !!state.isSpectator || !me;
  const current = state.players[state.turnIndex];
  const isMyTurn = Boolean(!isSpec && ((state.currentPlayerId === socket.id) || (current && current.id === socket.id)));

  const s = state.settings || {};

  const lobbyBar = document.getElementById('lobbyToolbar')!;
  // "Back to lobby" means nothing while you are already there.
  const backBtn = document.getElementById('btnBackToLobby');
  if (backBtn) backBtn.style.display = state.status === 'LOBBY' ? 'none' : '';

  const dockSpecBtn = document.getElementById('btnDockSpectate');
  if (dockSpecBtn) {
    dockSpecBtn.classList.toggle('primary', isSpec);
    dockSpecBtn.innerHTML = `${uiIcon(isSpec ? 'users' : 'eye', 16)}<span>${isSpec ? 'Join seat' : 'Spectate'}</span>`;
  }

  const menuSpecBtn = document.getElementById('btnMenuSpectate');
  if (menuSpecBtn) {
    const canToggleSpec = state.status === 'LOBBY' || (!isSpec && state.status !== 'GAMEOVER');
    menuSpecBtn.style.display = canToggleSpec ? '' : 'none';
    menuSpecBtn.innerHTML = `${uiIcon(isSpec ? 'users' : 'eye', 16)}<span>${isSpec ? 'Join seat' : 'Spectate'}</span>`;
  }

  if (state.status === 'LOBBY') {
    if (!isPendingSettingsPush()) {
      const setVal = (id: string, v: any) => { (document.getElementById(id) as HTMLInputElement).value = v; };
      setVal('setRadius', s.boardRadius);
      setVal('setVp', s.vpToWin);
      setVal('setMaxP', s.maxPlayers);
      setVal('setDiscard', s.cardDiscardLimit);
      setVal('setTurnTime', s.turnTimerSec ?? 0);
      setVal('setTurnInc', s.turnIncrementSec ?? 0);
      setVal('setTradeTime', s.tradeTimerSec ?? 20);
      if (document.getElementById('setBotChat')) setVal('setBotChat', s.botChat ?? 'normal');
      const eventsCb = document.getElementById('setEventsOn') as HTMLInputElement | null;
      if (eventsCb) eventsCb.checked = !!s.eventsOn;
      const techTreeCb = document.getElementById('setTechTreeOn') as HTMLInputElement | null;
      if (techTreeCb) techTreeCb.checked = !!s.techTreeOn;
      const fairDiceCb = document.getElementById('setFairDice') as HTMLInputElement | null;
      if (fairDiceCb) fairDiceCb.checked = !!s.fairDice;
      if (document.getElementById('setFateTokens')) setVal('setFateTokens', s.fateTokens ?? 2);
      setVal('setGold', s.goldTiles);
      setVal('setDesert', s.desertTiles);
      if (document.getElementById('setFog')) setVal('setFog', s.fogTiles ?? 0);
      setVal('setBankRes', s.bankResourcePerType);
      setVal('setDevKnight', s.devKnights);
      setVal('setDevVp', s.devVp);
      setVal('setDevRb', s.devRoadBuilding);
      setVal('setDevYop', s.devYearOfPlenty);
      setVal('setDevMono', s.devMonopoly);
      setVal('setMaxRoad', s.maxRoads);
      setVal('setMaxSettle', s.maxSettlements);
      setVal('setMaxCity', s.maxCities);
    }
    renderQuickStarts();
    renderMapMenu();
    renderPresetRow();
  } else {
    lobbyBar.style.display = 'none';
  }

  document.getElementById('die1')!.innerHTML = dieFaceSvg(state.lastDice[0]);
  document.getElementById('die2')!.innerHTML = dieFaceSvg(state.lastDice[1]);

  // Piece badges on buttons
  const badgeTarget = me || getSpectateTargetPlayer();
  if (badgeTarget) {
    document.getElementById('badgeRoadCnt')!.textContent = String(badgeTarget.roadsLeft);
    document.getElementById('badgeSettleCnt')!.textContent = String(badgeTarget.settlementsLeft);
    document.getElementById('badgeCityCnt')!.textContent = String(badgeTarget.citiesLeft);
    const bridgeBadge = document.getElementById('badgeBridgeCnt');
    if (bridgeBadge) bridgeBadge.textContent = String(badgeTarget.bridgesLeft ?? 10);
    const netBadge = document.getElementById('badgeNetCnt');
    if (netBadge) netBadge.textContent = String(badgeTarget.netsLeft ?? 4);
    const harborBadge = document.getElementById('badgeHarborCnt');
    if (harborBadge) harborBadge.textContent = String(badgeTarget.harborsLeft ?? 1);
  }

  const pill = document.getElementById('turnStatusPill')!;
  pill.classList.toggle('mine', isMyTurn && state.status !== 'LOBBY' && state.status !== 'GAMEOVER');
  if (state.status === 'LOBBY') {
    const specSuffix = isSpec ? ' · Spectating' : '';
    pill.innerHTML = state.hostId === socket.id
      ? `Lobby · paint the map or add bots${specSuffix}`
      : `Lobby · only the host edits · move your cursor, hold Shift for a laser${specSuffix}`;
  } else if (state.status === 'GAMEOVER') {
    pill.innerHTML = `<strong>${esc(state.winner?.name)}</strong> won the game`;
  } else {
    const phaseTxt = ({
      SETUP_SETTLEMENT: 'Place Settlement',
      SETUP_ROAD: 'Place Road',
      ROLL: 'Roll Dice',
      GOLD_PICK: 'Pick Gold Resource',
      DISCARD: 'Waiting for Discards (7 Rolled)',
      ROBBER: 'Move Robber',
      ROBBER_STEAL: 'Choose Player to Rob',
      MAIN: 'Turn'
    } as Record<string, string>)[state.phase] || state.phase;
    pill.innerHTML = `<span class="avatar" style="background:${esc(current?.color)}">${avatarFace(current?.avatar, current?.name || '?')}</span> <strong>${esc(current?.name)}</strong> · ${phaseTxt}${turnClockHtml()}`;
  }
  syncTurnClockDisplay();

  const btn = (id: string) => document.getElementById(id) as HTMLButtonElement;
  const bridgesEnabled = Boolean(
    badgeTarget?.pieceCosts?.bridge !== undefined ||
    (s.dlc?.tidebound && s.addons?.['tidebound.bridges'] !== false)
  );
  const bridgeBtn = document.getElementById('btnBuildBridge') as HTMLButtonElement | null;
  if (bridgeBtn) {
    bridgeBtn.style.display = bridgesEnabled ? '' : 'none';
    bridgeBtn.disabled = !(isMyTurn && state.phase === 'MAIN');
    bridgeBtn.classList.toggle('active-mode', buildMode === 'bridge');
    bridgeBtn.title = badgeTarget?.pieceCosts?.rickety_bridge !== undefined
      ? 'Build a bridge across the ocean (choose a full or a rickety one)'
      : 'Build Bridge across ocean';
  }
  // Tidebound Fishing (T7b2): the Net button. Shown while the server sends a net price (nets are in the game), or in the lobby while the addon is on.
  const netsEnabled = Boolean(
    badgeTarget?.netCost !== undefined ||
    (s.dlc?.tidebound && s.addons?.['tidebound.fishing'] !== false)
  );
  const netBtn = document.getElementById('btnBuildNet') as HTMLButtonElement | null;
  if (netBtn) {
    netBtn.style.display = netsEnabled ? '' : 'none';
    netBtn.disabled = !(isMyTurn && state.phase === 'MAIN');
    netBtn.classList.toggle('active-mode', buildMode === 'net');
  }
  // Tidebound Fishing (T7e): the Feed button. Shown while the server sends a feed price (the action is in the game), or in the lobby while the addon is on.
  const feedEnabled = Boolean(
    badgeTarget?.feedCost !== undefined ||
    (s.dlc?.tidebound && s.addons?.['tidebound.fishing'] !== false)
  );
  const feedBtn = document.getElementById('btnFeedSea') as HTMLButtonElement | null;
  if (feedBtn) {
    feedBtn.style.display = feedEnabled ? '' : 'none';
    feedBtn.disabled = !(isMyTurn && state.phase === 'MAIN');
    feedBtn.classList.toggle('active-mode', buildMode === 'feed');
  }
  // Tidebound Harbor (T8a): the Harbor button. Shown while the server sends a harbor price, or in the lobby while the addon is on.
  const harborsEnabled = Boolean(
    badgeTarget?.harborCost !== undefined ||
    (s.dlc?.tidebound && s.addons?.['tidebound.harbor'] !== false)
  );
  const harborBtn = document.getElementById('btnBuildHarbor') as HTMLButtonElement | null;
  if (harborBtn) {
    harborBtn.style.display = harborsEnabled ? '' : 'none';
    harborBtn.disabled = !(isMyTurn && state.phase === 'MAIN');
    harborBtn.classList.toggle('active-mode', buildMode === 'harbor');
  }
  // R8.7: buttons for manifest pieces and actions (empty until a piece has a visual). Shows the spectated player's supplies for a spectator.
  renderPieceButtons(badgeTarget, isMyTurn);
  btn('btnTradeDrawer').disabled = !(isMyTurn && state.phase === 'MAIN');
  btn('btnBuyDev').disabled = !(isMyTurn && state.phase === 'MAIN' && me?.resources.sheep >= 1 && me?.resources.wheat >= 1 && me?.resources.ore >= 1 && state.devDeckCount > 0);
  btn('btnBuildRoad').disabled = !(isMyTurn && (state.phase === 'MAIN' || state.phase === 'SETUP_ROAD'));
  btn('btnBuildSettle').disabled = !(isMyTurn && (state.phase === 'MAIN' || state.phase === 'SETUP_SETTLEMENT'));
  btn('btnBuildCity').disabled = !(isMyTurn && state.phase === 'MAIN');

  btn('btnBuildRoad').classList.toggle('active-mode', buildMode === 'road');
  btn('btnBuildSettle').classList.toggle('active-mode', buildMode === 'settlement');
  btn('btnBuildCity').classList.toggle('active-mode', buildMode === 'city');

  const mainBtn = btn('btnMainTurnAction');
  const canPass = isMyTurn && state.phase === 'MAIN';
  mainBtn.disabled = !canPass;
  document.getElementById('mainBtnIcon')!.innerHTML = uiIcon('pass', 22);
  document.getElementById('mainBtnLbl')!.textContent = 'Pass';
  mainBtn.title = canPass ? 'Pass turn' : 'End turn';
  mainBtn.classList.toggle('primary', canPass);

  const canRoll = isMyTurn && state.phase === 'ROLL';
  const dicePair = document.getElementById('dicePair')!;
  dicePair.classList.toggle('can-roll', canRoll);
  dicePair.title = canRoll ? 'Click dice to roll!' : 'Dice';
  dicePair.setAttribute('aria-disabled', String(!canRoll));

  renderVictoryScreen();
  renderActiveTradeModal(me);
  renderHand(me, isMyTurn);
  renderInlineDrawer(me, isMyTurn);
  renderSidebar();
  renderSetupPage();
  renderTimerPopups();
  renderTechPanel(isMyTurn);
  renderBridgePicker(isMyTurn);
  syncTideUi();

  const goKey = `${state.code || ''}:${state.finishedAt || 0}`;
  if (state.status !== 'GAMEOVER') {
    lastBoardGameOverKey = '';
    renderBoard(me, isMyTurn);
  } else if (hideVictoryOverlay || lastBoardGameOverKey !== goKey) {
    lastBoardGameOverKey = goKey;
    renderBoard(me, isMyTurn);
  }
}

interface VicCol {
  title: string;
  label?: string;
  headHtml: string;
  get: (p: PlayerView) => number;
  primary?: boolean;
  highlightMax?: boolean;
  footerSum?: boolean;
}

function renderVicMatrix(ranked: PlayerView[], cols: VicCol[], showFooterTotal = false): string {
  const maxes = cols.map(c => Math.max(0, ...ranked.map(p => c.get(p))));
  const colTemplate = `minmax(160px, 2.2fr) repeat(${cols.length}, minmax(54px, 1fr))`;

  const headCells = cols.map(c => `
    <div class="vic-col-head" title="${esc(c.title)}">
      <div class="vic-head-badge ${c.primary ? 'primary' : ''}">${c.headHtml}</div>
      ${c.label ? `<span class="vic-head-lbl">${esc(c.label)}</span>` : ''}
    </div>
  `).join('');

  const rowsHtml = ranked.map((p, idx) => {
    const isWinner = idx === 0;
    const cells = cols.map((c, cIdx) => {
      const val = c.get(p);
      const isBest = c.highlightMax !== false && maxes[cIdx] > 0 && val === maxes[cIdx];
      const cls = c.primary ? 'vic-num primary' : isBest ? 'vic-num best' : 'vic-num';
      return `<div class="vic-cell"><span class="${cls}">${val}</span></div>`;
    }).join('');

    return `
      <div class="vic-matrix-row ${isWinner ? 'is-winner' : ''}" style="grid-template-columns:${colTemplate}">
        <div class="vic-player-cell">
          <span class="avatar p-avatar" style="background:${esc(p.color)}">${avatarFace(p.avatar, p.name)}</span>
          <span class="vic-player-name">${esc(p.name)}</span>
        </div>
        ${cells}
      </div>
    `;
  }).join('');

  let footerHtml = '';
  if (showFooterTotal && ranked.length > 1) {
    const sumCells = cols.map(c => {
      const sum = ranked.reduce((acc, p) => acc + c.get(p), 0);
      return `<div class="vic-cell"><span class="vic-num sum">${sum}</span></div>`;
    }).join('');
    footerHtml = `
      <div class="vic-matrix-row is-footer" style="grid-template-columns:${colTemplate}">
        <div class="vic-player-cell"><span class="vic-footer-lbl">Table Total</span></div>
        ${sumCells}
      </div>
    `;
  }

  return `
    <div class="vic-matrix">
      <div class="vic-matrix-head" style="grid-template-columns:${colTemplate}">
        <div class="vic-player-head"></div>
        ${headCells}
      </div>
      <div class="vic-matrix-body">
        ${rowsHtml}
        ${footerHtml}
      </div>
    </div>
  `;
}

export function renderVictoryScreen(): void {
  const overlay = document.getElementById('victoryOverlay');
  const reopenBtn = document.getElementById('reopenVictoryBtn');
  const viewport = document.getElementById('gameViewport');
  if (!overlay || !reopenBtn) return;

  if (state.status !== 'GAMEOVER') {
    overlay.style.display = 'none';
    reopenBtn.style.display = 'none';
    viewport?.classList.remove('victory-modal-open');
    lastVicRenderKey = '';
    return;
  }

  if (hideVictoryOverlay) {
    overlay.style.display = 'none';
    reopenBtn.style.display = 'inline-flex';
    viewport?.classList.remove('victory-modal-open');
    return;
  }
  overlay.style.display = 'flex';
  reopenBtn.style.display = 'none';
  viewport?.classList.add('victory-modal-open');

  document.querySelectorAll<HTMLElement>('.vic-tab[data-vtab]').forEach(el => {
    el.classList.toggle('active', el.dataset.vtab === victoryTab);
  });

  const vicKey = `${state.code || ''}:${state.finishedAt || 0}:${victoryTab}:${state.players.length}`;
  if (lastVicRenderKey === vicKey) {
    return;
  }
  lastVicRenderKey = vicKey;

  const ranked = [...state.players].sort((a, b) => b.vp - a.vp);
  const myRankIdx = ranked.findIndex(p => p.id === socket.id);
  const ord = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
  document.getElementById('vicTitleText')!.textContent =
    myRankIdx === 0
      ? 'Victory!!!'
      : myRankIdx > 0
      ? `You are ${ord[myRankIdx]}!`
      : `${state.winner?.name || 'Player'} Won!`;

  const elapsedSec = state.startedAt && state.finishedAt
    ? Math.max(1, Math.floor((state.finishedAt - state.startedAt) / 1000))
    : 0;
  const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const secs = String(elapsedSec % 60).padStart(2, '0');
  document.getElementById('vicSubText')!.textContent = `Time: ${mins}:${secs} - Turns: ${state.turnCount || 1}`;

  const chartBox = document.getElementById('vicChartContainer')!;

  if (victoryTab === 'dice') {
    const ds = state.diceStats || {};
    let maxCount = 1;
    let totalRolls = 0;
    let bestNum = 7;
    let bestCnt = 0;
    for (let n = 2; n <= 12; n++) {
      const c = ds[n] || 0;
      totalRolls += c;
      if (c > maxCount) maxCount = c;
      if (c > bestCnt) {
        bestCnt = c;
        bestNum = n;
      }
    }

    const BAR_MAX_PX = 165;
    let barsHtml = '';
    for (let n = 2; n <= 12; n++) {
      const c = ds[n] || 0;
      const heightPx = c > 0 ? Math.max(4, Math.round((c / maxCount) * BAR_MAX_PX)) : 0;
      const pct = totalRolls > 0 ? Math.round((c / totalRolls) * 100) : 0;
      barsHtml += `
        <div class="dice-bar-col" title="Roll ${n}: ${c} times (${pct}%)">
          <span class="dice-bar-count">${c > 0 ? c : '0'}</span>
          <div class="dice-bar-fill ${n === 7 ? 'is-seven' : n === 6 || n === 8 ? 'is-hot' : ''}" style="height:${heightPx}px"></div>
          <span class="dice-bar-label ${n === 6 || n === 8 ? 'hot' : ''}">${n}</span>
        </div>
      `;
    }

    const sevensCnt = ds[7] || 0;
    const sevensPct = totalRolls > 0 ? ((sevensCnt / totalRolls) * 100).toFixed(1) : '0.0';
    const playerSevensHtml = ranked.map(p => {
      const s7 = p.stats?.activity?.sevens ?? 0;
      const rolls = p.stats?.activity?.rolls ?? 0;
      return `
        <div class="vic-dice-pchip">
          <span class="avatar" style="background:${esc(p.color)};width:22px;height:22px">${avatarFace(p.avatar, p.name)}</span>
          <span class="vic-dice-pname">${esc(p.name)}</span>
          <span class="vic-dice-pval"><strong>${s7}</strong> 7s <small>/ ${rolls} rolls</small></span>
        </div>
      `;
    }).join('');

    chartBox.innerHTML = `
      <div class="vic-dice-wrap">
        <div class="vic-dice-summary">
          <span>Total Rolls: <strong>${totalRolls}</strong></span>
          <span>·</span>
          <span>7s Rolled: <strong>${sevensCnt}</strong> (${sevensPct}%)</span>
          <span>·</span>
          <span>Most Frequent: <strong>${bestCnt > 0 ? `${bestNum} (${bestCnt}×)` : '—'}</strong></span>
        </div>
        <div class="dice-bars-wrap">${barsHtml}</div>
        <div class="vic-dice-players">${playerSevensHtml}</div>
      </div>
    `;
    return;
  }

  if (victoryTab === 'res_cards') {
    const rc = (p: PlayerView) => p.stats?.resCards;
    chartBox.innerHTML = renderVicMatrix(ranked, [
      {
        title: 'Total Resource Cards Gained',
        label: 'Total',
        headHtml: uiIcon('cards', 20),
        get: p => {
          const r = rc(p);
          return r ? r.produced + r.tradedIn + r.stolen : (p.stats?.resourcesEarned || 0);
        },
        primary: true,
        highlightMax: false
      },
      {
        title: 'Produced from Dice, Setup & Gold',
        label: 'Dice / Gold',
        headHtml: uiIcon('dice', 20),
        get: p => rc(p)?.produced ?? (p.stats?.resourcesEarned || 0)
      },
      {
        title: 'Gained from Dev Cards (Year of Plenty & Monopoly)',
        label: 'Dev Gain',
        headHtml: uiIcon('gift', 20),
        get: p => rc(p)?.devGain ?? 0
      },
      {
        title: 'Received from Trades (Player & Bank)',
        label: 'Trade In',
        headHtml: uiIcon('arrowDown', 20),
        get: p => rc(p)?.tradedIn ?? 0
      },
      {
        title: 'Given in Trades (Player & Bank)',
        label: 'Trade Out',
        headHtml: uiIcon('arrowUp', 20),
        get: p => rc(p)?.tradedOut ?? 0
      },
      {
        title: 'Stolen from Opponents (Robber & Monopoly)',
        label: 'Stolen',
        headHtml: uiIcon('robber', 20),
        get: p => rc(p)?.stolen ?? 0
      },
      {
        title: 'Lost to Opponents (Robber & Monopoly)',
        label: 'Robbed',
        headHtml: uiIcon('close', 20),
        get: p => rc(p)?.robbed ?? 0
      },
      {
        title: 'Discarded on 7 Rolls',
        label: '7s Lost',
        headHtml: uiIcon('minus', 20),
        get: p => rc(p)?.discarded ?? 0
      }
    ], true);
    return;
  }

  if (victoryTab === 'dev_cards') {
    const dc = (p: PlayerView) => p.stats?.devCards;
    chartBox.innerHTML = renderVicMatrix(ranked, [
      {
        title: 'Total Development Cards Bought',
        label: 'Bought',
        headHtml: uiIcon('devbuy', 20),
        get: p => dc(p)?.bought ?? 0,
        primary: true,
        highlightMax: false
      },
      {
        title: 'Development Cards Played',
        label: 'Played',
        headHtml: uiIcon('play', 20),
        get: p => dc(p)?.played ?? 0
      },
      {
        title: 'Knight Cards (Played + Held)',
        label: 'Knight',
        headHtml: uiIcon('sword', 20),
        get: p => dc(p)?.knight ?? p.knightsPlayed ?? 0
      },
      {
        title: 'Victory Point Cards (+1 VP)',
        label: '+1 VP',
        headHtml: uiIcon('star', 20),
        get: p => dc(p)?.vp ?? 0
      },
      {
        title: 'Road Building Cards (Played + Held)',
        label: 'Road Bldg',
        headHtml: uiIcon('road', 20),
        get: p => dc(p)?.roadBuilding ?? 0
      },
      {
        title: 'Year of Plenty Cards (Played + Held)',
        label: 'Plenty',
        headHtml: uiIcon('gift', 20),
        get: p => dc(p)?.yearOfPlenty ?? 0
      },
      {
        title: 'Monopoly Cards (Played + Held)',
        label: 'Monopoly',
        headHtml: uiIcon('crown', 20),
        get: p => dc(p)?.monopoly ?? 0
      }
    ], true);
    return;
  }

  if (victoryTab === 'activity') {
    const ac = (p: PlayerView) => p.stats?.activity;
    chartBox.innerHTML = renderVicMatrix(ranked, [
      {
        title: 'Turns Taken',
        label: 'Turns',
        headHtml: uiIcon('pass', 20),
        get: p => ac(p)?.turns ?? 0,
        primary: true,
        highlightMax: false
      },
      {
        title: 'Settlements Built',
        label: 'Settle',
        headHtml: uiIcon('house', 20),
        get: p => ac(p)?.settlementsBuilt ?? 0
      },
      {
        title: 'Cities Built',
        label: 'Cities',
        headHtml: uiIcon('city', 20),
        get: p => ac(p)?.citiesBuilt ?? 0
      },
      {
        title: 'Roads Built',
        label: 'Roads',
        headHtml: uiIcon('road', 20),
        get: p => ac(p)?.roadsBuilt ?? 0
      },
      {
        title: 'Longest Continuous Road Length',
        label: 'Best Road',
        headHtml: uiIcon('trophy', 20),
        get: p => ac(p)?.longestRoad ?? p.longestRoadLength ?? 0
      },
      {
        title: 'Times Moved the Robber',
        label: 'Robber',
        headHtml: uiIcon('robber', 20),
        get: p => ac(p)?.robberMoves ?? 0
      },
      {
        title: 'Completed Player-to-Player Trades',
        label: 'P2P Trade',
        headHtml: uiIcon('users', 20),
        get: p => ac(p)?.playerTrades ?? 0
      },
      {
        title: 'Completed Bank & Port Trades',
        label: 'Bank Trade',
        headHtml: uiIcon('bank', 20),
        get: p => ac(p)?.bankTrades ?? 0
      },
      {
        title: 'Trade Offers & Counter-Offers Proposed',
        label: 'Offers',
        headHtml: uiIcon('swap', 20),
        get: p => ac(p)?.tradesProposed ?? 0
      }
    ], true);
    return;
  }

  if (victoryTab === 'resources') {
    const br = (p: PlayerView, k: string) => p.stats?.byResource?.[k] ?? 0;
    chartBox.innerHTML = renderVicMatrix(ranked, [
      {
        title: 'Total Resources Acquired',
        label: 'Total',
        headHtml: uiIcon('cards', 20),
        get: p => br(p, 'wood') + br(p, 'brick') + br(p, 'sheep') + br(p, 'wheat') + br(p, 'ore'),
        primary: true,
        highlightMax: false
      },
      {
        title: 'Wood Acquired',
        label: 'Wood',
        headHtml: uiIcon('tree', 20),
        get: p => br(p, 'wood')
      },
      {
        title: 'Brick Acquired',
        label: 'Brick',
        headHtml: uiIcon('bricks', 20),
        get: p => br(p, 'brick')
      },
      {
        title: 'Sheep Acquired',
        label: 'Sheep',
        headHtml: uiIcon('wool', 20),
        get: p => br(p, 'sheep')
      },
      {
        title: 'Wheat Acquired',
        label: 'Wheat',
        headHtml: uiIcon('grain', 20),
        get: p => br(p, 'wheat')
      },
      {
        title: 'Ore Acquired',
        label: 'Ore',
        headHtml: uiIcon('rock', 20),
        get: p => br(p, 'ore')
      }
    ], true);
    return;
  }

  // Default: 'overview' (matches Colonist Overview layout)
  const vpb = (p: PlayerView) => p.stats?.vpBreakdown;
  chartBox.innerHTML = renderVicMatrix(ranked, [
    {
      title: 'Total Victory Points',
      label: 'Total VP',
      headHtml: uiIcon('trophy', 20),
      get: p => p.vp,
      primary: true,
      highlightMax: false
    },
    {
      title: 'Victory Points from Settlements (1 VP each)',
      label: 'Settle',
      headHtml: uiIcon('house', 20),
      get: p => vpb(p)?.settlement ?? Math.max(0, 5 - (p.settlementsLeft ?? 5))
    },
    {
      title: 'Victory Points from Cities (2 VP each)',
      label: 'Cities',
      headHtml: uiIcon('city', 20),
      get: p => vpb(p)?.city ?? 0
    },
    {
      title: 'Victory Points from Development Cards (+1 VP each)',
      label: 'VP Cards',
      headHtml: uiIcon('star', 20),
      get: p => vpb(p)?.devVp ?? 0
    },
    {
      title: 'Largest Army Award (2 VP)',
      label: 'Army',
      headHtml: uiIcon('sword', 20),
      get: p => vpb(p)?.largestArmy ?? (state.largestArmyOwner === p.id ? 2 : 0)
    },
    {
      title: 'Longest Road Award (2 VP)',
      label: 'Road',
      headHtml: uiIcon('road', 20),
      get: p => vpb(p)?.longestRoad ?? (state.longestRoadOwner === p.id ? 2 : 0)
    }
  ]);
}


