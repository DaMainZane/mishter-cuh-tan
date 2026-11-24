// MODULE: base hooks (game start state, S0.10 per-pack stats handler, round hooks, pick settling and trade pruning) | DEPENDS ON: packs/base/eventTimelineView, packs/base/picks, packs/base/trading, shared/index | USED BY: packs/base/index
import {
  clearExpiredMercenaries,
  currentPlayer,
  ensureEventTimeline,
  getPlayer,
  runRoundEvents,
  runRoundStartTaxesAndCatchUp,
  runStatHandlers,
  STAT_HANDLERS,
  tickMarkers,
  tickTileStates
} from '../../shared';
import { VIEW_DATA } from '../../shared';
import type { Ctx, PackApi } from '../../shared';
import { eventTimelineViewData } from './eventTimelineView';
import { settlePicks } from './picks';
import { pruneInvalidTrades } from './trading';

function recordActionStats(ctx: Ctx, actionType: string): void {
  const { g } = ctx;
  const playerTradeParticipants = new Set<string>();

  for (const ev of ctx.events) {
    const d = ev.data || {};
    switch (ev.type) {
      case 'rolled': {
        const p = getPlayer(g, d.playerId);
        if (p) {
          p.stats.rollsCount = (p.stats.rollsCount || 0) + 1;
          if (d.sum === 7) p.stats.sevensRolled = (p.stats.sevensRolled || 0) + 1;
        }
        break;
      }
      case 'produced': {
        const p = getPlayer(g, d.playerId);
        const amt = Number(d.amount) || 0;
        const res = String(d.resource || '');
        if (p && amt > 0) {
          p.stats.resProduced = (p.stats.resProduced || 0) + amt;
          if (res) p.stats[`res_${res}`] = (p.stats[`res_${res}`] || 0) + amt;
        }
        break;
      }
      case 'picked': {
        const p = getPlayer(g, d.playerId);
        const amt = Number(d.amount) || 0;
        const res = String(d.resource || '');
        if (p && amt > 0) {
          if ((p.stats._yopPending || 0) > 0) {
            const fromYop = Math.min(amt, p.stats._yopPending);
            p.stats._yopPending -= fromYop;
            p.stats.resDevGain = (p.stats.resDevGain || 0) + fromYop;
            if (amt > fromYop) p.stats.resProduced = (p.stats.resProduced || 0) + (amt - fromYop);
          } else {
            p.stats.resProduced = (p.stats.resProduced || 0) + amt;
          }
          if (res) p.stats[`res_${res}`] = (p.stats[`res_${res}`] || 0) + amt;
        }
        break;
      }
      case 'transferred': {
        const amt = Number(d.amount) || 0;
        const res = String(d.resource || '');
        if (amt <= 0) break;
        const fromP = d.from && d.from !== 'bank' ? getPlayer(g, d.from) : undefined;
        const toP = d.to && d.to !== 'bank' ? getPlayer(g, d.to) : undefined;

        if (d.kind === 'steal') {
          if (fromP) fromP.stats.resRobbed = (fromP.stats.resRobbed || 0) + amt;
          if (toP) {
            toP.stats.resStolen = (toP.stats.resStolen || 0) + amt;
            if (res) toP.stats[`res_${res}`] = (toP.stats[`res_${res}`] || 0) + amt;
          }
        } else if (d.kind === 'monopoly') {
          if (fromP) fromP.stats.resRobbed = (fromP.stats.resRobbed || 0) + amt;
          if (toP) {
            toP.stats.resStolen = (toP.stats.resStolen || 0) + amt;
            toP.stats.resDevGain = (toP.stats.resDevGain || 0) + amt;
            if (res) toP.stats[`res_${res}`] = (toP.stats[`res_${res}`] || 0) + amt;
          }
        } else if (d.kind === 'discard') {
          if (fromP) fromP.stats.resDiscarded = (fromP.stats.resDiscarded || 0) + amt;
        } else if (d.kind === 'playerTrade') {
          if (fromP) {
            fromP.stats.resTradedOut = (fromP.stats.resTradedOut || 0) + amt;
            playerTradeParticipants.add(fromP.id);
          }
          if (toP) {
            toP.stats.resTradedIn = (toP.stats.resTradedIn || 0) + amt;
            if (res) toP.stats[`res_${res}`] = (toP.stats[`res_${res}`] || 0) + amt;
            playerTradeParticipants.add(toP.id);
          }
        } else if (d.kind === 'bankTrade') {
          if (fromP) {
            fromP.stats.resTradedOut = (fromP.stats.resTradedOut || 0) + amt;
            fromP.stats.resBankGiven = (fromP.stats.resBankGiven || 0) + amt;
          }
          if (toP) {
            toP.stats.resTradedIn = (toP.stats.resTradedIn || 0) + amt;
            toP.stats.resBankGot = (toP.stats.resBankGot || 0) + amt;
            if (res) toP.stats[`res_${res}`] = (toP.stats[`res_${res}`] || 0) + amt;
          }
        }
        break;
      }
      case 'devBought': {
        const p = getPlayer(g, d.playerId);
        if (p) p.stats.devsBought = (p.stats.devsBought || 0) + 1;
        break;
      }
      case 'devPlayed': {
        const p = getPlayer(g, d.playerId);
        const card = String(d.card || '');
        if (p) {
          p.stats.devsPlayed = (p.stats.devsPlayed || 0) + 1;
          if (card) p.stats[`devPlayed_${card}`] = (p.stats[`devPlayed_${card}`] || 0) + 1;
          if (card === 'yearOfPlenty') p.stats._yopPending = (p.stats._yopPending || 0) + 2;
        }
        break;
      }
      case 'built': {
        const p = getPlayer(g, d.playerId);
        const piece = String(d.piece || '');
        if (p && piece) p.stats[`built_${piece}`] = (p.stats[`built_${piece}`] || 0) + 1;
        break;
      }
      case 'robberMoved': {
        const p = getPlayer(g, d.playerId);
        if (p) p.stats.robberMoves = (p.stats.robberMoves || 0) + 1;
        break;
      }
      case 'tradeProposed':
      case 'tradeCountered': {
        const p = getPlayer(g, d.playerId);
        if (p) p.stats.tradesProposed = (p.stats.tradesProposed || 0) + 1;
        break;
      }
    }
  }

  for (const pid of playerTradeParticipants) {
    const p = getPlayer(g, pid);
    if (p) p.stats.playerTrades = (p.stats.playerTrades || 0) + 1;
  }

  if (actionType === 'bank_trade') {
    const actor = currentPlayer(g);
    if (actor) actor.stats.bankTrades = (actor.stats.bankTrades || 0) + 1;
  }
}

export function registerHooks(api: PackApi): void {
  api.define(STAT_HANDLERS, { id: 'base.stats', handle: recordActionStats });

  api.hook('onGameStart', ctx => {
    ctx.g.ext.base = { tradeSeq: 0 };
    for (let s = 2; s <= 12; s++) ctx.g.diceStats[s] = 0;
    // The Event Deck shows its timeline from the start, so players see the first events coming.
    if (ctx.g.rules?.eventsOn) ensureEventTimeline(ctx.g, ctx.reg, 0);
  });
  api.define(VIEW_DATA, eventTimelineViewData);

  api.hook('onRoundStart', ctx => {
    tickTileStates(ctx);
    if (ctx.g.rules?.taxesOn || (ctx.g.rules?.catchUpMode && ctx.g.rules.catchUpMode !== 'off')) {
      runRoundStartTaxesAndCatchUp(ctx);
    }
    // The Event Deck (2026-11-24): an event every 2 to 4 rounds, the next three shown on the timeline (`runRoundEvents`).
    if (ctx.g.rules?.eventsOn && (ctx.g.round || 0) >= 1) runRoundEvents(ctx);
  });

  api.hook('onRoundEnd', ctx => {
    tickMarkers(ctx);
    clearExpiredMercenaries(ctx.g);
  });

  api.hook('onTurnStart', ctx => {
    const p = currentPlayer(ctx.g);
    if (p) p.stats.turnsTaken = (p.stats.turnsTaken || 0) + 1;
  });

  api.hook('afterAction', (ctx, actionType) => {
    runStatHandlers(ctx, actionType);
    pruneInvalidTrades(ctx.g);
    settlePicks(ctx);
  });
}

