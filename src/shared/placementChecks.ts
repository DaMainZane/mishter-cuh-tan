// MODULE: placement vetoes and Longest Road breaks (generic extension points: an addon can forbid a piece on a spot, or break a road at a corner, without the base rules naming it) | DEPENDS ON: shared/ctx, shared/registry, shared/types | USED BY: shared/index
import type { Ctx } from './ctx';
import { defsOf } from './registry';
import type { PieceDef } from './registry';
import type { Id } from './types';

/** Keyed registry: `api.define(PLACEMENT_CHECKS, { id, check })`. */
export const PLACEMENT_CHECKS = 'placementChecks';

/**
 * A veto on top of a piece's own `canPlace`: return a reason to refuse the piece on `loc`, or null to allow it. Checked by the build action, the
 * generic spot lists sent to the client and the bot's candidate spots. Keep it cheap: it runs for every candidate spot.
 */
export interface PlacementCheckDef {
  id: string;
  check(ctx: Ctx, pid: Id, def: PieceDef, loc: number, mode: 'setup' | 'build'): string | null;
  replace?: boolean;
}

/** The first veto reason for this piece on this spot, or null when nothing forbids it. */
export function placementBlock(ctx: Ctx, pid: Id, def: PieceDef, loc: number, mode: 'setup' | 'build'): string | null {
  for (const c of defsOf<PlacementCheckDef>(ctx.reg, PLACEMENT_CHECKS).values()) {
    const why = c.check(ctx, pid, def, loc, mode);
    if (why) return why;
  }
  return null;
}

/** The piece's own placement rule plus every registered veto. Use this, not `def.canPlace`, wherever a spot is offered or checked. */
export function canPlacePiece(ctx: Ctx, pid: Id, def: PieceDef, loc: number, mode: 'setup' | 'build'): boolean {
  return def.canPlace(ctx, pid, loc, mode) && placementBlock(ctx, pid, def, loc, mode) === null;
}

/** Keyed registry: `api.define(LONGEST_ROAD_BREAKS, { id, breaks })`. */
export const LONGEST_ROAD_BREAKS = 'longestRoadBreaks';

/**
 * Something on a corner that cuts `pid`'s road there for Longest Road (like an opponent's settlement does). `breaks` is asked for corners a road of
 * `pid` passes through; return true to cut it.
 */
export interface LongestRoadBreakDef {
  id: string;
  breaks(ctx: Ctx, pid: Id, vertexId: number): boolean;
  replace?: boolean;
}

/** Does anything registered cut `pid`'s road at this corner? */
export function roadBrokenAt(ctx: Ctx, pid: Id, vertexId: number): boolean {
  for (const d of defsOf<LongestRoadBreakDef>(ctx.reg, LONGEST_ROAD_BREAKS).values()) {
    if (d.breaks(ctx, pid, vertexId)) return true;
  }
  return false;
}
