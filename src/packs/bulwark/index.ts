// MODULE: bulwark pack (DLC: castle, walls and zones with tax and rebellion, stone walls, wall decay and rot, gatehouse with permits, high ground; spec in Bulwark Design.md) | DEPENDS ON: packs/bulwark/addons.generated, packs/bulwark/castle, packs/bulwark/constants, packs/bulwark/gatehouse, packs/bulwark/highGround, packs/bulwark/spawn, +5 more | USED BY: packs/index
import { VIEW_DATA } from '../../shared';
import type { Pack, ViewDataDef } from '../../shared';
import { bulwarkAddons } from './addons.generated';

export * from './constants';
export { castleAddon, castleBotGoal, castlePiece, canUpgradeToCastle } from './castle';
export {
  bulwarkView,
  bulwarkViewData,
  canPlaceWall,
  peasantRevolt,
  peasantRevoltCard,
  placementBlocksFor,
  refreshZones,
  touchingWalls,
  wallPiece,
  wallsAddon,
  zonePlacementCheck,
  zonesBotGoal,
  zoneTaxStep
} from './walls';
export type { BulwarkView, ZoneView } from './walls';
export { canUpgradeToStone, stoneWallPiece, wallTiersAddon } from './wallTiers';
export { palisadeDecayStep, palisadeFire, palisadeFireCard, repairWallAction, rotPalisades, wallDecayAddon } from './wallDecay';
export { archFor, buildGateAction, gatehouseAddon, setPermitAction, toggleGateAction } from './gatehouse';
export { highGroundAddon } from './highGround';
export { pipsOf, planZones, raiseSpawnedWalls, wallCount, zoneCountFor, zoneSizeFor } from './spawn';
export {
  archEdges,
  bulwarkState,
  enclosedGroups,
  gateRoadBreak,
  hasBuildingIn,
  interiorVertices,
  localVp,
  pendingZones,
  ringEdges,
  syncZones,
  wallCorners,
  zoneById,
  zonesOfWall
} from './zones';
export type { BulwarkState, GateRec, ZoneRec } from './zones';

/** `bulwark: null` while the DLC (or the walls addon) is off, so the client field is null rather than missing. */
const bulwarkViewDefaults: ViewDataDef = {
  id: 'bulwark.view_defaults',
  priority: -100,
  shared: () => ({ bulwark: null })
};

/**
 * Bulwark: castles, walled zones, tax and rebellion, stone, decay, gates, high ground.
 * Everything lives in addons (`rules.dlc.bulwark` is the master switch), so with the DLC off no content is registered (only the view default above).
 */
export const bulwarkPack: Pack = {
  id: 'bulwark',
  name: 'Bulwark',
  deps: ['base'],
  addons: bulwarkAddons,
  register(api) {
    api.define(VIEW_DATA, bulwarkViewDefaults);
  }
};
