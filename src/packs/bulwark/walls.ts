// MODULE: bulwark.walls addon (wall rings the map spawns, palisade wall pieces players extend from an existing wall, zones and control by public VP, rebellion, building only for the lord and permit holders, the 30% tax meter, the Peasant revolt event, the client view and the zone bot goal) | DEPENDS ON: packs/bulwark/constants, packs/bulwark/spawn, packs/bulwark/zones, shared/index | USED BY: packs/bulwark/addons.generated, packs/bulwark/highGround, packs/bulwark/index
import {
  addonOn,
  BOT_GOALS,
  createRng,
  EVENT_CARDS,
  getPlayer,
  OVERLAY_KINDS,
  PLACEMENT_CHECKS,
  PRODUCTION_STAGE_ORDER,
  PRODUCTION_STEPS,
  priceOf,
  rngInt,
  totalCards,
  VIEW_DATA
} from '../../shared';
import type {
  AddonDef,
  BotGoalDef,
  BotGoalItem,
  Ctx,
  EventCardDef,
  GameState,
  Id,
  OverlayKindVisual,
  PieceDef,
  PlacementCheckDef,
  ProductionItem,
  ProductionStepDef,
  Registry,
  ViewDataDef
} from '../../shared';
import {
  CASTLE,
  NO_OWNER,
  STONE_WALL,
  TAX_PER_CARD,
  TAX_PER_CARD_CASTLE,
  TAX_UNITS,
  WALL,
  WALL_BASE_LIMIT,
  WALL_COST,
  WALL_SUPPLY
} from './constants';
import { pipsOf, raiseSpawnedWalls, zonesAfterMapGenerated } from './spawn';
import {
  archEdges,
  bulwarkState,
  closesEdge,
  hasBuildingIn,
  interiorVertices,
  isWallPiece,
  localVp,
  mayBuildIn,
  pendingZones,
  ringEdges,
  syncZones,
  wallCorners,
  zoneById,
  zonesOfWall
} from './zones';
import type { BulwarkState, ZoneRec } from './zones';

/** The Bulwark state of this game, or undefined before any wall exists. */
const stateOf = (g: GameState): BulwarkState | undefined => g.ext?.bulwark as BulwarkState | undefined;

/** Brings zones and control up to date (with the high ground bonus while that addon is on). */
export function refreshZones(ctx: Ctx): void {
  syncZones(ctx, { highGround: addonOn(ctx.reg, 'bulwark.high_ground') });
}

// ---- The wall piece ----------------------------------------------------------------------------------------------------------------

/** Wall edges touching a corner of this edge (the walls a new piece would extend). */
export function touchingWalls(g: GameState, st: BulwarkState, edgeId: number): number[] {
  const e = g.board.edges[edgeId];
  if (!e) return [];
  const arches = archEdges(st);
  const out = new Set<number>();
  for (const v of [e.v1, e.v2]) {
    for (const other of g.board.vertices[v]?.edgeIds ?? []) {
      if (other !== edgeId && closesEdge(g, st, other, arches)) out.add(other);
    }
  }
  return [...out];
}

/**
 * Placement of a palisade: an empty land edge (not a gate arch) that touches an existing wall at a corner, with no building on either corner, built
 * by a player who has a building inside a zone of the wall it extends.
 */
export function canPlaceWall(ctx: Ctx, pid: Id, edgeId: number, mode: 'setup' | 'build'): boolean {
  if (mode !== 'build') return false;
  const { g } = ctx;
  const st = stateOf(g);
  const e = g.board.edges[edgeId];
  if (!st || !e || e.piece || e.hexIds.length === 0) return false;
  if (archEdges(st).has(edgeId)) return false;
  if (g.board.vertices[e.v1]?.piece || g.board.vertices[e.v2]?.piece) return false;
  if (st.gates[e.v1] || st.gates[e.v2]) return false;
  const touching = touchingWalls(g, st, edgeId);
  if (!touching.length) return false;
  return touching.some(w => zonesOfWall(g, st, w).some(z => hasBuildingIn(g, z, pid)));
}

export const wallPiece: PieceDef = {
  id: WALL,
  name: 'Palisade',
  target: 'edge',
  cost: WALL_COST,
  vp: 0,
  produces: 0,
  baseLimit: WALL_BASE_LIMIT,
  scaleWithRadius: true,
  canPlace: canPlaceWall,
  visual: {
    slot: 'edge',
    button: {
      label: 'Wall',
      icon: '<path d="M4 20V8l2-2 2 2v12M10 20V8l2-2 2 2v12M16 20V8l2-2 2 2v12"/><path d="M3 13h18"/>',
      order: 45
    },
    hints: {
      noSupply: 'No wall pieces left',
      cannotAfford: 'A palisade costs 1 wood and 1 brick',
      noSpots: 'Extend a wall from a zone you have a building in'
    },
    // A row of wooden stakes along the edge (x -50..50 on y = 0). Neutral colours: walls belong to the zone, not to a player.
    shape:
      '<rect x="-48" y="-6" width="96" height="12" rx="3" fill="#8a5a32" stroke="#4a2f17" stroke-width="2"/>'
      + '<path d="M-36 -6v12M-24 -6v12M-12 -6v12M0 -6v12M12 -6v12M24 -6v12M36 -6v12" stroke="#4a2f17" stroke-width="1.6"/>'
  }
};

// ---- Who may build where ------------------------------------------------------------------------------------------------------------

/** The complete zone both sides of this edge are in, if any. */
function zoneOfEdge(g: GameState, st: BulwarkState, edgeId: number): ZoneRec | undefined {
  const e = g.board.edges[edgeId];
  if (!e || e.hexIds.length !== 2) return undefined;
  return st.zones.find(z => z.complete && e.hexIds.every(h => z.hexIds.includes(h)));
}

/**
 * No building on a wall corner. Inside a complete zone (outside setup) only its lord, permit holders, or anyone while nobody holds it may build.
 * A road through a closed gate's arch needs the lord or a permit.
 */
export const zonePlacementCheck: PlacementCheckDef = {
  id: 'bulwark.zones',
  check(ctx: Ctx, pid: Id, def: PieceDef, loc: number, mode: 'setup' | 'build'): string | null {
    const { g } = ctx;
    const st = stateOf(g);
    if (!st || !st.zones.length && !Object.keys(st.gates).length) return null;
    if (def.id === WALL || def.id === STONE_WALL) return null;
    if (def.target === 'vertex') {
      if (wallCorners(g, st).has(loc)) return 'No building may stand on a wall';
      if (st.gates[loc]) return 'A gate stands there';
      const zid = st.vertexZone[loc];
      const z = zid === undefined ? undefined : zoneById(st, zid);
      if (z && mode === 'build' && !mayBuildIn(st, z, pid)) return 'Only the lord of this zone or a permit holder may build inside';
      return null;
    }
    // Edge pieces (roads, bridges).
    for (const gateV of Object.keys(st.gates)) {
      const gate = st.gates[Number(gateV)];
      if (gate.arch !== loc || gate.open) continue;
      const z = zoneById(st, gate.zoneId);
      if (z && !mayBuildIn(st, z, pid)) return 'The gate is closed to you';
    }
    const z = zoneOfEdge(g, st, loc);
    if (z && mode === 'build' && !mayBuildIn(st, z, pid)) return 'Only the lord of this zone or a permit holder may build inside';
    return null;
  }
};

// ---- Tax ------------------------------------------------------------------------------------------------------------------------------

/**
 * The tax meter: a guest's building inside a complete zone adds 0.3 per card it produces there (a castle 0.15). Each time the meter reaches 1, one
 * card of this roll goes to the lord. Exactly 30% over a game, nothing random, and the meter is public.
 */
export const zoneTaxStep: ProductionStepDef = {
  id: 'bulwark.tax',
  order: PRODUCTION_STAGE_ORDER.tax,
  run(ctx: Ctx, item: ProductionItem): void {
    const { g } = ctx;
    const st = stateOf(g);
    if (!st || !item.resource || item.wildSource) return;
    const zid = st.vertexZone?.[item.vertexId];
    if (zid === undefined) return;
    const z = zoneById(st, zid);
    if (!z || !z.complete || !z.controller || z.controller === item.ownerId) return;
    const per = item.pieceType === CASTLE ? TAX_PER_CARD_CASTLE : TAX_PER_CARD;
    const meters = (st.meters[zid] ??= {});
    const next = (meters[item.ownerId] ?? 0) + per * item.amount;
    let owed = Math.floor(next / TAX_UNITS);
    meters[item.ownerId] = next - owed * TAX_UNITS;
    owed = Math.min(owed, item.amount);
    const skips = st.skips[zid];
    while (owed > 0 && skips && (skips[item.ownerId] ?? 0) > 0) {
      skips[item.ownerId]--;
      owed--;
    }
    if (owed <= 0) return;
    item.taxRecipientId = z.controller;
    item.taxAmount = owed;
    const guest = getPlayer(g, item.ownerId);
    const lord = getPlayer(g, z.controller);
    if (guest && lord) ctx.log(`💰 ${guest.avatar} ${guest.name} paid ${owed} ${item.resource} in tax to ${lord.avatar} ${lord.name}`, guest.color);
  }
};

/** Tax meters of a zone in twentieths (0-19), for the client. */
export function zoneMeters(st: BulwarkState, zoneId: number): Record<Id, number> {
  return { ...(st.meters[zoneId] ?? {}) };
}

// ---- Peasant revolt ---------------------------------------------------------------------------------------------------------------------

const REVOLT_SALT = 0x52564c54; // 'RVLT'

/** The biggest complete zone with a lord and guests: its tax meters reset, and every guest skips 1 to 3 taxes (one draw per event). */
export function peasantRevolt(ctx: Ctx): ZoneRec | null {
  const { g, reg } = ctx;
  const st = stateOf(g);
  if (!st) return null;
  const zones = st.zones
    .filter(z => z.complete && z.controller)
    .sort((a, b) => b.hexIds.length - a.hexIds.length || a.id - b.id);
  const z = zones.find(zz => [...localVp(g, reg, interiorVertices(g, zz.hexIds)).keys()].some(p => p !== zz.controller)) ?? zones[0];
  if (!z) {
    ctx.log('🔥 Peasants grumble, but no walled zone has a lord to revolt against', null);
    return null;
  }
  const rng = createRng(((Number(g.seed) || 1) ^ REVOLT_SALT ^ Math.imul((g.round || 0) + 1, 0x9e3779b1)) >>> 0);
  const n = 1 + rngInt(rng, 3);
  st.meters[z.id] = {};
  const skips = (st.skips[z.id] ??= {});
  const guests = [...localVp(g, reg, interiorVertices(g, z.hexIds)).keys()].filter(p => p !== z.controller);
  for (const p of guests) skips[p] = (skips[p] ?? 0) + n;
  const lord = getPlayer(g, z.controller!);
  ctx.log(`🔥 Peasant revolt in ${lord ? `${lord.avatar} ${lord.name}'s` : 'a'} zone: tax meters reset, guests skip ${n} ${n === 1 ? 'tax' : 'taxes'}`, null);
  ctx.emit('peasantRevolt', { zoneId: z.id, skips: n });
  return z;
}

export const peasantRevoltCard: EventCardDef = {
  id: 'bulwark.peasant_revolt',
  title: 'Peasant revolt',
  description: 'The biggest walled zone revolts: its tax meters reset, and every guest there skips 1 to 3 taxes.',
  pack: 'bulwark',
  icon: 'crown',
  apply(ctx) {
    if (!addonOn(ctx.reg, 'bulwark.walls')) return;
    peasantRevolt(ctx);
  }
};

// ---- What the client sees ----------------------------------------------------------------------------------------------------------

export interface ZoneView {
  id: number;
  hexIds: number[];
  complete: boolean;
  controller: Id | null;
  /** Guest id -> tax meter in twentieths (a card is taken at 20). */
  meters: Record<Id, number>;
  permits: Id[];
  /** Local public VP inside, per player. */
  vp: Record<Id, number>;
}

export interface BulwarkView {
  zones: ZoneView[];
  /** The tiles each open wall would enclose if it closed now. */
  pending: number[][];
  gates: { vertexId: number; arch: number; open: boolean; zoneId: number }[];
  /** Palisade edge id -> durability left (only damaged ones). */
  damaged: Record<number, number>;
  lastOverthrow: BulwarkState['lastOverthrow'];
}

export function bulwarkView(g: GameState, reg: Registry): BulwarkView | null {
  const st = stateOf(g);
  if (!st) return null;
  const damaged: Record<number, number> = {};
  const dur = (g.ext?.core?.durability ?? {}) as Record<string, number>;
  for (const [key, hp] of Object.entries(dur)) {
    if (!key.startsWith('e:')) continue;
    const eid = Number(key.slice(2));
    if (g.board.edges[eid]?.piece?.type === WALL) damaged[eid] = hp;
  }
  return {
    zones: st.zones.map(z => ({
      id: z.id,
      hexIds: z.hexIds,
      complete: z.complete,
      controller: z.controller,
      meters: zoneMeters(st, z.id),
      permits: [...(st.permits[z.id] ?? [])],
      vp: Object.fromEntries(localVp(g, reg, interiorVertices(g, z.hexIds)))
    })),
    pending: pendingZones(g, reg).map(p => p.hexIds),
    gates: Object.entries(st.gates).map(([v, gr]) => ({ vertexId: Number(v), arch: gr.arch, open: gr.open, zoneId: gr.zoneId })),
    damaged,
    lastOverthrow: st.lastOverthrow
  };
}

/** Corners and edges where this player may not put a settlement or road because of walls and zones (the client checks its own spots with it). */
export function placementBlocksFor(ctx: Ctx, pid: Id): { vertices: number[]; edges: number[] } {
  const { g, reg } = ctx;
  const settle = reg.pieces.get('settlement');
  const road = reg.pieces.get('road');
  const vertices: number[] = [];
  const edges: number[] = [];
  const mode = String(g.phase).startsWith('setup') ? 'setup' : 'build';
  if (settle) for (const v of g.board.vertices) if (zonePlacementCheck.check(ctx, pid, settle, v.id, mode)) vertices.push(v.id);
  if (road) for (const e of g.board.edges) if (!e.piece && e.hexIds.length && zonePlacementCheck.check(ctx, pid, road, e.id, mode)) edges.push(e.id);
  return { vertices, edges };
}

export const bulwarkViewData: ViewDataDef = {
  id: 'bulwark.walls.view',
  shared: (g: GameState, reg: Registry) => ({ bulwark: bulwarkView(g, reg) }),
  overlays(g: GameState, reg: Registry) {
    const st = stateOf(g);
    if (!st) return undefined;
    const out: Record<number, { kind: string }> = {};
    // The would-be-inside tiles of open walls: the red incomplete hatch.
    for (const p of pendingZones(g, reg)) for (const h of p.hexIds) out[h] = { kind: 'wall-incomplete' };
    for (const z of st.zones) {
      if (!z.complete) continue;
      const gate = Object.values(st.gates).find(gr => gr.zoneId === z.id);
      for (const h of z.hexIds) out[h] = { kind: gate?.open ? 'zone-open' : 'zone-closed' };
    }
    return out;
  },
  player(g: GameState, reg: Registry, p, who) {
    if (!who.self || !stateOf(g)) return undefined;
    const ctx = { g, reg, log: () => {}, emit: () => {} } as unknown as Ctx;
    return { placementBlocks: placementBlocksFor(ctx, p.id) };
  }
};

/** Tile looks of a held zone: a calm stone tint with upright stakes; dashed stakes while its gate stands open. */
export const zoneClosedOverlay: OverlayKindVisual = {
  id: 'zone-closed',
  label: 'Walled zone',
  tint: { light: 'rgba(120, 104, 84, 0.16)', dark: 'rgba(150, 132, 108, 0.18)' },
  line: { light: 'rgba(92, 70, 46, 0.55)', dark: 'rgba(214, 196, 168, 0.5)' },
  pattern: '<path d="M2 1v8M5 1v8M8 1v8" stroke="currentColor" stroke-width="0.8" />'
};
export const zoneOpenOverlay: OverlayKindVisual = {
  id: 'zone-open',
  label: 'Walled zone, gate open',
  tint: { light: 'rgba(120, 104, 84, 0.10)', dark: 'rgba(150, 132, 108, 0.12)' },
  line: { light: 'rgba(92, 70, 46, 0.45)', dark: 'rgba(214, 196, 168, 0.4)' },
  pattern: '<path d="M2 1v2M2 5v2M5 2v2M5 6v2M8 1v2M8 5v2" stroke="currentColor" stroke-width="0.8" />'
};

// ---- Bots -------------------------------------------------------------------------------------------------------------------------------

/**
 * Zone sense for bots. Corners inside a zone someone else holds are worth less (30% tax), inside a zone the bot would hold or holds more (tax income).
 * Goals: finish a broken ring the bot would win (it has the most public VP inside, or ties, since the closer wins a tie).
 */
export const zonesBotGoal: BotGoalDef = {
  id: 'bulwark.walls',
  goalClass: 'generic',
  vertexDelta(ctx: Ctx, pid: Id, vertexId: number): number {
    const st = stateOf(ctx.g);
    if (!st) return 0;
    if (wallCorners(ctx.g, st).has(vertexId)) return -50;
    const zid = st.vertexZone[vertexId];
    const z = zid === undefined ? st.zones.find(zz => zz.spawned && !zz.complete && interiorVertices(ctx.g, zz.hexIds).includes(vertexId)) : zoneById(st, zid);
    if (!z) return 0;
    const pipSum = ctx.g.board.vertices[vertexId].hexIds.reduce((a, h) => a + pipsOf(ctx.g.board.hexes[h]?.number), 0);
    if (z.controller && z.controller !== pid) return -0.3 * pipSum;
    return 0.15 * pipSum + 1;
  },
  goals(ctx: Ctx, pid: Id): BotGoalItem[] {
    const { g, reg } = ctx;
    const st = stateOf(g);
    const p = getPlayer(g, pid);
    const def = reg.pieces.get(WALL);
    if (!st || !p || !def || (p.pieces[WALL] ?? 0) <= 0) return [];
    const cost = priceOf(g, reg, p, def);
    if (totalCards(p) < 1) return [];
    const out: BotGoalItem[] = [];
    for (const z of st.zones) {
      if (z.complete) continue;
      const corners = interiorVertices(g, z.hexIds);
      const vp = localVp(g, reg, corners);
      const mine = vp.get(pid) ?? 0;
      if (mine <= 0) continue;
      if ([...vp.values()].some(n => n > mine)) continue;
      const gaps = ringEdges(g, z.hexIds).filter(eid => !isWallPiece(g, eid) && !archEdges(st).has(eid) && canPlaceWall(ctx, pid, eid, 'build'));
      if (!gaps.length) continue;
      out.push({
        id: `bulwark.close:${z.id}:${gaps[0]}`,
        priority: 60 + 5 * (ringEdges(g, z.hexIds).length - gaps.length > 0 ? 1 : 0) - gaps.length,
        cost,
        action: { type: 'build', payload: { piece: WALL, loc: gaps[0] } },
        needsTags: ['vp']
      });
    }
    return out;
  }
};

export const wallsAddon: AddonDef = {
  id: 'bulwark.walls',
  name: 'Walls & zones',
  description: 'Walled zones spawn on the map (radius 4+). The most public VP inside controls a zone; guests pay 30% tax; a guest who passes the lord takes over. Walls extend from existing walls.',
  links: [
    { target: 'tile-state', kind: 'mechanic' },
    { target: 'production', kind: 'mechanic' },
    { target: 'score', kind: 'mechanic' },
    { target: 'overlay', kind: 'ui' },
    { target: 'event-deck', kind: 'content' },
    { target: 'bot-goals', kind: 'bot' }
  ],
  rules: { pieceLimits: { [WALL]: WALL_SUPPLY } },
  register(api) {
    api.piece(wallPiece);
    api.define(PLACEMENT_CHECKS, zonePlacementCheck);
    api.define(PRODUCTION_STEPS, zoneTaxStep);
    api.define(EVENT_CARDS, peasantRevoltCard);
    api.define(VIEW_DATA, bulwarkViewData);
    api.define(OVERLAY_KINDS, zoneClosedOverlay);
    api.define(OVERLAY_KINDS, zoneOpenOverlay);
    api.define(BOT_GOALS, zonesBotGoal);
    api.hook('afterMapGenerated', zonesAfterMapGenerated);
    api.hook('onGameStart', (ctx: Ctx) => {
      raiseSpawnedWalls(ctx);
      refreshZones(ctx);
    });
    api.hook('onBuild', (ctx: Ctx, def: PieceDef, pid: Id, loc: number) => {
      if (def.id !== WALL && def.id !== STONE_WALL) return;
      const st = bulwarkState(ctx.g);
      st.lastWallBuilder = pid;
      if (def.id === WALL) {
        for (const w of touchingWalls(ctx.g, st, loc)) {
          const zs = zonesOfWall(ctx.g, st, w);
          if (st.wallZone[loc] === undefined && zs.length) st.wallZone[loc] = zs[0].id;
          for (const z of zs) z.closer = pid;
        }
      }
    });
    api.hook('afterAction', (ctx: Ctx) => {
      if (stateOf(ctx.g)) refreshZones(ctx);
    });
  }
};

export { NO_OWNER };
