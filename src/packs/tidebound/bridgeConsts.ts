// MODULE: tidebound bridge constants (leaf module with no imports, so bridges.ts and ricketyBridges.ts can both read them at load time without a circular-import hole) | DEPENDS ON: shared/index | USED BY: packs/tidebound/bridgeCore, packs/tidebound/bridges, packs/tidebound/ricketyBridges, packs/tidebound/tech
import type { Resources } from '../../shared';

export const BRIDGE = 'bridge';
export const BRIDGE_BASE_LIMIT = 10;
export const BRIDGE_COST: Resources = { wood: 1, brick: 1, ore: 1 };
