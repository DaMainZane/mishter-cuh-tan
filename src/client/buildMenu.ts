// MODULE: build menu model (BUG 5: which pieces a board corner or edge offers, with their price and whether you can pay; the cost tooltip markup, its delay, and where the popover sits; pure, no DOM) | DEPENDS ON: client/pieceModel, client/types, shared/visual | USED BY: client/render/board, client/render/buildmenu
import { canPay, recipeStripHtml } from './pieceModel';
import type { PlayerView, Resources } from './types';
import type { ManifestEntry } from '../shared/visual';

// BUG 5. A hotspot is drawn where a piece may legally stand (position only); its popover lists those pieces, and one you cannot pay for is listed but disabled.
// Everything here is plain data in, plain data out, so `tests/buildMenu.test.ts` runs it in node. The DOM half is `client/render/buildmenu.ts`.

/** The board fields the menu reads. The client `GameState.board` fits it. */
export interface MenuBoard {
  vertices: { building?: { owner: string; type: string } | null; hexIds: number[]; adjacentVertices: number[]; edgeIds: number[] }[];
  edges: { v1: number; v2: number; road?: string | null; hexIds: number[] }[];
}

export type MenuPlayer = { id: string } & Partial<Pick<PlayerView,
  'resources' | 'settlementsLeft' | 'citiesLeft' | 'roadsLeft' | 'bridgesLeft' | 'freeRoads' | 'harborSpots' | 'pieces'>>;

export interface MenuContext {
  board: MenuBoard;
  me: MenuPlayer;
  /** The price of a base piece for this player (the server's `pieceCosts`, else the base price with the 2x rule). */
  costOf: (piece: string) => Resources;
  /** Rickety bridges are in the game. */
  ricketyOn: boolean;
  /** The 1:1 harbor price, when harbors are in the game. */
  harborCost?: Resources | null;
  /** Your ports that Harbor charters can raise to 2:1 (`portRaiseSpots`). */
  portRaise?: { vertexId: number; cost: Resources; affordable: boolean }[];
  /** Manifest pieces and actions; the ones on a corner or edge are offered where the server lists the spot. */
  entries?: readonly ManifestEntry[];
}

/** One line of the popover. `entryId` is set for a manifest piece or action (the click goes through `placeAt`). */
export interface BuildOption {
  id: string;
  label: string;
  icon: string;
  cost: Resources;
  affordable: boolean;
  entryId?: string;
}

/** Your road, or your building, touches one end of the edge, and that end is not a rival's building. */
function joinsMyNetwork(board: MenuBoard, edgeId: number, myId: string): boolean {
  const e = board.edges[edgeId];
  if (!e) return false;
  for (const vId of [e.v1, e.v2]) {
    const v = board.vertices[vId];
    if (!v) continue;
    if (v.building) {
      if (v.building.owner === myId) return true;
      continue;
    }
    if (v.edgeIds.some(o => board.edges[o]?.road === myId)) return true;
  }
  return false;
}

/** A settlement may stand here in the main phase: a free land corner, no building next to it, and your road touching it. */
export function settlementSiteOk(board: MenuBoard, vertexId: number, myId: string): boolean {
  const v = board.vertices[vertexId];
  if (!v || v.building || v.hexIds.length === 0) return false;
  if (v.adjacentVertices.some(a => board.vertices[a]?.building)) return false;
  return v.edgeIds.some(e => board.edges[e]?.road === myId);
}

/** A road may go here: a free land edge joined to your network. */
export function roadSiteOk(board: MenuBoard, edgeId: number, myId: string): boolean {
  const e = board.edges[edgeId];
  if (!e || e.road || e.hexIds.length === 0) return false;
  return joinsMyNetwork(board, edgeId, myId);
}

/** A bridge may go here: a free ocean edge joined to your network. */
export function bridgeSiteOk(board: MenuBoard, edgeId: number, myId: string): boolean {
  const e = board.edges[edgeId];
  if (!e || e.road || e.hexIds.length !== 0) return false;
  return joinsMyNetwork(board, edgeId, myId);
}

function option(c: MenuContext, id: string, label: string, icon: string, cost: Resources): BuildOption {
  return { id, label, icon, cost, affordable: canPay(c.me, cost) };
}

/** Manifest entries on this kind of node whose server spots list `loc` (the server already checked them). Ids already offered are skipped. */
function entryOptions(c: MenuContext, where: 'vertex' | 'edge', loc: number, taken: Set<string>): BuildOption[] {
  const pieces = c.me.pieces;
  if (!pieces) return [];
  return (c.entries ?? [])
    .filter(e => (where === 'vertex' ? e.slot === 'vertex' : e.slot === 'edge' || e.slot === 'edge:ocean'))
    .filter(e => !taken.has(e.id) && pieces[e.id]?.left !== 0 && (pieces[e.id]?.spots ?? []).includes(loc))
    .map(e => ({ ...option(c, e.id, e.button.label, e.button.icon, pieces[e.id].cost ?? {}), entryId: e.id }));
}

/** What a corner offers you on your main-phase turn, in popover order. Empty means no hotspot. */
export function vertexOptions(c: MenuContext, vertexId: number): BuildOption[] {
  const v = c.board.vertices[vertexId];
  if (!v) return [];
  const out: BuildOption[] = [];
  const b = v.building;
  if (!b) {
    if ((c.me.settlementsLeft ?? 0) > 0 && settlementSiteOk(c.board, vertexId, c.me.id)) out.push(option(c, 'settlement', 'Settlement', 'house', c.costOf('settlement')));
  } else if (b.owner === c.me.id) {
    if (b.type === 'settlement' && (c.me.citiesLeft ?? 0) > 0) out.push(option(c, 'city', 'City', 'city', c.costOf('city')));
    if (b.type === 'city' && c.harborCost && c.me.harborSpots?.includes(vertexId)) out.push(option(c, 'harbor', 'Harbor 1:1', 'harbor', c.harborCost));
    const raise = c.portRaise?.find(p => p.vertexId === vertexId);
    if (raise) out.push({ id: 'upgrade_port', label: 'Raise port to 2:1', icon: 'harbor', cost: raise.cost, affordable: raise.affordable });
  }
  return out.concat(entryOptions(c, 'vertex', vertexId, new Set(out.map(o => o.id))));
}

/** What an edge offers you on your main-phase turn, in popover order. Empty means no hotspot. */
export function edgeOptions(c: MenuContext, edgeId: number): BuildOption[] {
  const out: BuildOption[] = [];
  if ((c.me.roadsLeft ?? 0) > 0 && roadSiteOk(c.board, edgeId, c.me.id)) {
    out.push(option(c, 'road', 'Road', 'road', (c.me.freeRoads ?? 0) > 0 ? {} : c.costOf('road')));
  }
  if ((c.me.bridgesLeft ?? 0) > 0 && bridgeSiteOk(c.board, edgeId, c.me.id)) {
    out.push(option(c, 'bridge', 'Bridge', 'bridge', c.costOf('bridge')));
    if (c.ricketyOn) out.push(option(c, 'rickety_bridge', 'Rickety bridge', 'rickety_bridge', c.costOf('rickety_bridge')));
  }
  return out.concat(entryOptions(c, 'edge', edgeId, new Set(out.map(o => o.id))));
}

// ---- Cost tooltip ------------------------------------------------------------------------------------------------------------

/** Hover delay before the cost tooltip shows (desktop). */
export const TIP_HOVER_MS = 150;
/** Press length that shows the cost tooltip on touch. */
export const TIP_LONG_PRESS_MS = 450;

/** How long a pointer must rest (mouse, pen) or press (touch) before the tooltip shows. */
export function tipDelay(pointerType: string): number {
  return pointerType === 'touch' ? TIP_LONG_PRESS_MS : TIP_HOVER_MS;
}

/** The tooltip body: the cost as resource card stacks, the cards you lack dimmed (the same strip the build bar always used). An empty price reads Free. */
export function costTipHtml(cost: Resources | undefined, hand: Resources | undefined): string {
  return recipeStripHtml(cost, hand) || '<div class="recipe-cards-strip cost-free">Free</div>';
}

// ---- Popover placement -------------------------------------------------------------------------------------------------------

const EDGE_MARGIN = 8;
const NODE_GAP = 18;

/** Top-left of a popover of `size` anchored to a node at screen point `at`: centred above it, below it when there is no room above, kept on screen. */
export function popoverPlace(at: { x: number; y: number }, size: { w: number; h: number }, view: { w: number; h: number }): { left: number; top: number; below: boolean } {
  const maxLeft = Math.max(EDGE_MARGIN, view.w - size.w - EDGE_MARGIN);
  const left = Math.round(Math.min(maxLeft, Math.max(EDGE_MARGIN, at.x - size.w / 2)));
  const above = at.y - size.h - NODE_GAP;
  if (above >= EDGE_MARGIN) return { left, top: Math.round(above), below: false };
  return { left, top: Math.round(Math.min(at.y + NODE_GAP, view.h - size.h - EDGE_MARGIN)), below: true };
}
