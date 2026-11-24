import { describe, expect, it } from 'vitest';
import { renderPiratesMarkup } from '../src/client/render/pirates';
import {
  PIRATE_HEADS,
  PIRATE_ICON_RADIUS,
  pirateIconMarkup,
  pirateLook
} from '../src/client/pirateIcon';

const IDS = Array.from({ length: 400 }, (_, i) => `pirate-${i + 1}`);

describe('Bug 6: the pirate icon is a sail with a head glyph', () => {
  it('gives the same look for the same id every time (UI only, no game state)', () => {
    for (const id of IDS.slice(0, 20)) expect(pirateLook(id)).toEqual(pirateLook(id));
  });

  it('only picks a head from the supplied list', () => {
    for (const id of IDS) expect(PIRATE_HEADS).toContain(pirateLook(id).head);
  });

  it('uses every head across many pirates', () => {
    const looks = IDS.map(pirateLook);
    for (const head of PIRATE_HEADS) expect(looks.some((l) => l.head === head)).toBe(true);
  });

  it('draws the sail and exactly one glyph, not mirrored', () => {
    const svg = pirateIconMarkup(pirateLook('pirate-1'));
    expect(svg).toContain('class="pirate-face"');
    expect(svg.match(/class="pirate-glyph"/g)).toHaveLength(1);
    expect(svg).not.toMatch(/scale\(-/);
  });

  it('does not carry the black background square of the supplied SVG files', () => {
    expect(pirateIconMarkup(pirateLook('pirate-2'))).not.toContain('M0 0h512v512H0z');
  });

  it('the board layer draws the new icon for every pirate, the same one each redraw, with the strength badge kept', () => {
    const pirates = [
      { id: 'p1', hexId: 0, strength: 2, mode: 'roam' },
      { id: 'p2', hexId: 1, strength: 5, mode: 'flee' }
    ];
    const hexes = [
      { id: 0, x: 100, y: 200 },
      { id: 1, x: 300, y: 200 }
    ];
    const first = renderPiratesMarkup(pirates, hexes, []);
    expect(renderPiratesMarkup(pirates, hexes, [])).toBe(first);
    expect(first.match(/class="pirate-face"/g)).toHaveLength(2);
    expect(first.match(/class="pirate-glyph"/g)).toHaveLength(2);
    expect(first).not.toContain('pirate-hull');
    expect(first).not.toContain('pirate-sail');
    expect(first).toContain('class="pirate-badge-text"');
    expect(first).toContain('>2</text>');
    expect(first).toContain('>5</text>');
  });

  it('puts the drive-off ring around the bigger badge and scales with zoom (.piece-zoom-scale)', () => {
    const svg = renderPiratesMarkup([{ id: 'p1', hexId: 0, strength: 1, mode: 'roam' }], [{ id: 0, x: 0, y: 0 }], [0]);
    const r = Number(/class="pirate-ring"[^>]*\sr="([\d.]+)"/.exec(svg)?.[1]);
    expect(r).toBeGreaterThan(PIRATE_ICON_RADIUS);
    expect(svg).toContain('class="piece-zoom-scale"');
  });

  it('is about 1.5x the old ship, which was 34 units wide', () => {
    const ratio = (PIRATE_ICON_RADIUS * 2) / 34;
    expect(ratio).toBeGreaterThan(1.4);
    expect(ratio).toBeLessThan(1.7);
  });
});
