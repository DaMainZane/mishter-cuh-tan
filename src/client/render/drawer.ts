// MODULE: bottom-left sheet (trade, discard, gold, monopoly, robber victim picker) | DEPENDS ON: client/audio, client/avatars, client/constants, client/fishSpend, client/icons, client/render/hand, +5 more | USED BY: client/main, client/render/hand, client/render/index
// Flat sheet from "Design UI Philosophy.md": no emoji, pictogram icons, every color comes from a token class in styles.css.
import { RESOURCES, RES_META } from '../constants';
import { getMiniSvg, buildOverlappingStackHtml, uiIcon, robberMarkup } from '../icons';
import { playTone } from '../audio';
import { socket } from '../socket';
import {
  state, drawerMode, tradeGive, tradeWant, discardSel, discardWild, wildDiscardCount, clearRes,
  setDrawerMode, setBuildModeValue
} from '../store';
import { renderAll } from './index';
import { renderHand } from './hand';
import { esc } from '../util';
import { avatarFace } from '../avatars';
import { showToast } from '../ui';
import { addFishPick, fishNeed, fishPickCount, fishPickList, removeFishPick } from '../fishSpend';

/** Picks for spending a stack of fish at once: resource -> count. Reset whenever the fish sheet opens or closes. */
let fishSel: Record<string, number> = {};

export function resetFishSel(): void {
  fishSel = {};
}

function myPlayer(): any {
  return state.players.find(p => p.id === socket.id);
}

export function canExecuteBankTrade(me: any): boolean {
  if (!me || !me.resources) return false;
  const ratios = state.tradeRatios || { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 };
  let credits = 0;
  let oneToOneUsed = 0;
  for (const r of RESOURCES) {
    const g = tradeGive[r] || 0;
    const rate = ratios[r] || 4;
    if (g > me.resources[r] || g % rate !== 0) return false;
    credits += g / rate;
    if (rate === 1 && g > 0) oneToOneUsed += g;
  }
  if (typeof me.harborTradesLeft === 'number' && oneToOneUsed > me.harborTradesLeft) {
    return false;
  }
  const wanted = RESOURCES.reduce((s, r) => s + (tradeWant[r] || 0), 0);
  return credits > 0 && credits === wanted;
}

/** What the bank takes per card for this resource: 4 normally, 3 with a generic port, 2 with a 2:1 port, 1 with a harbor (sent by the server). */
function bankRate(r: string): number {
  return Number(state.tradeRatios?.[r]) || 4;
}

function rateSource(rate: number): string {
  return rate === 1
    ? ' (your 1:1 harbor)'
    : rate === 2
      ? ' (your 2:1 port)'
      : rate === 3
        ? ' (your 3:1 port)'
        : ' (bank rate)';
}

function harborExplainSuffix(me: any, rate: number): string {
  if (rate <= 1) return '';
  if (typeof me?.harborTradesLeft === 'number' && me.harborTradesLeft <= 0) {
    return ' (harbor 1:1 limit of 4 trades per turn reached; now trading at 2:1)';
  }
  return ' (1:1 requires a harbor)';
}

interface BankAdvice { ok: boolean; text: string; fixable: boolean }

/**
 * Says why the current give/get cards are not a legal bank trade, and what would fix it. The rates are the player's own,
 * so with a port or harbor the message names the better rate (and explains 1:1 harbors and the 4-trade turn cap) instead of leaving a disabled button with no reason.
 */
export function bankTradeAdvice(me: any): BankAdvice {
  const giveRes = RESOURCES.filter(r => (tradeGive[r] || 0) > 0);
  const wantSum = RESOURCES.reduce((s, r) => s + (tradeWant[r] || 0), 0);
  if (giveRes.length === 0 && wantSum === 0) {
    return { ok: false, text: 'Click a resource above for what you want, then cards in your hand for what you give.', fixable: false };
  }
  if (canExecuteBankTrade(me)) return { ok: true, text: 'Bank trade is ready.', fixable: false };

  let oneToOneUsed = 0;
  for (const r of giveRes) {
    const have = me?.resources?.[r] || 0;
    const g = tradeGive[r];
    const name = RES_META[r].name;
    if (g > have) return { ok: false, text: `You only hold ${have} ${name}.`, fixable: false };
    const rate = bankRate(r);
    if (rate === 1) oneToOneUsed += g;
    if (g % rate !== 0) {
      const lower = Math.floor(g / rate) * rate;
      const how = lower >= rate ? `give ${lower} or ${lower + rate}` : `give ${rate}`;
      return {
        ok: false,
        text: `${name} trades at ${rate}:1${rateSource(rate)}${harborExplainSuffix(me, rate)}, so ${how} (you are giving ${g}).`,
        fixable: lower >= rate || have >= rate
      };
    }
  }

  if (typeof me?.harborTradesLeft === 'number' && oneToOneUsed > me.harborTradesLeft) {
    return {
      ok: false,
      text: `Harbor 1:1 trade limit is 4 per turn (${me.harborTradesLeft} left this turn).`,
      fixable: false
    };
  }

  const credits = giveRes.reduce((s, r) => s + tradeGive[r] / bankRate(r), 0);
  const single = giveRes.length === 1 ? giveRes[0] : null;
  const canFix = !!single && wantSum > 0 && bankRate(single) * wantSum <= (me?.resources?.[single] || 0);
  if (giveRes.length === 0) return { ok: false, text: 'Click cards in your hand for what you give.', fixable: false };
  if (wantSum === 0) return { ok: false, text: 'Pick what you want from the bank.', fixable: false };

  const portNote = giveRes
    .filter(r => bankRate(r) < 4)
    .map(r => ` Your ${bankRate(r)}:1 ${bankRate(r) === 1 ? 'harbor' : 'port'} on ${RES_META[r].name} means ${bankRate(r)} buys 1 card.`)
    .join('');
  if (credits > wantSum) {
    return { ok: false, text: `Your cards pay for ${credits} card${credits === 1 ? '' : 's'} but you asked for ${wantSum}.${portNote}`, fixable: canFix };
  }
  const maxRate = Math.max(...giveRes.map(r => bankRate(r)));
  return {
    ok: false,
    text: `You asked for ${wantSum} card${wantSum === 1 ? '' : 's'} but your cards only pay for ${credits}${harborExplainSuffix(me, maxRate)}.${portNote}`,
    fixable: canFix
  };
}

/** The "Fix amounts" button: rounds each give pile down to a legal size, then matches a single give pile to what you asked for. */
export function fixBankTrade(): void {
  const me = myPlayer();
  if (!me?.resources) return;
  for (const r of RESOURCES) {
    const g = tradeGive[r] || 0;
    const rate = bankRate(r);
    if (g <= 0 || g % rate === 0) continue;
    const lower = Math.floor(g / rate) * rate;
    if (lower >= rate) tradeGive[r] = lower;
    else if ((me.resources[r] || 0) >= rate) tradeGive[r] = rate;
  }
  const giveRes = RESOURCES.filter(r => (tradeGive[r] || 0) > 0);
  const wantSum = RESOURCES.reduce((s, r) => s + (tradeWant[r] || 0), 0);
  if (giveRes.length === 1 && wantSum > 0) {
    const r = giveRes[0];
    const need = bankRate(r) * wantSum;
    if (need <= (me.resources[r] || 0)) tradeGive[r] = need;
  }
  playTone(520, 0.06);
  renderHand(me, true);
  renderInlineDrawer(me, true);
}

export function canProposePlayerTrade(me: any): boolean {
  if (!me || !me.resources) return false;
  const giveSum = RESOURCES.reduce((s, r) => s + (tradeGive[r] || 0), 0);
  const wantSum = RESOURCES.reduce((s, r) => s + (tradeWant[r] || 0), 0);
  return giveSum > 0 && wantSum > 0;
}

// Counter adjusters used by inline onclick handlers inside the sheet markup.
export function adjustDiscard(r: string, delta: number): void {
  discardSel[r] = Math.max(0, (discardSel[r] || 0) + delta);
  const me = myPlayer();
  const isMyTurn = state.players[state.turnIndex]?.id === socket.id;
  renderHand(me, isMyTurn);
  renderInlineDrawer(me, isMyTurn);
}
export function removeCardFromDiscard(r: string): void {
  if (discardSel[r] > 0) {
    discardSel[r]--;
    playTone(420, 0.05);
    const me = myPlayer();
    const isMyTurn = state.players[state.turnIndex]?.id === socket.id;
    renderHand(me, isMyTurn);
    renderInlineDrawer(me, isMyTurn);
  }
}
export function removeWildFromDiscard(id: string): void {
  if ((discardWild[id] || 0) <= 0) return;
  discardWild[id]--;
  if (discardWild[id] <= 0) delete discardWild[id];
  playTone(420, 0.05);
  const me = myPlayer();
  const isMyTurn = state.players[state.turnIndex]?.id === socket.id;
  renderHand(me, isMyTurn);
  renderInlineDrawer(me, isMyTurn);
}
export function adjustTradeWant(r: string, delta: number): void {
  tradeWant[r] = Math.max(0, (tradeWant[r] || 0) + delta);
  renderInlineDrawer(myPlayer(), true);
}
export function adjustTradeGive(r: string, delta: number): void {
  tradeGive[r] = Math.max(0, (tradeGive[r] || 0) + delta);
  const me = myPlayer();
  renderHand(me, true);
  renderInlineDrawer(me, true);
}

// One pickable resource card. `rate` adds the small ratio chip underneath (trade sheet only).
function pickCardHtml(r: string, onclick: string, title: string, rate?: number): string {
  const rateHtml = rate !== undefined
    ? `<span class="rate ${rate < 4 ? 'better' : ''}">${rate}:1</span>`
    : '';
  return `
    <div class="mini-res-card card-${r}" onclick="${onclick}" title="${esc(title)}">
      ${getMiniSvg(r)}
      ${rateHtml}
    </div>`;
}

export function renderInlineDrawer(me: any, isMyTurn: boolean): void {
  const wrap = document.getElementById('inlineDrawerWrap')!;
  const drawer = document.getElementById('inlineDrawer')!;
  const sideStack = document.getElementById('tradeConfirmStack')!;
  const btnOk = document.getElementById('btnConfirmAction');
  const btnCancel = document.getElementById('btnCancelAction')!;
  if (btnOk) btnOk.style.display = 'none';
  btnCancel.style.display = 'none';
  sideStack.style.display = 'none';

  if (!drawerMode || !me) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'flex';

  if (drawerMode === 'gold') {
    drawer.innerHTML = `
      <div class="sheet-head">
        <span class="sheet-title">${getMiniSvg('gold').replace('width="28" height="28"', 'width="22" height="22"')} Gold reward</span>
        <span class="sheet-sub">Pick ${me.goldPending} resource${me.goldPending === 1 ? '' : 's'}</span>
      </div>
      <div class="pick-row">
        ${RESOURCES.map(r => pickCardHtml(r, `pickGold('${r}')`, `Take ${RES_META[r].name}`)).join('')}
      </div>
    `;
  } else if (drawerMode === 'monopoly') {
    btnCancel.style.display = 'flex';
    drawer.innerHTML = `
      <div class="sheet-head">
        <span class="sheet-title">Monopoly</span>
      </div>
      <div class="sheet-sub">Pick a resource. Every other player hands you all of theirs.</div>
      <div class="pick-row">
        ${RESOURCES.map(r => pickCardHtml(r, `confirmMonopoly('${r}')`, `Take all ${RES_META[r].name}`)).join('')}
      </div>
    `;
  } else if (drawerMode === 'discard') {
    const picked = RESOURCES.reduce((s, r) => s + discardSel[r], 0) + wildDiscardCount();
    const isReady = picked === me.discardPending;

    const trayResHtml = RESOURCES.filter(r => discardSel[r] > 0).map(r =>
      buildOverlappingStackHtml(
        `card-${r}`,
        getMiniSvg(r),
        discardSel[r],
        `removeCardFromDiscard('${r}')`,
        'Click to return to hand'
      )
    ).join('');
    // Held wild tokens (fish) picked for the discard sit in the tray next to the cards.
    const trayWildHtml = Object.keys(discardWild).filter(id => discardWild[id] > 0).map(id =>
      buildOverlappingStackHtml(
        `card-${id}`,
        getMiniSvg(id),
        discardWild[id],
        `removeWildFromDiscard('${id}')`,
        'Click to return to hand'
      )
    ).join('');
    const trayCardsHtml = trayResHtml + trayWildHtml;

    drawer.innerHTML = `
      <div class="sheet-head">
        <span class="sheet-title danger">Discard ${me.discardPending} cards</span>
        <span class="sheet-sub">${picked} of ${me.discardPending} chosen</span>
      </div>
      <div class="sheet-sub">A 7 was rolled and you hold more than ${me.discardLimit ?? state.settings.cardDiscardLimit} cards. Click cards in your hand to move them here.</div>
      <div class="tray">
        ${trayCardsHtml || '<span class="tray-hint">Nothing chosen yet</span>'}
      </div>
      <div class="sheet-foot">
        <button class="btn primary" ${!isReady ? 'disabled' : ''} onclick="confirmInlineAction()" title="Confirm discard">${uiIcon('check', 18)}Discard</button>
      </div>
    `;
  } else if (drawerMode === 'fish') {
    btnCancel.style.display = 'flex';
    const fish = me.wildTokens?.fish || 0;
    if (fish > 1) {
      // A stack: all the fish are spent at once, one pick per fish.
      const need = fishNeed(fish, state.bank);
      if (fishPickCount(fishSel) > need) fishSel = {};
      const picked = fishPickCount(fishSel);
      const trayHtml = fishPickList(fishSel).map(r =>
        `<div class="mini-res-card card-${r}" onclick="fishPickRemove('${r}')" title="Click to put back">${getMiniSvg(r)}</div>`
      ).join('');
      drawer.innerHTML = `
        <div class="sheet-head">
          <span class="sheet-title">${getMiniSvg('fish').replace('width="28" height="28"', 'width="22" height="22"')} Spend ${fish} fish</span>
          <span class="sheet-sub">${picked} of ${need} chosen</span>
        </div>
        <div class="sheet-sub">Every fish becomes 1 card of a resource you pick, taken from the bank. Pick ${need}.</div>
        <div class="pick-row">
          ${RESOURCES.map(r => pickCardHtml(r, `fishPickAdd('${r}')`, (state.bank?.[r] ?? 0) > 0 ? `Take ${RES_META[r].name}` : `The bank has no ${RES_META[r].name} left`)).join('')}
        </div>
        <div class="tray">${trayHtml || '<span class="tray-hint">Nothing chosen yet</span>'}</div>
        <div class="sheet-foot">
          <button class="btn primary" ${picked !== need || need === 0 ? 'disabled' : ''} onclick="fishPickConfirm()" title="Spend all the fish">${uiIcon('check', 18)}Spend ${need}</button>
        </div>
      `;
      return;
    }
    drawer.innerHTML = `
      <div class="sheet-head">
        <span class="sheet-title">${getMiniSvg('fish').replace('width="28" height="28"', 'width="22" height="22"')} Spend a fish</span>
        <span class="sheet-sub">${fish} held</span>
      </div>
      <div class="sheet-sub">One fish becomes 1 card of the resource you pick, taken from the bank.</div>
      <div class="pick-row">
        ${RESOURCES.map(r => pickCardHtml(r, `spendFishPick('${r}')`, (state.bank?.[r] ?? 0) > 0 ? `Take ${RES_META[r].name}` : `The bank has no ${RES_META[r].name} left`)).join('')}
      </div>
    `;
  } else if (drawerMode === 'robberSteal') {
    const victims = (state.robberVictims || [])
      .map((id: string) => state.players.find(p => p.id === id))
      .filter(Boolean);
    drawer.innerHTML = `
      <div class="sheet-head">
        <span class="sheet-title danger">
          <svg width="20" height="24" viewBox="-14 -24 28 40" aria-hidden="true">${robberMarkup()}</svg>
          Choose who to rob
        </span>
      </div>
      <div class="pick-row">
        ${victims.map((v: any) => `
          <button class="victim-btn" onclick="chooseRobberVictim('${esc(v.id)}')" title="Steal a card from ${esc(v.name)}">
            <span class="avatar" style="background:${esc(v.color)}">${avatarFace(v.avatar, v.name)}</span>
            <span>${esc(v.name)}</span>
            <span class="count">${uiIcon('cards', 14)}${v.resourceCount}</span>
          </button>
        `).join('')}
      </div>
    `;
  } else if (drawerMode === 'trade') {
    btnCancel.style.display = 'flex';
    sideStack.style.display = 'flex';

    const bankOk = canExecuteBankTrade(me);
    (document.getElementById('btnExecBankTrade') as HTMLButtonElement).disabled = !bankOk;
    (document.getElementById('btnExecPlayerTrade') as HTMLButtonElement).disabled = !canProposePlayerTrade(me);

    const ratios = state.tradeRatios || { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 };
    const wantStacksHtml = RESOURCES.filter(r => tradeWant[r] > 0).map(r =>
      buildOverlappingStackHtml(
        `card-${r}`,
        getMiniSvg(r),
        tradeWant[r],
        `adjustTradeWant('${r}', -1)`,
        'Click to remove'
      )
    ).join('');

    const giveStacksHtml = RESOURCES.filter(r => tradeGive[r] > 0).map(r =>
      buildOverlappingStackHtml(
        `card-${r}`,
        getMiniSvg(r),
        tradeGive[r],
        `adjustTradeGive('${r}', -1)`,
        'Click to return to hand'
      )
    ).join('');

    const advice = bankTradeAdvice(me);
    const bankBtn = document.getElementById('btnExecBankTrade') as HTMLButtonElement;
    bankBtn.title = bankOk ? 'Trade with bank or port' : advice.text;
    const hintClass = advice.ok ? 'ok' : (advice.text.startsWith('Click') ? '' : 'warn');
    const fixHtml = advice.fixable ? ` <button type="button" class="chip-btn chip-accent" onclick="fixBankTrade()">Fix amounts</button>` : '';

    drawer.innerHTML = `
      <div class="sheet-head">
        <span class="sheet-title">${uiIcon('swap', 18)} Trade</span>
        <span class="sheet-sub">Ratios show your bank and port rates</span>
      </div>
      <div class="pick-row">
        ${RESOURCES.map(r => pickCardHtml(r, `adjustTradeWant('${r}', 1)`, `Want ${RES_META[r].name} (${ratios[r]}:1 with the bank)`, ratios[r])).join('')}
      </div>
      <div class="sheet-label">You get</div>
      <div class="tray">
        ${wantStacksHtml || '<span class="tray-hint">Pick resources above</span>'}
      </div>
      <div class="sheet-label">You give</div>
      <div class="tray">
        ${giveStacksHtml || '<span class="tray-hint">Click cards in your hand</span>'}
      </div>
      <div class="trade-hint ${hintClass}">${advice.text}${fixHtml}</div>
    `;
  }
}

export function toggleTradeDrawer(): void {
  if (drawerMode === 'trade') {
    setDrawerMode(null);
  } else {
    clearRes(tradeGive);
    clearRes(tradeWant);
    setDrawerMode('trade');
  }
  renderAll();
}

export function closeInlineDrawer(): void {
  resetFishSel();
  clearRes(tradeGive);
  clearRes(tradeWant);
  setDrawerMode(null);
  setBuildModeValue(null);
  renderAll();
}

export function confirmInlineAction(): void {
  if (drawerMode === 'discard') {
    playTone(620, 0.1);
    socket.emit('discardCards', { code: state.code, discards: discardSel, wild: { ...discardWild } });
    setDrawerMode(null);
  }
  renderAll();
}

export function executeBankTrade(): void {
  // The bank can only hand out what it still holds.
  for (const r of RESOURCES) {
    const want = tradeWant[r] || 0;
    if (want > 0 && (state.bank?.[r] ?? 0) < want) {
      const have = state.bank?.[r] ?? 0;
      showToast(have === 0 ? `The bank has no ${RES_META[r].name} left.` : `The bank only has ${have} ${RES_META[r].name} left.`);
      playTone(300, 0.1);
      return;
    }
  }
  playTone(620, 0.1);
  socket.emit('bankTrade', { code: state.code, give: tradeGive, get: tradeWant });
  setDrawerMode(null);
  renderAll();
}

export function proposePlayerTrade(): void {
  // Whether anyone else holds the wanted card is checked by the server (it sees every hand); a client-side guess from the bank
  // and supply numbers kept going stale, so it is gone. The server's reason arrives as a toast.
  playTone(580, 0.1);
  socket.emit('proposeTrade', { code: state.code, offer: tradeGive, request: tradeWant });
}

export function confirmMonopoly(r: string): void {
  socket.emit('playDevCard', { code: state.code, cardType: 'monopoly', monopolyResource: r });
  setDrawerMode(null);
  renderAll();
}

/** Tidebound fish: spend one fish as 1 card of `resource` from the bank. The server checks the rest. */
export function spendFishPick(resource: string): void {
  if ((state.bank?.[resource] ?? 0) <= 0) {
    showToast(`The bank has no ${RES_META[resource]?.name ?? resource} left.`);
    playTone(300, 0.1);
    return;
  }
  playTone(700, 0.1);
  socket.emit('act', { code: state.code, type: 'spend_fish', payload: { resource } });
  setDrawerMode(null);
  renderAll();
}

/** Fish stack sheet: take one more card of `resource` for the fish that are left to spend. */
export function fishPickAdd(resource: string): void {
  const me = myPlayer();
  const next = addFishPick(fishSel, resource, me?.wildTokens?.fish || 0, state.bank);
  if (next === fishSel) {
    playTone(300, 0.1);
    return;
  }
  fishSel = next;
  playTone(500, 0.05);
  renderAll();
}

/** Fish stack sheet: put a picked card back. */
export function fishPickRemove(resource: string): void {
  fishSel = removeFishPick(fishSel, resource);
  playTone(420, 0.05);
  renderAll();
}

/** Fish stack sheet: spend every fish, one `spend_fish` per pick (the server runs them in order). */
export function fishPickConfirm(): void {
  const me = myPlayer();
  const need = fishNeed(me?.wildTokens?.fish || 0, state.bank);
  if (need === 0 || fishPickCount(fishSel) !== need) return;
  playTone(700, 0.1);
  for (const resource of fishPickList(fishSel)) {
    socket.emit('act', { code: state.code, type: 'spend_fish', payload: { resource } });
  }
  fishSel = {};
  setDrawerMode(null);
  renderAll();
}

export function pickGold(resource: string): void {
  playTone(780, 0.1);
  socket.emit('pickGoldResource', { code: state.code, resource });
}

export function chooseRobberVictim(victimId: string): void {
  playTone(340, 0.11);
  socket.emit('stealFromPlayer', { code: state.code, victimId });
  setDrawerMode(null);
}
