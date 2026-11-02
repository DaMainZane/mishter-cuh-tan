import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Bug "heat map tint" (Tidebound elevation view): the three height tints must be easy to tell apart at a glance,
// in the light and the dark theme. Pure CSS check: the `--elev-N` tokens in `src/client/styles.css`.

const css = readFileSync(new URL('../src/client/styles.css', import.meta.url), 'utf8');

/** The `--elev-1` to `--elev-3` rgba tokens of one theme block (`:root` is the first block that defines them, the dark theme the second). */
function elevTokens(block: 0 | 1): { rgb: [number, number, number]; alpha: number }[] {
  const out: { rgb: [number, number, number]; alpha: number }[][] = [[], []];
  const re = /--elev-([123]):\s*rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)/g;
  let m: RegExpExecArray | null;
  let seen = 0;
  let last = 0;
  while ((m = re.exec(css))) {
    const n = Number(m[1]);
    // A new theme block starts each time the level counter goes back to 1.
    if (n === 1 && last !== 0) seen++;
    last = n;
    out[Math.min(seen, 1)].push({ rgb: [Number(m[2]), Number(m[3]), Number(m[4])], alpha: Number(m[5]) });
  }
  return out[block];
}

/** WCAG relative luminance of an sRGB colour (0 black, 1 white). */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

describe.each([
  ['light theme', 0],
  ['dark theme', 1]
] as const)('elevation heat map tint, %s', (_name, block) => {
  const levels = elevTokens(block);

  it('defines three levels', () => {
    expect(levels).toHaveLength(3);
  });

  it('is strongly opaque, so the tint is not lost over the tile colour', () => {
    for (const l of levels) expect(l.alpha).toBeGreaterThanOrEqual(0.7);
  });

  it('gets clearly darker with every height step', () => {
    for (let i = 1; i < levels.length; i++) {
      const drop = luminance(levels[i - 1].rgb) - luminance(levels[i].rgb);
      expect(drop).toBeGreaterThanOrEqual(0.15);
    }
  });

  it('ends in red at the highest level (red is highest)', () => {
    const [r, g, b] = levels[2].rgb;
    expect(r).toBeGreaterThan(g * 2);
    expect(r).toBeGreaterThan(b * 2);
  });
});
