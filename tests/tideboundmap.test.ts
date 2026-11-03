import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import { createNoise, createRegistry, createRng, findLandmasses, generateMap, hexDistance, registryFor } from '../src/shared';
import type { Board, GeneratedMap, Hex, Registry } from '../src/shared';
import { canvasCoords, canvasRadiusFor, centersTooClose, createLandField, gapRoom, seaGrow, wideGap } from '../src/shared/mapshape';
import type { HexInit } from '../src/shared/topology';
import {
  ELEVATION_2_FROM, ELEVATION_3_FROM, FISH_BOOSTS, FISH_SHARE_OPEN, FISH_SHARE_SHORE, applyElevation, elevationOf, placeFish
} from '../src/packs/tidebound/seaData';

// T2a/T2b: the Tidebound wide-water perk. Data only: the shape stage reads the `water.extra` param. Seas and rivers get wider, the canvas grows
// around the normal map to make room (the land count stays what the radius gives), and a pick that is not ticked changes nothing. The perk lives
// in the `tidebound.bridges` addon, so it exists only while the DLC is on. The lobby reaches it through the room's DLC-aware registry (T2a2,
// `tests/tideboundlobby.test.ts`). T2b2 and T2c (the `sea data` blocks at the end): the same perk writes `ext.elevation` on land and
// `ext.fish` on sea tiles, with no RNG draws.

const on = registryFor(allPacks, { dlc: { tidebound: true } });
const off = createRegistry(allPacks);

const canvasSize = (r: number) => 3 * r * (r + 1) + 1;
const isLandHex = (h: Hex) => !!on.tiles.get(h.type)?.land;
const fellBack = (m: GeneratedMap) => m.report.warnings.some(w => w.code === 'shape-fallback');
const sig = (b: Board) => b.hexes.map(h => `${h.q},${h.r}:${h.type}:${h.number}:${h.ext.hidden ? 1 : 0}:${h.ext.river ? 1 : 0}`).join('|');
const seeds = (n: number) => Array.from({ length: n }, (_, i) => `W${i + 1}`);
const make = (reg: Registry, picks: string[], radius: number, seed: string, params: Record<string, number> = {}) =>
  generateMap(reg, reg.rules, { seed, radius, picks, params });

describe('the wide-water perk is part of Tidebound', () => {
  it('exists only while the DLC and the bridges addon are on', () => {
    expect(on.mapPerks.has('wide_water')).toBe(true);
    expect(off.mapPerks.has('wide_water')).toBe(false);
    const noBridges = registryFor(allPacks, { dlc: { tidebound: true }, addons: { 'tidebound.bridges': false } });
    expect(noBridges.mapPerks.has('wide_water')).toBe(false);
    expect(registryFor(allPacks, {}).mapPerks.has('wide_water')).toBe(false);
  });

  it('declares the water.extra param (1 to 5, default 4) and conflicts with the hexagon', () => {
    const perk = on.mapPerks.get('wide_water')!;
    expect(perk.stage).toBe('extras');
    expect(perk.conflicts).toContain('hexagon');
    expect(perk.params).toEqual([{ id: 'water.extra', label: 'Extra water width (tiles)', min: 1, max: 5, step: 1, default: 4 }]);
  });
});

describe('without the pick nothing changes', () => {
  it('the same recipe gives the same map and report with or without the DLC registered', () => {
    for (const picks of [[], ['continent'], ['islands'], ['archipelago'], ['continents'], ['ring'], ['continent', 'river'], ['islands', 'river', 'satellites']]) {
      for (const radius of [4, 6]) {
        const a = make(on, picks, radius, 'SAME1');
        const b = make(off, picks, radius, 'SAME1');
        expect(sig(a.board), `${picks.join('+')} r${radius}`).toBe(sig(b.board));
        expect(a.report, `${picks.join('+')} r${radius}`).toEqual(b.report);
      }
    }
  });
});

describe('wide water: the canvas grows, the land does not', () => {
  it('canvasRadiusFor adds the sea rings (4 extra = 6), caps at the radius limit, and does nothing without the pick', () => {
    expect(seaGrow(0)).toBe(0);
    expect(seaGrow(4)).toBe(6);
    expect(seaGrow(5)).toBe(8);
    expect(canvasRadiusFor(3, 0)).toBe(3);
    expect(canvasRadiusFor(3, 4)).toBe(9);
    expect(canvasRadiusFor(49, 4)).toBe(50);
  });

  it('a continent keeps the exact land count of the normal map and the canvas gains the sea rings', () => {
    for (const seed of seeds(4)) {
      const plain = make(on, ['continent'], 8, seed);
      const wide = make(on, ['continent', 'wide_water'], 8, seed);
      if (fellBack(plain) || fellBack(wide)) continue;
      expect(plain.report.stats.land, seed).toBe(Math.round((canvasSize(8) * 70) / 100));
      expect(wide.report.stats.land, seed).toBe(plain.report.stats.land);
      // Default extra 4: 6 rings of sea around the normal map.
      expect(wide.board.hexes, seed).toHaveLength(canvasSize(canvasRadiusFor(8, 4)));
    }
  });

  it('a standard-size board gets its sea too: radius 3 keeps its land and grows the canvas', () => {
    let checked = 0;
    for (const seed of seeds(4)) {
      const m = make(on, ['continent', 'wide_water'], 3, seed);
      if (fellBack(m)) continue;
      checked++;
      expect(m.report.stats.land, seed).toBe(Math.round((canvasSize(3) * 70) / 100));
      expect(m.board.hexes, seed).toHaveLength(canvasSize(9));
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('the param is clamped to 5 and read from the recipe: it sets the canvas, never the land', () => {
    const m = make(on, ['continent', 'wide_water'], 8, 'CLAMP1', { 'water.extra': 99 });
    if (!fellBack(m)) {
      expect(m.board.hexes).toHaveLength(canvasSize(canvasRadiusFor(8, 5)));
      expect(m.report.stats.land).toBe(Math.round((canvasSize(8) * 70) / 100));
    }
    const mild = make(on, ['continent', 'wide_water'], 8, 'CLAMP1', { 'water.extra': 1 });
    if (!fellBack(mild)) {
      expect(mild.board.hexes).toHaveLength(canvasSize(canvasRadiusFor(8, 1)));
      expect(mild.report.stats.land).toBe(Math.round((canvasSize(8) * 70) / 100));
    }
  });

  it('the same recipe gives the same map twice', () => {
    for (const picks of [['continent', 'wide_water'], ['islands', 'wide_water'], ['continents', 'wide_water'], ['continent', 'river', 'wide_water']]) {
      const a = make(on, picks, 8, 'REPLAY');
      const b = make(on, picks, 8, 'REPLAY');
      expect(sig(a.board), picks.join('+')).toBe(sig(b.board));
      expect(a.report).toEqual(b.report);
    }
  });
});

describe('wide water: wider gaps between landmasses', () => {
  const minGap = (m: GeneratedMap): number => {
    const land = findLandmasses(m.board, isLandHex);
    const hexes = m.board.hexes;
    let best = Infinity;
    for (let i = 0; i < hexes.length; i++) {
      if (land.landOfHex[i] < 0) continue;
      for (let j = i + 1; j < hexes.length; j++) {
        if (land.landOfHex[j] < 0 || land.landOfHex[j] === land.landOfHex[i]) continue;
        best = Math.min(best, hexDistance(hexes[i], hexes[j]));
      }
    }
    return best;
  };

  it('islands keep more water between them (a normal map keeps 1 tile), now on a standard-size board too', () => {
    let checked = 0;
    for (const radius of [4, 10, 12]) {
      for (const seed of seeds(4)) {
        const m = make(on, ['islands', 'wide_water'], radius, seed);
        if (fellBack(m)) continue;
        if (m.report.stats.landmasses.length < 2) continue;
        checked++;
        // Land of different islands is at least gap + 1 apart; the plain gap is 1, so 3 or more means the pick did something.
        expect(minGap(m), `islands r${radius} ${seed}`).toBeGreaterThanOrEqual(3);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('continents add the extra to their own gap where the canvas has room (default 2 -> at least 3 tiles of water)', () => {
    let checked = 0;
    for (const radius of [12, 14]) {
      for (const seed of seeds(4)) {
        const m = make(on, ['continents', 'wide_water'], radius, seed);
        if (fellBack(m)) continue;
        if (m.report.stats.landmasses.length < 2) continue;
        checked++;
        // Land of different continents is at least gap + 1 apart; the plain gap is 2 (3 apart), so 4 or more means the pick did something.
        expect(minGap(m), `continents r${radius} ${seed}`).toBeGreaterThanOrEqual(4);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('big boards rarely fall back to the plain hexagon with the perk on (the reasons are listed when they do)', () => {
    const misses: string[] = [];
    let total = 0;
    for (const shape of ['continent', 'islands', 'archipelago', 'continents']) {
      for (const radius of [4, 8, 10, 12]) {
        for (const seed of seeds(4)) {
          total++;
          const m = make(on, [shape, 'wide_water'], radius, seed);
          const fell = m.report.warnings.find(w => w.code === 'shape-fallback');
          if (fell) misses.push(`${shape} r${radius} ${seed}: ${fell.message}`);
        }
      }
    }
    // A bound for the starting numbers. If it fails, read the listed reasons before loosening it: they say which shape runs out of room.
    expect(misses.length / total, `${misses.length}/${total} fell back\n${misses.slice(0, 12).join('\n')}`).toBeLessThanOrEqual(0.4);
  });
});

describe('wide water: wider rivers', () => {
  it('a river takes more water tiles, stays water, and the land stays in one piece', () => {
    let plainRiver = 0;
    let wideRiver = 0;
    let checked = 0;
    for (const seed of seeds(6)) {
      const plain = make(on, ['continent', 'river'], 8, seed);
      const wide = make(on, ['continent', 'river', 'wide_water'], 8, seed);
      if (fellBack(plain) || fellBack(wide)) continue;
      checked++;
      const river = wide.board.hexes.filter(h => h.ext.river);
      for (const h of river) expect(isLandHex(h), seed).toBe(false);
      expect(wide.report.stats.landmasses, seed).toHaveLength(1);
      plainRiver += plain.board.hexes.filter(h => h.ext.river).length;
      wideRiver += river.length;
    }
    expect(checked).toBeGreaterThan(0);
    expect(wideRiver).toBeGreaterThan(plainRiver);
  });
});

describe('wide water: picks and warnings', () => {
  it('ticking the hexagon after the perk drops the perk, and the perk after the hexagon replaces it', () => {
    const a = make(on, ['wide_water', 'hexagon'], 6, 'HEX1');
    expect(a.report.warnings.filter(w => w.code === 'pick-ignored').map(w => w.message).join(' ')).toContain('wide_water');
    expect(a.report.stats.land).toBe(canvasSize(6));

    const b = make(on, ['hexagon', 'wide_water'], 6, 'HEX2');
    expect(b.report.warnings.filter(w => w.code === 'pick-ignored').map(w => w.message).join(' ')).toContain('hexagon');
    if (!fellBack(b)) expect(b.report.stats.land).toBeLessThan(canvasSize(6));
  });

  it('only the radius cap holds the sea back: no warning on a small board', () => {
    const small = make(on, ['continent', 'wide_water'], 3, 'SMALL1');
    expect(small.report.warnings.some(w => w.code === 'wide-water-small')).toBe(false);
    // No pick, no warning.
    expect(make(on, ['continent'], 3, 'SMALL2').report.warnings.some(w => w.code === 'wide-water-small')).toBe(false);
  });

  it('never throws, whatever the shape and radius', () => {
    for (const shape of ['continent', 'ring', 'islands', 'archipelago', 'continents']) {
      for (const extra of [1, 5]) {
        for (const radius of [1, 2, 3, 12]) {
          const m = make(on, [shape, 'river', 'satellites', 'wide_water'], radius, 'EDGE', { 'water.extra': extra });
          // A failed shape falls back to the plain hexagon of the normal size, not of the grown canvas.
          const want = fellBack(m) ? radius : canvasRadiusFor(radius, extra);
          expect(m.board.hexes, `${shape} r${radius} x${extra}`).toHaveLength(canvasSize(want));
          expect(m.report.stats.land).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('land field helpers for wide water', () => {
  const field = (radius: number) => createLandField(radius, createNoise('T'), createRng('T'));

  it('wideGap hands back its input while no wide-water pick is on', () => {
    const f = field(10);
    expect(f.seaExtra).toBe(0);
    expect(wideGap(f, 1, 7, 109, 2)).toEqual({ k: 7, gap: 1 });
    expect(wideGap(f, 3, 4, 40, 2)).toEqual({ k: 4, gap: 3 });
  });

  it('wideGap adds the extra when the canvas has room, and drops landmasses before it gives up the gap', () => {
    const roomy = field(14);
    roomy.seaExtra = 4;
    expect(wideGap(roomy, 1, 3, 100, 2)).toEqual({ k: 3, gap: 5 });

    const tight = field(10);
    tight.seaExtra = 4;
    const fit = wideGap(tight, 1, 7, 109, 2);
    expect(fit.k).toBeLessThan(7);
    expect(fit.k).toBeGreaterThanOrEqual(2);
    expect(fit.gap).toBeGreaterThanOrEqual(1);
    expect(fit.gap).toBeLessThanOrEqual(5);

    const tiny = field(4);
    tiny.seaExtra = 4;
    expect(wideGap(tiny, 1, 5, 30, 2)).toEqual({ k: 2, gap: 1 });
  });

  it('gapRoom shrinks as landmasses or land grow', () => {
    const f = field(12);
    expect(gapRoom(f, 2, 80)).toBeGreaterThanOrEqual(gapRoom(f, 6, 80));
    expect(gapRoom(f, 3, 60)).toBeGreaterThanOrEqual(gapRoom(f, 3, 200));
    expect(gapRoom(f, 1, 300)).toBe(12);
  });

  it('centersTooClose compares every pair against gap + 2', () => {
    const f = field(6);
    const a = f.at(0, 0);
    const b = f.at(3, 0);
    expect(centersTooClose(f, [a, b], 1)).toBe(false);
    expect(centersTooClose(f, [a, b], 2)).toBe(true);
    expect(centersTooClose(f, [a], 5)).toBe(false);
  });
});

// T2b2 and T2c: the same perk writes the sea data later chunks read. `ext.elevation` 1 to 3 on land (higher is rarer, by ranked height) and
// `ext.fish` on seeded sea tiles. Data only, no RNG draws, and nothing at all without the pick.
describe('sea data: elevation', () => {
  it('elevationOf: 1 below 0.65, 2 from 0.65, 3 from 0.9', () => {
    expect(ELEVATION_2_FROM).toBe(0.65);
    expect(ELEVATION_3_FROM).toBe(0.9);
    for (const [h, want] of [[0, 1], [0.3, 1], [0.649, 1], [0.65, 2], [0.8, 2], [0.899, 2], [0.9, 3], [1, 3]] as const) {
      expect(elevationOf(h), `h=${h}`).toBe(want);
    }
  });

  it('applyElevation matches cells by position (not order), skips water, and keeps other ext keys', () => {
    const inits: HexInit[] = [
      { q: 0, r: 0, type: 'wood', number: 6, ext: { keep: 1 } },
      { q: 1, r: 0, type: 'water', number: null, ext: {} },
      { q: 0, r: 1, type: 'ore', number: 8 },
      { q: -1, r: 1, type: 'brick', number: 5, ext: {} }
    ];
    const cells = [
      { q: -1, r: 1, h: 0.95, m: 0.5, coastDist: 0, landmass: 0 },
      { q: 0, r: 1, h: 0.7, m: 0.5, coastDist: 0, landmass: 0 },
      { q: 0, r: 0, h: 0.1, m: 0.5, coastDist: 0, landmass: 0 }
    ];
    applyElevation(inits, cells);
    expect(inits[0].ext).toEqual({ keep: 1, elevation: 1 });
    expect(inits[1].ext).toEqual({});
    expect(inits[2].ext).toEqual({ elevation: 2 });
    expect(inits[3].ext).toEqual({ elevation: 3 });
  });

  it('with the pick, every land hex has elevation 1 to 3 and nothing else does; higher is rarer', () => {
    let checked = 0;
    for (const seed of seeds(4)) {
      const m = make(on, ['continent', 'wide_water'], 8, seed);
      if (fellBack(m)) continue;
      checked++;
      const count = [0, 0, 0, 0];
      for (const h of m.board.hexes) {
        if (isLandHex(h)) {
          expect([1, 2, 3], `${seed} ${h.q},${h.r}`).toContain(h.ext.elevation);
          count[h.ext.elevation]++;
        } else {
          expect(h.ext.elevation, `${seed} water ${h.q},${h.r}`).toBeUndefined();
        }
      }
      expect(count[3], seed).toBeGreaterThan(0);
      expect(count[3], seed).toBeLessThan(count[2]);
      expect(count[2], seed).toBeLessThan(count[1]);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('works on every shape and gives the same data for the same recipe', () => {
    for (const shape of ['continent', 'ring', 'islands', 'archipelago', 'continents']) {
      const a = make(on, [shape, 'river', 'wide_water'], 8, 'ELEV1');
      const b = make(on, [shape, 'river', 'wide_water'], 8, 'ELEV1');
      const data = (m: GeneratedMap) => m.board.hexes.map(h => `${h.ext.elevation ?? '-'}${h.ext.fish ?? '-'}`).join('');
      expect(data(a), shape).toBe(data(b));
      for (const h of a.board.hexes) if (isLandHex(h)) expect([1, 2, 3], shape).toContain(h.ext.elevation);
    }
  });
});

describe('sea data: fish', () => {
  const landId = [...on.tiles.values()].find(t => t.land)!.id;
  /** A radius-4 canvas: land in rings 0 and 1, sea beyond (ring 2 touches land, rings 3 and 4 are open sea). */
  const canvas = (): HexInit[] =>
    canvasCoords(4).map(c => ({
      q: c.q, r: c.r, number: null, ext: {},
      type: hexDistance(c, { q: 0, r: 0 }) <= 1 ? landId : 'water'
    }));
  const ringOf = (h: HexInit) => hexDistance(h, { q: 0, r: 0 });
  const ctx = () => ({ reg: on, noise: createNoise('FISH'), rng: createRng('R') }) as any;

  it('shares are fixed counts: shore sea 17.5%, open sea 5.6%, fish only on sea, none on land or river', () => {
    const inits = canvas();
    // One ring-2 tile is a river channel: not sea for fish.
    const river = inits.find(h => ringOf(h) === 2)!;
    river.ext = { river: true };
    placeFish(inits, ctx());
    const fish = inits.filter(h => h.ext?.fish !== undefined);
    for (const h of fish) {
      expect(h.ext!.fish).toBe(FISH_BOOSTS);
      expect(h.type).toBe('water');
      expect(h.ext!.river).toBeUndefined();
    }
    const shoreN = inits.filter(h => ringOf(h) === 2 && !h.ext?.river).length;
    const openN = inits.filter(h => ringOf(h) >= 3).length;
    expect(shoreN).toBe(11);
    expect(fish.filter(h => ringOf(h) === 2)).toHaveLength(Math.round(shoreN * FISH_SHARE_SHORE));
    expect(fish.filter(h => ringOf(h) >= 3)).toHaveLength(Math.round(openN * FISH_SHARE_OPEN));
    expect(fish.filter(h => ringOf(h) <= 1)).toHaveLength(0);
    expect(river.ext!.fish).toBeUndefined();
  });

  it('fish are 30% rarer than the first tuning (shore 25% -> 17.5%, open 8% -> 5.6%), so they only hint at where a net pays off', () => {
    expect(FISH_SHARE_SHORE).toBeCloseTo(0.25 * 0.7, 10);
    expect(FISH_SHARE_OPEN).toBeCloseTo(0.08 * 0.7, 10);
  });

  it('draws no RNG (the stage stream is untouched), and the same noise gives the same tiles', () => {
    const a = canvas();
    const c = ctx();
    const before = c.rng.s;
    placeFish(a, c);
    expect(c.rng.s).toBe(before);
    const b = canvas();
    placeFish(b, ctx());
    expect(a.map(h => h.ext?.fish ?? 0)).toEqual(b.map(h => h.ext?.fish ?? 0));
    // Another seed's noise picks other tiles (same counts).
    const d = canvas();
    placeFish(d, { ...ctx(), noise: createNoise('OTHER') });
    expect(d.filter(h => h.ext?.fish).length).toBe(a.filter(h => h.ext?.fish).length);
    expect(d.map(h => h.ext?.fish ?? 0)).not.toEqual(a.map(h => h.ext?.fish ?? 0));
  });

  it('with the pick, fish sit on sea tiles only, at a sensible density', () => {
    let checked = 0;
    for (const seed of seeds(4)) {
      const m = make(on, ['continent', 'river', 'wide_water'], 8, seed);
      if (fellBack(m)) continue;
      checked++;
      let sea = 0;
      let fish = 0;
      for (const h of m.board.hexes) {
        if (h.ext.fish !== undefined) {
          fish++;
          expect(h.ext.fish, seed).toBe(FISH_BOOSTS);
          expect(isLandHex(h), seed).toBe(false);
          expect(h.ext.river, seed).toBeUndefined();
        }
        if (!isLandHex(h) && !h.ext.river) sea++;
      }
      expect(fish, seed).toBeGreaterThan(0);
      expect(fish / sea, seed).toBeGreaterThan(0.05);
      expect(fish / sea, seed).toBeLessThan(0.4);
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('sea data: nothing without the pick', () => {
  it('no hex carries elevation or fish, with the DLC registered or not', () => {
    for (const reg of [on, off]) {
      for (const picks of [[], ['continent'], ['islands', 'river'], ['archipelago']]) {
        const m = make(reg, picks, 6, 'NODATA');
        for (const h of m.board.hexes) {
          expect(h.ext.elevation, picks.join('+')).toBeUndefined();
          expect(h.ext.fish, picks.join('+')).toBeUndefined();
        }
      }
    }
  });

  it('the same recipe gives the same tiles, numbers and ports twice (the data adds no draws)', () => {
    // The perk only adds ext keys and draws nothing, so a second build of the recipe is identical down to the ports.
    const a = make(on, ['continent', 'wide_water'], 8, 'STRIP');
    const b = make(on, ['continent', 'wide_water'], 8, 'STRIP');
    expect(sig(a.board)).toBe(sig(b.board));
    expect(a.board.edges.map(e => e.port ?? '-').join('')).toBe(b.board.edges.map(e => e.port ?? '-').join(''));
  });
});
