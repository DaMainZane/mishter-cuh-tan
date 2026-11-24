// Tidebound sea events (2026-11-24 rework): shipwreck and pirate raid are Event Deck cards that hit every player at once, shown on a timeline
// of the next 3 events (one every 2 to 4 rounds). No pieces on the board, no `g.rng` draws.
import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import {
  addMarker,
  allEventCards,
  createGame,
  ensureEventTimeline,
  EVENT_GAP_MAX,
  EVENT_GAP_MIN,
  EVENT_TIMELINE_LENGTH,
  eventTimeline,
  getMarkers,
  getWildTokens,
  grantWildToken,
  makeCtx,
  registryFor,
  runRoundEvents
} from '../src/shared';
import type { GameState, Registry } from '../src/shared';
import {
  cardCount,
  clearOldPirates,
  clearOldWrecks,
  FISH,
  PIRATE_EVENT_ID,
  PIRATE_LOOT_MAX,
  pirateLoot,
  pirateStrengthAt,
  resolvePirateRaid,
  resolveShipwreck,
  SHIPWRECK_EVENT_ID,
  shipwreckCards,
  TECH_PIRATE_HUNTER
} from '../src/packs/tidebound';

function makeGame(rules: Record<string, any> = { dlc: { tidebound: true }, eventsOn: true }, seed = 2411): { g: GameState; reg: Registry } {
  const reg = registryFor(allPacks, rules);
  const g = createGame(reg, {
    seed,
    players: [
      { id: 'p1', name: 'Ayla', color: '#e74c3c', isBot: false },
      { id: 'p2', name: 'Bram', color: '#3498db', isBot: false },
      { id: 'p3', name: 'Cleo', color: '#2ecc71', isBot: false }
    ],
    rules,
    shuffleSeats: false
  });
  g.phase = 'main';
  return { g, reg };
}

const handSize = (g: GameState, pid: string) => Object.values(g.players.find(p => p.id === pid)!.resources).reduce((a, n) => a + (n || 0), 0);
const bankSize = (g: GameState) => Object.values(g.bank).reduce((a, n) => a + (Number(n) || 0), 0);

describe('the deck with Tidebound', () => {
  it('holds 2 shipwreck and 2 pirate raid cards, each with an icon for the timeline', () => {
    const { reg } = makeGame();
    const cards = allEventCards(reg);
    expect(cards.get(SHIPWRECK_EVENT_ID)).toMatchObject({ copies: 2, icon: 'wreck' });
    expect(cards.get(PIRATE_EVENT_ID)).toMatchObject({ copies: 2, icon: 'pirate' });
  });

  it('has neither card with Tidebound off, or with the addon off', () => {
    expect(allEventCards(makeGame({ eventsOn: true }).reg).has(SHIPWRECK_EVENT_ID)).toBe(false);
    const { reg } = makeGame({ dlc: { tidebound: true }, eventsOn: true, addons: { 'tidebound.pirates': false } });
    expect(allEventCards(reg).has(PIRATE_EVENT_ID)).toBe(false);
    expect(allEventCards(reg).has(SHIPWRECK_EVENT_ID)).toBe(true);
  });
});

describe('the event timeline', () => {
  it('lays out the next 3 events, the first 2 to 4 rounds out and each next one 2 to 4 rounds after the one before', () => {
    const { g, reg } = makeGame();
    g.round = 1;
    ensureEventTimeline(g, reg, 1);
    const tl = eventTimeline(g, reg);
    expect(tl).toHaveLength(EVENT_TIMELINE_LENGTH);
    let prev = 1;
    for (const e of tl) {
      expect(e.round - prev).toBeGreaterThanOrEqual(EVENT_GAP_MIN);
      expect(e.round - prev).toBeLessThanOrEqual(EVENT_GAP_MAX);
      prev = e.round;
    }
  });

  it('fires the first card on its round, remembers it and refills the timeline, without drawing from g.rng', () => {
    const { g, reg } = makeGame();
    g.round = 1;
    const ctx = makeCtx(g, reg);
    const st = ensureEventTimeline(g, reg, 1);
    const first = st.deck[0];
    const at = st.rounds![0];
    const rngBefore = JSON.stringify(g.rng);

    for (let r = 2; r < at; r++) {
      g.round = r;
      expect(runRoundEvents(ctx)).toBeNull();
    }
    g.round = at;
    const fired = runRoundEvents(ctx);
    expect(fired?.id).toBe(first);
    expect(st.lastEvent).toMatchObject({ cardId: first, round: at });
    expect(eventTimeline(g, reg)).toHaveLength(EVENT_TIMELINE_LENGTH);
    expect(eventTimeline(g, reg)[0].round).toBeGreaterThan(at);
    expect(JSON.stringify(g.rng)).toBe(rngBefore);
  });

  it('shows a pirate raid with the strength of the round it fires in', () => {
    const { g, reg } = makeGame();
    const st = ensureEventTimeline(g, reg, 20);
    st.deck[0] = PIRATE_EVENT_ID;
    const item = eventTimeline(g, reg)[0];
    expect(item.detail).toBe(`Strength ${pirateStrengthAt(item.round)}`);
  });

  it('is empty while the deck is off', () => {
    const { g, reg } = makeGame({ dlc: { tidebound: true } });
    expect(eventTimeline(g, reg)).toEqual([]);
  });
});

describe('shipwreck', () => {
  it('salvages 2 to 6 cards by the d20: 1-4 two, 5-8 three, 9-12 four, 13-16 five, 17-20 six', () => {
    expect([1, 4, 5, 8, 9, 12, 13, 16, 17, 20].map(shipwreckCards)).toEqual([2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  });

  it('gives every player their d20 worth of random resources from the bank, the same for the same seed and round', () => {
    const run = () => {
      const { g, reg } = makeGame();
      g.round = 9;
      const bank = bankSize(g);
      const results = resolveShipwreck(makeCtx(g, reg));
      return { g, bank, results };
    };
    const a = run();
    expect(a.results.map(r => r.playerId)).toEqual(['p1', 'p2', 'p3']);
    let total = 0;
    for (const r of a.results) {
      expect(r.roll).toBeGreaterThanOrEqual(1);
      expect(r.roll).toBeLessThanOrEqual(20);
      expect(cardCount(r.got)).toBe(shipwreckCards(r.roll));
      expect(handSize(a.g, r.playerId)).toBe(r.cards);
      total += r.cards;
    }
    expect(bankSize(a.g)).toBe(a.bank - total);
    expect(run().results).toEqual(a.results);
  });
});

describe('pirate raid', () => {
  it('grows slowly: strength 1 until round 13, +1 every 10 rounds, at most 5', () => {
    expect([0, 4, 13, 14, 24, 34, 44, 54, 90].map(pirateStrengthAt)).toEqual([1, 1, 1, 2, 3, 4, 5, 5, 5]);
  });

  it('pays 2 + strength + 1 per 15 rounds, at most 8; Pirate hunter adds 1 past the cap', () => {
    expect(pirateLoot(1, 4)).toBe(3);
    expect(pirateLoot(4, 40)).toBe(8);
    expect(pirateLoot(5, 90)).toBe(PIRATE_LOOT_MAX);
    expect(pirateLoot(5, 90, true)).toBe(PIRATE_LOOT_MAX + 1);
  });

  it('a tie wins: as many played knights as the strength takes the loot; fewer loses 2 random cards to the bank', () => {
    const { g, reg } = makeGame();
    g.round = 14; // strength 2, loot 4
    const [p1, p2, p3] = g.players;
    p1.stats.knightsPlayed = 2;
    p2.stats.knightsPlayed = 1;
    p2.resources = { wood: 3, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    p3.stats.knightsPlayed = 0;
    p3.resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    const woodInBank = g.bank.wood;

    const [r1, r2, r3] = resolvePirateRaid(makeCtx(g, reg));
    expect(r1).toMatchObject({ won: true, defence: 2, strength: 2 });
    expect(cardCount(r1.got)).toBe(4);
    expect(r2.won).toBe(false);
    expect(r2.lost).toEqual({ wood: 2 });
    expect(p2.resources.wood).toBe(1);
    expect(r3).toMatchObject({ won: false, lost: {}, lostFish: 0 });
    // p1's loot came out of the bank and p2's 2 wood went back in.
    expect(g.bank.wood - woodInBank + (r1.got.wood || 0)).toBe(2);
  });

  it('can take fish, which are gone (there is no fish bank)', () => {
    const { g, reg } = makeGame();
    g.round = 14;
    const ctx = makeCtx(g, reg);
    g.players[0].resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    grantWildToken(ctx, 'p1', FISH, 3);
    const r = resolvePirateRaid(ctx)[0];
    expect(r.won).toBe(false);
    expect(r.lostFish).toBe(2);
    expect(getWildTokens(g, 'p1', FISH)).toBe(1);
  });

  it('Pirate hunter counts as 2 knights', () => {
    const { g, reg } = makeGame();
    g.round = 14;
    g.ext.core = g.ext.core || {};
    g.ext.core.techs = { p1: [TECH_PIRATE_HUNTER] };
    const r = resolvePirateRaid(makeCtx(g, reg))[0];
    expect(r).toMatchObject({ won: true, defence: 2 });
    expect(cardCount(r.got)).toBe(pirateLoot(2, 14, true));
  });
});

describe('old saves', () => {
  it('clears the wreck and pirate pieces older games left on the board', () => {
    const { g } = makeGame();
    addMarker(g, { id: 'w', kind: 'wreck', target: 'hex', loc: 0, ownerId: null, countdown: 2, payload: {} });
    addMarker(g, { id: 'p', kind: 'pirate', target: 'hex', loc: 1, ownerId: null, countdown: null, payload: {} });
    g.board.hexes[2].ext = { ...g.board.hexes[2].ext, pirate: { strength: 1 }, wreck: { id: 'x' } };
    expect(clearOldWrecks(g)).toBe(2);
    expect(clearOldPirates(g)).toBe(2);
    expect(getMarkers(g, {})).toEqual([]);
    expect(g.board.hexes[2].ext?.pirate).toBeUndefined();
  });
});
