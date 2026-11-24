// MODULE: registry + pack loader (all game content is registered here) | DEPENDS ON: shared/addons, shared/ctx, shared/mapoptions, shared/rng, shared/types, shared/visual | USED BY: shared/addons, shared/botGoals, shared/coreServices, shared/ctx, shared/engine, shared/eventDeck, +18 more
import type { AddonDef, AddonInfo, DlcInfo } from './addons';
import type { Ctx } from './ctx';
import type { MapOptionBase, NumbersDef, PerkDef, QuickStartDef, ShapeOpDef, TerrainDef } from './mapoptions';
import type { RngState } from './rng';
import type { GameState, Id, Resources, Rules } from './types';
import type { PieceVisual } from './visual';

export interface ResourceDef { id: string; name: string; color: string; border: string; icon?: string; replace?: boolean }

/**
 * Where a tile likes to sit, for the `realistic` terrain style. `h` and `m` are targets on a 0..1 scale (height and
 * moisture, rank-normalized over the land); leave one out for "any". `weight` is how strictly the tile wants its habitat
 * (default 1): strict tiles are placed first and count more in the misfit that the swap sweeps reduce.
 */
export interface Habitat { h?: number; m?: number; weight?: number }

export interface TileDef {
  id: string;
  name: string;
  color: string;
  border: string;
  icon?: string;
  /** false = water. */
  land: boolean;
  /** Gets a number token. */
  numbered: boolean;
  /** Resource produced on a matching roll (default behaviour). */
  produces?: string;
  /** true = fills the board cyclically after special tiles (rules.tileCounts) are placed. */
  base?: boolean;
  /** Placement hint for the `realistic` terrain style. A tile without one is placed randomly among the leftovers. */
  habitat?: Habitat;
  /**
   * No port for this tile. On a land tile: its coast never carries a port. On a non-land tile that is not open sea
   * (a pack's swamp, ice or lava): it does not count as sea, so no port faces it. Plain water leaves this off.
   */
  noPort?: boolean;
  /** Overrides default production, e.g. gold gives picks instead of cards. */
  onProduce?(ctx: Ctx, hex: any, ownerId: Id, amount: number): void;
  replace?: boolean;
}

export interface PieceDef {
  id: string;
  name: string;
  target: 'vertex' | 'edge';
  cost: Resources;
  vp: number;
  /** Production multiplier for adjacent hexes (settlement 1, city 2, road 0). */
  produces: number;
  /** Replaces this piece type when built (city upgrades settlement). */
  upgradeFrom?: string;
  /** Pieces on the board at which the next one costs double (standard 10 VP setting). See shared/pricing.ts. */
  baseLimit?: number;
  /** True when this edge piece connects to the road network and counts toward Longest Road (e.g. road, bridge). */
  roadLike?: boolean;
  /** True when this piece's default supply cap scales with `rules.boardRadius` (above radius 2) in addition to `vpToWin`. */
  scaleWithRadius?: boolean;
  /** Base defense strength of a vertex building (settlement 1, city 2, castle 3). See shared/coreServices.ts. */
  baseDefense?: number;
  icon?: string;
  /** Plain-data look for the client (button, shape, hints). Nothing reads it until the manifest is sent (R8.4); leave it out and the piece behaves as before. */
  visual?: PieceVisual;
  /**
   * Is this piece on offer to this player right now (a tech unlocks it, say)? Decides whether it shows in the client's `pieceCosts`. Default: yes.
   * It does not check placement or cost, and the build action does not read it.
   */
  available?(g: GameState, pid: Id): boolean;
  /** Placement rule only (geometry/ownership). Cost and supply are checked by the build action. */
  canPlace(ctx: Ctx, pid: Id, loc: number, mode: 'setup' | 'build'): boolean;
  replace?: boolean;
}

export interface DevCardDef {
  id: string;
  name: string;
  icon?: string;
  playable: boolean;
  /** Victory points counted while held (hidden until game over). */
  vp?: number;
  validate?(ctx: Ctx, pid: Id, payload: any): string | null;
  play?(ctx: Ctx, pid: Id, payload: any): void;
  /** Candidate extra payload fields for bots (e.g. one {resource} per resource for Monopoly). Default: [{}]. Must not use the RNG. */
  legal?(ctx: Ctx, pid: Id): any[];
  replace?: boolean;
}

export interface AwardDef {
  id: string;
  name: string;
  vp: number;
  /** Minimum metric value to hold the award. */
  min: number;
  metric(ctx: Ctx, player: any): number;
  /** Action types after which the metric is recomputed (default: all). */
  recomputeOn?: string[];
  replace?: boolean;
}

export interface PhaseDef {
  id: string;
  label: string;
  /** Action types allowed in this phase. */
  actions: string[];
  /** Who may act (default: the player whose turn it is). */
  actor?(g: GameState, pid: Id): boolean;
  /** Should be safe to run again (it also runs when returning to the phase). */
  onEnter?(ctx: Ctx): void;
  onExit?(ctx: Ctx): void;
  replace?: boolean;
}

export interface ActionDef {
  type: string;
  /** Overrides the phase's actor rule (e.g. trade responses come from other players). */
  actor?(g: GameState, pid: Id): boolean;
  validate(ctx: Ctx, pid: Id, payload: any): string | null;
  apply(ctx: Ctx, pid: Id, payload: any): void;
  /** Candidate payloads for bots/fuzz tests. The engine filters them through validate. */
  legal?(ctx: Ctx, pid: Id): any[];
  /** Plain-data look for the client (button, hints, spot marker). An action with a `visual` also sets `visual.spotKey`. Nothing reads it until R8.4. */
  visual?: PieceVisual;
  /** This player's price for the action now, for `PlayerView.pieces[type].cost` (R8.6). Default: `{}`. */
  price?(g: GameState, reg: Registry, pid: Id): Resources;
  /** Is the action on offer to this player now (a tech unlocks it, say)? Decides whether it appears in `PlayerView.pieces` (R8.6). Default: yes. Not read by `validate`. */
  available?(g: GameState, pid: Id): boolean;
  replace?: boolean;
}

export interface PortDef {
  id: string;
  name: string;
  ratio: number;
  /** null = works for any resource. */
  resource: string | null;
  /** How many of this port are generated on a board (default 1). */
  copies?: number;
  /** True for gem ports (emerald/diamond) exempt from the hard 2:1 trade ratio floor. */
  exemptFloor?: boolean;
  replace?: boolean;
}

/** @deprecated Map presets are quick starts now (`api.quickStart`, recipes). Kept so `generateBoard`, the sims and old tests keep working. */
export interface PresetDef {
  id: string;
  label: string;
  blank?: boolean;
  waterChance?: number;
  tileCounts?(rules: Rules, totalHexes: number): Record<string, number>;
  /** Extra generation data handed to afterMapGenerated hooks (e.g. fogCount). */
  extra?(rules: Rules, totalHexes: number): Record<string, any>;
  replace?: boolean;
}

export type HookName =
  | 'onGameStart'        // (ctx)
  | 'onTurnStart'        // (ctx)
  | 'onTurnEnd'          // (ctx)
  | 'onRoundStart'       // (ctx) seat 0's turn is about to start; g.round is already the new round
  | 'onRoundEnd'         // (ctx) the last seat has ended its turn; g.round is still the finished round
  | 'onRoll'             // (ctx, sum)
  | 'onBuild'            // (ctx, pieceDef, playerId, location)
  | 'afterAction'        // (ctx, actionType)
  | 'vp'                 // (g, reg, player, includeHidden) => number
  | 'afterMapGenerated'  // (hexInits, rules, rng, extra)
  | 'onView';            // (g, reg, viewerId, view)

export interface Registry {
  packs: string[];
  rules: Rules;
  resources: Map<string, ResourceDef>;
  tiles: Map<string, TileDef>;
  pieces: Map<string, PieceDef>;
  devcards: Map<string, DevCardDef>;
  awards: Map<string, AwardDef>;
  phases: Map<string, PhaseDef>;
  actions: Map<string, ActionDef>;
  ports: Map<string, PortDef>;
  presets: Map<string, PresetDef>;
  /** Map menu content (Map Generation Design, section 12). Pick ids are unique across shapes, terrains, numberings and perks. */
  mapShapes: Map<string, ShapeOpDef>;
  mapTerrains: Map<string, TerrainDef>;
  mapNumberings: Map<string, NumbersDef>;
  mapPerks: Map<string, PerkDef>;
  quickStarts: Map<string, QuickStartDef>;
  /** Features a pack provides, e.g. 'crossing' (ships or bridges). An option with `requires` is refused until they exist. */
  capabilities: Set<string>;
  /** Every addon in the catalog (enabled or not), so the lobby can draw DLC cards without registering content. */
  addons: Map<string, AddonInfo>;
  /** DLC packs (packs with addons), by pack id. */
  dlcs: Map<string, DlcInfo>;
  /** Addon ids whose content is registered for this game. */
  enabled: Set<string>;
  /** Keyed definitions added through `api.define(kind, def)`: kind -> id -> def. */
  defs: Map<string, Map<string, any>>;
  hooks: Record<HookName, ((...args: any[]) => any)[]>;
}

export interface PackApi {
  resource(def: ResourceDef): void;
  tile(def: TileDef): void;
  piece(def: PieceDef): void;
  devcard(def: DevCardDef): void;
  award(def: AwardDef): void;
  phase(def: PhaseDef): void;
  action(def: ActionDef): void;
  port(def: PortDef): void;
  preset(def: PresetDef): void;
  mapShape(def: ShapeOpDef): void;
  mapTerrain(def: TerrainDef): void;
  mapNumbers(def: NumbersDef): void;
  mapPerk(def: PerkDef): void;
  quickStart(def: QuickStartDef): void;
  /**
   * Adds an action type to a phase that is already registered (a DLC action that must be playable in `main`, say), without replacing the phase.
   * The action itself is registered with `api.action`. Throws if the phase does not exist yet, so call it from an addon (base phases are loaded first).
   */
  phaseAction(phaseId: string, actionType: string): void;
  /** Declares a capability. Several packs may declare the same one. */
  capability(id: string): void;
  /** Registers a definition in a keyed registry of the given kind. Duplicate ids throw unless `replace: true`. Kinds are separate namespaces. */
  define(kind: string, def: { id: string; replace?: boolean; [key: string]: any }): void;
  /** Registers an ordered step in the S0.6 production pipeline (`productionSteps`). */
  productionStep(order: number, fn: (ctx: Ctx, item: any, sum?: number) => void, stepId?: string): void;
  hook(name: HookName, fn: (...args: any[]) => any): void;
}

export interface Pack {
  id: string;
  name: string;
  /** Packs that must be loaded before this one. */
  deps?: string[];
  /** Default rule parameters, deep-merged in load order. */
  rules?: Record<string, any>;
  /** A DLC lists its addons here. Addon content is registered only for enabled addons (see addons.ts). */
  addons?: AddonDef[];
  register(api: PackApi): void;
}

function isPlain(v: any): boolean {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Deep-merges plain objects; arrays and scalars are replaced. */
export function mergeRules(base: any, extra: Record<string, any>): Rules {
  const out: any = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = isPlain(v) && isPlain(out[k]) ? mergeRules(out[k], v) : v;
  }
  return out as Rules;
}

function put<T>(map: Map<string, T>, key: string, def: T, kind: string, packId: string): void {
  if (map.has(key) && !(def as any).replace) {
    throw new Error(`Pack "${packId}": duplicate ${kind} "${key}" (set replace: true to override)`);
  }
  map.set(key, def);
}

/** Like `put`, but a pick id may live in only one of the option maps (picks are one flat list). */
function putOption<T extends MapOptionBase>(map: Map<string, T>, all: Map<string, MapOptionBase>[], def: T, kind: string, packId: string): void {
  for (const other of all) {
    if (other !== map && other.has(def.id)) throw new Error(`Pack "${packId}": map option id "${def.id}" is already used by another option kind (${kind})`);
  }
  put(map, def.id, def, kind, packId);
}

/** The keyed definitions of one kind (empty if none were registered). */
export function defsOf<T = any>(reg: Registry, kind: string): Map<string, T> {
  return (reg.defs.get(kind) ?? new Map()) as Map<string, T>;
}

/**
 * `enabled` is the set of addon ids to register ('all' = every addon). Default: none, so a plain call builds the base game.
 * Use `registryFor` (addons.ts) to derive the set from game rules.
 */
export function createRegistry(packs: Pack[], overrides: Record<string, any> = {}, enabled: Set<string> | 'all' = new Set()): Registry {
  const reg: Registry = {
    packs: [],
    rules: {} as Rules,
    resources: new Map(),
    tiles: new Map(),
    pieces: new Map(),
    devcards: new Map(),
    awards: new Map(),
    phases: new Map(),
    actions: new Map(),
    ports: new Map(),
    presets: new Map(),
    mapShapes: new Map(),
    mapTerrains: new Map(),
    mapNumberings: new Map(),
    mapPerks: new Map(),
    quickStarts: new Map(),
    capabilities: new Set(),
    addons: new Map(),
    dlcs: new Map(),
    enabled: new Set(),
    defs: new Map(),
    hooks: {
      onGameStart: [], onTurnStart: [], onTurnEnd: [], onRoundStart: [], onRoundEnd: [], onRoll: [], onBuild: [],
      afterAction: [], vp: [], afterMapGenerated: [], onView: []
    }
  };

  const optionMaps: Map<string, MapOptionBase>[] = [reg.mapShapes, reg.mapTerrains, reg.mapNumberings, reg.mapPerks];
  const defsFor = (kind: string): Map<string, any> => {
    let m = reg.defs.get(kind);
    if (!m) { m = new Map(); reg.defs.set(kind, m); }
    return m;
  };
  const loaded = new Set<string>();
  for (const pack of packs) {
    if (loaded.has(pack.id)) throw new Error(`Pack "${pack.id}" listed twice`);
    for (const dep of pack.deps ?? []) {
      if (!loaded.has(dep)) throw new Error(`Pack "${pack.id}" needs "${dep}" loaded first`);
    }
    const id = pack.id;
    const makeApi = (id: string): PackApi => ({
      resource: d => put(reg.resources, d.id, d, 'resource', id),
      tile: d => put(reg.tiles, d.id, d, 'tile', id),
      piece: d => put(reg.pieces, d.id, d, 'piece', id),
      devcard: d => put(reg.devcards, d.id, d, 'devcard', id),
      award: d => put(reg.awards, d.id, d, 'award', id),
      phase: d => put(reg.phases, d.id, d, 'phase', id),
      action: d => put(reg.actions, d.type, d, 'action', id),
      port: d => put(reg.ports, d.id, d, 'port', id),
      preset: d => put(reg.presets, d.id, d, 'preset', id),
      mapShape: d => putOption(reg.mapShapes, optionMaps, d, 'map shape', id),
      mapTerrain: d => putOption(reg.mapTerrains, optionMaps, d, 'map terrain', id),
      mapNumbers: d => putOption(reg.mapNumberings, optionMaps, d, 'map numbers', id),
      mapPerk: d => putOption(reg.mapPerks, optionMaps, d, 'map perk', id),
      quickStart: d => put(reg.quickStarts, d.id, d, 'quick start', id),
      phaseAction: (phaseId, actionType) => {
        const ph = reg.phases.get(phaseId);
        if (!ph) throw new Error(`Pack "${id}": phaseAction targets unknown phase "${phaseId}"`);
        if (!ph.actions.includes(actionType)) reg.phases.set(phaseId, { ...ph, actions: [...ph.actions, actionType] });
      },
      capability: c => { reg.capabilities.add(c); },
      define: (kind, d) => put(defsFor(kind), d.id, d, kind, id),
      productionStep: (order, fn, stepId) => {
        const map = defsFor('productionSteps');
        const key = stepId ?? `${id}.step_${order}_${map.size + 1}`;
        put(map, key, { id: key, order, run: fn }, 'productionSteps', id);
      },
      hook: (name, fn) => {
        if (!reg.hooks[name]) throw new Error(`Pack "${id}": unknown hook "${name}"`);
        reg.hooks[name].push(fn);
      }
    });
    pack.register(makeApi(id));
    if (pack.rules) reg.rules = mergeRules(reg.rules, pack.rules);

    if (pack.addons?.length) {
      reg.dlcs.set(id, { id, name: pack.name, addons: pack.addons.map(a => a.id) });
      for (const a of pack.addons) {
        if (!a.id.startsWith(`${id}.`) || a.id.length <= id.length + 1) {
          throw new Error(`Pack "${id}": addon "${a.id}" must start with "${id}."`);
        }
        if (reg.addons.has(a.id)) throw new Error(`Pack "${id}": duplicate addon "${a.id}"`);
        for (const d of a.deps ?? []) {
          if (!reg.addons.has(d)) throw new Error(`Pack "${id}": addon "${a.id}" depends on "${d}", which is not declared before it`);
        }
        reg.addons.set(a.id, { id: a.id, name: a.name, description: a.description, pack: id, deps: [...(a.deps ?? [])], links: [...(a.links ?? [])] });

        if (enabled !== 'all' && !enabled.has(a.id)) continue;
        for (const d of a.deps ?? []) {
          if (!reg.enabled.has(d)) throw new Error(`Pack "${id}": addon "${a.id}" is enabled but its dependency "${d}" is not`);
        }
        a.register?.(makeApi(a.id));
        if (a.rules) reg.rules = mergeRules(reg.rules, a.rules);
        reg.enabled.add(a.id);
      }
    }
    loaded.add(id);
    reg.packs.push(id);
  }
  if (enabled !== 'all') {
    for (const a of enabled) {
      if (!reg.addons.has(a)) throw new Error(`Unknown addon "${a}" in the enabled set`);
    }
  }
  reg.rules = mergeRules(reg.rules, overrides);

  for (const phase of reg.phases.values()) {
    for (const t of phase.actions) {
      if (!reg.actions.has(t)) throw new Error(`Phase "${phase.id}" lists unknown action "${t}"`);
    }
  }
  return reg;
}

export type { RngState };
