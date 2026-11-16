import { afterEach, describe, expect, it } from 'vitest';
import { TIDEBOUND_MAP_RADIUS, applyTideboundMapDefaults, mergeSettings } from '../src/server/lobby';
import { createRoom, rooms } from '../src/server/rooms';

const made: string[] = [];
afterEach(() => {
  for (const code of made.splice(0)) delete rooms[code];
});

function lobbyRoom() {
  const room = createRoom('host1', 'Host');
  made.push(room.code);
  return room;
}

describe('Turning Tidebound on in the lobby', () => {
  // BUG 1: the DLC toggle left the map alone, so Tidebound started on a plain hexagon with no sea.
  it('moves the map to islands with wide water on a bigger board and turns the tech tree on by default', () => {
    const room = lobbyRoom();
    expect(room.settings.dlc?.tidebound).toBeFalsy();
    expect(room.settings.techTreeOn).toBe(false);
    expect(room.settings.boardRadius).toBeLessThan(TIDEBOUND_MAP_RADIUS);

    room.settings = mergeSettings({ dlc: { tidebound: true } }, room.settings);
    applyTideboundMapDefaults(room);

    expect(room.settings.techTreeOn).toBe(true);
    expect(room.settings.mapPicks).toEqual(expect.arrayContaining(['islands', 'wide_water']));
    expect(room.settings.boardRadius).toBe(TIDEBOUND_MAP_RADIUS);
    expect(room.mapMeta?.recipe.radius).toBe(TIDEBOUND_MAP_RADIUS);
    expect(room.mapMeta?.recipe.picks).toEqual(expect.arrayContaining(['islands', 'wide_water']));
  });

  it('keeps a bigger radius the host already chose', () => {
    const room = lobbyRoom();
    room.settings = mergeSettings({ boardRadius: 9, dlc: { tidebound: true } }, room.settings);
    applyTideboundMapDefaults(room);
    expect(room.settings.boardRadius).toBe(9);
  });
});
