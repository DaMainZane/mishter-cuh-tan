import { describe, expect, it } from 'vitest';
import { fishTileOutlineMarkup } from '../src/client/render/overlay';

// Bug "fish tile outline": a sea tile that holds a fishing ground is drawn with an outline like a land tile.
// The markup is a pure function of the tile's polygon, so it is checked without a DOM.

describe('fish tile outline', () => {
  const poly = '10.0,0.0 20.0,5.0 20.0,15.0 10.0,20.0 0.0,15.0 0.0,5.0';

  it('draws the tile polygon as an unfilled outline', () => {
    const html = fishTileOutlineMarkup(poly);
    expect(html).toContain(`points="${poly}"`);
    expect(html).toContain('fill:none');
    expect(html).toMatch(/stroke:var\(--token\)/);
    expect(html).toMatch(/stroke-width:\s*[1-9]/);
  });

  it('never takes clicks (the fish and feed controls above it keep working)', () => {
    expect(fishTileOutlineMarkup(poly)).toContain('pointer-events:none');
  });

  it('draws nothing without a polygon', () => {
    expect(fishTileOutlineMarkup(undefined)).toBe('');
    expect(fishTileOutlineMarkup('')).toBe('');
  });
});
