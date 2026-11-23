// MODULE: rooms (registry of rooms, lobby roster, status, helpers over the engine game) | DEPENDS ON: server/bots/tiers, server/bots/trainingLog, server/lobby, server/runtime, server/turnClock, server/types, +1 more | USED BY: server/bots/scheduler, server/game, server/net, server/p2pHost, server/socket, server/view
import { AVATARS, PLAYER_COLORS } from '../shared';
import type { PlayerState } from '../shared';
import { generateLobbyMap } from './lobby';
import { defaultSettings } from './runtime';
import { clearTurnClock } from './turnClock';
import { DEFAULT_TIER, tierLabel } from './bots/tiers';
import type { TierId } from './bots/tiers';
import { rebindTrainingLogPlayerId } from './bots/trainingLog';
import type { LobbyPlayer, Room, RoomStatus } from './types';

export const rooms: Record<string, Room> = {};

export function createLobbyPlayer(id: string, name: string, index: number, isBot = false, tier: TierId = DEFAULT_TIER): LobbyPlayer {
  return {
    id,
    name,
    avatar: isBot ? '🤖' : AVATARS[index % AVATARS.length],
    color: PLAYER_COLORS[index % PLAYER_COLORS.length],
    isBot,
    difficulty: isBot ? tierLabel(tier) : null
  };
}

/** First avatar nobody in the lobby is using yet (falls back to the first one if all are taken). */
export function freeAvatar(room: Room): string {
  return AVATARS.find(a =>
    !room.lobbyPlayers.some(p => p.avatar === a) &&
    !(room.spectators || []).some(s => s.avatar === a)
  ) ?? AVATARS[0];
}

export function createRoom(hostId: string, hostName: string): Room {
  let code = '';
  do {
    code = Math.random().toString(36).substring(2, 7).toUpperCase();
  } while (rooms[code] || code.length < 5);

  const settings = defaultSettings();
  const { board, meta } = generateLobbyMap(settings);
  settings.mapSeed = meta.recipe.seed;
  const room: Room = {
    code,
    hostId,
    settings,
    lobbyPlayers: [createLobbyPlayer(hostId, hostName, 0, false)],
    spectators: [],
    board,
    mapMeta: meta,
    game: null,
    setup: true,
    lobbyLog: [{ text: `Lobby created. New bots are ${tierLabel(DEFAULT_TIER)}; pick a tier next to the Bot button.`, color: '#1565c0' }],
    chats: [{ sender: hostName, avatar: AVATARS[0], color: PLAYER_COLORS[0], text: 'Welcome! Customize the board or add bots to start.' }],
    fx: { lastRollHexIds: [], recentProductions: [], recentTransfers: [] },
    startedAt: null,
    finishedAt: null,
    clientTokens: {},
    disconnectedSeats: {}
  };
  rooms[code] = room;
  return room;
}

export function roomStatus(room: Room): RoomStatus {
  const g = room.game;
  if (!g) return 'LOBBY';
  if (g.phase === 'gameover') return 'GAMEOVER';
  if (g.phase === 'setup_settlement' || g.phase === 'setup_road') return 'SETUP';
  // A pick (gold) during setup keeps the status SETUP until the first turn begins.
  if (g.turnCount === 0) return 'SETUP';
  return 'PLAYING';
}

/** Lobby log before the game, the engine log during it. */
export function addLobbyLog(room: Room, text: string, color: string | null = null): void {
  room.lobbyLog.push({ text, color });
  if (room.lobbyLog.length > 80) room.lobbyLog.shift();
}

/** The people in the room: engine players during a game, the lobby roster before it. */
export function roster(room: Room): { id: string; name: string; isBot: boolean }[] {
  return room.game ? room.game.players : room.lobbyPlayers;
}

export function humanIds(room: Room): string[] {
  const ids = new Set<string>();
  for (const p of roster(room)) {
    if (!p.isBot) ids.add(p.id);
  }
  for (const s of room.spectators || []) {
    ids.add(s.id);
  }
  return [...ids];
}

export function enginePlayer(room: Room, id: string): PlayerState | undefined {
  return room.game?.players.find(p => p.id === id);
}

/**
 * Rebinds a player's seat from `oldId` to `newId` across lobby roster, active game state,
 * board pieces, awards, active trades, turn clocks, and AI training logs.
 */
export function rebindPlayerId(
  room: Room,
  oldId: string,
  newId: string,
  restoreName?: string,
  restoreAvatar?: string
): boolean {
  let found = false;

  if (room.hostId === oldId) {
    room.hostId = newId;
  }

  for (const lp of room.lobbyPlayers) {
    if (lp.id === oldId) {
      lp.id = newId;
      lp.isBot = false;
      lp.difficulty = null;
      if (restoreName) lp.name = restoreName;
      if (restoreAvatar) lp.avatar = restoreAvatar;
      found = true;
    }
  }

  for (const sp of room.spectators || []) {
    if (sp.id === oldId) {
      sp.id = newId;
      if (restoreName) sp.name = restoreName;
      if (restoreAvatar) sp.avatar = restoreAvatar;
      found = true;
    }
  }

  const g = room.game;
  if (g) {
    for (const p of g.players) {
      if (p.id === oldId) {
        p.id = newId;
        p.isBot = false;
        p.difficulty = null;
        if (restoreName) p.name = restoreName;
        else p.name = p.name.replace(/\s*\(Bot\)$/i, '');
        if (restoreAvatar) p.avatar = restoreAvatar;
        found = true;
      }
    }

    if (found) {
      for (const v of g.board.vertices) {
        if (v.piece && v.piece.owner === oldId) v.piece.owner = newId;
      }
      for (const e of g.board.edges) {
        if (e.piece && e.piece.owner === oldId) e.piece.owner = newId;
      }
      for (const k of Object.keys(g.awards)) {
        if (g.awards[k] === oldId) g.awards[k] = newId;
      }
      const trades = g.trades ?? (g.trade ? [g.trade] : []);
      for (const t of trades) {
        if (t.fromId === oldId) t.fromId = newId;
        if (t.responses && oldId in t.responses) {
          t.responses[newId] = t.responses[oldId];
          delete t.responses[oldId];
        }
      }
      if (g.winner && g.winner.id === oldId) {
        g.winner.id = newId;
        if (restoreName) g.winner.name = restoreName;
      }
      const core = g.ext?.core;
      if (core && typeof core === 'object') {
        if (core.techs && oldId in core.techs) {
          core.techs[newId] = core.techs[oldId];
          delete core.techs[oldId];
        }
        if (core.groundWork && oldId in core.groundWork) {
          core.groundWork[newId] = core.groundWork[oldId];
          delete core.groundWork[oldId];
        }
        if (core.portUpgrades && typeof core.portUpgrades === 'object') {
          for (const upg of Object.values(core.portUpgrades) as any[]) {
            if (upg && upg.by === oldId) upg.by = newId;
          }
        }
        if (core.eventDeck?.fateTokens && oldId in core.eventDeck.fateTokens) {
          core.eventDeck.fateTokens[newId] = core.eventDeck.fateTokens[oldId];
          delete core.eventDeck.fateTokens[oldId];
        }
      }
      rebindTrainingLogPlayerId(room.code, oldId, newId);
    }
  }

  if (room.turnClock && room.turnClock.playerId === oldId) {
    room.turnClock.playerId = newId;
  }

  for (const prod of room.fx.recentProductions) {
    if (prod.playerId === oldId) prod.playerId = newId;
  }
  for (const tr of room.fx.recentTransfers) {
    if (tr.from === oldId) tr.from = newId;
    if (tr.to === oldId) tr.to = newId;
  }

  if (room.clientTokens) {
    for (const [token, pid] of Object.entries(room.clientTokens)) {
      if (pid === oldId) room.clientTokens[token] = newId;
    }
  }

  return found;
}

export function clearBotTimers(room: Room): void {
  if (room.botTimer) clearTimeout(room.botTimer);
  if (room.tradeTimer) clearTimeout(room.tradeTimer);
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  if (room.tradeTimers) {
    for (const entry of room.tradeTimers.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    room.tradeTimers.clear();
  }
  room.botTimer = undefined;
  room.tradeTimer = undefined;
  room.cleanupTimer = undefined;
  room.tradeTimerFor = null;
  clearTurnClock(room);
}
