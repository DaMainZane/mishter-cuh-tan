// MODULE: build validation and piece placement (cost, supply, upgrade, onBuild hooks) | DEPENDS ON: packs/base/constants, shared/index | USED BY: packs/base/actions/build, packs/base/piecesView, server/bots/brain, server/view
import { aboveBaseLimit, canAfford, doubledCost, getPlayer, payToBank, priceOf } from '../../shared';
import type { Ctx, GameState, Id, PieceDef, PlayerState, Registry, Resources } from '../../shared';
import { BASE_PIECE_LIMITS, ROAD, SETUP_PIECE } from './constants';

export type BuildMode = 'setup' | 'build';

export { BASE_PIECE_LIMITS };

/** Returns true if the player has already placed at least the base limit of this piece type on the board. */
export function isAboveBaseLimit(g: GameState, p: PlayerState, pieceId: string): boolean {
  const baseLimit = BASE_PIECE_LIMITS[pieceId];
  if (!baseLimit) return false;
  return aboveBaseLimit(g, p, { id: pieceId, baseLimit } as PieceDef);
}

/**
 * Effective resource cost for a piece (service in shared/pricing.ts): normal cost up to the base limit, double above it, then registered cost modifiers.
 * Pass `reg` to apply modifiers; without it only the base-limit rule applies.
 */
export function pieceCost(g: GameState, p: PlayerState, def: PieceDef, reg?: Registry): Resources {
  if (reg) return priceOf(g, reg, p, def);
  return aboveBaseLimit(g, p, def) ? doubledCost(def.cost) : def.cost;
}

/** setup phases place free pieces, the main phase places paid ones, anything else cannot build. */
export function buildMode(g: GameState): BuildMode | null {
  if (SETUP_PIECE[g.phase]) return 'setup';
  return g.phase === 'main' ? 'build' : null;
}

/** Road Building gives free roads (pending.freeRoads). */
export function isFree(p: PlayerState, def: PieceDef): boolean {
  return def.id === ROAD && (p.pending.freeRoads || 0) > 0;
}

export function validateBuild(ctx: Ctx, pid: Id, payload: any): string | null {
  const { g, reg } = ctx;
  const def = reg.pieces.get(payload?.piece);
  if (!def) return 'Unknown piece';
  const loc = payload.loc;
  if (!Number.isInteger(loc)) return 'Invalid location';
  const mode = buildMode(g);
  if (!mode) return 'Cannot build right now';
  if (mode === 'setup' && SETUP_PIECE[g.phase] !== def.id) return `Place a ${SETUP_PIECE[g.phase]} now`;

  const slots = def.target === 'vertex' ? g.board.vertices : g.board.edges;
  if (!slots[loc]) return 'Invalid location';

  const p = getPlayer(g, pid)!;
  if ((p.pieces[def.id] || 0) <= 0) return `No ${def.name} pieces left`;
  if (!def.canPlace(ctx, pid, loc, mode)) return `Cannot place a ${def.name} there`;
  const cost = pieceCost(g, p, def, reg);
  if (mode === 'build' && !isFree(p, def) && !canAfford(p, cost)) return 'Not enough resources';
  return null;
}

export function placePiece(ctx: Ctx, pid: Id, def: PieceDef, loc: number, mode: BuildMode): void {
  const { g } = ctx;
  const p = getPlayer(g, pid)!;
  const overBase = mode === 'build' && !isFree(p, def) && aboveBaseLimit(g, p, def);
  const cost = pieceCost(g, p, def, ctx.reg);

  if (mode === 'build') {
    if (isFree(p, def)) p.pending.freeRoads--;
    else payToBank(ctx, p, cost);
  }

  const slot = def.target === 'vertex' ? g.board.vertices[loc] : g.board.edges[loc];
  if (def.upgradeFrom && slot.piece && slot.piece.type === def.upgradeFrom) {
    p.pieces[def.upgradeFrom] = (p.pieces[def.upgradeFrom] || 0) + 1;
  }
  slot.piece = { type: def.id, owner: pid };
  p.pieces[def.id]--;

  ctx.log(`${p.avatar} ${p.name} ${def.upgradeFrom ? 'upgraded to a' : 'placed a'} ${def.name}${overBase ? ' (2× cost)' : ''}`, p.color);
  ctx.emit('built', { playerId: pid, piece: def.id, target: def.target, loc, upgrade: !!def.upgradeFrom, doubleCost: overBase });
  for (const hook of ctx.reg.hooks.onBuild) hook(ctx, def, pid, loc);
}
