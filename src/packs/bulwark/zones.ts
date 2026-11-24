// MODULE: Bulwark zone state and board geometry (wall edges, gate arches, zone records, enclosure flood, interior corners, controllers, rebellion, the would-be-inside tiles of an open wall, the elevation bonus) | DEPENDS ON: packs/bulwark/constants, shared/index | USED BY: packs/bulwark/gatehouse, packs/bulwark/index, packs/bulwark/spawn, packs/bulwark/wallDecay, packs/bulwark/wallTiers, packs/bulwark/walls
import { getPlayer, LONGEST_ROAD_BREAKS } from '../../shared';
import type { Board, Ctx, GameState, Id, Registry } from '../../shared';
import { STONE_WALL, WALL } from './constants';

/** One zone: the land a wall ring encloses (or would enclose, for a broken spawned ring). */
export interface ZoneRec {
  id: number;
  /** Hex ids inside, ascending (land and any water inside the ring). */
  hexIds: number[];
  /** Spawned by the map (its ring may be broken; `hexIds` is the planned inside). False for a ring players closed. */
  spawned: boolean;
  /** Every edge around it holds a wall or a gate arch. */
  complete: boolean;
  /** Who controls it (most public VP inside). Kept while the zone is broken, but control and tax pause. */
  controller: Id | null;
  /** The player who placed the last wall piece of this zone (wins a tie when it closes). */
  closer: Id | null;
}

export interface GateRec {
  zoneId: number;
  open: boolean;
  /** The wall edge beside the gate that became the gateway arch (roads may run through it). */
  arch: number;
  /** Tier the arch edge had before the gate replaced it. */
  tier: string;
}

export interface BulwarkState {
  zones: ZoneRec[];
  nextId: number;
  /** Wall edge id -> the zone it was built for (spawned walls, and player walls that extend them). */
  wallZone: Record<number, number>;
  /** Tax meters: zone id -> guest id -> twentieths of a card owed. */
  meters: Record<number, Record<Id, number>>;
  /** Taxes a guest skips (Peasant revolt): zone id -> guest id -> count. */
  skips: Record<number, Record<Id, number>>;
  /** Permit holders per zone. */
  permits: Record<number, Id[]>;
  /** Gate corner id -> gate. */
  gates: Record<number, GateRec>;
  /** Corner id -> complete zone id, for every corner inside a complete zone (rebuilt by `syncZones`). */
  vertexZone: Record<number, number>;
  /** Wall corners and each zone's inside corners as of the last `syncZones` (lookups that run for every spot, so big maps stay fast). */
  corners?: number[];
  zoneCorners?: Record<number, number[]>;
  /** Tiles given the +1 elevation bonus (so it can be taken off again). */
  bonusHexes: number[];
  /** Who placed the most recent wall piece (the closer of a ring it closes). */
  lastWallBuilder?: Id | null;
  /** The last change of control, for the client's title card. */
  lastOverthrow: { round: number; zoneId: number; from: Id | null; to: Id } | null;
}

export function bulwarkState(g: GameState): BulwarkState {
  if (!g.ext) g.ext = {};
  if (!g.ext.bulwark) {
    g.ext.bulwark = {
      zones: [], nextId: 0, wallZone: {}, meters: {}, skips: {}, permits: {}, gates: {}, vertexZone: {}, bonusHexes: [], lastOverthrow: null
    } satisfies BulwarkState;
  }
  return g.ext.bulwark as BulwarkState;
}

export function zoneById(st: BulwarkState, id: number): ZoneRec | undefined {
  return st.zones.find(z => z.id === id);
}

// ---- Board topology (cached per board) --------------------------------------------------------------------------------------------

interface Topo {
  /** Hex id -> neighbouring hex ids (sharing an edge). */
  adj: number[][];
  /** "a,b" (a < b) -> the edge between two hexes. */
  between: Map<string, number>;
  /** Hexes with an edge on the board's rim (the outside is beyond them). */
  rim: Set<number>;
  /** Hex id -> the edges around it. */
  hexEdges: number[][];
}

const topoCache = new WeakMap<Board, Topo>();

export function topo(board: Board): Topo {
  let t = topoCache.get(board);
  if (t) return t;
  const n = board.hexes.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  const hexEdges: number[][] = Array.from({ length: n }, () => []);
  const between = new Map<string, number>();
  const rim = new Set<number>();
  for (const e of board.edges) {
    for (const h of e.hexIds) hexEdges[h]?.push(e.id);
    if (e.hexIds.length === 2) {
      const [a, b] = e.hexIds[0] < e.hexIds[1] ? [e.hexIds[0], e.hexIds[1]] : [e.hexIds[1], e.hexIds[0]];
      adj[a].push(b);
      adj[b].push(a);
      between.set(`${a},${b}`, e.id);
    } else if (e.hexIds.length === 1) {
      rim.add(e.hexIds[0]);
    }
  }
  t = { adj, between, rim, hexEdges };
  topoCache.set(board, t);
  return t;
}

// ---- Walls and gates -------------------------------------------------------------------------------------------------------------

/** Is this edge a wall piece (palisade or stone)? */
export function isWallPiece(g: GameState, edgeId: number): boolean {
  const t = g.board.edges[edgeId]?.piece?.type;
  return t === WALL || t === STONE_WALL;
}

/** Edge ids that are gate arches. */
export function archEdges(st: BulwarkState): Set<number> {
  return new Set(Object.values(st.gates).map(gr => gr.arch));
}

/** Does this edge close a zone (a wall piece or a gate arch)? */
export function closesEdge(g: GameState, st: BulwarkState, edgeId: number, arches = archEdges(st)): boolean {
  return isWallPiece(g, edgeId) || arches.has(edgeId);
}

/** Corners on a wall (an end of a wall piece or of a gate arch). No building may stand on one; only a gate. */
export function wallCorners(g: GameState, st: BulwarkState): Set<number> {
  const out = new Set<number>();
  const arches = archEdges(st);
  for (const e of g.board.edges) {
    if (isWallPiece(g, e.id) || arches.has(e.id)) {
      out.add(e.v1);
      out.add(e.v2);
    }
  }
  return out;
}

const cornerSets = new WeakMap<number[], Set<number>>();

/** Wall corners as a set: from the last `syncZones` when there is one (cached), else computed now. */
export function wallCornerSet(g: GameState, st: BulwarkState): Set<number> {
  if (!st.corners) return wallCorners(g, st);
  let s = cornerSets.get(st.corners);
  if (!s) {
    s = new Set(st.corners);
    cornerSets.set(st.corners, s);
  }
  return s;
}

/** A zone's inside corners: from the last `syncZones` when there is one, else computed now. */
export function zoneCorners(g: GameState, z: ZoneRec): number[] {
  const st = g.ext?.bulwark as BulwarkState | undefined;
  return st?.zoneCorners?.[z.id] ?? interiorVertices(g, z.hexIds);
}

/** Edges around a set of hexes: exactly one side inside (or the rim of the board beside an inside hex). */
export function ringEdges(g: GameState, hexIds: Iterable<number>): number[] {
  const set = hexIds instanceof Set ? (hexIds as Set<number>) : new Set(hexIds);
  const out: number[] = [];
  for (const e of g.board.edges) {
    const inside = e.hexIds.filter(h => set.has(h)).length;
    if (inside === 1 && (e.hexIds.length === 1 || e.hexIds.length === 2)) out.push(e.id);
  }
  return out;
}

/** Corners inside a set of hexes (all three hexes around the corner are inside). */
export function interiorVertices(g: GameState, hexIds: Iterable<number>): number[] {
  const set = hexIds instanceof Set ? (hexIds as Set<number>) : new Set(hexIds);
  return g.board.vertices.filter(v => v.hexIds.length === 3 && v.hexIds.every(h => set.has(h))).map(v => v.id);
}

/** Edges inside a set of hexes (both sides inside). */
export function interiorEdges(g: GameState, hexIds: Iterable<number>): number[] {
  const set = hexIds instanceof Set ? (hexIds as Set<number>) : new Set(hexIds);
  return g.board.edges.filter(e => e.hexIds.length === 2 && e.hexIds.every(h => set.has(h))).map(e => e.id);
}

/**
 * Hexes the outside cannot reach without crossing a closed edge: a flood from the rim of the board over every edge that is not closed. `extra` adds
 * edges that count as closed (the joining line of an open wall). Returns the unreached hexes in connected groups, each ascending.
 */
export function enclosedGroups(g: GameState, closed: (edgeId: number) => boolean, extra?: Set<number>): number[][] {
  const t = topo(g.board);
  const shut = (eid: number) => closed(eid) || !!extra?.has(eid);
  const reached = new Set<number>();
  const queue: number[] = [];
  for (const h of t.rim) {
    // A rim hex is reached from outside unless every rim edge of it is closed.
    const rimOpen = t.hexEdges[h].some(eid => g.board.edges[eid].hexIds.length === 1 && !shut(eid));
    if (rimOpen && !reached.has(h)) {
      reached.add(h);
      queue.push(h);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const a = queue[i];
    for (const b of t.adj[a]) {
      if (reached.has(b)) continue;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const eid = t.between.get(key);
      if (eid !== undefined && shut(eid)) continue;
      reached.add(b);
      queue.push(b);
    }
  }
  const groups: number[][] = [];
  const seen = new Set<number>();
  for (const h of g.board.hexes) {
    if (reached.has(h.id) || seen.has(h.id)) continue;
    const comp: number[] = [];
    const q = [h.id];
    seen.add(h.id);
    for (let i = 0; i < q.length; i++) {
      const a = q[i];
      comp.push(a);
      for (const b of t.adj[a]) {
        if (reached.has(b) || seen.has(b)) continue;
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        const eid = t.between.get(key);
        if (eid !== undefined && shut(eid)) continue;
        seen.add(b);
        q.push(b);
      }
    }
    groups.push(comp.sort((x, y) => x - y));
  }
  return groups;
}

const landCount = (g: GameState, reg: Registry, hexIds: number[]) => hexIds.filter(h => reg.tiles.get(g.board.hexes[h]?.type)?.land).length;

// ---- Zones: completion, control, rebellion ------------------------------------------------------------------------------------------

/** Public VP of each player's buildings on the given corners. */
export function localVp(g: GameState, reg: Registry, corners: number[]): Map<Id, number> {
  const out = new Map<Id, number>();
  for (const vId of corners) {
    const pc = g.board.vertices[vId]?.piece;
    if (!pc || !getPlayer(g, pc.owner)) continue;
    const vp = reg.pieces.get(pc.type)?.vp ?? 0;
    if (vp > 0) out.set(pc.owner, (out.get(pc.owner) ?? 0) + vp);
  }
  return out;
}

/** The zones a wall edge belongs to: the zone it was built for, and any zone whose ring runs along it. */
export function zonesOfWall(g: GameState, st: BulwarkState, edgeId: number): ZoneRec[] {
  const out = new Set<ZoneRec>();
  const own = st.wallZone[edgeId];
  if (own !== undefined) {
    const z = zoneById(st, own);
    if (z) out.add(z);
  }
  const e = g.board.edges[edgeId];
  if (e) {
    for (const z of st.zones) {
      const inside = e.hexIds.filter(h => z.hexIds.includes(h)).length;
      if (inside === 1) out.add(z);
    }
  }
  return [...out];
}

/** Does `pid` have a building on a corner inside this zone? */
export function hasBuildingIn(g: GameState, z: ZoneRec, pid: Id): boolean {
  return zoneCorners(g, z).some(v => g.board.vertices[v]?.piece?.owner === pid);
}

/** May `pid` build inside a complete zone (its controller, a permit holder, or anyone while nobody controls it)? */
export function mayBuildIn(st: BulwarkState, z: ZoneRec, pid: Id): boolean {
  if (!z.controller || z.controller === pid) return true;
  return (st.permits[z.id] ?? []).includes(pid);
}

/**
 * Brings the zones in line with the board: which rings are complete, new rings players closed, controllers (most public VP inside; a tie when a ring
 * closes goes to its closer; a guest who passes the controller takes over), the corner lookup for tax, and the elevation bonus. Safe to run often.
 */
export function syncZones(ctx: Ctx, opts: { highGround?: boolean } = {}): void {
  const { g, reg } = ctx;
  const st = bulwarkState(g);
  const arches = archEdges(st);
  const closed = (eid: number) => closesEdge(g, st, eid, arches);

  // 1. Rings players closed around land no zone covers yet become zones.
  const known = new Set<number>();
  for (const z of st.zones) for (const h of z.hexIds) known.add(h);
  for (const grp of enclosedGroups(g, closed)) {
    if (grp.some(h => known.has(h))) continue;
    if (landCount(g, reg, grp) < 3) continue;
    // Its closer is whoever placed the last wall piece (the one that closed it).
    const z: ZoneRec = { id: st.nextId++, hexIds: grp, spawned: false, complete: true, controller: null, closer: st.lastWallBuilder ?? null };
    const ring = ringEdges(g, grp);
    st.zones.push(z);
    for (const eid of ring) if (st.wallZone[eid] === undefined) st.wallZone[eid] = z.id;
  }

  // 2. Completion and control.
  st.vertexZone = {};
  for (const z of st.zones) {
    const wasComplete = z.complete;
    z.complete = ringEdges(g, z.hexIds).every(closed);
    if (!z.complete) continue;
    const corners = interiorVertices(g, z.hexIds);
    for (const v of corners) st.vertexZone[v] = z.id;
    const vp = localVp(g, reg, corners);
    let top = -1;
    for (const n of vp.values()) top = Math.max(top, n);
    const leaders = [...vp.entries()].filter(([, n]) => n === top).map(([p]) => p);
    if (leaders.length === 0) {
      z.controller = null;
      continue;
    }
    const current = z.controller && vp.has(z.controller) ? z.controller : null;
    if (!current) {
      // Newly complete or newly settled: the leader, and on a tie the closer (else the first in seat order).
      const pick = leaders.length === 1 ? leaders[0] : leaders.includes(z.closer ?? '') ? z.closer! : g.players.map(p => p.id).find(id => leaders.includes(id))!;
      if (z.controller !== pick) {
        const from = z.controller;
        z.controller = pick;
        if (wasComplete && from) announceOverthrow(ctx, z, from, pick);
        else announceControl(ctx, z, pick);
      }
      continue;
    }
    const mine = vp.get(current) ?? 0;
    const rebel = [...vp.entries()].filter(([p, n]) => p !== current && n > mine).sort((a, b) => b[1] - a[1])[0];
    if (rebel) announceOverthrow(ctx, z, current, rebel[0]);
  }

  // 3. High ground: +1 elevation for land inside a complete zone.
  const want = new Set<number>();
  if (opts.highGround) for (const z of st.zones) if (z.complete) for (const h of z.hexIds) want.add(h);
  for (const h of st.bonusHexes) {
    if (!want.has(h) && g.board.hexes[h]) delete g.board.hexes[h].ext.elevationBonus;
  }
  for (const h of want) if (g.board.hexes[h]) g.board.hexes[h].ext.elevationBonus = 1;
  st.bonusHexes = [...want].sort((a, b) => a - b);

  // 4. Lookups for the spot checks (a fresh array each sync, so cached sets built from the old one drop away).
  st.corners = [...wallCorners(g, st)].sort((a, b) => a - b);
  st.zoneCorners = {};
  for (const z of st.zones) st.zoneCorners[z.id] = interiorVertices(g, z.hexIds);
}

function announceControl(ctx: Ctx, z: ZoneRec, to: Id): void {
  const p = getPlayer(ctx.g, to);
  if (!p) return;
  ctx.emit('zoneControlled', { zoneId: z.id, playerId: to });
  ctx.log(`🏰 ${p.avatar} ${p.name} controls a walled zone`, p.color);
}

function announceOverthrow(ctx: Ctx, z: ZoneRec, from: Id, to: Id): void {
  const { g } = ctx;
  const st = bulwarkState(g);
  z.controller = to;
  // The new controller pays no tax there any more; the old one starts a fresh meter as a guest.
  if (st.meters[z.id]) delete st.meters[z.id][to];
  st.lastOverthrow = { round: g.round || 0, zoneId: z.id, from, to };
  const a = getPlayer(g, to);
  const b = getPlayer(g, from);
  ctx.emit('zoneOverthrown', { zoneId: z.id, from, to });
  if (a) ctx.log(`⚔️ Overthrown! ${a.avatar} ${a.name} takes a walled zone from ${b ? `${b.avatar} ${b.name}` : 'its old lord'}`, a.color);
}

// ---- The would-be-inside tiles of open walls (for the board highlight) -----------------------------------------------------------------

/** Shortest corner path (edge ids) from `from` to any corner in `targets`, over edges that are not walls. At most `maxLen` edges. */
function shortestPath(g: GameState, from: number, targets: Set<number>, blocked: Set<number>, maxLen = 14): number[] | null {
  const prev = new Map<number, { v: number; e: number }>();
  const seen = new Set<number>([from]);
  let frontier = [from];
  for (let d = 0; d < maxLen && frontier.length; d++) {
    const next: number[] = [];
    for (const v of frontier) {
      for (const eid of g.board.vertices[v].edgeIds) {
        if (blocked.has(eid)) continue;
        const e = g.board.edges[eid];
        const w = e.v1 === v ? e.v2 : e.v1;
        if (seen.has(w)) continue;
        seen.add(w);
        prev.set(w, { v, e: eid });
        if (targets.has(w)) {
          const path: number[] = [];
          let cur = w;
          while (cur !== from) {
            const p = prev.get(cur)!;
            path.push(p.e);
            cur = p.v;
          }
          return path;
        }
        next.push(w);
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * The tiles each open wall would enclose if it were closed now. A broken spawned ring shows its planned inside. Any other open wall line is closed in
 * thought along the shortest path between its two open ends (or from its one open end back to the rest of its wall), the user's sketch.
 */
export function pendingZones(g: GameState, reg: Registry): { zoneId: number | null; hexIds: number[] }[] {
  const st = bulwarkState(g);
  const out: { zoneId: number | null; hexIds: number[] }[] = [];
  const covered = new Set<number>();
  for (const z of st.zones) {
    if (z.complete) {
      for (const h of z.hexIds) covered.add(h);
    } else if (z.spawned) {
      out.push({ zoneId: z.id, hexIds: z.hexIds });
      for (const h of z.hexIds) covered.add(h);
    }
  }
  // Wall graph over corners.
  const arches = archEdges(st);
  const wallEdges = g.board.edges.filter(e => isWallPiece(g, e.id) || arches.has(e.id));
  const deg = new Map<number, number>();
  for (const e of wallEdges) for (const v of [e.v1, e.v2]) deg.set(v, (deg.get(v) ?? 0) + 1);
  const wallSet = new Set(wallEdges.map(e => e.id));
  const done = new Set<number>();
  for (const start of wallEdges) {
    if (done.has(start.id)) continue;
    // One connected wall line.
    const comp: number[] = [];
    const corners = new Set<number>();
    const q = [start.id];
    done.add(start.id);
    for (let i = 0; i < q.length; i++) {
      const e = g.board.edges[q[i]];
      comp.push(e.id);
      for (const v of [e.v1, e.v2]) {
        corners.add(v);
        for (const eid of g.board.vertices[v].edgeIds) {
          if (wallSet.has(eid) && !done.has(eid)) {
            done.add(eid);
            q.push(eid);
          }
        }
      }
    }
    // Lines of a broken spawned ring are shown by its plan.
    if (comp.some(eid => {
      const z = st.wallZone[eid] !== undefined ? zoneById(st, st.wallZone[eid]) : undefined;
      return !!z && z.spawned && !z.complete;
    })) continue;
    const ends = [...corners].filter(v => deg.get(v) === 1).sort((a, b) => a - b);
    let path: number[] | null = null;
    if (ends.length === 2) {
      path = shortestPath(g, ends[0], new Set([ends[1]]), wallSet);
    } else if (ends.length === 1) {
      // Back to the rest of the wall, away from the open end's own branch (corners more than 2 steps along it).
      const branch = new Set<number>([ends[0]]);
      let cur = ends[0];
      for (let k = 0; k < 2; k++) {
        const nextEdge = g.board.vertices[cur].edgeIds.find(eid => wallSet.has(eid) && !branch.has(g.board.edges[eid].v1 === cur ? g.board.edges[eid].v2 : g.board.edges[eid].v1));
        if (nextEdge === undefined) break;
        const e = g.board.edges[nextEdge];
        cur = e.v1 === cur ? e.v2 : e.v1;
        branch.add(cur);
      }
      const targets = new Set([...corners].filter(v => !branch.has(v)));
      if (targets.size) path = shortestPath(g, ends[0], targets, wallSet);
    }
    if (!path || !path.length) continue;
    const extra = new Set(path);
    const closed = (eid: number) => isWallPiece(g, eid) || arches.has(eid);
    const before = new Set(enclosedGroups(g, closed).flat());
    const after = enclosedGroups(g, closed, extra).flat().filter(h => !before.has(h) && !covered.has(h));
    if (landCount(g, reg, after) < 1) continue;
    out.push({ zoneId: null, hexIds: after.sort((a, b) => a - b) });
  }
  return out;
}

// ---- Gates on Longest Road ------------------------------------------------------------------------------------------------------------

/** A closed gate cuts every other player's road at its corner; its owner's road passes, and an open gate passes everyone. */
export const gateRoadBreak = {
  id: 'bulwark.gate_road_break',
  breaks(ctx: Ctx, pid: Id, vertexId: number): boolean {
    const st = ctx.g.ext?.bulwark as BulwarkState | undefined;
    const gate = st?.gates?.[vertexId];
    if (!gate || gate.open) return false;
    const z = zoneById(st!, gate.zoneId);
    return !!z?.controller && z.controller !== pid;
  }
};
export { LONGEST_ROAD_BREAKS };
