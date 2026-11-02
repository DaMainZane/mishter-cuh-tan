// MODULE: socket handlers (lobby editing + game actions; every game action goes through engine dispatch) | DEPENDS ON: packs/base/constants, packs/base/robbing, server/bots/dialogue, server/bots/tiers, server/debug, server/game, +8 more | USED BY: server/main
import type { Server } from 'socket.io';
import { AVATARS, PLAYER_COLORS } from '../shared';
import { victimsOnHex } from '../packs/base/robbing';
import { CITY, ROAD, SETTLEMENT } from '../packs/base/constants';
import { clearBotTimers, createLobbyPlayer, createRoom, freeAvatar, humanIds, addLobbyLog, rebindPlayerId, rooms } from './rooms';
import { applyMapStart, applyRecipeStyle, applyTideboundMapDefaults, countLandHexes, isPreset, mergeSettingsDetailed, paintHex, paintPort, recipeKey, recommendedRadius, refreshMap, syncSettingsToBoard } from './lobby';
import { mapOptionsView } from './mapmenu';
import { applyLoadedPreset, loadPreset, presetStyle, serializePreset } from './presets';
import { rematch, runAction, startGame } from './game';
import { broadcastRoom } from './net';
import { registry } from './runtime';
import { DEFAULT_TIER, TAKEOVER_TIER, normalizeTier, tierLabel } from './bots/tiers';
import { reactToChat } from './bots/dialogue';
import { applyDebugCommand, auditGameState } from './debug';
import type { Room } from './types';

const BOT_NAMES = ['Breeze', 'Sonny', 'Jess', 'TupacShakur', 'IdrisElba', 'Cleopatra', 'Napoleon'];
const ROOM_DISCONNECT_TTL_MS = 10 * 60 * 1000;

function addSpectator(room: Room, socket: any, cleanName: string, cleanClientId: string, toastMsg?: string): void {
  room.spectators = room.spectators || [];
  if (
    room.lobbyPlayers.some(p => p.id === socket.id) ||
    room.game?.players.some(p => p.id === socket.id) ||
    room.spectators.some(s => s.id === socket.id)
  ) {
    socket.join(room.code);
    broadcastRoom(room);
    return;
  }

  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = undefined;
  }

  const avatar = freeAvatar(room);
  const color = PLAYER_COLORS[(room.lobbyPlayers.length + room.spectators.length) % PLAYER_COLORS.length];
  room.spectators.push({
    id: socket.id,
    name: cleanName,
    avatar,
    color
  });

  if (cleanClientId) {
    room.clientTokens = room.clientTokens || {};
    room.clientTokens[cleanClientId] = socket.id;
  }

  socket.join(room.code);
  if (room.game) {
    room.game.log.push({ text: `👁️ ${cleanName} is spectating the game`, color });
    if (room.game.log.length > 80) room.game.log.shift();
  } else {
    addLobbyLog(room, `👁️ ${avatar} ${cleanName} joined as spectator`, color);
  }
  if (toastMsg) {
    socket.emit('errorMsg', toastMsg);
  }
  broadcastRoom(room);
}

export function tryReclaimSeat(room: Room, socket: any, clientId?: string, name?: string): boolean {
  room.clientTokens = room.clientTokens || {};
  room.disconnectedSeats = room.disconnectedSeats || {};
  room.spectators = room.spectators || [];
  const cleanClientId = typeof clientId === 'string' ? clientId.trim().substring(0, 64) : '';
  const cleanName = typeof name === 'string' ? name.trim().substring(0, 16) : '';
  const lowerName = cleanName.toLowerCase();
  const disconnectedList = Object.values(room.disconnectedSeats);
  const playerSeats = disconnectedList.filter(s => !s.isSpectator);
  const specSeats = disconnectedList.filter(s => s.isSpectator);

  const matchFrom = (list: typeof disconnectedList) =>
    (cleanClientId && lowerName
      ? list.find(s => s.clientId === cleanClientId && s.originalName.toLowerCase() === lowerName)
      : undefined) ||
    (cleanClientId
      ? list.find(s => s.clientId === cleanClientId)
      : undefined) ||
    (lowerName
      ? list.find(s => s.originalName.toLowerCase() === lowerName)
      : undefined);

  let seatInfo = matchFrom(playerSeats);

  // Fallback: if a bot replacement seat exists in the active game for this clientId or nickname, reclaim it directly.
  if (!seatInfo && room.game) {
    const tokenPid = cleanClientId ? room.clientTokens[cleanClientId] : undefined;
    const botReplacement =
      (tokenPid ? room.game.players.find(p => p.id === tokenPid && p.isBot) : undefined) ||
      (lowerName
        ? room.game.players.find(
            p =>
              p.isBot &&
              (/\(Bot\)$/i.test(p.name) || p.id.startsWith('bot_spec_') || !BOT_NAMES.includes(p.name)) &&
              p.name.replace(/\s*\(Bot\)$/i, '').toLowerCase() === lowerName
          )
        : undefined);
    if (botReplacement) {
      seatInfo = {
        playerId: botReplacement.id,
        clientId: cleanClientId || undefined,
        originalName: botReplacement.name.replace(/\s*\(Bot\)$/i, ''),
        originalAvatar: botReplacement.avatar,
        wasHost: room.hostId === botReplacement.id,
        disconnectedAt: Date.now()
      };
    }
  }

  if (!seatInfo) {
    seatInfo = matchFrom(specSeats);
  }

  if (!seatInfo) return false;

  const targetOldId = seatInfo.playerId;
  const restoreName = seatInfo.originalName || (cleanName || undefined);
  const restoreAvatar = seatInfo.originalAvatar;
  const wasHost = seatInfo.wasHost ?? (room.hostId === targetOldId);

  if (seatInfo.isSpectator) {
    if (!room.spectators.some(s => s.id === socket.id)) {
      room.spectators.push({
        id: socket.id,
        name: restoreName || 'Spectator',
        avatar: restoreAvatar || freeAvatar(room),
        color: PLAYER_COLORS[(room.lobbyPlayers.length + room.spectators.length) % PLAYER_COLORS.length]
      });
    }
    delete room.disconnectedSeats[targetOldId];
    if (cleanClientId) {
      room.clientTokens[cleanClientId] = socket.id;
    }
    if (wasHost || !humanIds(room).includes(room.hostId)) {
      room.hostId = socket.id;
    }
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = undefined;
    }
    socket.join(room.code);
    socket.emit('reconnected', { code: room.code, name: restoreName || '' });
    broadcastRoom(room);
    return true;
  }

  if (!rebindPlayerId(room, targetOldId, socket.id, restoreName, restoreAvatar)) {
    return false;
  }

  // If the reconnecting player had been placed in spectators first, remove their spectator entry now that they reclaimed their player seat.
  room.spectators = room.spectators.filter(s => s.id !== socket.id && s.id !== targetOldId);

  delete room.disconnectedSeats[targetOldId];
  for (const [k, v] of Object.entries(room.disconnectedSeats)) {
    if (
      (cleanClientId && v.clientId === cleanClientId) ||
      (lowerName && v.originalName.toLowerCase() === lowerName)
    ) {
      delete room.disconnectedSeats[k];
    }
  }
  if (cleanClientId) {
    room.clientTokens[cleanClientId] = socket.id;
  }
  if (wasHost || !humanIds(room).includes(room.hostId)) {
    room.hostId = socket.id;
  }
  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = undefined;
  }
  if (room.botTimer) {
    clearTimeout(room.botTimer);
    room.botTimer = undefined;
  }

  socket.join(room.code);
  const p = room.game
    ? room.game.players.find(pl => pl.id === socket.id)
    : room.lobbyPlayers.find(pl => pl.id === socket.id);

  if (room.game && p) {
    room.game.log.push({ text: `🔌 ${p.name} reconnected and reclaimed their seat!`, color: p.color });
    if (room.game.log.length > 80) room.game.log.shift();
  } else if (p) {
    addLobbyLog(room, `🔌 ${p.avatar} ${p.name} reconnected to the lobby`, p.color);
  }

  socket.emit('reconnected', { code: room.code, name: p?.name || restoreName || '' });
  broadcastRoom(room);
  return true;
}

/** Once the table passes 4 and the map radius is below what that many players need, tell the lobby once per size. */
function noteCrowding(room: Room): void {
  const n = room.lobbyPlayers.length;
  const want = recommendedRadius(n);
  if (n <= 4 || room.settings.boardRadius >= want) return;
  addLobbyLog(room, `${n} players: map radius ${want}+ recommended (now ${room.settings.boardRadius}). Rules and cards tab, Map radius.`, null);
}

export function registerSocketHandlers(io: Server): void {
  io.on('connection', (socket) => {
    // The map menu is drawn from the registry's options, so the client gets the list once per connection and caches it.
    // In the lobby the server sends the room's own list again whenever its DLC/addon set changes (net.ts syncMapOptions).
    socket.data.mapOptionsKey = '';
    socket.emit('mapOptions', mapOptionsView());

    const safe = (fn: (data: any) => void) => (data: any = {}) => {
      try { fn(data); } catch (err) { console.error('Socket handler error:', err); }
    };

    /**
     * Runs one engine action for this socket's player and broadcasts the result.
     * `report` sends the engine's reason back to the player (used where the old server did too).
     */
    const act = (code: string, type: string, payload: any = {}, report = false): void => {
      const room = rooms[code];
      if (!room || !room.game) return;
      const res = runAction(room, socket.id, type, payload);
      if (!res.ok) {
        if (report) socket.emit('errorMsg', res.error);
        return;
      }
      broadcastRoom(room);
    };

    const hostLobbyRoom = (code: string) => {
      const room = rooms[code];
      return room && room.hostId === socket.id && !room.game ? room : null;
    };

    // ---- Lobby ------------------------------------------------------------

    socket.on('createRoom', safe(({ name, clientId, spectate }) => {
      const cleanName = String(name || '').trim().substring(0, 16);
      if (!cleanName) return socket.emit('errorMsg', 'Please enter a nickname first.');
      const room = createRoom(socket.id, cleanName);
      if (spectate) {
        const hostPlayer = room.lobbyPlayers.shift();
        if (hostPlayer) {
          room.spectators.push({
            id: hostPlayer.id,
            name: hostPlayer.name,
            avatar: hostPlayer.avatar,
            color: hostPlayer.color
          });
          addLobbyLog(room, `👁️ ${hostPlayer.avatar} ${cleanName} is hosting as spectator`, hostPlayer.color);
        }
      }
      const cleanClientId = typeof clientId === 'string' ? clientId.trim().substring(0, 64) : '';
      if (cleanClientId) {
        room.clientTokens = room.clientTokens || {};
        room.clientTokens[cleanClientId] = socket.id;
      }
      socket.join(room.code);
      broadcastRoom(room);
    }));

    socket.on('joinRoom', safe(({ code, name, clientId, spectate }) => {
      const cleanCode = (code || '').trim().toUpperCase();
      const cleanName = String(name || '').trim().substring(0, 16);
      if (!cleanName) return socket.emit('errorMsg', 'Please enter a nickname first.');
      const cleanClientId = typeof clientId === 'string' ? clientId.trim().substring(0, 64) : '';

      if (spectate) {
        const targetRoom = cleanCode
          ? rooms[cleanCode]
          : Object.values(rooms).reverse()[0];
        if (!targetRoom) {
          return socket.emit('errorMsg', cleanCode ? 'Room not found!' : 'No open game or lobby to spectate.');
        }
        return addSpectator(targetRoom, socket, cleanName, cleanClientId);
      }

      const lowerName = cleanName.toLowerCase();
      const candidateRoom = cleanCode
        ? rooms[cleanCode]
        : (Object.values(rooms).reverse().find(r =>
            Object.values(r.disconnectedSeats || {}).some(s =>
              !s.isSpectator &&
              ((cleanClientId && s.clientId === cleanClientId) || (lowerName && s.originalName.toLowerCase() === lowerName))
            ) ||
            r.game?.players.some(
              p => p.isBot && /\(Bot\)$/i.test(p.name) && p.name.replace(/\s*\(Bot\)$/i, '').toLowerCase() === lowerName
            )
          ) ??
          Object.values(rooms).reverse().find(r => !r.game && !r.setup && r.lobbyPlayers.length < r.settings.maxPlayers) ??
          Object.values(rooms).reverse().find(r => !!r.game || (!r.setup && r.lobbyPlayers.length >= r.settings.maxPlayers)));

      if (!candidateRoom) {
        return socket.emit('errorMsg', cleanCode ? 'Room not found!' : 'No open game to join. Ask the host to create one.');
      }

      if (tryReclaimSeat(candidateRoom, socket, cleanClientId, cleanName)) {
        return;
      }

      if (candidateRoom.game) {
        return addSpectator(candidateRoom, socket, cleanName, cleanClientId, 'Game in progress — joined as spectator!');
      }
      if (candidateRoom.setup) return socket.emit('errorMsg', 'Host is creating world');
      if (candidateRoom.lobbyPlayers.some(p => p.id === socket.id) || (candidateRoom.spectators || []).some(s => s.id === socket.id)) return;
      if (candidateRoom.lobbyPlayers.length >= candidateRoom.settings.maxPlayers) {
        return addSpectator(candidateRoom, socket, cleanName, cleanClientId, 'Lobby seats full — joined as spectator!');
      }

      if (candidateRoom.cleanupTimer) {
        clearTimeout(candidateRoom.cleanupTimer);
        candidateRoom.cleanupTimer = undefined;
      }

      const newP = createLobbyPlayer(socket.id, cleanName, candidateRoom.lobbyPlayers.length, false);
      newP.avatar = freeAvatar(candidateRoom);
      candidateRoom.lobbyPlayers.push(newP);
      if (cleanClientId) {
        candidateRoom.clientTokens = candidateRoom.clientTokens || {};
        candidateRoom.clientTokens[cleanClientId] = socket.id;
      }
      socket.join(candidateRoom.code);
      addLobbyLog(candidateRoom, `${newP.avatar} ${cleanName} joined the lobby`, newP.color);
      noteCrowding(candidateRoom);
      broadcastRoom(candidateRoom);
    }));

    socket.on('spectateRoom', safe(({ code, name, clientId }) => {
      const cleanCode = (code || '').trim().toUpperCase();
      const cleanName = String(name || '').trim().substring(0, 16);
      if (!cleanName) return socket.emit('errorMsg', 'Please enter a nickname first.');
      const cleanClientId = typeof clientId === 'string' ? clientId.trim().substring(0, 64) : '';

      const targetRoom = cleanCode
        ? rooms[cleanCode]
        : Object.values(rooms).reverse()[0];

      if (!targetRoom) {
        return socket.emit('errorMsg', cleanCode ? 'Room not found!' : 'No active game or lobby to spectate.');
      }

      addSpectator(targetRoom, socket, cleanName, cleanClientId);
    }));

    socket.on('toggleSpectate', safe(({ code }) => {
      const room = rooms[code];
      if (!room) return;
      room.spectators = room.spectators || [];

      if (!room.game) {
        const pIdx = room.lobbyPlayers.findIndex(p => p.id === socket.id);
        if (pIdx !== -1) {
          const [lp] = room.lobbyPlayers.splice(pIdx, 1);
          room.spectators.push({
            id: lp.id,
            name: lp.name,
            avatar: lp.avatar,
            color: lp.color
          });
          addLobbyLog(room, `👁️ ${lp.avatar} ${lp.name} switched to spectator`, lp.color);
          broadcastRoom(room);
          return;
        }

        const sIdx = room.spectators.findIndex(s => s.id === socket.id);
        if (sIdx !== -1) {
          if (room.lobbyPlayers.length >= room.settings.maxPlayers) {
            return socket.emit('errorMsg', 'All player seats are full!');
          }
          const [sp] = room.spectators.splice(sIdx, 1);
          const newP = createLobbyPlayer(sp.id, sp.name, room.lobbyPlayers.length, false);
          newP.avatar = !room.lobbyPlayers.some(p => p.avatar === sp.avatar) ? sp.avatar : freeAvatar(room);
          room.lobbyPlayers.push(newP);
          addLobbyLog(room, `${newP.avatar} ${newP.name} joined a player seat`, newP.color);
          noteCrowding(room);
          broadcastRoom(room);
        }
        return;
      }

      // Mid-game: a spectator who previously had a seat can reclaim their bot replacement seat,
      // and a seated human player can switch to spectating, handing their seat to a bot.
      const g = room.game;
      const spec = room.spectators.find(s => s.id === socket.id);
      if (spec) {
        const tokenEntry = Object.entries(room.clientTokens || {}).find(([, pid]) => pid === socket.id);
        if (tryReclaimSeat(room, socket, tokenEntry?.[0], spec.name)) {
          return;
        }
        return socket.emit('errorMsg', 'No open seat to join while the game is in progress.');
      }

      const p = g.players.find(pl => pl.id === socket.id && !pl.isBot);
      if (!p) return;
      const cleanOriginalName = p.name.replace(/\s*\(Bot\)$/i, '');
      const tokenEntry = Object.entries(room.clientTokens || {}).find(([, pid]) => pid === socket.id);
      const wasHost = room.hostId === socket.id;
      const botId = `bot_spec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      rebindPlayerId(room, socket.id, botId);
      room.disconnectedSeats = room.disconnectedSeats || {};
      room.disconnectedSeats[botId] = {
        playerId: botId,
        clientId: tokenEntry?.[0],
        originalName: cleanOriginalName,
        originalAvatar: p.avatar,
        wasHost,
        disconnectedAt: Date.now()
      };
      if (wasHost) room.hostId = socket.id;
      const botPlayer = g.players.find(pl => pl.id === botId);
      if (botPlayer) {
        botPlayer.isBot = true;
        botPlayer.difficulty = tierLabel(TAKEOVER_TIER);
        if (!botPlayer.name.includes('(Bot)')) botPlayer.name += ' (Bot)';
      }
      room.spectators.push({
        id: socket.id,
        name: cleanOriginalName,
        avatar: p.avatar,
        color: p.color
      });
      g.log.push({ text: `👁️ ${cleanOriginalName} switched to spectator — a ${tierLabel(TAKEOVER_TIER)} bot took over their seat.`, color: p.color });
      if (g.log.length > 80) g.log.shift();
      broadcastRoom(room);
    }));

    socket.on('reconnectRoom', safe(({ code, clientId, name }) => {
      const cleanCode = String(code || '').trim().toUpperCase();
      const cleanClientId = typeof clientId === 'string' ? clientId.trim().substring(0, 64) : '';
      const cleanName = String(name || '').trim().substring(0, 16);
      const lowerName = cleanName.toLowerCase();

      const room = cleanCode
        ? rooms[cleanCode]
        : Object.values(rooms).reverse().find(r =>
            Object.values(r.disconnectedSeats || {}).some(s =>
              (cleanClientId && s.clientId === cleanClientId) ||
              (lowerName && s.originalName.toLowerCase() === lowerName)
            ) ||
            r.game?.players.some(
              p => p.isBot && /\(Bot\)$/i.test(p.name) && p.name.replace(/\s*\(Bot\)$/i, '').toLowerCase() === lowerName
            )
          );

      if (!room) {
        socket.emit('reconnectFailed', { code: cleanCode });
        socket.emit('errorMsg', 'Previous session expired or room no longer exists.');
        return;
      }

      if (tryReclaimSeat(room, socket, cleanClientId, cleanName)) {
        return;
      }

      if (!room.game && room.setup) {
        socket.emit('reconnectFailed', { code: cleanCode });
        socket.emit('errorMsg', 'Host is creating world');
        return;
      }

      // If the room is still in LOBBY and has space, let them rejoin the lobby
      if (!room.game && cleanName && room.lobbyPlayers.length < room.settings.maxPlayers) {
        if (room.lobbyPlayers.some(p => p.id === socket.id)) return;
        const newP = createLobbyPlayer(socket.id, cleanName, room.lobbyPlayers.length, false);
        newP.avatar = freeAvatar(room);
        room.lobbyPlayers.push(newP);
        if (cleanClientId) {
          room.clientTokens = room.clientTokens || {};
          room.clientTokens[cleanClientId] = socket.id;
        }
        socket.join(room.code);
        addLobbyLog(room, `${newP.avatar} ${cleanName} rejoined the lobby`, newP.color);
        broadcastRoom(room);
        return;
      }

      socket.emit('reconnectFailed', { code: cleanCode });
      socket.emit('errorMsg', 'Could not find a disconnected seat in that game.');
    }));

    // The host moves between the world setup page and the board. While the setup page is open nobody new can join.
    socket.on('setSetup', safe(({ code, open }) => {
      const room = hostLobbyRoom(code);
      if (!room) return;
      room.setup = !!open;
      broadcastRoom(room);
    }));

    socket.on('addBot', safe(({ code, tier }) => {
      const room = hostLobbyRoom(code);
      if (!room || room.lobbyPlayers.length >= room.settings.maxPlayers) return;
      const prevPlayers = room.lobbyPlayers.length;
      const tierId = normalizeTier(tier) ?? DEFAULT_TIER;
      const used = new Set(room.lobbyPlayers.map(p => p.name));
      const botName = BOT_NAMES.find(n => !used.has(n)) || `Bot ${room.lobbyPlayers.length}`;
      const bot = createLobbyPlayer(`bot_${Date.now()}_${Math.random()}`, botName, room.lobbyPlayers.length, true, tierId);
      bot.avatar = freeAvatar(room);
      room.lobbyPlayers.push(bot);
      syncSettingsToBoard(room, undefined, undefined, prevPlayers);
      addLobbyLog(room, `🤖 ${bot.name} [${tierLabel(tierId)}] added`, bot.color);
      noteCrowding(room);
      broadcastRoom(room);
    }));

    // The host picks a tier per bot: when adding it, or by clicking the tier tag in the player list.
    socket.on('setBotTier', safe(({ code, playerId, tier }) => {
      const room = hostLobbyRoom(code);
      const tierId = normalizeTier(tier);
      if (!room || !tierId) return;
      const bot = room.lobbyPlayers.find(p => p.id === playerId && p.isBot);
      if (!bot) return;
      bot.difficulty = tierLabel(tierId);
      broadcastRoom(room);
    }));

    socket.on('removeBot', safe(({ code }) => {
      const room = hostLobbyRoom(code);
      if (!room) return;
      const prevPlayers = room.lobbyPlayers.length;
      const idx = room.lobbyPlayers.findLastIndex(p => p.isBot);
      if (idx !== -1) {
        room.lobbyPlayers.splice(idx, 1);
        syncSettingsToBoard(room, undefined, undefined, prevPlayers);
        broadcastRoom(room);
      }
    }));

    socket.on('updateSettings', safe(({ code, newSettings }) => {
      const room = hostLobbyRoom(code);
      if (!room || !newSettings) return;
      const old = room.settings;
      const prevLand = countLandHexes(room.board);
      const prevVp = old.vpToWin;
      const { settings: next, dropped } = mergeSettingsDetailed(newSettings, old);
      room.settings = next;

      // Turning Tidebound on moves the map to islands with wide water on a bigger board. Otherwise the map follows its recipe
      // (seed, radius, picks, params, tile counts); other settings leave painted edits alone.
      if (next.dlc?.tidebound && !old.dlc?.tidebound) {
        applyTideboundMapDefaults(room);
      } else if (recipeKey(old) !== recipeKey(next)) {
        refreshMap(room);
      }
      syncSettingsToBoard(room, prevLand, prevVp);
      if (dropped.length > 0) addLobbyLog(room, `Map code: ignored ${dropped.join(', ')} (not available here).`, null);
      broadcastRoom(room);
    }));

    // New random seed, same picks and radius. The Reroll button.
    socket.on('regenerate', safe(({ code }) => {
      const room = hostLobbyRoom(code);
      if (!room) return;
      room.settings.mapSeed = '';
      refreshMap(room);
      broadcastRoom(room);
    }));

    // Avatars: everyone picks their own; the host can also pick for bots. Each avatar is used once per lobby.
    socket.on('setAvatar', safe(({ code, playerId, avatar }) => {
      const room = rooms[code];
      if (!room || room.game || typeof avatar !== 'string' || !AVATARS.includes(avatar)) return;
      const targetId = playerId || socket.id;
      const target: any = room.lobbyPlayers.find(p => p.id === targetId) || (room.spectators || []).find(s => s.id === targetId);
      if (!target) return;
      if (target.id !== socket.id && !(target.isBot && room.hostId === socket.id)) return;
      if (
        room.lobbyPlayers.some(p => p.id !== target.id && p.avatar === avatar) ||
        (room.spectators || []).some(s => s.id !== target.id && s.avatar === avatar)
      ) {
        return socket.emit('errorMsg', 'That avatar is already taken.');
      }
      target.avatar = avatar;
      broadcastRoom(room);
    }));

    // Lobby cursors: only the host edits, everyone else points with a cursor (Shift = laser). Relayed, never stored.
    socket.on('cursor', safe(({ code, x, y, laser, hide }) => {
      const room = rooms[code];
      if (!room || room.game) return;
      const inRoom = room.lobbyPlayers.some(p => p.id === socket.id) || (room.spectators || []).some(s => s.id === socket.id);
      if (!inRoom) return;
      if (hide) {
        socket.to(room.code).volatile.emit('cursor', { id: socket.id, hide: true });
        return;
      }
      const nx = Number(x), ny = Number(y);
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
      socket.to(room.code).volatile.emit('cursor', { id: socket.id, x: nx, y: ny, laser: !!laser });
    }));

    socket.on('applyMapPreset', safe(({ code, preset }) => {
      const room = hostLobbyRoom(code);
      if (!room || !isPreset(preset, room.settings)) return;
      applyMapStart(room, preset);
      broadcastRoom(room);
    }));

    socket.on('applyScenario', safe(({ code, scenarioId }) => {
      const room = hostLobbyRoom(code);
      if (!room) return;
      const sc = mapOptionsView().scenarios.find(s => s.id === scenarioId);
      if (!sc) return;
      if (isPreset(sc.quickStart, room.settings)) {
        applyMapStart(room, sc.quickStart);
      }
      const resetDlc: Record<string, boolean> = {};
      for (const k of Object.keys(room.settings.dlc ?? {})) resetDlc[k] = false;
      Object.assign(resetDlc, sc.dlc);
      const { settings: next } = mergeSettingsDetailed(
        {
          boardRadius: sc.boardRadius,
          vpToWin: sc.vpToWin,
          dlc: resetDlc,
          addons: sc.addons ?? {},
          eventsOn: !!sc.eventsOn,
          fateTokens: sc.fateTokens ?? 2
        },
        room.settings
      );
      room.settings = next;
      refreshMap(room);
      addLobbyLog(room, `Scenario "${sc.label}" applied`, null);
      broadcastRoom(room);
    }));

    // Custom presets live in the host's browser. The server only turns the lobby map into plain JSON (save)
    // and validates + rebuilds it (load), so a stored or edited preset can never put a bad board in a room.
    socket.on('savePreset', safe(({ code, name }) => {
      const room = hostLobbyRoom(code);
      if (!room) return;
      socket.emit('presetSaved', { preset: serializePreset(room.board, room.settings, name, room.mapMeta) });
    }));

    socket.on('applyCustomPreset', safe(({ code, preset }) => {
      const room = hostLobbyRoom(code);
      if (!room) return;
      const loaded = loadPreset(preset, room.settings);
      if ('error' in loaded) return socket.emit('errorMsg', loaded.error);
      // The snapshot is the map. A preset with a recipe also brings back its seed and style (presets v2).
      applyLoadedPreset(room, loaded);
      addLobbyLog(room, `Map preset "${loaded.name}" loaded`, null);
      broadcastRoom(room);
    }));

    // "New seed" on a saved preset: the same style (radius, picks, params), a fresh seed.
    socket.on('applyPresetStyle', safe(({ code, preset }) => {
      const room = hostLobbyRoom(code);
      if (!room) return;
      const style = presetStyle(preset);
      if (!style) return socket.emit('errorMsg', 'That preset has no map style to reuse.');
      applyRecipeStyle(room, style);
      addLobbyLog(room, 'Map style from a preset applied with a new seed', null);
      broadcastRoom(room);
    }));

    socket.on('paintHex', safe(({ code, hexId, paintType, paintValue }) => {
      const room = hostLobbyRoom(code);
      if (!room) return;
      const prevLand = countLandHexes(room.board);
      room.board = paintHex(room.board, hexId, paintType, paintValue);
      if (room.mapMeta) room.mapMeta.edited = true;
      syncSettingsToBoard(room, prevLand);
      broadcastRoom(room);
    }));

    socket.on('paintPort', safe(({ code, edgeId, portValue }) => {
      const room = hostLobbyRoom(code);
      if (!room) return;
      room.board = paintPort(room.board, edgeId, portValue);
      if (room.mapMeta) room.mapMeta.edited = true;
      broadcastRoom(room);
    }));

    socket.on('startGame', safe(({ code }) => {
      const room = hostLobbyRoom(code);
      if (!room) return;
      const error = startGame(room);
      if (error) return socket.emit('errorMsg', error);
      broadcastRoom(room);
    }));

    socket.on('rematchLobby', safe(({ code }) => {
      const room = rooms[code];
      if (!room) return;
      rematch(room);
      broadcastRoom(room);
    }));

    // ---- Board clicks -------------------------------------------------------

    // Base clicks only: steal victim, settlement to city, empty vertex to settlement. Any other piece goes through `place` below.
    socket.on('clickVertex', safe(({ code, vertexId }) => {
      const g = rooms[code]?.game;
      if (!g) return;
      const v = g.board.vertices[vertexId];
      if (!v) return;

      if (g.phase === 'robber_steal' && v.piece && victimsOnHex(g, g.board.robberHexId, socket.id).includes(v.piece.owner)) {
        return act(code, 'steal', { victimId: v.piece.owner });
      }
      if (v.piece && v.piece.owner === socket.id && v.piece.type === SETTLEMENT) {
        return act(code, 'build', { piece: CITY, loc: vertexId }, true);
      }
      if (!v.piece) act(code, 'build', { piece: SETTLEMENT, loc: vertexId }, true);
    }));

    // The base client's edge click: a road, or a bridge on an ocean edge (no land tile touches it). A chosen piece goes through `place`.
    socket.on('clickEdge', safe(({ code, edgeId }) => {
      const g = rooms[code]?.game;
      const e = g?.board.edges[edgeId];
      act(code, 'build', { piece: e && e.hexIds.length === 0 ? 'bridge' : ROAD, loc: edgeId }, true);
    }));

    // R6.5: the generic piece entry. `{ code, piece, loc }` builds any registered piece for this socket's player, so a new piece needs no handler here.
    // The client's object is untrusted: `code` and `piece` must be strings; `loc` is checked by the build action (whole number, a real vertex or edge),
    // and so are the piece id, the supply, the rule for the spot and the price. It always reports.
    socket.on('place', (data: any) => {
      try {
        const { code, piece, loc } = data !== null && typeof data === 'object' ? data : ({} as any);
        if (typeof code !== 'string' || typeof piece !== 'string') return;
        act(code, 'build', { piece, loc }, true);
      } catch (err) { console.error('Socket handler error:', err); }
    });
    socket.on('clickHex', safe(({ code, hexId }) => act(code, 'move_robber', { hexId })));
    socket.on('stealFromPlayer', safe(({ code, victimId }) => act(code, 'steal', { victimId })));

    // ---- Turn actions ---------------------------------------------------------

    // R6.2: the generic entry. `{ code, type, payload }` runs any registered action for this socket's player, so a new action needs no handler here.
    // The client's object is untrusted: `type` must be a string and `payload` a plain object (anything else becomes `{}`). Unknown or illegal types are
    // refused by `dispatch` (its reason goes back to the player), so there is no check against the registry. It always reports; the events that are
    // silent on refusal (roll, end turn, ...) stay as they are below.
    socket.on('act', (data: any) => {
      try {
        const { code, type, payload } = data !== null && typeof data === 'object' ? data : ({} as any);
        if (typeof code !== 'string' || typeof type !== 'string') return;
        const plain = payload !== null && typeof payload === 'object' && !Array.isArray(payload);
        act(code, type, plain ? payload : {}, true);
      } catch (err) { console.error('Socket handler error:', err); }
    });

    socket.on('rollDice', safe(({ code }) => act(code, 'roll')));
    socket.on('endTurn', safe(({ code }) => act(code, 'end_turn')));
    socket.on('buyDevCard', safe(({ code }) => act(code, 'buy_dev')));
    socket.on('pickGoldResource', safe(({ code, resource }) => act(code, 'pick', { resource }, true)));
    socket.on('discardCards', safe(({ code, discards, wild }) => act(code, 'discard', { cards: discards, wild })));

    socket.on('playDevCard', safe(({ code, cardType, monopolyResource }) => {
      act(code, 'play_dev', { card: cardType, resource: monopolyResource }, true);
    }));

    socket.on('bankTrade', safe(({ code, give, get }) => act(code, 'bank_trade', { give, get }, true)));
    socket.on('proposeTrade', safe(({ code, offer, request }) => act(code, 'propose_trade', { offer, request }, true)));
    socket.on('respondTrade', safe(({ code, decision, tradeId }) => act(code, 'respond_trade', { decision, tradeId }, true)));
    socket.on('counterTrade', safe(({ code, offer, request, tradeId }) => act(code, 'counter_trade', { offer, request, tradeId }, true)));
    socket.on('confirmTradeWithPartner', safe(({ code, partnerId, tradeId }) => act(code, 'confirm_trade', { partnerId, tradeId }, true)));

    socket.on('cancelTrade', safe(({ code, tradeId }) => {
      const g = rooms[code]?.game;
      const list = g?.trades ?? (g?.trade ? [g.trade] : []);
      const trade = tradeId !== undefined && tradeId !== null ? list.find(t => t.id === Number(tradeId)) : list[0];
      if (!trade) return;
      // The proposer withdraws the offer, anyone else just declines it.
      if (trade.fromId === socket.id) act(code, 'cancel_trade', { tradeId: trade.id });
      else act(code, 'respond_trade', { decision: 'declined', tradeId: trade.id });
    }));

    socket.on('sendChat', safe(({ code, text }) => {
      const room = rooms[code];
      if (!room || !text) return;
      const me =
        (room.game ? room.game.players.find(p => p.id === socket.id) : room.lobbyPlayers.find(p => p.id === socket.id)) ||
        (room.spectators || []).find(s => s.id === socket.id);
      if (!me) return;
      const said = String(text).trim().substring(0, 120);
      room.chats.push({ sender: me.name, avatar: me.avatar, color: me.color, text: said });
      if (room.chats.length > 60) room.chats.shift();
      reactToChat(room, socket.id, said);
      broadcastRoom(room);
    }));

    // ---- Debug Mode ---------------------------------------------------------------

    socket.on('debugCmd', safe(({ code, cmd, payload }) => {
      const room = rooms[code];
      if (!room) return;
      if (cmd === 'audit') {
        socket.emit('debugReport', {
          type: 'audit',
          report: auditGameState(room, socket.id)
        });
        return;
      }
      const res = applyDebugCommand(room, socket.id, String(cmd || ''), payload ?? {});
      if (!res.ok) {
        socket.emit('errorMsg', res.message);
        return;
      }
      broadcastRoom(room);
      socket.emit('debugReport', {
        type: cmd,
        message: res.message,
        snapshot: res.snapshot,
        report: auditGameState(room, socket.id)
      });
    }));

    // ---- Disconnect ---------------------------------------------------------------

    socket.on('disconnect', () => {
      try {
        for (const code of Object.keys(rooms)) {
          const room = rooms[code];
          const g = room.game;
          room.disconnectedSeats = room.disconnectedSeats || {};
          room.spectators = room.spectators || [];
          const tokenEntry = Object.entries(room.clientTokens || {}).find(([, pid]) => pid === socket.id);
          const clientId = tokenEntry?.[0];

          const specIdx = room.spectators.findIndex(s => s.id === socket.id);
          if (specIdx !== -1) {
            const [spec] = room.spectators.splice(specIdx, 1);
            room.disconnectedSeats[socket.id] = {
              playerId: socket.id,
              clientId,
              originalName: spec.name,
              originalAvatar: spec.avatar,
              wasHost: room.hostId === socket.id,
              isSpectator: true,
              disconnectedAt: Date.now()
            };
            const humans = humanIds(room).filter(id => !room.disconnectedSeats?.[id]);
            if (humans.length === 0) {
              clearBotTimers(room);
              room.cleanupTimer = setTimeout(() => {
                if (rooms[code] && humanIds(rooms[code]).filter(id => !rooms[code].disconnectedSeats?.[id]).length === 0) {
                  clearBotTimers(rooms[code]);
                  delete rooms[code];
                }
              }, ROOM_DISCONNECT_TTL_MS);
              continue;
            }
            if (room.hostId === socket.id) room.hostId = humans[0];
            broadcastRoom(room);
            continue;
          }

          if (!g) {
            const lp = room.lobbyPlayers.find(p => p.id === socket.id);
            if (!lp) continue;
            room.disconnectedSeats[socket.id] = {
              playerId: socket.id,
              clientId,
              originalName: lp.name,
              originalAvatar: lp.avatar,
              wasHost: room.hostId === socket.id,
              disconnectedAt: Date.now()
            };
            const humans = humanIds(room).filter(id => id !== socket.id && !room.disconnectedSeats?.[id]);
            if (humans.length === 0) {
              clearBotTimers(room);
              room.cleanupTimer = setTimeout(() => {
                if (rooms[code] && humanIds(rooms[code]).filter(id => !rooms[code].disconnectedSeats?.[id]).length === 0) {
                  clearBotTimers(rooms[code]);
                  delete rooms[code];
                }
              }, ROOM_DISCONNECT_TTL_MS);
              continue;
            }
            const idx = room.lobbyPlayers.findIndex(p => p.id === socket.id);
            if (idx !== -1) room.lobbyPlayers.splice(idx, 1);
            delete room.disconnectedSeats[socket.id];
            if (clientId && room.clientTokens?.[clientId] === socket.id) {
              delete room.clientTokens[clientId];
            }
            if (room.hostId === socket.id) room.hostId = humans[0];
            broadcastRoom(room);
            continue;
          }

          const p = g.players.find(pl => pl.id === socket.id);
          if (!p) continue;
          const cleanOriginalName = p.name.replace(/\s*\(Bot\)$/i, '');
          room.disconnectedSeats[socket.id] = {
            playerId: socket.id,
            clientId,
            originalName: cleanOriginalName,
            originalAvatar: p.avatar,
            wasHost: room.hostId === socket.id,
            disconnectedAt: Date.now()
          };
          p.isBot = true;
          p.difficulty = tierLabel(TAKEOVER_TIER);
          if (!p.name.includes('(Bot)')) p.name += ' (Bot)';
          g.log.push({ text: `🤖 ${cleanOriginalName} disconnected — a ${tierLabel(TAKEOVER_TIER)} bot took over (rejoin anytime).`, color: p.color });
          if (g.log.length > 80) g.log.shift();

          const humans = humanIds(room);
          if (humans.length === 0) {
            // Pause bot simulation while no human is connected, but keep the room alive for 10 minutes so the player can reconnect.
            clearBotTimers(room);
            room.cleanupTimer = setTimeout(() => {
              if (rooms[code] && humanIds(rooms[code]).length === 0) {
                clearBotTimers(rooms[code]);
                delete rooms[code];
              }
            }, ROOM_DISCONNECT_TTL_MS);
            continue;
          }
          if (room.hostId === socket.id) room.hostId = humans[0];
          broadcastRoom(room);
        }
      } catch (e) { console.error(e); }
    });
  });
}

// Used by tests/sim to confirm the registry and the client-visible colours stay in sync.
export const SEAT_COLORS = PLAYER_COLORS;
export const KNOWN_TILE_IDS = (): string[] => [...registry.tiles.keys()];
