// MODULE: Bulwark ids and numbers (piece ids, action ids, prices, durability, tax rate, zone sizes; spec in Bulwark Design.md) | DEPENDS ON: shared/index | USED BY: packs/bulwark/castle, packs/bulwark/gatehouse, packs/bulwark/index, packs/bulwark/spawn, packs/bulwark/wallDecay, packs/bulwark/wallTiers, +2 more
import type { Resources } from '../../shared';

/** Piece ids. A palisade is the plain wall; stone is its upgrade. */
export const CASTLE = 'castle';
export const WALL = 'wall';
export const STONE_WALL = 'stone_wall';

/** Action ids. */
export const REPAIR_WALL = 'repair_wall';
export const BUILD_GATE = 'build_gate';
export const TOGGLE_GATE = 'toggle_gate';
export const SET_PERMIT = 'set_permit';

/** Castle: a city upgrade. 1 of each resource + 1 wheat + 2 ore + 1 brick (9 cards). */
export const CASTLE_COST: Resources = { wood: 1, brick: 2, sheep: 1, wheat: 2, ore: 3 };
export const CASTLE_VP = 3;
export const CASTLE_PRODUCES = 4;
/** Castles before the doubled price, and the supply. */
export const CASTLE_BASE_LIMIT = 2;
export const CASTLE_SUPPLY = 4;

/** Palisade price, the number before the doubled price, and the supply (both scale with the map). */
export const WALL_COST: Resources = { wood: 1, brick: 1 };
export const WALL_BASE_LIMIT = 12;
export const WALL_SUPPLY = 24;
/** Stone upgrade price. Stone never decays or rots. */
export const STONE_COST: Resources = { brick: 2, ore: 1 };
/** Palisade durability, and the repair price (back to full). */
export const PALISADE_DURABILITY = 3;
export const REPAIR_COST: Resources = { wood: 1 };
/** Gate price. */
export const GATE_COST: Resources = { brick: 2, ore: 1 };

/** Tax: 30% of what a guest produces inside a zone, kept as a meter in twentieths (6/20 = 0.3; a rival's castle pays half, 3/20). */
export const TAX_UNITS = 20;
export const TAX_PER_CARD = 6;
export const TAX_PER_CARD_CASTLE = 3;

/** Map spawn: no walls below this radius; zone count and size grow with the radius. */
export const WALL_MIN_RADIUS = 4;
export const ZONE_MIN_TILES = 3;
/** Land tiles a player-built ring must hold to count as a zone. */
export const NEW_ZONE_MIN_TILES = 3;

/** Neutral owner of the walls the map spawns (nobody built them). Not empty: the client skips edge pieces with a falsy owner. Never a player id. */
export const NO_OWNER = '~wall';
