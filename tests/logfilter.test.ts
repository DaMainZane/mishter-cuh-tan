import { describe, expect, it } from 'vitest';
import { actionMatchesFilter, splitFilterKey } from '../src/client/logFilter';

// Bug "live log player filter": filtering by a player showed other players' turns too, because an action in their turn
// only had to mention the name ("Breeze got +1 brick" while Jew rolled). The player filter shows what that player did.

const turn = (playerName: string): any => ({ playerName });
const act = (text: string, extra: Record<string, unknown> = {}): any => ({ text, category: 'produce', ...extra });
const round = (n: number): any => ({ round: n });

describe('live log player filter', () => {
  it('keeps every action in the filtered player\'s own turns', () => {
    for (const text of ['Built Road', 'Rolled 5 (2 + 3)', 'Produced a sheep', 'Passed turn']) {
      expect(actionMatchesFilter(act(text), turn('Breeze'), round(1), 'player:Breeze')).toBe(true);
    }
  });

  it('ignores the case of the name', () => {
    expect(actionMatchesFilter(act('Built Road'), turn('Breeze'), round(1), 'player:breeze')).toBe(true);
  });

  it('drops an action in another player\'s turn that only names them', () => {
    expect(actionMatchesFilter(act('Breeze got +1 brick'), turn('Jew'), round(1), 'player:Breeze')).toBe(false);
  });

  it('drops another player\'s turn that has no mention at all', () => {
    expect(actionMatchesFilter(act('Built Road'), turn('Jew'), round(1), 'player:Breeze')).toBe(false);
  });

  it('shows past rounds too (the filter does not look at the round)', () => {
    for (const n of [0, 1, 2, 9]) expect(actionMatchesFilter(act('Built Road'), turn('Breeze'), round(n), 'player:Breeze')).toBe(true);
  });

  it('shows everything with no filter', () => {
    expect(actionMatchesFilter(act('Built Road'), turn('Jew'), round(1), null)).toBe(true);
  });
});

describe('live log other filters keep working', () => {
  it('round, category, resource and value filters', () => {
    expect(actionMatchesFilter(act('x'), turn('Jew'), round(2), 'round:2')).toBe(true);
    expect(actionMatchesFilter(act('x'), turn('Jew'), round(2), 'round:3')).toBe(false);
    expect(actionMatchesFilter(act('x', { category: 'build' }), turn('Jew'), round(1), 'cat:build')).toBe(true);
    expect(actionMatchesFilter(act('x', { category: 'trade' }), turn('Jew'), round(1), 'cat:build')).toBe(false);
    expect(actionMatchesFilter(act('x', { resources: [{ resource: 'brick', amount: 1 }] }), turn('Jew'), round(1), 'res:brick')).toBe(true);
    expect(actionMatchesFilter(act('x', { badge: 'Road' }), turn('Jew'), round(1), 'val:Road')).toBe(true);
  });

  it('splits a key at the first colon only', () => {
    expect(splitFilterKey('player:Dr: Who')).toEqual(['player', 'Dr: Who']);
    expect(splitFilterKey('none')).toEqual(['none', '']);
  });
});
