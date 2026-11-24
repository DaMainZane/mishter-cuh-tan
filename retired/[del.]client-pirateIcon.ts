// MODULE: Pirate icon: a sail with a head glyph, picked by a hash of the pirate id; pure markup, no game state | DEPENDS ON: none | USED BY: client/render/pirates
// Glyph paths come from the supplied game-icon SVGs (512 x 512 boxes, background square removed).

export const PIRATE_HEADS = ['skull', 'bladeBite'] as const;

export type PirateHead = (typeof PIRATE_HEADS)[number];
export type PiratePart = PirateHead;

/** The slots of one pirate icon. Only the head for now. */
export interface PirateLook {
  head: PirateHead;
}

const PART_PATHS: Record<PiratePart, string> = {
  skull: 'M255.95 19.2c-58.685 0-101.737 17.664-132.97 45.68 48.263 68.21 113.714 107.422 171.94 118.15 32.58 6 62.737 3.08 86.443-8.014 23.35-10.928 40.7-29.45 49.282-56.862-5.45-10.763-11.76-20.916-18.997-30.29-31.994-41.443-81.43-68.663-155.7-68.663zM109.587 78.298a183.738 183.738 0 0 0-9.764 11.875c-30.746 40.752-44.657 94.833-45.63 147.937 58.72 26.42 90.817 62.647 101.806 101.417 30.31 19.97 69.622 29.4 108.22 27.975 33.805-1.247 66.84-10.815 92.688-27.922 10.205-38.25 42.34-73.28 100.81-101.193-.54-33.675-5.868-66.638-16.704-96.28-10.685 20.984-27.018 36.954-46.848 47.395 5.5 17.523 2.04 35.76-6.05 50.85-8.78 16.38-22.906 29.666-39.145 36.173-16.24 6.508-35.77 5.343-50.11-8.22-13.924-13.172-22.515-35.957-24.258-70.71-58.037-15.36-118.86-55.217-165.014-119.298zm41.916 97.803c5.71 20.964 31.71 36.888 63.072 36.888 6.97 0 13.348-.932 19.635-2.38.038.598 0 1.183 0 1.785 0 24.497-23.654 44.62-52.956 44.62-29.302 0-52.96-20.125-52.96-44.62 0-15.31 9.09-28.315 23.208-36.29l.002-.003zm108.422 74.107c14.6 29.094 23.808 58.187 31.467 87.28-20.978-7.523-41.956-6.637-62.936 0 5.666-29.093 17.082-58.186 31.47-87.28zm93.416 113.254c-9.875 5.25-20.36 9.583-31.248 13.017v44.47c13.1-4.626 25.368-10.682 36.3-18.12-3.742-13.045-5.556-26.223-5.052-39.366zm-193.162.224c.912 13.586-.507 27.122-3.846 40.312 10.74 7.033 22.603 12.742 35.156 17.123v-44.5c-10.862-3.4-21.366-7.702-31.31-12.936zm143.226 17.71c-12.18 2.616-24.69 4.192-37.27 4.723v45.545c12.66-.585 25.197-2.337 37.27-5.217v-45.052zM364.852 421c-28.772 18.386-64.12 28.102-99.942 29.424-40.16 1.482-81.158-7.587-114.527-28.06-4.88 12.362-11.358 24.27-19.074 35.445 22.273 21.468 70.715 35.49 121.31 36.042 50.88.553 103.302-12.087 132.718-36.016-8.24-11.97-15.18-24.302-20.486-36.836z',
  bladeBite: 'M269.156 20.313C234.83 20.68 200.582 27.262 166.72 39l-38 157.406h69.343c-15.01 36.837-4.96 78.375 10.687 106.875l18.656-53.092 20.688 57.75 21.344-53.188 21.343 53.875 21.345-58.438 18.656 53.75c17.64-32.01 20.863-75.52 10.69-107.53h68.686L372.126 39c-34.235-13.207-68.643-19.055-102.97-18.688zm-92.03 89.968c30.03 6.412 54.695 19.975 68.468 48.064l-80.438 7.22 11.97-55.283zm184.968 0 11.97 55.282-80.47-7.218c15.057-26.116 39.92-39.524 68.5-48.063zm-92.53 64.69 7.436 9.81 24.875 32.845-14.906 11.28-17.408-23-17.406 23-14.906-11.28 24.875-32.844 7.438-9.81zm-111.22 88.56c-8.722.466-15.596 7.306-16.375 15.75-7.667 15.248-13.552 32.2-17.282 49.595-20.84-14.368-45.416-17.32-72.47-12.688-2.37-6.773-8.79-11.656-16.374-11.656-9.596 0-17.375 7.783-17.375 17.376 0 9.596 7.778 17.375 17.374 17.375 4.55 0 8.684-1.762 11.78-4.624 22.983 15.99 47.52 21.57 73.314 18.688-2.213 23.685-.2 47.158 7 67.437.003.085-.005.167 0 .25.51 9.583 8.7 16.95 18.28 16.44 9.583-.512 16.918-8.7 16.407-18.283-.51-9.58-8.668-16.948-18.25-16.437-.687.037-1.37.137-2.03.25-2.313-10.577-3.27-22.23-3-34.313 104.047 15.61 281.137 29.332 353.936-46.656l-78.874-7.186c-82.512 16.06-176.916 16.633-268.656 8.28 2.278-8.837 5.128-17.454 8.5-25.593 1.87.563 3.876.83 5.938.72 9.58-.51 16.916-8.7 16.406-18.28-.51-9.583-8.668-16.95-18.25-16.44zm49.875 130.44c-18.96 23.825-18.032 45.48-18.282 71.467 55.972 21.582 108.007 19.906 160.406 0 2.66-28.217-2.896-51.03-19.688-70.843l-17 54.344-23.375-51.875-20.842 59.906-20.844-59.25-24.78 51.217-15.595-54.968z',
};

/** FNV-1a: a stable 32-bit hash of the pirate id. Cosmetic only: the same id gives the same look on every client and after a reload. */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // murmur3 finalizer: ids that differ in one character (pirate-1, pirate-2) must still land far apart.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32: a tiny seeded stream, so the four slots are drawn independently from one hash. Not `g.rng`; it never touches game state. */
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(list: readonly T[], next: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(next() * list.length))];
}

/** Which head this pirate wears: a pure function of its id (UI only; no game state, no server or shared code). */
export function pirateLook(id: string): PirateLook {
  const next = stream(hash32(String(id)));
  next(); // the first value of a seeded stream is the most correlated with the seed
  return { head: pick(PIRATE_HEADS, next) };
}

/** Icon box, in the local units the pirate layer draws in (54 wide, about 1.5x the old ship's 34). */
export const PIRATE_ICON_RADIUS = 27;
/** Vertical centre of the badge; the strength badge sits underneath it. */
export const PIRATE_ICON_CY = -4;

/** Everything below is laid out in a 512 x 512 design box, then scaled down to the icon box. */
const DESIGN = 512;
const ICON_SCALE = (PIRATE_ICON_RADIUS * 2) / DESIGN;
/** One 512 box glyph placed with its centre at (cx, cy) in the design box, `size` wide. */
function placed(part: PiratePart, cx: number, cy: number, size: number): string {
  const k = size / 512;
  return `<path class="pirate-glyph" transform="translate(${cx} ${cy}) scale(${k.toFixed(5)}) translate(-256 -256)" d="${PART_PATHS[part]}" />`;
}

/** The sail: a mast poking out above and below, a yard across the top, a boom along the bottom, and a waisted cloth between them. */
const SAIL_BACKDROP = `
          <rect class="pirate-wood" x="236" y="18" width="40" height="476" rx="20" />
          <path class="pirate-face" d="M120 112 H392 Q352 280 452 446 H60 Q160 280 120 112 Z" />
          <rect class="pirate-wood" x="68" y="84" width="376" height="34" rx="16" />
          <rect class="pirate-wood" x="46" y="436" width="420" height="28" rx="14" />`;

/**
 * The sail icon and its head glyph, drawn around (0, PIRATE_ICON_CY).
 */
export function pirateIconMarkup(look: PirateLook): string {
  return `
        <g transform="translate(0 ${PIRATE_ICON_CY}) scale(${ICON_SCALE.toFixed(5)}) translate(-256 -256)">
          ${SAIL_BACKDROP}
          ${placed(look.head, 256, 280, 230)}
        </g>`;
}
