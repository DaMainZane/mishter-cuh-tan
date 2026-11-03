import { describe, expect, it } from 'vitest';
import { addFishPick, canAddFishPick, fishNeed, fishPickCount, fishPickList, removeFishPick } from '../src/client/fishSpend';

// BUG: clicking a stack of fish uses all of them at once: you pick one resource per fish, then confirm. One fish keeps the one-click spend.

const bank = { wood: 5, brick: 5, sheep: 5, wheat: 5, ore: 5 };

describe('fish spend: pick as many cards as fish held', () => {
  it('needs one pick per fish, but never more than the bank can pay', () => {
    expect(fishNeed(3, bank)).toBe(3);
    expect(fishNeed(0, bank)).toBe(0);
    expect(fishNeed(4, { wood: 1, brick: 1, sheep: 0, wheat: 0, ore: 0 })).toBe(2);
  });

  it('adds picks until the need is met, one resource at most as often as the bank holds it', () => {
    let sel: Record<string, number> = {};
    sel = addFishPick(sel, 'wood', 3, bank);
    sel = addFishPick(sel, 'wood', 3, bank);
    sel = addFishPick(sel, 'ore', 3, bank);
    expect(sel).toEqual({ wood: 2, ore: 1 });
    expect(fishPickCount(sel)).toBe(3);
    // Full: a fourth pick is ignored.
    expect(canAddFishPick(sel, 'brick', 3, bank)).toBe(false);
    expect(addFishPick(sel, 'brick', 3, bank)).toEqual(sel);
    // The bank holds one wood: only one pick of it.
    const thin = { ...bank, wood: 1 };
    const one = addFishPick({}, 'wood', 3, thin);
    expect(canAddFishPick(one, 'wood', 3, thin)).toBe(false);
    expect(canAddFishPick(one, 'brick', 3, thin)).toBe(true);
  });

  it('removes a pick, dropping the key at zero, and lists one entry per fish in a stable order', () => {
    const sel = { wood: 2, ore: 1 };
    expect(removeFishPick(sel, 'wood')).toEqual({ wood: 1, ore: 1 });
    expect(removeFishPick({ ore: 1 }, 'ore')).toEqual({});
    expect(removeFishPick({}, 'wood')).toEqual({});
    expect(fishPickList(sel)).toEqual(['wood', 'wood', 'ore']);
  });

  it('does not change the object it was given', () => {
    const sel = { wood: 1 };
    addFishPick(sel, 'ore', 3, bank);
    removeFishPick(sel, 'wood');
    expect(sel).toEqual({ wood: 1 });
  });
});
