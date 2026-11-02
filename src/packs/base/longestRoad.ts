// MODULE: longest road metric (DFS over a player's roads and road-like edge pieces, blocked by opponent pieces) | DEPENDS ON: packs/base/placement, shared/index | USED BY: packs/base/awards, server/debug
import type { Ctx, Edge, Id } from '../../shared';
import { isRoadPiece } from './placement';

export function longestRoadFor(ctx: Ctx, pid: Id): number {
  const { board } = ctx.g;
  const mine = (e: Edge | undefined): boolean => !!e && !!e.piece && e.piece.owner === pid && isRoadPiece(ctx, e.piece.type);

  const roads = board.edges.filter(e => mine(e));
  if (roads.length === 0) return 0;

  let maxLen = 0;
  const used = new Set<number>();

  function dfs(vertexId: number, len: number): void {
    if (len > maxLen) maxLen = len;
    const v = board.vertices[vertexId];
    if (!v) return;
    if (len > 0 && v.piece && v.piece.owner !== pid) return;
    for (const edgeId of v.edgeIds) {
      if (used.has(edgeId)) continue;
      const edge = board.edges[edgeId];
      if (!mine(edge)) continue;
      used.add(edgeId);
      dfs(edge.v1 === vertexId ? edge.v2 : edge.v1, len + 1);
      used.delete(edgeId);
    }
  }

  const endpoints = new Set<number>();
  for (const e of roads) {
    endpoints.add(e.v1);
    endpoints.add(e.v2);
  }
  for (const vId of endpoints) dfs(vId, 0);
  return maxLen;
}
