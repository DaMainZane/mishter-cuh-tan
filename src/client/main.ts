// MODULE: client entry point (wires DOM events, camera pan and zoom, and socket messages to the renderers) | DEPENDS ON: client/actions, client/audio, client/cursors, client/icons, client/mapmenu, client/pieceui, +15 more | USED BY: none
import { socket } from './socket';
import { playDiceRollSound, playDiscardSound, playTone, playVictoryFanfareSound, playYourTurnSound, toggleSound } from './audio';
import { hydrateIcons } from './icons';
import { toggleTheme, showToast, triggerVictoryConfetti, clearVictoryConfetti } from './ui';
import {
  state, camZoom, camPanX, camPanY, isPanning, panStart, discardSel, drawerMode,
  activeBrush, hasDraggedMap,
  setState, setIsMouseDown, setIsPanning, setHasDraggedMap, setCamZoom, setCamPan, setDrawerMode,
  setBuildModeValue, setHideVictoryOverlay, clearRes, clearDiscardWild, clearAllInFlight, setLogTab, elevationView, setElevationView
} from './store';
import { renderAll } from './render/index';
import {
  rerenderBoard, resetCamera, getBoardBounds, triggerFlyingResourceAnimations, triggerCardTransferAnimations,
  triggerAwardAnimation, onHexInteract, onHexClick, onHexEnter, onEdgeInteract, clickVertex, clickNetSpot, clickFeedSpot, clickHarborSpot, clickEdge,
  onRoadHover, onRoadMove, onRoadLeave
} from './render/board';
import { respondToTrade, confirmTradeWith, cancelTrade, startCounter, adjustCounter, sendCounter, cancelCounter, toggleTradesCollapsed } from './render/trade';
import { initCursors } from './cursors';
import {
  startSavePreset, cancelSavePreset, confirmSavePreset, presetNameKey, applyCustomPreset, applyPresetStyle,
  askDeletePreset, cancelDeletePreset, deletePreset
} from './presets';
import {
  toggleMapMenu, mapPick, mapLandInput, mapLandChange, mapParamInput, mapParamChange, mapReroll, mapCopySeed, mapCopyCode, mapEditSeed,
  mapCancelSeed, mapSeedKey, mapApplySeed, mapToggleLock, mapToggleSeedVisible
} from './mapmenu';
import { onClickHandResource, onClickHandWild, onClickDevCard } from './render/hand';
import {
  toggleTradeDrawer, closeInlineDrawer, confirmInlineAction, executeBankTrade, proposePlayerTrade,
  confirmMonopoly, pickGold, spendFishPick, chooseRobberVictim, adjustDiscard, removeCardFromDiscard, removeWildFromDiscard, adjustTradeWant, adjustTradeGive, fixBankTrade
} from './render/drawer';
import { sendChat, toggleRoundCollapse, toggleLogFilter, renderSidebar } from './render/sidebar';
import { toggleTechPanel, researchTechClick, upgradePortClick, pickGroundHex, convertTileClick } from './render/techpanel';
import { clickPlacedBridge, chooseBridgeType, confirmBridgeUpgrade, confirmBridgeDemolish, closeBridgePicker } from './render/bridgepicker';
import { clickPirate } from './render/pirates';
import { onVisualsEvent, resetManifest } from './visuals';
import { clickSpot } from './pieceui';
import {
  setHexOverlay, clearHexOverlays, showTimerPopup, dismissTimerPopup, triggerTimerPopupAction,
  showEventTitleCard, showRoundRecapCard, dismissRoundRecapCard
} from './render/overlay';
import {
  createRoom, joinRoom, spectateRoom, toggleSpectate, selectSpectateTarget, rejoinSavedRoom, downloadTrainingLog, saveSessionInfo, clearSavedRoom, syncRejoinButton,
  copyInviteLink, switchLobbyTab, toggleLobbyToolbar, toggleGameMenu,
  setBrush, applyPreset, applyScenario, toggleDlc, toggleAddon, enableAddonWithDeps, previewTideLevel, setTideLevel, previewRisingSeaLevel, setRisingSeaLevel, pushSettings, schedulePushSettings, addBot, removeBot, startGame, rematchLobby, switchVictoryTab,
  toggleVictoryMapInspect, setBuildMode, mainTurnButton, rollDice, buyDevCard, cycleAvatar, cycleBotTier, collapseLobbyUi, setSetupOpen
} from './actions';

/** Tidebound T6d: switch the board between the tide overlays and the elevation heat map. */
function toggleElevationView(): void {
  setElevationView(!elevationView);
  if (state) renderAll();
}

function onSetLogTab(tab: 'live' | 'chat' | 'history'): void {
  setLogTab(tab);
  renderSidebar();
}

// Inline onclick="..." handlers in index.html and in generated markup resolve against window.
Object.assign(window as any, {
  createRoom, joinRoom, spectateRoom, toggleSpectate, selectSpectateTarget, rejoinSavedRoom, downloadTrainingLog, copyInviteLink, toggleSound, toggleTheme, resetCamera, toggleLobbyToolbar, toggleGameMenu,
  switchLobbyTab, applyPreset, applyScenario, toggleDlc, toggleAddon, enableAddonWithDeps, previewTideLevel, setTideLevel, previewRisingSeaLevel, setRisingSeaLevel, addBot, removeBot, startGame, rematchLobby,
  switchVictoryTab, toggleVictoryMapInspect, setBrush, pushSettings,
  executeBankTrade, proposePlayerTrade, rollDice, confirmInlineAction, closeInlineDrawer,
  toggleTradeDrawer, buyDevCard, setBuildMode, mainTurnButton, sendChat,
  setLogTab: onSetLogTab, toggleRoundCollapse, toggleLogFilter, toggleTechPanel, researchTechClick, upgradePortClick, pickGroundHex, convertTileClick,
  clickPlacedBridge, chooseBridgeType, confirmBridgeUpgrade, confirmBridgeDemolish, closeBridgePicker, clickPirate, clickSpot,
  confirmTradeWith, cancelTrade, respondToTrade, onClickHandResource, onClickHandWild, onClickDevCard,
  startCounter, adjustCounter, sendCounter, cancelCounter, toggleTradesCollapsed, cycleAvatar, cycleBotTier, setSetupOpen,
  startSavePreset, cancelSavePreset, confirmSavePreset, presetNameKey, applyCustomPreset, applyPresetStyle,
  askDeletePreset, cancelDeletePreset, deletePreset,
  toggleMapMenu, mapPick, mapLandInput, mapLandChange, mapParamInput, mapParamChange, mapReroll, mapCopySeed, mapCopyCode, mapEditSeed,
  mapCancelSeed, mapSeedKey, mapApplySeed, mapToggleLock, mapToggleSeedVisible,
  pickGold, spendFishPick, chooseRobberVictim, confirmMonopoly, adjustDiscard, removeCardFromDiscard, removeWildFromDiscard, adjustTradeWant, adjustTradeGive, fixBankTrade,
  onHexInteract, onHexClick, onHexEnter, onEdgeInteract, clickVertex, clickNetSpot, clickFeedSpot, clickHarborSpot, clickEdge,
  onRoadHover, onRoadMove, onRoadLeave,
  setHexOverlay, clearHexOverlays, showTimerPopup, dismissTimerPopup, triggerTimerPopupAction,
  showEventTitleCard, showRoundRecapCard, dismissRoundRecapCard, toggleElevationView
});

function animateDice(sum?: number): void {
  playDiceRollSound(sum);
  const d1 = document.getElementById('die1')!;
  const d2 = document.getElementById('die2')!;
  d1.classList.add('rolling');
  d2.classList.add('rolling');
  setTimeout(() => {
    d1.classList.remove('rolling');
    d2.classList.remove('rolling');
  }, 360);
}

function syncAutomaticDrawers(): void {
  const me = state.players.find(p => p.id === socket.id);
  if (!me) return;

  if (me.goldPending > 0) {
    setDrawerMode('gold');
  } else if (state.phase === 'ROBBER_STEAL' && state.currentPlayerId === socket.id) {
    setDrawerMode('robberSteal');
  } else if (state.phase === 'DISCARD' && me.discardPending > 0) {
    if (drawerMode !== 'discard') {
      clearRes(discardSel);
      clearDiscardWild();
      setDrawerMode('discard');
    }
  } else if (drawerMode === 'fish' && !(state.phase === 'MAIN' && state.currentPlayerId === socket.id && (me.wildTokens?.fish || 0) > 0)) {
    // The spend sheet only makes sense on your own main phase while you still hold a fish.
    setDrawerMode(null);
  } else if (drawerMode === 'gold' || drawerMode === 'discard' || drawerMode === 'robberSteal') {
    setDrawerMode(null);
  }
}

socket.on('errorMsg', (msg: string) => showToast(msg));

// R8.5: the visual manifest (looks of DLC pieces, actions and overlay kinds). It can arrive before or after the first `gameState`; either order works,
// because a manifest that changes the controls asks for one re-render when there is a state to draw.
socket.on('visuals', (payload: unknown) => onVisualsEvent(payload, () => { if (state) renderAll(); }));

socket.on('reconnected', ({ code }: { code: string; name: string }) => {
  showToast(`Reconnected to room ${code}`);
});

socket.on('reconnectFailed', () => {
  if (!state) {
    clearSavedRoom();
  }
});

let shouldAutoReconnect = false;

socket.on('connect', () => {
  if (shouldAutoReconnect) {
    shouldAutoReconnect = false;
    rejoinSavedRoom();
  }
});

socket.on('disconnect', () => {
  // The next connection is a new socket, so the server sends the manifest again; until then draw with none.
  resetManifest();
  if (state?.code) {
    shouldAutoReconnect = true;
    const me = state.players?.find((p: any) => p.id === socket.id) || state.spectators?.find((s: any) => s.id === socket.id);
    saveSessionInfo(state.code, me?.name?.replace(/\s*\(Bot\)$/i, ''));
    setState(null);
    document.getElementById('gameViewport')!.style.display = 'none';
    document.getElementById('authScreen')!.style.display = 'flex';
    syncRejoinButton();
    showToast('Disconnected from server. Reconnecting...');
  }
});

socket.on('gameState', (newState: any) => {
  const prevDice = state ? state.lastDice.join(',') : '';
  const wasGameOver = state?.status === 'GAMEOVER';
  const wasLobby = !state || state.status === 'LOBBY';
  const wasMyTurn = Boolean(state && state.status !== 'LOBBY' && state.status !== 'GAMEOVER' && state.currentPlayerId === socket.id);
  const prevLongestRoad = state?.longestRoadOwner || null;
  const prevLargestArmy = state?.largestArmyOwner || null;
  const prevMe = state?.players?.find((p: any) => p.id === socket.id);
  const wasDiscarding = (prevMe?.discardPending || 0) > 0;

  const prevTurnCount = state?.turnCount ?? -1;
  setState(newState);
  const meInNewState = newState?.players?.find((p: any) => p.id === socket.id) || newState?.spectators?.find((s: any) => s.id === socket.id);
  if (newState?.code && meInNewState) {
    saveSessionInfo(newState.code, meInNewState.name?.replace(/\s*\(Bot\)$/i, ''));
  }
  if (state.status === 'LOBBY' || (prevTurnCount !== -1 && state.turnCount !== prevTurnCount)) {
    clearAllInFlight();
  }
  // Back in the lobby after a game: fold the menus away so nothing overlaps; the settings button reopens the dock.
  if (!wasLobby && state.status === 'LOBBY') {
    collapseLobbyUi();
    clearVictoryConfetti();
  }
  document.getElementById('authScreen')!.style.display = 'none';
  document.getElementById('gameViewport')!.style.display = 'flex';

  const isNowMyTurn = Boolean(state.status !== 'LOBBY' && state.status !== 'GAMEOVER' && state.currentPlayerId === socket.id);
  if (!isNowMyTurn || (state.phase !== 'MAIN' && state.phase !== 'SETUP_SETTLEMENT' && state.phase !== 'SETUP_ROAD')) {
    setBuildModeValue(null);
  }
  if (!wasMyTurn && isNowMyTurn) {
    playYourTurnSound();
  }

  if (!wasGameOver && state.status === 'GAMEOVER') {
    setHideVictoryOverlay(false);
    playVictoryFanfareSound();
    triggerVictoryConfetti(state.winner?.color);
  }

  if (!wasLobby && state.status !== 'LOBBY') {
    if (state.longestRoadOwner && state.longestRoadOwner !== prevLongestRoad) {
      const newOwner = state.players.find(p => p.id === state.longestRoadOwner);
      const oldOwner = prevLongestRoad ? state.players.find(p => p.id === prevLongestRoad) : null;
      triggerAwardAnimation('longestRoad', newOwner, oldOwner);
    }
    if (state.largestArmyOwner && state.largestArmyOwner !== prevLargestArmy) {
      const newOwner = state.players.find(p => p.id === state.largestArmyOwner);
      const oldOwner = prevLargestArmy ? state.players.find(p => p.id === prevLargestArmy) : null;
      triggerAwardAnimation('largestArmy', newOwner, oldOwner);
    }
  }

  const diceSum = (state.lastDice?.[0] || 0) + (state.lastDice?.[1] || 0);
  if (prevDice && prevDice !== state.lastDice.join(',')) {
    animateDice(diceSum);
  }

  const meNow = state.players.find(p => p.id === socket.id);
  if (!wasDiscarding && meNow && meNow.discardPending > 0) {
    playDiscardSound();
    const handEl = document.getElementById('myHandPanel');
    if (handEl) {
      handEl.classList.remove('hand-stolen-shake');
      void handEl.offsetWidth;
      handEl.classList.add('hand-stolen-shake');
      setTimeout(() => handEl.classList.remove('hand-stolen-shake'), 650);
    }
  }

  syncAutomaticDrawers();
  renderAll();

  if (state.recentProductions && state.recentProductions.length > 0) {
    triggerFlyingResourceAnimations(state.recentProductions);
  }
  if (state.recentTransfers && state.recentTransfers.length > 0) {
    triggerCardTransferAnimations(state.recentTransfers);
  }
});

function init(): void {
  hydrateIcons();
  syncRejoinButton();
  const params = new URLSearchParams(window.location.search);
  if (params.get('room')) (document.getElementById('roomCodeInput') as HTMLInputElement).value = params.get('room')!;

  const stage = document.getElementById('boardStage')!;
  const panOrigin = { x: 0, y: 0 };
  let panSvgRect: DOMRect | null = null;
  let cachedWheelRect: DOMRect | null = null;
  let cachedWheelRectTime = 0;
  window.addEventListener('resize', () => {
    panSvgRect = null;
    cachedWheelRect = null;
  });

  stage.addEventListener('wheel', (e: WheelEvent) => {
    const target = e.target as Element | null;

    // Hovering a number input (or its field row) in the Rules and Cards menu scrolls the value up/down with the mouse wheel.
    if (target && target.closest('#lobbyToolbar, #setupScreen')) {
      const fieldLabel = target.closest('.field');
      const numInput = (
        target instanceof HTMLInputElement && target.type === 'number'
          ? target
          : fieldLabel?.querySelector<HTMLInputElement>('input[type="number"]')
      ) || null;

      if (numInput) {
        e.preventDefault();
        e.stopPropagation();
        if (e.deltaY === 0) return;
        if (state && state.hostId !== socket.id) {
          showToast('Only the host can change settings.');
          return;
        }
        const dir = e.deltaY < 0 ? 1 : -1;
        const baseStep = Number(numInput.step) || 1;
        const step = baseStep * (e.shiftKey ? 5 : 1);
        const min = numInput.min !== '' ? Number(numInput.min) : -Infinity;
        const max = numInput.max !== '' ? Number(numInput.max) : Infinity;
        const cur = Number(numInput.value);
        const startVal = Number.isFinite(cur) ? cur : (Number.isFinite(min) ? min : 0);
        const next = Math.max(min, Math.min(max, startVal + dir * step));
        if (next !== startVal) {
          numInput.value = String(next);
          playTone(dir > 0 ? 560 : 460, 0.025);
          schedulePushSettings();
        }
        return;
      }

      // Also allow scrolling range sliders in the Map menu when hovered
      const rangeWrap = target.closest('.map-land, .map-param');
      const rangeInput = (
        target instanceof HTMLInputElement && target.type === 'range'
          ? target
          : rangeWrap?.querySelector<HTMLInputElement>('input[type="range"]')
      ) || null;
      if (rangeInput && !rangeInput.disabled) {
        e.preventDefault();
        e.stopPropagation();
        if (e.deltaY === 0) return;
        const dir = e.deltaY < 0 ? 1 : -1;
        const step = Number(rangeInput.step) || 1;
        const min = rangeInput.min !== '' ? Number(rangeInput.min) : 0;
        const max = rangeInput.max !== '' ? Number(rangeInput.max) : 100;
        const cur = Number(rangeInput.value) || 0;
        const next = Math.max(min, Math.min(max, cur + dir * step));
        if (next !== cur) {
          rangeInput.value = String(next);
          rangeInput.dispatchEvent(new Event('input', { bubbles: true }));
          rangeInput.dispatchEvent(new Event('change', { bubbles: true }));
          playTone(dir > 0 ? 560 : 460, 0.025);
        }
        return;
      }

      // Do not zoom the board while scrolling inside the lobby dock
      return;
    }

    if (target && target.closest('#gameSettingsMenu, #inlineDrawerWrap, #activeTradeModal, #victoryOverlay, #myHandPanel')) {
      return;
    }

    e.preventDefault();
    if (!state || !state.board) return;
    const now = performance.now();
    if (!cachedWheelRect || now - cachedWheelRectTime > 250) {
      const svg = document.getElementById('boardSvg');
      cachedWheelRect = svg ? svg.getBoundingClientRect() : null;
      cachedWheelRectTime = now;
    }
    const rect = cachedWheelRect;
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    const { contentW, contentH } = getBoardBounds();
    const baseUnitPerPx = Math.max(contentW / rect.width, contentH / rect.height);

    const oldZoom = camZoom;
    const factor = e.deltaY > 0 ? 1.12 : (1 / 1.12);
    const newZoom = Math.max(0.01, Math.min(5.0, oldZoom * factor));

    const offsetX = e.clientX - (rect.left + rect.width / 2);
    const offsetY = e.clientY - (rect.top + rect.height / 2);

    const oldWorldPerPx = oldZoom * baseUnitPerPx;
    const newWorldPerPx = newZoom * baseUnitPerPx;

    // Anchor the world point directly underneath the cursor
    const newPanX = camPanX + offsetX * (newWorldPerPx - oldWorldPerPx);
    const newPanY = camPanY + offsetY * (newWorldPerPx - oldWorldPerPx);

    setCamZoom(newZoom);
    setCamPan(newPanX, newPanY);
    rerenderBoard();
  }, { passive: false });

  stage.addEventListener('mousedown', (e: MouseEvent) => {
    const target = e.target as Element | null;
    // Ignore clicks on floating UI panels inside boardStage (only pan when pressing on the SVG board or stage)
    if (target && target !== stage && !target.closest('#boardSvg')) return;

    const isLobbyPaintTarget = Boolean(
      state &&
      state.status === 'LOBBY' &&
      state.hostId === socket.id &&
      activeBrush.type &&
      target?.closest('[data-paintable="1"]')
    );

    setHasDraggedMap(false);
    panOrigin.x = e.clientX;
    panOrigin.y = e.clientY;

    if (e.button === 2 || e.button === 1 || e.altKey || (e.button === 0 && !isLobbyPaintTarget)) {
      setIsPanning(true);
      panStart.x = e.clientX;
      panStart.y = e.clientY;
      const svg = document.getElementById('boardSvg');
      panSvgRect = svg ? svg.getBoundingClientRect() : null;
      cachedWheelRect = panSvgRect;
      cachedWheelRectTime = performance.now();
    } else {
      setIsMouseDown(true);
    }
  });
  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (isPanning && state && state.board) {
      if (!hasDraggedMap && Math.hypot(e.clientX - panOrigin.x, e.clientY - panOrigin.y) > 4) {
        setHasDraggedMap(true);
        const svg = document.getElementById('boardSvg');
        if (svg) svg.classList.add('is-panning');
        onRoadLeave();
      }
      const rect = panSvgRect || cachedWheelRect;
      if (!rect) return;
      const { contentW, contentH } = getBoardBounds();
      const worldPerPx = camZoom * Math.max(contentW / (rect.width || 1), contentH / (rect.height || 1));
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      panStart.x = e.clientX;
      panStart.y = e.clientY;
      setCamPan(camPanX + dx * worldPerPx, camPanY + dy * worldPerPx);
      rerenderBoard();
    }
  });
  window.addEventListener('mouseup', () => {
    setIsMouseDown(false);
    setIsPanning(false);
    panSvgRect = null;
    const svg = document.getElementById('boardSvg');
    if (svg) svg.classList.remove('is-panning');
  });
  stage.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as Element | null;
    if (hasDraggedMap) {
      setHasDraggedMap(false);
      if (!target?.closest('#myHandPanel, #activeTradeModal, #inlineDrawerWrap, #gameSettingsMenu')) {
        e.stopPropagation();
        e.preventDefault();
      }
    }
  }, true);
  stage.addEventListener('contextmenu', e => e.preventDefault());
  initCursors();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

