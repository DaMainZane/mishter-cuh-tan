// MODULE: piece placement rules (settlement, road, city geometry/ownership) | DEPENDS ON: packs/base/constants, shared/index | USED BY: packs/_template/lantern, packs/base/longestRoad, packs/base/pieces, packs/tidebound/bridgeCore
import type { Ctx, Id } from '../../shared';
import { ROAD, SETTLEMENT } from './constants';

export function isRoadPiece(ctx: Ctx, type: string): boolean {
  return type === ROAD || !!ctx.reg.pieces.get(type)?.roadLike;
}

export function ownsRoadAt(ctx: Ctx, pid: Id, edgeId: number): boolean {
  const pc = ctx.g.board.edges[edgeId]?.piece;
  return !!pc && pc.owner === pid && isRoadPiece(ctx, pc.type);
}

export function canPlaceSettlement(ctx: Ctx, pid: Id, vertexId: number, mode: 'setup' | 'build'): boolean {
  const { board } = ctx.g;
  const v = board.vertices[vertexId];
  if (!v || v.piece || v.hexIds.length === 0) return false;
  for (const adj of v.adjacentVertices) {
    if (board.vertices[adj]?.piece) return false;
  }
  if (mode === 'setup') return true;
  return v.edgeIds.some(eId => ownsRoadAt(ctx, pid, eId));
}

export function canPlaceRoad(ctx: Ctx, pid: Id, edgeId: number, mode: 'setup' | 'build'): boolean {
  const { board, setup } = ctx.g;
  const e = board.edges[edgeId];
  if (!e || e.piece || e.hexIds.length === 0) return false;
  if (mode === 'setup') {
    const last = setup.lastVertexId;
    return last !== null && (e.v1 === last || e.v2 === last);
  }
  for (const vId of [e.v1, e.v2]) {
    const v = board.vertices[vId];
    if (!v) continue;
    // An opponent's piece on the vertex blocks the road from continuing through it.
    if (v.piece) {
      if (v.piece.owner === pid) return true;
      continue;
    }
    if (v.edgeIds.some(other => ownsRoadAt(ctx, pid, other))) return true;
  }
  return false;
}

export function canUpgradeToCity(ctx: Ctx, pid: Id, vertexId: number, mode: 'setup' | 'build'): boolean {
  if (mode !== 'build') return false;
  const v = ctx.g.board.vertices[vertexId];
  return !!v && !!v.piece && v.piece.owner === pid && v.piece.type === SETTLEMENT;
}
