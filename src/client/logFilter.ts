// MODULE: live log filter matching (pure: splits a filter key and decides whether a turn action matches it) | DEPENDS ON: client/types | USED BY: client/render/sidebar
import type { PlayerTurnSummary, RoundSummary, TurnActionItem } from './types';

/** A filter key is `kind:value` (`player:Breeze`, `round:2`, `cat:build`, `res:wood`, `val:Road`). */
export function splitFilterKey(filter: string): [string, string] {
  const idx = filter.indexOf(':');
  return idx < 0 ? [filter, ''] : [filter.slice(0, idx), filter.slice(idx + 1)];
}

/**
 * Whether one action of a turn card passes the filter.
 * `player:` keeps only the turns that player took: an action in another player's turn that merely names them
 * (`Breeze got +1 brick` during someone else's roll) is not something they did.
 */
export function actionMatchesFilter(act: TurnActionItem, turn: PlayerTurnSummary, round: RoundSummary, filter: string | null): boolean {
  if (!filter) return true;
  const [kind, val] = splitFilterKey(filter);
  const vLow = (val || '').toLowerCase();
  if (kind === 'player') {
    return turn.playerName.toLowerCase() === vLow;
  }
  if (kind === 'round') {
    return String(round.round) === val;
  }
  if (kind === 'cat') {
    return act.category === vLow;
  }
  if (kind === 'res') {
    if (act.resources?.some(r => r.resource.toLowerCase() === vLow)) return true;
    return act.text.toLowerCase().includes(vLow);
  }
  if (kind === 'val') {
    return (
      (act.badge || '').toLowerCase() === vLow ||
      act.text.toLowerCase().includes(vLow)
    );
  }
  return true;
}
