import { describe, expect, it } from 'vitest';
import {
  TIP_HOVER_MS, TIP_LONG_PRESS_MS, bridgeSiteOk, costTipHtml, edgeOptions, popoverPlace, roadSiteOk, settlementSiteOk, tipDelay, vertexOptions
} from '../src/client/buildMenu';
import type { MenuBoard, MenuContext, MenuPlayer } from '../src/client/buildMenu';
import type { ManifestEntry } from '../src/shared';

// BUG 5: the pure half of the build menu. Which pieces a board node offers, at what price and whether you can pay; the tooltip delay; where the popover sits.

// A strip of five corners on land, the last edge over open sea:  0 -e0- 1 -e1- 2 -e2- 3 -e3(ocean)- 4
function strip(): MenuBoard {
  const edges = [
    { v1: 0, v2: 1, hexIds: [0], road: null as string | null },
    { v1: 1, v2: 2, hexIds: [0], road: null as string | null },
    { v1: 2, v2: 3, hexIds: [0], road: null as string | null },
    { v1: 3, v2: 4, hexIds: [] as number[], road: null as string | null }
  ];
  const vertices = [0, 1, 2, 3, 4].map(i => ({
    building: null as { owner: string; type: string } | null,
    hexIds: [0],
    adjacentVertices: [i - 1, i + 1].filter(j => j >= 0 && j <= 4),
    edgeIds: [i - 1, i].filter(j => j >= 0 && j <= 3)
  }));
  return { vertices, edges };
}

const RICH = { wood: 9, brick: 9, sheep: 9, wheat: 9, ore: 9 };
const BROKE = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
const BASE: Record<string, Record<string, number>> = {
  road: { wood: 1, brick: 1 },
  bridge: { wood: 1, brick: 1, ore: 1 },
  rickety_bridge: { wood: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 }
};

function player(over: Partial<MenuPlayer> = {}): MenuPlayer {
  return { id: 'A', resources: RICH, settlementsLeft: 5, citiesLeft: 4, roadsLeft: 15, bridgesLeft: 5, freeRoads: 0, ...over };
}

function ctx(board: MenuBoard, me: MenuPlayer, over: Partial<MenuContext> = {}): MenuContext {
  return { board, me, costOf: p => BASE[p] ?? {}, ricketyOn: false, ...over };
}

/** A at corner 0 with a road on e0 and e1. */
function started(): MenuBoard {
  const b = strip();
  b.vertices[0].building = { owner: 'A', type: 'settlement' };
  b.edges[0].road = 'A';
  b.edges[1].road = 'A';
  return b;
}

const ids = (opts: { id: string }[]): string[] => opts.map(o => o.id);

describe('build menu: where a piece may go (position only, the price is separate)', () => {
  it('a settlement needs a free corner on land, two corners from any building, touching your road', () => {
    const b = started();
    expect(settlementSiteOk(b, 2, 'A')).toBe(true);
    expect(settlementSiteOk(b, 1, 'A')).toBe(false); // next to the settlement on 0
    expect(settlementSiteOk(b, 0, 'A')).toBe(false); // taken
    expect(settlementSiteOk(b, 3, 'A')).toBe(false); // no road of yours touches it
  });

  it('a road goes on a free land edge that joins your road or building, never through a rival building', () => {
    const b = started();
    expect(roadSiteOk(b, 2, 'A')).toBe(true);
    expect(roadSiteOk(b, 1, 'A')).toBe(false); // already built
    expect(roadSiteOk(b, 3, 'A')).toBe(false); // ocean edge
    b.vertices[2].building = { owner: 'B', type: 'settlement' };
    expect(roadSiteOk(b, 2, 'A')).toBe(false);
  });

  it('a bridge goes on a free ocean edge that joins your network', () => {
    const b = started();
    expect(bridgeSiteOk(b, 3, 'A')).toBe(false);
    b.edges[2].road = 'A';
    expect(bridgeSiteOk(b, 3, 'A')).toBe(true);
    expect(bridgeSiteOk(b, 2, 'A')).toBe(false); // land edge
  });
});

describe('build menu: options at a corner', () => {
  it('a legal empty corner offers a settlement with its price; unaffordable stays listed but not payable', () => {
    const b = started();
    const rich = vertexOptions(ctx(b, player()), 2);
    expect(ids(rich)).toEqual(['settlement']);
    expect(rich[0].cost).toEqual(BASE.settlement);
    expect(rich[0].affordable).toBe(true);
    const broke = vertexOptions(ctx(b, player({ resources: BROKE })), 2);
    expect(ids(broke)).toEqual(['settlement']);
    expect(broke[0].affordable).toBe(false);
  });

  it('an illegal corner, or no settlements left, offers nothing', () => {
    const b = started();
    expect(vertexOptions(ctx(b, player()), 1)).toEqual([]);
    expect(vertexOptions(ctx(b, player({ settlementsLeft: 0 })), 2)).toEqual([]);
  });

  it('your settlement offers a city; a rival one or your city offers no city', () => {
    const b = started();
    expect(ids(vertexOptions(ctx(b, player()), 0))).toEqual(['city']);
    expect(vertexOptions(ctx(b, player({ citiesLeft: 0 })), 0)).toEqual([]);
    b.vertices[0].building = { owner: 'B', type: 'settlement' };
    expect(vertexOptions(ctx(b, player()), 0)).toEqual([]);
    b.vertices[0].building = { owner: 'A', type: 'city' };
    expect(vertexOptions(ctx(b, player()), 0)).toEqual([]);
  });

  it('your port city offers the harbor (from the server list) and the 2:1 raise (listed even when you cannot pay)', () => {
    const b = started();
    b.vertices[0].building = { owner: 'A', type: 'city' };
    const c = ctx(b, player({ harborSpots: [0] }), {
      harborCost: { wood: 2, brick: 1, ore: 1 },
      portRaise: [{ vertexId: 0, cost: { wheat: 4 }, affordable: false }]
    });
    const opts = vertexOptions(c, 0);
    expect(ids(opts)).toEqual(['harbor', 'upgrade_port']);
    expect(opts[0].affordable).toBe(true);
    expect(opts[1]).toMatchObject({ cost: { wheat: 4 }, affordable: false });
  });

  it('a manifest piece or action whose server spots list the corner is offered too, by its entry id', () => {
    const lantern: ManifestEntry = {
      id: 'lantern', kind: 'piece', slot: 'vertex',
      button: { label: 'Lantern', icon: 'star' },
      hints: { cannotAfford: 'x', noSpots: 'y' }
    };
    const b = started();
    const me = player({ pieces: { lantern: { left: 2, cost: { ore: 1 }, spots: [3] } } });
    const opts = vertexOptions(ctx(b, me, { entries: [lantern] }), 3);
    expect(opts).toEqual([expect.objectContaining({ id: 'lantern', label: 'Lantern', entryId: 'lantern', cost: { ore: 1 }, affordable: true })]);
    expect(vertexOptions(ctx(b, me, { entries: [lantern] }), 2).map(o => o.id)).toEqual(['settlement']);
  });
});

describe('build menu: options on an edge', () => {
  it('a legal land edge offers a road; a free road costs nothing', () => {
    const b = started();
    const paid = edgeOptions(ctx(b, player({ resources: BROKE })), 2);
    expect(ids(paid)).toEqual(['road']);
    expect(paid[0].affordable).toBe(false);
    const free = edgeOptions(ctx(b, player({ resources: BROKE, freeRoads: 1 })), 2);
    expect(free[0]).toMatchObject({ id: 'road', cost: {}, affordable: true });
    expect(edgeOptions(ctx(b, player({ roadsLeft: 0 })), 2)).toEqual([]);
  });

  it('a legal ocean edge offers a bridge, and the rickety bridge only when it is in the game', () => {
    const b = started();
    b.edges[2].road = 'A';
    expect(ids(edgeOptions(ctx(b, player()), 3))).toEqual(['bridge']);
    expect(ids(edgeOptions(ctx(b, player(), { ricketyOn: true }), 3))).toEqual(['bridge', 'rickety_bridge']);
    expect(edgeOptions(ctx(b, player({ bridgesLeft: 0 }), { ricketyOn: true }), 3)).toEqual([]);
  });
});

describe('build menu: cost tooltip, delay and popover placement', () => {
  it('the tooltip draws the cost cards, dimming what you lack; an empty price reads Free', () => {
    const html = costTipHtml({ wheat: 2, ore: 3 }, { wheat: 2, ore: 1 });
    expect(html).toContain('card-wheat has-res');
    expect((html.match(/card-ore lacks-res/g) || []).length).toBe(2);
    expect(costTipHtml({}, RICH)).toContain('Free');
  });

  it('hover waits about 150 ms; touch waits for a long press', () => {
    expect(TIP_HOVER_MS).toBe(150);
    expect(tipDelay('mouse')).toBe(TIP_HOVER_MS);
    expect(tipDelay('pen')).toBe(TIP_HOVER_MS);
    expect(tipDelay('touch')).toBe(TIP_LONG_PRESS_MS);
    expect(TIP_LONG_PRESS_MS).toBeGreaterThanOrEqual(400);
  });

  it('the popover sits above the node, flips below near the top, and stays inside the screen', () => {
    const view = { w: 800, h: 600 };
    const size = { w: 200, h: 100 };
    expect(popoverPlace({ x: 400, y: 300 }, size, view)).toEqual({ left: 300, top: 182, below: false });
    expect(popoverPlace({ x: 400, y: 50 }, size, view)).toEqual({ left: 300, top: 68, below: true });
    expect(popoverPlace({ x: 20, y: 300 }, size, view).left).toBe(8);
    expect(popoverPlace({ x: 790, y: 300 }, size, view).left).toBe(800 - 200 - 8);
  });
});
