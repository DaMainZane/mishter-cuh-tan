// MODULE: shared mutable client UI state (game state, build and drawer modes, camera, selections) with setters | DEPENDS ON: client/types | USED BY: client/actions, client/audio, client/cursors, client/debug, client/main, client/mapmenu, +13 more
// Shared mutable UI state. Scalars are `let` exports with setters (ES live bindings),
// objects are const and mutated in place, so other modules can keep reading them directly.
import type { GameState, MapOptionsView, Resources } from './types';

export let state: GameState | null = null;
/** The map menu's options and quick starts, sent once per connection (null until they arrive). */
export let mapOptions: MapOptionsView | null = null;
export let soundOn = true;
export let isMouseDown = false;
export let buildMode: string | null = null;
export let drawerMode: string | null = null;
export let victoryTab = 'overview';
export let hideVictoryOverlay = false;
export let spectateTargetId: string | null = null;
export let logTab: 'live' | 'chat' = 'live';
export let logFilter: string | null = null;
/** Tidebound T6d: draw the elevation heat map instead of the tide overlays (a view toggle, never sent to the server). */
export let elevationView = false;

export function setLogTab(tab: 'live' | 'chat' | 'history'): void {
  logTab = tab === 'chat' ? 'chat' : 'live';
}

export function setLogFilter(filter: string | null): void {
  logFilter = filter && logFilter === filter ? null : filter;
}

export let camZoom = 1;
export let camPanX = 0;
export let camPanY = 0;
export let isPanning = false;
export let hasDraggedMap = false;

export const activeBrush = { type: '', value: '' };
export const panStart = { x: 0, y: 0 };

export const tradeGive: Resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
export const tradeWant: Resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
export const discardSel: Resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
/** Held wild tokens (fish) picked for a 7 discard, `{ tokenId: count }`. Sent as `wild` next to the resource cards. */
export const discardWild: Record<string, number> = {};

export function clearDiscardWild(): void {
  for (const k of Object.keys(discardWild)) delete discardWild[k];
}

/** How many held wild tokens are in the current discard pick. */
export function wildDiscardCount(): number {
  return Object.values(discardWild).reduce((a, b) => a + b, 0);
}

// Cards currently flying toward a player's hand or row; held back from display until each flying card lands.
export const inFlightHandResources: Resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
export const inFlightPlayerResCount: Record<string, number> = {};
export const inFlightPlayerDevCount: Record<string, number> = {};
export let inFlightMyDevCards = 0;

export function addInFlightResource(playerId: string, myId: string | undefined, resource: string, amount: number): void {
  if (!playerId || amount <= 0) return;
  inFlightPlayerResCount[playerId] = (inFlightPlayerResCount[playerId] || 0) + amount;
  if (playerId === myId && resource in inFlightHandResources) {
    inFlightHandResources[resource] = (inFlightHandResources[resource] || 0) + amount;
  }
}

export function releaseInFlightResource(playerId: string, myId: string | undefined, resource: string, amount: number): void {
  if (!playerId || amount <= 0) return;
  inFlightPlayerResCount[playerId] = Math.max(0, (inFlightPlayerResCount[playerId] || 0) - amount);
  if (playerId === myId && resource in inFlightHandResources) {
    inFlightHandResources[resource] = Math.max(0, (inFlightHandResources[resource] || 0) - amount);
  }
}

export function addInFlightDev(playerId: string, myId: string | undefined, amount: number): void {
  if (!playerId || amount <= 0) return;
  inFlightPlayerDevCount[playerId] = (inFlightPlayerDevCount[playerId] || 0) + amount;
  if (playerId === myId) {
    inFlightMyDevCards += amount;
  }
}

export function releaseInFlightDev(playerId: string, myId: string | undefined, amount: number): void {
  if (!playerId || amount <= 0) return;
  inFlightPlayerDevCount[playerId] = Math.max(0, (inFlightPlayerDevCount[playerId] || 0) - amount);
  if (playerId === myId) {
    inFlightMyDevCards = Math.max(0, inFlightMyDevCards - amount);
  }
}

export function clearAllInFlight(): void {
  for (const k of Object.keys(inFlightHandResources)) inFlightHandResources[k] = 0;
  for (const k of Object.keys(inFlightPlayerResCount)) delete inFlightPlayerResCount[k];
  for (const k of Object.keys(inFlightPlayerDevCount)) delete inFlightPlayerDevCount[k];
  inFlightMyDevCards = 0;
}

// Counter-offer draft (the trade popup's edit mode). Both sides are from my point of view.
export let counterTradeId: number | null = null;
export const counterGet: Resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
export const counterGive: Resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
export let tradesCollapsed = false;
export function setCounterTradeId(v: number | null): void { counterTradeId = v; }
export function setTradesCollapsed(v: boolean): void { tradesCollapsed = v; }

export function setElevationView(v: boolean): void { elevationView = v; }
export function setState(s: GameState): void { state = s; }
export function setMapOptions(v: MapOptionsView | null): void { mapOptions = v; }
export function setSoundOn(v: boolean): void { soundOn = v; }
export function setIsMouseDown(v: boolean): void { isMouseDown = v; }
export function setBuildModeValue(v: string | null): void { buildMode = v; }
export function setDrawerMode(v: string | null): void { drawerMode = v; }
export function setVictoryTab(v: string): void { victoryTab = v; }
export function setHideVictoryOverlay(v: boolean): void { hideVictoryOverlay = v; }
export function setSpectateTargetId(v: string | null): void { spectateTargetId = v; }
export function setCamZoom(v: number): void { camZoom = v; }
export function setCamPan(x: number, y: number): void { camPanX = x; camPanY = y; }
export function setIsPanning(v: boolean): void { isPanning = v; }
export function setHasDraggedMap(v: boolean): void { hasDraggedMap = v; }

export function clearRes(r: Resources): void {
  for (const k of Object.keys(r)) r[k] = 0;
}

export function getClientSpeed(): number {
  return 0.5;
}


