import { afterEach, describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import { PLACE_NET } from '../src/packs/tidebound';
import { broadcastRoom, setIo } from '../src/server/net';
import { clearBotTimers, createRoom, rooms } from '../src/server/rooms';
import { defaultSettings, mapRegistryFor, visualToggles } from '../src/server/runtime';
import { buildTopology, createGame, manifestProblems, registryFor } from '../src/shared';
import type { PieceVisual } from '../src/shared';

// R8.4: the `visuals` event. `broadcastRoom` sends each socket the manifest before its `gameState`, keyed by the addon set, in the lobby and in a game.
// The shipped packs register no visual yet, so the real manifest is empty; one test puts a visual on the real `place_net` action (and puts it back) to see content travel.
// A fake io records every send in order: `sock.emit` (what `syncVisuals` uses) and `io.to(id).emit` (what `gameState` uses).

const TIDE = { dlc: { tidebound: true }, techTreeOn: true };

type Sent = { to: string; event: string; data: any };

function fakeIo(ids: string[]) {
  const log: Sent[] = [];
  const socks = new Map<string, any>();
  const make = (id: string) => ({ data: {}, emit: (event: string, data: any) => { log.push({ to: id, event, data }); } });
  for (const id of ids) socks.set(id, make(id));
  const io: any = {
    sockets: { sockets: socks },
    to: (id: string) => ({ emit: (event: string, data: any) => { log.push({ to: id, event, data }); } })
  };
  return { io, log, reconnect: (id: string) => { socks.set(id, make(id)); } };
}

const visualsTo = (log: Sent[], id: string) => log.filter(l => l.to === id && l.event === 'visuals');
const statesTo = (log: Sent[], id: string) => log.filter(l => l.to === id && l.event === 'gameState');

const made: any[] = [];
afterEach(() => {
  setIo(undefined as any);
  for (const room of made.splice(0)) {
    clearBotTimers(room);
    delete rooms[room.code];
  }
});

function islandInits(landRadius: number, outerRadius: number): { q: number; r: number; type: string; number: number | null }[] {
  const out: { q: number; r: number; type: string; number: number | null }[] = [];
  for (let q = -outerRadius; q <= outerRadius; q++) {
    for (let r = -outerRadius; r <= outerRadius; r++) {
      if (Math.abs(q + r) > outerRadius) continue;
      const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
      const land = dist <= landRadius;
      out.push({ q, r, type: land ? 'wood' : 'water', number: land ? 6 : null });
    }
  }
  return out;
}

/** Alice ('a') and Bob ('b') in a game with `rules`, plus a spectator 's'. Same seed every time. */
function gameRoom(rules: Record<string, any>): any {
  const reg = registryFor(allPacks, rules);
  const board = buildTopology(islandInits(2, 6), {
    isLand: t => !!reg.tiles.get(t)?.land,
    portBlocked: t => !!reg.tiles.get(t)?.noPort,
    waterEdges: true
  });
  const g: any = createGame(reg, {
    players: [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }],
    rules,
    board,
    seed: 4711,
    shuffleSeats: false
  });
  g.phase = 'main';
  g.turn = 1;
  g.turnCount = 6;
  const room: any = createRoom('host-visuals', 'Host');
  room.settings = { ...defaultSettings(), mapSeed: 'VIS001', ...rules };
  room.game = g;
  room.spectators = [{ id: 's', name: 'Sam', avatar: 'x', color: '#000' }];
  made.push(room);
  return room;
}

describe('visuals event (R8.4)', () => {
  it('sends the manifest to every player and spectator, before their gameState, as plain JSON that passes the checks', () => {
    const room = gameRoom(TIDE);
    const { io, log } = fakeIo(['a', 'b', 's']);
    setIo(io);
    broadcastRoom(room);
    for (const id of ['a', 'b', 's']) {
      const v = visualsTo(log, id);
      expect(v).toHaveLength(1);
      expect(log.findIndex(l => l === v[0])).toBeLessThan(log.findIndex(l => l === statesTo(log, id)[0]));
      expect(v[0].data.key).toContain('tidebound.');
      expect(JSON.parse(JSON.stringify(v[0].data))).toEqual(v[0].data);
      expect(manifestProblems(v[0].data.manifest)).toEqual([]);
    }
    // R8.8 step 1: Tides registers `flood` and `flood-warn` in `OVERLAY_KINDS`; no piece has a visual yet.
    expect(visualsTo(log, 'a')[0].data.manifest.pieces).toEqual([]);
    expect(visualsTo(log, 'a')[0].data.manifest.overlays.map((o: any) => o.id)).toEqual(['flood', 'flood-warn']);
  });

  it('sends it once per key: a second broadcast sends gameState only', () => {
    const room = gameRoom(TIDE);
    const { io, log } = fakeIo(['a', 'b']);
    setIo(io);
    broadcastRoom(room);
    broadcastRoom(room);
    expect(visualsTo(log, 'a')).toHaveLength(1);
    expect(statesTo(log, 'a')).toHaveLength(2);
  });

  it('a game with Tidebound off sends an empty manifest with the empty key (once)', () => {
    const room = gameRoom({});
    const { io, log } = fakeIo(['a', 'b']);
    setIo(io);
    broadcastRoom(room);
    broadcastRoom(room);
    const v = visualsTo(log, 'a');
    expect(v).toHaveLength(1);
    expect(v[0].data).toEqual({ key: '', manifest: { version: 1, pieces: [], overlays: [] } });
  });

  it('a reconnect is a new socket, so it gets the manifest again', () => {
    const room = gameRoom(TIDE);
    const { io, log, reconnect } = fakeIo(['a', 'b']);
    setIo(io);
    broadcastRoom(room);
    reconnect('b');
    broadcastRoom(room);
    expect(visualsTo(log, 'b')).toHaveLength(2);
    expect(visualsTo(log, 'a')).toHaveLength(1);
  });

  it('a spectator who joins later gets it on the next broadcast', () => {
    const room = gameRoom(TIDE);
    room.spectators = [];
    const { io, log } = fakeIo(['a', 'b', 's']);
    setIo(io);
    broadcastRoom(room);
    expect(visualsTo(log, 's')).toHaveLength(0);
    room.spectators = [{ id: 's', name: 'Sam', avatar: 'x', color: '#000' }];
    broadcastRoom(room);
    expect(visualsTo(log, 's')).toHaveLength(1);
  });

  it('in the lobby a toggle that changes the addon set sends the new manifest and key', () => {
    const room: any = createRoom('lobby-host', 'Host');
    made.push(room);
    room.settings = { ...room.settings, dlc: { tidebound: true } };
    const { io, log } = fakeIo(['lobby-host']);
    setIo(io);
    broadcastRoom(room);
    room.settings = { ...room.settings, dlc: { tidebound: false } };
    broadcastRoom(room);
    const v = visualsTo(log, 'lobby-host');
    expect(v).toHaveLength(2);
    expect(v[0].data.key).toContain('tidebound.');
    expect(v[1].data.key).toBe('');
    expect(v[1].data.manifest).toEqual({ version: 1, pieces: [], overlays: [] });
  });

  it('starting a game from a lobby with the same addon set does not resend', () => {
    // The lobby host is 'a', who is also a player of the game that starts, so 'a' sees both broadcasts and 'b' only the second.
    const lobby: any = createRoom('a', 'Alice');
    made.push(lobby);
    lobby.settings = { ...lobby.settings, ...TIDE };
    const { io, log } = fakeIo(['a', 'b']);
    setIo(io);
    broadcastRoom(lobby);
    const withGame = gameRoom(TIDE);
    // Same settings and a game made from them: the game's rules give the same key as the lobby's settings.
    lobby.game = withGame.game;
    broadcastRoom(lobby);
    expect(visualsTo(log, 'a')).toHaveLength(1);
    expect(visualsTo(log, 'b')).toHaveLength(1);
    expect(visualsTo(log, 'b')[0].data.key).toBe(visualsTo(log, 'a')[0].data.key);
  });

  it('carries real content when a def has a visual (the real place_net action, put back afterwards)', () => {
    const room = gameRoom(TIDE);
    const reg = mapRegistryFor(visualToggles(room));
    // A net is an action on a sea tile now, so it travels as an `action` entry (slot 'hex', spotKey 'hexId') and has no shape.
    const net = reg.actions.get(PLACE_NET);
    expect(net).toBeDefined();
    const visual: PieceVisual = {
      slot: 'hex',
      spotKey: 'hexId',
      button: { label: 'Net', icon: 'net', order: 20 },
      hints: { noSupply: 'No nets left.', cannotAfford: 'Cannot pay.', noSpots: 'No spot.' }
    };
    reg.actions.set(PLACE_NET, { ...net!, visual });
    try {
      const { io, log } = fakeIo(['a', 'b']);
      setIo(io);
      broadcastRoom(room);
      const m = visualsTo(log, 'a')[0].data.manifest;
      expect(m.pieces).toHaveLength(1);
      expect(m.pieces[0]).toMatchObject({ id: PLACE_NET, kind: 'action', slot: 'hex', spotKey: 'hexId', button: { label: 'Net' } });
      expect(JSON.parse(JSON.stringify(m))).toEqual(m);
      expect(manifestProblems(m)).toEqual([]);
      // Everyone in the game gets the same manifest.
      expect(visualsTo(log, 'b')[0].data).toEqual(visualsTo(log, 'a')[0].data);
    } finally {
      reg.actions.set(PLACE_NET, net!);
    }
  });
});
