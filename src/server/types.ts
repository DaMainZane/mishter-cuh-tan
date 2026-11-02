// MODULE: server room types (lobby settings, room, client-facing effects) | DEPENDS ON: server/bots/dialogue/types, server/turnHistory, shared/index | USED BY: server/bots/dialogue/context, server/bots/dialogue/engine, server/bots/dialogue/index, server/bots/scheduler, server/debug, server/game, +10 more
import type { Board, GameState, MapRecipe, MapReport } from '../shared';
import type { BotChatLevel } from './bots/dialogue/types';

/** Lobby settings the client edits. The adapter maps them to engine rules (runtime.rulesFromSettings). */
export interface Settings {
  boardRadius: number;
  goldTiles: number;
  desertTiles: number;
  fogTiles?: number;
  vpToWin: number;
  maxPlayers: number;
  cardDiscardLimit: number;
  bankResourcePerType: number;
  devKnights: number;
  devVp: number;
  devRoadBuilding: number;
  devYearOfPlenty: number;
  devMonopoly: number;
  maxSettlements: number;
  maxCities: number;
  maxRoads: number;
  gameSpeed?: number;
  /** Seconds a human gets per turn (0 = no turn timer). */
  turnTimerSec?: number;
  /** Seconds added to the turn clock each time the player completes an action. */
  turnIncrementSec?: number;
  /** Seconds a human-proposed trade offer stays open. */
  tradeTimerSec?: number;
  /** How much bots talk: off, quiet, normal (default) or chatty. Host only. */
  botChat?: BotChatLevel;
  /** Seed of the lobby map. Empty = roll a fresh one on the next generation (it is stored once rolled). */
  mapSeed?: string;
  /** Keep the seed on rematch. */
  mapSeedLocked?: boolean;
  /** Ticked menu ids (shape ops, styles, perks), in the order they were ticked. Defaults for empty slots are not stored. */
  mapPicks?: string[];
  /** Numeric params by id (see ParamDef), clamped to their ranges. */
  mapParams?: Record<string, number>;
  /** Master switch per DLC pack id (`true` = DLC on). */
  dlc?: Record<string, boolean>;
  /** Per-addon toggle overrides (`false` = addon disabled inside an enabled DLC). */
  addons?: Record<string, boolean>;
  /** Seeded Event Deck toggle (draws an event every N rounds). */
  eventsOn?: boolean;
  /** Starting Fate tokens per player when events are on (default 2). */
  fateTokens?: number;
  /** Tech tree toggle (default off). Off means nobody can research. Turning DLCs off does not change it. */
  techTreeOn?: boolean;
  /** Fair dice toggle (default off). Rolls 2d6 guided by the 36-combination bell curve. */
  fairDice?: boolean;
  /** Tidebound tide level 1 to 5 (default 3, Medium): the high/low slider of the Tides addon. Only read while Tides is on. */
  tideLevel?: number;
  /** Tidebound rising sea level 1 to 5 (default 3, Medium): the slow/fast slider of the Rising sea addon. Only read while Rising sea is on. */
  risingSeaLevel?: number;
}

/** How the lobby map was made, kept beside the board (the recipe is enough to rebuild it with the same generator version). */
export interface MapMeta {
  recipe: MapRecipe;
  report: MapReport;
  /** A paint event touched the board, so the seed no longer describes it. */
  edited: boolean;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  avatar: string;
  color: string;
  isBot: boolean;
  difficulty: string | null;
}

export interface Spectator {
  id: string;
  name: string;
  avatar: string;
  color: string;
}

export interface ChatEntry {
  sender: string;
  avatar: string;
  color: string;
  text: string;
}

export interface RecentProduction {
  hexId: number;
  playerId: string;
  resource: string;
  amount: number;
}

export interface RecentTransfer {
  from: string;
  to: string;
  resource: string;
  amount: number;
  kind: string;
  secretForOthers?: boolean;
}

/** Things the client animates once (cleared after every broadcast), except lastRollHexIds. */
export interface Effects {
  lastRollHexIds: number[];
  recentProductions: RecentProduction[];
  recentTransfers: RecentTransfer[];
  animDelayMs?: number;
}

export interface DisconnectedSeat {
  playerId: string;
  clientId?: string;
  originalName: string;
  originalAvatar: string;
  wasHost: boolean;
  isSpectator?: boolean;
  disconnectedAt: number;
}

export interface Room {
  code: string;
  hostId: string;
  settings: Settings;
  /** Roster while in the lobby. During a game the engine's players are the roster. */
  lobbyPlayers: LobbyPlayer[];
  /** Connected spectators watching the lobby or game without occupying a player seat. */
  spectators: Spectator[];
  /** Lobby board (editable). Copied into the game at start. */
  board: Board;
  /** Recipe and report of the lobby board. Undefined for blank, legacy-preset and loaded-preset boards. */
  mapMeta?: MapMeta;
  /** null = lobby. */
  game: GameState | null;
  /** The host is on the world setup page (before the board). Newcomers cannot join until the host continues. */
  setup?: boolean;
  lobbyLog: { text: string; color: string | null }[];
  chats: ChatEntry[];
  fx: Effects;
  startedAt: number | null;
  finishedAt: number | null;
  /** Persistent browser clientId -> current playerId seat mapping for seamless reconnects. */
  clientTokens?: Record<string, string>;
  /** Seats where a human disconnected and can rejoin by clientId or nickname. */
  disconnectedSeats?: Record<string, DisconnectedSeat>;
  /** Grace timer before an empty room is garbage-collected after all humans disconnect. */
  cleanupTimer?: any;
  /** Timestamp until which client roll/card/robber animations are still playing; bots wait until after this time. */
  animatingUntil?: number;
  botTimer?: any;
  /** Trade id the bot-proposal timeout was scheduled for. */
  tradeTimerFor?: number | null;
  tradeTimer?: any;
  /** Per-trade expiration timers and timestamps keyed by trade id. */
  tradeTimers?: Map<number, { createdAt: number; expiresAt: number; durationMs: number; timer: any }>;
  /** Turn clock of the human whose turn it is (see turnClock.ts). */
  turnClock?: { key: string; playerId: string; deadline: number; timer?: any };
  /** What a turn clock had left when a discard clock cut in; given back when the turn owner is on the clock again. */
  savedTurnClock?: { key: string; remainingMs: number };
  /** Complete round-by-round turn history summarizing key player actions for high transparency. */
  turnHistory?: import('./turnHistory').RoundSummary[];
}

/** Legacy status strings the client switches on. */
export type RoomStatus = 'LOBBY' | 'SETUP' | 'PLAYING' | 'GAMEOVER';
