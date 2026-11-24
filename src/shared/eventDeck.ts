// MODULE: S0.11 seeded event deck (service 16: `event-deck`, base + DLC cards, top-card preview, fate token veto/uphold, derived RNG stream) | DEPENDS ON: shared/ctx, shared/history, shared/registry, shared/rng, shared/state, shared/tileState, +1 more | USED BY: shared/index, shared/stage1
import type { Ctx } from './ctx';
import { appendPublicHistory } from './history';
import { defsOf } from './registry';
import type { Registry } from './registry';
import { createRng, rngInt, rngShuffle } from './rng';
import type { RngState } from './rng';
import { bankGive, getPlayer } from './state';
import { setTileState } from './tileState';
import type { GameState, Id } from './types';

export const EVENT_CARDS = 'eventCards';

export interface EventCardDef {
  id: string;
  title: string;
  description: string;
  /** Optional pack/DLC id; only included when that pack/addon is enabled or for base events. */
  pack?: string;
  /** Number of copies in the deck (default 1). A function reads the game's rules (the Tide level slider sets how many tide cards there are). */
  copies?: number | ((g: GameState | undefined) => number);
  /** UI icon name for the event timeline and title card (`client/icons.ts`). */
  icon?: string;
  /** One short line the timeline shows under the card, for the round it fires in (a pirate's strength, a tide's height). */
  detail?(g: GameState, round: number): string | undefined;
  /** Runs when the event is drawn and resolved at round start. */
  apply(ctx: Ctx): void;
  replace?: boolean;
}

export interface EventDeckState {
  rng: RngState;
  deck: string[];
  discard: string[];
  activeEventId: string | null;
  fateTokens: Record<Id, number>;
  /** Rounds the next cards fire in: `rounds[i]` is the round of `deck[i]` (the event timeline). Filled by `ensureEventTimeline`. */
  rounds?: number[];
  /** The last event that fired (the client shows its title card once). */
  lastEvent?: { cardId: string; title: string; icon?: string; round: number } | null;
  /** Pending veto state for the current preview card (`deck[0]`). */
  pendingVeto: {
    cardId: string;
    vetoedBy: Id;
    upheldBy: Id | null;
  } | null;
}

/** Built-in base event cards available in any game with `eventsOn`. */
export const BASE_EVENT_CARDS: EventCardDef[] = [
  {
    id: 'base.festival',
    title: 'Harvest Festival',
    description: 'Every player receives 1 resource of their smallest pile from the bank.',
    copies: 2,
    apply(ctx) {
      const resources = [...ctx.reg.resources.keys()];
      if (resources.length === 0) return;
      for (const p of ctx.g.players) {
        const sorted = [...resources].sort((a, b) => (p.resources[a] || 0) - (p.resources[b] || 0));
        for (const r of sorted) {
          if ((ctx.g.bank[r] || 0) > 0) {
            bankGive(ctx, p.id, r, 1);
            break;
          }
        }
      }
    }
  },
  {
    id: 'base.drought',
    title: 'Summer Drought',
    description: 'The highest-numbered wheat field is parched (barren) for 1 round.',
    copies: 1,
    apply(ctx) {
      const wheats = ctx.g.board.hexes
        .filter(h => h.type === 'wheat' && !h.ext.hidden && h.number !== null)
        .sort((a, b) => (b.number || 0) - (a.number || 0));
      if (wheats[0]) {
        setTileState(ctx.g, wheats[0].id, { id: 'barren', until: (ctx.g.round || 1) + 1 });
      }
    }
  },
  {
    id: 'base.bountiful_hills',
    title: 'Bountiful Hills',
    description: 'The lowest-numbered brick hill becomes fertile (+1 yield) for 1 round.',
    copies: 1,
    apply(ctx) {
      const bricks = ctx.g.board.hexes
        .filter(h => h.type === 'brick' && !h.ext.hidden && h.number !== null)
        .sort((a, b) => (a.number || 99) - (b.number || 99));
      if (bricks[0]) {
        setTileState(ctx.g, bricks[0].id, { id: 'fertile', until: (ctx.g.round || 1) + 1 });
      }
    }
  },
  {
    id: 'base.calm_seas',
    title: 'Calm Seas',
    description: 'Maritime winds favour traders: each port owner gains 1 sheep or wood from the bank.',
    copies: 1,
    apply(ctx) {
      const portOwners = new Set<Id>();
      for (const v of ctx.g.board.vertices) {
        if (v.piece && v.port) portOwners.add(v.piece.owner);
      }
      for (const pid of portOwners) {
        if ((ctx.g.bank.wood || 0) > 0) bankGive(ctx, pid, 'wood', 1);
        else if ((ctx.g.bank.sheep || 0) > 0) bankGive(ctx, pid, 'sheep', 1);
      }
    }
  }
];

/** Derives an independent RNG stream from `g.seed` so the event deck never shifts `g.rng`. */
export function deriveEventRng(seed: number): RngState {
  return createRng(((Number(seed) || 1) ^ 0x9e3779b9) >>> 0);
}

/** All event card definitions active for this registry (base cards + registered `EVENT_CARDS`). */
export function allEventCards(reg: Registry): Map<string, EventCardDef> {
  const map = new Map<string, EventCardDef>();
  for (const c of BASE_EVENT_CARDS) map.set(c.id, c);
  for (const [id, c] of defsOf<EventCardDef>(reg, EVENT_CARDS).entries()) {
    map.set(id, c);
  }
  return map;
}

function buildShuffledDeckIds(reg: Registry, rng: RngState, g?: GameState): string[] {
  const cards = allEventCards(reg);
  const ids: string[] = [];
  for (const c of cards.values()) {
    const raw = typeof c.copies === 'function' ? c.copies(g) : c.copies;
    const count = Math.max(1, Math.floor(Number(raw ?? 1)) || 1);
    for (let i = 0; i < count; i++) ids.push(c.id);
  }
  return rngShuffle(rng, ids);
}

/** Initializes or returns the seeded event deck state in `g.ext.core.eventDeck`. Never touches `g.rng`. */
export function ensureEventDeck(g: GameState, reg: Registry): EventDeckState {
  g.ext = g.ext || {};
  g.ext.core = g.ext.core || {};
  if (!g.ext.core.eventDeck) {
    const rng = deriveEventRng(g.seed);
    const deck = buildShuffledDeckIds(reg, rng, g);
    const startTokens = Math.max(0, Number(g.rules?.fateTokens ?? 2));
    const fateTokens: Record<Id, number> = {};
    for (const p of g.players) fateTokens[p.id] = startTokens;
    g.ext.core.eventDeck = {
      rng,
      deck,
      discard: [],
      activeEventId: null,
      fateTokens,
      pendingVeto: null
    } satisfies EventDeckState;
  }
  const st = g.ext.core.eventDeck as EventDeckState;
  if (st.deck.length === 0) {
    st.deck = buildShuffledDeckIds(reg, st.rng, g);
    st.discard = [];
  }
  return st;
}

// ---- Event timeline (2026-11-24): the next cards and the rounds they fire in, shown to every player --------------------------

/** Upcoming events the timeline knows (and shows). */
export const EVENT_TIMELINE_LENGTH = 3;
/** Rounds between two events: random from this range, drawn from the deck's own stream. */
export const EVENT_GAP_MIN = 2;
export const EVENT_GAP_MAX = 4;

/** One upcoming event as the timeline shows it. */
export interface EventTimelineItem {
  cardId: string;
  title: string;
  icon?: string;
  round: number;
  detail?: string;
}

/**
 * Makes sure the deck holds at least `EVENT_TIMELINE_LENGTH` cards (a fresh shuffled pile is put under a short deck) and that each of the next
 * cards has the round it fires in: the first 2 to 4 rounds after `fromRound`, each next one 2 to 4 rounds after the one before. Never `g.rng`.
 */
export function ensureEventTimeline(g: GameState, reg: Registry, fromRound = g.round || 0): EventDeckState {
  const st = ensureEventDeck(g, reg);
  while (st.deck.length < EVENT_TIMELINE_LENGTH) st.deck.push(...buildShuffledDeckIds(reg, st.rng, g));
  if (!Array.isArray(st.rounds)) st.rounds = [];
  const gap = () => EVENT_GAP_MIN + rngInt(st.rng, EVENT_GAP_MAX - EVENT_GAP_MIN + 1);
  while (st.rounds.length < EVENT_TIMELINE_LENGTH) {
    const last = st.rounds.length ? st.rounds[st.rounds.length - 1] : fromRound;
    st.rounds.push(last + gap());
  }
  return st;
}

/** The next events with their rounds, for the timeline. Empty when the deck is off. Reads the state only (call `ensureEventTimeline` first). */
export function eventTimeline(g: GameState, reg: Registry): EventTimelineItem[] {
  const st = g.ext?.core?.eventDeck as EventDeckState | undefined;
  if (!g.rules?.eventsOn || !st || !Array.isArray(st.rounds)) return [];
  const cards = allEventCards(reg);
  const out: EventTimelineItem[] = [];
  for (let i = 0; i < Math.min(st.rounds.length, st.deck.length, EVENT_TIMELINE_LENGTH); i++) {
    const card = cards.get(st.deck[i]);
    if (!card) continue;
    const round = st.rounds[i];
    out.push({ cardId: card.id, title: card.title, icon: card.icon, round, detail: card.detail?.(g, round) });
  }
  return out;
}

/**
 * Round start with the deck on: the first time it lays out the timeline; when the first card's round has come, that card is drawn and applied,
 * and the timeline gets its next card. Returns the card that fired, if any.
 */
export function runRoundEvents(ctx: Ctx): EventCardDef | null {
  const { g, reg } = ctx;
  const round = g.round || 0;
  const st = ensureEventTimeline(g, reg, round);
  let fired: EventCardDef | null = null;
  if (st.rounds!.length > 0 && st.rounds![0] <= round) {
    st.rounds!.shift();
    fired = drawAndApplyRoundEvent(ctx);
    if (fired) st.lastEvent = { cardId: fired.id, title: fired.title, icon: fired.icon, round };
    ensureEventTimeline(g, reg, round);
  }
  return fired;
}

/** Returns the top card of the event deck (the 1-round-ahead preview), without mutating the deck. */
export function peekNextEvent(g: GameState, reg: Registry): EventCardDef | null {
  const st = ensureEventDeck(g, reg);
  const topId = st.deck[0];
  if (!topId) return null;
  return allEventCards(reg).get(topId) ?? null;
}

export function getFateTokens(g: GameState, reg: Registry, pid: Id): number {
  const st = ensureEventDeck(g, reg);
  return st.fateTokens[pid] ?? 0;
}

export function addFateTokens(g: GameState, reg: Registry, pid: Id, delta: number): number {
  const st = ensureEventDeck(g, reg);
  const maxCap = Math.max(2, Number(g.rules?.fateTokens ?? 2));
  const next = Math.max(0, Math.min(maxCap, (st.fateTokens[pid] ?? 0) + delta));
  st.fateTokens[pid] = next;
  return next;
}

/**
 * Player spends 1 Fate token to veto the previewed top card (`deck[0]`).
 * Records `pendingVeto`; if no other player upholds it before resolution (or when resolved immediately with `resolveNow = true`),
 * the vetoed card moves to the bottom of the deck and the new top card becomes the preview.
 */
export function vetoPreviewEvent(
  ctx: Ctx,
  pid: Id,
  resolveNow = true
): { ok: boolean; error?: string; vetoedCardId?: string; nextPreviewId?: string | null } {
  const { g, reg } = ctx;
  const st = ensureEventDeck(g, reg);
  const p = getPlayer(g, pid);
  if (!p) return { ok: false, error: 'Unknown player' };
  if ((st.fateTokens[pid] ?? 0) <= 0) return { ok: false, error: 'No Fate tokens left' };
  const topId = st.deck[0];
  if (!topId) return { ok: false, error: 'No previewed event to veto' };
  if (st.pendingVeto && st.pendingVeto.cardId === topId) {
    return { ok: false, error: 'This event already has a pending veto' };
  }

  st.fateTokens[pid] -= 1;
  p.stats.fateSpent = (p.stats.fateSpent || 0) + 1;
  st.pendingVeto = { cardId: topId, vetoedBy: pid, upheldBy: null };

  if (resolveNow) {
    const shifted = st.deck.shift()!;
    st.deck.push(shifted);
    st.pendingVeto = null;
  }

  const card = allEventCards(reg).get(topId);
  ctx.emit('eventVetoed', { playerId: pid, cardId: topId, title: card?.title ?? topId });
  ctx.log(`🔮 ${p.avatar} ${p.name} spent a Fate token to veto "${card?.title ?? topId}"!`, p.color);
  return { ok: true, vetoedCardId: topId, nextPreviewId: st.deck[0] ?? null };
}

/**
 * Another player spends 1 Fate token to uphold a vetoed preview event, locking it back to the top of the deck.
 */
export function upholdPreviewEvent(
  ctx: Ctx,
  pid: Id
): { ok: boolean; error?: string; upheldCardId?: string } {
  const { g, reg } = ctx;
  const st = ensureEventDeck(g, reg);
  const p = getPlayer(g, pid);
  if (!p) return { ok: false, error: 'Unknown player' };
  if ((st.fateTokens[pid] ?? 0) <= 0) return { ok: false, error: 'No Fate tokens left' };

  let targetCardId = st.pendingVeto?.cardId;
  if (st.pendingVeto) {
    if (st.pendingVeto.vetoedBy === pid) return { ok: false, error: 'Cannot uphold your own veto' };
    st.pendingVeto.upheldBy = pid;
    st.pendingVeto = null;
  } else if (st.deck.length > 1) {
    // If veto already pushed the card to the bottom of the deck (`resolveNow = true`), pull it back to the top!
    const bottom = st.deck.pop()!;
    st.deck.unshift(bottom);
    targetCardId = bottom;
  } else {
    return { ok: false, error: 'No vetoed event to uphold' };
  }

  st.fateTokens[pid] -= 1;
  p.stats.fateSpent = (p.stats.fateSpent || 0) + 1;
  const card = targetCardId ? allEventCards(reg).get(targetCardId) : undefined;
  ctx.emit('eventUpheld', { playerId: pid, cardId: targetCardId, title: card?.title ?? targetCardId });
  ctx.log(`⚖️ ${p.avatar} ${p.name} spent a Fate token to uphold "${card?.title ?? targetCardId}"!`, p.color);
  return { ok: true, upheldCardId: targetCardId };
}

/** Draws the top card of the event deck, applies its effect, records it in public history, and ensures the next preview is ready. */
export function drawAndApplyRoundEvent(ctx: Ctx): EventCardDef | null {
  const { g, reg } = ctx;
  const st = ensureEventDeck(g, reg);

  // If a pending veto was not upheld before the round started, push the vetoed card to the bottom first.
  if (st.pendingVeto && !st.pendingVeto.upheldBy && st.deck[0] === st.pendingVeto.cardId) {
    const vetoed = st.deck.shift()!;
    st.deck.push(vetoed);
  }
  st.pendingVeto = null;

  if (st.deck.length === 0) {
    st.deck = buildShuffledDeckIds(reg, st.rng, g);
    st.discard = [];
  }
  const cardId = st.deck.shift();
  if (!cardId) return null;
  st.discard.push(cardId);
  st.activeEventId = cardId;

  if (st.deck.length === 0) {
    st.deck = buildShuffledDeckIds(reg, st.rng, g);
    st.discard = [];
  }

  const card = allEventCards(reg).get(cardId);
  if (!card) return null;

  card.apply(ctx);
  ctx.emit('eventDrawn', { cardId: card.id, title: card.title, description: card.description, round: g.round || 1 });
  appendPublicHistory(g, {
    type: 'eventDrawn',
    actorId: null,
    targetId: null,
    summary: `Event: ${card.title}`,
    data: { cardId: card.id, title: card.title }
  });
  ctx.log(`📜 Event — ${card.title}: ${card.description}`, null);
  return card;
}
