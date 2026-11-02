// MODULE: tidebound pack (DLC: 8 addons with links; T1 sea tiles, T2 wide water + sea data, T3 bridges, T4 rickety bridges, T5a tides schedule, T5b spring tide, T5c tide level, T5d elevation, T5e idle ports, T6 tide view for the client, T7a fish token, T7b1 fishing nets, T7b2 net spots + net bot goal, T7c fish icon boosts, T7d tide replenish, T7e feed the sea, T8a harbor 1:1 upgrade, T8b 4 trades/turn + invalid-ratio prompt, T9 wrecks, T10 pirates, T11 tech tree nodes & gates, T12 rising sea lowest-elevation drowning & rate settings) | DEPENDS ON: packs/tidebound/addons.generated, packs/tidebound/bridges, packs/tidebound/fishing, packs/tidebound/harbor, packs/tidebound/pirates, packs/tidebound/ricketyBridges, +5 more | USED BY: packs/index, server/lobby, server/runtime
import { VIEW_DATA } from '../../shared';
import type { Pack, ViewDataDef } from '../../shared';
import { tideboundAddons } from './addons.generated';
import { portLevelsViewData } from './harbor';

export { tideboundAddons } from './addons.generated';
export {
  DROWNED,
  RISING_SEA_CADENCE_ROUNDS,
  RISING_SEA_DEFAULT_LEVEL,
  RISING_SEA_FIRST_ROUND,
  RISING_SEA_LEVELS,
  RISING_SEA_LEVEL_MAX,
  RISING_SEA_LEVEL_MIN,
  RISING_SEA_RNG_SALT,
  applyRisingSea,
  deriveRisingSeaRng,
  drownHex,
  ensureRisingSeaRng,
  isDrownedHex,
  isPortDrowned,
  isRisingSeaRound,
  lowestElevationFrontierHexIds,
  pickRisingSeaHex,
  risingSeaAddon,
  risingSeaBotGoal,
  risingSeaConfigOf,
  risingSeaFrontierHexIds,
  risingSeaLevelDef,
  risingSeaLevelOf,
  risingSeaOverlays,
  risingSeaViewData
} from './risingSea';
export type { RisingSeaLevelDef } from './risingSea';

export {
  BRIDGE,
  BRIDGE_BASE_LIMIT,
  BRIDGE_COST,
  DEMOLISH_BRIDGE,
  bridgeBotGoal,
  bridgeDemolishRefund,
  bridgePaidResources,
  bridgePiece,
  bridgesAddon,
  canDemolishBridge,
  canPlaceBridge,
  demolishBridgeAction,
  isOceanEdge
} from './bridges';

export {
  HARBOR_BOT_SPARE,
  HARBOR_COST,
  HARBOR_LEVEL,
  HARBOR_LIMIT,
  HARBOR_MAX_TRADES,
  HARBOR_UPGRADE_ID,
  TECH_HARBOR_EMPIRE,
  TECH_HARBOR_MASTER,
  UPGRADE_HARBOR,
  canUpgradeHarbor,
  harborAddon,
  harborBotGoal,
  harborCandidateVertices,
  harborClientView,
  harborCount,
  harborCovers,
  harborIdleExemption,
  harborLimitFor,
  harborRatioMod,
  harborSpotsView,
  harborTradesLeft,
  harborTradesLeftAt,
  harborTradesLeftForResource,
  harborTradesUsedAt,
  harborUpgradeCost,
  harborsOf,
  isHarbor,
  resetHarborTrades,
  upgradeHarborAction
} from './harbor';
export type { HarborTurnTrades } from './harbor';

export {
  FEED_BOT_SPARE,
  FEED_SEA,
  FEED_SEA_COST,
  FISH,
  FISH_ICON_MULTIPLIER,
  FISH_REPLENISH_CHANCE,
  NET,
  NET_BASE_LIMIT,
  NET_BOOSTED_CHANCE,
  NET_BOT_MAX,
  NET_CATCH_CHANCE,
  NET_COST,
  NET_WORKS_BOOSTED_CHANCE,
  NET_WORKS_CATCH_CHANCE,
  NET_WORKS_SAVE_BOOST_CHANCE,
  PLACE_NET,
  SPEND_FISH,
  TECH_FISHING_NETS,
  TECH_NET_WORKS,
  canPlaceNet,
  feedSeaAction,
  feedSpotsView,
  feedableHexIds,
  fishBotGoal,
  fishClientView,
  fishLeft,
  fishToken,
  fishingAddon,
  isSeaHex,
  migrateVertexNets,
  netBotGoal,
  netCatchOnRoll,
  netLimit,
  netPrice,
  netSeaHexIds,
  netSpotHexIds,
  netSpotsView,
  netWorksCostMod,
  netsLeft,
  netsOf,
  placeNetAction,
  replenishFish,
  seaHexIdsAt,
  spendFishAction,
  tideReachOnSea
} from './fishing';

export {
  RICKETY,
  RICKETY_COST,
  RICKETY_HEALTH,
  RICKETY_SEVEN_STEP_ID,
  RICKETY_TECH_CAP_BONUS,
  RICKETY_UPGRADE_COST,
  RICKETY_UPGRADE_ID,
  TECH_RICKETY_BRIDGES,
  UPGRADE_BRIDGE,
  bridgeUpgradeView,
  bridgesOnBoard,
  canPlaceRicketyBridge,
  effectiveBridgeBaseLimit,
  effectiveBridgeSupplyCap,
  ricketyBotGoal,
  ricketyBridgesAddon,
  ricketyCollapseStep,
  ricketyDurability,
  ricketyPiece,
  ricketyPoolCostMod,
  syncBridgePool,
  upgradeBridgeAction,
  upgradeBridgeCost
} from './ricketyBridges';

export {
  GRAND_CAUSEWAY_BONUS_VP,
  GRAND_CAUSEWAY_VP,
  HARBOR_EMPIRE_RNG_SALT,
  TECH_GRAND_CAUSEWAY,
  TECH_HARBOR_CHARTERS,
  TIDEBOUND_TECH_DEFS,
  deriveHarborEmpireRng,
  grandCausewayBonusVp,
  grandCausewayVpHook,
  grantHarborEmpireCards,
  harborEmpireGrantCount,
  longestRoadHasBridge,
  registerTideboundTechs,
  techGate
} from './tech';

export {
  FLOODED,
  TIDE_DEFAULT_LEVEL,
  TIDE_FIRST_ROUND,
  TIDE_LEVELS,
  TIDE_LEVEL_MAX,
  TIDE_LEVEL_MIN,
  TIDE_PERIOD,
  TIDE_CLUSTER_SIZE,
  TIDE_SPRING_EVERY,
  applyTides,
  buildTideClusters,
  coastHexIds,
  deriveTideRng,
  ensureTides,
  floodDepthAt,
  floodOverlayKind,
  floodPlan,
  floodWarnOverlayKind,
  hexElevation,
  isFloodedAt,
  isPortFlooded,
  isSpringTide,
  tideClientView,
  tideFloodShareForHex,
  tideLevelDef,
  tideLevelOf,
  tideStrengthAt,
  tideWarning,
  tidesAddon,
  tidesBotGoal
} from './tides';
export type { TideClientView, TideCluster, TideLevelDef, TideState, TideWarning } from './tides';

export {
  DRIVE_OFF_PIRATE,
  PIRATE_AVOID_RADIUS,
  PIRATE_BASE_STRENGTH,
  PIRATE_CADENCE_ROUNDS,
  PIRATE_CREW_KNIGHT_DISCOUNT,
  PIRATE_CREW_LOOT_MULT,
  PIRATE_EVENT_ID,
  PIRATE_FIRST_ROUND,
  PIRATE_FLEE_BASE,
  PIRATE_FLEE_CLOSE_STEP,
  PIRATE_FLEE_DISTANCE,
  PIRATE_FLEE_MAX,
  PIRATE_FLEE_ROB_STEP,
  PIRATE_FLEE_STEPS,
  PIRATE_GROWTH_ROUNDS,
  PIRATE_LOOT_BASE,
  PIRATE_MARKER_KIND,
  PIRATE_MAX,
  PIRATE_MAX_STRENGTH,
  PIRATE_ROB_CARDS,
  TECH_PIRATE_HUNTER,
  activePirates,
  canDrivePirate,
  derivePirateRng,
  drivablePirateHexIds,
  driveOffPirateAction,
  ensurePirateRng,
  guardedVertices,
  hexVertexDistance,
  isGuardedHex,
  passivePirateSpawn,
  pirateAt,
  pirateBotGoal,
  pirateClientView,
  pirateContactVertices,
  pirateDriveView,
  pirateKnights,
  pirateKnightsNeeded,
  pirateLootCards,
  pirateRaidCard,
  pirateRoundStep,
  pirateSpawnCandidates,
  pirateStrengthAt,
  piratesAddon,
  seaNeighborIds,
  spawnPirate
} from './pirates';
export type { PirateClientItem, PirateMode, PiratePayload } from './pirates';

export {
  SALVAGE_CREW_LOOT_MULT,
  STORM_CADENCE_ROUNDS,
  STORM_EVENT_ID,
  STORM_FIRST_ROUND,
  TECH_SALVAGE_CREW,
  WRECK_COUNTDOWN_ROUNDS,
  WRECK_MARKER_KIND,
  WRECK_MAX_PLAYER_DIST,
  WRECK_MAX_TIME_BOOST,
  WRECK_SCALE_TURNS,
  WRECK_SEA_CHANCE,
  WRECK_SEA_DEV_CHANCE,
  WRECK_SEA_DEV_TECH_CHANCE,
  WRECK_SEA_FISH_CHANCE,
  WRECK_SEA_MAX_CARDS,
  WRECK_SEA_MIN_CARDS,
  WRECK_SHORE_MAX_CARDS,
  WRECK_SHORE_MIN_CARDS,
  activeWrecks,
  claimWreck,
  computeWreckLootCount,
  deriveWreckRng,
  edgesOfHex,
  ensureWreckRng,
  expectedWreckLootValue,
  isWreckSeaHex,
  isWreckShoreHex,
  minPlayerDistanceToHex,
  pickWreckHex,
  playerHexDistance,
  playerTouchesWreck,
  shoreSeaDirection,
  spawnStormWreck,
  spawnWreckAt,
  stormEventCard,
  touchingPlayersOfWreck,
  verticesOfHex,
  wreckBotGoal,
  wreckCandidates,
  wreckClientView,
  wreckRoundBonus,
  wreckTimeMultiplier,
  wrecksAddon
} from './wrecks';
export type { WreckBonus, WreckClaimResult, WreckClientItem, WreckPayload, WreckSite } from './wrecks';

/**
 * Always-on view defaults (R7a.5, trap 1). A public field of the client state is `null` when its addon is off, but an entry registered inside an
 * addon does not exist while that addon is off, so the field would be missing instead of null. This entry is registered in the pack's own `register`
 * (it runs with every game, DLC on or off) at a priority below every addon entry; the merge is first-wins, so an addon's entry overrides it.
 * Each group that moves into VIEW_DATA adds its field here as `null`.
 */
const tideboundViewDefaults: ViewDataDef = {
  id: 'tidebound.view_defaults',
  priority: -100,
  shared: () => ({ fishIcons: null, wrecks: null, pirates: null, tide: null })
};

/**
 * Tidebound: sea, bridges, tides, harbors, fishing, wrecks and pirates.
 * Everything lives in addons (`rules.dlc.tidebound` is the master switch), so with the DLC off no content is registered (only the view defaults above).
 * Addon order matters: a dependency must be declared before the addon that needs it.
 */
export const tideboundPack: Pack = {
  id: 'tidebound',
  name: 'Tidebound',
  deps: ['base'],
  addons: tideboundAddons,
  register(api) {
    api.define(VIEW_DATA, tideboundViewDefaults);
    // Always on, not in an addon: `portLevels` was never gated by the Harbor addon (see `portLevelsViewData`).
    api.define(VIEW_DATA, portLevelsViewData);
  }
};
