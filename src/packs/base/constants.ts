// MODULE: ids and small maps shared inside the base pack | DEPENDS ON: none | USED BY: packs/base/actions/build, packs/base/actions/techActions, packs/base/building, packs/base/pieces, packs/base/placement, packs/base/ports, +11 more
export const ROAD = 'road';
export const SETTLEMENT = 'settlement';
export const CITY = 'city';

/** Base piece limits at the standard 10 VP setting. Pieces built beyond these limits cost double (`PieceDef.baseLimit`, shared/pricing.ts). */
export const BASE_PIECE_LIMITS: Record<string, number> = {
  [ROAD]: 15,
  [SETTLEMENT]: 5,
  [CITY]: 4
};

/** Port id of the generic 3:1 port. Resource ports use the resource id. */
export const GENERIC_PORT = '3:1';

/** During setup, the only piece that may be placed in each phase. */
export const SETUP_PIECE: Record<string, string> = {
  setup_settlement: SETTLEMENT,
  setup_road: ROAD
};
