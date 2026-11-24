import { describe, expect, it } from 'vitest';
import {
  BASELINE_SPOTS, GEN_VERSION, REAL_NUMBER_POOL, buildTopology, cellPoint, classifyCells, cleanSeed, createNoise, createRng,
  decodeRecipe, encodeRecipe, estimateVertices, findLandmasses, generateBoard, generateMap, makeRecipe, newSeedText, pipsOf,
  stageRng, validateBoard
} from '../src/shared';
import type { HexInit } from '../src/shared';
import { defaultSettings, fullRules, registry } from '../src/server/runtime';

const rulesFor = (over: Record<string, any> = {}) => fullRules({ ...defaultSettings(), ...over });
const isLand = (t: string) => t !== 'water';

/** Hand-made board on a radius `radius` canvas: `land(q, r)` decides which cells are wood, the rest are water. */
function handBoard(radius: number, land: (q: number, r: number) => boolean) {
  const inits: HexInit[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      inits.push({ q, r, type: land(q, r) ? 'wood' : 'water', number: null });
    }
  }
  return buildTopology(inits, { isLand });
}

describe('stage RNG', () => {
  it('is deterministic and separate per stage and attempt', () => {
    expect(stageRng('ABC', 'terrain').s).toBe(stageRng('ABC', 'terrain').s);
    expect(stageRng('ABC', 'terrain').s).not.toBe(stageRng('ABC', 'numbers').s);
    expect(stageRng('ABC', 'terrain', 0).s).not.toBe(stageRng('ABC', 'terrain', 1).s);
    expect(stageRng('ABC', 'terrain').s).not.toBe(stageRng('ABD', 'terrain').s);
  });
});

describe('noise', () => {
  it('stays in 0..1 and repeats for the same seed', () => {
    const a = createNoise('seed-a');
    const b = createNoise('seed-a');
    const c = createNoise('seed-b');
    let differs = false;
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37 - 20;
      const y = i * 0.11 + 3;
      const v = a(x, y, 4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(b(x, y, 4)).toBe(v);
      if (c(x, y, 4) !== v) differs = true;
    }
    expect(differs).toBe(true);
  });

  it('is smooth: neighbouring samples are close', () => {
    const n = createNoise(7);
    for (let i = 0; i < 100; i++) {
      expect(Math.abs(n(i * 0.5, 2, 1) - n(i * 0.5 + 0.01, 2, 1))).toBeLessThan(0.05);
    }
  });

  it('cellPoint puts neighbouring cells one unit apart', () => {
    const o = cellPoint(0, 0);
    for (const [q, r] of [[1, 0], [0, 1], [-1, 1]]) {
      const p = cellPoint(q, r);
      expect(Math.abs(Math.sqrt((p.x - o.x) ** 2 + (p.y - o.y) ** 2) - 1)).toBeLessThan(1e-9);
    }
  });
});

describe('recipe', () => {
  it('cleans seeds', () => {
    expect(cleanSeed('  7k3f9q2 ')).toBe('7K3F9Q2');
    expect(cleanSeed('catan night!')).toBe('catan-night');
    expect(cleanSeed('')).toBe('');
    expect(cleanSeed('x'.repeat(100))).toHaveLength(32);
    expect(newSeedText()).toMatch(/^[0-9A-Z]{7}$/);
  });

  it('round-trips through the share code', () => {
    const r = makeRecipe({ seed: '7K3F9Q2', radius: 4, picks: ['continent', 'lake', 'fog'], params: { land: 70, 'islands.count': 3 } });
    const code = encodeRecipe(r);
    expect(code).toBe(`hx1;g=${GEN_VERSION};r=4;picks=continent+lake+fog;islands.count=3;land=70;seed=7K3F9Q2`);
    const back = decodeRecipe(code);
    expect(back?.recipe).toEqual(r);
    expect(back?.dropped).toEqual([]);
  });

  it('clamps, dedupes and drops what it does not know', () => {
    const r = makeRecipe({ seed: 'abc', radius: 999, picks: ['a', 'a', 'b c', 'd'], params: { land: NaN, ok: 5, seed: 1 } });
    expect(r.radius).toBe(30); // the map radius setting is capped at 30 (wide water may still grow the canvas past it)
    expect(r.picks).toEqual(['a', 'd']);
    expect(r.params).toEqual({ ok: 5 });
    const d = decodeRecipe('hx1;r=0;picks=a+zzz;nope=1;seed=ABC', id => id === 'a');
    expect(d?.recipe.radius).toBe(1);
    expect(d?.recipe.picks).toEqual(['a']);
    expect(d?.dropped.sort()).toEqual(['nope', 'zzz']);
  });

  it('rejects things that are not codes', () => {
    expect(decodeRecipe('hello')).toBeNull();
    expect(decodeRecipe('hx2;seed=ABC')).toBeNull();
    expect(decodeRecipe('hx1;r=3')).toBeNull();
  });
});

describe('mapcheck helpers', () => {
  it('pipsOf matches the dice', () => {
    expect([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(pipsOf)).toEqual([1, 2, 3, 4, 5, 0, 5, 4, 3, 2, 1]);
    expect(pipsOf(null)).toBe(0);
  });

  it('finds separate landmasses', () => {
    // A: the center and its ring. B: two cells far out on the east side, with water between.
    const inA = (q: number, r: number) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 1;
    const board = handBoard(3, (q, r) => inA(q, r) || (q === 3 && r === 0) || (q === 2 && r === 1));
    const lm = findLandmasses(board, h => isLand(h.type));
    expect([...lm.landmassSize].sort((a, b) => a - b)).toEqual([2, 7]);
    expect(lm.landCount).toBe(9);
  });

  it('tells lakes from ocean', () => {
    const lake = handBoard(2, (q, r) => !(q === 0 && r === 0));
    const c1 = classifyCells(lake, h => isLand(h.type));
    expect(c1.lakes).toBe(1);
    expect(c1.kind[lake.hexes.findIndex(h => h.q === 0 && h.r === 0)]).toBe('lake');

    const bay = handBoard(2, (q, r) => !(q === 2 && r === 0));
    const c2 = classifyCells(bay, h => isLand(h.type));
    expect(c2.lakes).toBe(0);
    expect(c2.kind[bay.hexes.findIndex(h => h.q === 2 && h.r === 0)]).toBe('ocean');
  });

  it('vertex estimate 2L + B/2 + C - h holds', () => {
    const cases: [number, (q: number, r: number) => boolean][] = [
      [2, () => true],
      [2, (q, r) => !(q === 0 && r === 0)],
      [3, (q, r) => (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 1) || (q === 3 && r === 0) || (q === 2 && r === 1)]
    ];
    for (const [radius, land] of cases) {
      const board = handBoard(radius, land);
      const lm = findLandmasses(board, h => isLand(h.type));
      const { lakes } = classifyCells(board, h => isLand(h.type));
      const coast = board.edges.filter(e => e.hexIds.length === 1).length;
      expect(estimateVertices(lm.landCount, coast, lm.landmassSize.length, lakes)).toBe(board.vertices.length);
    }
  });
});

describe('generateMap (classic pipeline)', () => {
  const rules = rulesFor();
  const make = (seed: string, over: Record<string, any> = {}) => generateMap(registry, rulesFor(over), { seed });
  const signature = (b: ReturnType<typeof make>['board']) => b.hexes.map(h => `${h.q},${h.r}:${h.type}:${h.number}`).join('|') + '#' +
    b.edges.filter(e => e.port).map(e => `${e.key}=${e.port}`).sort().join(',');

  it('is deterministic: same recipe, same board', () => {
    const a = make('7K3F9Q2');
    const b = make('7K3F9Q2');
    expect(signature(a.board)).toBe(signature(b.board));
    expect(a.report).toEqual(b.report);
    expect(a.recipe.seed).toBe('7K3F9Q2');
  });

  it('different seeds give different boards', () => {
    const sigs = new Set(['AAAAAAA', 'BBBBBBB', 'CCCCCCC', 'DDDDDDD', 'EEEEEEE'].map(s => signature(make(s).board)));
    expect(sigs.size).toBeGreaterThan(1);
  });

  it('standard board matches the known numbers', () => {
    const { board, report } = make('STANDARD');
    expect(board.hexes).toHaveLength(19);
    expect(board.vertices).toHaveLength(54);
    expect(board.edges).toHaveLength(72);
    expect(report.stats.vertices).toBe(54);
    expect(report.stats.land).toBe(19);
    expect(report.stats.landmasses).toEqual([19]);
    expect(report.stats.lakes).toBe(0);
    // The plain hexagon gets the real count: a harbor on every second sea tile of the frame = 9 ports (layout checked in ports.test.ts).
    expect(report.stats.ports).toBe(9);
    expect(report.stats.genVersion).toBe(GEN_VERSION);
    expect(report.stats.spots).toBeGreaterThanOrEqual(BASELINE_SPOTS);
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it('keeps the tile counts and the real token pool', () => {
    const { board } = make('POOL');
    const old = generateBoard(registry, rules, createRng(1));
    const count = (b: typeof board) => b.hexes.map(h => h.type).sort().join(',');
    expect(count(board)).toBe(count(old));
    const tokens = board.hexes.map(h => h.number).filter((n): n is number => n != null).sort((a, b) => a - b);
    expect(tokens).toEqual([...REAL_NUMBER_POOL].sort((a, b) => a - b));
    expect(board.hexes[board.robberHexId].type).toBe('desert');
  });

  it('has the right size and no errors over many seeds and radii', () => {
    for (const radius of [1, 2, 3, 4, 6]) {
      for (let i = 0; i < 12; i++) {
        const { board, report } = make(`S${radius}-${i}`, { boardRadius: radius });
        expect(board.hexes).toHaveLength(1 + 3 * radius * (radius + 1));
        expect(report.stats.land).toBe(board.hexes.length);
        expect(report.errors.filter(e => e.code !== 'too-few-spots')).toEqual([]);
        expect(report.stats.vertices).toBe(6 * (radius + 1) ** 2);
      }
    }
  });

  it('radius comes from the rules unless the recipe says otherwise', () => {
    expect(generateMap(registry, rulesFor({ boardRadius: 3 }), { seed: 'R' }).board.hexes).toHaveLength(37);
    expect(generateMap(registry, rulesFor({ boardRadius: 3 }), { seed: 'R', radius: 1 }).board.hexes).toHaveLength(7);
  });

  it('a missing seed gets a random one that is returned', () => {
    const { recipe } = generateMap(registry, rules, {});
    expect(recipe.seed).toMatch(/^[0-9A-Z]{7}$/);
  });

  it('reports picks it cannot use instead of failing', () => {
    const { report } = generateMap(registry, rules, { seed: 'X', picks: ['hexagon', 'bogus'] });
    expect(report.warnings.some(w => w.code === 'pick-ignored' && w.message.includes('bogus'))).toBe(true);
    expect(report.warnings.some(w => w.message.includes('hexagon'))).toBe(false);
  });

  it('a later pick in the same slot replaces the earlier one and says so', () => {
    const { report } = generateMap(registry, rules, { seed: 'X', picks: ['hexagon', 'continent'] });
    expect(report.warnings.some(w => w.code === 'pick-ignored' && w.message.includes('hexagon'))).toBe(true);
    expect(report.warnings.some(w => w.message.includes('continent'))).toBe(false);
  });

  it('validateBoard flags split land and a missing resource', () => {
    const split = handBoard(3, (q, r) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 1 || (q === 3 && r === 0));
    const report = validateBoard(split, registry);
    expect(report.warnings.some(w => w.code === 'split-land')).toBe(true);
    expect(report.errors.some(e => e.code === 'landmass-too-small')).toBe(true);
    expect(report.errors.some(e => e.code === 'token-mismatch')).toBe(true);
  });
});
