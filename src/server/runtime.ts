// MODULE: engine runtime for the server (registry, settings -> rules mapping, defaults) | DEPENDS ON: packs/index, packs/tidebound/index, server/types, shared/index | USED BY: server/bots/dialogue/context, server/bots/dialogue/index, server/bots/scheduler, server/bots/sim, server/debug, server/game, +7 more
import { allPacks } from '../packs';
import { RISING_SEA_DEFAULT_LEVEL, TIDE_DEFAULT_LEVEL } from '../packs/tidebound';
import { buildVisualManifest, createRegistry, mergeRules, registryFor, resolveAddons } from '../shared';
import type { Registry, Rules, VisualManifest } from '../shared';
import type { Room, Settings } from './types';

/** One registry for the whole process: every shipped pack, in load order. */
export const registry = createRegistry(allPacks);

/** Returns a registry configured for the active DLC/addon toggles on `rules` (or the shared base registry when no DLC is on). */
export function gameRegistry(rules?: Record<string, any>): Registry {
  if (rules?.dlc && typeof rules.dlc === 'object' && Object.values(rules.dlc).some(Boolean)) {
    return registryFor(allPacks, rules);
  }
  return registry;
}

/** The addon set a room's DLC and addon toggles turn on, as a stable string ('' = none, the plain registry). */
export function mapRegistryKey(s: Pick<Settings, 'dlc' | 'addons'>): string {
  return [...resolveAddons(allPacks, { dlc: s.dlc, addons: s.addons }).enabled].sort().join(',');
}

const MAP_REGISTRY_CACHE_MAX = 32;
const mapRegistries = new Map<string, Registry>();

/**
 * The registry the lobby builds its map and map menu from: the plain registry while no addon is on, otherwise base plus the
 * enabled addons (so an addon's map perks, shapes and styles exist only while its DLC and addon are on). Cached per addon set;
 * the cache is capped because a client can send any toggle combination.
 */
export function mapRegistryFor(s: Pick<Settings, 'dlc' | 'addons'>): Registry {
  const key = mapRegistryKey(s);
  if (!key) return registry;
  let reg = mapRegistries.get(key);
  if (!reg) {
    if (mapRegistries.size >= MAP_REGISTRY_CACHE_MAX) mapRegistries.clear();
    reg = registryFor(allPacks, { dlc: s.dlc, addons: s.addons });
    mapRegistries.set(key, reg);
  }
  return reg;
}

/**
 * The DLC and addon toggles that decide what a room's client may draw (R8.4): the game's own rules during a game, the lobby settings before it.
 * Both carry `dlc` and `addons`, so `mapRegistryKey` and `mapRegistryFor` accept either.
 */
export function visualToggles(room: Pick<Room, 'game' | 'settings'>): Pick<Settings, 'dlc' | 'addons'> {
  const src: any = room.game ? room.game.rules : room.settings;
  return { dlc: src?.dlc ?? {}, addons: src?.addons ?? {} };
}

/**
 * The visual manifest for an addon set: plain JSON, the same for every player in a game, `{ version: 1, pieces: [], overlays: [] }` when no enabled
 * addon registers a visual. Not cached: it is built when a socket's key changes (a join, a toggle, a rematch), which is rare, and a cache would
 * hold a stale copy if a test edits the registry.
 */
export function visualManifestFor(s: Pick<Settings, 'dlc' | 'addons'>): VisualManifest {
  return buildVisualManifest(mapRegistryFor(s));
}

export function defaultSettings(): Settings {
  return {
    boardRadius: 2,
    goldTiles: 0,
    desertTiles: 1,
    fogTiles: 0,
    vpToWin: 10,
    maxPlayers: 8,
    cardDiscardLimit: 7,
    bankResourcePerType: 19,
    devKnights: 14,
    devVp: 5,
    devRoadBuilding: 2,
    devYearOfPlenty: 2,
    devMonopoly: 2,
    maxSettlements: 5,
    maxCities: 4,
    maxRoads: 15,
    gameSpeed: 0.5,
    turnTimerSec: 0,
    turnIncrementSec: 0,
    tradeTimerSec: 20,
    mapSeed: '',
    mapSeedLocked: false,
    mapPicks: [],
    mapParams: {},
    dlc: {},
    addons: {},
    eventsOn: false,
    fateTokens: 2,
    techTreeOn: false,
    fairDice: false,
    tideLevel: TIDE_DEFAULT_LEVEL
  };
}

/** Bank and dev deck sizes of the standard 3-4 player game, the ones the lobby starts with. */
export const STANDARD_SUPPLY = { bankResourcePerType: 19, devKnights: 14, devVp: 5, devRoadBuilding: 2, devYearOfPlenty: 2, devMonopoly: 2 };
export const STANDARD_PIECES = { maxRoads: 15, maxSettlements: 5, maxCities: 4 };

/**
 * Piece limits (roads, settlements, cities) scaled to `vpToWin` (above standard 10 VP) and map size (`landHexes` above standard 19).
 * Base limits at 10 VP / 19 land hexes are 15 roads, 5 settlements, 4 cities. Pieces built above the base limits cost double.
 */
export function scaledPieces(vpToWin: number, landHexes = 19): typeof STANDARD_PIECES {
  const vpMult = Math.max(1, (Number(vpToWin) || 10) / 10);
  const h = Math.max(1, Number(landHexes) || 19);
  const mapMult = h <= 19 ? 1 : Math.sqrt(h / 19);
  const mult = vpMult * mapMult;
  return {
    maxRoads: Math.min(100, Math.ceil(STANDARD_PIECES.maxRoads * mult)),
    maxSettlements: Math.min(50, Math.ceil(STANDARD_PIECES.maxSettlements * mult)),
    maxCities: Math.min(50, Math.ceil(STANDARD_PIECES.maxCities * mult))
  };
}

/** Bigger tables get a bigger bank and dev deck (5-6 follows the real extension: 24 per resource, 34 dev cards). */
function supplyFor(players: number): typeof STANDARD_SUPPLY {
  if (players <= 4) return STANDARD_SUPPLY;
  if (players <= 6) return { bankResourcePerType: 24, devKnights: 20, devVp: 5, devRoadBuilding: 3, devYearOfPlenty: 3, devMonopoly: 3 };
  return { bankResourcePerType: 30, devKnights: 26, devVp: 5, devRoadBuilding: 4, devYearOfPlenty: 4, devMonopoly: 4 };
}

/**
 * Bank and dev deck for a table and a board. The table sets the floor (`supplyFor`). A board bigger than the standard 19 land
 * tiles raises it: the real 5-6 player extension has about 1.1 dev cards per land tile (34 on 30) and 24 bank cards per type,
 * so the bank is scaled at 0.8 per land tile and the deck at 1.2. Victory point cards stay at 5 until the deck is large.
 */
export function scaledSupply(players: number, landHexes: number): typeof STANDARD_SUPPLY {
  const byTable = supplyFor(players);
  const h = Math.max(1, Number(landHexes) || 19);
  const mapMult = h <= 19 ? 1 : Math.sqrt(h / 19);
  const bank = Math.min(999, Math.max(byTable.bankResourcePerType, Math.round(byTable.bankResourcePerType * mapMult), Math.round(h * 0.8)));
  const tableTotal = byTable.devKnights + byTable.devVp + byTable.devRoadBuilding + byTable.devYearOfPlenty + byTable.devMonopoly;
  const wantTotal = Math.max(Math.round(tableTotal * mapMult), Math.round(h * 1.2));
  if (wantTotal <= tableTotal) return { ...byTable, bankResourcePerType: bank };
  const each = Math.min(50, Math.max(byTable.devRoadBuilding, Math.round(wantTotal * 0.08)));
  const vp = Math.min(50, Math.max(5, Math.round(wantTotal * 0.14)));
  const knights = Math.min(100, Math.max(byTable.devKnights, wantTotal - vp - each * 3));
  return { bankResourcePerType: bank, devKnights: knights, devVp: vp, devRoadBuilding: each, devYearOfPlenty: each, devMonopoly: each };
}

/**
 * Settings for the game about to start. If the host left the bank, dev deck, or piece limits at the standard numbers,
 * they grow with the real player count, board size (`landHexes`, 0 = unknown), and `vpToWin`.
 * Anything the host changed is kept as is.
 */
export function settingsForPlayers(s: Settings, players: number, landHexes = 0): Settings {
  const untouchedSupply = (Object.keys(STANDARD_SUPPLY) as (keyof typeof STANDARD_SUPPLY)[]).every(k => s[k] === STANDARD_SUPPLY[k]);
  const untouchedPieces = (Object.keys(STANDARD_PIECES) as (keyof typeof STANDARD_PIECES)[]).every(k => s[k] === STANDARD_PIECES[k]);

  let next = s;
  if (untouchedSupply) {
    const sup = scaledSupply(players, landHexes);
    const sameSup = (Object.keys(STANDARD_SUPPLY) as (keyof typeof STANDARD_SUPPLY)[]).every(k => sup[k] === s[k]);
    if (!sameSup) next = { ...next, ...sup };
  }
  if (untouchedPieces && (s.vpToWin > 10 || (untouchedSupply && landHexes > 19))) {
    const pcs = scaledPieces(s.vpToWin, landHexes);
    const samePcs = (Object.keys(STANDARD_PIECES) as (keyof typeof STANDARD_PIECES)[]).every(k => pcs[k] === s[k]);
    if (!samePcs) next = { ...next, ...pcs };
  }
  return next;
}

/** Overrides handed to createGame (it merges them over the registry defaults). */
export function rulesFromSettings(s: Settings): Record<string, any> {
  const out: Record<string, any> = {
    boardRadius: s.boardRadius,
    vpToWin: s.vpToWin,
    maxPlayers: s.maxPlayers,
    discardLimit: s.cardDiscardLimit,
    bankPerResource: s.bankResourcePerType,
    tileCounts: { desert: s.desertTiles, gold: s.goldTiles },
    fogTiles: s.fogTiles ?? 0,
    devCounts: {
      knight: s.devKnights,
      vp: s.devVp,
      roadBuilding: s.devRoadBuilding,
      yearOfPlenty: s.devYearOfPlenty,
      monopoly: s.devMonopoly
    },
    pieceLimits: { road: s.maxRoads, settlement: s.maxSettlements, city: s.maxCities }
  };
  if (s.dlc && Object.keys(s.dlc).length > 0) out.dlc = { ...s.dlc };
  if (s.addons && Object.keys(s.addons).length > 0) out.addons = { ...s.addons };
  if (s.eventsOn) out.eventsOn = true;
  if (s.fateTokens !== undefined && (s.eventsOn || s.fateTokens !== 2)) out.fateTokens = s.fateTokens;
  // Off is the absence of the rule, so games without the tech tree or fair dice carry no new state.
  if (s.techTreeOn) out.techTreeOn = true;
  if (s.fairDice) out.fairDice = true;
  // The tide level and rising sea level are rules only while their addon is on and the host moved the slider off Medium.
  const enabledAddons = resolveAddons(allPacks, { dlc: s.dlc, addons: s.addons }).enabled;
  if (s.tideLevel !== undefined && s.tideLevel !== TIDE_DEFAULT_LEVEL && enabledAddons.has('tidebound.tides')) {
    out.tideLevel = s.tideLevel;
  }
  if (s.risingSeaLevel !== undefined && s.risingSeaLevel !== RISING_SEA_DEFAULT_LEVEL && enabledAddons.has('tidebound.rising_sea')) {
    out.risingSeaLevel = s.risingSeaLevel;
  }
  return out;
}

/** Full rules (registry defaults + settings), for generating a board outside createGame. */
export function fullRules(s: Settings): Rules {
  const r = rulesFromSettings(s);
  return mergeRules(gameRegistry(r).rules, r);
}
