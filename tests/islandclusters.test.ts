import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import { ISLAND_BANDS, ISLAND_MAX, ISLAND_MIN, clusterIslandSizes } from '../src/packs/base/map/clusters';
import { TIDEBOUND_MAP_PICKS } from '../src/server/lobby';
import { createRng, generateMap, hexDistance, registryFor } from '../src/shared';
import type { Board, GeneratedMap, Registry } from '../src/shared';

// Tidebound island clusters (2026-11-24): many islands of 4 to 20 tiles, about 65% small, 25% medium, 10% large, grouped in clusters with 1 or 2
// tiles of water between islands of a cluster and at least 3 between clusters. Clusters that would overlap merge into one.

const on = registryFor(allPacks, { dlc: { tidebound: true } });
const fellBack = (m: GeneratedMap) => m.report.warnings.some(w => w.code === 'shape-fallback');
const make = (reg: Registry, picks: string[], radius: number, seed: string) => generateMap(reg, reg.rules, { seed, radius, picks });

/** Islands (connected land) as lists of {q, r}. */
function islands(reg: Registry, b: Board): { q: number; r: number }[][] {
  const land = b.hexes.filter(h => reg.tiles.get(h.type)?.land);
  const key = (q: number, r: number) => q + ',' + r;
  const at = new Map(land.map(h => [key(h.q, h.r), h]));
  const seen = new Set<string>();
  const out: { q: number; r: number }[][] = [];
  for (const h of land) {
    if (seen.has(key(h.q, h.r))) continue;
    const group: { q: number; r: number }[] = [];
    const stack = [h];
    seen.add(key(h.q, h.r));
    while (stack.length) {
      const c = stack.pop()!;
      group.push({ q: c.q, r: c.r });
      for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) {
        const k = key(c.q + dq, c.r + dr);
        if (at.has(k) && !seen.has(k)) { seen.add(k); stack.push(at.get(k)!); }
      }
    }
    out.push(group);
  }
  return out;
}

/** Tiles of water between two islands (0 would mean touching). */
function gap(a: { q: number; r: number }[], b: { q: number; r: number }[]): number {
  let d = Infinity;
  for (const x of a) for (const y of b) d = Math.min(d, hexDistance(x, y));
  return d - 1;
}

/** The widest stretch of open sea: the largest distance from a water tile to the nearest land. */
function emptiestSea(reg: Registry, b: Board): number {
  const land = b.hexes.filter(h => reg.tiles.get(h.type)?.land);
  let worst = 0;
  for (const h of b.hexes) {
    if (reg.tiles.get(h.type)?.land) continue;
    let d = Infinity;
    for (const l of land) d = Math.min(d, hexDistance(h, l));
    worst = Math.max(worst, d);
  }
  return worst;
}

describe('island sizes', () => {
  it('cover the land target exactly, every island 4 to 20 tiles', () => {
    for (const total of [4, 9, 23, 93, 397, 1535]) {
      const sizes = clusterIslandSizes(createRng(total), total)!;
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(total);
      for (const s of sizes) {
        expect(s).toBeGreaterThanOrEqual(ISLAND_MIN);
        expect(s).toBeLessThanOrEqual(ISLAND_MAX);
      }
    }
    expect(clusterIslandSizes(createRng(1), 3)).toBeNull();
  });

  it('are mostly small: about 65% small, 25% medium, 10% large by count', () => {
    const sizes = clusterIslandSizes(createRng(7), 20000)!;
    const share = (lo: number, hi: number) => sizes.filter(s => s >= lo && s <= hi).length / sizes.length;
    expect(ISLAND_BANDS.map(b => b.share)).toEqual([0.65, 0.25, 0.1]);
    expect(share(4, 7)).toBeGreaterThan(0.58);
    expect(share(4, 7)).toBeLessThan(0.72);
    expect(share(8, 13)).toBeGreaterThan(0.19);
    expect(share(8, 13)).toBeLessThan(0.31);
    expect(share(14, 20)).toBeGreaterThan(0.06);
    expect(share(14, 20)).toBeLessThan(0.15);
  });
});

describe('the Tidebound map is island clusters', () => {
  it('is the default Tidebound pick, with wide water (elevation and fish)', () => {
    expect(TIDEBOUND_MAP_PICKS).toEqual(['island_clusters', 'wide_water']);
    expect(on.mapShapes.has('island_clusters')).toBe(true);
  });

  for (const radius of [7, 15]) {
    it(`at radius ${radius}: many islands of 4 to 20 tiles, clusters with 1-2 tile gaps, no fallback`, () => {
      let pairs1 = 0, pairs2 = 0, multiIslandClusters = 0, islandCount = 0, small = 0;
      for (let i = 1; i <= 6; i++) {
        const m = make(on, TIDEBOUND_MAP_PICKS, radius, `CL${radius}-${i}`);
        expect(fellBack(m), `seed CL${radius}-${i}`).toBe(false);
        const isl = islands(on, m.board);
        islandCount += isl.length;
        for (const g of isl) {
          expect(g.length).toBeGreaterThanOrEqual(ISLAND_MIN);
          expect(g.length).toBeLessThanOrEqual(ISLAND_MAX);
          if (g.length <= 7) small++;
        }
        // Link islands 1-2 tiles apart: those are the clusters. Different clusters are 3+ apart by definition, so count the links.
        const parent = isl.map((_, k) => k);
        const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
        for (let a = 0; a < isl.length; a++) {
          for (let b = a + 1; b < isl.length; b++) {
            const g = gap(isl[a], isl[b]);
            expect(g, 'islands never touch').toBeGreaterThanOrEqual(1);
            if (g === 1) pairs1++;
            if (g === 2) pairs2++;
            if (g <= 2) parent[find(a)] = find(b);
          }
        }
        const sizes = new Map<number, number>();
        for (let k = 0; k < isl.length; k++) sizes.set(find(k), (sizes.get(find(k)) ?? 0) + 1);
        for (const n of sizes.values()) if (n >= 2) multiIslandClusters++;
      }
      expect(islandCount / 6).toBeGreaterThan(radius === 7 ? 6 : 25);
      expect(small / islandCount).toBeGreaterThan(0.45);
      expect(pairs1).toBeGreaterThan(0);
      expect(pairs2).toBeGreaterThan(0);
      expect(multiIslandClusters).toBeGreaterThan(0);
    });
  }

  it('leaves less empty sea in the middle than the old few-big-islands map at radius 15', () => {
    let newer = 0, older = 0;
    for (let i = 1; i <= 3; i++) {
      newer += emptiestSea(on, make(on, TIDEBOUND_MAP_PICKS, 15, `ES${i}`).board);
      older += emptiestSea(on, make(on, ['islands', 'wide_water'], 15, `ES${i}`).board);
    }
    expect(newer).toBeLessThan(older);
  });
});
