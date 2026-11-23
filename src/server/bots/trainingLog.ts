// MODULE: AI bot training data logger (captures pre-action state features, legal action counts, chosen actions, and terminal VP/win rewards) | DEPENDS ON: packs/base/trading, server/bots/tiers, server/util, shared/index | USED BY: server/bots/sim, server/game, server/main, server/p2pHost, server/rooms
import fs from 'fs';
import path from 'path';
import { getPlayer, legalActions, publicVP, score, totalCards } from '../../shared';
import type { GameEvent, GameState, Id, Registry, Resources } from '../../shared';
import { tradeRatios } from '../../packs/base/trading';
import { getPips } from '../util';
import { personalityOf, tierFromDifficulty } from './tiers';

export interface TrainingOpponentView {
  id: Id;
  publicVp: number;
  cardCount: number;
  devCount: number;
  knightsPlayed: number;
  longestRoad: number;
}

export interface TrainingStateSnapshot {
  turn: number;
  phase: string;
  actorId: Id;
  isBot: boolean;
  tier: string;
  myVp: number;
  publicVp: number;
  resources: Resources;
  totalCards: number;
  prodPips: Record<string, number>;
  piecesLeft: Record<string, number>;
  devCardCount: number;
  playableDevs: string[];
  knightsPlayed: number;
  longestRoad: number;
  tradeRatios: Resources;
  bank: Resources;
  deckCount: number;
  robberHexId: number;
  opponents: TrainingOpponentView[];
  legalActionCount: number;
}

export interface TrainingStep {
  step: number;
  timestampMs: number;
  state: TrainingStateSnapshot;
  action: { type: string; payload: any };
  events: { type: string; data?: any }[];
}

export interface TrainingOutcome {
  finished: boolean;
  finishedAt: number;
  winnerId: Id | null;
  winnerTier: string | null;
  turns: number;
  totalSteps: number;
  finalVpByPlayer: Record<Id, number>;
  rankByPlayer: Record<Id, number>;
  /** Normalized RL reward per player: 1.0 for winner, scaled (vp / vpToWin) for non-winners. */
  rewardByPlayer: Record<Id, number>;
}

export interface GameTrainingTrajectory {
  schemaVersion: number;
  gameId: string;
  roomCode: string;
  seed: number;
  startedAt: number;
  rules: {
    vpToWin: number;
    discardLimit: number;
    boardRadius: number;
    bankPerResource: number;
    pieceLimits: Record<string, number>;
  };
  players: {
    id: Id;
    name: string;
    isBot: boolean;
    tier: string;
    personality: string;
  }[];
  boardSummary: {
    hexes: { id: number; q: number; r: number; type: string; number: number | null; pips: number }[];
    vertices: { id: number; hexIds: number[]; adjacentVertices: number[]; port: string | null }[];
    edges: { id: number; v1: number; v2: number; port: string | null }[];
  };
  steps: TrainingStep[];
  outcome: TrainingOutcome | null;
}

const GAME_TRAJECTORIES = new WeakMap<GameState, GameTrainingTrajectory>();
const ROOM_TRAJECTORIES = new Map<string, GameTrainingTrajectory>();
const RECENT_TRAJECTORIES: GameTrainingTrajectory[] = [];
const MAX_IN_MEMORY_GAMES = 40;
const MAX_STEPS_PER_GAME = 5000;

const LOG_DIR = path.join(process.cwd(), 'data');
const LOG_FILE = path.join(LOG_DIR, 'bot_training_logs.jsonl');

function playerPips(g: GameState, reg: Registry, pid: Id): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries([...reg.resources.keys()].map(r => [r, 0]));
  for (const v of g.board.vertices) {
    if (!v.piece || v.piece.owner !== pid) continue;
    const mult = reg.pieces.get(v.piece.type)?.produces || 0;
    if (!mult) continue;
    for (const hId of v.hexIds) {
      const h = g.board.hexes[hId];
      if (!h || h.ext?.hidden) continue;
      const res = reg.tiles.get(h.type)?.produces;
      if (res) out[res] = (out[res] || 0) + getPips(h.number) * mult;
    }
  }
  return out;
}

export function initGameTrainingLog(g: GameState, reg: Registry, roomCode = 'SIM'): GameTrainingTrajectory {
  const existing = GAME_TRAJECTORIES.get(g);
  if (existing) return existing;

  const traj: GameTrainingTrajectory = {
    schemaVersion: 1,
    gameId: `${roomCode}_${g.seed}_${Date.now()}`,
    roomCode,
    seed: g.seed,
    startedAt: Date.now(),
    rules: {
      vpToWin: g.rules.vpToWin,
      discardLimit: g.rules.discardLimit,
      boardRadius: g.rules.boardRadius,
      bankPerResource: g.rules.bankPerResource,
      pieceLimits: { ...(g.rules.pieceLimits ?? {}) }
    },
    players: g.players.map(p => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      tier: p.isBot ? tierFromDifficulty(p.difficulty) : 'human',
      personality: personalityOf(p.id)
    })),
    boardSummary: {
      hexes: g.board.hexes.map(h => ({
        id: h.id,
        q: h.q,
        r: h.r,
        type: h.type,
        number: h.number,
        pips: getPips(h.number)
      })),
      vertices: g.board.vertices.map(v => ({
        id: v.id,
        hexIds: [...v.hexIds],
        adjacentVertices: [...v.adjacentVertices],
        port: v.port
      })),
      edges: g.board.edges.map(e => ({
        id: e.id,
        v1: e.v1,
        v2: e.v2,
        port: e.port
      }))
    },
    steps: [],
    outcome: null
  };

  GAME_TRAJECTORIES.set(g, traj);
  if (roomCode) ROOM_TRAJECTORIES.set(roomCode, traj);
  RECENT_TRAJECTORIES.push(traj);
  if (RECENT_TRAJECTORIES.length > MAX_IN_MEMORY_GAMES) {
    RECENT_TRAJECTORIES.shift();
  }
  return traj;
}

/** Captures the pre-action decision state from `playerId`'s perspective before `dispatch` mutates `g`. */
export function captureTrainingSnapshot(g: GameState, reg: Registry, playerId: Id): TrainingStateSnapshot | null {
  const p = getPlayer(g, playerId);
  if (!p) return null;
  const legal = legalActions(g, reg, playerId);
  return {
    turn: g.turnCount,
    phase: g.phase,
    actorId: playerId,
    isBot: p.isBot,
    tier: p.isBot ? tierFromDifficulty(p.difficulty) : 'human',
    myVp: score(g, reg, p, true),
    publicVp: publicVP(g, reg, p),
    resources: { ...p.resources },
    totalCards: totalCards(p),
    prodPips: playerPips(g, reg, playerId),
    piecesLeft: { ...p.pieces },
    devCardCount: p.devCards.length + p.newDevCards.length,
    playableDevs: [...p.devCards],
    knightsPlayed: p.stats.knightsPlayed || 0,
    longestRoad: p.stats.longestRoad || 0,
    tradeRatios: tradeRatios(g, reg, playerId),
    bank: { ...g.bank },
    deckCount: g.deck.length,
    robberHexId: g.board.robberHexId,
    opponents: g.players
      .filter(o => o.id !== playerId)
      .map(o => ({
        id: o.id,
        publicVp: publicVP(g, reg, o),
        cardCount: totalCards(o),
        devCount: o.devCards.length + o.newDevCards.length,
        knightsPlayed: o.stats.knightsPlayed || 0,
        longestRoad: o.stats.longestRoad || 0
      })),
    legalActionCount: legal.length
  };
}

/** Commits a validated action step to the game's training trajectory, and finalizes outcome labels on gameOver. */
export function commitTrainingStep(
  g: GameState,
  reg: Registry,
  roomCode: string,
  snapshot: TrainingStateSnapshot | null,
  actionType: string,
  payload: any,
  events: GameEvent[]
): void {
  if (!snapshot) return;
  const traj = initGameTrainingLog(g, reg, roomCode);
  if (traj.steps.length < MAX_STEPS_PER_GAME) {
    traj.steps.push({
      step: traj.steps.length,
      timestampMs: Date.now() - traj.startedAt,
      state: snapshot,
      action: { type: actionType, payload },
      events: events.map(ev => ({ type: ev.type, data: ev.data }))
    });
  }

  if (g.phase === 'gameover' && !traj.outcome) {
    finalizeTrainingLog(g, reg, traj);
  }
}

export function finalizeTrainingLog(g: GameState, reg: Registry, traj?: GameTrainingTrajectory): void {
  const t = traj ?? GAME_TRAJECTORIES.get(g);
  if (!t || t.outcome) return;

  const finalVpByPlayer: Record<Id, number> = {};
  for (const p of g.players) {
    finalVpByPlayer[p.id] = score(g, reg, p, true);
  }

  const sorted = [...g.players].sort((a, b) => (finalVpByPlayer[b.id] || 0) - (finalVpByPlayer[a.id] || 0));
  const rankByPlayer: Record<Id, number> = {};
  const rewardByPlayer: Record<Id, number> = {};
  const vpTarget = Math.max(1, g.rules.vpToWin || 10);

  sorted.forEach((p, idx) => {
    rankByPlayer[p.id] = idx + 1;
    const isWin = g.winner ? g.winner.id === p.id : idx === 0;
    const rawProgress = Math.min(0.85, (finalVpByPlayer[p.id] || 0) / vpTarget * 0.7);
    rewardByPlayer[p.id] = isWin ? 1.0 : Number(rawProgress.toFixed(3));
  });

  const winnerPlayer = g.winner ? getPlayer(g, g.winner.id) : undefined;
  t.outcome = {
    finished: g.phase === 'gameover',
    finishedAt: Date.now(),
    winnerId: g.winner?.id ?? null,
    winnerTier: winnerPlayer ? (winnerPlayer.isBot ? tierFromDifficulty(winnerPlayer.difficulty) : 'human') : null,
    turns: g.turnCount,
    totalSteps: t.steps.length,
    finalVpByPlayer,
    rankByPlayer,
    rewardByPlayer
  };

  // Append completed game trajectory as a single JSONL record to disk (non-blocking).
  persistTrajectoryToDisk(t);
}

function persistTrajectoryToDisk(traj: GameTrainingTrajectory): void {
  const line = JSON.stringify(traj) + '\n';
  fs.promises
    .mkdir(LOG_DIR, { recursive: true })
    .then(() => fs.promises.appendFile(LOG_FILE, line, 'utf8'))
    .catch(() => {
      // Ignore filesystem errors in read-only or ephemeral environments; memory ring buffer still holds the logs.
    });
}

/** Updates player IDs in an active trajectory if a disconnected human reconnects with a new socket ID. */
export function rebindTrainingLogPlayerId(roomCode: string, oldId: string, newId: string): void {
  const traj = ROOM_TRAJECTORIES.get(roomCode);
  if (!traj) return;
  for (const p of traj.players) {
    if (p.id === oldId) p.id = newId;
  }
  for (const s of traj.steps) {
    if (s.state.actorId === oldId) s.state.actorId = newId;
    for (const o of s.state.opponents) {
      if (o.id === oldId) o.id = newId;
    }
  }
}

export function getTrainingLogForRoom(roomCode: string): GameTrainingTrajectory | null {
  return ROOM_TRAJECTORIES.get(String(roomCode || '').toUpperCase()) ?? null;
}

export function getAllTrainingLogs(): GameTrainingTrajectory[] {
  return [...RECENT_TRAJECTORIES];
}

export function exportTrainingLogsJsonl(roomCode?: string): string {
  if (roomCode) {
    const code = String(roomCode).toUpperCase();
    const single = ROOM_TRAJECTORIES.get(code);
    if (single) return JSON.stringify(single) + '\n';
  }
  return RECENT_TRAJECTORIES.map(t => JSON.stringify(t)).join('\n') + (RECENT_TRAJECTORIES.length ? '\n' : '');
}
