// MODULE: Event Deck timeline strip (the next events: icon, round and a detail such as a pirate's strength, under the round clock) and the title card when an event fires | DEPENDS ON: client/audio, client/icons, client/render/overlay, client/store, client/util | USED BY: client/render/index
import { playWreckSpawnSound } from '../audio';
import { uiIcon } from '../icons';
import { state } from '../store';
import { esc } from '../util';
import { showEventTitleCard } from './overlay';

let lastStripHtml = '';
// The last event this screen has seen. Empty = no state of this game seen yet, so joining or reconnecting does not replay an old card.
let eventSeenKey = '';

/** Card icons the client draws; anything else (an addon card without an icon of its own) uses the deck's card glyph. */
function iconFor(name: string | undefined): string {
  return uiIcon(name || 'cards', 18) || uiIcon('cards', 18);
}

function ensureStrip(): HTMLElement | null {
  let el = document.getElementById('eventTimelineHud');
  if (el) return el;
  const clock = document.getElementById('gameClockHud');
  if (!clock?.parentElement) return null;
  el = document.createElement('div');
  el.id = 'eventTimelineHud';
  el.className = 'event-timeline-hud';
  el.setAttribute('aria-label', 'Upcoming events');
  clock.after(el);
  return el;
}

/** The strip of upcoming events. Hidden in the lobby, after the game and while the Event Deck is off. */
function renderStrip(): void {
  const el = ensureStrip();
  if (!el) return;
  const tl = state.eventTimeline;
  const upcoming = tl?.upcoming ?? [];
  if (!tl || upcoming.length === 0 || state.status === 'LOBBY' || state.status === 'GAMEOVER') {
    if (lastStripHtml !== '') {
      lastStripHtml = '';
      el.innerHTML = '';
    }
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  const round = Number(state.round) || 0;
  const html = upcoming
    .map((e, i) => {
      const inRounds = Math.max(0, e.round - round);
      const when = inRounds <= 0 ? 'now' : inRounds === 1 ? 'next round' : `in ${inRounds} rounds`;
      const tip = `${e.title}${e.detail ? ` (${e.detail})` : ''}: round ${e.round}, ${when}`;
      return `<div class="event-chip${i === 0 ? ' next' : ''}" title="${esc(tip)}">
        <span class="event-chip-icon">${iconFor(e.icon)}</span>
        <span class="event-chip-text"><span class="event-chip-round">R${esc(e.round)}</span>${e.detail ? `<span class="event-chip-detail">${esc(e.detail)}</span>` : ''}</span>
      </div>`;
    })
    .join('');
  if (html !== lastStripHtml) {
    lastStripHtml = html;
    el.innerHTML = html;
  }
}

/** The title card for an event that just fired (the log has one line per player). Tides show their own card (`syncTideUi`). */
function syncTitleCard(): void {
  const last = state.eventTimeline?.last ?? null;
  if (!state.eventTimeline || state.status === 'LOBBY' || state.status === 'GAMEOVER') {
    eventSeenKey = '';
    return;
  }
  const key = `${state.code || ''}:${last ? `${last.round}:${last.cardId}` : '-'}`;
  if (eventSeenKey === '') {
    eventSeenKey = key;
    return;
  }
  if (key === eventSeenKey) return;
  eventSeenKey = key;
  if (!last || last.icon === 'waves') return;
  if (last.icon === 'wreck') {
    playWreckSpawnSound('sea');
    showEventTitleCard({ kicker: `Round ${last.round}`, title: last.title, subtitle: 'Everyone rolled a d20 for salvage. See the log for who got what.', tone: 'ok', icon: 'wreck', durationMs: 3000 });
  } else if (last.icon === 'pirate') {
    showEventTitleCard({ kicker: `Round ${last.round}`, title: last.title, subtitle: 'Enough played knights takes loot, too few loses 2 cards. See the log.', tone: 'danger', icon: 'pirate', durationMs: 3200 });
  } else {
    showEventTitleCard({ kicker: `Round ${last.round}`, title: last.title, tone: 'accent', icon: last.icon || 'cards', durationMs: 2600 });
  }
}

/** Called from `renderAll` on every state. */
export function renderEventTimeline(): void {
  renderStrip();
  syncTitleCard();
}
