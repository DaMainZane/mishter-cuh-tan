// MODULE: core engine types (game state, board, players, rules) | DEPENDS ON: shared/rng | USED BY: shared/botGoals, shared/coreServices, shared/ctx, shared/engine, shared/eventDeck, shared/history, +17 more
import type { RngState } from './rng';

export type Id = string;
export type Resources = Record<string, number>;

export interface Piece { type: string; owner: Id }

export interface Hex {
  id: number;
  q: number;
  r: number;
  x: number;
  y: number;
  type: string;
  number: number | null;
  corners: { x: number; y: number }[];
  vertexIds: number[];
  /** Pack-owned data. `ext.hidden` = identity hidden from players and inert until revealed (used by fog). */
  ext: Record<string, any>;
}

export interface Vertex {
  id: number;
  x: number;
  y: number;
  hexIds: number[];
  adjacentVertices: number[];
  edgeIds: number[];
  port: string | null;
  piece: Piece | null;
}

export interface Edge {
  id: number;
  v1: number;
  v2: number;
  key: string;
  hexIds: number[];
  port: string | null;
  piece: Piece | null;
}

export interface Board {
  hexes: Hex[];
  vertices: Vertex[];
  edges: Edge[];
  robberHexId: number;
}

export interface PlayerState {
  id: Id;
  name: string;
  avatar: string;
  color: string;
  isBot: boolean;
  difficulty: string | null;
  resources: Resources;
  devCards: string[];
  newDevCards: string[];
  /** Remaining supply per piece id. */
  pieces: Record<string, number>;
  /** Things the player still owes/gets: pick, discard, freeRoads. */
  pending: Record<string, number>;
  /** Counters: knightsPlayed, earned, trades, plus one entry per award id (current metric). */
  stats: Record<string, number>;
  /** Per-turn flags, cleared at turn start: playedDev, proposedTrade. */
  flags: Record<string, boolean>;
}

export interface TradeState {
  id: number;
  fromId: Id;
  offer: Resources;
  request: Resources;
  responses: Record<Id, 'pending' | 'accepted' | 'declined'>;
}

export interface Rules {
  vpToWin: number;
  maxPlayers: number;
  discardLimit: number;
  bankPerResource: number;
  boardRadius: number;
  bankRatio: number;
  devCost: Resources;
  /** Special tile counts by tile id (desert, gold...). The rest is filled with base tiles. */
  tileCounts: Record<string, number>;
  devCounts: Record<string, number>;
  pieceLimits: Record<string, number>;
  /** Pack parameters, e.g. fogTiles, gameSpeed. */
  [key: string]: any;
}

export interface LogEntry { text: string; color: string | null }

export interface GameState {
  /** State schema version, for save/restore migration. */
  version: number;
  seed: number;
  rng: RngState;
  packs: string[];
  rules: Rules;
  board: Board;
  players: PlayerState[];
  bank: Resources;
  deck: string[];
  /** Index into players of the player whose turn it is. */
  turn: number;
  turnCount: number;
  /** Full passes of the table. 0 during setup; round 1 starts with the first normal turn (seat 0) and a new round starts each time seat 0 comes up again. Robber, discard and pick sub-phases do not start rounds. */
  round: number;
  phase: string;
  /** Phases to return to after the current one ends (robber, discard, pick...). */
  phaseStack: string[];
  setup: { order: number[]; step: number; lastVertexId: number | null };
  dice: number[];
  diceStats: Record<number, number>;
  /** award id -> holder player id */
  awards: Record<string, Id | null>;
  trade: TradeState | null;
  /** All open trade offers, newest first (`trades[0]` mirrors `trade`). */
  trades: TradeState[];
  winner: { id: Id; name: string; vp: number; color: string } | null;
  log: LogEntry[];
  /** Pack-owned game data, namespaced by pack id, e.g. ext.base. */
  ext: Record<string, any>;
}
