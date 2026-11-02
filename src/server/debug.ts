// MODULE: server debug mode (sandbox grants, forced dice rolls, board piece brush, state/award/supply invariant auditor, and repro snapshot exporter) | DEPENDS ON: packs/base/longestRoad, packs/tidebound/bridges, packs/tidebound/fishing, packs/tidebound/ricketyBridges, packs/tidebound/tech, server/game, +5 more | USED BY: server/socket
import {
  allTechDefs,
  checkWinner,
  currentPlayer,
  getPlayer,
  grantWildToken,
  legalActions,
  makeCtx,
  matchingHexesForRoll,
  placedCount,
  publicVP,
  resolveSeven,
  runProductionPipeline,
  score,
  setPhase,
  updateAwards
} from '../shared';
import type { GameState, Id } from '../shared';
import { longestRoadFor } from '../packs/base/longestRoad';
import { BRIDGE } from '../packs/tidebound/bridges';
import { netLimit, netsLeft, netsOf } from '../packs/tidebound/fishing';
import { bridgesOnBoard, effectiveBridgeSupplyCap, RICKETY, syncBridgePool } from '../packs/tidebound/ricketyBridges';
import { grandCausewayBonusVp, longestRoadHasBridge } from '../packs/tidebound/tech';
import { recordEffects } from './game';
import { gameRegistry } from './runtime';
import { recordTurnHistory, takeNewLogLines } from './turnHistory';
import type { Room } from './types';
import { makeStateBuilder } from './view';

function grantTech(g: GameState, pid: Id, techId: string): void {
  if (!g.ext) g.ext = {};
  if (!g.ext.core) g.ext.core = {};
  if (!g.ext.core.techs) g.ext.core.techs = {};
  const list: string[] = (g.ext.core.techs[pid] ??= []);
  if (!list.includes(techId)) list.push(techId);
}

export interface DebugAuditReport {
  ok: boolean;
  issues: string[];
  playerAudits: {
    id: Id;
    name: string;
    scoreVp: number;
    publicVp: number;
    breakdownSum: number;
    longestRoadLen: number;
    longestRoadHasBridge: boolean;
    grandCausewayBonus: number;
    legalActionCount: number;
  }[];
  legalSpots: {
    settlementVertices: number[];
    cityVertices: number[];
    roadEdges: number[];
    bridgeEdges: number[];
    ricketyEdges: number[];
    netHexes: number[];
    harborVertices: number[];
    portRaiseVertices: number[];
  };
}

/** Runs server-side invariant checks on `g` and returns legal placement spots for `viewerId` so the client can diff its own UI highlights. */
export function auditGameState(room: Room, viewerId: Id): DebugAuditReport {
  const g = room.game;
  if (!g) {
    return {
      ok: true,
      issues: [],
      playerAudits: [],
      legalSpots: {
        settlementVertices: [],
        cityVertices: [],
        roadEdges: [],
        bridgeEdges: [],
        ricketyEdges: [],
        netHexes: [],
        harborVertices: [],
        portRaiseVertices: []
      }
    };
  }

  const reg = gameRegistry(g.rules);
  const ctx = makeCtx(g, reg);
  const buildView = makeStateBuilder(room);
  const issues: string[] = [];
  const playerAudits: DebugAuditReport['playerAudits'] = [];

  // 1. Check Longest Road award holder vs actual longestRoadFor metrics
  let bestRoad = 4;
  for (const p of g.players) {
    const lr = longestRoadFor(ctx, p.id);
    if (lr > bestRoad) bestRoad = lr;
  }
  const lrHolder = g.awards.longestRoad ?? null;
  if (lrHolder) {
    const holderLen = longestRoadFor(ctx, lrHolder);
    if (holderLen < 5) {
      issues.push(`Longest Road holder ${lrHolder} only has road length ${holderLen} (< 5).`);
    } else if (holderLen < bestRoad) {
      issues.push(`Longest Road holder ${lrHolder} has length ${holderLen}, below max ${bestRoad}.`);
    }
  }

  // 2. Per-player score, vpBreakdown sum, and piece supply pool invariants
  for (const p of g.players) {
    const vView = buildView(p.id);
    const pView = vView.players?.find((pl: any) => pl.id === p.id);
    const realVp = score(g, reg, p, true);
    const pubVp = publicVP(g, reg, p);
    const bd: Record<string, number> = pView?.stats?.vpBreakdown ?? {};
    const bdSum = Object.values(bd).reduce((a, b) => a + (Number(b) || 0), 0);
    if (bdSum !== realVp) {
      issues.push(`VP mismatch for ${p.name} (${p.id}): score=${realVp} vs sum(vpBreakdown)=${bdSum}.`);
    }

    // Supply pool checks for base pieces
    for (const pieceId of ['settlement', 'city', 'road']) {
      const cap = g.rules?.pieceLimits?.[pieceId];
      if (typeof cap === 'number') {
        const onBoard = placedCount(g, p.id, pieceId);
        const left = p.pieces[pieceId] ?? 0;
        if (onBoard + left !== cap) {
          issues.push(`Supply mismatch for ${p.name} ${pieceId}: onBoard(${onBoard}) + left(${left}) != cap(${cap}).`);
        }
      }
    }

    // Shared bridge + rickety_bridge pool check when bridges are active
    if (reg.pieces.has(BRIDGE)) {
      const bCap = effectiveBridgeSupplyCap(g, p.id);
      const bOnBoard = bridgesOnBoard(g, p.id);
      const bLeft = p.pieces[BRIDGE] ?? 0;
      if (bOnBoard + bLeft !== bCap) {
        issues.push(`Bridge pool mismatch for ${p.name}: onBoard(${bOnBoard}) + left(${bLeft}) != cap(${bCap}).`);
      }
    }

    // Fishing net tile supply check when nets are active
    if (reg.actions.has('place_net')) {
      const nCap = netLimit(g);
      const nPlaced = netsOf(g, p.id).length;
      const nLeft = netsLeft(g, p.id);
      if (nPlaced + nLeft !== nCap) {
        issues.push(`Net pool mismatch for ${p.name}: placed(${nPlaced}) + left(${nLeft}) != cap(${nCap}).`);
      }
    }

    const lrLen = longestRoadFor(ctx, p.id);
    const hasBr = longestRoadHasBridge(g, reg, p.id);
    const gcBonus = grandCausewayBonusVp(g, reg, p.id);
    const acts = legalActions(g, reg, p.id);

    playerAudits.push({
      id: p.id,
      name: p.name,
      scoreVp: realVp,
      publicVp: pubVp,
      breakdownSum: bdSum,
      longestRoadLen: lrLen,
      longestRoadHasBridge: hasBr,
      grandCausewayBonus: gcBonus,
      legalActionCount: acts.length
    });
  }

  // 3. Extract ground-truth legal placement spots for viewerId (or current player if spectator)
  const targetPid = g.players.some(p => p.id === viewerId) ? viewerId : (currentPlayer(g)?.id ?? g.players[0]?.id);
  const legal = targetPid ? legalActions(g, reg, targetPid) : [];
  const settlementVertices: number[] = [];
  const cityVertices: number[] = [];
  const roadEdges: number[] = [];
  const bridgeEdges: number[] = [];
  const ricketyEdges: number[] = [];
  const netHexes: number[] = [];
  const harborVertices: number[] = [];
  const portRaiseVertices: number[] = [];

  for (const a of legal) {
    if (a.type === 'place_settlement' && Number.isInteger(a.payload?.vertexId)) {
      settlementVertices.push(a.payload.vertexId);
    } else if (a.type === 'place_road' && Number.isInteger(a.payload?.edgeId)) {
      roadEdges.push(a.payload.edgeId);
    } else if (a.type === 'build') {
      const piece = a.payload?.piece;
      const loc = a.payload?.loc;
      if (!Number.isInteger(loc)) continue;
      if (piece === 'settlement') settlementVertices.push(loc);
      else if (piece === 'city') cityVertices.push(loc);
      else if (piece === 'road') roadEdges.push(loc);
      else if (piece === BRIDGE) bridgeEdges.push(loc);
      else if (piece === RICKETY) ricketyEdges.push(loc);
    } else if (a.type === 'place_net' && Number.isInteger(a.payload?.hexId)) {
      netHexes.push(a.payload.hexId);
    } else if (a.type === 'upgrade_harbor' && Number.isInteger(a.payload?.vertexId)) {
      harborVertices.push(a.payload.vertexId);
    } else if (a.type === 'upgrade_port' && Number.isInteger(a.payload?.vertexId)) {
      portRaiseVertices.push(a.payload.vertexId);
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    playerAudits,
    legalSpots: {
      settlementVertices,
      cityVertices,
      roadEdges,
      bridgeEdges,
      ricketyEdges,
      netHexes,
      harborVertices,
      portRaiseVertices
    }
  };
}

/** Applies a sandbox debug command (`grantResources`, `grantFish`, `unlockAllTechs`, `forceRoll`, `paintPiece`) to `room.game`. */
export function applyDebugCommand(
  room: Room,
  actorId: Id,
  cmd: string,
  payload: Record<string, any> = {}
): { ok: boolean; message: string; snapshot?: any } {
  const g = room.game;
  if (!g) return { ok: false, message: 'Start a game first to use in-game debug commands.' };

  const reg = gameRegistry(g.rules);
  const ctx = makeCtx(g, reg);
  const targetPid: Id =
    (typeof payload.playerId === 'string' && g.players.some(p => p.id === payload.playerId) ? payload.playerId : null) ||
    (g.players.some(p => p.id === actorId) ? actorId : null) ||
    currentPlayer(g)?.id ||
    g.players[0].id;
  const p = getPlayer(g, targetPid)!;

  if (cmd === 'grantResources') {
    const amt = Math.max(1, Math.min(50, Number(payload.amount) || 10));
    for (const r of reg.resources.keys()) {
      p.resources[r] = (p.resources[r] || 0) + amt;
      g.bank[r] = Math.max(20, g.bank[r] || 0);
    }
    ctx.log(`🛠️ [Debug] Granted +${amt} of every resource to ${p.name}`, p.color);
    return { ok: true, message: `Granted +${amt} of each resource to ${p.name}` };
  }

  if (cmd === 'grantFish') {
    const amt = Math.max(1, Math.min(20, Number(payload.amount) || 5));
    grantWildToken(ctx, p.id, 'fish', amt);
    ctx.log(`🛠️ [Debug] Granted +${amt} fish to ${p.name}`, p.color);
    return { ok: true, message: `Granted +${amt} fish to ${p.name}` };
  }

  if (cmd === 'unlockAllTechs') {
    g.rules.techTreeOn = true;
    const defs = allTechDefs(g, reg);
    let count = 0;
    for (const id of defs.keys()) {
      grantTech(g, p.id, id);
      count++;
    }
    syncBridgePool(g, p.id);
    updateAwards(ctx);
    checkWinner(ctx);
    ctx.log(`🛠️ [Debug] Unlocked all ${count} techs for ${p.name}`, p.color);
    return { ok: true, message: `Unlocked ${count} techs for ${p.name}` };
  }

  if (cmd === 'forceRoll') {
    const sum = Math.max(2, Math.min(12, Number(payload.sum) || 7));
    const d1 = Math.max(1, Math.min(6, Math.floor(sum / 2)));
    const d2 = sum - d1;
    const roller = currentPlayer(g) ?? p;
    g.dice = [d1, d2];
    g.diceStats[sum] = (g.diceStats[sum] || 0) + 1;
    ctx.log(`🛠️ [Debug] Forced roll ${sum} (${d1} + ${d2}) for ${roller.name}`, roller.color);
    for (const hook of reg.hooks.onRoll) hook(ctx, sum);
    const hexes = sum === 7 ? [] : matchingHexesForRoll(ctx, sum);
    ctx.emit('rolled', { playerId: roller.id, dice: [d1, d2], sum, hexIds: hexes.map(h => h.id) });
    if (sum === 7) {
      resolveSeven(ctx);
    } else {
      runProductionPipeline(ctx, hexes, sum);
      if (g.phase === 'roll') setPhase(ctx, 'main');
    }
    recordEffects(room, ctx.events);
    recordTurnHistory(room, roller.id, 'roll', { forced: sum }, ctx.events, takeNewLogLines(room));
    return { ok: true, message: `Forced dice roll ${sum} (${d1}+${d2})` };
  }

  if (cmd === 'paintPiece') {
    const brush = String(payload.brush || '');
    const targetType = String(payload.targetType || '');
    const id = Number(payload.id);
    if (!Number.isInteger(id)) return { ok: false, message: 'Invalid board target id' };

    if (targetType === 'vertex') {
      const v = g.board.vertices[id];
      if (!v) return { ok: false, message: `Unknown vertex V${id}` };
      if (brush === 'clear') {
        v.piece = undefined;
      } else if (brush === 'settlement' || brush === 'city') {
        v.piece = { type: brush, owner: p.id };
      }
      for (const pl of g.players) {
        for (const pieceId of ['settlement', 'city']) {
          const cap = g.rules?.pieceLimits?.[pieceId] ?? (pieceId === 'city' ? 4 : 5);
          pl.pieces[pieceId] = Math.max(0, cap - placedCount(g, pl.id, pieceId));
        }
      }
      updateAwards(ctx);
      checkWinner(ctx);
      return { ok: true, message: `Updated V${id} (${brush})` };
    }

    if (targetType === 'edge') {
      const e = g.board.edges[id];
      if (!e) return { ok: false, message: `Unknown edge E${id}` };
      if (brush === 'clear') {
        e.piece = null;
      } else if (brush === 'road' || brush === BRIDGE || brush === RICKETY) {
        e.piece = { type: brush, owner: p.id };
      }
      for (const pl of g.players) {
        const rCap = g.rules?.pieceLimits?.road ?? 15;
        pl.pieces.road = Math.max(0, rCap - placedCount(g, pl.id, 'road'));
        syncBridgePool(g, pl.id);
      }
      updateAwards(ctx);
      checkWinner(ctx);
      return { ok: true, message: `Updated E${id} (${brush})` };
    }

    if (targetType === 'hex') {
      const h = g.board.hexes[id];
      if (!h) return { ok: false, message: `Unknown hex H${id}` };
      h.ext = h.ext || {};
      if (brush === 'clear') {
        delete h.ext.net;
        delete h.ext.pirate;
        delete h.ext.wreck;
      } else if (brush === 'net') {
        h.ext.net = { owner: p.id };
      } else if (brush === 'pirate') {
        h.ext.pirate = { strength: 2, spawnedRound: g.round || 1 };
      } else if (brush === 'wreck_sea') {
        h.ext.wreck = { id: `dbg_w_${id}`, site: 'sea', shoreDir: null, expiresOnRound: (g.round || 1) + 2 };
      } else if (brush === 'wreck_shore') {
        h.ext.wreck = { id: `dbg_w_${id}`, site: 'shore', shoreDir: 0, expiresOnRound: (g.round || 1) + 1 };
      } else if (brush === 'robber') {
        g.board.robberHexId = id;
      }
      return { ok: true, message: `Updated H${id} (${brush})` };
    }
  }

  if (cmd === 'exportSnapshot') {
    const snapshot = {
      code: room.code,
      seed: g.seed,
      phase: g.phase,
      round: g.round,
      turn: g.turn,
      turnCount: g.turnCount,
      rules: g.rules,
      awards: g.awards,
      players: g.players.map(pl => ({
        id: pl.id,
        name: pl.name,
        isBot: pl.isBot,
        resources: pl.resources,
        pieces: pl.pieces,
        stats: pl.stats,
        techs: g.ext?.core?.techs?.[pl.id] ?? []
      })),
      placedPieces: {
        vertices: g.board.vertices.filter(v => v.piece).map(v => ({ id: v.id, piece: v.piece })),
        edges: g.board.edges.filter(e => e.piece).map(e => ({ id: e.id, piece: e.piece })),
        nets: g.board.hexes.filter(h => h.ext?.net).map(h => ({ id: h.id, net: h.ext.net }))
      }
    };
    return { ok: true, message: 'Copied debug repro snapshot', snapshot };
  }

  return { ok: false, message: `Unknown debug command "${cmd}"` };
}
