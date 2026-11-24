// MODULE: tidebound.pirates addon (pirate raid event in the Event Deck, 2026-11-24 rework: every player at once compares their played knights with the pirates' strength; equal or more wins loot scaled by strength and round, fewer loses 2 random cards; Pirate hunter +2 knights and +1 loot; no pirate pieces on the board any more, old ones are cleared; bots want knights before a raid) | DEPENDS ON: packs/tidebound/fishing, packs/tidebound/seaEvents, packs/tidebound/tech, shared/index | USED BY: packs/tidebound/addons.generated, packs/tidebound/index
import { addonOn, BOT_GOALS, EVENT_CARDS, eventTimeline, getMarkers, getPlayer, getWildTokens, hasTech, removeMarker, rngNext, takeWildToken } from '../../shared';
import type { AddonDef, BotGoalDef, Ctx, EventCardDef, GameState, Id, Resources, RngState } from '../../shared';
import { FISH } from './fishing';
import { cardList, eventStream, giveRandomResources } from './seaEvents';
import { registerTideboundTechs, TECH_PIRATE_HUNTER } from './tech';

/** Event card id in the Event Deck. */
export const PIRATE_EVENT_ID = 'tidebound.pirate_raid';
/** Copies of the pirate card in the deck. */
export const PIRATE_COPIES = 2;
/** Marker kind of the old pirate pieces (cleared from older saves). */
export const PIRATE_MARKER_KIND = 'pirate';
/** Strength = played knights needed: `PIRATE_BASE_STRENGTH`, +1 every `PIRATE_GROWTH_ROUNDS` rounds after `PIRATE_FIRST_ROUND`, at most `PIRATE_MAX_STRENGTH`. */
export const PIRATE_FIRST_ROUND = 4;
export const PIRATE_GROWTH_ROUNDS = 10;
export const PIRATE_BASE_STRENGTH = 1;
export const PIRATE_MAX_STRENGTH = 5;
/** Cards a player who loses to the pirates gives up (resources go back to the bank, fish are gone). */
export const PIRATE_ROB_CARDS = 2;
/** Loot for a win: `2 + strength + floor(round / PIRATE_LOOT_ROUND_STEP)`, at most `PIRATE_LOOT_MAX` (about 3 early, 8 by round 40, when a roll pays about 7). */
export const PIRATE_LOOT_ROUND_STEP = 15;
export const PIRATE_LOOT_MAX = 8;
/** Pirate hunter: counts as this many extra knights against pirates, and adds this much loot (it may go past the cap). */
export const PIRATE_HUNTER_KNIGHTS = 2;
export const PIRATE_HUNTER_LOOT = 1;
const PIRATE_SALT = 0x50495241; // 'PIRA'

/** Strength of a pirate raid in `round`. */
export function pirateStrengthAt(round: number): number {
  const r = Math.max(0, Math.floor(Number(round) || 0));
  const growth = Math.floor(Math.max(0, r - PIRATE_FIRST_ROUND) / PIRATE_GROWTH_ROUNDS);
  return Math.min(PIRATE_MAX_STRENGTH, PIRATE_BASE_STRENGTH + growth);
}

/** Cards a player who beats a raid of `strength` in `round` takes from the bank (`hunter`: with Pirate hunter). */
export function pirateLoot(strength: number, round: number, hunter = false): number {
  const s = Math.max(1, Math.floor(Number(strength) || 1));
  const base = Math.min(PIRATE_LOOT_MAX, 2 + s + Math.floor(Math.max(0, Number(round) || 0) / PIRATE_LOOT_ROUND_STEP));
  return base + (hunter ? PIRATE_HUNTER_LOOT : 0);
}

/** Knights `pid` has played (the same number Largest Army counts). */
export function pirateKnights(g: GameState, pid: Id): number {
  return Math.max(0, Math.floor(Number(getPlayer(g, pid)?.stats?.knightsPlayed) || 0));
}

/** What `pid` brings against pirates: played knights, +2 with Pirate hunter. */
export function pirateDefence(g: GameState, pid: Id): number {
  return pirateKnights(g, pid) + (hasTech(g, pid, TECH_PIRATE_HUNTER) ? PIRATE_HUNTER_KNIGHTS : 0);
}

/** One player's result of a raid. */
export interface PirateResult {
  playerId: Id;
  defence: number;
  strength: number;
  won: boolean;
  /** Loot taken from the bank (a win). */
  got: Resources;
  /** Resources taken (a loss; back to the bank) and fish taken (gone). */
  lost: Resources;
  lostFish: number;
}

/** Takes up to `n` random cards from `pid`'s hand (resources and fish alike). Resources go back to the bank; fish are removed. */
function robRandomCards(ctx: Ctx, pid: Id, n: number, rng: RngState): { lost: Resources; lostFish: number } {
  const { g } = ctx;
  const p = getPlayer(g, pid)!;
  const lost: Resources = {};
  let lostFish = 0;
  for (let i = 0; i < n; i++) {
    const pool: string[] = [];
    for (const [r, c] of Object.entries(p.resources)) for (let k = 0; k < (c || 0); k++) pool.push(r);
    for (let k = 0; k < getWildTokens(g, pid, FISH); k++) pool.push(FISH);
    if (pool.length === 0) break;
    const pick = pool[Math.floor(rngNext(rng) * pool.length)];
    if (pick === FISH) {
      lostFish += takeWildToken(g, pid, FISH, 1);
    } else {
      p.resources[pick] -= 1;
      g.bank[pick] = (g.bank[pick] || 0) + 1;
      lost[pick] = (lost[pick] || 0) + 1;
    }
  }
  return { lost, lostFish };
}

/**
 * Resolves a pirate raid for the whole table, in seat order: a player whose played knights (+2 with Pirate hunter) reach the strength wins loot
 * from the bank; one who falls short loses `PIRATE_ROB_CARDS` random cards. Seeded by the world seed and the round, never `g.rng`.
 */
export function resolvePirateRaid(ctx: Ctx): PirateResult[] {
  const { g } = ctx;
  const round = g.round || 0;
  const strength = pirateStrengthAt(round);
  const rng = eventStream(g.seed, PIRATE_SALT, round);
  const results: PirateResult[] = [];
  for (const p of g.players) {
    const defence = pirateDefence(g, p.id);
    if (defence >= strength) {
      const got = giveRandomResources(ctx, p.id, pirateLoot(strength, round, hasTech(g, p.id, TECH_PIRATE_HUNTER)), rng);
      p.stats.piratesBeaten = (p.stats.piratesBeaten || 0) + 1;
      results.push({ playerId: p.id, defence, strength, won: true, got, lost: {}, lostFish: 0 });
      ctx.log(`⚔️ ${p.avatar} ${p.name} (${defence} knights vs strength ${strength}) beat the pirates and took ${cardList(got)}`, p.color);
    } else {
      const { lost, lostFish } = robRandomCards(ctx, p.id, PIRATE_ROB_CARDS, rng);
      p.stats.piratesLost = (p.stats.piratesLost || 0) + 1;
      results.push({ playerId: p.id, defence, strength, won: false, got: {}, lost, lostFish });
      const what = cardList(lost, lostFish ? [`${lostFish} fish`] : []);
      ctx.log(`🏴‍☠️ ${p.avatar} ${p.name} (${defence} knights vs strength ${strength}) lost ${what} to the pirates`, p.color);
    }
  }
  ctx.emit('pirateEvent', { round, strength, results });
  return results;
}

/** The pirate raid card of the Event Deck. */
export const pirateRaidCard: EventCardDef = {
  id: PIRATE_EVENT_ID,
  title: 'Pirate raid',
  description: 'Pirates raid every coast. Each player with as many played knights as the pirates\' strength (or more) takes loot; everyone else loses 2 random cards.',
  pack: 'tidebound',
  copies: PIRATE_COPIES,
  icon: 'pirate',
  detail: (_g, round) => `Strength ${pirateStrengthAt(round)}`,
  apply(ctx) {
    if (!addonOn(ctx.reg, 'tidebound.pirates')) return;
    resolvePirateRaid(ctx);
  }
};

/** Older saves had pirate pieces on the board: removes their markers and tile data. Returns how many were cleared. */
export function clearOldPirates(g: GameState): number {
  let n = 0;
  for (const m of getMarkers(g, { kind: PIRATE_MARKER_KIND })) if (removeMarker(g, m.id)) n++;
  for (const h of g.board.hexes) if (h.ext?.pirate) { delete h.ext.pirate; n++; }
  return n;
}

/** The next pirate raid on the timeline, if any: its round and strength. */
export function nextPirateRaid(g: GameState, reg: Ctx['reg']): { round: number; strength: number } | null {
  const item = eventTimeline(g, reg).find(e => e.cardId === PIRATE_EVENT_ID);
  return item ? { round: item.round, strength: pirateStrengthAt(item.round) } : null;
}

/** Bot goal: a bot wants to play a knight while a raid on the timeline would beat it. The brain itself names no pirate (`wantsKnight` hook). */
export const pirateBotGoal: BotGoalDef = {
  id: 'tidebound.pirates',
  goalClass: 'generic',
  wantsKnight(ctx: Ctx, pid: Id): boolean {
    const raid = nextPirateRaid(ctx.g, ctx.reg);
    return !!raid && pirateDefence(ctx.g, pid) < raid.strength;
  }
};

export const piratesAddon: AddonDef = {
  id: 'tidebound.pirates',
  name: 'Pirates',
  description: 'Pirate raid events: players with enough played knights take loot, the rest lose 2 random cards. Needs the Event Deck.',
  links: [
    { target: 'strength', kind: 'mechanic' },
    { target: 'event-deck', kind: 'content' },
    { target: 'bot-goals', kind: 'bot' }
  ],
  register(api) {
    registerTideboundTechs(api);
    api.define(EVENT_CARDS, pirateRaidCard);
    api.define(BOT_GOALS, pirateBotGoal);
    api.hook('onRoundStart', (ctx: Ctx) => {
      clearOldPirates(ctx.g);
    });
  }
};

