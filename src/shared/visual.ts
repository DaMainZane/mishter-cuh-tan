// MODULE: visual manifest types (what a piece, action or overlay kind looks like, as plain data the server sends to the client; no functions) | DEPENDS ON: shared/types | USED BY: client/buildMenu, client/pieceModel, client/pieceui, client/render/overlay, client/types, client/visuals, +3 more
import type { Resources } from './types';

/**
 * Plain-data look of a DLC piece or action (R8, `Visual Manifest Design.md`). Everything here must survive `JSON.stringify`: the server builds the
 * manifest from the registry and sends it to every client, and `client` may not import `packs`, so no function can live in these types.
 * Nothing reads `visual` until the manifest is sent (R8.4); a def without one behaves as before.
 */

/** Where the spot marker and the shape sit on the board. `edge:ocean` pieces only go on ocean edges (bridges). `hex` is for sea-tile spots (feed). */
export type VisualSlot = 'vertex' | 'edge' | 'edge:ocean' | 'hex';

export interface ButtonVisual {
  /** Short label under the icon, e.g. "Net". */
  label: string;
  /** A client UI icon name (`net`), or inline SVG when the string starts with `<` (24x24 box, `currentColor`). */
  icon: string;
  /** Position in the generated button container, ascending. Default 100. */
  order?: number;
  /** Entries with the same group share one button (bridge and rickety bridge). The first by `order` gives label and icon. */
  group?: string;
}

export interface HintTexts {
  /** Toast when the supply is used up. Leave out for an action (no supply). */
  noSupply?: string;
  /** Toast when the player cannot pay. */
  cannotAfford: string;
  /** Toast when the player can pay but nothing is legal right now. */
  noSpots: string;
}

export interface PieceVisual {
  slot: VisualSlot;
  button: ButtonVisual;
  hints: HintTexts;
  /**
   * SVG fragment of the placed piece. `{color}` is the owner's colour and `{dark}` a darker shade of it; no other `{...}`, no scripts, no `on...=`.
   * Vertex: drawn around (0,0) inside a +-12 box. Edge: along the x axis from -50 to 50 on y=0. Absent for an action (it places nothing).
   */
  shape?: string;
  /** Rim width in px around the shape. Default 3.4. */
  rim?: number;
  /** SVG fragment for the clickable spot marker. Default: the generic marker for the slot. */
  spot?: string;
  /** Actions only: the payload field that carries the spot (`hexId`, `vertexId`). A piece's spot is always `loc`. */
  spotKey?: string;
  /** Styles injected once for this entry. No `</style`, no `@import`. */
  css?: string;
}

/** One entry of the manifest. `id` and `kind` are never authored: the builder takes them from the `PieceDef.id` or `ActionDef.type` the visual sits on. */
export interface ManifestEntry extends PieceVisual {
  id: string;
  kind: 'piece' | 'action';
}

/**
 * A tile overlay kind (flood, ...), registered with `api.define(OVERLAY_KINDS, def)`. `pattern` is required on purpose: a tint alone fails the
 * colourblind rule (`Design UI Philosophy.md`), so a kind cannot be defined without a pattern, and it needs a text `label`.
 */
export interface OverlayKindVisual {
  id: string;
  label: string;
  tint: { light: string; dark: string };
  line: { light: string; dark: string };
  /** Inner SVG of a 10x10 tile that repeats over the hex. With `motif` it is a single 100x100 drawing instead (see `motif`). */
  pattern: string;
  icon?: string;
  /**
   * Draw `pattern` once per hex, centred, in a 100x100 box (scaled to the hex, aspect kept) instead of repeating it over the board.
   * A motif is symmetric about the hex centre, so it stays calm and readable when the board is zoomed out. The tint should be a full-box rect or none (the tint is added for you).
   */
  motif?: boolean;
  /** Slow pulse (a warning tile). */
  pulse?: boolean;
  replace?: boolean;
}

/** Keyed registry of overlay kinds (`api.define(OVERLAY_KINDS, def)`). Same pattern as `VIEW_DATA`. */
export const OVERLAY_KINDS = 'overlayKinds';

/** What the server sends once per game (same for every player). Entries are sorted by `button.order`, then `id`. */
export interface VisualManifest {
  version: 1;
  pieces: ManifestEntry[];
  overlays: OverlayKindVisual[];
}

/** The manifest of a game with no visuals (the base game, Tidebound off), and what a client holds before one arrives. */
export function emptyManifest(): VisualManifest {
  return { version: 1, pieces: [], overlays: [] };
}

/**
 * One player's data for one manifest entry (`PlayerView.pieces[id]`, written by the `base.pieces_view` VIEW_DATA entry in R8.6).
 * `PlayerView.pieces` is undefined when the registry has no visual. A key is absent when the id is not on offer to that player.
 */
export interface PiecePlayerData {
  /** Supply left. `null` when there is no supply (an action). */
  left: number | null;
  /** This player's price now (the same value as `pieceCosts[id]`, `feedCost`, `harborCost`). */
  cost: Resources;
  /** Legal locations right now, ascending. `null` = not computed (other players, off turn, over). `[]` = your turn, nothing legal. */
  spots: number[] | null;
}
