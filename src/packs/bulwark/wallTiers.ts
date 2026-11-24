// MODULE: bulwark.wall_tiers addon (stone: a palisade upgrade for 2 brick + 1 ore that never decays or rots; only a player with a building inside one of its zones may upgrade it) | DEPENDS ON: packs/bulwark/constants, packs/bulwark/zones, shared/index | USED BY: packs/bulwark/addons.generated, packs/bulwark/index
import { DURABILITY_DEFS } from '../../shared';
import type { AddonDef, Ctx, Id, PieceDef } from '../../shared';
import { STONE_COST, STONE_WALL, WALL } from './constants';
import { bulwarkState, hasBuildingIn, zonesOfWall } from './zones';

/** Placement of stone: one of the walls of a zone you have a building in, still a palisade. */
export function canUpgradeToStone(ctx: Ctx, pid: Id, edgeId: number, mode: 'setup' | 'build'): boolean {
  if (mode !== 'build') return false;
  const { g } = ctx;
  if (g.board.edges[edgeId]?.piece?.type !== WALL || !g.ext?.bulwark) return false;
  return zonesOfWall(g, bulwarkState(g), edgeId).some(z => hasBuildingIn(g, z, pid));
}

export const stoneWallPiece: PieceDef = {
  id: STONE_WALL,
  name: 'Stone wall',
  target: 'edge',
  cost: STONE_COST,
  vp: 0,
  produces: 0,
  upgradeFrom: WALL,
  canPlace: canUpgradeToStone,
  visual: {
    slot: 'edge',
    button: {
      label: 'Stone',
      icon: '<rect x="3" y="7" width="18" height="12" rx="1"/><path d="M3 13h18M9 7v6M15 13v6"/>',
      order: 46
    },
    hints: {
      noSupply: 'No stone left',
      cannotAfford: 'Stone costs 2 brick and 1 ore',
      noSpots: 'Upgrade a palisade of a zone you have a building in'
    },
    shape:
      '<rect x="-48" y="-7" width="96" height="14" rx="2" fill="#9a958c" stroke="#4d4a44" stroke-width="2"/>'
      + '<path d="M-48 0h96M-30 -7v7M-6 -7v7M18 -7v7M42 -7v7M-18 0v7M6 0v7M30 0v7" stroke="#4d4a44" stroke-width="1.4"/>'
  }
};

export const wallTiersAddon: AddonDef = {
  id: 'bulwark.wall_tiers',
  name: 'Stone walls',
  description: 'Upgrade a palisade to stone (2 brick + 1 ore). Stone never decays or rots.',
  deps: ['bulwark.walls'],
  links: [
    { target: 'durability', kind: 'mechanic' },
    { target: 'piece-cost', kind: 'mechanic' },
    { target: 'bulwark.walls', kind: 'content' }
  ],
  rules: { pieceLimits: { [STONE_WALL]: 99 } },
  register(api) {
    api.piece(stoneWallPiece);
    api.define(DURABILITY_DEFS, { id: 'bulwark.stone', pieceId: STONE_WALL, maxDurability: 99, repairCost: {}, permanent: true });
    api.hook('onBuild', (ctx: Ctx, def: PieceDef, _pid: Id, loc: number) => {
      // Stone keeps no palisade wear.
      if (def.id === STONE_WALL && ctx.g.ext?.core?.durability) delete ctx.g.ext.core.durability[`e:${loc}`];
    });
  }
};
