// MODULE: fish spend picks (pure: how many cards a stack of fish buys, adding and removing picks within the bank's supply, the list to send) | DEPENDS ON: client/constants | USED BY: client/render/drawer
import { RESOURCES } from './constants';

// A stack of fish is spent in one go: one resource pick per fish held, then confirm. The functions never change the object they are given.

type Picks = Record<string, number>;
type Hand = Record<string, number> | undefined | null;

/** Picks needed: one per fish, but no more than the bank can hand out in total (so the stack can still be spent when the bank runs thin). */
export function fishNeed(held: number, bank: Hand): number {
  const supply = RESOURCES.reduce((s, r) => s + Math.max(0, bank?.[r] ?? 0), 0);
  return Math.max(0, Math.min(Math.floor(Number(held)) || 0, supply));
}

/** Number of picks made so far. */
export function fishPickCount(sel: Picks): number {
  return Object.values(sel).reduce((s, n) => s + n, 0);
}

/** Can one more pick of `resource` be added: not past the need, and not more of it than the bank holds. */
export function canAddFishPick(sel: Picks, resource: string, held: number, bank: Hand): boolean {
  return fishPickCount(sel) < fishNeed(held, bank) && (sel[resource] || 0) < Math.max(0, bank?.[resource] ?? 0);
}

/** `sel` with one more pick of `resource`, or `sel` itself when that is not allowed. */
export function addFishPick(sel: Picks, resource: string, held: number, bank: Hand): Picks {
  return canAddFishPick(sel, resource, held, bank) ? { ...sel, [resource]: (sel[resource] || 0) + 1 } : sel;
}

/** `sel` with one pick of `resource` taken back; the key goes away at zero. */
export function removeFishPick(sel: Picks, resource: string): Picks {
  if (!(sel[resource] > 0)) return sel;
  const out = { ...sel, [resource]: sel[resource] - 1 };
  if (out[resource] === 0) delete out[resource];
  return out;
}

/** One resource per fish to send, in the order of `RESOURCES`. */
export function fishPickList(sel: Picks): string[] {
  const out: string[] = [];
  for (const r of RESOURCES) for (let i = 0; i < (sel[r] || 0); i++) out.push(r);
  return out;
}
