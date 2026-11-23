// MODULE: client entry point (wires DOM events, camera pan and zoom, and socket messages to the renderers) | DEPENDS ON: client/actions, client/audio, client/cursors, client/debug, client/icons, client/mapmenu, +18 more | USED BY: none
import { socket } from './socket';
import { playDiceRollSound, playDiscardSound, playTone, playVictoryFanfareSound, playYourTurnSound, toggleSound } from './audio';
import { hydrateIcons } from './icons';
import { toggleTheme, showToast, triggerVictoryConfetti, clearVictoryConfetti } from './ui';
import {
  state, camZoom, camPanX, camPanY, isPanning, isMouseDown, panStart, discardSel, drawerMode,
  activeBrush, hasDraggedMap,
  setState, setIsMouseDown, setIsPanning, setHasDraggedMap, setCamZoom, setCamPan, setDrawerMode,
  setBuildModeValue, setHideVictoryOverlay, clearRes, clearDiscardWild, clearAllInFlight, setLogTab, elevationView, setElevationView
} from './store';
import { renderAll } from './render/index';
import {
  rerenderBoard, resetCamera, getBoardBounds, triggerFlyingResourceAnimations, triggerCardTransferAnimations,
  panBoardPreview, zoomBoardPreview, endBoardPan,
  triggerAwardAnimation, onHexInteract, onHexClick, onHexEnter, onEdgeInteract, clickVertex, clickNetSpot, clickFeedSpot, clickHarborSpot, clickEdge,
  onRoadHover, onRoadMove, onRoadLeave, hexAtClientPoint, portEdgeAtClientPoint, handleBoardCanvasClick
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
  confirmMonopoly, pickGold, spendFishPick, chooseRobberVictim, adjustDiscard, removeCardFromDiscard, removeWildFromDiscard, adjustTradeWant, adjustTradeGive, fixBankTrade, fishPickAdd, fishPickRemove, fishPickConfirm
} from './render/drawer';
import { sendChat, toggleRoundCollapse, toggleLogFilter, renderSidebar } from './render/sidebar';
import { toggleTechPanel, researchTechClick, upgradePortClick, pickGroundHex, convertTileClick } from './render/techpanel';
import { clickPlacedBridge, chooseBridgeType, confirmBridgeUpgrade, confirmBridgeDemolish, closeBridgePicker } from './render/bridgepicker';
import { openBuildMenu, chooseBuildOption, closeBuildMenu } from './render/buildmenu';
import { clickPirate } from './render/pirates';
import { setSetupTab, setupTabKey, toggleDlcOpen, openDlcRow } from './render/setup';
import { onVisualsEvent, resetManifest } from './visuals';
import { clickSpot } from './pieceui';
import {
  setHexOverlay, clearHexOverlays, showTimerPopup, dismissTimerPopup, triggerTimerPopupAction,
  showEventTitleCard, showRoundRecapCard, dismissRoundRecapCard
} from './render/overlay';
import {
  createRoom, joinRoom, spectateRoom, toggleSpectate, selectSpectateTarget, rejoinSavedRoom, downloadTrainingLog, saveSessionInfo, clearSavedRoom, syncRejoinButton,
  copyInviteLink, copyInviteCodeOnly, shareInviteCode, pasteInviteCode, toggleMobileSidebar, switchLobbyTab, setPainterTab, toggleLobbyToolbar, toggleGameMenu,
  setBrush, applyPreset, applyScenario, toggleDlc, toggleAddon, enableAddonWithDeps, previewTideLevel, setTideLevel, previewRisingSeaLevel, setRisingSeaLevel, pushSettings, schedulePushSettings, addBot, removeBot, startGame, rematchLobby, backToWorldSetup, switchVictoryTab,
  toggleVictoryMapInspect, setBuildMode, mainTurnButton, rollDice, buyDevCard, cycleAvatar, cycleBotTier, collapseLobbyUi, setSetupOpen
} from './actions';
import {
  debugClickBoard,
  initDebugMode,
  onDebugStateUpdated,
  sendDebugCmd,
  setDebugBrush,
  toggleDebugIds,
  toggleDebugMode,
  toggleDebugStressHex
} from './debug';

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
  createRoom, joinRoom, spectateRoom, toggleSpectate, selectSpectateTarget, rejoinSavedRoom, downloadTrainingLog, copyInviteLink, copyInviteCodeOnly, shareInviteCode, pasteInviteCode, toggleMobileSidebar, toggleSound, toggleTheme, resetCamera, toggleLobbyToolbar, toggleGameMenu,
  switchLobbyTab, setPainterTab, applyPreset, applyScenario, toggleDlc, toggleAddon, enableAddonWithDeps, previewTideLevel, setTideLevel, previewRisingSeaLevel, setRisingSeaLevel, addBot, removeBot, startGame, rematchLobby, backToWorldSetup,
  switchVictoryTab, toggleVictoryMapInspect, setBrush, pushSettings,
  executeBankTrade, proposePlayerTrade, rollDice, confirmInlineAction, closeInlineDrawer,
  toggleTradeDrawer, buyDevCard, setBuildMode, mainTurnButton, sendChat,
  setLogTab: onSetLogTab, toggleRoundCollapse, toggleLogFilter, toggleTechPanel, researchTechClick, upgradePortClick, pickGroundHex, convertTileClick,
  clickPlacedBridge, chooseBridgeType, confirmBridgeUpgrade, confirmBridgeDemolish, closeBridgePicker, clickPirate, clickSpot,
  openBuildMenu, chooseBuildOption, closeBuildMenu, fishPickAdd, fishPickRemove, fishPickConfirm,
  confirmTradeWith, cancelTrade, respondToTrade, onClickHandResource, onClickHandWild, onClickDevCard,
  startCounter, adjustCounter, sendCounter, cancelCounter, toggleTradesCollapsed, cycleAvatar, cycleBotTier, setSetupOpen, setSetupTab, setupTabKey, toggleDlcOpen, openDlcRow,
  startSavePreset, cancelSavePreset, confirmSavePreset, presetNameKey, applyCustomPreset, applyPresetStyle,
  askDeletePreset, cancelDeletePreset, deletePreset,
  toggleMapMenu, mapPick, mapLandInput, mapLandChange, mapParamInput, mapParamChange, mapReroll, mapCopySeed, mapCopyCode, mapEditSeed,
  mapCancelSeed, mapSeedKey, mapApplySeed, mapToggleLock, mapToggleSeedVisible,
  pickGold, spendFishPick, chooseRobberVictim, confirmMonopoly, adjustDiscard, removeCardFromDiscard, removeWildFromDiscard, adjustTradeWant, adjustTradeGive, fixBankTrade,
  onHexInteract, onHexClick, onHexEnter, onEdgeInteract, clickVertex, clickNetSpot, clickFeedSpot, clickHarborSpot, clickEdge,
  onRoadHover, onRoadMove, onRoadLeave,
  setHexOverlay, clearHexOverlays, showTimerPopup, dismissTimerPopup, triggerTimerPopupAction,
  showEventTitleCard, showRoundRecapCard, dismissRoundRecapCard, toggleElevationView,
  toggleDebugMode, sendDebugCmd, setDebugBrush, toggleDebugIds, toggleDebugStressHex, debugClickBoard
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
  onDebugStateUpdated();

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
    zoomBoardPreview(rect);
  }, { passive: false });

  let lastLobbyPaintedHexId: number | null = null;
  stage.addEventListener('mousedown', (e: MouseEvent) => {
    const target = e.target as Element | null;
    // Ignore clicks on floating UI panels inside boardStage (only pan when pressing on the SVG board or stage)
    if (target && target !== stage && !target.closest('#boardSvg')) return;

    const isLobbyHexBrush = Boolean(
      state &&
      state.status === 'LOBBY' &&
      state.hostId === socket.id &&
      (activeBrush.type === 'terrain' || activeBrush.type === 'number' || activeBrush.type === 'robber')
    );
    const isLobbyPortBrush = Boolean(
      state &&
      state.status === 'LOBBY' &&
      state.hostId === socket.id &&
      activeBrush.type === 'port'
    );
    const paintedHexId = isLobbyHexBrush && e.button === 0 && !e.altKey ? hexAtClientPoint(e.clientX, e.clientY) : null;
    const paintedPortEdgeId = isLobbyPortBrush && e.button === 0 && !e.altKey ? portEdgeAtClientPoint(e.clientX, e.clientY) : null;
    const isLobbyPaintTarget = Boolean(
      paintedHexId !== null ||
      paintedPortEdgeId !== null ||
      (state &&
        state.status === 'LOBBY' &&
        state.hostId === socket.id &&
        activeBrush.type &&
        target?.closest('[data-paintable="1"]'))
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
      lastLobbyPaintedHexId = paintedHexId;
      if (paintedHexId !== null) {
        onHexInteract(paintedHexId, e);
      } else if (paintedPortEdgeId !== null) {
        onEdgeInteract(paintedPortEdgeId);
      }
    }
  });
  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (isPanning && state && state.board) {
      if (!hasDraggedMap && Math.hypot(e.clientX - panOrigin.x, e.clientY - panOrigin.y) > 4) {
        setHasDraggedMap(true);
        // BUG 1: a shield over the board takes the pointer during a drag (no hover work); turning off pointer events on the svg would restyle every node.
        document.getElementById('boardPanShield')?.classList.add('on');
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
      panBoardPreview(rect);
    } else if (
      isMouseDown &&
      state &&
      state.status === 'LOBBY' &&
      state.hostId === socket.id &&
      (activeBrush.type === 'terrain' || activeBrush.type === 'number' || activeBrush.type === 'robber')
    ) {
      const hexId = hexAtClientPoint(e.clientX, e.clientY);
      if (hexId !== null && hexId !== lastLobbyPaintedHexId) {
        lastLobbyPaintedHexId = hexId;
        onHexEnter(hexId, e);
      }
    }
  });
  window.addEventListener('mouseup', () => {
    if (isPanning) endBoardPan();
    setIsMouseDown(false);
    setIsPanning(false);
    lastLobbyPaintedHexId = null;
    panSvgRect = null;
    document.getElementById('boardPanShield')?.classList.remove('on');
  });

  // ---- Mobile multi-touch pan, 2-finger pinch-to-zoom, and lobby brush drag ----
  let touchPinchDist = 0;
  let touchPinchMidX = 0;
  let touchPinchMidY = 0;
  let isTouchPainting = false;

  stage.addEventListener('touchstart', (e: TouchEvent) => {
    const target = e.target as Element | null;
    if (target && target !== stage && !target.closest('#boardSvg')) return;
    if (!state || !state.board) return;

    const svg = document.getElementById('boardSvg');
    panSvgRect = svg ? svg.getBoundingClientRect() : null;
    cachedWheelRect = panSvgRect;
    cachedWheelRectTime = performance.now();

    if (e.touches.length === 2) {
      e.preventDefault();
      if (isPanning) endBoardPan();
      setIsPanning(false);
      isTouchPainting = false;
      setHasDraggedMap(true);
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      touchPinchDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) || 1;
      touchPinchMidX = (t0.clientX + t1.clientX) / 2;
      touchPinchMidY = (t0.clientY + t1.clientY) / 2;
      return;
    }

    if (e.touches.length === 1) {
      const t = e.touches[0];
      const isLobbyHexBrush = Boolean(
        state.status === 'LOBBY' &&
        state.hostId === socket.id &&
        (activeBrush.type === 'terrain' || activeBrush.type === 'number' || activeBrush.type === 'robber')
      );
      const isLobbyPortBrush = Boolean(
        state.status === 'LOBBY' &&
        state.hostId === socket.id &&
        activeBrush.type === 'port'
      );
      const paintedHexId = isLobbyHexBrush ? hexAtClientPoint(t.clientX, t.clientY) : null;
      const paintedPortEdgeId = isLobbyPortBrush ? portEdgeAtClientPoint(t.clientX, t.clientY) : null;
      const isLobbyPaintTarget = Boolean(
        paintedHexId !== null ||
        paintedPortEdgeId !== null ||
        (state.status === 'LOBBY' &&
          state.hostId === socket.id &&
          activeBrush.type &&
          target?.closest('[data-paintable="1"]'))
      );

      setHasDraggedMap(false);
      panOrigin.x = t.clientX;
      panOrigin.y = t.clientY;

      if (!isLobbyPaintTarget) {
        setIsPanning(true);
        isTouchPainting = false;
        panStart.x = t.clientX;
        panStart.y = t.clientY;
      } else {
        setIsPanning(false);
        isTouchPainting = true;
        lastLobbyPaintedHexId = paintedHexId;
        if (paintedHexId !== null) {
          onHexInteract(paintedHexId);
        } else if (paintedPortEdgeId !== null) {
          onEdgeInteract(paintedPortEdgeId);
        }
      }
    }
  }, { passive: false });

  stage.addEventListener('touchmove', (e: TouchEvent) => {
    if (!state || !state.board) return;
    const rect = panSvgRect || cachedWheelRect;
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    if (e.touches.length === 2 && touchPinchDist > 0) {
      e.preventDefault();
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const newDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) || 1;
      const newMidX = (t0.clientX + t1.clientX) / 2;
      const newMidY = (t0.clientY + t1.clientY) / 2;

      const { contentW, contentH } = getBoardBounds();
      const baseUnitPerPx = Math.max(contentW / rect.width, contentH / rect.height);
      const oldZoom = camZoom;
      const scaleRatio = touchPinchDist / newDist;
      const newZoom = Math.max(0.05, Math.min(4.5, oldZoom * scaleRatio));

      const offsetX = newMidX - (rect.left + rect.width / 2);
      const offsetY = newMidY - (rect.top + rect.height / 2);
      const oldWorldPerPx = oldZoom * baseUnitPerPx;
      const newWorldPerPx = newZoom * baseUnitPerPx;

      const midDx = newMidX - touchPinchMidX;
      const midDy = newMidY - touchPinchMidY;

      const newPanX = camPanX + offsetX * (newWorldPerPx - oldWorldPerPx) + midDx * newWorldPerPx;
      const newPanY = camPanY + offsetY * (newWorldPerPx - oldWorldPerPx) + midDy * newWorldPerPx;

      touchPinchDist = newDist;
      touchPinchMidX = newMidX;
      touchPinchMidY = newMidY;

      setCamZoom(newZoom);
      setCamPan(newPanX, newPanY);
      panBoardPreview(rect);
      return;
    }

    if (e.touches.length === 1) {
      const t = e.touches[0];
      if (isPanning) {
        if (!hasDraggedMap && Math.hypot(t.clientX - panOrigin.x, t.clientY - panOrigin.y) > 8) {
          setHasDraggedMap(true);
          document.getElementById('boardPanShield')?.classList.add('on');
          onRoadLeave();
        }
        if (hasDraggedMap) {
          e.preventDefault();
          const { contentW, contentH } = getBoardBounds();
          const worldPerPx = camZoom * Math.max(contentW / (rect.width || 1), contentH / (rect.height || 1));
          const dx = t.clientX - panStart.x;
          const dy = t.clientY - panStart.y;
          panStart.x = t.clientX;
          panStart.y = t.clientY;
          setCamPan(camPanX + dx * worldPerPx, camPanY + dy * worldPerPx);
          panBoardPreview(rect);
        }
      } else if (
        isTouchPainting &&
        state.status === 'LOBBY' &&
        state.hostId === socket.id &&
        (activeBrush.type === 'terrain' || activeBrush.type === 'number' || activeBrush.type === 'robber')
      ) {
        e.preventDefault();
        const hexId = hexAtClientPoint(t.clientX, t.clientY);
        if (hexId !== null && hexId !== lastLobbyPaintedHexId) {
          lastLobbyPaintedHexId = hexId;
          onHexEnter(hexId);
        }
      }
    }
  }, { passive: false });

  const endTouchGesture = (e: TouchEvent) => {
    if (e.touches.length === 0) {
      if (isPanning || touchPinchDist > 0) endBoardPan();
      setIsPanning(false);
      isTouchPainting = false;
      touchPinchDist = 0;
      lastLobbyPaintedHexId = null;
      panSvgRect = null;
      document.getElementById('boardPanShield')?.classList.remove('on');
    } else if (e.touches.length === 1) {
      if (touchPinchDist > 0) endBoardPan();
      touchPinchDist = 0;
      const t = e.touches[0];
      panStart.x = t.clientX;
      panStart.y = t.clientY;
      setIsPanning(true);
    }
  };
  stage.addEventListener('touchend', endTouchGesture);
  stage.addEventListener('touchcancel', endTouchGesture);
  stage.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as Element | null;
    if (hasDraggedMap) {
      setHasDraggedMap(false);
      if (!target?.closest('#myHandPanel, #activeTradeModal, #inlineDrawerWrap, #gameSettingsMenu')) {
        e.stopPropagation();
        e.preventDefault();
      }
      return;
    }

    // Design UI Philosophy (Interaction 1): "Small targets, big hit areas. Vertices, road edges and ports stay visually small,
    // but their tap area is at least 44px (invisible hit slop). Where areas overlap, the nearest target wins."
    if (target && (target.id === 'boardSvg' || target.closest('#boardSvg')) && !(e as any).__nearestResolved) {
      // Only a tiny handful of placed SVG elements remain clickable (#boardVerticesLayer buildings, #boardPieceSpotsLayer, #boardPiratesLayer, placed bridges).
      const clickedOnclickEl = target.closest<SVGGraphicsElement>('[onclick]:not([onclick=""])');
      if (clickedOnclickEl) return;

      const svgCandidates = document.querySelectorAll<SVGGraphicsElement>(
        '#boardVerticesLayer g[onclick]:not([onclick=""]), #boardPieceSpotsLayer g[onclick]:not([onclick=""]), #boardPiratesLayer g[onclick]:not([onclick=""])'
      );
      let nearestEl: SVGGraphicsElement | null = null;
      let nearestDist = 22; // 22px radius = 44px diameter minimum hit slop
      for (let i = 0; i < svgCandidates.length; i++) {
        const el = svgCandidates[i];
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
        if (dist <= nearestDist) {
          nearestDist = dist;
          nearestEl = el;
        }
      }
      if (nearestEl) {
        e.stopPropagation();
        e.preventDefault();
        const synth = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY });
        (synth as any).__nearestResolved = true;
        nearestEl.dispatchEvent(synth);
        return;
      }

      // Check all 2D-canvas interactive spots (settlement spots, road/bridge spots, ports, feed spots, robber/net hexes) via fast math hit-testing
      if (handleBoardCanvasClick(e.clientX, e.clientY, e)) {
        e.stopPropagation();
        e.preventDefault();
      }
    }
  }, true);

  // Design UI Philosophy (Interaction 2): "Bottom sheets swipe down to dismiss. The back gesture closes the top sheet or menu first and never exits the game by accident."
  const bindSwipeToDismiss = (el: HTMLElement | null, dir: 'down' | 'right', onDismiss: () => void) => {
    if (!el) return;
    let startX = 0;
    let startY = 0;
    let atTop = true;
    el.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      const scroller = el.querySelector<HTMLElement>('#inlineDrawer, .dock-body, #logFeed, #chatFeed') || el;
      atTop = scroller.scrollTop <= 4;
    }, { passive: true });
    el.addEventListener('touchend', (e: TouchEvent) => {
      if (e.changedTouches.length !== 1) return;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (dir === 'down' && atTop && dy > 56 && Math.abs(dy) > Math.abs(dx) * 1.35) {
        onDismiss();
      } else if (dir === 'right' && dx > 56 && Math.abs(dx) > Math.abs(dy) * 1.35) {
        onDismiss();
      }
    }, { passive: true });
  };

  bindSwipeToDismiss(document.getElementById('inlineDrawerWrap'), 'down', () => closeInlineDrawer());
  bindSwipeToDismiss(document.getElementById('lobbyToolbar'), 'down', () => collapseLobbyUi());
  bindSwipeToDismiss(document.querySelector<HTMLElement>('.right-sidebar'), 'right', () => toggleMobileSidebar(false));

  try {
    window.history.pushState({ hexGameGuard: true }, '');
  } catch {}
  window.addEventListener('popstate', () => {
    if (!state) return;
    const sidebar = document.querySelector<HTMLElement>('.right-sidebar');
    const settingsMenu = document.getElementById('gameSettingsMenu');
    const inlineWrap = document.getElementById('inlineDrawerWrap');
    const lobbyBar = document.getElementById('lobbyToolbar');
    const buildMenuEl = document.getElementById('buildMenu');
    const bridgePickerEl = document.getElementById('bridgePicker');

    if (buildMenuEl && buildMenuEl.style.display !== 'none' && buildMenuEl.innerHTML.trim() !== '') {
      closeBuildMenu();
    } else if (bridgePickerEl && bridgePickerEl.style.display !== 'none') {
      closeBridgePicker();
    } else if (sidebar && sidebar.classList.contains('mob-open')) {
      toggleMobileSidebar(false);
    } else if (settingsMenu && settingsMenu.style.display !== 'none') {
      toggleGameMenu(false);
    } else if (inlineWrap && inlineWrap.style.display !== 'none') {
      closeInlineDrawer();
    } else if (lobbyBar && lobbyBar.style.display !== 'none' && window.innerWidth <= 900) {
      collapseLobbyUi();
    }
    try {
      window.history.pushState({ hexGameGuard: true }, '');
    } catch {}
  });
  stage.addEventListener('contextmenu', e => e.preventDefault());
  initCursors();
  initDebugMode();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

