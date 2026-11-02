// MODULE: tests for the client state builder (server/view.ts): a snapshot of what each viewer gets, the safety net for moving view data into VIEW_DATA (R7a) | USED BY: npm test
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { allPacks } from '../src/packs';
import { CITY, GENERIC_PORT } from '../src/packs/base/constants';
import {
  BRIDGE,
  TECH_FISHING_NETS,
  TECH_GRAND_CAUSEWAY,
  TECH_HARBOR_MASTER,
  TECH_RICKETY_BRIDGES,
  TECH_SALVAGE_CREW,
  applyTides,
  ensureTides,
  isWreckSeaHex,
  seaHexIdsAt,
  spawnPirate,
  spawnWreckAt
} from '../src/packs/tidebound';
import { clearBotTimers, createRoom, rooms } from '../src/server/rooms';
import { defaultSettings } from '../src/server/runtime';
import { makeStateBuilder } from '../src/server/view';
import { buildTopology, createGame, hexDistance, makeCtx, registryFor } from '../src/shared';

// R7a.2: `makeStateBuilder(room)(viewerId)` for the player whose turn it is, another player and a spectator, with Tidebound fully on and with it off.
// The result is compared with `tests/view.snapshot.json` (a different file from the golden one). The file is written the first time the test runs
// (vitest does that for a missing file snapshot), so make it with the OLD `view.ts`, check it by eye, and from then on every change to `view.ts`
// has to give the same file. Update it on purpose only, with `npx vitest run tests/viewState.test.ts -u`, as a reviewed diff (R8.6 does that once).
//
// Traps handled here: `makeStateBuilder` reads `Date.now()` (trade timers, turn clock), so the clock is pinned; the room code and the lobby seed are random,
// so they are set by hand; the board is replaced by a short summary, because the plain board shape does not change in R7a and would make the file huge.

const TIDE_RULES = { dlc: { tidebound: true }, techTreeOn: true };

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
});
afterAll(() => {
  vi.useRealTimers();
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

/** Two players, Alice ('a') and Bob ('b'). It is Bob's main phase in round 5, and Bob is the last seat (so the tide warning shows). */
function makeGame(rules: Record<string, any>, seed = 4711) {
  const reg = registryFor(allPacks, rules);
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
    rules,
    board,
    seed,
    shuffleSeats: false
  });
  g.phase = 'main';
  g.turn = 1;
  g.turnCount = 6;
  g.round = 5;
  return { g, reg, ctx: makeCtx(g, reg) };
}

function giveTech(g: any, pid: string, techId: string): void {
  g.ext = g.ext || {};
  g.ext.core = g.ext.core || {};
  g.ext.core.techs = g.ext.core.techs || {};
  g.ext.core.techs[pid] = [...new Set([...(g.ext.core.techs[pid] || []), techId])];
}

/** Tidebound with every field filled in for Bob: a net on a sea tile, a fishing ground, a harbor, a wreck, a pirate, a flood, a warning, a bridge on Longest Road. */
function tideboundScene() {
  const { g, reg, ctx } = makeGame(TIDE_RULES);
  const bob = g.players[1];
  for (const t of [TECH_RICKETY_BRIDGES, TECH_FISHING_NETS, TECH_SALVAGE_CREW, TECH_HARBOR_MASTER, TECH_GRAND_CAUSEWAY]) giveTech(g, 'b', t);
  bob.resources = { wood: 5, brick: 5, sheep: 5, wheat: 5, ore: 5 };

  // Three coast vertices: a road (so nets have a spot), a net, a harbor city on a port.
  const coast: number[] = g.board.vertices
    .filter((v: any) => v.hexIds.length > 0 && seaHexIdsAt(g, reg, v.id).length > 0)
    .map((v: any) => v.id);
  expect(coast.length).toBeGreaterThan(3);
  const roadV = coast[0];
  const netV = coast[Math.floor(coast.length / 2)];
  const harborV = coast[coast.length - 1];

  const roadEdge = g.board.vertices[roadV].edgeIds.find((e: number) => g.board.edges[e].hexIds.length > 0)!;
  g.board.edges[roadEdge].piece = { type: 'road', owner: 'b' };

  // The net sits on one sea tile (`hex.ext.net`) and fishes only that tile.
  const ground = seaHexIdsAt(g, reg, netV)[0];
  g.board.hexes[ground].ext.net = { owner: 'b' };
  g.board.hexes[ground].ext.fish = 2;

  g.board.vertices[harborV].port = GENERIC_PORT;
  g.board.vertices[harborV].piece = { type: CITY, owner: 'b' };
  g.ext = g.ext || {};
  g.ext.core = g.ext.core || {};
  g.ext.core.portUpgrades = { ...(g.ext.core.portUpgrades || {}), [harborV]: { level: 2, by: 'b' } };

  // A bridge on an ocean edge, and Longest Road for Bob: Grand causeway adds its bonus to the breakdown.
  const oceanEdge = g.board.edges.find(
    (e: any) => e.hexIds.length === 0 && (g.board.vertices[e.v1].hexIds.length > 0 || g.board.vertices[e.v2].hexIds.length > 0)
  )!;
  oceanEdge.piece = { type: BRIDGE, owner: 'b' };
  g.awards.longestRoad = 'b';

  // Round 5: one half of the coast is flooded, the other half is dry and about to flood (the warning shows during the last seat's turn).
  ensureTides(g, reg);
  applyTides(ctx);

  // A wreck and a pirate far from every piece, so nobody claims the wreck and nothing is guarded.
  const centre = g.board.hexes.find((h: any) => h.q === 0 && h.r === 0)!;
  const far: number[] = g.board.hexes.filter((h: any) => isWreckSeaHex(reg, h) && hexDistance(h, centre) >= 5).map((h: any) => h.id);
  expect(far.length).toBeGreaterThan(2);
  expect(spawnWreckAt(ctx, far[0], { site: 'sea', resource: 'wood', baseCards: 3, bonus: null })).not.toBeNull();
  expect(spawnPirate(ctx, { hexId: far[far.length - 1] })).not.toBeNull();

  return { g, reg };
}

/** A lobby room that holds `g`, with the random parts pinned. `cleanup` removes it from the room list. */
function roomFor(g: any, settings: Record<string, any>) {
  const room = createRoom('host-viewstate', 'Host');
  const created = room.code;
  room.code = 'VIEW1';
  room.settings = { ...defaultSettings(), mapSeed: 'VIEW001', ...settings };
  room.game = g;
  return {
    room,
    cleanup: () => {
      clearBotTimers(room);
      delete rooms[created];
    }
  };
}

/** What Bob (the player on turn), Alice and someone without a seat each get. */
function viewsOf(room: any): { active: any; other: any; spectator: any } {
  const build = makeStateBuilder(room);
  return { active: build('b'), other: build('a'), spectator: build('watcher') };
}

/** The board as a short summary: sizes and what stands on it (the plain board shape is not part of this change). */
function slim(view: any): any {
  const { elapsedMs: _elapsedMs, ...rest } = view;
  const b = view.board;
  return {
    ...rest,
    board: {
      hexes: b.hexes.length,
      vertices: b.vertices.length,
      edges: b.edges.length,
      buildings: b.vertices.filter((v: any) => v.building).map((v: any) => ({ id: v.id, port: v.port, ...v.building })),
      edgePieces: b.edges.filter((e: any) => e.road !== null).map((e: any) => ({ id: e.id, owner: e.road, type: e.pieceType })),
      robberHexId: b.robberHexId
    }
  };
}

/** Sorted keys and no undefined values: what JSON would send, in an order that does not depend on how the state was assembled. */
function canon(v: any): any {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) {
      const x = canon(v[k]);
      if (x !== undefined) out[k] = x;
    }
    return out;
  }
  return v;
}

const playerOf = (view: any, id: string): any => view.players.find((p: any) => p.id === id);

// ---- R7a.6: cases the snapshot does not cover (inline expects, the snapshot file stays as it is) ----

const ALL_TECHS = [TECH_RICKETY_BRIDGES, TECH_FISHING_NETS, TECH_SALVAGE_CREW, TECH_HARBOR_MASTER, TECH_GRAND_CAUSEWAY];

/** Bob's turn in a plain game (no net, wreck, pirate or flood placed): enough for the tech gates and for the addon on/off checks. */
function lightScene(rules: Record<string, any>, techs: string[]) {
  const { g, reg } = makeGame(rules);
  for (const t of techs) giveTech(g, 'b', t);
  g.players[1].resources = { wood: 5, brick: 5, sheep: 5, wheat: 5, ore: 5 };
  return { g, reg };
}

/** The three viewers' states for `g`, with the room removed again. */
function viewsFor(g: any): { active: any; other: any; spectator: any } {
  const { room, cleanup } = roomFor(g, {});
  try {
    return viewsOf(room);
  } finally {
    cleanup();
  }
}

const TIDEBOUND_PUBLIC_FIELDS = ['fishIcons', 'portLevels', 'wrecks', 'pirates', 'tide', 'hexOverlays'];

describe('R7a.6: portLevels with Tidebound off', () => {
  it('sends a raised port although the Harbor addon is off (portLevels is registered at pack level)', () => {
    const { g } = makeGame({ techTreeOn: true });
    const v = g.board.vertices[0];
    v.port = GENERIC_PORT;
    v.piece = { type: CITY, owner: 'b' };
    g.ext = g.ext || {};
    g.ext.core = g.ext.core || {};
    g.ext.core.portUpgrades = { [v.id]: { level: 1, by: 'b' } };

    const { active, other, spectator } = viewsFor(g);
    for (const view of [active, other, spectator]) {
      expect(view.portLevels).toEqual({ [v.id]: 1 });
      // Everything else of Tidebound stays off.
      for (const k of TIDEBOUND_PUBLIC_FIELDS.filter(f => f !== 'portLevels')) expect(view[k], k).toBeNull();
    }
  });

  it('sends null when no port is raised', () => {
    const { g } = makeGame({ techTreeOn: true });
    expect(viewsFor(g).active.portLevels).toBeNull();
  });
});

describe('R7a.6: the lobby state', () => {
  it('has null for every Tidebound public field while there is no game', () => {
    const room = createRoom('host-viewstate-lobby', 'Host');
    const created = room.code;
    room.code = 'VIEW2';
    try {
      const view = makeStateBuilder(room)('host-viewstate-lobby');
      expect(view.status).not.toBe('GAMEOVER');
      for (const k of TIDEBOUND_PUBLIC_FIELDS) expect(view[k], k).toBeNull();
    } finally {
      clearBotTimers(room);
      delete rooms[created];
    }
  });
});

describe('R7a.6: tech gates (Tidebound on, tech tree on)', () => {
  it('hides the gated fields and pieces until the tech is owned', () => {
    const locked = playerOf(viewsFor(lightScene(TIDE_RULES, []).g).active, 'b');
    for (const k of ['netsLeft', 'netSpots', 'netCost', 'feedCost', 'feedSpots', 'harborCost', 'harborSpots', 'harborsLeft', 'bridgeUpgradeCost']) {
      expect(locked[k], k).toBeUndefined();
    }
    expect(locked.pieceCosts.rickety_bridge).toBeUndefined();

    // Control: the same game with the techs owned shows them (so the checks above are not vacuous).
    const open = playerOf(viewsFor(lightScene(TIDE_RULES, ALL_TECHS).g).active, 'b');
    for (const k of ['netsLeft', 'netSpots', 'netCost', 'feedCost', 'harborCost', 'harborSpots', 'harborsLeft', 'bridgeUpgradeCost']) {
      expect(open[k], k).toBeDefined();
    }
    expect(open.pieceCosts.rickety_bridge).toBeDefined();
  });
});

// One addon off, the rest of Tidebound on, every tech owned. `control` is a field of another addon that must still be sent.
// Rickety bridges depend on Bridges, so Bridges off takes both away; Tides off may also block addons that depend on it, which is fine here.
const ADDON_OFF_CASES: { addon: string; pub: string[]; player: string[]; pieces: string[]; control: string }[] = [
  { addon: 'tidebound.fishing', pub: ['fishIcons'], player: ['netsLeft', 'netSpots', 'netCost', 'feedCost', 'feedSpots'], pieces: [], control: 'harborsLeft' },
  { addon: 'tidebound.harbor', pub: [], player: ['harborCost', 'harborSpots', 'harborsLeft', 'harborTradesLeft'], pieces: [], control: 'netsLeft' },
  { addon: 'tidebound.wrecks', pub: ['wrecks'], player: [], pieces: [], control: 'netsLeft' },
  { addon: 'tidebound.pirates', pub: ['pirates'], player: ['pirateDrives'], pieces: [], control: 'netsLeft' },
  { addon: 'tidebound.tides', pub: ['tide', 'hexOverlays'], player: [], pieces: [], control: 'netsLeft' },
  { addon: 'tidebound.rickety_bridges', pub: [], player: ['bridgeUpgradeCost'], pieces: ['rickety_bridge'], control: 'netsLeft' },
  { addon: 'tidebound.bridges', pub: [], player: ['bridgeUpgradeCost', 'canDemolishBridge'], pieces: [BRIDGE, 'rickety_bridge'], control: 'netsLeft' }
];

describe('R7a.6: each addon off on its own', () => {
  for (const c of ADDON_OFF_CASES) {
    it(`${c.addon} off: its public fields are null, its player fields and pieces are absent, the rest still works`, () => {
      const { g, reg } = lightScene({ ...TIDE_RULES, addons: { [c.addon]: false } }, ALL_TECHS);
      expect(reg.enabled.has(c.addon)).toBe(false);

      const { active, other, spectator } = viewsFor(g);
      for (const view of [active, other, spectator]) {
        for (const k of c.pub) expect(view[k], k).toBeNull();
      }
      const bob = playerOf(active, 'b');
      for (const k of c.player) expect(bob[k], k).toBeUndefined();
      for (const id of c.pieces) expect(bob.pieceCosts[id], id).toBeUndefined();
      expect(bob[c.control], c.control).toBeDefined();
    });
  }
});

describe('what the client gets, Tidebound on with every addon and the tech tree', () => {
  it('fills every Tidebound field (so the snapshot has something to protect)', () => {
    const { g } = tideboundScene();
    const { room, cleanup } = roomFor(g, TIDE_RULES);
    try {
      const { active, other } = viewsOf(room);

      // Public fields.
      expect(active.fishIcons).not.toBeNull();
      expect(active.portLevels).not.toBeNull();
      expect(active.wrecks).not.toBeNull();
      expect(active.pirates).not.toBeNull();
      expect(active.hexOverlays).not.toBeNull();
      expect(active.tide).not.toBeNull();
      const kinds = Object.values(active.hexOverlays as Record<number, { kind: string }>).map(o => o.kind);
      expect(kinds).toContain('flood');
      expect(kinds).toContain('flood-warn');

      // Bob's own fields, on his turn.
      const bob = playerOf(active, 'b');
      expect(bob.netsLeft).toBeDefined();
      expect(bob.netCost).toEqual({ wood: 2, sheep: 1 });
      expect(bob.netSpots.length).toBeGreaterThan(0);
      expect(bob.feedCost).toBeDefined();
      expect(bob.feedSpots.length).toBeGreaterThan(0);
      expect(bob.harborCost).toBeDefined();
      expect(bob.harborSpots).toBeDefined();
      expect(bob.harborsLeft).toBeDefined();
      expect(bob.harborTradesLeft).toBeDefined();
      expect(bob.canDemolishBridge).toBe(true);
      expect(bob.pirateDrives).toBeDefined();
      expect(bob.bridgeUpgradeCost).toBeDefined();
      // A net is a tile action now: its tile is public (`netTiles`), and it is no longer in `pieceCosts` (the net price comes with the build UI rework, bug 5).
      expect(bob.netTiles.length).toBe(1);
      expect(bob.pieceCosts.net).toBeUndefined();
      expect(bob.pieceCosts.rickety_bridge).toBeDefined();
      expect(bob.stats.vpBreakdown.longestRoad).toBe(16);

      // Only the owner gets the spot lists.
      expect(playerOf(other, 'b').netTiles).toEqual(bob.netTiles);
      expect(playerOf(other, 'b').netSpots).toBeUndefined();
      expect(playerOf(other, 'b').netCost).toBeUndefined();
      expect(playerOf(other, 'b').feedSpots).toBeUndefined();
      expect(playerOf(other, 'b').bridgeUpgradeCost).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it('matches the stored views for the player on turn, another player and a spectator, with Tidebound on and with it off', async () => {
    const on = tideboundScene();
    const onRoom = roomFor(on.g, TIDE_RULES);
    const { g: gOff } = makeGame({});
    const offRoom = roomFor(gOff, {});
    try {
      const onViews = viewsOf(onRoom.room);
      const offViews = viewsOf(offRoom.room);

      // Tidebound off: nothing of it is sent.
      for (const view of [offViews.active, offViews.other, offViews.spectator]) {
        expect(view.fishIcons).toBeNull();
        expect(view.portLevels).toBeNull();
        expect(view.wrecks).toBeNull();
        expect(view.pirates).toBeNull();
        expect(view.hexOverlays).toBeNull();
        expect(view.tide).toBeNull();
        for (const p of view.players) {
          expect(p.netSpots).toBeUndefined();
          expect(p.feedSpots).toBeUndefined();
          expect(p.harborSpots).toBeUndefined();
          expect(p.pirateDrives).toBeUndefined();
          expect(p.bridgeUpgradeCost).toBeUndefined();
          expect(p.netTiles).toBeUndefined();
          expect(p.netCost).toBeUndefined();
          expect(p.pieceCosts.rickety_bridge).toBeUndefined();
        }
      }

      const all = {
        tideboundOn: { active: slim(onViews.active), other: slim(onViews.other), spectator: slim(onViews.spectator) },
        tideboundOff: { active: slim(offViews.active), other: slim(offViews.other), spectator: slim(offViews.spectator) }
      };
      await expect(JSON.stringify(canon(all), null, 1)).toMatchFileSnapshot('./view.snapshot.json');
    } finally {
      onRoom.cleanup();
      offRoom.cleanup();
    }
  });
});
