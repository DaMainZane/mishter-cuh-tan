// MODULE: bulwark.gatehouse addon (a gate on a wall corner turns one wall edge beside it into a gateway arch roads can pass; open lets anyone through, closed only the lord and permit holders; free permits by clicking a guest's building; a closed gate cuts other players' Longest Road; bots build a gate to get out and keep it closed) | DEPENDS ON: packs/bulwark/constants, packs/bulwark/zones, shared/index | USED BY: packs/bulwark/addons.generated, packs/bulwark/index
import { BOT_GOALS, canAfford, getPlayer, LONGEST_ROAD_BREAKS, payToBank } from '../../shared';
import type { ActionDef, AddonDef, BotGoalDef, BotGoalItem, Ctx, GameState, Id } from '../../shared';
import { BUILD_GATE, GATE_COST, SET_PERMIT, TOGGLE_GATE } from './constants';
import { archEdges, bulwarkState, closesEdge, gateRoadBreak, isWallPiece, ringEdges, zoneById } from './zones';
import type { BulwarkState, ZoneRec } from './zones';

/** The complete zone `pid` holds whose ring runs through this corner. */
function heldZoneAt(g: GameState, st: BulwarkState, pid: Id, vertexId: number): ZoneRec | undefined {
  const v = g.board.vertices[vertexId];
  if (!v) return undefined;
  return st.zones.find(z => z.complete && z.controller === pid && v.edgeIds.some(eid => ringEdges(g, z.hexIds).includes(eid)));
}

/** Which side of zone `z` an edge is on: true inside (both hexes inside), false outside. */
function insideOf(g: GameState, z: ZoneRec, edgeId: number): boolean {
  const e = g.board.edges[edgeId];
  return e.hexIds.length === 2 && e.hexIds.every(h => z.hexIds.includes(h));
}

/**
 * The wall edge beside corner `vertexId` that can become the gateway arch: its far corner's free edge points to the other side of the wall from this
 * corner's free edge, so a road can come in on one side and leave on the other. Null when no edge works.
 */
export function archFor(g: GameState, st: BulwarkState, z: ZoneRec, vertexId: number): number | null {
  const v = g.board.vertices[vertexId];
  const arches = archEdges(st);
  const walls = v.edgeIds.filter(eid => isWallPiece(g, eid));
  const free = v.edgeIds.filter(eid => !closesEdge(g, st, eid, arches));
  if (walls.length !== 2 || free.length !== 1) return null;
  const side = insideOf(g, z, free[0]);
  for (const w of [...walls].sort((a, b) => a - b)) {
    const e = g.board.edges[w];
    const far = e.v1 === vertexId ? e.v2 : e.v1;
    const fv = g.board.vertices[far];
    if (st.gates[far]) continue;
    const farFree = fv.edgeIds.filter(eid => eid !== w && !closesEdge(g, st, eid, arches));
    if (farFree.length !== 1) continue;
    if (insideOf(g, z, farFree[0]) !== side) return w;
  }
  return null;
}

function gateProblem(ctx: Ctx, pid: Id, vertexId: number): string | null {
  const { g } = ctx;
  if (!Number.isInteger(vertexId) || !g.board.vertices[vertexId]) return 'Choose a wall corner';
  if (!g.ext?.bulwark) return 'There are no walls';
  const st = bulwarkState(g);
  if (st.gates[vertexId]) return 'There is a gate here already';
  if (g.board.vertices[vertexId].piece) return 'A building stands here';
  const z = heldZoneAt(g, st, pid, vertexId);
  if (!z) return 'Build a gate on the wall of a zone you hold';
  if (Object.values(st.gates).some(gr => gr.zoneId === z.id)) return 'This zone has its gate already';
  if (archFor(g, st, z, vertexId) === null) return 'A gate cannot open here';
  return null;
}

/** Build a gate on a wall corner of a zone you hold. Payload `{ vertexId }`. It starts closed. */
export const buildGateAction: ActionDef = {
  type: BUILD_GATE,
  validate(ctx: Ctx, pid: Id, payload: any): string | null {
    const p = getPlayer(ctx.g, pid);
    if (!p) return 'Unknown player';
    const why = gateProblem(ctx, pid, Number(payload?.vertexId));
    if (why) return why;
    if (!canAfford(p, GATE_COST)) return 'A gate costs 2 brick and 1 ore';
    return null;
  },
  apply(ctx: Ctx, pid: Id, payload: any): void {
    const { g } = ctx;
    const st = bulwarkState(g);
    const p = getPlayer(g, pid)!;
    const vertexId = Number(payload.vertexId);
    const z = heldZoneAt(g, st, pid, vertexId)!;
    const arch = archFor(g, st, z, vertexId)!;
    payToBank(ctx, p, GATE_COST);
    const edge = g.board.edges[arch];
    const tier = edge.piece?.type ?? 'wall';
    edge.piece = null;
    if (g.ext?.core?.durability) delete g.ext.core.durability[`e:${arch}`];
    st.gates[vertexId] = { zoneId: z.id, open: false, arch, tier };
    ctx.log(`🚪 ${p.avatar} ${p.name} built a gate (closed)`, p.color);
    ctx.emit('gateBuilt', { playerId: pid, vertexId, arch });
  },
  legal(ctx: Ctx, pid: Id) {
    const { g } = ctx;
    if (!g.ext?.bulwark) return [];
    const st = bulwarkState(g);
    const out: { vertexId: number }[] = [];
    for (const z of st.zones) {
      if (!z.complete || z.controller !== pid) continue;
      const corners = new Set<number>();
      for (const eid of ringEdges(g, z.hexIds)) for (const v of [g.board.edges[eid].v1, g.board.edges[eid].v2]) corners.add(v);
      for (const v of [...corners].sort((a, b) => a - b)) if (gateProblem(ctx, pid, v) === null) out.push({ vertexId: v });
    }
    return out;
  },
  visual: {
    slot: 'vertex',
    spotKey: 'vertexId',
    button: { label: 'Gate', icon: '<path d="M4 21V10a8 8 0 0 1 16 0v11"/><path d="M8 21v-9a4 4 0 0 1 8 0v9"/>', order: 48 },
    hints: { noSupply: '', cannotAfford: 'A gate costs 2 brick and 1 ore', noSpots: 'Build a gate on the wall of a zone you hold' }
  },
  price: () => GATE_COST
} as ActionDef;

/** Open or close your gate (only on your own turn). Payload `{ vertexId }`. */
export const toggleGateAction: ActionDef = {
  type: TOGGLE_GATE,
  validate(ctx: Ctx, pid: Id, payload: any): string | null {
    const st = ctx.g.ext?.bulwark as BulwarkState | undefined;
    const gate = st?.gates?.[Number(payload?.vertexId)];
    if (!gate) return 'Choose a gate';
    if (zoneById(st!, gate.zoneId)?.controller !== pid) return 'Only the lord of the zone opens or closes its gate';
    return null;
  },
  apply(ctx: Ctx, pid: Id, payload: any): void {
    const st = bulwarkState(ctx.g);
    const gate = st.gates[Number(payload.vertexId)];
    gate.open = !gate.open;
    const p = getPlayer(ctx.g, pid)!;
    ctx.log(`🚪 ${p.avatar} ${p.name} ${gate.open ? 'opened' : 'closed'} their gate`, p.color);
    ctx.emit('gateToggled', { playerId: pid, vertexId: Number(payload.vertexId), open: gate.open });
  },
  legal(ctx: Ctx, pid: Id) {
    const st = ctx.g.ext?.bulwark as BulwarkState | undefined;
    if (!st) return [];
    return Object.entries(st.gates).filter(([, gr]) => zoneById(st, gr.zoneId)?.controller === pid).map(([v]) => ({ vertexId: Number(v) }));
  },
  visual: {
    slot: 'vertex',
    spotKey: 'vertexId',
    button: { label: 'Open/close', icon: '<path d="M5 21V10a7 7 0 0 1 14 0v11"/><path d="M12 13v4"/>', order: 49 },
    hints: { noSupply: '', cannotAfford: 'Opening or closing your gate is free', noSpots: 'You hold no gate' }
  }
} as ActionDef;

/** The guest whose building stands on this corner inside a zone `pid` holds, and that zone. */
function guestAt(g: GameState, st: BulwarkState, pid: Id, vertexId: number): { z: ZoneRec; guest: Id } | null {
  const zid = st.vertexZone?.[vertexId];
  const z = zid === undefined ? undefined : zoneById(st, zid);
  const pc = g.board.vertices[vertexId]?.piece;
  if (!z || z.controller !== pid || !pc || pc.owner === pid || !getPlayer(g, pc.owner)) return null;
  return { z, guest: pc.owner };
}

/** Give or take back a guest's permit (free): click one of their buildings inside your zone. Payload `{ vertexId }`. */
export const setPermitAction: ActionDef = {
  type: SET_PERMIT,
  validate(ctx: Ctx, pid: Id, payload: any): string | null {
    const st = ctx.g.ext?.bulwark as BulwarkState | undefined;
    if (!st || !guestAt(ctx.g, st, pid, Number(payload?.vertexId))) return 'Click a guest\'s building inside a zone you hold';
    return null;
  },
  apply(ctx: Ctx, pid: Id, payload: any): void {
    const st = bulwarkState(ctx.g);
    const { z, guest } = guestAt(ctx.g, st, pid, Number(payload.vertexId))!;
    const list = (st.permits[z.id] ??= []);
    const had = list.includes(guest);
    st.permits[z.id] = had ? list.filter(x => x !== guest) : [...list, guest];
    const p = getPlayer(ctx.g, pid)!;
    const q = getPlayer(ctx.g, guest)!;
    ctx.log(`📜 ${p.avatar} ${p.name} ${had ? 'took back' : 'gave'} a building permit ${had ? 'from' : 'to'} ${q.avatar} ${q.name}`, p.color);
    ctx.emit('permitChanged', { playerId: pid, guest, zoneId: z.id, granted: !had });
  },
  legal(ctx: Ctx, pid: Id) {
    const st = ctx.g.ext?.bulwark as BulwarkState | undefined;
    if (!st) return [];
    return Object.keys(st.vertexZone ?? {}).map(Number).filter(v => guestAt(ctx.g, st, pid, v)).map(vertexId => ({ vertexId }));
  },
  visual: {
    slot: 'vertex',
    spotKey: 'vertexId',
    button: { label: 'Permit', icon: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 10h6M9 14h6M9 18h3"/>', order: 50 },
    hints: { noSupply: '', cannotAfford: 'Permits are free', noSpots: 'No guest in a zone you hold' }
  }
} as ActionDef;

/** Bots that hold a zone with no gate build one (their roads can leave through it). */
export const gateBotGoal: BotGoalDef = {
  id: 'bulwark.gatehouse',
  goalClass: 'generic',
  goals(ctx: Ctx, pid: Id): BotGoalItem[] {
    const legal = buildGateAction.legal!(ctx, pid);
    if (!legal.length) return [];
    return [{ id: `bulwark.gate:${legal[0].vertexId}`, priority: 45, cost: GATE_COST, action: { type: BUILD_GATE, payload: legal[0] } }];
  }
};

/** Secondary and up keep their gates closed: rivals stay out of their zone. */
export const gateClosedBotGoal: BotGoalDef = {
  id: 'bulwark.gatehouse.closed',
  goalClass: 'basic',
  goals(ctx: Ctx, pid: Id): BotGoalItem[] {
    const st = ctx.g.ext?.bulwark as BulwarkState | undefined;
    if (!st) return [];
    const open = Object.entries(st.gates).find(([, gr]) => gr.open && zoneById(st, gr.zoneId)?.controller === pid);
    if (!open) return [];
    return [{ id: `bulwark.closegate:${open[0]}`, priority: 70, cost: {}, action: { type: TOGGLE_GATE, payload: { vertexId: Number(open[0]) } } }];
  }
};

export const gatehouseAddon: AddonDef = {
  id: 'bulwark.gatehouse',
  name: 'Gatehouse',
  description: 'The lord builds a gate on a wall corner (2 brick + 1 ore). Open lets anyone through; closed only permit holders. Permits are free. A closed gate cuts other players\' Longest Road.',
  deps: ['bulwark.walls'],
  links: [
    { target: 'piece-cost', kind: 'mechanic' },
    { target: 'overlay', kind: 'ui' },
    { target: 'bulwark.walls', kind: 'content' },
    { target: 'bot-goals', kind: 'bot' }
  ],
  register(api) {
    api.action(buildGateAction);
    api.phaseAction('main', BUILD_GATE);
    api.action(toggleGateAction);
    api.phaseAction('main', TOGGLE_GATE);
    api.action(setPermitAction);
    api.phaseAction('main', SET_PERMIT);
    api.define(LONGEST_ROAD_BREAKS, gateRoadBreak);
    api.define(BOT_GOALS, gateBotGoal);
    api.define(BOT_GOALS, gateClosedBotGoal);
  }
};
