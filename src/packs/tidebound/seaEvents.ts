// MODULE: Tidebound sea event helpers (a seeded stream per event and round, random resources from the bank, card lists for the log; shared by the shipwreck, pirate and tide events) | DEPENDS ON: shared/index | USED BY: packs/tidebound/index, packs/tidebound/pirates, packs/tidebound/tides, packs/tidebound/wrecks
import { bankGive, createRng, rngNext } from '../../shared';
import type { Ctx, Id, Resources, RngState } from '../../shared';

/** A stream for one event in one round: a hash of the world seed, the event's salt and the round. Never `g.rng`. */
export function eventStream(seed: number, salt: number, round: number): RngState {
  return createRng(((Number(seed) || 1) ^ salt ^ Math.imul((Number(round) || 0) + 1, 0x9e3779b1)) >>> 0);
}

/** A d20 roll from `rng` (1 to 20). */
export function rollD20(rng: RngState): number {
  return 1 + Math.floor(rngNext(rng) * 20);
}

/**
 * Gives `pid` up to `count` resource cards, each a random resource the bank still holds (an empty pile is skipped). Returns what was given;
 * fewer than `count` only when the bank runs dry.
 */
export function giveRandomResources(ctx: Ctx, pid: Id, count: number, rng: RngState): Resources {
  const got: Resources = {};
  for (let i = 0; i < count; i++) {
    const open = [...ctx.reg.resources.keys()].filter(r => (ctx.g.bank[r] || 0) > 0);
    if (open.length === 0) break;
    const r = open[Math.floor(rngNext(rng) * open.length)];
    if (bankGive(ctx, pid, r, 1) > 0) got[r] = (got[r] || 0) + 1;
  }
  return got;
}

/** "2 wood, 1 ore" (or "nothing"), for log lines. */
export function cardList(cards: Resources, extra: string[] = []): string {
  const parts = Object.entries(cards).filter(([, n]) => n > 0).map(([r, n]) => `${n} ${r}`);
  parts.push(...extra);
  return parts.length ? parts.join(', ') : 'nothing';
}

/** Total cards in a resource bundle. */
export function cardCount(cards: Resources): number {
  return Object.values(cards).reduce((a, n) => a + (Number(n) || 0), 0);
}
