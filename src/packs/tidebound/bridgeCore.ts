// MODULE: bridge placement rule, Bridge piece def and bridge bot goal (the base of the bridge addons, so rickety bridges need not import bridges.ts) | DEPENDS ON: packs/base/constants, packs/base/placement, packs/tidebound/bridgeConsts, shared/index | USED BY: packs/tidebound/bridges, packs/tidebound/ricketyBridges
import { canPlacePiece, getPlayer, priceOf } from '../../shared';
import type { BotGoalDef, BotGoalItem, Ctx, Id, PieceDef } from '../../shared';
import { SETTLEMENT } from '../base/constants';
import { ownsRoadAt } from '../base/placement';
import { BRIDGE, BRIDGE_BASE_LIMIT, BRIDGE_COST } from './bridgeConsts';

/**
 * True when both sides ("lengths") of the edge touch ocean tiles (no adjacent land hex along the edge).
 * Endpoint vertices may sit on a coastal corner (shared by 1 land hex and 2 water hexes) or in open water.
 */
export function isOceanEdge(ctx: Ctx, edgeId: number): boolean {
  const e = ctx.g.board.edges[edgeId];
  return !!e && e.hexIds.length === 0;
}

/**
 * T3a: Bridge placement rule.
 * - Cannot be placed during setup (`mode === 'build'` only).
 * - Both sides of the edge must touch ocean tiles (`isOceanEdge`: `e.hexIds.length === 0`).
 * - Must connect to an endpoint vertex that either has a building owned by `pid`, or is unblocked
 *   (no opponent building) and has at least one road-like edge piece (`road` or `bridge`) owned by `pid`.
 */
export function canPlaceBridge(ctx: Ctx, pid: Id, edgeId: number, mode: 'setup' | 'build'): boolean {
  if (mode !== 'build') return false;
  const e = ctx.g.board.edges[edgeId];
  if (!e || e.piece) return false;
  if (!isOceanEdge(ctx, edgeId)) return false;

  for (const vId of [e.v1, e.v2]) {
    const v = ctx.g.board.vertices[vId];
    if (!v) continue;
    if (v.piece?.owner === pid) return true;
    if (v.piece && v.piece.owner !== pid) continue;
    if (v.edgeIds.some(other => ownsRoadAt(ctx, pid, other))) return true;
  }
  return false;
}

export const bridgePiece: PieceDef = {
  id: BRIDGE,
  name: 'Bridge',
  target: 'edge',
  cost: BRIDGE_COST,
  vp: 0,
  produces: 0,
  baseLimit: BRIDGE_BASE_LIMIT,
  roadLike: true,
  scaleWithRadius: true,
  icon: '🌉',
  canPlace: canPlaceBridge
};

/**
 * T3e: Minimal bot goal for Bridges.
 * Finds legal ocean edges for `pid` and prioritizes bridges that reach or step toward open land settlement spots
 * across water (or extend the player's road/bridge network).
 */
export const bridgeBotGoal: BotGoalDef = {
  id: 'tidebound.bridges',
  goalClass: 'generic',
  /** The bot's "boxed in?" check counts bridges as extra steps, and they cross exactly the ocean edges roads cannot. */
  edgeReach(ctx: Ctx, pid: Id) {
    const left = getPlayer(ctx.g, pid)?.pieces[BRIDGE] ?? 0;
    return left > 0 ? { steps: left, crosses: (edgeId: number) => isOceanEdge(ctx, edgeId) } : null;
  },
  goals(ctx: Ctx, pid: Id): BotGoalItem[] {
    const p = getPlayer(ctx.g, pid);
    if (!p || (p.pieces[BRIDGE] ?? 0) <= 0) return [];
    const settleDef = ctx.reg.pieces.get(SETTLEMENT);
    const { vertices, edges } = ctx.g.board;

    let bestEdgeId = -1;
    let bestScore = -1;

    for (const e of edges) {
      if (!canPlaceBridge(ctx, pid, e.id, 'build')) continue;
      let score = 52;
      for (const vId of [e.v1, e.v2]) {
        const v = vertices[vId];
        if (!v) continue;
        // Direct landing on an open coastal settlement spot
        if (settleDef && canPlacePiece(ctx, pid, settleDef, vId, 'setup')) {
          score = Math.max(score, 84);
        } else {
          // One step away from an open coastal settlement spot
          for (const adjV of v.adjacentVertices) {
            if (settleDef && canPlacePiece(ctx, pid, settleDef, adjV, 'setup')) {
              score = Math.max(score, 72);
            }
          }
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestEdgeId = e.id;
      }
    }

    if (bestEdgeId < 0) return [];
    return [{
      id: `bridge:${bestEdgeId}`,
      priority: bestScore,
      cost: priceOf(ctx.g, ctx.reg, p, bridgePiece),
      action: { type: 'build', payload: { piece: BRIDGE, loc: bestEdgeId } },
      needsTags: ['sea']
    }];
  },
  edgeDelta(ctx: Ctx, pid: Id, edgeId: number): number {
    if (!isOceanEdge(ctx, edgeId)) return 0;
    const e = ctx.g.board.edges[edgeId];
    if (!e) return 0;
    const settleDef = ctx.reg.pieces.get(SETTLEMENT);
    for (const vId of [e.v1, e.v2]) {
      if (settleDef && canPlacePiece(ctx, pid, settleDef, vId, 'setup')) return 18;
    }
    return 6;
  }
};
