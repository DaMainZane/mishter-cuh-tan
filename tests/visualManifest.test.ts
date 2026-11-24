import { describe, expect, it } from 'vitest';
import { allPacks, basePack } from '../src/packs';
import {
  OVERLAY_KINDS, buildVisualManifest, createRegistry, manifestProblems, overlayProblems, registryFor, registryVisualProblems, visualProblems
} from '../src/shared';
import type { ActionDef, AddonDef, OverlayKindVisual, Pack, PieceDef, PieceVisual } from '../src/shared';

// R8.4: the manifest builder (`buildVisualManifest`) and the safety checks. The shipped packs register no visual yet (R8.8 does, one piece at a time),
// so the content comes from a small test pack. `registryVisualProblems` is run on every shipped registry too, so a bad visual fails here.

const NET_LIKE: PieceVisual = {
  slot: 'vertex',
  button: { label: 'Net', icon: 'net', order: 20 },
  hints: { noSupply: 'No nets left.', cannotAfford: 'Cannot pay.', noSpots: 'No spot.' },
  shape: '<path d="M-8,8 L0,-10 L8,8 Z" fill="{color}"/><rect x="-2" y="2" width="4" height="6" fill="{dark}"/>',
  css: '.vt-net { opacity: 0.9; }'
};
const BRIDGE_LIKE: PieceVisual = {
  slot: 'edge:ocean',
  button: { label: 'Bridge', icon: 'bridge', order: 10, group: 'bridge' },
  hints: { noSupply: 'No bridges left.', cannotAfford: 'Cannot pay.', noSpots: 'No ocean edge.' },
  shape: '<line x1="-50" y1="0" x2="50" y2="0" stroke="{color}" stroke-width="8" vector-effect="non-scaling-stroke"/>'
};
const FEED_LIKE: PieceVisual = {
  slot: 'hex',
  spotKey: 'hexId',
  button: { label: 'Feed', icon: 'fish', order: 30 },
  hints: { cannotAfford: 'Cannot pay.', noSpots: 'No sea tile.' }
};
const FLOOD_LIKE: OverlayKindVisual = {
  id: 'vt_flood',
  label: 'Flooded',
  tint: { light: 'rgba(0,0,255,0.3)', dark: 'rgba(100,100,255,0.3)' },
  line: { light: '#235', dark: '#9be' },
  pattern: '<path d="M0,5 Q2.5,2 5,5 T10,5" fill="none" stroke="currentColor"/>',
  replace: true
};

const piece = (id: string, visual?: PieceVisual): PieceDef => ({
  id, name: id, target: 'vertex', cost: { wood: 1 }, vp: 0, produces: 0, canPlace: () => false, visual
});
const action = (type: string, visual?: PieceVisual): ActionDef => ({ type, validate: () => null, apply: () => {}, visual });

function packWith(register: AddonDef['register']): Pack {
  const addon: AddonDef = {
    id: 'vt.look',
    name: 'Visual test',
    links: [
      { target: 'piece-cost', kind: 'mechanic' },
      { target: 'overlay', kind: 'ui' }
    ],
    register
  };
  return { id: 'vt', name: 'Visual test', deps: ['base'], addons: [addon], register() {} };
}

const goodPack = packWith(api => {
  // Registered out of order on purpose: the manifest sorts by button.order, then id.
  api.action(action('vt_feed', FEED_LIKE));
  api.piece(piece('vt_net', NET_LIKE));
  api.piece(piece('vt_bridge', BRIDGE_LIKE));
  api.piece(piece('vt_plain'));
  api.define(OVERLAY_KINDS, FLOOD_LIKE);
});

const regOf = (pack: Pack) => createRegistry([basePack, pack], {}, 'all');

describe('buildVisualManifest (R8.4)', () => {
  it('is empty for the base game and when Tidebound or Tides is off, and carries flood and flood-warn when Tides is on', () => {
    const empty = { version: 1, pieces: [], overlays: [] };
    expect(buildVisualManifest(createRegistry([basePack]))).toEqual(empty);
    expect(buildVisualManifest(createRegistry(allPacks))).toEqual(empty);
    expect(buildVisualManifest(registryFor(allPacks, { dlc: { tidebound: true }, addons: { 'tidebound.tides': false } }))).toEqual(empty);
    const tide = registryFor(allPacks, { dlc: { tidebound: true } });
    expect(buildVisualManifest(tide).pieces).toEqual([]);
    expect(buildVisualManifest(tide).overlays.map(o => o.id)).toEqual(['flood', 'flood-warn']);
    expect(registryVisualProblems(tide)).toEqual([]);
    // Every addon on: Bulwark adds its pieces (castle, palisade, stone), its actions (repair, gate, open/close, permit) and its zone looks.
    const all = createRegistry(allPacks, {}, 'all');
    const m = buildVisualManifest(all);
    expect(m.pieces.map(e => e.id)).toEqual(['castle', 'wall', 'stone_wall', 'repair_wall', 'build_gate', 'toggle_gate', 'set_permit']);
    expect(m.overlays.map(o => o.id)).toEqual(['flood', 'flood-warn', 'zone-closed', 'zone-open']);
    expect(registryVisualProblems(all)).toEqual([]);
  });

  it('lists pieces and actions with a visual, takes id and kind from the def, and sorts by order then id', () => {
    const m = buildVisualManifest(regOf(goodPack));
    expect(m.version).toBe(1);
    expect(m.pieces.map(e => [e.id, e.kind])).toEqual([['vt_bridge', 'piece'], ['vt_net', 'piece'], ['vt_feed', 'action']]);
    expect(m.pieces[0]).toMatchObject({ slot: 'edge:ocean', button: { group: 'bridge' } });
    expect(m.pieces.some(e => e.id === 'vt_plain')).toBe(false);
    expect(m.pieces[2].spotKey).toBe('hexId');
  });

  it('lists overlay kinds without the `replace` flag, sorted by id', () => {
    const m = buildVisualManifest(regOf(goodPack));
    expect(m.overlays).toHaveLength(1);
    expect(m.overlays[0]).toMatchObject({ id: 'vt_flood', label: 'Flooded' });
    expect('replace' in m.overlays[0]).toBe(false);
  });

  it('is plain JSON, stable between builds, and does not share objects with the defs', () => {
    const reg = regOf(goodPack);
    const m = buildVisualManifest(reg);
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
    expect(buildVisualManifest(reg)).toEqual(m);
    expect(JSON.stringify(buildVisualManifest(reg))).toBe(JSON.stringify(m));
    m.pieces[1].button.label = 'changed';
    expect(reg.pieces.get('vt_net')!.visual!.button.label).toBe('Net');
  });

  it('passes every check', () => {
    expect(registryVisualProblems(regOf(goodPack))).toEqual([]);
    expect(manifestProblems(buildVisualManifest(regOf(goodPack)))).toEqual([]);
  });

  it('registers nothing, so builds nothing, when the addon is off', () => {
    const reg = registryFor([basePack, goodPack], { dlc: { vt: true }, addons: { 'vt.look': false } });
    expect(buildVisualManifest(reg)).toEqual({ version: 1, pieces: [], overlays: [] });
  });
});

describe('visual checks (R8.4)', () => {
  const withShape = (shape: string): PieceVisual => ({ ...NET_LIKE, shape });

  it('refuses scripts, event attributes, foreignObject, javascript: urls and stray braces in a shape', () => {
    expect(visualProblems('p', withShape('<script>alert(1)</script>')).join()).toMatch(/script/);
    expect(visualProblems('p', withShape('<path d="M0,0" onclick="x()"/>')).join()).toMatch(/event attribute/);
    expect(visualProblems('p', withShape('<foreignObject></foreignObject>')).join()).toMatch(/foreignObject/);
    expect(visualProblems('p', withShape('<a href="javascript:x()"/>')).join()).toMatch(/javascript/);
    expect(visualProblems('p', withShape('<path fill="{colour}"/>')).join()).toMatch(/\{ or \}/);
    expect(visualProblems('p', withShape('<path fill="{color}" stroke="{dark}"/>'))).toEqual([]);
  });

  it('refuses a style tag, @import and expression() in css, and bad markup in an inline icon', () => {
    expect(visualProblems('p', { ...NET_LIKE, css: 'a{} </style><script>' }).join()).toMatch(/style tag/);
    expect(visualProblems('p', { ...NET_LIKE, css: '@import url(x);' }).join()).toMatch(/@import/);
    expect(visualProblems('p', { ...NET_LIKE, css: 'a { width: expression(1) }' }).join()).toMatch(/expression/);
    expect(visualProblems('p', { ...NET_LIKE, button: { label: 'X', icon: '<svg onload="x()"/>' } }).join()).toMatch(/event attribute/);
    expect(visualProblems('p', { ...NET_LIKE, button: { label: 'X', icon: 'net' } })).toEqual([]);
  });

  it('refuses an empty label, icon or hint text, and a bad order or rim', () => {
    expect(visualProblems('p', { ...NET_LIKE, button: { label: ' ', icon: 'net' } }).join()).toMatch(/label/);
    expect(visualProblems('p', { ...NET_LIKE, button: { label: 'Net', icon: '' } }).join()).toMatch(/icon/);
    expect(visualProblems('p', { ...NET_LIKE, hints: { cannotAfford: '', noSpots: 'x' } }).join()).toMatch(/cannotAfford/);
    expect(visualProblems('p', { ...NET_LIKE, hints: { cannotAfford: 'x', noSpots: '' } }).join()).toMatch(/noSpots/);
    expect(visualProblems('p', { ...NET_LIKE, button: { label: 'Net', icon: 'net', order: NaN } }).join()).toMatch(/order/);
    expect(visualProblems('p', { ...NET_LIKE, rim: -1 }).join()).toMatch(/rim/);
  });

  it('sees a function in a def even though the manifest copy would drop it', () => {
    const bad: any = { ...NET_LIKE, button: { ...NET_LIKE.button, icon: () => 'x' } };
    const reg = regOf(packWith(api => api.piece(piece('vt_bad', bad))));
    expect(registryVisualProblems(reg).join()).toMatch(/not plain JSON/);
  });

  it('needs a pattern and a label on an overlay kind (colourblind rule)', () => {
    expect(overlayProblems(FLOOD_LIKE)).toEqual([]);
    expect(overlayProblems({ ...FLOOD_LIKE, pattern: '' }).join()).toMatch(/pattern/);
    expect(overlayProblems({ ...FLOOD_LIKE, label: '' }).join()).toMatch(/label/);
    expect(overlayProblems({ ...FLOOD_LIKE, tint: { light: '', dark: 'x' } }).join()).toMatch(/tint/);
    expect(overlayProblems({ ...FLOOD_LIKE, pattern: '<g onmouseover="x()"/>' }).join()).toMatch(/event attribute/);
  });

  it('checks the whole manifest: a piece needs a shape, an action needs spotKey, ids are unique, a group keeps one slot', () => {
    const noShape = buildVisualManifest(regOf(packWith(api => api.piece(piece('vt_x', { ...NET_LIKE, shape: undefined })))));
    expect(manifestProblems(noShape).join()).toMatch(/needs a shape/);

    const noKey = buildVisualManifest(regOf(packWith(api => api.action(action('vt_y', { ...FEED_LIKE, spotKey: undefined })))));
    expect(manifestProblems(noKey).join()).toMatch(/needs spotKey/);

    const dup = buildVisualManifest(regOf(packWith(api => {
      api.piece(piece('vt_same', NET_LIKE));
      api.action(action('vt_same', FEED_LIKE));
    })));
    expect(manifestProblems(dup).join()).toMatch(/duplicate id/);

    const mixed = buildVisualManifest(regOf(packWith(api => {
      api.piece(piece('vt_a', { ...BRIDGE_LIKE }));
      api.piece(piece('vt_b', { ...NET_LIKE, button: { ...NET_LIKE.button, group: 'bridge' } }));
    })));
    expect(manifestProblems(mixed).join()).toMatch(/mixes slots/);
  });
});
