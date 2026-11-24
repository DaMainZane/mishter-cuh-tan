// MODULE: tidebound.wrecks addon (shipwreck event in the Event Deck, 2026-11-24 rework: every player rolls a d20 and salvages 2 to 6 random resources from the bank by the roll, +1 with Salvage crew; no wreck pieces on the board any more, old ones are cleared; the Salvage crew demolish-bridge bot score) | DEPENDS ON: packs/tidebound/bridges, packs/tidebound/ricketyBridges, packs/tidebound/seaEvents, packs/tidebound/tech, shared/index | USED BY: packs/tidebound/addons.generated, packs/tidebound/index
import { addonOn, BOT_GOALS, EVENT_CARDS, getMarkers, getPlayer, hasTech, removeMarker } from '../../shared';
import type { AddonDef, BotGoalDef, Ctx, EventCardDef, GameState, Id, Resources } from '../../shared';
import { BRIDGE } from './bridges';
import { RICKETY } from './ricketyBridges';
import { cardCount, cardList, eventStream, giveRandomResources, rollD20 } from './seaEvents';
import { registerTideboundTechs, TECH_SALVAGE_CREW } from './tech';

/** Event card id in the Event Deck. */
export const SHIPWRECK_EVENT_ID = 'tidebound.shipwreck';
/** Copies of the shipwreck card in the deck. */
export const SHIPWRECK_COPIES = 2;
/** Marker kind of the old wreck pieces (cleared from older saves). */
export const WRECK_MARKER_KIND = 'wreck';
/** d20 bands: a roll up to `max` salvages `cards`. 1-4: 2, 5-8: 3, 9-12: 4, 13-16: 5, 17-20: 6. */
export const SHIPWRECK_BANDS: readonly { max: number; cards: number }[] = [
  { max: 4, cards: 2 },
  { max: 8, cards: 3 },
  { max: 12, cards: 4 },
  { max: 16, cards: 5 },
  { max: 20, cards: 6 }
];
/** Extra card a player with Salvage crew salvages from every shipwreck. */
export const SALVAGE_CREW_BONUS = 1;
const SHIPWRECK_SALT = 0x5357524b; // 'SWRK'

/** Cards a d20 roll salvages (before Salvage crew). */
export function shipwreckCards(roll: number): number {
  const r = Math.max(1, Math.min(20, Math.floor(Number(roll) || 1)));
  return SHIPWRECK_BANDS.find(b => r <= b.max)!.cards;
}

/** One player's result of a shipwreck: their d20, the cards it was worth and what the bank gave. */
export interface ShipwreckResult {
  playerId: Id;
  roll: number;
  cards: number;
  got: Resources;
}

/**
 * Resolves a shipwreck for the whole table: every player, in seat order, rolls a d20 (a stream seeded by the world seed and the round, never
 * `g.rng`) and takes that many random resources from the bank, plus `SALVAGE_CREW_BONUS` with Salvage crew. One log line per player.
 */
export function resolveShipwreck(ctx: Ctx): ShipwreckResult[] {
  const { g } = ctx;
  const rng = eventStream(g.seed, SHIPWRECK_SALT, g.round || 0);
  const results: ShipwreckResult[] = [];
  for (const p of g.players) {
    const roll = rollD20(rng);
    const cards = shipwreckCards(roll) + (hasTech(g, p.id, TECH_SALVAGE_CREW) ? SALVAGE_CREW_BONUS : 0);
    const got = giveRandomResources(ctx, p.id, cards, rng);
    p.stats.wreckCards = (p.stats.wreckCards || 0) + cardCount(got);
    results.push({ playerId: p.id, roll, cards, got });
    ctx.log(`🚢 ${p.avatar} ${p.name} rolled ${roll} on the d20 and salvaged ${cardList(got)}`, p.color);
  }
  ctx.emit('shipwreckEvent', { round: g.round || 0, results });
  return results;
}

/** The shipwreck card of the Event Deck. */
export const shipwreckEventCard: EventCardDef = {
  id: SHIPWRECK_EVENT_ID,
  title: 'Shipwreck',
  description: 'A ship breaks up on the reefs. Every player rolls a d20 and salvages 2 to 6 random resources (higher rolls salvage more; +1 with Salvage crew).',
  pack: 'tidebound',
  copies: SHIPWRECK_COPIES,
  icon: 'wreck',
  apply(ctx) {
    if (!addonOn(ctx.reg, 'tidebound.wrecks')) return;
    resolveShipwreck(ctx);
  }
};

/** Older saves had wreck pieces on the board: removes their markers and tile data. Returns how many were cleared. */
export function clearOldWrecks(g: GameState): number {
  let n = 0;
  for (const m of getMarkers(g, { kind: WRECK_MARKER_KIND })) if (removeMarker(g, m.id)) n++;
  for (const h of g.board.hexes) if (h.ext?.wreck) { delete h.ext.wreck; n++; }
  return n;
}

/** True when `edgeId` is a dead-end bridge of `pid` (one endpoint has no other piece or road/bridge of `pid`). */
function isDeadEndBridge(g: GameState, pid: Id, edgeId: number): boolean {
  const e = g.board.edges[edgeId];
  if (!e || e.piece?.owner !== pid) return false;
  for (const vId of [e.v1, e.v2]) {
    const v = g.board.vertices[vId];
    if (!v) continue;
    if (v.piece?.owner === pid) continue;
    const otherOwnEdges = v.edgeIds.filter(id => id !== edgeId && g.board.edges[id]?.piece?.owner === pid);
    if (otherOwnEdges.length === 0) return true;
  }
  return false;
}

/** Bot goal: scores `demolish_bridge` (Salvage crew) only on a safe dead-end sturdy bridge when the bot is short of cards. */
export const salvageBotGoal: BotGoalDef = {
  id: 'tidebound.wrecks',
  goalClass: 'generic',
  actionScore(ctx: Ctx, pid: Id, action: { type: string; payload: any }): number {
    if (action.type !== 'demolish_bridge') return 0;
    const { g } = ctx;
    if (!hasTech(g, pid, TECH_SALVAGE_CREW)) return 0;
    const edgeId = Number(action.payload?.edgeId);
    if (!Number.isInteger(edgeId)) return 0;
    const e = g.board.edges[edgeId];
    if (!e || e.piece?.owner !== pid || (e.piece.type !== BRIDGE && e.piece.type !== RICKETY)) return 0;
    const p = getPlayer(g, pid);
    if (!p) return 0;
    if (g.awards.longestRoad === pid || (p.stats.longestRoad || 0) >= 4) return 0;
    if (!isDeadEndBridge(g, pid, edgeId)) return 0;
    const hand = Object.values(p.resources).reduce((s, n) => s + (n || 0), 0);
    if (e.piece.type === BRIDGE && hand <= 3) return 22;
    return 0;
  }
};

export const wrecksAddon: AddonDef = {
  id: 'tidebound.wrecks',
  name: 'Shipwrecks',
  description: 'Shipwreck events: every player rolls a d20 and salvages 2 to 6 random resources. Needs the Event Deck.',
  links: [
    { target: 'event-deck', kind: 'content' },
    { target: 'tidebound.bridges', kind: 'mechanic' }
  ],
  register(api) {
    registerTideboundTechs(api);
    api.define(EVENT_CARDS, shipwreckEventCard);
    api.define(BOT_GOALS, salvageBotGoal);
    api.hook('onRoundStart', ctx => {
      clearOldWrecks(ctx.g);
    });
  }
};
