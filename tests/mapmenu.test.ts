import { describe, expect, it } from 'vitest';
import type { Board } from '../src/shared';
import { applyRecipeStyle, generateLobbyMap } from '../src/server/lobby';
import { mapOptionsView } from '../src/server/mapmenu';
import { applyLoadedPreset, loadPreset, presetStyle, serializePreset } from '../src/server/presets';
import { defaultSettings, registry } from '../src/server/runtime';
import { makeStateBuilder } from '../src/server/view';
import { createRoom, rooms } from '../src/server/rooms';
import type { MapMeta } from '../src/server/types';

// M6: the data behind the lobby map menu (the registry's options as plain JSON) and presets v2 (a snapshot plus the recipe).

const hexSig = (b: Board) => b.hexes.map(h => `${h.q},${h.r},${h.type},${h.number},${h.ext.hidden ? 1 : 0}`).join('|');

/** A room-shaped object with a generated lobby map, like the server keeps. */
function roomOf(over: Record<string, any> = {}) {
  const settings = { ...defaultSettings(), ...over };
  const { board, meta } = generateLobbyMap(settings);
  settings.mapSeed = meta.recipe.seed;
  return { settings, board, mapMeta: meta as MapMeta | undefined };
}

function loaded(raw: any, old = defaultSettings()) {
  const res = loadPreset(raw, old);
  if ('error' in res) throw new Error(res.error);
  return res;
}

describe('map options for the menu', () => {
  const view = mapOptionsView();
  const find = (id: string) => view.options.find(o => o.id === id);

  it('lists every registered shape, terrain style, number style and perk', () => {
    const ids = view.options.map(o => o.id);
    const all = [...registry.mapShapes.keys(), ...registry.mapTerrains.keys(), ...registry.mapNumberings.keys(), ...registry.mapPerks.keys()];
    expect(ids).toEqual(all);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries what the menu needs: stage, phase, slot, default, conflicts, params', () => {
    expect(find('hexagon')).toMatchObject({ stage: 'shape', phase: 'base', slot: 'shape', default: true, met: true });
    expect(find('continent')?.params.map(p => p.id)).toContain('land');
    expect(find('lake')).toMatchObject({ stage: 'shape', phase: 'carve' });
    expect(find('lake')?.slot).toBeUndefined();
    expect(find('lake')?.conflicts).toContain('ring');
    expect(find('random')).toMatchObject({ stage: 'terrain', slot: 'terrain', default: true });
    expect(find('standard')).toMatchObject({ stage: 'numbers', slot: 'numbers', default: true });
    expect(find('gold')?.stage).toBe('extras');
    expect(find('fog')?.stage).toBe('extras');
  });

  it('has exactly one default per slot, and every option is usable (no capability is missing in v1)', () => {
    const defaults = view.options.filter(o => o.default);
    expect(defaults.map(o => o.slot).sort()).toEqual(['numbers', 'shape', 'terrain']);
    expect(view.options.every(o => o.met)).toBe(true);
  });

  it('lists the quick starts, with Blank marked', () => {
    expect(view.quickStarts.map(q => q.id).sort()).toEqual([
      'archipelago', 'balancedContinent', 'beginner', 'blank', 'chaos', 'fogContinents', 'fogIsland', 'fogRing', 'goldIslands',
      'goldRush', 'islandHopper', 'lakeland', 'mountainGold', 'realisticContinent', 'ringLagoon', 'standard'
    ]);
    expect(view.quickStarts.find(q => q.id === 'blank')?.blank).toBe(true);
    expect(view.quickStarts.find(q => q.id === 'standard')?.blank).toBe(false);
  });

  it('survives JSON, which is how it travels', () => {
    const copy = JSON.parse(JSON.stringify(view));
    expect(copy.options).toHaveLength(view.options.length);
    expect(copy.quickStarts).toHaveLength(view.quickStarts.length);
  });
});

describe('what the lobby view tells the client about the map', () => {
  it('sends the recipe, the one-line share code and the report, seed included', () => {
    const room = createRoom('host-m6', 'Host');
    try {
      const state = makeStateBuilder(room)('host-m6');
      expect(state.mapMeta).not.toBeNull();
      expect(state.mapMeta.recipe.seed).toBe(room.settings.mapSeed);
      expect(state.mapMeta.code.startsWith('hx1;')).toBe(true);
      expect(state.mapMeta.code).toContain(`seed=${room.settings.mapSeed}`);
      expect(state.mapMeta.edited).toBe(false);
      expect(state.mapMeta.otherVersion).toBe(false);
      expect(Array.isArray(state.mapMeta.report.stats.landmasses)).toBe(true);
      expect(Array.isArray(state.mapMeta.report.stats.landmassSpots)).toBe(true);
      expect(state.settings.mapPicks).toEqual(room.settings.mapPicks);
    } finally {
      delete rooms[room.code];
    }
  });
});

describe('presets v2', () => {
  it('saves the recipe of a generated map, and none for an edited or snapshot-only map', () => {
    const room = roomOf({ mapPicks: ['continent', 'lake'], boardRadius: 3, mapSeed: 'SAVE1' });
    const saved = serializePreset(room.board, room.settings, 'Style', room.mapMeta);
    expect(saved.v).toBe(2);
    expect(saved.recipe?.seed).toBe('SAVE1');
    expect(saved.recipe?.picks).toEqual(['continent', 'lake']);
    expect(saved.recipe?.radius).toBe(3);
    expect(saved.genVersion).toBe(saved.recipe?.g);

    expect(serializePreset(room.board, room.settings, 'Edited', { ...room.mapMeta!, edited: true }).recipe).toBeNull();
    expect(serializePreset(room.board, room.settings, 'Plain').recipe).toBeNull();
  });

  it('loading a preset with a recipe brings back the exact map, the seed and the style', () => {
    const src = roomOf({ mapPicks: ['continent'], boardRadius: 3, mapSeed: 'LOAD1' });
    const saved = JSON.parse(JSON.stringify(serializePreset(src.board, src.settings, 'A', src.mapMeta)));

    const target = roomOf({ boardRadius: 2, mapSeed: 'OTHER' });
    const res = loaded(saved, target.settings);
    expect(res.recipe?.seed).toBe('LOAD1');
    applyLoadedPreset(target, res);

    expect(hexSig(target.board)).toBe(hexSig(src.board));
    expect(target.settings.mapSeed).toBe('LOAD1');
    expect(target.settings.mapPicks).toEqual(['continent']);
    expect(target.settings.boardRadius).toBe(3);
    expect(target.mapMeta?.recipe.seed).toBe('LOAD1');
    expect(target.mapMeta?.recipe.picks).toEqual(['continent']);
    expect(target.mapMeta?.edited).toBe(false);
    expect(target.mapMeta?.report.stats.land).toBeGreaterThan(0);
  });

  it('a v1 preset (no recipe) loads as a snapshot: no seed, no meta', () => {
    const src = roomOf({ mapPicks: ['gold'], mapSeed: 'V1' });
    const { recipe, genVersion, ...v1 } = serializePreset(src.board, src.settings, 'Old', src.mapMeta);
    expect(recipe).not.toBeNull();
    expect(genVersion).toBe(recipe?.g);

    const target = roomOf({ mapSeed: 'KEEPME' });
    const res = loaded({ ...v1, v: 1 }, target.settings);
    expect(res.recipe).toBeNull();
    applyLoadedPreset(target, res);
    expect(hexSig(target.board)).toBe(hexSig(src.board));
    expect(target.mapMeta).toBeUndefined();
  });

  it('cleans a hostile recipe instead of trusting it', () => {
    const src = roomOf({ mapSeed: 'CLEAN1' });
    const saved = JSON.parse(JSON.stringify(serializePreset(src.board, src.settings, 'X', src.mapMeta)));

    expect(loaded({ ...saved, recipe: { seed: 5 } }).recipe).toBeNull();
    expect(loaded({ ...saved, recipe: 'junk' }).recipe).toBeNull();
    expect(loaded({ ...saved, recipe: { seed: '' } }).recipe).toBeNull();

    // Unknown ids and out-of-range numbers are dropped or clamped when the recipe is applied.
    const odd = loaded({ ...saved, recipe: { g: 1, seed: 'ODD1', radius: 9999, picks: ['continent', 'bogus', 'fog'], params: { land: 5000, bogus: 1 } } });
    expect(odd.recipe?.radius).toBeLessThanOrEqual(30);
    const target = roomOf();
    applyLoadedPreset(target, odd);
    expect(target.settings.mapPicks).toEqual(['continent', 'fog']);
    expect(target.settings.mapSeed).toBe('ODD1');
    expect(target.settings.mapParams?.land).toBeLessThanOrEqual(90);
    expect(target.settings.mapParams).not.toHaveProperty('bogus');
  });

  it('"new seed" applies the style with a fresh seed', () => {
    const src = roomOf({ mapPicks: ['continent', 'lake'], boardRadius: 4, mapSeed: 'STYLE1' });
    const saved = JSON.parse(JSON.stringify(serializePreset(src.board, src.settings, 'S', src.mapMeta)));
    const style = presetStyle(saved);
    expect(style?.radius).toBe(4);
    expect(style?.picks).toEqual(['continent', 'lake']);

    const target = roomOf({ boardRadius: 2, mapSeed: 'OLD' });
    applyRecipeStyle(target, style!);
    expect(target.settings.boardRadius).toBe(4);
    expect(target.settings.mapPicks).toEqual(['continent', 'lake']);
    expect(target.settings.mapSeed).not.toBe('STYLE1');
    expect(target.settings.mapSeed).toMatch(/^[0-9A-Z]{7}$/);
    expect(target.board.hexes).toHaveLength(61);
    expect(target.mapMeta?.recipe.seed).toBe(target.settings.mapSeed);
    expect(target.mapMeta?.edited).toBe(false);
  });

  it('a preset without a usable recipe has no style', () => {
    expect(presetStyle({})).toBeNull();
    expect(presetStyle(null)).toBeNull();
    expect(presetStyle({ recipe: 'junk' })).toBeNull();
    expect(presetStyle({ recipe: { seed: '' } })).toBeNull();
  });
});
