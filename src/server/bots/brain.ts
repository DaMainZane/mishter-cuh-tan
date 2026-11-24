// MODULE: bot brain (pure: game state -> the one action a bot wants to take; reads the bot's tier, the map profile and grudges; no timers, no sockets) | DEPENDS ON: packs/base/building, packs/base/constants, packs/base/techEffects, packs/base/trading, server/bots/mapProfile, server/bots/tiers, +2 more | USED BY: server/bots/scheduler, server/bots/sim, server/game
import {
  allTechDefs,
  botGoalActionScore,
  botGoalEdgeDelta,
  canPlacePiece,
  botGoalEdgeReach,
  botGoalMainPortUpgrades,
  botGoalPortUpgradeOnSettlement,
  botGoalTechValue,
  botGoalThreatDelta,
  botGoalVertexDelta,
  botGoalWantsKnight,
  checkAction,
  defaultTechPayment,
  effectiveDiscardLimit,
  evaluateBotGoals,
  getPlayer,
  hasBotGoals,
  hasTech,
  legalActions,
  makeCtx,
  priceOfUpgrade,
  ratioFor,
  score,
  techCostCards,
  techPrereqs,
  techResearchCheck,
  totalCards
} from '../../shared';
import type { Ctx, GameEvent, GameState, Id, PlayerState, Registry, Resources, TradeState } from '../../shared';
import { pieceCost } from '../../packs/base/building';
import { CITY, ROAD, SETTLEMENT } from '../../packs/base/constants';
import {
  HARBOR_UPGRADE_COST,
  PORT_UPGRADE_ID,
  portUpgrades,
  TECH_GROUND_WORK,
  TECH_HARBOR_CHARTERS,
  TECH_PLUNDER,
  TECH_ROAD_LEVY,
  TECH_STOCKPILING
} from '../../packs/base/techEffects';
import { openTrades, tradeRatios } from '../../packs/base/trading';
import { getPips } from '../util';
import { getMapProfile } from './mapProfile';
import type { MapProfile } from './mapProfile';
import { hash01, personalityOf, spendThreshold, tierFromDifficulty, tierProfile } from './tiers';
import type { Personality, TierProfile } from './tiers';

export interface BotMove { type: string; payload: any }
export type Rand = () => number;

interface Legal { type: string; payload: any }
type HexT = GameState['board']['hexes'][number];

interface Plan {
  type: 'city' | 'settlement' | 'dev' | 'road' | 'goal';
  id?: string;
  priority: number;
  cost: Resources;
  /** One entry per missing card. */
  missing: string[];
  action?: BotMove;
}

/** Award minimums of the base pack (packs/base/awards.ts). */
const ARMY_MIN = 3;
const ROAD_MIN = 5;

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

// ---- Memory (grudges and per-turn counters; filled from engine events) ----------------------------

interface BotMem {
  /** Robbers and who robbed me: player id -> weight. */
  grudge: Record<Id, number>;
  turn: number;
  proposals: number;
  counters: number;
  /** Turn on which this bot last made a bank trade (so the "mistake" swap happens at most once and never after a real swap). */
  tellTurn: number;
}

const MEMORY = new WeakMap<GameState, Map<Id, BotMem>>();

function memOf(g: GameState, pid: Id): BotMem {
  let all = MEMORY.get(g);
  if (!all) { all = new Map(); MEMORY.set(g, all); }
  let m = all.get(pid);
  if (!m) { m = { grudge: {}, turn: g.turnCount, proposals: 0, counters: 0, tellTurn: -1 }; all.set(pid, m); }
  if (m.turn !== g.turnCount) { m.turn = g.turnCount; m.proposals = 0; m.counters = 0; }
  return m;
}

/**
 * Feeds engine events to the bots' memory (who robbed whom, offers made this turn, bank trades).
 * Call it after every successful dispatch. The brain still works without it, only without grudges and with
 * the per-turn offer limit falling back to "one offer per turn".
 */
export function noteBotEvents(g: GameState, events: GameEvent[] | undefined): void {
  if (!events) return;
  for (const ev of events) {
    const d: any = ev.data ?? {};
    if (ev.type === 'transferred' && d.kind === 'steal') {
      if (getPlayer(g, d.from)?.isBot && d.to) {
        const m = memOf(g, d.from);
        m.grudge[d.to] = (m.grudge[d.to] || 0) + 1;
      }
    } else if (ev.type === 'transferred' && d.kind === 'bankTrade') {
      for (const id of [d.from, d.to]) if (id && getPlayer(g, id)?.isBot) memOf(g, id).tellTurn = g.turnCount;
    } else if (ev.type === 'robberMoved') {
      const hex = g.board.hexes[d.to];
      if (!hex) continue;
      for (const vId of hex.vertexIds) {
        const owner = g.board.vertices[vId]?.piece?.owner;
        if (owner && owner !== d.playerId && getPlayer(g, owner)?.isBot) {
          const m = memOf(g, owner);
          m.grudge[d.playerId] = (m.grudge[d.playerId] || 0) + 0.5;
        }
      }
    } else if (ev.type === 'tradeProposed' && d.playerId) {
      memOf(g, d.playerId).proposals++;
    } else if (ev.type === 'tradeCountered' && d.playerId) {
      memOf(g, d.playerId).counters++;
    }
  }
}

// ---- Decision context ---------------------------------------------------------------------------------

interface Dc {
  g: GameState;
  reg: Registry;
  ctx: Ctx;
  p: PlayerState;
  legal: Legal[];
  rand: Rand;
  tier: TierProfile;
  mp: MapProfile;
  mem: BotMem;
  personality: Personality;
  win: number;
  limit: number;
  /** Cards above which the bot starts spending or swapping (spendDiscipline). */
  threshold: number;
  /** Players at or below this VP are spared by tiers with mercy. */
  mercyVp: number;
  vps: Map<Id, number>;
  myVp: number;
  leaderId: Id | null;
  leaderVp: number;
  /** The human every coordinating bot leans on (null when the tier does not coordinate). */
  pressureId: Id | null;
  /** Aggression multiplier: Overload presses harder when behind, Main eases off when far ahead. */
  pressureMult: number;
  /** My production pips per resource. */
  prod: Record<string, number>;
  /** Settlements and cities I have on the board. */
  placed: number;
  /** Vertices that carry my pieces or the ends of my roads. */
  net: Set<number>;
  plans?: Plan[];
  landlocked?: boolean;
  placeMemo: Map<string, number[]>;
  vertexMemo: Map<number, number>;
  spotMemo: Map<number, boolean>;
  oppProd: Map<Id, Record<string, number>>;
}

const resIds = (reg: Registry): string[] => [...reg.resources.keys()];
const isHidden = (h: HexT): boolean => !!h.ext?.hidden;

/** A numbered land tile without its own resource (gold): the registry says "special", not a hard-coded id. */
function isWild(reg: Registry, type: string): boolean {
  const t = reg.tiles.get(type);
  return !!t && t.land && t.numbered && !t.produces;
}

/** Pips per resource from a player's pieces (settlement x1, city x2), revealed tiles only. */
function pipsOfPlayer(g: GameState, reg: Registry, pid: Id): Record<string, number> {
  const prod: Record<string, number> = Object.fromEntries(resIds(reg).map(r => [r, 0]));
  for (const v of g.board.vertices) {
    if (!v.piece || v.piece.owner !== pid) continue;
    const mult = reg.pieces.get(v.piece.type)?.produces || 0;
    if (!mult) continue;
    for (const hId of v.hexIds) {
      const h = g.board.hexes[hId];
      if (!h || isHidden(h)) continue;
      const res = reg.tiles.get(h.type)?.produces;
      if (res) prod[res] += getPips(h.number) * mult;
    }
  }
  return prod;
}

function makeDc(g: GameState, reg: Registry, p: PlayerState, legal: Legal[], rand: Rand): Dc {
  const tier = tierProfile(tierFromDifficulty(p.difficulty));
  const win = g.rules.vpToWin;
  const limit = g.rules?.techTreeOn || (g.rules?.catchUpMode && g.rules.catchUpMode !== 'off')
    ? effectiveDiscardLimit(g, reg, p)
    : g.rules.discardLimit;

  const vps = new Map<Id, number>();
  // A bot sees its own hidden VP and only the public score of everyone else.
  for (const o of g.players) vps.set(o.id, score(g, reg, o, o.id === p.id));
  const myVp = vps.get(p.id) ?? 0;
  let leaderId: Id | null = null;
  let leaderVp = 0;
  let humanLeader: Id | null = null;
  let humanVp = 0;
  for (const o of g.players) {
    if (o.id === p.id) continue;
    const vp = vps.get(o.id) ?? 0;
    if (vp > leaderVp) { leaderVp = vp; leaderId = o.id; }
    if (!o.isBot && vp > humanVp) { humanVp = vp; humanLeader = o.id; }
  }
  const pressureId = tier.coordination && humanLeader && humanVp >= Math.max(3, Math.round(win * 0.4)) ? humanLeader : null;
  let pressureMult = 1;
  if (tier.id === 'overload' && myVp + 2 <= leaderVp) pressureMult = 1.3;
  if (tier.id === 'main' && myVp >= leaderVp + 2) pressureMult = 0.7;

  const net = new Set<number>();
  let placed = 0;
  for (const v of g.board.vertices) {
    if (v.piece?.owner === p.id) { net.add(v.id); placed++; }
  }
  for (const e of g.board.edges) {
    if (e.piece?.owner === p.id) { net.add(e.v1); net.add(e.v2); }
  }

  return {
    g, reg, ctx: makeCtx(g, reg), p, legal, rand, tier,
    mp: getMapProfile(g, reg),
    mem: memOf(g, p.id),
    personality: personalityOf(p.id),
    win, limit,
    threshold: spendThreshold(tier, limit),
    mercyVp: Math.max(2, Math.round(win * 0.2)),
    vps, myVp, leaderId, leaderVp, pressureId, pressureMult,
    prod: pipsOfPlayer(g, reg, p.id),
    placed, net,
    placeMemo: new Map(), vertexMemo: new Map(), spotMemo: new Map(), oppProd: new Map()
  };
}

function oppProd(dc: Dc, pid: Id): Record<string, number> {
  let v = dc.oppProd.get(pid);
  if (!v) { v = pipsOfPlayer(dc.g, dc.reg, pid); dc.oppProd.set(pid, v); }
  return v;
}

/** How many cards of `r` the bot believes `o` holds. Public: even split. Estimate: split by production. Full: the truth. */
function holdingGuess(dc: Dc, o: PlayerState, r: string): number {
  const n = totalCards(o);
  if (n === 0) return 0;
  if (dc.tier.info === 'full') return o.resources[r] || 0;
  const kinds = resIds(dc.reg).length || 1;
  if (dc.tier.info === 'public') return n / kinds;
  const prod = oppProd(dc, o.id);
  const total = Object.values(prod).reduce((a, b) => a + b, 0);
  const share = total > 0 ? (prod[r] || 0) / total : 1 / kinds;
  return n * (0.35 / kinds + 0.65 * share);
}

function lockdownOn(dc: Dc, pid: Id): boolean {
  if (!dc.tier.lockdown) return false;
  const o = getPlayer(dc.g, pid);
  return !!o && !o.isBot && (dc.vps.get(pid) ?? 0) >= Math.ceil(dc.win * 0.7);
}

/** Refuse trades from anyone at or above this VP: a fraction of vpToWin, never below 4, never above win-1. */
function leaderCutoff(dc: Dc): number {
  return Math.min(dc.win - 1, Math.max(4, Math.ceil(dc.win * dc.tier.leaderFrac)));
}

// ---- Picking ---------------------------------------------------------------------------------------------

function pickBest<T>(items: T[], score: (item: T) => number): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const it of items) {
    const s = score(it);
    if (s > bestScore) { bestScore = s; best = it; }
  }
  return best;
}

/** Best item by score, with the tier's jitter, and sometimes the 2nd or 3rd best (a human-sized blunder). */
function choose<T>(dc: Dc, items: T[], score: (item: T) => number): T | null {
  if (items.length === 0) return null;
  const noise = dc.tier.placementNoise;
  const scored = items.map(it => ({ it, s: score(it) + (noise > 0 ? dc.rand() * noise : 0) }));
  scored.sort((a, b) => b.s - a.s);
  if (scored.length > 1 && dc.tier.blunderChance > 0 && dc.rand() < dc.tier.blunderChance) {
    return scored[Math.min(scored.length - 1, dc.rand() < 0.5 ? 1 : 2)].it;
  }
  return scored[0].it;
}

/** Keeps the best `k` items by a cheap score, so big boards do not pay for full scoring everywhere. */
function prune<T>(items: T[], cheap: (item: T) => number, k = 60): T[] {
  if (items.length <= k) return items;
  return items.map(it => ({ it, s: cheap(it) })).sort((a, b) => b.s - a.s).slice(0, k).map(x => x.it);
}

function cheapVertex(dc: Dc, vId: number): number {
  const v = dc.g.board.vertices[vId];
  if (!v) return -1;
  let s = v.port ? 1.5 : 0;
  for (const hId of v.hexIds) {
    const h = dc.g.board.hexes[hId];
    if (h) s += isHidden(h) ? 2 : getPips(h.number);
  }
  return s;
}

function cheapEdge(dc: Dc, eId: number): number {
  const e = dc.g.board.edges[eId];
  return Math.max(cheapVertex(dc, e.v1), cheapVertex(dc, e.v2));
}

function missingFor(have: Resources, cost: Resources): string[] {
  const out: string[] = [];
  for (const [r, need] of Object.entries(cost)) {
    for (let i = have[r] || 0; i < need; i++) out.push(r);
  }
  return out;
}

// ---- Board access --------------------------------------------------------------------------------------

/**
 * Board locations (vertex or edge ids) where this player could place a piece, ignoring cost.
 * Only slots next to the bot's own network are tested (a connected piece can only go there), so a huge
 * board costs about as much as a small one. With no pieces yet, every slot is tested.
 */
function placeable(dc: Dc, pieceId: string): number[] {
  const hit = dc.placeMemo.get(pieceId);
  if (hit) return hit;
  const def = dc.reg.pieces.get(pieceId);
  let out: number[] = [];
  if (def && (dc.p.pieces[pieceId] || 0) > 0) {
    const { vertices, edges } = dc.g.board;
    let cand: number[];
    if (dc.net.size === 0) {
      cand = (def.target === 'vertex' ? vertices : edges).map(s => s.id);
    } else if (def.target === 'vertex') {
      const s = new Set<number>(dc.net);
      for (const id of dc.net) for (const n of vertices[id].adjacentVertices) s.add(n);
      cand = [...s];
    } else {
      const s = new Set<number>();
      for (const id of dc.net) for (const eId of vertices[id].edgeIds) s.add(eId);
      cand = [...s];
    }
    out = cand.filter(id => canPlacePiece(dc.ctx, dc.p.id, def, id, 'build'));
  }
  dc.placeMemo.set(pieceId, out);
  return out;
}

/** Could a settlement go here if a road led to it? (distance rule and free spot only) */
function isSpot(dc: Dc, vId: number): boolean {
  const hit = dc.spotMemo.get(vId);
  if (hit !== undefined) return hit;
  const def = dc.reg.pieces.get(SETTLEMENT);
  const ok = !!def && canPlacePiece(dc.ctx, dc.p.id, def, vId, 'setup');
  dc.spotMemo.set(vId, ok);
  return ok;
}

/** Is there a settlement spot within a few roads/bridges of my network? False means the bot is boxed in (islands, walls). */
function hasReachableSpot(dc: Dc): boolean {
  if (dc.net.size === 0) return true;
  const roads = dc.p.pieces[ROAD] || 0;
  // Edge pieces besides roads (bridges) come from content through the registry, with the empty edges they can cross.
  const reach = botGoalEdgeReach(dc.ctx, dc.p.id);
  const totalSteps = roads + reach.steps;
  if (totalSteps <= 0) return false;
  const depth = clamp(totalSteps, 1, 6);
  const { vertices, edges } = dc.g.board;
  let frontier = [...dc.net];
  const seen = new Set(frontier);
  for (let d = 0; d <= depth; d++) {
    const next: number[] = [];
    for (const vId of frontier) {
      if (!vertices[vId].piece && isSpot(dc, vId)) return true;
      if (d === depth) continue;
      for (const eId of vertices[vId].edgeIds) {
        const e = edges[eId];
        if (e.piece && e.piece.owner !== dc.p.id) continue;
        if (!e.piece) {
          // A road goes on an edge that touches a tile; any other empty edge needs a registry piece that can cross it.
          const touchesTile = e.hexIds.length > 0;
          if (!(touchesTile && roads > 0) && !reach.crosses(eId)) continue;
        }
        const other = e.v1 === vId ? e.v2 : e.v1;
        if (!seen.has(other)) { seen.add(other); next.push(other); }
      }
    }
    frontier = next;
  }
  return false;
}

function landmassOfVertex(dc: Dc, vId: number): number {
  for (const hId of dc.g.board.vertices[vId].hexIds) {
    const c = dc.mp.landOfHex[hId];
    if (c !== undefined && c >= 0) return c;
  }
  return -1;
}

/** Free settlement spots two steps away (the next legal neighbours), a measure of room to grow. */
function roomAround(dc: Dc, vId: number): number {
  const { vertices } = dc.g.board;
  const free = (u: number): boolean => !vertices[u].piece && vertices[u].adjacentVertices.every(w => !vertices[w].piece) && landmassOfVertex(dc, u) >= 0;
  const seen = new Set<number>([vId]);
  const ring1 = vertices[vId].adjacentVertices;
  for (const a of ring1) seen.add(a);
  let n = 0;
  for (const a of ring1) {
    for (const b of vertices[a].adjacentVertices) {
      if (seen.has(b)) continue;
      seen.add(b);
      if (free(b)) n++;
    }
  }
  return n;
}

// ---- Scoring -------------------------------------------------------------------------------------------

function goldValue(dc: Dc, missingKinds: number): number {
  // Rarer gold is worth more, and so is gold when the bot lacks resources. Flat values broke Gold Rush (a third of the map).
  return 3 + 4 * (1 - Math.min(1, dc.mp.goldShare * 2.5)) + Math.min(2, 0.5 * missingKinds);
}

function portValue(dc: Dc, portId: string, prod: Record<string, number>, here: Record<string, number>, boost: boolean): number {
  const port = dc.reg.ports.get(portId);
  if (!port) return 0;
  // Port count grows with the board, so each port is worth a little less on big maps.
  const scale = clamp(1.25 - dc.mp.portCount / Math.max(1, dc.g.players.length * 6), 0.75, 1.25)
    * (dc.personality === 'portTrader' ? 1.5 : 1) * (boost ? 1.25 : 1);
  if (port.resource === null) return 4.5 * scale;
  const have = (prod[port.resource] || 0) + (here[port.resource] || 0);
  return have > 0 ? Math.min(6.5, 2 + have * 0.7) * scale : 0;
}

/** Taking a spot an opponent needs. Secondary: the leader's obvious next spot. Overload: the leader's best expansion and anyone close. */
function blockBonus(dc: Dc, vertexId: number, base: number): number {
  if (base <= 0) return 0;
  const { g, tier } = dc;
  const depth = tier.blocking === 2 ? 2 : 1;
  const owners = new Set<Id>();
  let frontier = [vertexId];
  const seen = new Set<number>(frontier);
  for (let d = 0; d <= depth; d++) {
    const next: number[] = [];
    for (const id of frontier) {
      const vv = g.board.vertices[id];
      const pc = vv.piece?.owner;
      if (pc && pc !== dc.p.id) owners.add(pc);
      for (const eId of vv.edgeIds) {
        const eo = g.board.edges[eId].piece?.owner;
        if (eo && eo !== dc.p.id) owners.add(eo);
      }
      if (d < depth) for (const n of vv.adjacentVertices) if (!seen.has(n)) { seen.add(n); next.push(n); }
    }
    frontier = next;
  }
  let w = 0;
  for (const o of owners) {
    const vp = dc.vps.get(o) ?? 0;
    if (tier.mercy && vp <= dc.mercyVp) continue;
    if (tier.blocking === 1) { if (o === dc.leaderId) w += 0.22; continue; }
    w += o === dc.leaderId ? 0.35 : 0.1;
    if (o === dc.pressureId) w += 0.2;
    if (lockdownOn(dc, o)) w += 0.3;
  }
  return Math.min(12, base * w * dc.pressureMult);
}

/** Overload: a spot where the Longest Road holder's road continues is worth a bonus (it breaks the road). */
function cutBonus(dc: Dc, vertexId: number): number {
  const holder = dc.g.awards.longestRoad;
  if (!holder || holder === dc.p.id) return 0;
  const v = dc.g.board.vertices[vertexId];
  if (v.piece) return 0;
  let n = 0;
  for (const eId of v.edgeIds) if (dc.g.board.edges[eId].piece?.owner === holder) n++;
  return n >= 2 ? 8 : 0;
}

/** Value of putting a settlement on this vertex, from the bot's point of view (fog, gold, ports, scarcity, starting hand and room follow the tier and the map). */
function vertexScore(dc: Dc, vertexId: number, prod: Record<string, number> = dc.prod): number {
  const own = prod === dc.prod;
  if (own) {
    const hit = dc.vertexMemo.get(vertexId);
    if (hit !== undefined) return hit;
  }
  const { g, reg, tier, mp } = dc;
  const v = g.board.vertices[vertexId];
  if (!v) return -999;

  const peek = tier.info === 'full' && tier.fogMode === 2;
  const lastRoll = (g.dice?.[0] || 0) + (g.dice?.[1] || 0);
  const ids = resIds(reg);
  const missingKinds = ids.filter(r => (prod[r] || 0) === 0).length;
  const isSetup = g.phase.startsWith('setup');
  const isSecondSetup = isSetup && (!own || dc.placed === 1);
  const boost = tier.setupPlanning >= 1 && isSecondSetup;

  let score = 0;
  let totalPips = 0;
  let productiveHexes = 0;
  const types = new Set<string>();
  const numbers = new Set<number>();
  const here: Record<string, number> = {};
  const startCards: Record<string, number> = {};

  for (const hId of v.hexIds) {
    const h = g.board.hexes[hId];
    const tile = h ? reg.tiles.get(h.type) : undefined;
    if (!h || !tile) continue;
    let reveal = 0;
    if (isHidden(h)) {
      if (!peek) {
        // Main stays away from fog. Secondary values it as the average revealed tile plus the one-production reveal payout.
        score += tier.fogMode === 0 ? -1.0 : (mp.avgPips * 3.0 + 3.0) * 0.85;
        continue;
      }
      reveal = 3.0; // Overload reads the real tile and adds the reveal payout.
    }
    if (!tile.land || !tile.numbered) continue;

    const pp = getPips(h.number);
    totalPips += pp;
    productiveHexes++;
    score += reveal + pp * 3.0;
    if (tier.hotNumbers && h.number && h.number === lastRoll) score += 2.0;

    if (isWild(reg, h.type)) {
      score += goldValue(dc, missingKinds);
    } else if (tile.produces) {
      const r = tile.produces;
      types.add(r);
      here[r] = (here[r] || 0) + pp;
      startCards[r] = (startCards[r] || 0) + 1;
      if ((prod[r] || 0) === 0) score += 5.5 + (boost ? 3.5 : 0); // a resource I do not make yet
      if (r === 'wheat' || r === 'ore') score += 1.5;
      // Scarcity on the current board: locking down a scarce resource is worth much more in setup and early expansion.
      if (tier.setupPlanning >= 1 && (mp.scarcityBonus[r] || 0) > 0) {
        score += mp.scarcityBonus[r] * (pp / 3.0) * (tier.setupPlanning === 2 ? 1.25 : 0.9);
      }
    }
    if (h.number) {
      if (numbers.has(h.number)) score -= 1.8;
      numbers.add(h.number);
    }
  }

  // Volume & number spread bonus for 3-hex intersections with strong total pip output
  if (productiveHexes === 3 && totalPips >= 9) score += 2.0;
  if (numbers.size === 3) score += 1.5;

  score += types.size * 3.5;
  const has = (r: string): boolean => (prod[r] || 0) > 0 || types.has(r);
  if (has('wood') && has('brick')) score += 4.5;
  if (has('wheat') && has('ore')) score += 5.5;
  if (has('wheat') && has('ore') && has('sheep')) score += 2.5;

  // Setup-specific strategic evaluation: 2nd settlement starting hand tempo & full resource coverage
  if (boost) {
    // 2nd settlement grants 1 starting resource card from each adjacent producing hex
    if ((startCards.wood || 0) >= 1 && (startCards.brick || 0) >= 1) {
      score += 3.5; // Immediate Turn 1 road in hand to race for an expansion spot
    }
    if ((startCards.wheat || 0) >= 1 && (startCards.ore || 0) >= 1 && (startCards.sheep || 0) >= 1) {
      score += 3.0; // Immediate Turn 1 dev card in hand
    }
    const settleHandParts = ['wood', 'brick', 'sheep', 'wheat'].filter(r => (startCards[r] || 0) >= 1).length;
    if (settleHandParts >= 3) {
      score += 2.5; // 3/4 of a settlement already in starting hand
    }
    // Anchor check: having zero wheat production across both setup settlements cripples settlements, cities, and devs
    if (!has('wheat')) score -= 4.5;
    // Reward covering 4 or all 5 resources across the two opening settlements
    const coveredCount = ids.filter(r => has(r)).length;
    if (coveredCount >= 5) score += 4.0;
    else if (coveredCount === 4) score += 2.0;
  }

  if (v.port) {
    score += portValue(dc, v.port, prod, here, boost);
  } else if (tier.setupPlanning >= 1) {
    // A matching 2:1 or 3:1 port one or two steps away is valuable if reachable by the setup road.
    for (const n of v.adjacentVertices) {
      const np = g.board.vertices[n].port;
      const port = np ? reg.ports.get(np) : undefined;
      if (port) {
        if (port.resource && types.has(port.resource)) score += 1.8;
        else if (port.resource === null) score += 0.8;
      }
    }
  }

  if (tier.roomWeight > 0) {
    score += tier.roomWeight * roomAround(dc, vertexId);
    const comp = landmassOfVertex(dc, vertexId);
    if (comp >= 0) score += tier.roomWeight * 4 * clamp(mp.landmassSize[comp] / (g.players.length * 3), 0, 1);
  }
  if (tier.blocking > 0) score += blockBonus(dc, vertexId, score);
  if (tier.awardChase === 2) score += cutBonus(dc, vertexId);
  if (hasBotGoals(reg)) score += botGoalVertexDelta(dc.ctx, dc.p.id, vertexId, tier.id);

  if (own) dc.vertexMemo.set(vertexId, score);
  return score;
}

/** Value of upgrading one of my settlements: the production it doubles. */
function cityScore(dc: Dc, vertexId: number): number {
  const v = dc.g.board.vertices[vertexId];
  let score = 0;
  for (const hId of v.hexIds) {
    const h = dc.g.board.hexes[hId];
    const tile = h ? dc.reg.tiles.get(h.type) : undefined;
    if (!h || !tile || isHidden(h) || !tile.land || !tile.numbered) continue;
    score += getPips(h.number) * 3.0 + (tile.produces === 'wheat' || tile.produces === 'ore' ? 1.5 : 0);
  }
  return score;
}

function addPips(dc: Dc, vId: number): Record<string, number> {
  const out = { ...dc.prod };
  for (const hId of dc.g.board.vertices[vId].hexIds) {
    const h = dc.g.board.hexes[hId];
    if (!h || isHidden(h)) continue;
    const res = dc.reg.tiles.get(h.type)?.produces;
    if (res) out[res] = (out[res] || 0) + getPips(h.number);
  }
  return out;
}

/**
 * Snake-draft opening planner: judges the first settlement together with realistic partner spots for the second settlement,
 * accounting for how many opponent settlements will be drafted before this bot picks again.
 */
function planOpening(dc: Dc, spots: Legal[]): Legal | null {
  const { g, tier } = dc;
  const cheap = (a: Legal): number => cheapVertex(dc, a.payload.loc);
  const firsts = prune(spots, cheap, tier.setupPlanning === 2 ? 28 : 18);
  const partners = prune(spots, cheap, 44);

  // Count how many opponent settlements will be placed between our 1st pick and our 2nd pick in the snake draft.
  let picksBetween = Math.max(0, g.players.length - 1);
  if (g.setup?.order) {
    const curStep = g.setup.step;
    const myTurnIdx = g.turn;
    for (let idx = curStep + 1; idx < g.setup.order.length; idx++) {
      if (g.setup.order[idx] === myTurnIdx) {
        picksBetween = idx - curStep - 1;
        break;
      }
    }
  }
  // If picking back-to-back at the snake turn (picksBetween === 0), the #1 non-overlapping partner is guaranteed!
  // Otherwise opponents will likely take some of the top spots before our turn comes back.
  const expectedRankIdx = Math.min(8, Math.floor(picksBetween * 0.75));
  const partnerWeight = picksBetween === 0 ? 0.92 : clamp(0.78 - picksBetween * 0.04, 0.52, 0.78);

  let best: Legal | null = null;
  let bestScore = -Infinity;
  for (const a of firsts) {
    const v1 = g.board.vertices[a.payload.loc];
    const after = addPips(dc, v1.id);
    const near = new Set<number>([v1.id, ...v1.adjacentVertices]);
    const partnerScores: number[] = [];
    for (const b of partners) {
      if (near.has(b.payload.loc)) continue;
      partnerScores.push(vertexScore(dc, b.payload.loc, after));
    }
    partnerScores.sort((x, y) => y - x);
    const topPartner = partnerScores[0] ?? 0;
    const realisticPartner = partnerScores[Math.min(partnerScores.length - 1, expectedRankIdx)] ?? topPartner;
    const second = picksBetween === 0 ? topPartner : 0.35 * topPartner + 0.65 * realisticPartner;

    const s = vertexScore(dc, v1.id) + partnerWeight * second;
    if (s > bestScore) { bestScore = s; best = a; }
  }
  return best;
}

function roadScore(dc: Dc, edgeId: number): number {
  const { g, tier } = dc;
  const e = g.board.edges[edgeId];
  const setup = g.phase.startsWith('setup');
  const fogBonus = tier.fogMode === 0 ? 0 : tier.fogMode === 2 ? 10 : (setup || placeable(dc, SETTLEMENT).length > 0 ? 3 : 14);

  // During `setup_road`, one endpoint is the settlement just placed (`lastVertexId`) and the other is `step1`
  // (1 edge away, where a settlement can never be built due to the distance rule). Score the 2-edge and 3-edge
  // expansion spots reachable from `step1` so the setup road points toward the best open expansion corridor!
  if (setup && g.setup.lastVertexId !== null) {
    const originId = g.setup.lastVertexId;
    const step1Id = e.v1 === originId ? e.v2 : e.v1;
    const step1 = g.board.vertices[step1Id];
    if (!step1) return -999;

    let setupScore = 0;
    for (const hId of step1.hexIds) if (g.board.hexes[hId] && isHidden(g.board.hexes[hId])) setupScore += fogBonus;
    if (step1.port) setupScore += portValue(dc, step1.port, dc.prod, {}, true) * 0.5;

    let bestStep2 = 0;
    let openStep2Count = 0;
    let bestStep3 = 0;

    for (const step2Id of step1.adjacentVertices) {
      if (step2Id === originId) continue;
      const step2 = g.board.vertices[step2Id];
      if (!step2) continue;

      if (isSpot(dc, step2Id)) {
        openStep2Count++;
        const s2 = 36 + vertexScore(dc, step2Id) + (tier.roadPlanning === 2 ? contested(dc, step2Id) * 0.8 : 0);
        if (s2 > bestStep2) bestStep2 = s2;
      }

      if (tier.roadPlanning >= 1 && (!step2.piece || step2.piece.owner === dc.p.id)) {
        for (const step3Id of step2.adjacentVertices) {
          if (step3Id === step1Id || step3Id === originId) continue;
          if (isSpot(dc, step3Id)) {
            const s3 = 18 + vertexScore(dc, step3Id) * 0.65;
            if (s3 > bestStep3) bestStep3 = s3;
          }
        }
      }
    }

    setupScore += bestStep2 + openStep2Count * 6 + bestStep3 * 0.55;
    if (openStep2Count === 0 && bestStep3 === 0) {
      setupScore -= 25; // Avoid pointing the initial road into a blocked dead end or coastal corner
    }
    return setupScore;
  }

  let score = 0;
  for (const endId of [e.v1, e.v2]) {
    const end = g.board.vertices[endId];
    if (!end) continue;
    for (const hId of end.hexIds) if (g.board.hexes[hId] && isHidden(g.board.hexes[hId])) score += fogBonus;
    if (isSpot(dc, endId)) {
      score += 40 + vertexScore(dc, endId);
      if (tier.roadPlanning === 2) score += contested(dc, endId);
    }
    // Spots one more step away. Main only half-sees them (it heads for the nearest decent spot), the others plan within 2 roads.
    const reach = tier.roadPlanning === 0 ? 0.5 : 1;
    for (const next of end.adjacentVertices) {
      if (!isSpot(dc, next)) continue;
      score += (18 + vertexScore(dc, next) * 0.6) * reach;
      if (tier.roadPlanning === 2) score += contested(dc, next) * 0.6;
    }
  }
  if (hasBotGoals(dc.reg)) score += botGoalEdgeDelta(dc.ctx, dc.p.id, edgeId, tier.id);
  return score;
}

/** Overload cuts off a spot an opponent is also heading for: a bonus per opponent piece or road within two steps. */
function contested(dc: Dc, vId: number): number {
  const { g } = dc;
  let n = 0;
  const seen = new Set<number>([vId]);
  let frontier = [vId];
  for (let d = 0; d < 2; d++) {
    const next: number[] = [];
    for (const id of frontier) {
      for (const nb of g.board.vertices[id].adjacentVertices) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        next.push(nb);
        const owner = g.board.vertices[nb].piece?.owner;
        if (owner && owner !== dc.p.id) n++;
      }
    }
    frontier = next;
  }
  return n * 8;
}

/** Null means "my own hex, never block it". */
function robberScore(dc: Dc, hexId: number): number | null {
  const { g, reg, tier } = dc;
  const h = g.board.hexes[hexId];
  const topMissing = tier.info === 'full' ? analyze(dc).topPlan.missing : [];
  let mine = false;
  let weight = 0;
  let maxOppVp = 0;
  for (const vId of h.vertexIds) {
    const piece = g.board.vertices[vId]?.piece;
    if (!piece) continue;
    if (piece.owner === dc.p.id) { mine = true; continue; }
    const vp = dc.vps.get(piece.owner) ?? 0;
    const mult = reg.pieces.get(piece.type)?.produces || 1;
    let w = mult;
    if (tier.robberMode === 1) w = mult * (1 + vp * 0.5) + (piece.owner === dc.leaderId ? 2 : 0);
    if (tier.robberMode === 2) {
      w = mult * (1 + vp * 0.6 + (piece.owner === dc.leaderId ? 1.5 : 0) + (piece.owner === dc.pressureId ? 2.5 : 0));
      const o = getPlayer(g, piece.owner);
      if (o && topMissing.some(r => (o.resources[r] || 0) > 0)) w += 1.5; // a victim who holds a card I need
    }
    w *= 1 + tier.grudge * (dc.mem.grudge[piece.owner] || 0) * 0.35;
    if (tier.mercy && vp <= dc.mercyVp) w *= 0.15;
    if (lockdownOn(dc, piece.owner)) w *= 2.5;
    if (hasBotGoals(reg)) w += botGoalThreatDelta(dc.ctx, dc.p.id, piece.owner, tier.id);
    weight += w;
    if (vp > maxOppVp) maxOppVp = vp;
  }
  if (mine) return null;
  const pips = getPips(h.number) + (isWild(reg, h.type) ? 3 : 0);
  if (weight <= 0) return -pips;
  return (pips * 10 * weight + (tier.robberMode > 0 ? maxOppVp * 8 : 0)) * dc.pressureMult;
}

// ---- Strategy -----------------------------------------------------------------------------------------

interface Chase { road: boolean; army: boolean; armyWin: boolean }

function awardChase(dc: Dc): Chase {
  const { g, p, tier } = dc;
  const reach = tier.awardChase === 2 ? 3 : 2;

  // Longest Road
  const roadHolder = g.awards.longestRoad ?? null;
  const myRoad = p.stats.longestRoad || 0;
  const holderLen = roadHolder && roadHolder !== p.id ? getPlayer(g, roadHolder)?.stats.longestRoad || 0 : 0;
  const stepsRoad = Math.max(ROAD_MIN, holderLen + 1) - myRoad;
  let road = false;
  if (tier.awardChase > 0 && roadHolder !== p.id) road = stepsRoad >= 1 && stepsRoad <= reach && (p.pieces[ROAD] || 0) >= stepsRoad;
  // Overload also defends the road it holds against someone one road behind.
  if (tier.awardChase === 2 && roadHolder === p.id) {
    road = g.players.some(o => o.id !== p.id && (o.stats.longestRoad || 0) >= myRoad - 1 && (o.stats.longestRoad || 0) >= ROAD_MIN - 1);
  }

  // Largest Army
  const armyHolder = g.awards.largestArmy ?? null;
  const myKnights = p.stats.knightsPlayed || 0;
  const inHand = p.devCards.filter(c => c === 'knight').length;
  const holderKnights = armyHolder && armyHolder !== p.id ? getPlayer(g, armyHolder)?.stats.knightsPlayed || 0 : 0;
  const stepsArmy = Math.max(ARMY_MIN, holderKnights + 1) - myKnights;
  const army = tier.awardChase > 0 && armyHolder !== p.id && stepsArmy >= 1 && stepsArmy - inHand <= reach;
  const armyWin = myKnights + 1 >= ARMY_MIN && (armyHolder === p.id || myKnights + 1 > holderKnights);
  return { road, army, armyWin };
}

function planList(dc: Dc): Plan[] {
  if (dc.plans) return dc.plans;
  const { reg, p, g } = dc;
  const cost = (id: string): Resources => {
    const def = reg.pieces.get(id);
    return def ? pieceCost(g, p, def, reg) : {};
  };
  const pers = dc.personality;
  const chase = awardChase(dc);
  const out: Plan[] = [];

  const canUpgrade = placeable(dc, CITY).length > 0;
  const canSettle = placeable(dc, SETTLEMENT).length > 0;
  // Boxed in (island, wall): roads lead nowhere, so the bot switches to cities, dev cards and trading.
  const landlocked = !canSettle && !hasReachableSpot(dc);
  dc.landlocked = landlocked;

  if (canUpgrade) {
    const missing = missingFor(p.resources, cost(CITY));
    out.push({ type: 'city', priority: 100 - missing.length * 18 + (landlocked ? 15 : 0) + (pers === 'builder' ? 8 : 0), cost: cost(CITY), missing });
  }
  if (canSettle) {
    const missing = missingFor(p.resources, cost(SETTLEMENT));
    out.push({ type: 'settlement', priority: 95 - missing.length * 18 + (pers === 'builder' ? 6 : 0), cost: cost(SETTLEMENT), missing });
  }
  if (g.deck.length > 0) {
    const missing = missingFor(p.resources, g.rules.devCost);
    out.push({
      type: 'dev',
      priority: 72 - missing.length * 16 + (landlocked ? 15 : 0) + (pers === 'devRusher' ? 20 : 0) + (chase.army ? 12 : 0),
      cost: g.rules.devCost,
      missing
    });
  }
  if ((p.pieces[ROAD] || 0) > 0 && !landlocked && (!canSettle || pers === 'roadHog' || chase.road)) {
    const missing = missingFor(p.resources, cost(ROAD));
    out.push({ type: 'road', priority: 65 - missing.length * 16 + (chase.road ? 25 : 0) + (pers === 'roadHog' ? 10 : 0), cost: cost(ROAD), missing });
  }
  if (g.rules?.techTreeOn) {
    let bestTech: { id: string; val: number; cost: Resources; missing: string[] } | null = null;
    for (const def of allTechDefs(g, reg).values()) {
      if (hasTech(g, p.id, def.id)) continue;
      if (techPrereqs(def).some(req => !hasTech(g, p.id, req))) continue;
      const val = techValue(dc, def.id);
      if (val <= 0) continue;
      const total = techCostCards(g, reg, p.id, def.tier, def.costOffset ?? 0);
      const payment = defaultTechPayment(total, def.costResources ?? def.branch);
      const missing = missingFor(p.resources, payment);
      if (!bestTech || val - missing.length * 6 > bestTech.val - bestTech.missing.length * 6) {
        bestTech = { id: def.id, val, cost: payment, missing };
      }
    }
    if (bestTech) {
      out.push({
        type: 'goal',
        id: `tech:${bestTech.id}`,
        priority: 68 + Math.min(18, bestTech.val) - bestTech.missing.length * 15,
        cost: bestTech.cost,
        missing: bestTech.missing,
        action: { type: 'research_tech', payload: { techId: bestTech.id } }
      });
    }
    if ((dc.tier.id !== 'main' || botGoalMainPortUpgrades(reg)) && hasTech(g, p.id, TECH_HARBOR_CHARTERS)) {
      const upgrades = portUpgrades(g);
      const allowSettlement = botGoalPortUpgradeOnSettlement(dc.ctx, p.id);
      const portCity = g.board.vertices.find(
        v =>
          v.piece?.owner === p.id &&
          (v.piece.type === CITY || (allowSettlement && v.piece.type === SETTLEMENT)) &&
          v.port &&
          reg.ports.get(v.port)?.resource === null &&
          !upgrades[v.id]
      );
      if (portCity) {
        // The whole port drops to 2:1, so it pays off when the bot makes or holds a lot of any resource it still trades above 2:1.
        const worthIt = resIds(reg).some(
          r => ratioFor(g, reg, p.id, r) > 2 && ((dc.prod[r] || 0) >= 3 || (p.resources[r] || 0) >= 3)
        );
        if (worthIt) {
          const upgradeCost = priceOfUpgrade(g, reg, p, PORT_UPGRADE_ID, HARBOR_UPGRADE_COST);
          const missing = missingFor(p.resources, upgradeCost);
          out.push({
            type: 'goal',
            id: `upgrade_port:${portCity.id}`,
            priority: 76 - missing.length * 16,
            cost: upgradeCost,
            missing,
            action: { type: 'upgrade_port', payload: { vertexId: portCity.id } }
          });
        }
      }
    }
  }
  if (hasBotGoals(reg)) {
    for (const gItem of evaluateBotGoals(dc.ctx, p.id, dc.tier.id)) {
      const missing = missingFor(p.resources, gItem.cost || {});
      out.push({
        type: 'goal',
        id: gItem.id,
        priority: gItem.priority - missing.length * 16,
        cost: gItem.cost || {},
        missing,
        action: gItem.action
      });
    }
  }
  out.sort((a, b) => b.priority - a.priority);
  dc.plans = out;
  return out;
}

/** Plans kept back from spending: only the next build for Main, more for higher tiers (fewer on big boards). */
function reservedPlans(dc: Dc): number {
  let l = dc.tier.lookahead;
  if (dc.mp.landCount > 300) l = Math.max(0, l - 1);
  if (dc.mp.landCount > 800) l = 0;
  return 1 + l;
}

/** What the bot is saving up for, what it lacks, and which cards it can spend freely. */
function analyze(dc: Dc): { plans: Plan[]; topPlan: Plan; surplus: Record<string, number> } {
  const plans = planList(dc);
  const topPlan: Plan = plans[0] ?? { type: 'settlement', priority: 0, cost: {}, missing: [] };
  const reserve: Record<string, number> = {};
  for (const pl of plans.slice(0, reservedPlans(dc))) {
    for (const [r, n] of Object.entries(pl.cost)) reserve[r] = (reserve[r] || 0) + n;
  }
  const surplus: Record<string, number> = {};
  for (const r of resIds(dc.reg)) surplus[r] = Math.max(0, (dc.p.resources[r] || 0) - (reserve[r] || 0));
  return { plans, topPlan, surplus };
}

// ---- Trading ----------------------------------------------------------------------------------------------

function judgeTrade(dc: Dc, trade: TradeState): 'accepted' | 'declined' {
  const { g, reg, p, tier } = dc;
  if (trade.fromId === p.id) return 'declined';
  const ids = resIds(reg);

  let gives = 0; // what I would hand over
  let gets = 0;  // what I would receive
  for (const r of ids) {
    const req = trade.request[r] || 0;
    const off = trade.offer[r] || 0;
    if (req > (p.resources[r] || 0)) return 'declined';
    gives += req;
    gets += off;
  }
  if (gives === 0 || gets === 0) return 'declined';

  // No help for a player close to winning (the line moves with the tier), nor for a human the bots are pressing.
  const propVp = dc.vps.get(trade.fromId) ?? 0;
  if (propVp >= leaderCutoff(dc)) return 'declined';
  if (lockdownOn(dc, trade.fromId)) return 'declined';
  if (tier.coordination && trade.fromId === dc.pressureId && propVp >= Math.ceil(dc.win * 0.5)) return 'declined';

  // Grudges: a strong memory refuses outright, a mild one wants an edge.
  const grudge = dc.mem.grudge[trade.fromId] || 0;
  if (tier.grudge >= 1.5 && grudge >= 2) return 'declined';
  const needEdge = tier.grudge > 0 && grudge >= 2;

  const { topPlan, surplus } = analyze(dc);
  let helpsMissing = 0;
  let hurtsLocked = false;
  for (const r of ids) {
    const req = trade.request[r] || 0;
    const off = trade.offer[r] || 0;
    if (off > 0 && topPlan.missing.includes(r)) helpsMissing += off;
    if (req > surplus[r]) hurtsLocked = true;
  }

  if (needEdge && gets <= gives) return 'declined';
  if (helpsMissing > 0 && !hurtsLocked && gets >= gives) return 'accepted';
  if (gets > gives && topPlan.missing.length > 0 && !hurtsLocked) return 'accepted';
  if (gets === gives) {
    const givesAbundant = ids.every(r => (trade.request[r] || 0) === 0 || (p.resources[r] || 0) >= 3);
    const getsScarce = ids.some(r => (trade.offer[r] || 0) > 0 && (p.resources[r] || 0) === 0);
    if (givesAbundant && getsScarce) return 'accepted';
  }
  return 'declined';
}

/** A bad offer from a human, answered with "one of my spare cards for the card I am missing" (Secondary and up). */
function counterFor(dc: Dc, trade: TradeState): BotMove | null {
  const { g, reg, tier, mem } = dc;
  if (!tier.counters) return null;
  if (mem.counters >= (tier.id === 'overload' ? 2 : 1)) return null;
  const from = getPlayer(g, trade.fromId);
  if (!from || from.isBot) return null;
  if ((dc.vps.get(from.id) ?? 0) >= leaderCutoff(dc) || lockdownOn(dc, from.id)) return null;

  const { topPlan, surplus } = analyze(dc);
  const need = tier.info === 'full' ? 1 : 0.8;
  const want = topPlan.missing.find(r => holdingGuess(dc, from, r) >= need);
  if (!want) return null;
  const give = resIds(reg)
    .filter(r => r !== want && surplus[r] >= 1 && (trade.offer[r] || 0) === 0)
    .sort((a, b) => surplus[b] - surplus[a])[0];
  if (!give) return null;
  return { type: 'counter_trade', payload: { tradeId: trade.id, offer: { [give]: 1 }, request: { [want]: 1 } } };
}

/** Bank swap that moves a missing card closer, paid from spare cards. */
function bankTradeMove(dc: Dc, plan: Plan, surplus: Record<string, number>): BotMove | null {
  const { g, reg, p } = dc;
  if (plan.missing.length === 0) return null;
  const target = plan.missing[0];
  if ((g.bank[target] || 0) < 1) return null;
  const ratios = tradeRatios(g, reg, p.id);
  const give = pickBest(
    resIds(reg).filter(r => r !== target && surplus[r] >= ratios[r]),
    r => surplus[r] - ratios[r]
  );
  if (!give) return null;
  return { type: 'bank_trade', payload: { give: { [give]: ratios[give] }, get: { [target]: 1 } } };
}

/** Swap the biggest pile down (toward a missing card, else the thinnest pile). Used to get under the spend threshold, and for the Main "mistake". */
function dumpMove(dc: Dc, plan: Plan): BotMove | null {
  const { g, reg, p } = dc;
  const ratios = tradeRatios(g, reg, p.id);
  const ids = resIds(reg);
  const give = pickBest(ids.filter(r => (p.resources[r] || 0) >= ratios[r]), r => (p.resources[r] || 0) - ratios[r]);
  if (!give) return null;
  const get = pickBest(
    ids.filter(r => r !== give && (g.bank[r] || 0) >= 1),
    r => -(p.resources[r] || 0) + (plan.missing.includes(r) ? 10 : 0)
  );
  if (!get) return null;
  return { type: 'bank_trade', payload: { give: { [give]: ratios[give] }, get: { [get]: 1 } } };
}

/**
 * Offer to the table when close to the plan. Attempt 1: one spare card for the missing one. Attempt 2: a different spare card.
 * Attempt 3 (Overload): a sweetener, two spare cards for one. The number of attempts per turn comes from the tier.
 */
function proposeTradeMove(dc: Dc, plan: Plan, surplus: Record<string, number>): BotMove | null {
  const { g, reg, p, tier, mem } = dc;
  if (g.trade || openTrades(g).length > 0) return null;
  const maxMissing = tier.id === 'main' ? 1 : 2;
  if (plan.missing.length === 0 || plan.missing.length > maxMissing) return null;
  // The engine flags the first offer of a turn. Later ones need the event feed to have counted the earlier ones.
  const allowed = !p.flags.proposedTrade || (mem.proposals >= 1 && mem.proposals < tier.tradeProposals);
  if (!allowed) return null;

  const want = plan.missing[0];
  const offers = resIds(reg).filter(r => r !== want && surplus[r] >= 1).sort((a, b) => surplus[b] - surplus[a]);
  if (offers.length === 0) return null;
  const attempt = p.flags.proposedTrade ? mem.proposals : 0;

  let offer: Resources | null;
  if (attempt === 0) offer = { [offers[0]]: 1 };
  else if (attempt === 1) offer = offers.length > 1 ? { [offers[1]]: 1 } : surplus[offers[0]] >= 2 ? { [offers[0]]: 2 } : null;
  else offer = surplus[offers[0]] >= 2 ? { [offers[0]]: 2 } : offers.length > 1 ? { [offers[0]]: 1, [offers[1]]: 1 } : null;
  if (!offer) return null;

  const someoneHasCards = g.players.some(o => o.id !== p.id && totalCards(o) > 0);
  if (!someoneHasCards) return null;
  return { type: 'propose_trade', payload: { offer, request: { [want]: 1 } } };
}

/** Cards to discard: spare cards first, then from the biggest piles. */
function chooseDiscard(dc: Dc): Resources {
  const { reg, p } = dc;
  const ids = resIds(reg);
  const have: Record<string, number> = { ...p.resources };
  const { surplus } = analyze(dc);
  const cards: Resources = {};
  for (let need = p.pending.discard || 0; need > 0; need--) {
    let pick = ids.find(r => surplus[r] > 0 && have[r] > 0);
    if (pick) surplus[pick]--;
    else {
      const avail = ids.filter(r => have[r] > 0).sort((a, b) => have[b] - have[a]);
      if (avail.length === 0) break;
      pick = avail[0];
    }
    have[pick]--;
    cards[pick] = (cards[pick] || 0) + 1;
  }
  return cards;
}

// ---- Development cards -------------------------------------------------------------------------------------

function robberOnMe(dc: Dc): boolean {
  const hex = dc.g.board.hexes[dc.g.board.robberHexId];
  return !!hex && hex.vertexIds.some(vId => dc.g.board.vertices[vId]?.piece?.owner === dc.p.id);
}

function leaderPressing(dc: Dc, frac: number): boolean {
  return dc.leaderId !== null && dc.leaderVp >= Math.ceil(dc.win * frac);
}

/** Knight in the roll phase (before the dice): to get off a blocked tile, take Largest Army, answer content that asks for a knight (registry hook), or (Overload) hit the leader first. */
function knightBeforeRoll(dc: Dc): boolean {
  if (robberOnMe(dc)) return true;
  if (dc.tier.devTiming === 0) return false;
  if (awardChase(dc).armyWin) return true;
  if (botGoalWantsKnight(dc.ctx, dc.p.id)) return true;
  if (dc.g.rules?.techTreeOn && dc.tier.id !== 'main' && hasTech(dc.g, dc.p.id, TECH_PLUNDER)) {
    if (leaderPressing(dc, 0.45) || dc.g.players.some(o => o.id !== dc.p.id && totalCards(o) >= 2)) return true;
  }
  return dc.tier.devTiming === 2 && leaderPressing(dc, 0.6);
}

/** Knight in the main phase: Main plays it at once, the others wait for a reason (robber, Largest Army, content that asks for a knight, Plunder, or pressing leader). */
function shouldPlayKnight(dc: Dc): boolean {
  if (dc.tier.devTiming === 0) return true;
  if (robberOnMe(dc) || awardChase(dc).armyWin) return true;
  if (dc.p.devCards.filter(c => c === 'knight').length >= 2) return true;
  if (botGoalWantsKnight(dc.ctx, dc.p.id)) return true;
  if (dc.g.rules?.techTreeOn && dc.tier.id !== 'main' && hasTech(dc.g, dc.p.id, TECH_PLUNDER)) {
    if (dc.g.players.some(o => o.id !== dc.p.id && totalCards(o) >= 1)) return true;
  }
  return leaderPressing(dc, dc.tier.devTiming === 2 ? 0.6 : 0.7);
}

function overlapOf(a: Legal, missing: string[]): number {
  const pool = [...missing];
  let n = 0;
  for (const v of Object.values(a.payload)) {
    if (typeof v !== 'string') continue;
    const i = pool.indexOf(v);
    if (i >= 0) { pool.splice(i, 1); n++; }
  }
  return n;
}

function devCardMove(dc: Dc): BotMove | null {
  const { g, reg, p, tier } = dc;
  if (p.flags.playedDev) return null;
  const plays = dc.legal.filter(a => a.type === 'play_dev');
  if (plays.length === 0) return null;
  const play = (a: Legal): BotMove => ({ type: 'play_dev', payload: a.payload });
  const { topPlan } = analyze(dc);

  const road = plays.find(a => a.payload.card === 'roadBuilding');
  if (road && (p.pieces[ROAD] || 0) >= 2 && placeable(dc, ROAD).length > 0) return play(road);

  const plenty = plays.filter(a => a.payload.card === 'yearOfPlenty');
  if (plenty.length > 0 && resIds(reg).some(r => (g.bank[r] || 0) > 0)) {
    if (tier.devTiming === 0) return play(plenty[0]);
    // Secondary: when it covers a missing card. Overload: only when it finishes the build.
    const best = pickBest(plenty, a => overlapOf(a, topPlan.missing));
    const need = tier.devTiming === 2 ? Math.min(2, topPlan.missing.length) : 1;
    if (best && topPlan.missing.length > 0 && topPlan.missing.length <= 2 && overlapOf(best, topPlan.missing) >= need) return play(best);
  }

  const monopolies = plays.filter(a => a.payload.card === 'monopoly');
  if (monopolies.length > 0) {
    const total = (r: string): number => g.players.reduce((s, o) => (o.id === p.id ? s : s + holdingGuess(dc, o, r)), 0);
    const best = pickBest(monopolies, a => total(a.payload.resource) + (topPlan.missing.includes(a.payload.resource) ? 1 : 0));
    if (best && total(best.payload.resource) >= (tier.devTiming === 0 ? 2 : 3)) return play(best);
  }

  const knight = plays.find(a => a.payload.card === 'knight');
  if (knight && shouldPlayKnight(dc)) return play(knight);
  return null;
}

/** Buying a dev card is skipped when it would push a build that is one card away further off (tiers that plan ahead). */
function devPurchaseOk(dc: Dc, plans: Plan[]): boolean {
  if (dc.tier.lookahead < 1) return true;
  const next = plans.find(pl => pl.type !== 'dev');
  if (!next || next.missing.length > 1) return true;
  const after: Resources = { ...dc.p.resources };
  for (const [r, n] of Object.entries(dc.g.rules.devCost)) after[r] = (after[r] || 0) - (n as number);
  return missingFor(after, next.cost).length <= next.missing.length;
}

// ---- Picking spots -------------------------------------------------------------------------------------

function pickSettlement(dc: Dc, options: Legal[]): Legal | null {
  return choose(dc, prune(options, a => cheapVertex(dc, a.payload.loc)), a => vertexScore(dc, a.payload.loc));
}

function pickCity(dc: Dc, options: Legal[]): Legal | null {
  return choose(dc, prune(options, a => cheapVertex(dc, a.payload.loc)), a => cityScore(dc, a.payload.loc));
}

function pickRoad(dc: Dc, options: Legal[]): Legal | null {
  return choose(dc, prune(options, a => cheapEdge(dc, a.payload.loc), 40), a => roadScore(dc, a.payload.loc));
}

function pickVictim(dc: Dc, victims: Legal[]): Legal | null {
  if (victims.length === 0) return null;
  const { g, tier } = dc;
  if (victims.length === 1) return victims[0];
  if (tier.robberMode === 0) {
    // Main: the engine's order (players with cards first, then by VP), sparing weak players when it can.
    return victims.find(a => (dc.vps.get(a.payload.victimId) ?? 0) > dc.mercyVp && totalCards(getPlayer(g, a.payload.victimId)!) > 0) ?? victims[0];
  }
  const missing = tier.info === 'full' ? analyze(dc).topPlan.missing : [];
  return pickBest(victims, a => {
    const o = getPlayer(g, a.payload.victimId);
    if (!o) return -Infinity;
    let s = (totalCards(o) > 0 ? 100 : 0) + (dc.vps.get(o.id) ?? 0) * 3;
    s += tier.grudge * (dc.mem.grudge[o.id] || 0) * 4;
    if (o.id === dc.pressureId) s += 12;
    if (lockdownOn(dc, o.id)) s += 10;
    if (missing.some(r => (o.resources[r] || 0) > 0)) s += 15;
    return s;
  });
}

// ---- Tech tree decisions (only active when g.rules?.techTreeOn is true) --------------------------------

function techValue(dc: Dc, techId: string): number {
  const { g, reg, p, tier } = dc;
  // Content that adds techs (a DLC) values them through the registry; this switch holds the base techs only.
  const hooked = botGoalTechValue(dc.ctx, p.id, techId, { tierId: tier.id, personality: dc.personality });
  if (hooked !== undefined) return hooked;
  switch (techId) {
    case TECH_STOCKPILING:
      return 14 + (totalCards(p) >= 5 ? 6 : 0) + (dc.landlocked ? 4 : 0);
    case TECH_ROAD_LEVY:
      return 13 + Math.min(8, (p.stats.longestRoad || 0) * 1.5) + (dc.personality === 'roadHog' ? 5 : 0);
    case TECH_PLUNDER:
      return 15 + (p.devCards.includes('knight') ? 8 : 0) + (dc.personality === 'devRusher' ? 5 : 0) + (tier.id === 'overload' ? 4 : 0);
    case TECH_HARBOR_CHARTERS: {
      // Base value. A DLC that builds on port upgrades (Tidebound) overrides it through the registry before this switch runs.
      if (tier.id === 'main') return 0;
      const hasGenericPort = g.board.vertices.some(
        v => v.piece?.owner === p.id && v.port && reg.ports.get(v.port)?.resource === null
      );
      return (hasGenericPort ? 18 : 8) + (dc.personality === 'portTrader' ? 6 : 0);
    }
    case TECH_GROUND_WORK: {
      let touchesDesert = false;
      let touchesWeakLand = false;
      for (const v of g.board.vertices) {
        if (v.piece?.owner !== p.id) continue;
        for (const hId of v.hexIds) {
          const h = g.board.hexes[hId];
          if (!h) continue;
          if (h.type === 'desert') touchesDesert = true;
          else if (getPips(h.number) <= 2) touchesWeakLand = true;
        }
      }
      if (touchesDesert) return 19;
      if (touchesWeakLand) return 12;
      return 6;
    }
    default:
      return 10;
  }
}

function pickGroundWorkMove(dc: Dc, options: Legal[]): BotMove | null {
  if (options.length === 0) return null;
  const { g, reg, p } = dc;
  let best: Legal | null = null;
  let bestScore = 1;
  for (const a of options) {
    const h = g.board.hexes[a.payload.hexId];
    const newTile = reg.tiles.get(a.payload.resource);
    const newRes = newTile?.produces;
    if (!h || !newRes) continue;
    const oldRes = reg.tiles.get(h.type)?.produces;
    let myMult = 0;
    let oppMult = 0;
    for (const vId of h.vertexIds) {
      const piece = g.board.vertices[vId]?.piece;
      if (!piece) continue;
      const mult = reg.pieces.get(piece.type)?.produces || 1;
      if (piece.owner === p.id) myMult += mult;
      else oppMult += mult;
    }
    if (myMult === 0) continue;
    let s = 0;
    const newNeed = (dc.prod[newRes] || 0) === 0 ? 5 : Math.max(0, 6 - (dc.prod[newRes] || 0));
    if (h.type === 'desert') {
      s = myMult * (4 + newNeed) - oppMult * 2;
    } else if (oldRes && oldRes !== newRes) {
      const pips = getPips(h.number);
      const oldProd = dc.prod[oldRes] || 0;
      const newProd = dc.prod[newRes] || 0;
      if (oldProd - myMult * pips >= 3 && newProd === 0) {
        s = myMult * pips * 2 + newNeed - oppMult * pips;
      }
    }
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  return best ? { type: 'convert_tile', payload: best.payload } : null;
}

function pickUpgradePortMove(dc: Dc, options: Legal[]): BotMove | null {
  if (options.length === 0 || (dc.tier.id === 'main' && !botGoalMainPortUpgrades(dc.reg))) return null;
  const { g, reg, p } = dc;
  // Every raised port gets the same 3:1 -> 2:1 on all resources, so any legal port will do; the question is only whether it pays off.
  const worthIt = resIds(reg).some(
    r => ratioFor(g, reg, p.id, r) > 2 && ((dc.prod[r] || 0) >= 2 || (p.resources[r] || 0) >= 3)
  );
  if (!worthIt) return null;
  return { type: 'upgrade_port', payload: options[0].payload };
}

function pickResearchTechMove(dc: Dc, options: Legal[]): BotMove | null {
  if (options.length === 0) return null;
  const best = pickBest(options, a => {
    const val = techValue(dc, a.payload.techId);
    if (val <= 0) return -Infinity;
    const paid = techResearchCheck(dc.g, dc.reg, dc.p.id, a.payload.techId).needed ?? 0;
    return val - paid * 1.5;
  });
  if (!best || techValue(dc, best.payload.techId) <= 0) return null;
  return { type: 'research_tech', payload: best.payload };
}

// ---- The decision ---------------------------------------------------------------------------------------------

/**
 * The one action this bot wants to take right now, or null if it has to wait (not its turn,
 * waiting for trade answers, nothing legal). Always returns something the engine accepts.
 */
export function chooseBotAction(g: GameState, reg: Registry, pid: Id, rand: Rand = Math.random): BotMove | null {
  if (g.phase === 'gameover') return null;
  const p = getPlayer(g, pid);
  if (!p) return null;
  const legal = legalActions(g, reg, pid);
  if (legal.length === 0) return null;

  const dc = makeDc(g, reg, p, legal, rand);
  const move = decide(dc);
  if (!move) return null;
  if (!checkAction(g, reg, { type: move.type, playerId: pid, payload: move.payload })) return move;

  // The heuristic produced something the engine refuses: fall back to something that is allowed.
  return fallback(g, p, legal);
}

function fallback(g: GameState, p: PlayerState, legal: Legal[]): BotMove | null {
  const isMyTurn = g.players[g.turn]?.id === p.id;
  const end = legal.find(a => a.type === 'end_turn');
  if (isMyTurn && end) return end;
  const first = legal[0];
  return first ? { type: first.type, payload: first.payload } : null;
}

function decide(dc: Dc): BotMove | null {
  const { g, p, tier } = dc;
  const of = (type: string): Legal[] => dc.legal.filter(a => a.type === type);
  const myTurn = g.players[g.turn]?.id === p.id;

  // Answer any trade offer made to me.
  const pendingTrade = openTrades(g).find(t => t.fromId !== p.id && t.responses[p.id] === 'pending');
  if (pendingTrade) {
    const decision = judgeTrade(dc, pendingTrade);
    if (decision === 'declined') {
      const counter = counterFor(dc, pendingTrade);
      if (counter) return counter;
    }
    return { type: 'respond_trade', payload: { tradeId: pendingTrade.id, decision } };
  }

  switch (g.phase) {
    case 'setup_settlement': {
      const spots = of('build');
      let pick: Legal | null = null;
      if (tier.setupPlanning >= 1 && dc.placed === 0 && spots.length > 1) pick = planOpening(dc, spots);
      if (!pick) pick = pickSettlement(dc, spots);
      return pick ? { type: 'build', payload: pick.payload } : null;
    }

    case 'setup_road': {
      const edge = pickRoad(dc, of('build'));
      return edge ? { type: 'build', payload: edge.payload } : null;
    }

    case 'roll': {
      if (!p.flags.playedDev && p.devCards.includes('knight') && knightBeforeRoll(dc)) {
        const knight = of('play_dev').find(a => a.payload.card === 'knight');
        if (knight) return { type: 'play_dev', payload: knight.payload };
      }
      return of('roll').length ? { type: 'roll', payload: {} } : null;
    }

    case 'discard': {
      if (!of('discard').length) return null;
      return { type: 'discard', payload: { cards: chooseDiscard(dc) } };
    }

    case 'pick': {
      const options = of('pick').map(a => a.payload.resource as string);
      if (options.length === 0) return null;
      const { topPlan } = analyze(dc);
      const wanted = topPlan.missing.find(r => options.includes(r));
      const resource = wanted ?? [...options].sort((a, b) => (p.resources[a] || 0) - (p.resources[b] || 0))[0];
      return { type: 'pick', payload: { resource } };
    }

    case 'robber': {
      const hexes = of('move_robber');
      if (hexes.length === 0) return null;
      const scored = hexes.map(a => ({ a, s: robberScore(dc, a.payload.hexId) })).filter(x => x.s !== null) as { a: Legal; s: number }[];
      const choice = choose(dc, prune(scored, x => x.s, 80), x => x.s)?.a ?? hexes[0];
      return { type: 'move_robber', payload: choice.payload };
    }

    case 'robber_steal': {
      const victim = pickVictim(dc, of('steal'));
      return victim ? { type: 'steal', payload: victim.payload } : null;
    }

    case 'main':
      return myTurn ? mainPhase(dc) : null;

    default:
      return null;
  }
}

function mainPhase(dc: Dc): BotMove | null {
  const { g, reg, p, tier } = dc;
  const of = (type: string): Legal[] => dc.legal.filter(a => a.type === type);
  const builds = (piece: string): Legal[] => of('build').filter(a => a.payload.piece === piece);
  const build = (a: Legal | null): BotMove | null => (a ? { type: 'build', payload: a.payload } : null);

  // My own open offer: wait for answers, then execute with accepting partner or take it down.
  const myTrade = openTrades(g).find(t => t.fromId === p.id);
  if (myTrade) {
    const acceptedPartner = Object.keys(myTrade.responses).find(id => myTrade.responses[id] === 'accepted');
    if (acceptedPartner) {
      return { type: 'confirm_trade', payload: { tradeId: myTrade.id, partnerId: acceptedPartner } };
    }
    const waiting = Object.values(myTrade.responses).some(r => r === 'pending');
    return waiting ? null : { type: 'cancel_trade', payload: { tradeId: myTrade.id } };
  }

  // 1. Development cards.
  const dev = devCardMove(dc);
  if (dev) return dev;

  // 2. Free roads from Road Building.
  if ((p.pending.freeRoads || 0) > 0) {
    const road = build(pickRoad(dc, builds(ROAD)));
    if (road) return road;
  }

  // 2b. Free Ground Work tile conversion when tech tree is active.
  if (g.rules?.techTreeOn) {
    const convert = pickGroundWorkMove(dc, of('convert_tile'));
    if (convert) return convert;
  }

  // 3. City, 4. Settlement.
  const city = build(pickCity(dc, builds(CITY)));
  if (city) return city;
  const settlement = build(pickSettlement(dc, builds(SETTLEMENT)));
  if (settlement) return settlement;

  const { plans, topPlan, surplus } = analyze(dc);
  const overHand = totalCards(p) > dc.threshold;

  // 4a. Tech tree port upgrades and tech research when tech tree is active.
  if (g.rules?.techTreeOn) {
    const upgradePort = pickUpgradePortMove(dc, of('upgrade_port'));
    if (upgradePort) return upgradePort;
    const closeBuild = plans.some(pl => (pl.type === 'city' || pl.type === 'settlement') && pl.missing.length <= 1);
    if (overHand || !closeBuild) {
      const research = pickResearchTechMove(dc, of('research_tech'));
      if (research) return research;
    }
  }

  // 4b. Addon / DLC goal actions (when ready) or highest-scored custom legal action.
  if (hasBotGoals(reg)) {
    for (const pl of plans) {
      if (pl.type === 'goal' && pl.missing.length === 0 && pl.action) {
        if (!checkAction(g, reg, { type: pl.action.type, playerId: p.id, payload: pl.action.payload })) {
          return pl.action;
        }
      }
    }
    const scoredCustom = dc.legal
      .map(a => ({ a, s: botGoalActionScore(dc.ctx, p.id, a, tier.id) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s);
    if (scoredCustom.length > 0) {
      return { type: scoredCustom[0].a.type, payload: scoredCustom[0].a.payload };
    }
  }

  // 5. Bank / port swap toward the current plan, 6. offer to the table.
  const swap = bankTradeMove(dc, topPlan, surplus);
  if (swap) return swap;
  const offer = proposeTradeMove(dc, topPlan, surplus);
  if (offer) return offer;

  // 7. Development card.
  if (of('buy_dev').length && (overHand || devPurchaseOk(dc, plans))) return { type: 'buy_dev', payload: {} };

  // 8. Road toward a new settlement spot, when rich in roads, to chase Longest Road, or to spend down a big hand.
  const roads = builds(ROAD);
  if (roads.length) {
    const roadDef = reg.pieces.get(ROAD);
    const cost = roadDef ? pieceCost(g, p, roadDef, reg) : {};
    const factor = dc.personality === 'roadHog' ? 1 : 2;
    const richInRoads = Object.entries(cost).every(([r, n]) => (p.resources[r] || 0) >= (n as number) * factor);
    const hasOpenSpot = placeable(dc, SETTLEMENT).length > 0;
    const wantRoad = (!hasOpenSpot && !dc.landlocked) || richInRoads || awardChase(dc).road || (overHand && !dc.landlocked);
    if (wantRoad) {
      const road = build(pickRoad(dc, roads));
      if (road) return road;
    }
  }

  // 9. Still holding too much (a 7 would hurt): swap the biggest pile down.
  if (overHand) {
    const dump = dumpMove(dc, topPlan);
    if (dump) return dump;
  }

  // 10. Main's visible mistake: now and then a pointless swap, at most once a turn and never after a real bank trade.
  if (tier.mistakes && dc.mem.tellTurn !== g.turnCount && hash01(`${p.id}:tell:${g.turnCount}`) < 0.07) {
    const dump = dumpMove(dc, { type: 'settlement', priority: 0, cost: {}, missing: [] });
    if (dump) return dump;
  }

  // 11. Done.
  return of('end_turn').length ? { type: 'end_turn', payload: {} } : null;
}
