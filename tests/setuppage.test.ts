import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ruleFoldValues } from '../src/client/render/setup';
import { createRoom, humanIds, rooms } from '../src/server/rooms';
import { makeStateBuilder } from '../src/server/view';
import { startGame } from '../src/server/game';

describe('world setup page flag and spectator mode', () => {
  it('a new room starts on the setup page and the host can leave it', () => {
    const room = createRoom('host-socket', 'Host');
    try {
      expect(room.setup).toBe(true);
      expect(makeStateBuilder(room)('host-socket').setup).toBe(true);
      room.setup = false;
      expect(makeStateBuilder(room)('host-socket').setup).toBe(false);
    } finally {
      delete rooms[room.code];
    }
  });

  it('supports host spectating a bot-only game with full hand visibility', () => {
    const room = createRoom('host-socket', 'Host');
    try {
      // Host switches from lobbyPlayers to spectators while keeping hostId
      const hostSeat = room.lobbyPlayers.pop()!;
      room.spectators.push({ id: hostSeat.id, name: hostSeat.name, avatar: hostSeat.avatar, color: hostSeat.color });
      room.lobbyPlayers.push(
        { id: 'bot_1', name: 'Bot Alpha', color: '#e03131', avatar: '🤖', isBot: true, difficulty: 'Main' },
        { id: 'bot_2', name: 'Bot Beta', color: '#1971c2', avatar: '🤖', isBot: true, difficulty: 'Main' },
      );

      // humanIds includes spectators so broadcastRoom and bot turns keep running
      expect(humanIds(room)).toContain('host-socket');

      startGame(room);
      expect(room.game).not.toBeNull();
      expect(room.setup).toBe(false);

      // Give Bot Alpha a resource card and verify spectator sees it while seated non-self would not
      room.game!.players[0].resources.wood = 3;
      const buildFor = makeStateBuilder(room);
      const specView = buildFor('host-socket') as any;
      expect(specView.isSpectator).toBe(true);
      expect(specView.spectators).toHaveLength(1);
      expect(specView.players[0].resources.wood).toBe(3);
    } finally {
      delete rooms[room.code];
    }
  });
});


describe('setup page layout (Players / World / Rules tabs)', () => {
  const html = readFileSync(join(__dirname, '../public/index.html'), 'utf8');
  const start = html.indexOf('<div id="setupScreen"');
  const page = html.slice(start, html.indexOf('<div id="hostWaiting"', start));

  it('has three tabs, each controlling its own panel', () => {
    for (const t of ['players', 'world', 'rules']) {
      expect(page).toContain(`id="setupTab-${t}"`);
      expect(page).toContain(`aria-controls="setupPanel-${t}"`);
      expect(page).toContain(`id="setupPanel-${t}"`);
    }
  });

  it('keeps every control the settings push reads, once each', () => {
    const actions = readFileSync(join(__dirname, '../src/client/actions.ts'), 'utf8');
    const body = actions.slice(actions.indexOf('export function pushSettings'));
    const ids = [...body.slice(0, body.indexOf('\n}')).matchAll(/(?:val|chk)\('([A-Za-z]+)'\)/g)].map(m => m[1]);
    expect(ids.length).toBeGreaterThan(20);
    for (const id of ids) expect(html.split(`id="${id}"`).length - 1, id).toBe(1);
  });

  it('offers "Save map as preset" in one place only', () => {
    const mapmenu = readFileSync(join(__dirname, '../src/client/mapmenu.ts'), 'utf8');
    expect(mapmenu).not.toContain('startSavePreset()');
  });
});

describe('rule fold titles show the current values', () => {
  it('summarises defaults', () => {
    expect(ruleFoldValues({})).toEqual({
      foldValGame: '10 VP · radius 2 · discard above 7',
      foldValTimers: 'No turn timer · trades 20 s',
      foldValEvents: 'Events off · tech tree off',
      foldValTiles: '1 desert · 0 gold · 0 fog',
      foldValBank: '19 per resource · 25 dev cards',
      foldValPieces: '15 roads · 5 settlements · 4 cities'
    });
  });

  it('follows the settings, including string numbers from the inputs', () => {
    const v = ruleFoldValues({
      vpToWin: '12', boardRadius: 5, fairDice: true, turnTimerSec: 90, turnIncrementSec: 5, tradeTimerSec: 30,
      eventsOn: true, fateTokens: 1, techTreeOn: true, maxCities: 1
    });
    expect(v.foldValGame).toBe('12 VP · radius 5 · discard above 7 · fair dice');
    expect(v.foldValTimers).toBe('90 s turns +5 s · trades 30 s');
    expect(v.foldValEvents).toBe('Events on, 1 fate token · tech tree on');
    expect(v.foldValPieces).toBe('15 roads · 5 settlements · 1 city');
  });
});
