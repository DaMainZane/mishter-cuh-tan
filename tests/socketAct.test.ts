// MODULE: tests for the generic `act` socket event (server/socket.ts): the engine runs it, junk input is refused cleanly, and each moved event answers like `act` (R6) | USED BY: npm test
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allPacks } from '../src/packs';
import { runAction } from '../src/server/game';
import { clearBotTimers, createRoom, rooms } from '../src/server/rooms';
import { defaultSettings } from '../src/server/runtime';
import { registerSocketHandlers } from '../src/server/socket';
import { buildTopology, createGame, registryFor } from '../src/shared';

// R6.3: `registerSocketHandlers(io)` only needs `io.on('connection', cb)`. The test hands it a fake io, calls `cb` with a fake socket that records
// the handlers it is given (`on`) and what it is sent (`emit`), and then calls the handlers like the client would. `broadcastRoom` works without a
// real io (it builds the state and sends nothing), so no network is involved.
//
// Fixture: Alice ('a') and Bob ('b') on a small island, Tidebound on, Bob's main phase. The fake socket is Bob (`socket.id` is the player id).

const RULES = { dlc: { tidebound: true }, techTreeOn: true };

/** The nine tech and Tidebound events that R6.4 moves to `act`: legacy event, action type, a refusable payload with the engine's own key names. */
type Legacy = [event: string, type: string, payload: Record<string, unknown>];
const LEGACY: Legacy[] = [
  ['researchTech', 'research_tech', { techId: 'nope' }],
  ['upgradePort', 'upgrade_port', { vertexId: 0 }],
  ['upgradeHarbor', 'upgrade_harbor', { vertexId: 0 }],
  ['upgradeBridge', 'upgrade_bridge', { edgeId: 0 }],
  ['demolishBridge', 'demolish_bridge', { edgeId: 0 }],
  ['convertTile', 'convert_tile', { hexId: 0, resource: 'wood' }],
  ['spendFish', 'spend_fish', { resource: 'wood' }],
  ['feedSea', 'feed_sea', { hexId: 0 }]
];

/** Every payload a hostile or broken client could send for an action that expects named fields. */
const JUNK: any[] = [
  undefined,
  null,
  [],
  'text',
  7,
  true,
  {},
  { vertexId: 'x', edgeId: 'x', hexId: 'x', resource: {}, techId: {} },
  { vertexId: -1, edgeId: 1e9, hexId: 1.5, resource: 'unobtainium', techId: 'nope' },
  { vertexId: [1], edgeId: [1], hexId: [1], resource: ['wood'], techId: ['x'] },
  { vertexId: null, edgeId: null, hexId: null, resource: null, techId: null }
];

const made: any[] = [];
afterEach(() => {
  for (const room of made.splice(0)) {
    clearBotTimers(room);
    delete rooms[room.code];
  }
  vi.restoreAllMocks();
});

/** A disc of radius `outerRadius`: land (wood) within `landRadius` of the centre, sea outside. */
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

/** A room that holds a fresh two-player game in Bob's main phase. Same seed every time, so two rooms hold the same game. */
function makeRoom(): any {
  const reg = registryFor(allPacks, RULES);
  const board = buildTopology(islandInits(2, 6), {
    isLand: t => !!reg.tiles.get(t)?.land,
    portBlocked: t => !!reg.tiles.get(t)?.noPort,
    waterEdges: true
  });
  const g: any = createGame(reg, {
    players: [
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' }
    ],
    rules: RULES,
    board,
    seed: 4711,
    shuffleSeats: false
  });
  g.phase = 'main';
  g.turn = 1;
  g.turnCount = 6;
  g.round = 5;
  const room: any = createRoom('host-socketact', 'Host');
  room.settings = { ...defaultSettings(), mapSeed: 'ACT001', ...RULES };
  room.game = g;
  made.push(room);
  return room;
}

/** The fake socket: records its handlers and what it is sent. `send(event, data)` calls a handler like the client would. */
function connect(id = 'b') {
  const handlers = new Map<string, (data: any) => void>();
  const sent: { event: string; args: any[] }[] = [];
  let onConnection: ((s: any) => void) | undefined;
  registerSocketHandlers({
    on: (event: string, cb: (s: any) => void) => {
      if (event === 'connection') onConnection = cb;
    }
  } as any);
  const socket: any = {
    id,
    data: {},
    on: (event: string, fn: (data: any) => void) => {
      handlers.set(event, fn);
    },
    emit: (event: string, ...args: any[]) => {
      sent.push({ event, args });
    },
    join: () => undefined
  };
  onConnection!(socket);
  return {
    handlers,
    errors: () => sent.filter(s => s.event === 'errorMsg').map(s => String(s.args[0])),
    send: (event: string, data?: any) => handlers.get(event)!(data)
  };
}

/** The parts of a game that a turn change moves. */
const turnOf = (g: any) => ({ turn: g.turn, phase: g.phase, turnCount: g.turnCount, round: g.round, log: g.log.length });

describe('the act event', () => {
  it('runs one engine action for the socket player, like runAction', () => {
    const viaSocket = makeRoom();
    const direct = makeRoom();
    const c = connect('b');
    c.send('act', { code: viaSocket.code, type: 'end_turn', payload: {} });
    const res = runAction(direct, 'b', 'end_turn', {});
    expect(res.ok).toBe(true);
    expect(c.errors()).toEqual([]);
    expect(turnOf(viaSocket.game)).toEqual(turnOf(direct.game));
    expect(viaSocket.game.turn).not.toBe(1);
  });

  it('sends the engine reason back when the action is refused, and changes nothing', () => {
    const room = makeRoom();
    const c = connect('b');
    const before = JSON.stringify(room.game);
    const reason = runAction(room, 'b', 'upgrade_harbor', { vertexId: 0 });
    expect(reason.ok).toBe(false);
    c.send('act', { code: room.code, type: 'upgrade_harbor', payload: { vertexId: 0 } });
    expect(c.errors()).toEqual([(reason as any).error]);
    expect(JSON.stringify(room.game)).toBe(before);
  });

  it('refuses a type nobody registered, including names that exist on every object', () => {
    const room = makeRoom();
    const c = connect('b');
    for (const type of ['no_such_action', '__proto__', 'constructor', 'toString', '']) {
      const before = c.errors().length;
      c.send('act', { code: room.code, type, payload: {} });
      const errs = c.errors().slice(before);
      expect(errs, `type ${JSON.stringify(type)}`).toHaveLength(1);
      expect(errs[0]).not.toMatch(/^Internal error/);
    }
  });

  it('ignores a malformed envelope: no toast, no crash, no change', () => {
    const room = makeRoom();
    const c = connect('b');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const before = JSON.stringify(room.game);
    const envelopes: any[] = [
      undefined,
      null,
      'act',
      7,
      [],
      {},
      { code: room.code },
      { type: 'end_turn' },
      { code: 7, type: 'end_turn' },
      { code: room.code, type: 5 },
      { code: 'NOPE0', type: 'end_turn', payload: {} }
    ];
    for (const data of envelopes) c.send('act', data);
    expect(c.errors()).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(room.game)).toBe(before);
  });

  it('treats a payload that is not a plain object as {} and never answers "Internal error", for each of the nine moved actions', () => {
    const room = makeRoom();
    const c = connect('b');
    const before = JSON.stringify(room.game);
    for (const [, type] of LEGACY) {
      for (const payload of JUNK) {
        const seen = c.errors().length;
        c.send('act', { code: room.code, type, payload });
        const errs = c.errors().slice(seen);
        const label = `${type} with ${JSON.stringify(payload) ?? 'undefined'}`;
        expect(errs, label).toHaveLength(1);
        expect(errs[0], label).not.toMatch(/^Internal error/);
      }
    }
    expect(JSON.stringify(room.game)).toBe(before);
  });
});

// R6.4 done: the nine events have no server handler any more, only `act` runs them.
describe('the nine moved events', () => {
  for (const [event] of LEGACY) {
    it(`${event} has no handler`, () => {
      expect(connect('b').handlers.has(event)).toBe(false);
    });
  }
});

/** Values a hostile or broken client could send as `loc` (the build action must refuse every one). */
const JUNK_LOC: any[] = [undefined, null, 'x', '1', 1.5, -1, 1e9, NaN, [1], {}, true];

/** The first edge a land tile touches (the base client's `clickEdge` builds a road there). */
function landEdgeId(g: any): number {
  return g.board.edges.findIndex((e: any) => e.hexIds.length > 0);
}

// R6.5: one `place` event for every piece, so a new piece needs no handler in socket.ts.
describe('the place event', () => {
  it('has a handler, and clickVertex and clickEdge no longer take a piece', () => {
    const c = connect('b');
    expect(c.handlers.has('place')).toBe(true);
    expect(c.handlers.has('clickVertex')).toBe(true);
    expect(c.handlers.has('clickEdge')).toBe(true);
  });

  it('answers like clickEdge for the base road, and changes nothing when both are refused', () => {
    const viaPlace = makeRoom();
    const viaClick = makeRoom();
    const edgeId = landEdgeId(viaPlace.game);
    expect(edgeId).toBeGreaterThanOrEqual(0);
    const a = connect('b');
    const b = connect('b');
    const before = JSON.stringify(viaPlace.game);
    a.send('place', { code: viaPlace.code, piece: 'road', loc: edgeId });
    b.send('clickEdge', { code: viaClick.code, edgeId });
    expect(a.errors()).toHaveLength(1);
    expect(a.errors()).toEqual(b.errors());
    expect(JSON.stringify(viaPlace.game)).toBe(before);
    expect(JSON.stringify(viaClick.game)).toBe(before);
  });

  it('ignores a piece sent to clickVertex and clickEdge (they only do the base clicks now)', () => {
    const withPiece = makeRoom();
    const without = makeRoom();
    const edgeId = landEdgeId(withPiece.game);
    const a = connect('b');
    const b = connect('b');
    a.send('clickVertex', { code: withPiece.code, vertexId: 0, piece: 'net' });
    b.send('clickVertex', { code: without.code, vertexId: 0 });
    a.send('clickEdge', { code: withPiece.code, edgeId, piece: 'rickety_bridge' });
    b.send('clickEdge', { code: without.code, edgeId });
    expect(a.errors()).toEqual(b.errors());
    expect(JSON.stringify(withPiece.game)).toBe(JSON.stringify(without.game));
  });

  it('refuses an unknown piece, including names that exist on every object', () => {
    const room = makeRoom();
    const c = connect('b');
    const before = JSON.stringify(room.game);
    for (const piece of ['no_such_piece', '__proto__', 'constructor', 'toString', '']) {
      const seen = c.errors().length;
      c.send('place', { code: room.code, piece, loc: 0 });
      const errs = c.errors().slice(seen);
      expect(errs, `piece ${JSON.stringify(piece)}`).toHaveLength(1);
      expect(errs[0]).not.toMatch(/^Internal error/);
    }
    expect(JSON.stringify(room.game)).toBe(before);
  });

  it('refuses a bad loc for every piece, never answers "Internal error", and changes nothing', () => {
    const room = makeRoom();
    const c = connect('b');
    const before = JSON.stringify(room.game);
    for (const piece of ['road', 'settlement', 'city', 'bridge', 'rickety_bridge', 'net']) {
      for (const loc of JUNK_LOC) {
        const seen = c.errors().length;
        c.send('place', { code: room.code, piece, loc });
        const errs = c.errors().slice(seen);
        const label = `${piece} at ${JSON.stringify(loc) ?? 'undefined'}`;
        expect(errs, label).toHaveLength(1);
        expect(errs[0], label).not.toMatch(/^Internal error/);
      }
    }
    expect(JSON.stringify(room.game)).toBe(before);
  });

  it('ignores a malformed envelope: no toast, no crash, no change', () => {
    const room = makeRoom();
    const c = connect('b');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const before = JSON.stringify(room.game);
    const envelopes: any[] = [
      undefined,
      null,
      'place',
      7,
      [],
      {},
      { code: room.code },
      { piece: 'road', loc: 0 },
      { code: 7, piece: 'road', loc: 0 },
      { code: room.code, piece: 5, loc: 0 },
      { code: room.code, piece: ['road'], loc: 0 },
      { code: 'NOPE0', piece: 'road', loc: 0 }
    ];
    for (const data of envelopes) c.send('place', data);
    expect(c.errors()).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(room.game)).toBe(before);
  });
});
