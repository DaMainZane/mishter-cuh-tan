import { describe, expect, it } from 'vitest';
import {
  badgeFor, buttonHtml, buttonModels, buttonVisible, canPay, edgeShapeMarkup, entriesAtSpot, fillShape, iconHtml, isSafeCss, isSafeFragment, modeHint, modeOf,
  COST_STACK_MAX, costStackHtml, modelForMode, netSeaTiles, offeredEntries, placedEntry, portRaiseSpots, recipeCostFor, recipeStripHtml, spotMarkup, spotsForMode, stackSizes, vertexShapeMarkup, withRim
} from '../src/client/pieceModel';
import { netTileMarkup } from '../src/client/icons';
import type { BoardGeom, PieceViewer } from '../src/client/pieceModel';
import type { ManifestEntry } from '../src/shared';

// R8.7: the pure half of the generic piece UI. No DOM, no socket: plain manifest entries and plain `pieces[id]` data in, markup and decisions out.

const SHAPE = '<path d="M-8,8 L0,-10 L8,8 Z" fill="{color}" stroke="{dark}"/>';

const NET: ManifestEntry = {
  id: 'net', kind: 'piece', slot: 'vertex',
  button: { label: 'Net', icon: 'net', order: 20 },
  hints: { noSupply: 'No nets left.', cannotAfford: 'Cannot pay for a net.', noSpots: 'No coast spot.' },
  shape: SHAPE
};
const FEED: ManifestEntry = {
  id: 'feed_sea', kind: 'action', slot: 'hex', spotKey: 'hexId',
  button: { label: 'Feed', icon: 'fish', order: 30 },
  hints: { cannotAfford: 'Cannot pay to feed.', noSpots: 'No sea tile to feed.' }
};
const BRIDGE: ManifestEntry = {
  id: 'bridge', kind: 'piece', slot: 'edge:ocean',
  button: { label: 'Bridge', icon: 'bridge', order: 10, group: 'bridge' },
  hints: { noSupply: 'No bridges left.', cannotAfford: 'Cannot pay for a bridge.', noSpots: 'No ocean edge.' },
  shape: '<line x1="-50" y1="0" x2="50" y2="0" stroke="{color}"/>'
};
const RICKETY: ManifestEntry = {
  id: 'rickety_bridge', kind: 'piece', slot: 'edge:ocean',
  button: { label: 'Rickety', icon: 'bridge', order: 11, group: 'bridge' },
  hints: { noSupply: 'No rickety left.', cannotAfford: 'Cannot pay for a rickety bridge.', noSpots: 'No ocean edge for it.' },
  shape: '<line x1="-50" y1="0" x2="50" y2="0" stroke="{color}" stroke-dasharray="9 5"/>'
};
const ALL = [NET, FEED, BRIDGE, RICKETY];

const hand = { wood: 3, brick: 1, sheep: 1, wheat: 0, ore: 0 };
const viewer = (pieces: NonNullable<PieceViewer>['pieces'], resources = hand): PieceViewer => ({ resources, pieces });

describe('buttons (R8.7)', () => {
  it('groups entries into one button per mode, in button order, label and icon from the first by order', () => {
    const models = buttonModels(ALL);
    expect(models.map(m => m.mode)).toEqual(['bridge', 'net', 'feed_sea']);
    const bridge = models[0];
    expect(bridge.entries.map(e => e.id)).toEqual(['bridge', 'rickety_bridge']);
    expect(bridge.label).toBe('Bridge');
    expect(bridge.order).toBe(10);
    expect(modeOf(NET)).toBe('net');
    expect(modeOf(RICKETY)).toBe('bridge');
  });

  it('orders by order, then id, whatever order the entries arrive in', () => {
    const a = { ...NET, id: 'b', button: { ...NET.button, order: undefined } } as ManifestEntry;
    const b = { ...NET, id: 'a', button: { ...NET.button, order: undefined } } as ManifestEntry;
    expect(buttonModels([a, b, FEED, NET]).map(m => m.mode)).toEqual(['net', 'feed_sea', 'a', 'b']);
  });

  it('leaves out an entry whose id or group is not a plain identifier (it ends up in onclick and element ids)', () => {
    const bad = { ...NET, id: "x'); alert(1); ('" } as ManifestEntry;
    const badGroup = { ...NET, id: 'ok', button: { ...NET.button, group: 'a b' } } as ManifestEntry;
    expect(buttonModels([bad, badGroup, FEED]).map(m => m.mode)).toEqual(['feed_sea']);
  });

  it('modelForMode finds a generated mode and says nothing about the hand-written ones', () => {
    expect(modelForMode(ALL, 'bridge')?.entries).toHaveLength(2);
    expect(modelForMode(ALL, 'net')?.mode).toBe('net');
    expect(modelForMode(ALL, 'road')).toBeUndefined();
    expect(modelForMode(ALL, null)).toBeUndefined();
    expect(modelForMode([], 'net')).toBeUndefined();
  });

  it('is shown in the lobby as a preview, and in a game only when an entry of it is on offer', () => {
    const [bridge, net] = buttonModels([BRIDGE, RICKETY, NET]);
    expect(buttonVisible(net, undefined, true)).toBe(true);
    expect(buttonVisible(net, undefined, false)).toBe(false);
    expect(buttonVisible(net, viewer({}), false)).toBe(false);
    expect(buttonVisible(net, viewer({ net: { left: 4, cost: {}, spots: null } }), false)).toBe(true);
    // one of two grouped entries on offer is enough
    expect(buttonVisible(bridge, viewer({ rickety_bridge: { left: 3, cost: {}, spots: null } }), false)).toBe(true);
    expect(offeredEntries(bridge, viewer({ rickety_bridge: { left: 3, cost: {}, spots: null } })).map(e => e.id)).toEqual(['rickety_bridge']);
  });

  it('badge: the supply of the first offered entry that has one; none for an action or before the data arrives', () => {
    const [bridge, net, feed] = buttonModels([BRIDGE, RICKETY, NET, FEED]);
    const v = viewer({
      bridge: { left: 0, cost: {}, spots: null },
      net: { left: 4, cost: {}, spots: null },
      feed_sea: { left: null, cost: { wheat: 1 }, spots: null }
    });
    expect(badgeFor(net, v)).toBe(4);
    expect(badgeFor(bridge, v)).toBe(0);
    expect(badgeFor(feed, v)).toBeNull();
    expect(badgeFor(net, undefined)).toBeNull();
    expect(badgeFor(net, { resources: hand })).toBeNull();
  });

  it('builds a hidden button with a badge, a recipe popup and the build mode, and escapes the label', () => {
    const html = buttonHtml(buttonModels([{ ...NET, button: { ...NET.button, label: 'N<e>t' } }])[0]);
    expect(html).toContain('id="pieceBtn-net"');
    expect(html).toContain(`onclick="setBuildMode('net')"`);
    expect(html).toContain('id="recipePopup-net"');
    expect(html).toContain('id="pieceBadge-net"');
    expect(html).toContain('style="display:none;"');
    expect(html).toContain('N&lt;e&gt;t');
    expect(html).not.toContain('N<e>t');
    expect(html).toContain('<svg class="ui-icon"');
  });

  it('icons: a name becomes the UI icon, an unknown name a plus, inline inner shapes are wrapped, a full svg is kept, unsafe inline markup is refused', () => {
    expect(iconHtml('net')).toContain('data-icon="net"');
    expect(iconHtml('no-such-icon')).toContain('<svg class="ui-icon"');
    expect(iconHtml('<circle r="3"/>')).toContain('viewBox="0 0 24 24"');
    expect(iconHtml('<circle r="3"/>')).toContain('<circle r="3"/>');
    expect(iconHtml('<svg viewBox="0 0 10 10"><rect/></svg>')).toBe('<span><svg viewBox="0 0 10 10"><rect/></svg></span>');
    expect(iconHtml('<svg onload="x()"></svg>')).not.toContain('onload');
  });
});

describe('recipe strip (R8.7)', () => {
  it('shows one card per unit, lit when the hand has it, and counts repeats against the hand', () => {
    const html = recipeStripHtml({ wood: 2, sheep: 1 }, { wood: 1, sheep: 1 });
    expect(html.match(/card-wood has-res/g)).toHaveLength(1);
    expect(html.match(/card-wood lacks-res/g)).toHaveLength(1);
    expect(html).toContain('card-sheep has-res');
    expect(html.startsWith('<div class="recipe-cards-strip">')).toBe(true);
  });

  it('is empty for no price, skips a resource name that is not plain, and reads the first offered entry', () => {
    expect(recipeStripHtml(undefined, hand)).toBe('');
    expect(recipeStripHtml({}, hand)).toBe('');
    expect(recipeStripHtml({ 'wood"><x': 1 }, hand)).toBe('');
    const [net] = buttonModels([NET]);
    expect(recipeCostFor(net, viewer({ net: { left: 4, cost: { wood: 2, sheep: 1 }, spots: null } }))).toEqual({ wood: 2, sheep: 1 });
    expect(recipeCostFor(net, viewer({}))).toBeUndefined();
  });

  it('canPay: every resource covered, an empty price is free, no hand is no', () => {
    expect(canPay(viewer({}), { wood: 2, sheep: 1 })).toBe(true);
    expect(canPay(viewer({}), { wood: 4 })).toBe(false);
    expect(canPay(viewer({}), {})).toBe(true);
    expect(canPay(viewer({}), undefined)).toBe(true);
    expect(canPay({ pieces: {} }, { wood: 1 })).toBe(false);
    expect(canPay(null, {})).toBe(false);
  });
});

describe('stacked costs (BUG 5)', () => {
  const cards = (html: string): number => html.match(/class="recipe-mini-card /g)?.length ?? 0;
  const stacks = (html: string): number => html.match(/class="recipe-stack"/g)?.length ?? 0;

  it('stackSizes splits a count into stacks of at most four, like a tally', () => {
    expect(COST_STACK_MAX).toBe(4);
    expect(stackSizes(1)).toEqual([1]);
    expect(stackSizes(3)).toEqual([3]);
    expect(stackSizes(4)).toEqual([4]);
    expect(stackSizes(5)).toEqual([4, 1]);
    expect(stackSizes(6)).toEqual([4, 2]);
    expect(stackSizes(12)).toEqual([4, 4, 4]);
  });

  it('stackSizes gives nothing for zero, a negative count or a non-number', () => {
    expect(stackSizes(0)).toEqual([]);
    expect(stackSizes(-3)).toEqual([]);
    expect(stackSizes(Number.NaN)).toEqual([]);
  });

  it('N cards of one resource are one stack of N overlapped layers, not N boxes in a row', () => {
    const html = costStackHtml('wood', 3, 0);
    expect(stacks(html)).toBe(1);
    expect(cards(html)).toBe(3);
    expect(html).toContain('--n:3');
    expect(html).toContain('--i:0');
    expect(html).toContain('--i:2');
    expect(html).not.toContain('--i:3');
  });

  it('a count past four continues in another stack: 6 is 4 + 2, 12 is three stacks of 4', () => {
    const six = costStackHtml('brick', 6, 0);
    expect(stacks(six)).toBe(2);
    expect(cards(six)).toBe(6);
    expect(six).toContain('--n:4');
    expect(six).toContain('--n:2');
    const twelve = costStackHtml('wood', 12, 0);
    expect(stacks(twelve)).toBe(3);
    expect(cards(twelve)).toBe(12);
    expect(twelve.match(/--n:4/g)).toHaveLength(3);
  });

  it('the first units you own are lit and the rest are dim, counted across stacks', () => {
    const html = costStackHtml('wood', 5, 4);
    expect(html.match(/has-res/g)).toHaveLength(4);
    expect(html.match(/lacks-res/g)).toHaveLength(1);
    // the dim one is the last card, the lone card of the second stack
    expect(html.lastIndexOf('lacks-res')).toBeGreaterThan(html.lastIndexOf('has-res'));
    expect(costStackHtml('wood', 2, 9).match(/lacks-res/g)).toBeNull();
    expect(costStackHtml('wood', 2, 0).match(/has-res/g)).toBeNull();
  });

  it('is empty for a zero count or a resource name that is not plain', () => {
    expect(costStackHtml('wood', 0, 5)).toBe('');
    expect(costStackHtml('wood"><x', 2, 5)).toBe('');
  });

  it('a recipe strip holds one group of stacks per resource type, never mixing two resources in one stack', () => {
    const html = recipeStripHtml({ wood: 2, sheep: 2 }, hand);
    expect(html.startsWith('<div class="recipe-cards-strip">')).toBe(true);
    expect(stacks(html)).toBe(2);
    const parts = html.split('class="recipe-stack"');
    expect(parts[1]).toContain('card-wood');
    expect(parts[1]).not.toContain('card-sheep');
    expect(parts[2]).toContain('card-sheep');
    expect(parts[2]).not.toContain('card-wood');
  });

  it('a big cost in a recipe strip tallies: 12 wood and 1 sheep is four stacks and 13 cards', () => {
    const html = recipeStripHtml({ wood: 12, sheep: 1 }, hand);
    expect(stacks(html)).toBe(4);
    expect(cards(html)).toBe(13);
  });
});

describe('hints, first match wins (R8.7)', () => {
  const [net] = buttonModels([NET]);
  const [feed] = buttonModels([FEED]);
  const [bridge] = buttonModels([BRIDGE, RICKETY]);

  it('supply used up gives noSupply, even when the player is also broke', () => {
    expect(modeHint(net, viewer({ net: { left: 0, cost: { ore: 9 }, spots: [] } }))).toBe('No nets left.');
  });

  it('cannot pay gives cannotAfford', () => {
    expect(modeHint(net, viewer({ net: { left: 2, cost: { wood: 2, sheep: 5 }, spots: [] } }))).toBe('Cannot pay for a net.');
  });

  it('can pay but nothing is legal gives noSpots', () => {
    expect(modeHint(net, viewer({ net: { left: 2, cost: { wood: 2 }, spots: [] } }))).toBe('No coast spot.');
  });

  it('something can be done, or the spots are not computed: no hint', () => {
    expect(modeHint(net, viewer({ net: { left: 2, cost: { wood: 2 }, spots: [4, 9] } }))).toBeNull();
    expect(modeHint(net, viewer({ net: { left: 2, cost: { wood: 2 }, spots: null } }))).toBeNull();
    expect(modeHint(net, undefined)).toBeNull();
    expect(modeHint(net, viewer({}))).toBeNull();
  });

  it('an action has no supply step', () => {
    expect(modeHint(feed, viewer({ feed_sea: { left: null, cost: { wheat: 1 }, spots: [3] } }))).toBe('Cannot pay to feed.');
    expect(modeHint(feed, viewer({ feed_sea: { left: null, cost: { wood: 1 }, spots: [] } }))).toBe('No sea tile to feed.');
    expect(modeHint(feed, viewer({ feed_sea: { left: null, cost: { wood: 1 }, spots: [3] } }))).toBeNull();
  });

  it('a group: the step applies when it holds for every entry on offer', () => {
    // full bridge out of supply but the rickety one is not: no supply hint, and the rickety one can be built
    const mixed = viewer({
      bridge: { left: 0, cost: { wood: 1 }, spots: [] },
      rickety_bridge: { left: 2, cost: { wood: 1 }, spots: [7] }
    });
    expect(modeHint(bridge, mixed)).toBeNull();
    // both out of supply
    expect(modeHint(bridge, viewer({
      bridge: { left: 0, cost: {}, spots: [] },
      rickety_bridge: { left: 0, cost: {}, spots: [] }
    }))).toBe('No bridges left.');
    // the full one is too dear, the rickety one is cheap and has a spot: nothing to say
    expect(modeHint(bridge, viewer({
      bridge: { left: 5, cost: { ore: 3 }, spots: [] },
      rickety_bridge: { left: 5, cost: { wood: 1 }, spots: [7] }
    }))).toBeNull();
    // nothing affordable anywhere
    expect(modeHint(bridge, viewer({
      bridge: { left: 5, cost: { ore: 3 }, spots: [] },
      rickety_bridge: { left: 5, cost: { ore: 1 }, spots: [] }
    }))).toBe('Cannot pay for a bridge.');
  });
});

describe('spots (R8.7)', () => {
  const v = viewer({
    net: { left: 4, cost: {}, spots: [2, 5] },
    feed_sea: { left: null, cost: {}, spots: [11] },
    bridge: { left: 5, cost: {}, spots: [30, 31] },
    rickety_bridge: { left: 5, cost: {}, spots: [31, 32] }
  });

  it('a mode draws its own spots and nothing else', () => {
    expect(spotsForMode(ALL, 'net', v).map(s => `${s.entry.id}:${s.loc}`)).toEqual(['net:2', 'net:5']);
    expect(spotsForMode(ALL, 'feed_sea', v).map(s => `${s.entry.id}:${s.loc}`)).toEqual(['feed_sea:11']);
    expect(spotsForMode(ALL, 'road', v)).toEqual([]);
  });

  it('with no mode, only the edge buttons draw their spots (like the road); vertex and hex ones wait for their button', () => {
    const none = spotsForMode(ALL, null, v).map(s => `${s.entry.id}:${s.loc}`);
    expect(none).toEqual(['bridge:30', 'bridge:31', 'rickety_bridge:32']);
  });

  it('a location listed by two grouped entries is one spot, owned by the first by order', () => {
    const spots = spotsForMode(ALL, 'bridge', v);
    expect(spots.filter(s => s.loc === 31)).toHaveLength(1);
    expect(spots.find(s => s.loc === 31)?.entry.id).toBe('bridge');
  });

  it('nothing for a viewer with no data, an absent key, or spots not computed', () => {
    expect(spotsForMode(ALL, 'net', undefined)).toEqual([]);
    expect(spotsForMode(ALL, 'net', { resources: hand })).toEqual([]);
    expect(spotsForMode(ALL, 'net', viewer({}))).toEqual([]);
    expect(spotsForMode(ALL, 'net', viewer({ net: { left: 4, cost: {}, spots: null } }))).toEqual([]);
  });

  it('entriesAtSpot: the grouped entries that list a location (two means a chooser)', () => {
    expect(entriesAtSpot(ALL, v, 'bridge', 31).map(e => e.id)).toEqual(['bridge', 'rickety_bridge']);
    expect(entriesAtSpot(ALL, v, 'bridge', 30).map(e => e.id)).toEqual(['bridge']);
    expect(entriesAtSpot(ALL, v, 'bridge', 99)).toEqual([]);
    expect(entriesAtSpot(ALL, undefined, 'bridge', 31)).toEqual([]);
  });

  const board: BoardGeom = {
    vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
    edges: [{ v1: 0, v2: 1 }, { v1: 1, v2: 2 }],
    hexes: [{ x: 50, y: 50 }]
  };

  it('draws the generic marker of each slot, with the one click handler', () => {
    const vertex = spotMarkup({ entry: NET, loc: 1 }, board);
    expect(vertex).toContain(`onclick="clickSpot('net',1)"`);
    expect(vertex).toContain('spot-pulse');
    expect(vertex).toContain('cx="100" cy="0"');
    expect(spotMarkup({ entry: NET, loc: 1 }, board, true)).toContain('spot-static');

    const hex = spotMarkup({ entry: FEED, loc: 0 }, board);
    expect(hex).toContain(`onclick="clickSpot('feed_sea',0)"`);
    expect(hex).toContain('translate(50, 50)');

    const edge = spotMarkup({ entry: BRIDGE, loc: 1 }, board);
    expect(edge).toContain(`onclick="clickSpot('bridge',1)"`);
    expect(edge).toContain('road-spot-line');
    expect(edge).toContain('road-spot-dot');
    expect(edge).toContain('cx="100" cy="50"');
  });

  it('uses the entry\'s own spot fragment when it has a safe one', () => {
    const own = { ...NET, spot: '<path class="net-spot" d="M0,-12 L10,-1 L0,10 L-10,-1 Z"/>' };
    expect(spotMarkup({ entry: own, loc: 1 }, board)).toContain('class="net-spot"');
    expect(spotMarkup({ entry: own, loc: 1 }, board)).toContain('building-zoom-scale');
    const unsafe = { ...NET, spot: '<path onclick="x()" d="M0,0"/>' };
    expect(spotMarkup({ entry: unsafe, loc: 1 }, board)).toContain('spot-pulse');
  });

  it('a location that is not on the board draws nothing', () => {
    expect(spotMarkup({ entry: NET, loc: 99 }, board)).toBe('');
    expect(spotMarkup({ entry: FEED, loc: 99 }, board)).toBe('');
    expect(spotMarkup({ entry: BRIDGE, loc: 99 }, board)).toBe('');
  });
});

describe('shapes (R8.7)', () => {
  it('fills {color} and {dark}; a colour that is not a hex colour becomes grey so a placeholder never carries markup', () => {
    const red = fillShape(SHAPE, '#ff0000')!;
    expect(red).toContain('fill="#ff0000"');
    expect(red).toContain('stroke="rgb(179,0,0)"');
    expect(red).not.toContain('{');
    const grey = fillShape(SHAPE, '"/><script>x()</script>')!;
    expect(grey).toContain('fill="#888888"');
    expect(grey).not.toContain('script');
  });

  it('refuses a shape that is missing, blank or unsafe', () => {
    expect(fillShape(undefined, '#fff')).toBeNull();
    expect(fillShape('  ', '#fff')).toBeNull();
    expect(fillShape('<script>x()</script>', '#fff')).toBeNull();
    expect(fillShape('<g onclick="x()"/>', '#fff')).toBeNull();
    expect(fillShape('<a href="javascript:x()"/>', '#fff')).toBeNull();
    expect(isSafeFragment('<path d="M0,0"/>')).toBe(true);
    expect(isSafeCss('.a{fill:red}')).toBe(true);
    expect(isSafeCss('@import url(x)')).toBe(false);
    expect(isSafeCss('</style><script>')).toBe(false);
  });

  it('the rim layer is the same fragment drawn first with the rim width, then the body', () => {
    const out = withRim('<path d="M0,0"/>', 4);
    expect(out).toBe('<g class="vis-rim" style="--vis-rim:4px"><path d="M0,0"/></g><path d="M0,0"/>');
    expect(withRim('<b/>', undefined)).toContain('--vis-rim:3.4px');
    expect(withRim('<b/>', -2)).toContain('--vis-rim:3.4px');
  });

  it('a vertex shape is the filled fragment with its rim', () => {
    const out = vertexShapeMarkup(NET, '#00ff00')!;
    expect(out.startsWith('<g class="vis-rim"')).toBe(true);
    expect(out).toContain('fill="#00ff00"');
    expect(vertexShapeMarkup({ ...NET, shape: undefined }, '#00ff00')).toBeNull();
    expect(vertexShapeMarkup({ ...NET, rim: 5 }, '#00ff00')).toContain('--vis-rim:5px');
  });

  it('an edge shape is moved to the middle, turned onto the segment and stretched to its length', () => {
    const flat = edgeShapeMarkup(BRIDGE, '#112233', { x: 0, y: 0 }, { x: 100, y: 0 })!;
    expect(flat.startsWith('<g transform="translate(50.0, 0.0) rotate(0.00) scale(1.0000, 1)">')).toBe(true);
    const half = edgeShapeMarkup(BRIDGE, '#112233', { x: 0, y: 0 }, { x: 0, y: 50 })!;
    expect(half).toContain('translate(0.0, 25.0) rotate(90.00) scale(0.5000, 1)');
    expect(edgeShapeMarkup({ ...BRIDGE, shape: '<script/>' }, '#112233', { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
    // a zero-length segment does not divide by zero
    expect(edgeShapeMarkup(BRIDGE, '#112233', { x: 5, y: 5 }, { x: 5, y: 5 })).toContain('scale(0.0100, 1)');
  });

  it('placedEntry: a manifest piece with a shape on the right kind of slot; never road, settlement or city; never an action', () => {
    expect(placedEntry(ALL, 'net', 'vertex')?.id).toBe('net');
    expect(placedEntry(ALL, 'net', 'edge')).toBeUndefined();
    expect(placedEntry(ALL, 'bridge', 'edge')?.id).toBe('bridge');
    expect(placedEntry(ALL, 'rickety_bridge', 'edge')?.id).toBe('rickety_bridge');
    expect(placedEntry(ALL, 'bridge', 'vertex')).toBeUndefined();
    expect(placedEntry(ALL, 'feed_sea', 'vertex')).toBeUndefined();
    expect(placedEntry(ALL, 'settlement', 'vertex')).toBeUndefined();
    expect(placedEntry(ALL, 'road', 'edge')).toBeUndefined();
    expect(placedEntry(ALL, undefined, 'edge')).toBeUndefined();
    expect(placedEntry([{ ...NET, shape: undefined }], 'net', 'vertex')).toBeUndefined();
  });
});

// BUG 4: Harbor charters (3:1 -> 2:1) had no node on the board, and the Harbor toolbar button only knew the 1:1 harbor. The hotspots come from `techActions.harbor`.
describe('portRaiseSpots (Harbor charters hotspots)', () => {
  const cost = { wood: 2, brick: 1, ore: 1 };
  const harbor = (affordable: boolean) => ({
    cost,
    affordable,
    ports: [{ vertexId: 7, level: 0 }, { vertexId: 12, level: 1 }, { vertexId: 20, level: 0 }]
  });

  it('lists the ports not yet raised, with the price and whether it can be paid', () => {
    expect(portRaiseSpots(harbor(true), true)).toEqual([
      { vertexId: 7, cost, affordable: true },
      { vertexId: 20, cost, affordable: true }
    ]);
    expect(portRaiseSpots(harbor(false), true).every(s => !s.affordable)).toBe(true);
  });

  it('is empty without the tech, off your main-phase turn, or with nothing to raise', () => {
    expect(portRaiseSpots(null, true)).toEqual([]);
    expect(portRaiseSpots(undefined, true)).toEqual([]);
    expect(portRaiseSpots(harbor(true), false)).toEqual([]);
    expect(portRaiseSpots({ cost, affordable: true, ports: [{ vertexId: 12, level: 1 }] }, true)).toEqual([]);
  });
});

// FISHING NET BUG: a net was a tiny piece on the settlement spot; it is now drawn over the sea tile(s) it fishes (a rope-and-float mesh).
describe('netSeaTiles (which sea tiles show a net)', () => {
  const hexes = [{ type: 'wood' }, { type: 'water' }, { type: 'water' }, { type: 'water', fog: true }];
  const net = (owner: string) => ({ type: 'net', owner });

  it('gives every sea tile at a net vertex to its owner and skips land tiles', () => {
    const vertices = [{ id: 0, hexIds: [0, 1, 2], building: net('a') }];
    expect(netSeaTiles(vertices, hexes)).toEqual({ tiles: [{ hexId: 1, owner: 'a' }, { hexId: 2, owner: 'a' }], bare: [] });
  });

  it('draws a tile once: the first net (by vertex order) keeps it', () => {
    const vertices = [
      { id: 0, hexIds: [0, 1], building: net('a') },
      { id: 1, hexIds: [0, 1, 2], building: net('b') }
    ];
    expect(netSeaTiles(vertices, hexes).tiles).toEqual([{ hexId: 1, owner: 'a' }, { hexId: 2, owner: 'b' }]);
  });

  it('ignores other buildings and empty vertices', () => {
    const vertices = [
      { id: 0, hexIds: [0, 1], building: { type: 'city', owner: 'a' } },
      { id: 1, hexIds: [0, 1, 2], building: null },
      { id: 2, hexIds: [0, 1, 2] }
    ];
    expect(netSeaTiles(vertices, hexes)).toEqual({ tiles: [], bare: [] });
  });

  it('lists a net with no drawable sea tile (hidden fog, land only) as bare, so its vertex piece stays visible', () => {
    const vertices = [{ id: 4, hexIds: [0, 3], building: net('a') }];
    expect(netSeaTiles(vertices, hexes)).toEqual({ tiles: [], bare: [4] });
  });
});

describe('netTileMarkup (the net over a sea tile)', () => {
  const R = 60;
  const corners = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return { x: 100 + R * Math.cos(a), y: 100 + R * Math.sin(a) };
  });
  const markup = netTileMarkup(5, corners, 100, 100, '#e53935');

  it('has a rope border, a mesh clipped to the tile and one float per corner in the owner colour', () => {
    expect(markup).toContain('<clipPath id="net-clip-5">');
    expect(markup).toContain('clip-path="url(#net-clip-5)"');
    expect(markup.match(/class="net-float"/g)).toHaveLength(6);
    expect(markup).toContain('#e53935');
    expect(markup).toContain('class="net-mesh"');
    expect(markup).toContain('class="net-rope"');
  });

  it('does not catch clicks and carries no script', () => {
    expect(markup).toContain('pointer-events:none');
    expect(markup).not.toMatch(/<script|onclick|javascript:/i);
  });

  it('gives each tile its own clip id', () => {
    expect(netTileMarkup(6, corners, 100, 100, '#e53935')).toContain('net-clip-6');
  });
});
