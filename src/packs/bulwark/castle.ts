// MODULE: bulwark.castle addon (the step after a city: 9 cards, 4x production, 3 public VP, 2 before the doubled price; the robber's favourite target; a bot goal to build one) | DEPENDS ON: packs/base/constants, packs/bulwark/constants, shared/index | USED BY: packs/bulwark/addons.generated, packs/bulwark/index
import { BOT_GOALS, getPlayer, placedCount, priceOf, totalCards } from '../../shared';
import type { AddonDef, BotGoalDef, BotGoalItem, Ctx, Id, PieceDef } from '../../shared';
import { CITY } from '../base/constants';
import { CASTLE, CASTLE_BASE_LIMIT, CASTLE_COST, CASTLE_PRODUCES, CASTLE_SUPPLY, CASTLE_VP } from './constants';

/** Placement: one of your own cities, in the main phase. */
export function canUpgradeToCastle(ctx: Ctx, pid: Id, vertexId: number, mode: 'setup' | 'build'): boolean {
  if (mode !== 'build') return false;
  const v = ctx.g.board.vertices[vertexId];
  return !!v?.piece && v.piece.owner === pid && v.piece.type === CITY;
}

export const castlePiece: PieceDef = {
  id: CASTLE,
  name: 'Castle',
  target: 'vertex',
  cost: CASTLE_COST,
  vp: CASTLE_VP,
  produces: CASTLE_PRODUCES,
  upgradeFrom: CITY,
  baseLimit: CASTLE_BASE_LIMIT,
  baseDefense: 3,
  icon: '🏰',
  canPlace: canUpgradeToCastle,
  visual: {
    slot: 'vertex',
    button: {
      label: 'Castle',
      icon: '<path d="M4 21V9h3v3h2V9h2v3h2V9h2v3h2V9h3v12z"/><path d="M10 21v-4a2 2 0 0 1 4 0v4"/>',
      order: 35
    },
    hints: {
      noSupply: 'No castles left',
      cannotAfford: 'A castle costs 1 wood, 2 brick, 1 sheep, 2 wheat and 3 ore',
      noSpots: 'Upgrade one of your cities to a castle'
    },
    // A keep with three crenellated towers, drawn around (0,0) in a +-12 box.
    shape:
      '<path d="M-11 10 L-11 -4 L-8 -4 L-8 -7 L-5 -7 L-5 -4 L-3 -4 L-3 -10 L-1 -10 L-1 -8 L1 -8 L1 -10 L3 -10 L3 -4 L5 -4 L5 -7 L8 -7 L8 -4 L11 -4 L11 10 Z" fill="{color}" stroke="{dark}" stroke-width="1.3" stroke-linejoin="round"/>'
      + '<path d="M-2.5 10 L-2.5 4 A2.5 2.5 0 0 1 2.5 4 L2.5 10 Z" fill="{dark}"/>'
  }
};

/** Pips of a number token (2 and 12 are 1, 6 and 8 are 5). */
function pips(n: number | null): number {
  if (!n || n === 7) return 0;
  return 6 - Math.abs(7 - n);
}

/**
 * Bot goal: upgrade the city on the best ground (most pips around it, the robber's tile counted for nothing) once the bot can nearly pay for it.
 * The goal names the price, so a missing card feeds the bot's trading like any other build goal.
 */
export const castleBotGoal: BotGoalDef = {
  id: 'bulwark.castle',
  goalClass: 'generic',
  goals(ctx: Ctx, pid: Id): BotGoalItem[] {
    const { g, reg } = ctx;
    const p = getPlayer(g, pid);
    if (!p || (p.pieces[CASTLE] ?? 0) <= 0) return [];
    const cost = priceOf(g, reg, p, castlePiece);
    const price = Object.values(cost).reduce((a, n) => a + (n || 0), 0);
    if (totalCards(p) < price - 2) return [];
    let best = -1;
    let bestScore = -1;
    for (const v of g.board.vertices) {
      if (v.piece?.owner !== pid || v.piece.type !== CITY) continue;
      const score = v.hexIds.reduce((a, h) => a + (h === g.board.robberHexId ? 0 : pips(g.board.hexes[h]?.number ?? null)), 0);
      if (score > bestScore) {
        bestScore = score;
        best = v.id;
      }
    }
    if (best < 0) return [];
    const doubled = placedCount(g, pid, CASTLE) >= CASTLE_BASE_LIMIT;
    return [{
      id: `castle:${best}`,
      priority: (doubled ? 40 : 70) + bestScore,
      cost,
      action: { type: 'build', payload: { piece: CASTLE, loc: best } },
      needsTags: ['vp']
    }];
  }
};

export const castleAddon: AddonDef = {
  id: 'bulwark.castle',
  name: 'Castle',
  description: 'Upgrade a city to a castle: 9 cards (1 of each, +1 wheat, +2 ore, +1 brick) for 4x production and 3 public VP.',
  links: [
    { target: 'piece-cost', kind: 'mechanic' },
    { target: 'production', kind: 'mechanic' },
    { target: 'score', kind: 'mechanic' },
    { target: 'bot-goals', kind: 'bot' }
  ],
  rules: { pieceLimits: { [CASTLE]: CASTLE_SUPPLY } },
  register(api) {
    api.piece(castlePiece);
    api.define(BOT_GOALS, castleBotGoal);
  }
};
