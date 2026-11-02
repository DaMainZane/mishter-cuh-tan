// MODULE: tidebound.rickety_bridges addon (T4a rickety bridge piece: 1 wood, health 1, shared pool and shared 2x cost with bridges, bot goal; T4b upgrade to a full bridge; T4d collapse on a 7 in Seven Resolver; T4e Longest Road recalc; T11c tech gate + +4 bridge cap bonus) | DEPENDS ON: packs/tidebound/bridgeConsts, packs/tidebound/bridgeCore, shared/index | USED BY: packs/tidebound/addons.generated, packs/tidebound/bridges, packs/tidebound/index, packs/tidebound/pirates, packs/tidebound/tech, packs/tidebound/wrecks, +1 more
import {
  BOT_GOALS,
  canAfford,
  COST_MODS,
  damagePiece,
  doubledCost,
  DURABILITY_DEFS,
  getPlayer,
  hasTech,
  payToBank,
  placedCount,
  priceOf,
  priceOfUpgrade,
  SEVEN_STEP_ORDER,
  SEVEN_STEPS,
  techGate,
  totalCards,
  updateAwards,
  VIEW_DATA
} from '../../shared';
import type {
  ActionDef,
  AddonDef,
  BotGoalDef,
  BotGoalItem,
  CostModifier,
  Ctx,
  DurabilityDef,
  GameState,
  Id,
  PieceDef,
  PlayerState,
  Registry,
  Resources,
  SevenStepDef,
  ViewDataDef
} from '../../shared';
import { bridgeBotGoal, bridgePiece, canPlaceBridge } from './bridgeCore';
import { BRIDGE, BRIDGE_BASE_LIMIT } from './bridgeConsts';

export const RICKETY = 'rickety_bridge';
export const RICKETY_COST: Resources = { wood: 1 };
/** Health of a rickety bridge. One hit (rolling a 7, T4d) breaks it. */
export const RICKETY_HEALTH = 1;
/** Price of turning a rickety bridge into a full bridge. Together with the 1 wood it adds up to the full bridge price. */
export const RICKETY_UPGRADE_COST: Resources = { brick: 1, ore: 1 };
/** Id that cost modifiers see for the upgrade (see `priceOfUpgrade`). */
export const RICKETY_UPGRADE_ID = 'upgrade_rickety_bridge';
/** Action type of the upgrade. */
export const UPGRADE_BRIDGE = 'upgrade_bridge';
/** Seven Resolver step id for collapsing rickety bridges on a 7 (T4d). */
export const RICKETY_SEVEN_STEP_ID = 'tidebound.rickety_collapse';
/** Tier 2 Expansion tech that unlocks rickety bridges and raises the bridge cap by +4 before 2x price (T11c). */
export const TECH_RICKETY_BRIDGES = 'tidebound.rickety_bridges';
/** Extra bridges allowed before the 2x cost threshold (and added to the bridge supply cap) when `tidebound.rickety_bridges` is owned. */
export const RICKETY_TECH_CAP_BONUS = 4;

// ---- Shared pool & T11c +4 cap bonus -------------------------------------------------------------------

/** Bridges plus rickety bridges this player has on the board. They share one pool, one cap and one 2x-cost threshold. */
export function bridgesOnBoard(g: GameState, pid: Id): number {
  return placedCount(g, pid, BRIDGE) + placedCount(g, pid, RICKETY);
}

/**
 * Effective bridge count threshold before bridges / rickety bridges / bridge upgrades cost 2x:
 * `baseLimit` (10 by default) + `RICKETY_TECH_CAP_BONUS` (4) when `pid` has researched `tidebound.rickety_bridges`.
 */
export function effectiveBridgeBaseLimit(g: GameState, pid: Id, baseLimit = BRIDGE_BASE_LIMIT): number {
  return hasTech(g, pid, TECH_RICKETY_BRIDGES) ? baseLimit + RICKETY_TECH_CAP_BONUS : baseLimit;
}

/**
 * Effective shared bridge supply cap for `pid`: `rules.pieceLimits.bridge` (already scaled by radius and VP)
 * plus `+4` when `pid` has researched `tidebound.rickety_bridges`.
 */
export function effectiveBridgeSupplyCap(g: GameState, pid: Id): number {
  const base = g.rules?.pieceLimits?.[BRIDGE] ?? BRIDGE_BASE_LIMIT;
  return hasTech(g, pid, TECH_RICKETY_BRIDGES) ? base + RICKETY_TECH_CAP_BONUS : base;
}

/**
 * Keeps the two supplies equal to the shared pool: `effectiveBridgeSupplyCap(g, pid)` minus what is on the board.
 * The engine reads one counter per piece id (`p.pieces[id]`), so the pool is kept as two mirrored counters and this puts both right.
 * It is cheap and safe to call at any time. T4d MUST call it after `damagePiece` breaks a rickety bridge, because that hands the piece
 * back to the rickety counter only.
 */
export function syncBridgePool(g: GameState, pid: Id): void {
  const p = getPlayer(g, pid);
  if (!p) return;
  const cap = effectiveBridgeSupplyCap(g, pid);
  const left = Math.max(0, cap - bridgesOnBoard(g, pid));
  p.pieces[BRIDGE] = left;
  if (p.pieces[RICKETY] !== undefined || g.rules?.pieceLimits?.[RICKETY] !== undefined) {
    p.pieces[RICKETY] = left;
  }
}

// ---- T4a & T11c: the piece -----------------------------------------------------------------------------

/**
 * Rickety bridge placement rule:
 * - Gated by `techGate(ctx.g, pid, TECH_RICKETY_BRIDGES)` (always allowed when `techTreeOn` is off; requires `tidebound.rickety_bridges` when `techTreeOn` is on).
 * - Otherwise identical to `canPlaceBridge` (ocean edges only, joined to your own building or road-like piece).
 */
export function canPlaceRicketyBridge(ctx: Ctx, pid: Id, edgeId: number, mode: 'setup' | 'build'): boolean {
  if (!techGate(ctx.g, pid, TECH_RICKETY_BRIDGES)) return false;
  return canPlaceBridge(ctx, pid, edgeId, mode);
}

export const ricketyPiece: PieceDef = {
  id: RICKETY,
  name: 'Rickety bridge',
  target: 'edge',
  cost: RICKETY_COST,
  vp: 0,
  produces: 0,
  baseLimit: BRIDGE_BASE_LIMIT,
  roadLike: true,
  scaleWithRadius: true,
  icon: '🪵',
  // R7a.5 (group 11): shows in the client's `pieceCosts` only once the Rickety bridges tech is unlocked (was a hard-coded line in `server/view.ts`).
  available: (g: GameState, pid: Id) => techGate(g, pid, TECH_RICKETY_BRIDGES),
  canPlace: canPlaceRicketyBridge
};

/** Health 1. One hit on a 7 breaks it (T4d). `repairCost` is a placeholder: at full health 1 a repair is never legal. */
export const ricketyDurability: DurabilityDef = {
  id: 'tidebound.rickety',
  pieceId: RICKETY,
  maxDurability: RICKETY_HEALTH,
  repairCost: { wood: 1 }
};

/**
 * Shared 2x cost threshold for the bridge + rickety bridge pool, respecting the +4 cap bonus from `tidebound.rickety_bridges`.
 * Note: `priceOf` checks `aboveBaseLimit(g, p, def)` (`placedCount >= 10`) before running `COST_MODS`. By computing from `def.cost`
 * against `effectiveBridgeBaseLimit(g, p.id)` (10 normally, 14 with `tidebound.rickety_bridges`), this both shares the pool threshold
 * across bridges + rickety bridges AND prevents premature doubling at 10..13 bridges when the tech is owned.
 */
export const ricketyPoolCostMod: CostModifier = {
  id: 'tidebound.rickety_pool',
  replace: true,
  apply(g: GameState, p: PlayerState, def: PieceDef, cost: Resources): Resources {
    if (def.id !== BRIDGE && def.id !== RICKETY) return cost;
    const limit = effectiveBridgeBaseLimit(g, p.id, def.baseLimit ?? BRIDGE_BASE_LIMIT);
    return bridgesOnBoard(g, p.id) >= limit ? doubledCost(def.cost) : { ...def.cost };
  }
};

// ---- T4b: upgrade to a full bridge ----------------------------------------------------------------------

/** What this player pays to upgrade one rickety bridge: 1 brick + 1 ore, doubled once the pool is at the effective base limit, then the cost modifiers. */
export function upgradeBridgeCost(g: GameState, reg: Registry, p: PlayerState): Resources {
  const limit = effectiveBridgeBaseLimit(g, p.id, BRIDGE_BASE_LIMIT);
  const base = bridgesOnBoard(g, p.id) >= limit ? doubledCost(RICKETY_UPGRADE_COST) : RICKETY_UPGRADE_COST;
  return priceOfUpgrade(g, reg, p, RICKETY_UPGRADE_ID, base);
}

/**
 * What the client needs to draw the upgrade button (T4c): this player's upgrade price, or `undefined` when rickety bridges are not in the game
 * (DLC or addon off) or locked behind `tidebound.rickety_bridges`, so a game without them sends nothing new.
 */
export function bridgeUpgradeView(g: GameState, reg: Registry, p: PlayerState): Resources | undefined {
  if (!reg.pieces.has(RICKETY)) return undefined;
  if (!techGate(g, p.id, TECH_RICKETY_BRIDGES)) return undefined;
  return upgradeBridgeCost(g, reg, p);
}

/**
 * VIEW_DATA entry (R7a.5, group 10): `bridgeUpgradeCost`, your price to upgrade a rickety bridge (yourself only). `bridgeUpgradeView` returns `undefined`
 * unless rickety bridges are in the game and unlocked, so the field is absent otherwise, as before.
 */
export const ricketyViewData: ViewDataDef = {
  id: 'tidebound.rickety_bridges.view',
  player: (g, reg, p, who) => ({ bridgeUpgradeCost: who.self ? bridgeUpgradeView(g, reg, p) : undefined })
};

/**
 * Upgrade: a rickety bridge you own becomes a full bridge in place. Payload `{ edgeId }`.
 * The pool does not change (the edge keeps holding one piece), so neither does the supply; the piece stays road-like, so Longest Road is untouched.
 */
export const upgradeBridgeAction: ActionDef = {
  type: UPGRADE_BRIDGE,
  validate(ctx: Ctx, pid: Id, payload: any): string | null {
    const { g, reg } = ctx;
    const p = getPlayer(g, pid);
    if (!p) return 'Unknown player';
    if (!techGate(g, pid, TECH_RICKETY_BRIDGES)) return 'Research Rickety bridges first';
    const e = Number.isInteger(payload?.edgeId) ? g.board.edges[payload.edgeId] : undefined;
    if (!e) return 'Choose a rickety bridge';
    if (!e.piece || e.piece.owner !== pid || e.piece.type !== RICKETY) return 'Only your own rickety bridge can be upgraded';
    if (!canAfford(p, upgradeBridgeCost(g, reg, p))) return 'Not enough resources to upgrade a bridge';
    return null;
  },
  apply(ctx: Ctx, pid: Id, payload: any): void {
    const { g, reg } = ctx;
    const p = getPlayer(g, pid)!;
    // Price first: the cost reads the board, which is about to change.
    payToBank(ctx, p, upgradeBridgeCost(g, reg, p));
    g.board.edges[payload.edgeId].piece = { type: BRIDGE, owner: pid };
    syncBridgePool(g, pid);
    p.stats.bridgesUpgraded = (p.stats.bridgesUpgraded || 0) + 1;
    ctx.emit('bridgeUpgraded', { playerId: pid, edgeId: payload.edgeId, from: RICKETY, to: BRIDGE });
    ctx.log(`🌉 ${p.avatar} ${p.name} upgraded a rickety bridge to a full bridge`, p.color);
  },
  legal(ctx: Ctx, pid: Id): { edgeId: number }[] {
    if (!techGate(ctx.g, pid, TECH_RICKETY_BRIDGES)) return [];
    const out: { edgeId: number }[] = [];
    for (const e of ctx.g.board.edges) {
      if (e.piece?.owner === pid && e.piece.type === RICKETY) out.push({ edgeId: e.id });
    }
    return out;
  }
};

// ---- Bot support (T4a build, T4b upgrade, T13b risk/reward tuning) --------------------------------------------

/**
 * Build: when a bot has a bridge spot in mind (the bridge goal's best edge) but cannot pay for a full bridge, it offers the cheap
 * version of the same edge a little below the bridge's priority.
 * Upgrade: upgrades when the hand still holds 3+ cards afterwards, or immediately (even with fewer spare cards) when the rickety
 * bridge sits inside a Longest Road contender or connects two endpoints of the player's network.
 */
export const ricketyBotGoal: BotGoalDef = {
  id: 'tidebound.rickety_bridges',
  goalClass: 'generic',
  goals(ctx: Ctx, pid: Id): BotGoalItem[] {
    if (!techGate(ctx.g, pid, TECH_RICKETY_BRIDGES)) return [];
    const p = getPlayer(ctx.g, pid);
    if (!p || (p.pieces[RICKETY] ?? 0) <= 0) return [];
    if (canAfford(p, priceOf(ctx.g, ctx.reg, p, bridgePiece))) return [];
    const best = bridgeBotGoal.goals ? bridgeBotGoal.goals(ctx, pid)[0] : undefined;
    const loc = best?.action?.payload?.loc;
    if (!best || !Number.isInteger(loc)) return [];
    return [{
      id: `rickety:${loc}`,
      priority: best.priority - 12,
      cost: priceOf(ctx.g, ctx.reg, p, ricketyPiece),
      action: { type: 'build', payload: { piece: RICKETY, loc } },
      needsTags: ['sea']
    }];
  },
  actionScore(ctx: Ctx, pid: Id, action: { type: string; payload: any }): number {
    if (action.type !== UPGRADE_BRIDGE) return 0;
    if (!techGate(ctx.g, pid, TECH_RICKETY_BRIDGES)) return 0;
    const { g } = ctx;
    const p = getPlayer(g, pid);
    if (!p) return 0;
    const cost = upgradeBridgeCost(g, ctx.reg, p);
    const paid = Object.values(cost).reduce((a, n) => a + (n || 0), 0);
    const rem = totalCards(p) - paid;
    const edgeId = Number(action.payload?.edgeId);
    const e = Number.isInteger(edgeId) ? g.board.edges[edgeId] : undefined;
    const internalLink =
      !!e &&
      [e.v1, e.v2].every(vId => {
        const v = g.board.vertices[vId];
        return !!v && (v.piece?.owner === pid || v.edgeIds.some(id => id !== edgeId && g.board.edges[id]?.piece?.owner === pid));
      });
    const roadContender = g.awards.longestRoad === pid || (p.stats.longestRoad || 0) >= 5 || hasTech(g, pid, 'tidebound.grand_causeway');
    if (roadContender && rem >= 1) return 45 + (internalLink ? 6 : 0);
    if (rem >= 3) return 30 + (internalLink ? 5 : 0);
    return 0;
  }
};

// ---- T4d: collapse on a 7 (Seven Resolver) & T4e: Longest Road recalculation ---------------------------

/**
 * On a 7, every rickety bridge on the board takes 1 damage (`RICKETY_HEALTH = 1`), breaks, and returns to the
 * owner's shared bridge pool (`syncBridgePool`). Then `updateAwards(ctx)` recalculates Longest Road and emits
 * `awardChanged` if the holder lost or handed off the award (recorded in the S0.10 public change log).
 * Draws zero values from `g.rng`.
 */
export const ricketyCollapseStep: SevenStepDef = {
  id: RICKETY_SEVEN_STEP_ID,
  order: SEVEN_STEP_ORDER.decay,
  isDlcSideEffect: true,
  priority: 85,
  canFire(ctx: Ctx): boolean {
    return ctx.g.board.edges.some(e => e.piece?.type === RICKETY);
  },
  run(ctx: Ctx): void {
    const { g } = ctx;
    const owners = new Set<Id>();
    const counts = new Map<Id, number>();
    for (const e of g.board.edges) {
      if (e.piece?.type !== RICKETY) continue;
      const ownerId = e.piece.owner;
      const res = damagePiece(ctx, 'edge', e.id, 1);
      if (res.broken) {
        owners.add(ownerId);
        counts.set(ownerId, (counts.get(ownerId) || 0) + 1);
      }
    }
    for (const ownerId of owners) {
      syncBridgePool(g, ownerId);
      const p = getPlayer(g, ownerId);
      const n = counts.get(ownerId) || 0;
      if (p && n > 0) {
        p.stats.ricketyCollapsed = (p.stats.ricketyCollapsed || 0) + n;
        ctx.log(`💥 ${p.avatar} ${p.name}'s ${n === 1 ? 'rickety bridge' : `${n} rickety bridges`} collapsed on a 7!`, p.color);
      }
    }
    if (owners.size > 0) {
      updateAwards(ctx);
    }
  }
};

export const ricketyBridgesAddon: AddonDef = {
  id: 'tidebound.rickety_bridges',
  name: 'Rickety bridges',
  description: 'A cheap bridge with 1 health that collapses on a 7. Upgrade it to a full bridge later.',
  deps: ['tidebound.bridges'],
  links: [
    { target: 'durability', kind: 'mechanic' },
    { target: 'seven-resolver', kind: 'mechanic' },
    { target: 'piece-cost', kind: 'mechanic' },
    { target: 'overlay', kind: 'ui' },
    { target: 'bot-goals', kind: 'bot' },
    { target: 'tidebound.bridges', kind: 'content' }
  ],
  rules: {
    // Same base as bridges, and `scaleWithRadius` scales it the same way, so the two supplies start equal (see `syncBridgePool`).
    pieceLimits: { [RICKETY]: BRIDGE_BASE_LIMIT }
  },
  register(api) {
    api.piece(ricketyPiece);
    api.define(DURABILITY_DEFS, ricketyDurability);
    api.define(COST_MODS, ricketyPoolCostMod);
    api.define(BOT_GOALS, ricketyBotGoal);
    api.define(SEVEN_STEPS, ricketyCollapseStep);
    api.action(upgradeBridgeAction);
    api.phaseAction('main', UPGRADE_BRIDGE);
    api.define(VIEW_DATA, ricketyViewData);
    // Shared pool: after either kind is built, put both supplies right.
    api.hook('onBuild', (ctx: Ctx, def: PieceDef, pid: Id) => {
      if (def.id === BRIDGE || def.id === RICKETY) syncBridgePool(ctx.g, pid);
    });
  }
};
