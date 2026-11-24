// MODULE: bulwark.wall_decay addon (palisades have 3 durability: each 7 takes 1, each round a tide floods a tile next to one takes 1 (rot), the Palisade fire event takes 1 to 2; at 0 the piece is gone and the zone opens; repair for 1 wood back to full; bots repair at 1) | DEPENDS ON: packs/bulwark/constants, packs/bulwark/zones, shared/index | USED BY: packs/bulwark/addons.generated, packs/bulwark/index
import {
  addonOn,
  BOT_GOALS,
  createRng,
  damagePiece,
  DURABILITY_DEFS,
  EVENT_CARDS,
  getPieceDurability,
  getPlayer,
  getTileState,
  payToBank,
  canAfford,
  rngInt,
  SEVEN_STEP_ORDER,
  SEVEN_STEPS,
  setPieceDurability
} from '../../shared';
import type { ActionDef, AddonDef, BotGoalDef, BotGoalItem, Ctx, EventCardDef, GameState, Id, SevenStepDef } from '../../shared';
import { PALISADE_DURABILITY, REPAIR_COST, REPAIR_WALL, WALL } from './constants';
import { bulwarkState, hasBuildingIn, zonesOfWall } from './zones';

const FLOODED = 'flooded';
const FIRE_SALT = 0x46495245; // 'FIRE'

/** Palisade edge ids on the board. */
function palisades(g: GameState): number[] {
  return g.board.edges.filter(e => e.piece?.type === WALL).map(e => e.id);
}

/** Takes `amount` durability off a palisade; logs when it breaks. */
function wear(ctx: Ctx, edgeId: number, amount: number, why: string): boolean {
  const res = damagePiece(ctx, 'edge', edgeId, amount);
  if (res.broken) {
    ctx.log(`🪵 A palisade gave way (${why}): its zone is open until the wall is rebuilt`, null);
    ctx.emit('wallBroken', { edgeId, why });
  }
  return res.broken;
}

/** Every palisade loses 1 durability on a 7 (a capped DLC side effect of the seven, like rickety bridges). */
export const palisadeDecayStep: SevenStepDef = {
  id: 'bulwark.palisade_decay',
  order: SEVEN_STEP_ORDER.decay,
  isDlcSideEffect: true,
  priority: 80,
  canFire: (ctx: Ctx) => palisades(ctx.g).length > 0,
  run(ctx: Ctx): void {
    for (const eid of palisades(ctx.g)) wear(ctx, eid, 1, 'decay');
  }
};

/** Round start: a palisade next to a flooded tile rots, 1 durability per round the tide is up. Reads only the base `flooded` tile state. */
export function rotPalisades(ctx: Ctx): number {
  const { g } = ctx;
  let n = 0;
  for (const eid of palisades(g)) {
    const e = g.board.edges[eid];
    const wet = e.hexIds.some(h => getTileState(g.board.hexes[h])?.id === FLOODED);
    if (!wet) continue;
    n++;
    wear(ctx, eid, 1, 'rot');
  }
  return n;
}

/** Palisade fire: every palisade loses 1 or 2 durability (a draw per piece from a stream of the seed and round). */
export function palisadeFire(ctx: Ctx): number {
  const { g } = ctx;
  const rng = createRng(((Number(g.seed) || 1) ^ FIRE_SALT ^ Math.imul((g.round || 0) + 1, 0x9e3779b1)) >>> 0);
  let broken = 0;
  for (const eid of palisades(g)) if (wear(ctx, eid, 1 + rngInt(rng, 2), 'fire')) broken++;
  ctx.log(`🔥 Palisade fire! Every palisade burns${broken ? `; ${broken} gave way` : ''}`, null);
  return broken;
}

export const palisadeFireCard: EventCardDef = {
  id: 'bulwark.palisade_fire',
  title: 'Palisade fire',
  description: 'Fire runs along the palisades: each loses 1 or 2 durability. Stone does not burn.',
  pack: 'bulwark',
  icon: 'bolt',
  apply(ctx) {
    if (!addonOn(ctx.reg, 'bulwark.wall_decay')) return;
    palisadeFire(ctx);
  }
};

/** May `pid` repair this wall (a damaged palisade of a zone they have a building in)? */
function repairable(ctx: Ctx, pid: Id, edgeId: number): string | null {
  const { g, reg } = ctx;
  if (!Number.isInteger(edgeId) || g.board.edges[edgeId]?.piece?.type !== WALL) return 'Choose a palisade';
  const hp = getPieceDurability(g, reg, 'edge', edgeId) ?? PALISADE_DURABILITY;
  if (hp >= PALISADE_DURABILITY) return 'That palisade is not damaged';
  if (!g.ext?.bulwark || !zonesOfWall(g, bulwarkState(g), edgeId).some(z => hasBuildingIn(g, z, pid))) return 'Repair the walls of a zone you have a building in';
  return null;
}

/** Repair a palisade back to full for 1 wood. Payload `{ edgeId }`. */
export const repairWallAction: ActionDef = {
  type: REPAIR_WALL,
  validate(ctx: Ctx, pid: Id, payload: any): string | null {
    const p = getPlayer(ctx.g, pid);
    if (!p) return 'Unknown player';
    const why = repairable(ctx, pid, Number(payload?.edgeId));
    if (why) return why;
    if (!canAfford(p, REPAIR_COST)) return 'A repair costs 1 wood';
    return null;
  },
  apply(ctx: Ctx, pid: Id, payload: any): void {
    const p = getPlayer(ctx.g, pid)!;
    payToBank(ctx, p, REPAIR_COST);
    setPieceDurability(ctx.g, 'edge', Number(payload.edgeId), PALISADE_DURABILITY);
    ctx.log(`🔨 ${p.avatar} ${p.name} repaired a palisade`, p.color);
    ctx.emit('wallRepaired', { playerId: pid, edgeId: Number(payload.edgeId) });
  },
  legal(ctx: Ctx, pid: Id) {
    return palisades(ctx.g).filter(eid => repairable(ctx, pid, eid) === null).map(edgeId => ({ edgeId }));
  },
  visual: {
    slot: 'edge',
    spotKey: 'edgeId',
    button: { label: 'Repair', icon: '<path d="M14 6l4 4-9 9H5v-4z"/><path d="M13 7l4 4"/>', order: 47 },
    hints: { noSupply: '', cannotAfford: 'A repair costs 1 wood', noSpots: 'No damaged palisade in a zone of yours' }
  },
  price: () => REPAIR_COST
} as ActionDef;

/** Bots repair a palisade of their zones once it is down to 1 (one more hit breaks it). */
export const repairBotGoal: BotGoalDef = {
  id: 'bulwark.wall_decay',
  goalClass: 'generic',
  goals(ctx: Ctx, pid: Id): BotGoalItem[] {
    const { g, reg } = ctx;
    const out: BotGoalItem[] = [];
    for (const eid of palisades(g)) {
      if ((getPieceDurability(g, reg, 'edge', eid) ?? PALISADE_DURABILITY) > 1) continue;
      if (repairable(ctx, pid, eid) !== null) continue;
      out.push({ id: `bulwark.repair:${eid}`, priority: 65, cost: REPAIR_COST, action: { type: REPAIR_WALL, payload: { edgeId: eid } } });
      break;
    }
    return out;
  }
};

export const wallDecayAddon: AddonDef = {
  id: 'bulwark.wall_decay',
  name: 'Wall decay',
  description: 'Palisades have 3 durability: a 7 takes 1, a flooded tile next to one rots 1 a round, fire takes 1 to 2. At 0 the zone opens. Repair: 1 wood.',
  deps: ['bulwark.walls'],
  links: [
    { target: 'durability', kind: 'mechanic' },
    { target: 'seven-resolver', kind: 'mechanic' },
    { target: 'round-clock', kind: 'mechanic' },
    { target: 'event-deck', kind: 'content' },
    { target: 'bot-goals', kind: 'bot' }
  ],
  register(api) {
    api.define(DURABILITY_DEFS, { id: 'bulwark.palisade', pieceId: WALL, maxDurability: PALISADE_DURABILITY, repairCost: REPAIR_COST });
    api.define(SEVEN_STEPS, palisadeDecayStep);
    api.define(EVENT_CARDS, palisadeFireCard);
    api.action(repairWallAction);
    api.phaseAction('main', REPAIR_WALL);
    api.define(BOT_GOALS, repairBotGoal);
    api.hook('onRoundStart', (ctx: Ctx) => {
      rotPalisades(ctx);
    });
  }
};
