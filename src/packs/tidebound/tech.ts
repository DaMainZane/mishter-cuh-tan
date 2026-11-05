// MODULE: Tidebound tech tree nodes (T11a-T11f: 8 extension nodes across Expansion & Industrial paths, techGate re-export, Grand Causeway 16 VP hook, Harbor Empire ceil(V/2) bank card grant) | DEPENDS ON: packs/base/constants, packs/base/techEffects, packs/tidebound/bridgeConsts, packs/tidebound/ricketyBridges, shared/index | USED BY: packs/tidebound/bridges, packs/tidebound/fishing, packs/tidebound/harbor, packs/tidebound/index, packs/tidebound/pirates, packs/tidebound/wrecks, +1 more
import {
  bankGive,
  BOT_GOALS,
  createRng,
  getMarkers,
  getPlayer,
  hasTech,
  rngInt,
  TECH_DEFS,
  techBuildingValue,
  techGate
} from '../../shared';
import type {
  BotGoalDef,
  Ctx,
  Edge,
  GameState,
  Id,
  PackApi,
  PlayerState,
  Registry,
  RngState,
  TechDef,
  ViewDataDef
} from '../../shared';
import { CITY, SETTLEMENT } from '../base/constants';
import { TECH_HARBOR_CHARTERS } from '../base/techEffects';
import { BRIDGE, BRIDGE_BASE_LIMIT } from './bridgeConsts';
import { RICKETY, RICKETY_TECH_CAP_BONUS, syncBridgePool } from './ricketyBridges';

export { TECH_HARBOR_CHARTERS, techGate };

// ---- Tech IDs (Tech Tree Design.md §8) -------------------------------------------------------------------------

/** Tier 2 — Expansion path (`offset = 3`, cost 6 at V = 2): unlocks rickety bridges and raises normal bridge cap by +4 before 2x price. */
export const TECH_RICKETY_BRIDGES = 'tidebound.rickety_bridges';
/** Tier 2 — Industrial path (`offset = 3`, cost 6 at V = 2): unlocks fishing nets and allows upgrading a 3:1 port with a settlement to 2:1. */
export const TECH_FISHING_NETS = 'tidebound.fishing_nets';
/** Tier 3a — Expansion path (`offset = 5`, cost 9 at V = 2): +25% wreck loot, higher sea-wreck dev card chance, and unlocks `demolish_bridge`. */
export const TECH_SALVAGE_CREW = 'tidebound.salvage_crew';
/** Tier 3a — Industrial path (`offset = 5`, cost 9 at V = 2): net cost -1 wood, base catch chance 1 in 4 (boosted 1 in 2), 1 in 3 chance to save a fish boost. */
export const TECH_NET_WORKS = 'tidebound.net_works';
/** Tier 3b — Expansion path (`offset = 7`, cost 11 at V = 2): 2 fewer knights needed to beat pirates (min 1) and +50% pirate loot. */
export const TECH_PIRATE_HUNTER = 'tidebound.pirate_hunter';
/** Tier 3b — Industrial path (`offset = 7`, cost 11 at V = 2): unlocks Harbors (`upgrade_harbor`, 1:1 trade up to 4/turn) and Feed the Sea (`feed_sea`). */
export const TECH_HARBOR_MASTER = 'tidebound.harbor_master';
/** Tier 4 — Expansion path (`offset = 10`, cost 15 at V = 2): Longest Road is worth 16 VP instead of 2 (+14 VP) when the road includes a bridge or rickety bridge. */
export const TECH_GRAND_CAUSEWAY = 'tidebound.grand_causeway';
/** Tier 4 — Industrial path (`offset = 10`, cost 15 at V = 2): +1 harbor limit (2 total) and grants `ceil(V / 2)` random cards from the bank on unlock. */
export const TECH_HARBOR_EMPIRE = 'tidebound.harbor_empire';

/** Total VP that Longest Road is worth with Grand Causeway when the road includes a bridge (`2` base + `14` bonus = `16`). */
export const GRAND_CAUSEWAY_VP = 16;
/** Extra VP added on top of the base 2 VP Longest Road award when Grand Causeway is active. */
export const GRAND_CAUSEWAY_BONUS_VP = GRAND_CAUSEWAY_VP - 2;

/** Salt mixed into the world seed for Harbor Empire's one-time random bank grant (zero `g.rng` draws). */
export const HARBOR_EMPIRE_RNG_SALT = 0x48454d50; // 'HEMP'

// ---- T11f: Grand Causeway (16 VP Longest Road when road includes a bridge) -------------------------------------

/**
 * True when `pid`'s longest road-like path on the board (`maxLen > 0`, using the same opponent-piece blocking rules as `longestRoadFor`)
 * includes at least one `bridge` or `rickety_bridge` edge.
 * If `pid` has multiple tied longest paths of length `maxLen`, returns `true` when any of those longest paths contains a bridge.
 */
export function longestRoadHasBridge(g: GameState, reg: Registry, pid: Id): boolean {
  const { board } = g;
  const mine = (e: Edge | undefined): boolean =>
    !!e && !!e.piece && e.piece.owner === pid && !!reg.pieces.get(e.piece.type)?.roadLike;
  const isBridgeEdge = (e: Edge | undefined): boolean =>
    !!e?.piece && (e.piece.type === BRIDGE || e.piece.type === RICKETY);

  const roads = board.edges.filter(e => mine(e));
  if (roads.length === 0) return false;

  let maxLen = 0;
  let maxHasBridge = false;
  const used = new Set<number>();

  function dfs(vertexId: number, len: number, hasBr: boolean): void {
    if (len > maxLen) {
      maxLen = len;
      maxHasBridge = hasBr;
    } else if (len === maxLen && hasBr) {
      maxHasBridge = true;
    }
    const v = board.vertices[vertexId];
    if (!v) return;
    if (len > 0 && v.piece && v.piece.owner !== pid) return;
    for (const edgeId of v.edgeIds) {
      if (used.has(edgeId)) continue;
      const edge = board.edges[edgeId];
      if (!mine(edge)) continue;
      used.add(edgeId);
      dfs(edge.v1 === vertexId ? edge.v2 : edge.v1, len + 1, hasBr || isBridgeEdge(edge));
      used.delete(edgeId);
    }
  }

  const endpoints = new Set<number>();
  for (const e of roads) {
    endpoints.add(e.v1);
    endpoints.add(e.v2);
  }
  for (const vId of endpoints) dfs(vId, 0, false);
  return maxLen > 0 && maxHasBridge;
}

/**
 * Extra VP (+14, bringing Longest Road from 2 VP to 16 VP) for `pid` when:
 *  1. `pid` has researched `tidebound.grand_causeway`,
 *  2. `pid` currently holds the Longest Road award (`g.awards.longestRoad?.owner === pid`), and
 *  3. `pid`'s longest road includes at least one bridge or rickety bridge (`longestRoadHasBridge`).
 * Losing Longest Road (or losing the bridge so the road no longer qualifies) immediately drops this bonus back to 0.
 */
export function grandCausewayBonusVp(g: GameState, reg: Registry, pid: Id): number {
  if (!hasTech(g, pid, TECH_GRAND_CAUSEWAY)) return 0;
  const lr = g.awards?.longestRoad as any;
  const lrOwner = typeof lr === 'string' ? lr : lr?.owner;
  if (lrOwner !== pid) return 0;
  if (!longestRoadHasBridge(g, reg, pid)) return 0;
  return GRAND_CAUSEWAY_BONUS_VP;
}

/** `api.hook('vp', ...)` handler for Grand Causeway. */
export function grandCausewayVpHook(g: GameState, reg: Registry, p: PlayerState, _includeHidden?: boolean): number {
  return grandCausewayBonusVp(g, reg, p.id);
}

/**
 * VIEW_DATA entry (R7a.5, group 12): the Grand Causeway bonus in `stats.vpBreakdown`, added to the `longestRoad` key. Only while the player holds Longest
 * Road (the same check `server/view.ts` made before adding the bonus; `grandCausewayBonusVp` is 0 without the tech or a bridge in the road). The base 2 VP
 * stays in `view.ts`. Registered by the bridges addon, next to `grandCausewayVpHook`.
 */
export const grandCausewayViewData: ViewDataDef = {
  id: 'tidebound.grand_causeway.view',
  vpBonus: (g, reg, pid) => (g.awards.longestRoad === pid ? { longestRoad: grandCausewayBonusVp(g, reg, pid) } : undefined)
};

// ---- T11f: Harbor Empire unlock grant (`ceil(V / 2)` random cards from the bank, zero `g.rng` draws) -----------

/** Derives a deterministic RNG stream for `pid`'s Harbor Empire unlock grant without touching `g.rng`. */
export function deriveHarborEmpireRng(seed: number, pid: Id, turnCount = 0): RngState {
  let h = ((Number(seed) || 1) ^ HARBOR_EMPIRE_RNG_SALT) >>> 0;
  for (let i = 0; i < pid.length; i++) {
    h = Math.imul(h ^ pid.charCodeAt(i), 0x9e3779b1) >>> 0;
  }
  h = Math.imul(h ^ ((Number(turnCount) || 0) + 1), 0x85ebca6b) >>> 0;
  return createRng(h || 1);
}

/** Number of random bank cards Harbor Empire grants on unlock (`ceil(V / 2)`, where `V = techBuildingValue(g, pid)`). */
export function harborEmpireGrantCount(g: GameState, pid: Id): number {
  return Math.ceil(techBuildingValue(g, pid) / 2);
}

/**
 * Grants `ceil(V / 2)` random resource cards from the bank to `pid` when `tidebound.harbor_empire` is unlocked.
 * Uses a derived RNG stream so `g.rng` is never advanced.
 */
export function grantHarborEmpireCards(ctx: Ctx, pid: Id): { wanted: number; granted: number; cards: Record<string, number> } {
  const { g, reg } = ctx;
  const p = getPlayer(g, pid);
  const wanted = harborEmpireGrantCount(g, pid);
  const cards: Record<string, number> = {};
  if (!p || wanted <= 0) return { wanted, granted: 0, cards };

  const rng = deriveHarborEmpireRng(g.seed, pid, g.turnCount || 0);
  let granted = 0;
  for (let i = 0; i < wanted; i++) {
    const stocked = [...reg.resources.keys()].filter(r => (g.bank[r] || 0) > 0);
    if (stocked.length === 0) break;
    const pick = stocked[rngInt(rng, stocked.length)];
    const got = bankGive(ctx, pid, pick, 1);
    if (got > 0) {
      cards[pick] = (cards[pick] || 0) + got;
      granted += got;
    }
  }
  ctx.emit('harborEmpireGranted', { playerId: pid, wanted, amount: granted, cards });
  if (granted > 0) {
    ctx.log(
      `🏛️ ${p.avatar} ${p.name}'s Harbor Empire granted ${granted} card${granted === 1 ? '' : 's'} from the bank!`,
      p.color
    );
  }
  return { wanted, granted, cards };
}

// ---- T11c, T11d, T11e: The 8 Tidebound extension tech nodes ---------------------------------------------------

export const TIDEBOUND_TECH_DEFS: TechDef[] = [
  // Tier 2 (costOffset: 3 -> 6 cards at V = 2, 10 VP)
  {
    id: TECH_RICKETY_BRIDGES,
    name: 'Rickety bridges',
    branch: 'tidebound',
    tier: 2,
    path: 'expansion',
    prereq: TECH_HARBOR_CHARTERS,
    costOffset: 3,
    costResources: ['wood', 'brick'],
    dlc: 'tidebound',
    description:
      'Unlocks Rickety Bridges (1 wood, 1 health, collapses on a 7; upgradeable to a full bridge) and raises your bridge cap by +4 before bridges cost 2x.',
    onUnlock(ctx, pid) {
      // Immediately update the player's bridge/rickety supply counters to reflect the +4 cap bonus.
      if (ctx.g.rules?.pieceLimits?.[BRIDGE] !== undefined) {
        syncBridgePool(ctx.g, pid);
      } else {
        const p = getPlayer(ctx.g, pid);
        if (p && typeof p.pieces?.[BRIDGE] === 'number') {
          p.pieces[BRIDGE] = (p.pieces[BRIDGE] || 0) + RICKETY_TECH_CAP_BONUS;
        }
      }
      const base = ctx.g.rules?.pieceLimits?.[BRIDGE] ?? BRIDGE_BASE_LIMIT;
      ctx.emit('bridgeCapRaised', { playerId: pid, cap: base + RICKETY_TECH_CAP_BONUS });
    },
    replace: true
  },
  {
    id: TECH_FISHING_NETS,
    name: 'Fishing nets',
    branch: 'tidebound',
    tier: 2,
    path: 'industrial',
    prereq: TECH_HARBOR_CHARTERS,
    costOffset: 3,
    costResources: ['sheep', 'wheat', 'wood'],
    dlc: 'tidebound',
    description:
      'Unlocks Fishing Nets on coastal corners (catch wild fish tokens on dice rolls) and lets your Settlements on 3:1 ports be raised to 2:1.',
    replace: true
  },

  // Tier 3a (costOffset: 5 -> 9 cards at V = 2, 10 VP)
  {
    id: TECH_SALVAGE_CREW,
    name: 'Salvage crew',
    branch: 'tidebound',
    tier: 3,
    path: 'expansion',
    prereq: TECH_RICKETY_BRIDGES,
    costOffset: 5,
    costResources: ['sheep', 'brick'],
    dlc: 'tidebound',
    description:
      '+25% shipwreck salvage loot, higher dev-card chance on sea wrecks, and unlocks Demolish Bridge (remove a bridge for half its cards back).',
    replace: true
  },
  {
    id: TECH_NET_WORKS,
    name: 'Net works',
    branch: 'tidebound',
    tier: 3,
    path: 'industrial',
    prereq: TECH_FISHING_NETS,
    costOffset: 5,
    costResources: ['wheat', 'wood'],
    dlc: 'tidebound',
    description:
      'Fishing Nets cost 1 less wood (1 wood + 1 sheep), base catch chance rises to 1 in 4 (1 in 2 when boosted), and boosted catches have a 1 in 3 chance to save the fish boost.',
    replace: true
  },

  // Tier 3b (costOffset: 7 -> 11 cards at V = 2, 10 VP)
  {
    id: TECH_PIRATE_HUNTER,
    name: 'Pirate hunter',
    branch: 'tidebound',
    tier: 3,
    path: 'expansion',
    prereq: TECH_SALVAGE_CREW,
    costOffset: 7,
    costResources: ['ore', 'wheat'],
    dlc: 'tidebound',
    description:
      'Driving off a pirate requires 2 fewer played knights (minimum 1) and grants +50% pirate loot.',
    replace: true
  },
  {
    id: TECH_HARBOR_MASTER,
    name: 'Harbor master',
    branch: 'tidebound',
    tier: 3,
    path: 'industrial',
    prereq: TECH_NET_WORKS,
    costOffset: 7,
    costResources: ['brick', 'ore', 'sheep'],
    dlc: 'tidebound',
    description:
      'Unlocks Harbors (upgrade a port city to 1:1 trade for up to 4 trades per turn, works while flooded) and Feed the Sea (1 wheat refills a fishing ground).',
    replace: true
  },

  // Tier 4 (costOffset: 10 -> 15 cards at V = 2, 10 VP)
  {
    id: TECH_GRAND_CAUSEWAY,
    name: 'Grand causeway',
    branch: 'tidebound',
    tier: 4,
    path: 'expansion',
    prereq: TECH_PIRATE_HUNTER,
    costOffset: 10,
    costResources: ['brick', 'ore', 'wood'],
    dlc: 'tidebound',
    description:
      'Longest Road is worth 16 VP instead of 2 (+14 VP) while you hold Longest Road and your road includes at least 1 bridge or rickety bridge.',
    replace: true
  },
  {
    id: TECH_HARBOR_EMPIRE,
    name: 'Harbor empire',
    branch: 'tidebound',
    tier: 4,
    path: 'industrial',
    prereq: TECH_HARBOR_MASTER,
    costOffset: 10,
    costResources: ['wheat', 'sheep', 'ore'],
    dlc: 'tidebound',
    description:
      '+1 Harbor limit (2 Harbors total) and immediately grants ceil(V / 2) random resource cards from the bank on unlock.',
    onUnlock(ctx, pid) {
      grantHarborEmpireCards(ctx, pid);
    },
    replace: true
  }
];

// ---- Bot hooks: what the Tidebound techs are worth to a bot (the bot brain itself names no Tidebound content) ----------

/**
 * Ids that live in other Tidebound files (fishing, harbor, wrecks, pirates). They are spelled out here because those files import this one;
 * `tests/tideboundbots.test.ts` checks that they still match the real constants.
 */
export const BOT_NET_PIECE = 'net';
/** The action that puts a net on a sea tile (net rework: a net is `hex.ext.net`, no longer a piece; `BOT_NET_PIECE` is its key on the tile). */
export const BOT_PLACE_NET_ACTION = 'place_net';
export const BOT_FEED_SEA_ACTION = 'feed_sea';
export const BOT_UPGRADE_HARBOR_ACTION = 'upgrade_harbor';
export const BOT_WRECK_MARKER = 'wreck';
export const BOT_PIRATE_MARKER = 'pirate';

/** Bridges and rickety bridges `pid` has on the board. */
function bridgeEdgeCount(g: GameState, pid: Id): number {
  return g.board.edges.filter(e => e.piece?.owner === pid && (e.piece.type === BRIDGE || e.piece.type === RICKETY)).length;
}

/**
 * Registered with the techs (see `registerTideboundTechs`), so it exists exactly when Tidebound does:
 * - `techValue`: research value of the 8 nodes, and of Harbor charters while Tidebound builds on it (every tier wants it then).
 * - `mainPortUpgrades` / `portUpgradeOnSettlement`: Main bots raise ports too, and Fishing nets lets a settlement's port be raised.
 * Values are the ones `server/bots/brain.ts` used before T13 moved them here, so bot behaviour does not change.
 */
export const tideboundTechBotGoal: BotGoalDef = {
  id: 'tidebound.techs',
  replace: true,
  mainPortUpgrades: true,
  portUpgradeOnSettlement(ctx: Ctx, pid: Id): boolean {
    return hasTech(ctx.g, pid, TECH_FISHING_NETS);
  },
  techValue(ctx: Ctx, pid: Id, techId: string, info): number | undefined {
    const { g, reg } = ctx;
    const p = getPlayer(g, pid);
    if (!p) return undefined;
    const portTrader = info.personality === 'portTrader';
    switch (techId) {
      case TECH_HARBOR_CHARTERS: {
        const hasGenericPort = g.board.vertices.some(
          v => v.piece?.owner === pid && v.port && reg.ports.get(v.port)?.resource === null
        );
        const hasAnyPort = g.board.vertices.some(v => v.piece?.owner === pid && Boolean(v.port));
        return (hasGenericPort ? 18 : hasAnyPort ? 16 : 14) + (portTrader ? 6 : 0);
      }
      case TECH_RICKETY_BRIDGES: {
        if (!reg.pieces.has(BRIDGE)) return 0;
        return 16 + Math.min(4, bridgeEdgeCount(g, pid) * 2) + (info.personality === 'roadHog' ? 5 : 0);
      }
      case TECH_FISHING_NETS: {
        const hasPortSettlement = g.board.vertices.some(
          v => v.piece?.owner === pid && v.piece.type === SETTLEMENT && v.port && reg.ports.get(v.port)?.resource === null
        );
        const netBonus = reg.actions.has(BOT_PLACE_NET_ACTION) ? 16 + (portTrader ? 4 : 0) : 12;
        return netBonus + (hasPortSettlement ? 4 : 0);
      }
      case TECH_SALVAGE_CREW: {
        const wrecksOut = getMarkers(g, { kind: BOT_WRECK_MARKER, target: 'hex' }).length;
        return 14 + (wrecksOut > 0 ? 6 : 0) + (bridgeEdgeCount(g, pid) > 0 ? 2 : 0);
      }
      case TECH_NET_WORKS: {
        if (!reg.actions.has(BOT_PLACE_NET_ACTION)) return 0;
        const myNets = g.board.hexes.filter(h => h.ext?.[BOT_NET_PIECE]?.owner === pid).length;
        return 16 + Math.min(6, myNets * 3);
      }
      case TECH_PIRATE_HUNTER: {
        const piratesOut = getMarkers(g, { kind: BOT_PIRATE_MARKER, target: 'hex' }).length;
        const knights = (p.stats.knightsPlayed || 0) + p.devCards.filter(c => c === 'knight').length;
        return (piratesOut > 0 ? 18 : 11) + Math.min(4, knights * 2);
      }
      case TECH_HARBOR_MASTER: {
        if (!reg.actions.has(BOT_UPGRADE_HARBOR_ACTION) && !reg.actions.has(BOT_FEED_SEA_ACTION)) return 0;
        const portCities = g.board.vertices.filter(
          v => v.piece?.owner === pid && v.piece.type === CITY && Boolean(v.port)
        ).length;
        return 17 + Math.min(6, portCities * 3) + (portTrader ? 3 : 0);
      }
      case TECH_GRAND_CAUSEWAY: {
        if (!reg.pieces.has(BRIDGE)) return 0;
        const holdingRoad = g.awards.longestRoad === pid;
        return 22 + ((p.stats.longestRoad || 0) >= 5 ? 8 : 0) + (holdingRoad && bridgeEdgeCount(g, pid) > 0 ? 6 : 0);
      }
      case TECH_HARBOR_EMPIRE:
        return 20 + Math.min(8, techBuildingValue(g, pid));
      default:
        return undefined;
    }
  }
};

/**
 * Registers all 8 Tidebound extension tech nodes in `TECH_DEFS` (`replace: true` makes repeated calls across addons idempotent),
 * and the bot hooks that say what they are worth (`tideboundTechBotGoal`).
 */
export function registerTideboundTechs(api: PackApi): void {
  for (const def of TIDEBOUND_TECH_DEFS) {
    api.define(TECH_DEFS, def);
  }
  api.define(BOT_GOALS, tideboundTechBotGoal);
}
