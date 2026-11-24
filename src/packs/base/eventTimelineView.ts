// MODULE: event timeline view (shared field `eventTimeline` while the Event Deck is on: the next events with the rounds they fire in, and the last one that fired) | DEPENDS ON: shared/index | USED BY: packs/base/hooks
import { eventTimeline } from '../../shared';
import type { EventDeckState, ViewDataDef } from '../../shared';

/**
 * `eventTimeline` for every viewer while `rules.eventsOn`: `upcoming` (the next cards, their rounds, an icon and a detail line such as a pirate's
 * strength) and `last` (the card that fired last, for the client's title card). Nothing is added while the deck is off.
 */
export const eventTimelineViewData: ViewDataDef = {
  id: 'base.event_timeline',
  shared(g, reg) {
    if (!g.rules?.eventsOn) return undefined;
    const st = g.ext?.core?.eventDeck as EventDeckState | undefined;
    return { eventTimeline: { upcoming: eventTimeline(g, reg), last: st?.lastEvent ?? null } };
  }
};
