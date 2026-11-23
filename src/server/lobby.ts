// MODULE: lobby board tools (generate from a recipe, quick starts, settings merge, paint terrain/numbers/robber/ports) on the engine board | DEPENDS ON: packs/tidebound/index, server/bots/dialogue/events, server/runtime, server/types, server/util, shared/index | USED BY: server/game, server/presets, server/rooms, server/socket
import {
  REAL_NUMBER_POOL, SHARE_PREFIX, buildTopology, cleanSeed, createRng, decodeRecipe, generateBoard, generateMap, hexDistance,
  isKnownMapId, randomSeed, resolveMapOptions, resolveParams, resolvePicks
} from '../shared';
import type { Board, HexInit } from '../shared';
import {
  RISING_SEA_DEFAULT_LEVEL,
  RISING_SEA_LEVEL_MAX,
  RISING_SEA_LEVEL_MIN,
  TIDE_DEFAULT_LEVEL,
  TIDE_LEVEL_MAX,
  TIDE_LEVEL_MIN
} from '../packs/tidebound';
import { normalizeBotChat } from './bots/dialogue/events';
import { STANDARD_PIECES, STANDARD_SUPPLY, fullRules, mapRegistryFor, registry, scaledPieces, scaledSupply } from './runtime';
import type { MapMeta, Room, Settings } from './types';
import { clamp } from './util';

const NUMBERS = REAL_NUMBER_POOL;

const isLand = (type: string): boolean => !!registry.tiles.get(type)?.land;

export function countLandHexes(board?: Board | null): number {
  if (!board?.hexes) return 19;
  return Math.max(1, board.hexes.filter(h => isLand(h.type)).length);
}

/**
 * Keeps bank resources, dev card counts, and build limits (roads, settlements, cities) scaled to the board's
 * land hex count, player count, and `vpToWin` whenever the host has not manually overridden a given field.
 */
export function syncSettingsToBoard(
  room: Pick<Room, 'settings' | 'board'> & Partial<Pick<Room, 'lobbyPlayers'>>,
  prevLandHexes?: number,
  prevVp?: number,
  prevPlayers?: number
): void {
  const s = room.settings;
  const curLand = countLandHexes(room.board);
  const oldLand = prevLandHexes ?? curLand;
  const curPlayers = Math.max(2, room.lobbyPlayers?.length || 4);
  const oldPlayers = prevPlayers ?? curPlayers;
  const oldVp = prevVp ?? s.vpToWin;

  const prevSup = scaledSupply(oldPlayers, oldLand);
  const prevSup4 = scaledSupply(4, oldLand);
  const nextSup = scaledSupply(curPlayers, curLand);

  const supplyKeys = Object.keys(STANDARD_SUPPLY) as (keyof typeof STANDARD_SUPPLY)[];
  for (const k of supplyKeys) {
    if (s[k] === STANDARD_SUPPLY[k] || s[k] === prevSup[k] || s[k] === prevSup4[k]) {
      s[k] = nextSup[k];
    }
  }

  const prevPcs = scaledPieces(oldVp, oldLand);
  const prevPcs19 = scaledPieces(oldVp, 19);
  const nextPcs = scaledPieces(s.vpToWin, curLand);

  const pieceKeys = Object.keys(STANDARD_PIECES) as (keyof typeof STANDARD_PIECES)[];
  for (const k of pieceKeys) {
    if (s[k] === STANDARD_PIECES[k] || s[k] === prevPcs[k] || s[k] === prevPcs19[k]) {
      s[k] = nextPcs[k];
    }
  }
}

// ---- Map from a recipe --------------------------------------------------------------------------------------

/**
 * The lobby map for these settings: seed, radius, picks and params become a recipe. An empty seed rolls a fresh one (read it from `meta.recipe`).
 * It is built from the room's DLC-aware registry (`mapRegistryFor`), so an addon's map perk works only while its DLC and addon are on.
 */
export function generateLobbyMap(settings: Settings): { board: Board; meta: MapMeta } {
  const res = generateMap(mapRegistryFor(settings), fullRules(settings), {
    seed: settings.mapSeed ?? '',
    radius: settings.boardRadius,
    picks: settings.mapPicks ?? [],
    params: settings.mapParams ?? {}
  });
  return { board: res.board, meta: { recipe: res.recipe, report: res.report, edited: false } };
}

/** An all-water canvas for the painter (the Blank quick start). */
function blankBoard(settings: Settings): Board {
  return generateBoard(registry, fullRules(settings), createRng(randomSeed()), 'blank');
}

/**
 * A new board. Without `preset` it follows the settings' recipe (the seed in `mapSeed`; empty rolls a fresh one).
 * With a quick start id it applies that recipe with a fresh seed. Other preset ids use the legacy generator (Archipelago, until M3).
 */
export function newBoard(settings: Settings, preset?: string): Board {
  if (!preset) return generateLobbyMap(settings).board;
  const reg = mapRegistryFor(settings);
  const quick = reg.quickStarts.get(preset);
  if (quick?.blank) return blankBoard(settings);
  if (quick) {
    const picks = resolvePicks(reg, quick.picks).picks;
    return generateLobbyMap({ ...settings, mapSeed: '', mapPicks: picks, mapParams: quick.params ?? {} }).board;
  }
  return generateBoard(registry, fullRules(settings), createRng(randomSeed()), preset);
}

/** Rebuilds the room's lobby board from its settings and stores the seed that was used (so a rolled seed is never lost). */
export function refreshMap(room: Pick<Room, 'settings' | 'board' | 'mapMeta'> & Partial<Pick<Room, 'lobbyPlayers'>>): void {
  const prevLand = countLandHexes(room.board);
  const { board, meta } = generateLobbyMap(room.settings);
  room.settings.mapSeed = meta.recipe.seed;
  room.board = board;
  room.mapMeta = meta;
  syncSettingsToBoard(room, prevLand);
}

/**
 * A preset chip. Quick starts set the picks and params and roll a new seed; Blank is the special all-water canvas;
 * a legacy preset (Archipelago, until the M3 shape replaces it) draws a one-off board and clears the picks.
 */
export function applyMapStart(room: Pick<Room, 'settings' | 'board' | 'mapMeta'> & Partial<Pick<Room, 'lobbyPlayers'>>, id: string): void {
  const prevLand = countLandHexes(room.board);
  const reg = mapRegistryFor(room.settings);
  const quick = reg.quickStarts.get(id);
  room.settings.boardRadius = id === 'standard' ? 2 : 5;
  if (quick) {
    room.settings.mapPicks = resolvePicks(reg, quick.picks).picks;
    room.settings.mapParams = { ...(quick.params ?? {}) };
    room.settings.mapSeed = '';
    if (quick.blank) {
      room.board = blankBoard(room.settings);
      room.mapMeta = undefined;
      return;
    }
    refreshMap(room);
    syncSettingsToBoard(room, prevLand);
    return;
  }
  room.settings.mapPicks = [];
  room.settings.mapParams = {};
  room.board = generateBoard(registry, fullRules(room.settings), createRng(randomSeed()), id);
  room.mapMeta = undefined;
  syncSettingsToBoard(room, prevLand);
}

/**
 * "New seed" on a saved preset: apply its style (radius, picks, params) and roll a fresh seed, so the host gets the same kind of map
 * again. Picks and params go through the same validation as every other client message.
 */
export function applyRecipeStyle(
  room: Pick<Room, 'settings' | 'board' | 'mapMeta'> & Partial<Pick<Room, 'lobbyPlayers'>>,
  style: { radius: number; picks: string[]; params: Record<string, number> }
): void {
  const prevLand = countLandHexes(room.board);
  room.settings = mergeSettings({ boardRadius: style.radius, mapPicks: style.picks, mapParams: style.params, mapSeed: '' }, room.settings);
  refreshMap(room);
  syncSettingsToBoard(room, prevLand);
}

/** What Tidebound is built for: islands with wide seas between them (the `wide_water` perk), on a board big enough to hold the water. */
export const TIDEBOUND_MAP_PICKS = ['islands', 'wide_water'];
export const TIDEBOUND_MAP_RADIUS = 7;

/**
 * The host just turned Tidebound on: move the map to its home ground. Picks are replaced (an empty list or a continent has no sea to widen),
 * the radius grows to `TIDEBOUND_MAP_RADIUS` if it is smaller (a bigger one the host chose is kept), and a fresh seed is rolled.
 * Picks go through the room's DLC-aware registry, so one the pack does not know is dropped, as for any other client message.
 */
export function applyTideboundMapDefaults(
  room: Pick<Room, 'settings' | 'board' | 'mapMeta'> & Partial<Pick<Room, 'lobbyPlayers'>>
): void {
  const reg = mapRegistryFor(room.settings);
  room.settings.mapPicks = resolvePicks(reg, TIDEBOUND_MAP_PICKS).picks;
  room.settings.mapParams = {};
  room.settings.boardRadius = Math.max(room.settings.boardRadius, TIDEBOUND_MAP_RADIUS);
  room.settings.mapSeed = '';
  room.settings.techTreeOn = true;
  refreshMap(room);
}

/** Everything that decides the lobby map. When this changes the board is rebuilt; other settings leave painted edits alone. */
export function recipeKey(s: Settings): string {
  const params = s.mapParams ?? {};
  return JSON.stringify([
    s.mapSeed ?? '', s.boardRadius, s.mapPicks ?? [],
    Object.keys(params).sort().map(k => [k, params[k]]),
    s.goldTiles, s.desertTiles, s.fogTiles ?? 0
  ]);
}

/** Smallest map radius that is comfortable for this many players (the default radius 2 fits 4). */
export function recommendedRadius(players: number): number {
  return players <= 4 ? 2 : players <= 6 ? 3 : 4;
}

/** Is this a quick start or legacy preset id? Pass the room's settings to include quick starts an enabled addon registers. */
export function isPreset(id: any, settings?: Pick<Settings, 'dlc' | 'addons'>): boolean {
  const reg = settings ? mapRegistryFor(settings) : registry;
  return typeof id === 'string' && (reg.quickStarts.has(id) || reg.presets.has(id));
}

// ---- Settings ---------------------------------------------------------------------------------------------------

/**
 * Clamps client-supplied settings to the allowed ranges. Anything missing or invalid keeps the old value.
 * Map picks go through the registry (unknown ids dropped, slots and conflicts resolved, params clamped).
 * A full share code in `mapSeed` applies the whole recipe (radius, picks, params, seed); `dropped` lists the ids it had that this server does not know.
 */
export function mergeSettingsDetailed(input: any, old: Settings): { settings: Settings; dropped: string[] } {
  const s = input ?? {};
  const dropped: string[] = [];
  const gameSpeed = old.gameSpeed ?? 0.5;

  // DLC and addon toggles come first: they decide which map picks and params exist (an addon's perk is known only while it is on).
  // Only expansions and addons registered in the shipped packs can be enabled.
  const dlc: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(old.dlc ?? {})) {
    if (registry.dlcs.has(k) && typeof v === 'boolean') dlc[k] = v;
  }
  if (s.dlc && typeof s.dlc === 'object' && !Array.isArray(s.dlc)) {
    let n = 0;
    for (const [k, v] of Object.entries(s.dlc)) {
      if (++n > 32) break;
      if (typeof k === 'string' && registry.dlcs.has(k) && typeof v === 'boolean') {
        dlc[k] = v;
      }
    }
  }

  const addons: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(old.addons ?? {})) {
    if (registry.addons.has(k) && typeof v === 'boolean') addons[k] = v;
  }
  if (s.addons && typeof s.addons === 'object' && !Array.isArray(s.addons)) {
    let n = 0;
    for (const [k, v] of Object.entries(s.addons)) {
      if (++n > 128) break;
      if (typeof k === 'string' && registry.addons.has(k) && typeof v === 'boolean') {
        addons[k] = v;
      }
    }
  }
  const reg = mapRegistryFor({ dlc, addons });

  let seedIn: any = s.mapSeed;
  let picksIn: any = s.mapPicks;
  let paramsIn: any = s.mapParams;
  let radiusIn: any = s.boardRadius;
  if (typeof seedIn === 'string' && seedIn.length <= 400 && seedIn.trim().startsWith(`${SHARE_PREFIX};`)) {
    const decoded = decodeRecipe(seedIn, id => isKnownMapId(reg, id));
    if (decoded) {
      seedIn = decoded.recipe.seed;
      picksIn = decoded.recipe.picks;
      paramsIn = decoded.recipe.params;
      radiusIn = decoded.recipe.radius;
      dropped.push(...decoded.dropped);
    }
  }

  const mapSeed = seedIn === undefined || seedIn === null ? (old.mapSeed ?? '') : cleanSeed(seedIn);
  const mapPicks = resolvePicks(reg, Array.isArray(picksIn) ? picksIn.slice(0, 32).map(String) : (old.mapPicks ?? [])).picks;
  const options = resolveMapOptions(reg, mapPicks).options;
  const mapParams = resolveParams(options, paramsIn && typeof paramsIn === 'object' && !Array.isArray(paramsIn) ? paramsIn : (old.mapParams ?? {}));

  const newVp = clamp(s.vpToWin, 3, 50, old.vpToWin);
  const prevAutoPieces = scaledPieces(old.vpToWin);
  const wasAutoPieces =
    old.maxRoads === prevAutoPieces.maxRoads &&
    old.maxSettlements === prevAutoPieces.maxSettlements &&
    old.maxCities === prevAutoPieces.maxCities;

  let maxSettlements = clamp(s.maxSettlements, 2, 50, old.maxSettlements);
  let maxCities = clamp(s.maxCities, 1, 50, old.maxCities);
  let maxRoads = clamp(s.maxRoads, 5, 100, old.maxRoads);

  if (
    newVp !== old.vpToWin &&
    wasAutoPieces &&
    maxRoads === prevAutoPieces.maxRoads &&
    maxSettlements === prevAutoPieces.maxSettlements &&
    maxCities === prevAutoPieces.maxCities
  ) {
    const nextPieces = scaledPieces(newVp);
    maxRoads = nextPieces.maxRoads;
    maxSettlements = nextPieces.maxSettlements;
    maxCities = nextPieces.maxCities;
  }

  const settings: Settings = {
    boardRadius: clamp(radiusIn, 1, 50, old.boardRadius),
    goldTiles: clamp(s.goldTiles, 0, 500, old.goldTiles),
    desertTiles: clamp(s.desertTiles, 0, 200, old.desertTiles),
    fogTiles: clamp(s.fogTiles, 0, 2000, old.fogTiles ?? 0),
    vpToWin: newVp,
    maxPlayers: clamp(s.maxPlayers, 2, 8, old.maxPlayers),
    cardDiscardLimit: clamp(s.cardDiscardLimit, 3, 50, old.cardDiscardLimit),
    bankResourcePerType: clamp(s.bankResourcePerType, 5, 999, old.bankResourcePerType),
    devKnights: clamp(s.devKnights, 0, 100, old.devKnights),
    devVp: clamp(s.devVp, 0, 50, old.devVp),
    devRoadBuilding: clamp(s.devRoadBuilding, 0, 50, old.devRoadBuilding),
    devYearOfPlenty: clamp(s.devYearOfPlenty, 0, 50, old.devYearOfPlenty),
    devMonopoly: clamp(s.devMonopoly, 0, 50, old.devMonopoly),
    maxSettlements,
    maxCities,
    maxRoads,
    gameSpeed,
    turnTimerSec: clamp(s.turnTimerSec, 0, 900, old.turnTimerSec ?? 0),
    turnIncrementSec: clamp(s.turnIncrementSec, 0, 120, old.turnIncrementSec ?? 0),
    tradeTimerSec: clamp(s.tradeTimerSec, 5, 300, old.tradeTimerSec ?? 20),
    botChat: normalizeBotChat(s.botChat, old.botChat),
    mapSeed,
    mapSeedLocked: typeof s.mapSeedLocked === 'boolean' ? s.mapSeedLocked : !!old.mapSeedLocked,
    mapPicks,
    mapParams,
    dlc,
    addons,
    eventsOn: typeof s.eventsOn === 'boolean' ? s.eventsOn : !!old.eventsOn,
    fateTokens: clamp(s.fateTokens, 0, 10, old.fateTokens ?? 2),
    techTreeOn: typeof s.techTreeOn === 'boolean' ? s.techTreeOn : !!old.techTreeOn,
    fairDice: typeof s.fairDice === 'boolean' ? s.fairDice : !!old.fairDice,
    tideLevel: clamp(s.tideLevel, TIDE_LEVEL_MIN, TIDE_LEVEL_MAX, old.tideLevel ?? TIDE_DEFAULT_LEVEL),
    ...(s.risingSeaLevel !== undefined || old.risingSeaLevel !== undefined
      ? { risingSeaLevel: clamp(s.risingSeaLevel, RISING_SEA_LEVEL_MIN, RISING_SEA_LEVEL_MAX, old.risingSeaLevel ?? RISING_SEA_DEFAULT_LEVEL) }
      : {})
  };
  return { settings, dropped };
}

export function mergeSettings(input: any, old: Settings): Settings {
  return mergeSettingsDetailed(input, old).settings;
}

// ---- Painting ---------------------------------------------------------------------------------------------------

function portsOf(board: Board): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of board.edges) if (e.port) out[e.key] = e.port;
  return out;
}

/** Recomputes the topology from the hexes, keeping the given ports. */
function rebuild(board: Board, ports: Record<string, string>): Board {
  const inits: HexInit[] = board.hexes.map(h => ({ q: h.q, r: h.r, type: h.type, number: h.number, ext: h.ext }));
  return buildTopology(inits, { ports, isLand, portMode: 'coast' });
}

function randomBaseTile(): string {
  const base = [...registry.tiles.values()].filter(t => t.base);
  return base[Math.floor(Math.random() * base.length)].id;
}

/** Terrain, number and robber painting. The client's values are validated against the registry. */
export function paintHex(board: Board, hexId: number, paintType: string, paintValue: any): Board {
  const hex = board.hexes[hexId];
  if (!hex) return board;

  if (paintType === 'terrain') {
    const value = String(paintValue);
    if (value === 'fog') {
      const def = registry.tiles.get(hex.type);
      if (!def || !def.land || !def.numbered) hex.type = randomBaseTile();
      if (!hex.number) hex.number = NUMBERS[Math.floor(Math.random() * NUMBERS.length)];
      hex.ext = { ...hex.ext, hidden: true, maskAs: 'fog' };
    } else {
      const def = registry.tiles.get(value);
      if (!def) return board;
      const ext = { ...hex.ext };
      delete ext.hidden;
      delete ext.maskAs;
      hex.ext = ext;
      hex.type = value;
      if (!def.land || !def.numbered) hex.number = null;
      else if (!hex.number) hex.number = 6;
    }
    return rebuild(board, portsOf(board));
  }

  if (paintType === 'number') {
    const def = registry.tiles.get(hex.type);
    if (def?.land && def.numbered) {
      if (paintValue === 'none') hex.number = null;
      else {
        const n = Number(paintValue);
        if (Number.isInteger(n) && n >= 2 && n <= 12) hex.number = n;
      }
    }
    return board;
  }

  if (paintType === 'robber') {
    if (isLand(hex.type) && !hex.ext.hidden) board.robberHexId = hex.id;
    return board;
  }
  return board;
}

/** Places or removes a port on a coastal edge. Neighbouring ports are dropped (no ports on adjacent tiles). */
export function paintPort(board: Board, edgeId: number, portValue: any): Board {
  const edge = board.edges[edgeId];
  if (!edge || edge.hexIds.length !== 1) return board;
  if (portValue !== 'none' && !registry.ports.has(portValue)) return board;

  const target = board.hexes[edge.hexIds[0]];
  const ports: Record<string, string> = {};
  for (const e of board.edges) {
    if (!e.port) continue;
    if (portValue !== 'none' && target && e.id !== edge.id && e.hexIds.length === 1) {
      const other = board.hexes[e.hexIds[0]];
      if (other && hexDistance(target, other) <= 1) continue;
    }
    ports[e.key] = e.port;
  }
  if (portValue === 'none') delete ports[edge.key];
  else ports[edge.key] = portValue;
  return rebuild(board, ports);
}
