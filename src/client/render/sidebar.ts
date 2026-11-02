// MODULE: right sidebar (merged live log & turn history with RS card icons and click-to-filter, chat leaf, bank, player rows) | DEPENDS ON: client/avatars, client/constants, client/icons, client/logFilter, client/socket, client/store, +2 more | USED BY: client/main, client/render/board, client/render/index
import { RESOURCES } from '../constants';
import { dieFaceSvg, getDevSvg, getMiniSvg, uiIcon } from '../icons';
import { socket } from '../socket';
import {
  state,
  inFlightPlayerResCount,
  inFlightPlayerDevCount,
  logTab,
  logFilter,
  setLogFilter
} from '../store';
import type { RoundSummary, TurnActionItem, TurnActionResource } from '../types';
import { esc } from '../util';
import { avatarFace } from '../avatars';
import { actionMatchesFilter, splitFilterKey } from '../logFilter';

// Log and chat are text the player may select and copy. Re-writing innerHTML on every game update
// would wipe the selection, so each feed only re-renders when its content actually changed.
let lastMergedLogSig = '__dirty__';
let lastFilterBarSig = '__dirty__';
let lastChatSig = '';
let seenChatCount = 0;
const collapsedRounds = new Set<number>();

export function toggleRoundCollapse(roundNum: number): void {
  if (collapsedRounds.has(roundNum)) collapsedRounds.delete(roundNum);
  else collapsedRounds.add(roundNum);
  lastMergedLogSig = '__dirty__';
  renderSidebar();
}

export function toggleLogFilter(filter: string | null): void {
  setLogFilter(filter || null);
  lastMergedLogSig = '__dirty__';
  lastFilterBarSig = '__dirty__';
  renderSidebar();
}

function hasSelectionIn(el: HTMLElement): boolean {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return false;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  return el.contains(sel.anchorNode) || el.contains(sel.focusNode);
}

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}

function renderFeed(el: HTMLElement, sig: string, lastSig: string, html: () => string): boolean {
  if (sig === lastSig) return false;
  if (hasSelectionIn(el)) return false;
  const stick = isNearBottom(el);
  el.innerHTML = html();
  if (stick) el.scrollTop = el.scrollHeight;
  return true;
}

// In the lobby everyone can change their own avatar, and the host can change the bots'.
function canPickAvatar(p: any): boolean {
  if (state.status !== 'LOBBY') return false;
  return p.id === socket.id || (p.isBot && state.hostId === socket.id);
}

/** "Bot · Main" tag. In the lobby the host clicks it to change that bot's difficulty. */
function botTag(p: any): string {
  const label = p.difficulty ? String(p.difficulty) : '';
  const key = label.toLowerCase();
  const text = label ? `Bot · ${esc(label)}` : 'Bot';
  const pick = state.status === 'LOBBY' && state.hostId === socket.id && !!label;
  return `<span class="tag tier-${esc(key)} ${pick ? 'tier-pick' : ''}"
    ${pick ? `onclick="cycleBotTier('${esc(p.id)}')" title="Click to change difficulty"` : `title="Bot difficulty: ${esc(label || 'unknown')}"`}>${text}</span>`;
}

// ---- Player list: fixed size (CSS), scrolls to follow the turn ----------------------------------------------------
let lastTurnKey = '';
let lastRobKey = '';
let followRaf = 0;
let stackGuardsBound = false;

function bindStackGuards(el: HTMLElement): void {
  if (stackGuardsBound) return;
  stackGuardsBound = true;
  const stop = () => {
    if (followRaf) cancelAnimationFrame(followRaf);
    followRaf = 0;
  };
  el.addEventListener('wheel', stop, { passive: true });
  el.addEventListener('pointerdown', stop, { passive: true });
  el.addEventListener('touchstart', stop, { passive: true });
}

function scrollStackTo(el: HTMLElement, target: number): void {
  if (followRaf) cancelAnimationFrame(followRaf);
  followRaf = 0;
  const from = el.scrollTop;
  const dist = target - from;
  if (Math.abs(dist) < 1) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    el.scrollTop = target;
    return;
  }
  const dur = Math.min(520, 200 + Math.abs(dist) * 0.8);
  const t0 = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / dur);
    el.scrollTop = from + dist * (1 - Math.pow(1 - k, 3));
    followRaf = k < 1 ? requestAnimationFrame(step) : 0;
  };
  followRaf = requestAnimationFrame(step);
}

/** Scrolls the list the least it takes to show `row` completely. */
function revealRow(stackEl: HTMLElement, row: HTMLElement | null): void {
  if (!row) return;
  const top = row.offsetTop;
  const bottom = top + row.offsetHeight;
  const view = stackEl.scrollTop;
  const h = stackEl.clientHeight;
  let target = view;
  if (top < view) target = top;
  else if (bottom > view + h) target = bottom - h;
  target = Math.max(0, Math.min(Math.max(0, stackEl.scrollHeight - h), target));
  scrollStackTo(stackEl, target);
}

export function visibleRect(el: HTMLElement): { left: number; top: number; width: number; height: number } {
  const r = el.getBoundingClientRect();
  const stack = document.getElementById('playersStack');
  if (!stack || !el.classList.contains('p-row') || !stack.contains(el)) return r;
  const s = stack.getBoundingClientRect();
  const top = Math.min(Math.max(r.top, s.top), Math.max(s.top, s.bottom - r.height));
  return { left: r.left, top, width: r.width, height: r.height };
}

// ---- RS Card Icons & Click-to-Filter Helpers ----------------------------------------------------------------------

const RES_LABELS: Record<string, string> = {
  wood: 'Wood',
  brick: 'Brick',
  sheep: 'Sheep',
  wheat: 'Wheat',
  ore: 'Ore',
  gold: 'Gold',
  fish: 'Fish',
  mystery: 'Card'
};

const CAT_LABELS: Record<string, string> = {
  roll: 'Roll',
  produce: 'Produce',
  build: 'Build',
  trade: 'Trade',
  dev: 'Dev',
  rob: 'Rob',
  discard: 'Discard',
  award: 'Award',
  event: 'Event'
};

function rsCardIconHtml(res: string): string {
  const r = res.toLowerCase();
  if (r === 'dev') {
    return `<span class="th-rs-card card-dev">${getDevSvg('back')}</span>`;
  }
  if (r === 'mystery') {
    return `<span class="th-rs-card card-mystery">?</span>`;
  }
  const svg = getMiniSvg(r);
  if (svg) {
    return `<span class="th-rs-card card-${esc(r)}">${svg}</span>`;
  }
  return `<span class="th-rs-card card-wood">${getMiniSvg('wood')}</span>`;
}

function rsChipHtml(item: TurnActionResource): string {
  const r = item.resource.toLowerCase();
  const filterKey = `res:${r}`;
  const active = logFilter === filterKey;
  const sign = item.sign ?? '+';
  const toneCls = sign === '-' ? 'is-neg' : 'is-pos';
  return `<button type="button" class="th-rs-pill ${toneCls} ${active ? 'is-active' : ''}" onclick="toggleLogFilter('${esc(filterKey)}')" title="Click to filter by ${esc(RES_LABELS[r] || r)}">${rsCardIconHtml(r)}<span class="th-rs-amt">${esc(sign)}${item.amount}</span></button>`;
}

function pieceUiIconName(piece?: string): string {
  if (piece === 'settlement') return 'house';
  if (piece === 'city') return 'city';
  if (piece === 'road') return 'road';
  if (piece === 'bridge' || piece === 'rickety_bridge') return 'bridge';
  if (piece === 'net') return 'net';
  if (piece === 'harbor') return 'harbor';
  return 'house';
}

function actionIconHtml(act: TurnActionItem): string {
  if (act.resources && act.resources.length > 0) {
    return rsCardIconHtml(act.resources[0].resource);
  }
  if (act.category === 'produce' || act.category === 'discard') {
    const r = act.icon && RES_LABELS[act.icon] ? act.icon : 'wheat';
    return rsCardIconHtml(r);
  }
  if (act.category === 'dev') {
    return `<span class="th-rs-card card-dev">${getDevSvg(act.devCard || 'back')}</span>`;
  }
  if (act.category === 'roll') {
    if (act.icon === 'pass' || act.badge === 'Pass') {
      return `<span class="th-svg-ico">${uiIcon('pass', 14)}</span>`;
    }
    const face = act.diceSum ? Math.min(6, Math.max(1, ((act.diceSum - 1) % 6) + 1)) : 6;
    return `<span class="th-svg-ico th-die-ico">${dieFaceSvg(face)}</span>`;
  }
  if (act.category === 'build') {
    return `<span class="th-svg-ico">${uiIcon(pieceUiIconName(act.piece || act.icon), 14)}</span>`;
  }
  if (act.category === 'trade') {
    return `<span class="th-svg-ico">${uiIcon(act.badge === 'Bank' ? 'bank' : 'swap', 14)}</span>`;
  }
  if (act.category === 'rob') {
    return rsCardIconHtml('mystery');
  }
  if (act.category === 'award') {
    return `<span class="th-svg-ico">${uiIcon(act.badge === 'Winner' ? 'crown' : 'trophy', 14)}</span>`;
  }
  return `<span class="th-svg-ico">${uiIcon('waves', 14)}</span>`;
}

/** Replaces emoji resource symbols and resource keywords in raw log text with clickable mini RS card icons. */
function formatLogTextWithRsCards(rawText: string): string {
  // Strip leading decorative action emojis while keeping text clean
  const cleaned = String(rawText || '').replace(
    /^[\s🎲🌲🧱🐑🌾⛰️🪙🐟🏠🏰🛣️🌉🃏⚔️🥷🏦🤝🏆👑🌊⚓🪓🏴‍☠️⛵📜💥⏭️🔄]+/u,
    ''
  );
  // Escape HTML first
  let safe = esc(cleaned);
  // Replace inline emoji resource symbols if any remain
  const emojiMap: Record<string, string> = {
    '🌲': 'wood',
    '🧱': 'brick',
    '🐑': 'sheep',
    '🌾': 'wheat',
    '⛰️': 'ore',
    '🪙': 'gold',
    '🐟': 'fish'
  };
  for (const [emo, res] of Object.entries(emojiMap)) {
    if (safe.includes(emo)) {
      safe = safe.split(emo).join(
        `<button type="button" class="th-inline-rs ${logFilter === `res:${res}` ? 'is-active' : ''}" onclick="toggleLogFilter('res:${res}')" title="Filter by ${RES_LABELS[res]}">${rsCardIconHtml(res)}</button>`
      );
    }
  }
  // Replace standalone resource words (WOOD, BRICK, SHEEP, WHEAT, ORE, wood, brick, sheep, wheat, ore) with inline RS card + word
  safe = safe.replace(/\b(wood|brick|sheep|wheat|ore|gold|fish)\b/gi, match => {
    const r = match.toLowerCase();
    const active = logFilter === `res:${r}`;
    return `<button type="button" class="th-inline-rs-word ${active ? 'is-active' : ''}" onclick="toggleLogFilter('res:${r}')" title="Click to filter by ${RES_LABELS[r] || r}">${rsCardIconHtml(r)}<span>${esc(match)}</span></button>`;
  });
  return safe;
}

export function describeActiveFilter(filter: string): string {
  const [kind, val] = splitFilterKey(filter);
  if (kind === 'res') return RES_LABELS[val] || val;
  if (kind === 'cat') return CAT_LABELS[val] || val;
  if (kind === 'player') return val;
  if (kind === 'round') return val === '0' ? 'Setup' : `Round ${val}`;
  if (kind === 'val') return val;
  return filter;
}

function logLineMatchesFilter(lineText: string, filter: string | null): boolean {
  if (!filter) return true;
  const [kind, val] = splitFilterKey(filter);
  const low = String(lineText || '').toLowerCase();
  const vLow = (val || '').toLowerCase();
  if (kind === 'res' || kind === 'player' || kind === 'val') {
    return low.includes(vLow);
  }
  if (kind === 'cat') {
    if (vLow === 'roll') return low.includes('rolled') || low.includes('dice');
    if (vLow === 'produce') return low.includes('produced') || low.includes('collected') || low.includes('caught');
    if (vLow === 'build') return low.includes('built') || low.includes('placed') || low.includes('upgraded') || low.includes('raised');
    if (vLow === 'trade') return low.includes('traded') || low.includes('trade');
    if (vLow === 'dev') return low.includes('dev') || low.includes('knight') || low.includes('monopoly') || low.includes('plenty') || low.includes('researched');
    if (vLow === 'rob') return low.includes('rob') || low.includes('stole') || low.includes('pirate');
  }
  return true;
}

export function renderFilterBar(): void {
  if (typeof document === 'undefined') return;
  const bar = document.getElementById('logFilterBar');
  if (!bar) return;
  if (logTab !== 'live') {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  const sig = logFilter ? `active:${logFilter}` : 'none';
  if (sig === lastFilterBarSig && bar.innerHTML.length > 0) return;
  lastFilterBarSig = sig;

  const resBtns = RESOURCES.map(r => {
    const key = `res:${r}`;
    const active = logFilter === key;
    return `<button type="button" class="lf-rs-btn ${active ? 'active' : ''}" onclick="toggleLogFilter('${key}')" title="Filter by ${RES_LABELS[r]}">${rsCardIconHtml(r)}</button>`;
  }).join('');

  const catKeys: ('roll' | 'build' | 'trade' | 'dev' | 'rob')[] = ['roll', 'build', 'trade', 'dev', 'rob'];
  const catBtns = catKeys.map(c => {
    const key = `cat:${c}`;
    const active = logFilter === key;
    return `<button type="button" class="lf-val-btn ${active ? 'active' : ''}" onclick="toggleLogFilter('${key}')" title="Filter by ${CAT_LABELS[c]}">${CAT_LABELS[c]}</button>`;
  }).join('');

  const statusHtml = logFilter
    ? `<button type="button" class="lf-clear-btn" onclick="toggleLogFilter(null)" title="Clear filter"><span>${esc(describeActiveFilter(logFilter))}</span><span class="lf-x">✕</span></button>`
    : `<span class="lf-hint">Click a value to filter</span>`;

  bar.innerHTML = `
    <div class="lf-top-row">
      <div class="lf-rs-group">${resBtns}</div>
      ${statusHtml}
    </div>
    <div class="lf-cat-row">${catBtns}</div>
  `;
}

export function renderMergedLiveLog(el: HTMLElement): void {
  const history: RoundSummary[] = state.turnHistory || [];
  const logs: { text: string; color: string | null }[] = state.logs || [];
  const currentRoundNum = state.status === 'PLAYING' ? (state.round || 1) : -1;
  const sig = `${state.status}|${state.round || 0}|${ logFilter || '' }|${history.length}|${Array.from(collapsedRounds).sort().join(',')}|${history.map(r => `${r.round}:${r.turns.length}:${r.turns.reduce((s, t) => s + t.actions.length, 0)}`).join(';')}|${logs.length}:${logs.length ? logs[logs.length - 1].text : ''}`;

  const forceRender = lastMergedLogSig === '__dirty__';
  if (!forceRender && sig === lastMergedLogSig && el.innerHTML.trim().length > 0) return;
  if (!forceRender && hasSelectionIn(el)) return;
  lastMergedLogSig = sig;

  // In LOBBY (or before any turns are recorded), show the live log lines with clickable RS card icons
  if (state.status === 'LOBBY' || history.length === 0) {
    const filteredLogs = logs.filter(l => logLineMatchesFilter(l.text, logFilter));
    if (filteredLogs.length === 0) {
      el.innerHTML = `
        <div class="turn-history-empty">
          <div class="th-empty-title">${logFilter ? 'No matching log entries' : 'Live Log & Turn History'}</div>
          <div class="th-empty-desc">${logFilter ? 'Click the active filter above to show all entries.' : 'Rolls, resource cards, builds, trades, and round summaries appear here.'}</div>
        </div>
      `;
      return;
    }
    el.innerHTML = `<div class="th-live-lines">${filteredLogs.map(l => `
      <div class="log-line" ${l.color ? `style="color:${esc(l.color)}"` : ''}>${formatLogTextWithRsCards(l.text)}</div>
    `).join('')}</div>`;
    return;
  }

  // Display newest round first for instant visibility of recent play
  const reversedRounds = [...history].reverse();

  const roundBlocks: string[] = [];
  for (const rnd of reversedRounds) {
    const isCurrent = rnd.round === currentRoundNum && rnd.round > 0;
    const isCollapsed = !logFilter && collapsedRounds.has(rnd.round);

    const matchingTurnsHtml: string[] = [];
    let matchingActionsCount = 0;

    // Show newest turn first within the current round so live actions appear right at the top of the round
    const orderedTurns = [...rnd.turns].reverse();
    for (const turn of orderedTurns) {
      // A card with nothing in it (a player who only answered a trade) is not a turn, so it is never drawn as "Passed turn".
      if (turn.actions.length === 0) continue;
      const filteredActions = turn.actions.filter(act => actionMatchesFilter(act, turn, rnd, logFilter));
      if (logFilter && filteredActions.length === 0) continue;
      matchingActionsCount += filteredActions.length;

      const actionsHtml = filteredActions.length > 0
        ? filteredActions.map(act => {
            const catKey = `cat:${act.category}`;
            const catActive = logFilter === catKey;
            const rsListHtml = act.resources && act.resources.length > 0
              ? `<span class="th-rs-list">${act.resources.map(rsChipHtml).join('')}</span>`
              : '';
            const badgeKey = act.badge ? `val:${act.badge}` : '';
            const badgeActive = badgeKey && logFilter === badgeKey;
            return `
              <div class="th-action-row cat-${esc(act.category)}">
                <button type="button" class="th-act-icon-btn ${catActive ? 'is-active' : ''}" onclick="toggleLogFilter('${esc(catKey)}')" title="Click to filter by ${esc(CAT_LABELS[act.category] || act.category)}">${actionIconHtml(act)}</button>
                <span class="th-act-text">${formatLogTextWithRsCards(act.text)}${rsListHtml ? ` ${rsListHtml}` : ''}</span>
                ${act.badge ? `<button type="button" class="th-act-badge ${badgeActive ? 'is-active' : ''}" onclick="toggleLogFilter('${esc(badgeKey)}')" title="Click to filter by ${esc(act.badge)}">${esc(act.badge)}</button>` : ''}
              </div>
            `;
          }).join('')
        : '';

      const playerKey = `player:${turn.playerName}`;
      const playerActive = logFilter === playerKey;

      matchingTurnsHtml.push(`
        <div class="th-turn-card" style="border-left-color: ${esc(turn.playerColor)}">
          <div class="th-turn-head">
            <button type="button" class="th-player-filter-btn ${playerActive ? 'is-active' : ''}" onclick="toggleLogFilter('${esc(playerKey)}')" title="Click to filter by ${esc(turn.playerName)}">
              <span class="avatar th-avatar" style="background:${esc(turn.playerColor)}">${avatarFace(turn.playerAvatar, turn.playerName)}</span>
              <span class="th-player-name" style="color:${esc(turn.playerColor)}">${esc(turn.playerName)}</span>
            </button>
            ${turn.isBot ? `<span class="tag">Bot</span>` : ''}
            ${turn.turnCount > 0 ? `<span class="th-turn-num">#${turn.turnCount}</span>` : ''}
          </div>
          <div class="th-turn-actions">
            ${actionsHtml}
          </div>
        </div>
      `);
    }

    if (logFilter && matchingTurnsHtml.length === 0) continue;

    const roundKey = `round:${rnd.round}`;
    const roundBadgeActive = logFilter === roundKey;

    roundBlocks.push(`
      <div class="th-round-group ${isCurrent ? 'is-current-round' : ''} ${isCollapsed ? 'is-collapsed' : ''}">
        <div class="th-round-header" onclick="toggleRoundCollapse(${rnd.round})" title="Click to collapse/expand">
          <div class="th-round-title-wrap">
            <button type="button" class="th-round-badge ${roundBadgeActive ? 'is-active' : ''}" onclick="event.stopPropagation(); toggleLogFilter('${roundKey}')" title="Click to filter to ${esc(rnd.title)}">${rnd.round === 0 ? 'Setup' : `R${rnd.round}`}</button>
            <span class="th-round-title">${esc(rnd.title)}</span>
            ${isCurrent ? `<span class="tag accent">Current</span>` : ''}
          </div>
          <div class="th-round-right">
            <span class="th-round-summary-count">${matchingTurnsHtml.length} turn${matchingTurnsHtml.length !== 1 ? 's' : ''} · ${matchingActionsCount} act</span>
            <span class="th-chevron">${isCollapsed ? '▸' : '▾'}</span>
          </div>
        </div>
        ${!isCollapsed ? `<div class="th-round-turns">${matchingTurnsHtml.join('')}</div>` : ''}
      </div>
    `);
  }

  // Announcements (turn order, tides, seat changes) are recorded into the turn cards by the server, so there is no second feed here.
  if (roundBlocks.length === 0) {
    el.innerHTML = `
      <div class="turn-history-empty">
        <div class="th-empty-title">No matching actions</div>
        <div class="th-empty-desc">Click another value or clear the filter above to see all turns.</div>
      </div>
    `;
    return;
  }

  el.innerHTML = roundBlocks.join('');
}

export function renderSidebar(): void {
  if (typeof document === 'undefined' || !state) return;
  const logSectionEl = document.getElementById('logSection');
  const feedEl = document.getElementById('logFeed') || logSectionEl;
  const historyEl = document.getElementById('turnHistoryFeed');
  const chatSectionEl = document.getElementById('chatSection');
  const btnLive = document.getElementById('tabBtnLogLive');
  const btnChat = document.getElementById('tabBtnLogChat') || document.getElementById('tabBtnLogHistory');

  const chats: any[] = state.chats || [];
  if (logTab === 'chat') {
    seenChatCount = chats.length;
  } else if (chats.length < seenChatCount) {
    seenChatCount = chats.length;
  }
  const unreadChats = Math.max(0, chats.length - seenChatCount);

  if (btnLive && btnChat) {
    if (logTab === 'chat') {
      btnLive.classList.remove('active');
      btnChat.classList.add('active');
      if (feedEl && feedEl !== logSectionEl) feedEl.style.display = 'none';
      if (historyEl) historyEl.style.display = 'none';
      if (chatSectionEl) chatSectionEl.style.display = 'flex';
    } else {
      btnLive.classList.add('active');
      btnChat.classList.remove('active');
      if (feedEl && feedEl !== logSectionEl) feedEl.style.display = 'flex';
      if (historyEl) historyEl.style.display = 'none';
      if (chatSectionEl) chatSectionEl.style.display = 'none';
    }
    btnChat.innerHTML = unreadChats > 0
      ? `Chat <span class="chat-unread-badge">${unreadChats}</span>`
      : 'Chat';
  }

  renderFilterBar();
  if (feedEl) renderMergedLiveLog(feedEl);

  const chatEl = document.getElementById('chatFeed');
  const chatSig = `${chats.length}|${chats.length ? chats[chats.length - 1].text : ''}`;
  if (chatEl && renderFeed(chatEl, chatSig, lastChatSig, () => chats.map(c => `
    <div class="msg"><span class="dot" style="background:${esc(c.color)}"></span><strong>${esc(c.sender)}</strong>${esc(c.text)}</div>
  `).join(''))) {
    lastChatSig = chatSig;
  }

  const bankBarEl = document.getElementById('bankBar');
  if (!bankBarEl) return;
  const b = state.bank || { wood: 19, brick: 19, sheep: 19, wheat: 19, ore: 19 };
  bankBarEl.innerHTML = `
    <span class="bank-ico" title="Bank">${uiIcon('bank', 22)}</span>
    ${RESOURCES.map(r => `
      <div class="bank-item" id="bankRes_${r}">
        <div class="bank-chip card-${r}">${getMiniSvg(r)}</div>
        <span>${b[r]}</span>
      </div>
    `).join('')}
    <div class="bank-item" id="bankDevDeckItem">
      <div class="bank-chip card-dev">${uiIcon('devcard', 16)}</div>
      <span>${state.devDeckCount}</span>
    </div>
  `;

  const canPickVictim = state.phase === 'ROBBER_STEAL' && state.currentPlayerId === socket.id;
  const victimSet = new Set<string>(state.robberVictims || []);

  const stackEl = document.getElementById('playersStack')!;
  const stackTop = stackEl.scrollTop;
  bindStackGuards(stackEl);

  const isSpectatingGame = !!state.isSpectator && state.status !== 'LOBBY';

  const playerRowsHtml = state.players.map((p, idx) => {
    const isVictim = canPickVictim && victimSet.has(p.id);
    const isTurn = idx === state.turnIndex && state.status !== 'LOBBY';
    const shownResCount = Math.max(0, p.resourceCount - (inFlightPlayerResCount[p.id] || 0));
    const shownDevCount = Math.max(0, p.devCardCount - (inFlightPlayerDevCount[p.id] || 0));
    const overLimit = shownResCount > (p.discardLimit ?? state.settings.cardDiscardLimit);
    const tags = [
      p.isBot ? botTag(p) : '',
      isVictim ? '<span class="tag danger">Rob</span>' : '',
      p.discardPending > 0 ? '<span class="tag danger">Discarding</span>' : '',
      state.longestRoadOwner === p.id
        ? `<span class="tag accent">${p.stats?.vpBreakdown?.longestRoad === 16 ? 'Longest road · 16 VP' : 'Longest road'}</span>`
        : '',
      state.largestArmyOwner === p.id ? '<span class="tag accent">Largest army</span>' : ''
    ].filter(Boolean).join('');

    const pub = p.publicVp ?? p.vp;
    const vpHtml = pub !== p.vp ? `${pub}<span class="vp-hidden" title="Real score: ${p.vp}. Public score: ${pub}.">(${p.vp})</span>` : `${p.vp}`;

    const rowClickAttr = isVictim
      ? `onclick="chooseRobberVictim('${esc(p.id)}')" title="Click to rob ${esc(p.name)}"`
      : isSpectatingGame
      ? `onclick="selectSpectateTarget('${esc(p.id)}')" title="Click to inspect ${esc(p.name)}'s hand"`
      : '';

    return `
    <div class="p-row ${isTurn ? 'is-turn' : ''} ${isVictim ? 'can-rob' : ''} ${isSpectatingGame ? 'spec-clickable' : ''}"
      id="playerRow_${esc(p.id)}"
      ${rowClickAttr}>
      <div class="avatar p-avatar ${canPickAvatar(p) ? 'avatar-pick' : ''}" style="background:${esc(p.color)}"
        ${canPickAvatar(p) ? `onclick="cycleAvatar('${esc(p.id)}')" title="Click to change avatar"` : ''}>${avatarFace(p.avatar, p.name)}</div>
      <div>
        <div class="p-name"><span class="nm">${esc(p.name)}</span></div>
        <div class="p-sub">${tags}</div>
      </div>
      <div class="p-vp">${vpHtml}<small>VP</small></div>
      <div class="p-stats">
        <span class="stat ${overLimit ? 'warn' : ''}" title="${overLimit ? `Over the discard limit (${p.discardLimit ?? state.settings.cardDiscardLimit}): a 7 makes them discard` : 'Resource cards'}">${uiIcon('cards', 14)}${shownResCount}</span>
        <span class="stat dev" title="Development cards">${uiIcon('devcard', 14)}${shownDevCount}</span>
        <span class="stat" title="Knights played">${uiIcon('sword', 14)}${p.knightsPlayed}</span>
        <span class="stat" title="Longest road">${uiIcon('road', 14)}${p.longestRoadLength}</span>
      </div>
    </div>
  `;
  }).join('');

  const spectators = state.spectators || [];
  const specRowsHtml = spectators.length > 0
    ? `<div class="spec-sidebar-strip">
        <span class="spec-sidebar-lbl">${uiIcon('eye', 13)} Spectators (${spectators.length})</span>
        <div class="spec-sidebar-chips">
          ${spectators.map(s => {
            const pick = state.status === 'LOBBY' && s.id === socket.id;
            const hostBadge = s.id === state.hostId ? '<span class="tag accent">Host</span>' : '';
            return `<span class="spec-sidebar-chip">
              <span class="avatar ${pick ? 'avatar-pick' : ''}" style="background:${esc(s.color)};width:18px;height:18px"
                ${pick ? `onclick="cycleAvatar('${esc(s.id)}')" title="Click to change avatar"` : ''}>${avatarFace(s.avatar, s.name)}</span>
              <span>${esc(s.name)}</span>${hostBadge}
            </span>`;
          }).join('')}
        </div>
      </div>`
    : '';

  stackEl.innerHTML = playerRowsHtml + specRowsHtml;
  stackEl.scrollTop = stackTop;

  const turnKey = state.status === 'LOBBY' || state.status === 'GAMEOVER' ? '' : String(state.currentPlayerId ?? state.turnIndex);
  if (turnKey !== lastTurnKey) {
    const hadTurn = lastTurnKey !== '';
    lastTurnKey = turnKey;
    if (turnKey) revealRow(stackEl, document.getElementById(`playerRow_${state.currentPlayerId ?? state.players[state.turnIndex]?.id}`));
    else if (hadTurn) scrollStackTo(stackEl, 0);
  }
  const robKey = canPickVictim ? [...victimSet].join(',') : '';
  if (robKey !== lastRobKey) {
    lastRobKey = robKey;
    if (robKey) revealRow(stackEl, stackEl.querySelector<HTMLElement>('.p-row.can-rob'));
  }
}

export function sendChat(): void {
  const inp = document.getElementById('chatInput') as HTMLInputElement;
  if (!inp.value.trim()) return;
  socket.emit('sendChat', { code: state.code, text: inp.value });
  inp.value = '';
}
