// MODULE: effects of the 5 root techs (Stockpiling, Road levy, Harbor charters = raise a whole port 3:1 to 2:1, Plunder, Ground work): modifiers, state helpers, and the lists the tech panel shows | DEPENDS ON: packs/base/constants, packs/base/robbing, shared/index | USED BY: packs/_template/demo, packs/base/actions/techActions, packs/base/techRoots, packs/tidebound/harbor, packs/tidebound/tech, packs/tidebound/tides, +2 more
import {
  aboveBaseLimit,
  canAfford,
  COST_MODS,
  DISCARD_LIMIT_MODS,
  getPlayer,
  hasTech,
  isPortIdle,
  priceOfUpgrade,
  RATIO_MOD_ORDER,
  RATIO_MODS,
  rngInt
} from '../../shared';
import type { CostModifier, DiscardLimitModifier, GameState, Id, PackApi, RatioModifier, Registry, Resources } from '../../shared';
import { CITY, GENERIC_PORT, ROAD, SETTLEMENT } from './constants';
import { STEAL_COUNT_MODS } from './robbing';
import type { StealCountModifier } from './robbing';

/** Ids of the 5 root techs (the data is in `techRoots.ts`). */
export const TECH_HARBOR_CHARTERS = 'tidebound.harbor_charters';
export const TECH_STOCKPILING = 'bulwark.stockpiling';
export const TECH_PLUNDER = 'warlords.plunder';
export const TECH_GROUND_WORK = 'wildearth.ground_work';
export const TECH_ROAD_LEVY = 'guildhall.road_levy';

/** What one harbor upgrade costs before modifiers (Tech Tree Design.md, section 4). Read the real price with `priceOfUpgrade`. */
export const HARBOR_UPGRADE_COST: Resources = { wood: 2, brick: 1, ore: 1 };
/** The id cost modifiers see for the port upgrade (`def.id`). */
export const PORT_UPGRADE_ID = 'upgrade_port';
/** Bulwark Stockpiling: extra cards a player may hold through a 7. */
export const STOCKPILING_BONUS = 2;

// ---- Bulwark: Stockpiling ------------------------------------------------

/** +2 discard limit for a player with the tech. It stacks with the Catch-up bonus because the modifiers chain. */
export const stockpilingModifier: DiscardLimitModifier = {
  id: 'tech.stockpiling',
  apply(g, _reg, p, limit) {
    return hasTech(g, p.id, TECH_STOCKPILING) ? limit + STOCKPILING_BONUS : limit;
  }
};

// ---- Guildhall: Road levy ------------------------------------------------

/**
 * Only for a road built past the road cap (the 2x price): 1 less brick or wood, taken from whichever of the two the
 * player holds fewer of (wood on a tie). A road at the normal price gets no discount.
 */
export const roadLevyModifier: CostModifier = {
  id: 'tech.roadLevy',
  apply(g, p, def, cost) {
    if (def.id !== ROAD || !hasTech(g, p.id, TECH_ROAD_LEVY) || !aboveBaseLimit(g, p, def)) return cost;
    const options = ['wood', 'brick'].filter(r => (cost[r] || 0) > 0);
    if (options.length === 0) return cost;
    const pick = options.reduce((a, b) => ((p.resources[b] || 0) < (p.resources[a] || 0) ? b : a));
    const out: Resources = { ...cost, [pick]: cost[pick] - 1 };
    if (out[pick] <= 0) delete out[pick];
    return out;
  }
};

// ---- Tidebound: Harbor charters -------------------------------------------

/**
 * One upgraded port vertex (`g.ext.core.portUpgrades[vertexId]`).
 * `level` is the step on the port ladder: 1 = Raise the Port (3:1 -> 2:1 for every resource), 2 = Harbor (arrives in T8).
 * The upgrade is a ratio change on the whole port, so there is no resource choice. An old entry that still carries a
 * `resource` (state from before T1b) is read the same way: the whole port is raised.
 */
export interface PortUpgrade {
  level: number;
  by: Id;
}

/** Upgraded harbors by vertex id (`g.ext.core.portUpgrades`). Empty in every game where nobody upgraded. */
export function portUpgrades(g: GameState): Record<number, PortUpgrade> {
  return g.ext?.core?.portUpgrades ?? {};
}

/** Ladder step of the upgrade on a vertex: 0 = not upgraded. An entry with no `level` (state from before T1a) counts as 1. */
export function portLevel(g: GameState, vertexId: number): number {
  const up = portUpgrades(g)[vertexId];
  return up ? Math.max(1, Math.floor(Number(up.level)) || 1) : 0;
}

/**
 * A raised 3:1 port trades every resource at 2:1 for whoever holds the city there (it stays an 'any resource' port).
 * When the player also owns `tidebound.fishing_nets`, a Settlement on a raised 3:1 port also qualifies.
 * It only lowers the ratio (never raises it), and the 2:1 floor in `ratioFor` still applies.
 */
export const harborCharterModifier: RatioModifier = {
  id: 'tech.harborCharters',
  order: RATIO_MOD_ORDER.harbor,
  apply(g, reg, pid, _resource, current) {
    const allowSettlement = hasTech(g, pid, 'tidebound.fishing_nets');
    for (const vid of Object.keys(portUpgrades(g))) {
      const id = Number(vid);
      if (portLevel(g, id) < 1) continue;
      if (isPortIdle(g, reg, id)) continue;
      const v = g.board.vertices[id];
      if (
        v?.piece &&
        v.piece.owner === pid &&
        (v.piece.type !== SETTLEMENT || allowSettlement) &&
        v.port === GENERIC_PORT
      ) {
        return Math.min(current, 2);
      }
    }
    return current;
  }
};

// ---- Warlords: Plunder -----------------------------------------------------

/** A played Knight steals 1 extra card (a rolled 7 is unchanged). The steal stops when the victim runs out. */
export const plunderModifier: StealCountModifier = {
  id: 'tech.plunder',
  apply(g, _reg, thiefId, _victimId, source, current) {
    return source === 'knight' && hasTech(g, thiefId, TECH_PLUNDER) ? current + 1 : current;
  }
};

// ---- Wild Earth: Ground work -------------------------------------------------

/** True once this player has used their one Ground work conversion (`g.ext.core.groundWork[pid]`). */
export function groundWorkUsed(g: GameState, pid: Id): boolean {
  return !!g.ext?.core?.groundWork?.[pid];
}

/** The basic resource tiles a tile can be turned into (wood, wheat, sheep, brick, ore): the land tiles flagged `base`. */
export function basicTileIds(reg: Registry): string[] {
  return [...reg.tiles.values()].filter(t => t.land && t.base).map(t => t.id);
}

/**
 * Why this tile cannot be a Ground work source, or null when it can: any visible land tile (desert and modded tiles
 * included) that touches one of the player's own settlements or cities. Sea tiles and roads do not count.
 */
export function groundWorkSourceError(g: GameState, reg: Registry, pid: Id, hexId: number): string | null {
  const hex = Number.isInteger(hexId) ? g.board.hexes[hexId] : undefined;
  if (!hex) return 'Choose a tile';
  if (hex.ext?.hidden) return 'That tile is still hidden';
  if (!reg.tiles.get(hex.type)?.land) return 'Only land tiles can be converted';
  const touches = hex.vertexIds.some(id => {
    const pc = g.board.vertices[id]?.piece;
    return !!pc && pc.owner === pid && (reg.pieces.get(pc.type)?.produces || 0) > 0;
  });
  return touches ? null : 'The tile must touch your own settlement or city';
}

/** Rolls two dice from the game RNG until the total is not 7: the number token for a converted tile that had none (desert). */
export function rollTileNumber(g: GameState): number {
  for (let i = 0; i < 50; i++) {
    const n = rngInt(g.rng, 6) + rngInt(g.rng, 6) + 2;
    if (n !== 7) return n;
  }
  return 8;
}

// ---- What the tech panel needs -----------------------------------------------

export interface TechActionsView {
  /** Null until the player has Harbor charters. */
  harbor: {
    cost: Resources;
    affordable: boolean;
    /** Your cities (or settlements with `tidebound.fishing_nets`) on a 3:1 port; `level` 0 = not raised yet, 1 = raised to 2:1. */
    ports: { vertexId: number; level: number }[];
  } | null;
  /** Null until the player has Ground work. `hexes` is empty once it is used. */
  groundWork: {
    used: boolean;
    choices: string[];
    hexes: { hexId: number; type: string; number: number | null }[];
  } | null;
}

/** Read-only lists for the tech panel's action buttons (the actions themselves re-check everything). Never touches the RNG. */
export function techActionsFor(g: GameState, reg: Registry, pid: Id): TechActionsView {
  const p = getPlayer(g, pid);
  let harbor: TechActionsView['harbor'] = null;
  if (p && hasTech(g, pid, TECH_HARBOR_CHARTERS)) {
    const allowSettlement = hasTech(g, pid, 'tidebound.fishing_nets');
    const ports: { vertexId: number; level: number }[] = [];
    for (const v of g.board.vertices) {
      if (v.piece?.owner !== pid || v.port !== GENERIC_PORT) continue;
      if (v.piece.type !== CITY && !(allowSettlement && v.piece.type === SETTLEMENT)) continue;
      ports.push({ vertexId: v.id, level: portLevel(g, v.id) });
    }
    const cost = priceOfUpgrade(g, reg, p, PORT_UPGRADE_ID, HARBOR_UPGRADE_COST);
    harbor = { cost, affordable: canAfford(p, cost), ports };
  }

  let groundWork: TechActionsView['groundWork'] = null;
  if (hasTech(g, pid, TECH_GROUND_WORK)) {
    const used = groundWorkUsed(g, pid);
    const hexes = used
      ? []
      : g.board.hexes
          .filter(h => groundWorkSourceError(g, reg, pid, h.id) === null)
          .map(h => ({ hexId: h.id, type: h.type, number: h.number }));
    groundWork = { used, choices: basicTileIds(reg), hexes };
  }
  return { harbor, groundWork };
}

/** Registers the effect of each root tech. Each one is a modifier on an existing registry that asks `hasTech` first. */
export function registerTechEffects(api: PackApi): void {
  api.define(DISCARD_LIMIT_MODS, stockpilingModifier);
  api.define(COST_MODS, roadLevyModifier);
  api.define(RATIO_MODS, harborCharterModifier);
  api.define(STEAL_COUNT_MODS, plunderModifier);
}
