// MODULE: tidebound.harbor addon (T8a: 1:1 port upgrade on a city, limit 1 per player or 2 with Harbor empire, works while flooded, minimal bot goal; T8b: max 4 1:1 trades per turn per harbor, falls back to 2:1 for the rest of the turn, invalid-ratio prompt explains harbors; T11e Harbor master tech gate) | DEPENDS ON: packs/base/constants, packs/base/techEffects, packs/tidebound/tech, shared/index | USED BY: packs/tidebound/addons.generated, packs/tidebound/index, packs/tidebound/risingSea, packs/tidebound/tides
import {
  addonOn,
  BOT_GOALS,
  canAfford,
  getPlayer,
  HARBOR_MIN_RATIO,
  HARBOR_RATIO_MODS,
  hasTech,
  payToBank,
  PORT_IDLE_CHECKS,
  priceOfUpgrade,
  ratioWithoutHarbor,
  techGate,
  totalCards,
  VIEW_DATA
} from '../../shared';
import type {
  ActionDef,
  AddonDef,
  BotGoalDef,
  BotGoalItem,
  Ctx,
  GameState,
  HarborRatioModifier,
  Id,
  PlayerState,
  PortIdleCheck,
  Registry,
  Resources,
  ViewDataDef
} from '../../shared';
import { CITY, GENERIC_PORT } from '../base/constants';
import { HARBOR_UPGRADE_COST, portLevel, portUpgrades } from '../base/techEffects';
import { registerTideboundTechs, TECH_HARBOR_EMPIRE, TECH_HARBOR_MASTER } from './tech';

export { TECH_HARBOR_EMPIRE, TECH_HARBOR_MASTER };

/** Action type for upgrading a port city to a 1:1 harbor. */
export const UPGRADE_HARBOR = 'upgrade_harbor';
/** Upgrade id passed to `priceOfUpgrade` so cost modifiers can target harbor upgrades. */
export const HARBOR_UPGRADE_ID = 'upgrade_harbor';
/** Base cost to upgrade a port city to a harbor (2 wood, 1 brick, 1 ore — same base resource mix as Tech Tree Design §4). */
export const HARBOR_COST: Resources = { ...HARBOR_UPGRADE_COST };
/** Step on the `g.ext.core.portUpgrades[vertexId]` ladder: 1 = Raise the Port (2:1), 2 = Harbor (1:1). */
export const HARBOR_LEVEL = 2;
/** Default max harbors per player (T8a). */
export const HARBOR_LIMIT = 1;
/** Maximum 1:1 trades per turn per harbor (T8b); after 4, the harbor falls back to 2:1 for the rest of the turn. */
export const HARBOR_MAX_TRADES = 4;
/** Spare cards a bot keeps in hand after paying for a harbor upgrade so it still has cards left to trade. */
export const HARBOR_BOT_SPARE = 2;

export interface HarborTurnTrades {
  turn: number;
  /** vertexId -> 1:1 trades used on this harbor during `turn`. */
  used: Record<number, number>;
}

/** True when `vertexId` is a port vertex with a city upgraded to Harbor level (`level >= 2`). */
export function isHarbor(g: GameState, vertexId: number): boolean {
  if (portLevel(g, vertexId) < HARBOR_LEVEL) return false;
  const v = g.board.vertices[vertexId];
  return !!v?.port && !!v.piece && v.piece.type === CITY;
}

/** Ascending vertex ids of all harbors currently owned by `pid`. */
export function harborsOf(g: GameState, pid: Id): number[] {
  const out: number[] = [];
  for (const v of g.board.vertices) {
    if (v.piece?.owner === pid && isHarbor(g, v.id)) out.push(v.id);
  }
  return out;
}

/** How many harbors `pid` currently has on the board. */
export function harborCount(g: GameState, pid: Id): number {
  return harborsOf(g, pid).length;
}

/** Maximum harbors `pid` may own (`1` by default, `2` with `tidebound.harbor_empire`). */
export function harborLimitFor(g: GameState, pid: Id): number {
  return hasTech(g, pid, TECH_HARBOR_EMPIRE) ? HARBOR_LIMIT + 1 : HARBOR_LIMIT;
}

/** Effective cost for `p` to upgrade a port city to a harbor, routed through the pricing service (`priceOfUpgrade`). */
export function harborUpgradeCost(g: GameState, reg: Registry, p: PlayerState): Resources {
  return priceOfUpgrade(g, reg, p, HARBOR_UPGRADE_ID, HARBOR_COST);
}

/** Does a port of type `portType` cover `resource`? (`3:1` generic covers every resource; `2:1:x` covers only `x`.) */
export function harborCovers(reg: Registry, portType: string | null | undefined, resource: string): boolean {
  if (!portType) return false;
  const port = reg.ports.get(portType);
  if (!port) return false;
  return port.resource === null || port.resource === resource;
}

// ---- T8b: per-turn 1:1 trade counter (max 4 per harbor per turn) ------------------------------------------------

function currentTurnKey(g: GameState): number {
  return g.turnCount || 0;
}

/** How many 1:1 trades have been used on `vertexId` during the current turn. Resets automatically when `turnCount` advances. */
export function harborTradesUsedAt(g: GameState, vertexId: number): number {
  const tr = g.ext?.tidebound?.harborTrades as HarborTurnTrades | undefined;
  if (!tr || tr.turn !== currentTurnKey(g)) return 0;
  return Math.max(0, Math.floor(Number(tr.used?.[vertexId])) || 0);
}

/** How many 1:1 trades remain on the harbor at `vertexId` this turn (`0..HARBOR_MAX_TRADES`). */
export function harborTradesLeftAt(g: GameState, vertexId: number): number {
  if (!isHarbor(g, vertexId)) return 0;
  return Math.max(0, HARBOR_MAX_TRADES - harborTradesUsedAt(g, vertexId));
}

/** Total 1:1 trades remaining across all harbors owned by `pid` this turn. */
export function harborTradesLeft(g: GameState, pid: Id): number {
  return harborsOf(g, pid).reduce((sum, vid) => sum + harborTradesLeftAt(g, vid), 0);
}

/** Total 1:1 trades remaining this turn on harbors owned by `pid` that cover `resource`. */
export function harborTradesLeftForResource(g: GameState, reg: Registry, pid: Id, resource: string): number {
  let sum = 0;
  for (const vid of harborsOf(g, pid)) {
    if (harborCovers(reg, g.board.vertices[vid]?.port, resource)) {
      sum += harborTradesLeftAt(g, vid);
    }
  }
  return sum;
}

/** Clears per-turn harbor trade counters at the start of a turn. */
export function resetHarborTrades(g: GameState): void {
  if (g.ext?.tidebound?.harborTrades) {
    delete g.ext.tidebound.harborTrades;
  }
}

/**
 * Simulates allocating a proposed `give` bundle across `pid`'s harbors for resources that rely on a harbor for 1:1.
 * Specialised harbors (`2:1:<res>`) are used before generic (`3:1`) harbors so a player with two harbors never wastes
 * generic capacity on a resource covered by their specialised harbor.
 */
function allocateHarborTrades(
  g: GameState,
  reg: Registry,
  pid: Id,
  give: Record<string, number>
): { ok: boolean; reason: string | null; usedByVertex: Map<number, number> } {
  const harbors = harborsOf(g, pid);
  const left = new Map<number, number>();
  for (const vid of harbors) left.set(vid, harborTradesLeftAt(g, vid));
  const usedByVertex = new Map<number, number>();

  for (const [r, n] of Object.entries(give)) {
    if (!n || n <= 0) continue;
    // Only resources where tidebound.harbor itself supplies the 1:1 ratio consume harbor trade slots.
    if (ratioWithoutHarbor(g, reg, pid, r) <= HARBOR_MIN_RATIO) continue;
    if (harborTradesLeftForResource(g, reg, pid, r) <= 0) continue;

    // Prefer specialised harbors for `r` before generic (`3:1`) harbors.
    const matching = harbors
      .filter(vid => harborCovers(reg, g.board.vertices[vid]?.port, r))
      .sort((a, b) => {
        const pa = reg.ports.get(g.board.vertices[a]?.port || '');
        const pb = reg.ports.get(g.board.vertices[b]?.port || '');
        const sa = pa?.resource === r ? 0 : 1;
        const sb = pb?.resource === r ? 0 : 1;
        return sa - sb || a - b;
      });

    let rem = n;
    for (const vid of matching) {
      const avail = left.get(vid) || 0;
      if (avail <= 0) continue;
      const take = Math.min(rem, avail);
      left.set(vid, avail - take);
      usedByVertex.set(vid, (usedByVertex.get(vid) || 0) + take);
      rem -= take;
      if (rem <= 0) break;
    }

    if (rem > 0) {
      return {
        ok: false,
        reason: `Harbor 1:1 trade limit of ${HARBOR_MAX_TRADES} trades per turn reached for ${r.toUpperCase()}!`,
        usedByVertex
      };
    }
  }
  return { ok: true, reason: null, usedByVertex };
}

/**
 * `HARBOR_RATIO_MODS` entry for `tidebound.harbor`:
 * - Grants `1:1` (`HARBOR_MIN_RATIO`) on resources covered by an owned harbor while that harbor still has 1:1 trades left this turn.
 * - Once all 4 trades on the harbor are used this turn, returns `null` so `ratioFor` falls back to `2:1` for the rest of the turn.
 * - Validates and records batch 1:1 trades, and explains why 1:1 is unavailable in `explainInvalidBankRatio`.
 */
export const harborRatioMod: HarborRatioModifier = {
  id: 'tidebound.harbor',
  apply(g: GameState, reg: Registry, pid: Id, resource: string): number | null {
    if (!addonOn(reg, 'tidebound.harbor')) return null;
    return harborTradesLeftForResource(g, reg, pid, resource) > 0 ? HARBOR_MIN_RATIO : null;
  },
  validateTrade(g: GameState, reg: Registry, pid: Id, give: Record<string, number>): string | null {
    if (!addonOn(reg, 'tidebound.harbor')) return null;
    const alloc = allocateHarborTrades(g, reg, pid, give);
    return alloc.ok ? null : alloc.reason;
  },
  recordTrade(g: GameState, reg: Registry, pid: Id, give: Record<string, number>): void {
    if (!addonOn(reg, 'tidebound.harbor')) return;
    const alloc = allocateHarborTrades(g, reg, pid, give);
    if (alloc.usedByVertex.size === 0) return;
    if (!g.ext) g.ext = {};
    if (!g.ext.tidebound) g.ext.tidebound = {};
    const turn = currentTurnKey(g);
    const prev = g.ext.tidebound.harborTrades as HarborTurnTrades | undefined;
    const tr: HarborTurnTrades =
      prev && prev.turn === turn ? prev : { turn, used: {} };
    for (const [vid, count] of alloc.usedByVertex.entries()) {
      tr.used[vid] = (tr.used[vid] || 0) + count;
    }
    g.ext.tidebound.harborTrades = tr;
  },
  explainNoOneToOne(g: GameState, reg: Registry, pid: Id, resource: string): string | null {
    const ownsCoveringHarbor = harborsOf(g, pid).some(vid =>
      harborCovers(reg, g.board.vertices[vid]?.port, resource)
    );
    if (ownsCoveringHarbor && harborTradesLeftForResource(g, reg, pid, resource) <= 0) {
      return `harbor 1:1 limit of ${HARBOR_MAX_TRADES} trades per turn reached`;
    }
    return '1:1 requires a harbor';
  }
};

/**
 * `PORT_IDLE_CHECKS` exemption: a harbor keeps working while its land tiles are flooded (both at 1:1 and when falling back to 2:1).
 */
export const harborIdleExemption: PortIdleCheck = {
  id: 'tidebound.harbor.floodExempt',
  idle(): boolean {
    return false;
  },
  exempt(g: GameState, reg: Registry, vertexId: number): boolean {
    return addonOn(reg, 'tidebound.harbor') && isHarbor(g, vertexId);
  }
};

// ---- T8a & T11e: upgrade_harbor action (gated by Harbor master when Tech Tree is on) ----------------------------

/**
 * Port vertices where `pid` owns a city that can be upgraded to a harbor (ignoring whether `pid` can currently afford the resource cost).
 * Empty when `pid` has not unlocked `tidebound.harbor_master` (when `techTreeOn` is on) or has already reached their harbor limit (`1`, or `2` with Harbor empire).
 */
export function harborCandidateVertices(g: GameState, reg: Registry, pid: Id): number[] {
  if (!addonOn(reg, 'tidebound.harbor')) return [];
  if (!techGate(g, pid, TECH_HARBOR_MASTER)) return [];
  if (harborCount(g, pid) >= harborLimitFor(g, pid)) return [];
  const out: number[] = [];
  for (const v of g.board.vertices) {
    if (!v.port || !reg.ports.has(v.port)) continue;
    if (!v.piece || v.piece.owner !== pid || v.piece.type !== CITY) continue;
    if (portLevel(g, v.id) >= HARBOR_LEVEL) continue;
    out.push(v.id);
  }
  return out;
}

/** Validates whether `pid` can upgrade `vertexId` to a harbor right now. Returns an error message or `null` when legal. */
export function canUpgradeHarbor(g: GameState, reg: Registry, pid: Id, vertexId: number): string | null {
  if (!addonOn(reg, 'tidebound.harbor')) return 'Harbors are not in this game';
  const p = getPlayer(g, pid);
  if (!p) return 'Unknown player';
  if (!techGate(g, pid, TECH_HARBOR_MASTER)) return 'Research Harbor master first';
  const v = Number.isInteger(vertexId) ? g.board.vertices[vertexId] : undefined;
  if (!v || !v.port || !reg.ports.has(v.port)) return 'Choose a port city';
  if (!v.piece || v.piece.owner !== pid || v.piece.type !== CITY) return 'A harbor upgrade requires your own city on a port';
  if (portLevel(g, v.id) >= HARBOR_LEVEL) return 'That port is already a harbor';
  const limit = harborLimitFor(g, pid);
  if (harborCount(g, pid) >= limit) {
    return limit === 1 ? 'You can only have 1 harbor' : `You can only have ${limit} harbors`;
  }
  if (!canAfford(p, harborUpgradeCost(g, reg, p))) return 'Not enough resources for a harbor';
  return null;
}

export const upgradeHarborAction: ActionDef = {
  type: UPGRADE_HARBOR,
  validate(ctx: Ctx, pid: Id, payload: any): string | null {
    return canUpgradeHarbor(ctx.g, ctx.reg, pid, payload?.vertexId);
  },
  apply(ctx: Ctx, pid: Id, payload: any): void {
    const { g, reg } = ctx;
    const p = getPlayer(g, pid)!;
    const vertexId = Number(payload.vertexId);
    payToBank(ctx, p, harborUpgradeCost(g, reg, p));
    if (!g.ext) g.ext = {};
    if (!g.ext.core) g.ext.core = {};
    if (!g.ext.core.portUpgrades) g.ext.core.portUpgrades = {};
    g.ext.core.portUpgrades[vertexId] = { level: HARBOR_LEVEL, by: pid };
    p.stats.harborsUpgraded = (p.stats.harborsUpgraded || 0) + 1;
    const port = g.board.vertices[vertexId]?.port;
    const label = port === GENERIC_PORT ? 'any-resource' : String(port || '').replace('2:1:', '');
    ctx.emit('portUpgraded', { playerId: pid, vertexId, level: HARBOR_LEVEL, port });
    ctx.log(
      `⚓ ${p.avatar} ${p.name} built a Harbor on their ${label} port (1:1 up to ${HARBOR_MAX_TRADES}/turn, works while flooded)`,
      p.color
    );
  },
  legal(ctx: Ctx, pid: Id): { vertexId: number }[] {
    const { g, reg } = ctx;
    if (!techGate(g, pid, TECH_HARBOR_MASTER)) return [];
    const p = getPlayer(g, pid);
    if (!p || !canAfford(p, harborUpgradeCost(g, reg, p))) return [];
    return harborCandidateVertices(g, reg, pid).map(vertexId => ({ vertexId }));
  }
};

// ---- Client views (`harborSpotsView`, `harborClientView`) --------------------------------------------------------

/**
 * Port vertices `p` can click to upgrade to a harbor on their main-phase turn.
 * `undefined` when harbors are off, locked behind `tidebound.harbor_master`, or it is not `p`'s main-phase turn; `[]` when they cannot afford it or have no eligible port city.
 */
export function harborSpotsView(g: GameState, reg: Registry, p: PlayerState): number[] | undefined {
  if (!reg.actions.has(UPGRADE_HARBOR)) return undefined;
  if (!techGate(g, p.id, TECH_HARBOR_MASTER)) return undefined;
  if (g.phase !== 'main' || g.players[g.turn]?.id !== p.id) return undefined;
  if (!canAfford(p, harborUpgradeCost(g, reg, p))) return [];
  return harborCandidateVertices(g, reg, p.id);
}

/**
 * Public map of upgraded port levels (`vertexId -> level`, where `1` = raised 2:1 port and `2` = 1:1 harbor) for the board renderer.
 * Returns `null` when no port on the board has been upgraded yet.
 */
export function harborClientView(g: GameState): Record<number, number> | null {
  const ups = portUpgrades(g);
  const out: Record<number, number> = {};
  let any = false;
  for (const vid of Object.keys(ups)) {
    const id = Number(vid);
    const lvl = portLevel(g, id);
    if (lvl > 0) {
      out[id] = lvl;
      any = true;
    }
  }
  return any ? out : null;
}

/**
 * VIEW_DATA entry (R7a.5, group 2): the public `portLevels` field of the client state.
 * NOT registered in `harborAddon.register`, on purpose: `harborClientView` has no addon check. It reads the base port-upgrade ladder
 * (`g.ext.core.portUpgrades`, which the base Harbor charters tech also writes), so `portLevels` could be set in a game where the Harbor addon is off.
 * The pack's own `register` (`tideboundPack` in `index.ts`) adds this entry for every game, so the output stays exactly what it was.
 */
export const portLevelsViewData: ViewDataDef = {
  id: 'tidebound.port_levels',
  shared: (g: GameState) => ({ portLevels: harborClientView(g) })
};

/**
 * VIEW_DATA entry (R7a.5, group 8): the player's harbor fields. `harborCost` and `harborSpots` are for yourself only (`harborSpots` also needs your
 * main-phase turn, which `harborSpotsView` checks), `harborsLeft` is sent for every viewer once harbors are unlocked, and `harborTradesLeft` is for yourself
 * while you own a harbor. Everything is `undefined` otherwise. The gates are the same expressions `server/view.ts` used (`harborsOn`, `harborTechOk`).
 */
export const harborViewData: ViewDataDef = {
  id: 'tidebound.harbor.view',
  player: (g, reg, p, who) => {
    const harborsOn = reg.actions.has(UPGRADE_HARBOR);
    const harborTechOk = harborsOn && techGate(g, p.id, TECH_HARBOR_MASTER);
    return {
      harborCost: who.self && harborTechOk ? harborUpgradeCost(g, reg, p) : undefined,
      harborSpots: who.self ? harborSpotsView(g, reg, p) : undefined,
      harborsLeft: harborTechOk ? Math.max(0, harborLimitFor(g, p.id) - harborCount(g, p.id)) : undefined,
      harborTradesLeft: who.self && harborsOn && harborCount(g, p.id) > 0 ? harborTradesLeft(g, p.id) : undefined
    };
  }
};

// ---- T8a & T13c: Harbor bot goal (port placement & harbor upgrade) ----------------------------------------------

/**
 * Bot goal for port placement and upgrading a port city to a 1:1 harbor (T8a, T13c):
 * - `vertexDelta`: values settling on port vertices higher when Harbors are enabled (especially `3:1` generic ports and
 *   flood-exposed ports that a Harbor keeps active while flooded).
 * - `goals` / `actionScore`: upgrades an eligible port city when the bot will still hold at least `HARBOR_BOT_SPARE` cards
 *   afterwards, preferring `3:1` generic ports and flooded/drowned ports that a Harbor immediately restores to 1:1.
 */
export const harborBotGoal: BotGoalDef = {
  id: 'tidebound.harbor',
  goalClass: 'generic',
  vertexDelta(ctx: Ctx, pid: Id, vertexId: number): number {
    const { g, reg } = ctx;
    if (!addonOn(reg, 'tidebound.harbor')) return 0;
    const v = g.board.vertices[vertexId];
    if (!v || !v.port || !reg.ports.has(v.port)) return 0;
    if (harborCount(g, pid) >= harborLimitFor(g, pid)) return 0;

    const port = reg.ports.get(v.port);
    let bonus = port?.resource === null ? 0.85 : 0.5;
    const touchesFlooded = v.hexIds.some(hId => {
      const st = g.board.hexes[hId]?.ext?.state?.id;
      return st === 'flooded' || st === 'drowned';
    });
    if (touchesFlooded && techGate(g, pid, TECH_HARBOR_MASTER)) {
      bonus += 0.4;
    }
    return bonus;
  },
  goals(ctx: Ctx, pid: Id): BotGoalItem[] {
    const { g, reg } = ctx;
    const p = getPlayer(g, pid);
    if (!p) return [];
    const spots = harborCandidateVertices(g, reg, pid);
    if (spots.length === 0) return [];
    const cost = harborUpgradeCost(g, reg, p);
    const price = Object.values(cost).reduce((a, n) => a + (n || 0), 0);
    if (totalCards(p) < price + HARBOR_BOT_SPARE) return [];

    let bestVid = spots[0];
    let bestScore = -Infinity;
    let bestFlooded = false;
    for (const vid of spots) {
      const v = g.board.vertices[vid];
      const portId = v?.port;
      const port = portId ? reg.ports.get(portId) : undefined;
      const floodedLand = (v?.hexIds ?? []).some(hId => {
        const st = g.board.hexes[hId]?.ext?.state?.id;
        return st === 'flooded' || st === 'drowned';
      });
      const s = (port?.resource === null ? 20 : 10 + (p.resources[port?.resource || ''] || 0)) + (floodedLand ? 8 : 0);
      if (s > bestScore) {
        bestScore = s;
        bestVid = vid;
        bestFlooded = floodedLand;
      }
    }
    return [
      {
        id: `harbor:${bestVid}`,
        priority: bestFlooded ? 82 : 52,
        cost,
        action: { type: UPGRADE_HARBOR, payload: { vertexId: bestVid } }
      }
    ];
  },
  actionScore(ctx: Ctx, pid: Id, action: { type: string; payload: any }): number {
    if (action.type !== UPGRADE_HARBOR) return 0;
    if (!techGate(ctx.g, pid, TECH_HARBOR_MASTER)) return 0;
    const p = getPlayer(ctx.g, pid);
    if (!p) return 0;
    const cost = harborUpgradeCost(ctx.g, ctx.reg, p);
    const price = Object.values(cost).reduce((a, n) => a + (n || 0), 0);
    if (totalCards(p) - price < HARBOR_BOT_SPARE) return 0;
    const vid = Number(action.payload?.vertexId);
    const v = Number.isInteger(vid) ? ctx.g.board.vertices[vid] : undefined;
    const port = v?.port ? ctx.reg.ports.get(v.port) : undefined;
    const floodedLand = (v?.hexIds ?? []).some(hId => {
      const st = ctx.g.board.hexes[hId]?.ext?.state?.id;
      return st === 'flooded' || st === 'drowned';
    });
    return 35 + (port?.resource === null ? 4 : 0) + (floodedLand ? 6 : 0);
  }
};

export const harborAddon: AddonDef = {
  id: 'tidebound.harbor',
  name: 'Harbor',
  description: 'Upgrade a port city to a harbor for 1:1 trades: click the port itself. One per player. A harbor, and any port raised to 2:1, keeps working while flooded.',
  links: [
    { target: 'trade-ratio', kind: 'mechanic' },
    { target: 'piece-cost', kind: 'mechanic' },
    { target: 'tidebound.tides', kind: 'mechanic' },
    { target: 'bot-goals', kind: 'bot' }
  ],
  register(api) {
    registerTideboundTechs(api);
    api.define(PORT_IDLE_CHECKS, harborIdleExemption);
    api.define(HARBOR_RATIO_MODS, harborRatioMod);
    api.action(upgradeHarborAction);
    api.phaseAction('main', UPGRADE_HARBOR);
    api.define(BOT_GOALS, harborBotGoal);
    // R7a.5: the player's harbor fields for the client state.
    api.define(VIEW_DATA, harborViewData);
    api.hook('onTurnStart', (ctx: Ctx) => {
      resetHarborTrades(ctx.g);
    });
  }
};
