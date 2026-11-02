// MODULE: lobby map menu (summary line, option dropdown drawn from the server's option list, seed line, report, quick start chips) | DEPENDS ON: client/audio, client/icons, client/socket, client/store, client/types, client/ui, +1 more | USED BY: client/main, client/render/index
// Everything here is drawn from `mapOptions`, which the server sends once per connection from the registry, so a pack that
// registers a shape, style or perk appears in the menu with no change in this file (design sections 12 and 13).
// Only the host edits. Everyone else sees the same menu read-only, the seed included (design 5.8).
import { playTone } from './audio';
import { uiIcon } from './icons';
import { socket } from './socket';
import { mapOptions, setMapOptions, state } from './store';
import { showToast } from './ui';
import { esc } from './util';
import type { MapMetaView, MapOptionView, MapOptionsView } from './types';

let open = false;
let editingSeed = false;
let wipeArmed = false;
let wipeTimer: any = null;
let lastMenuSig = '';
let lastChipSig = '';

// Seed visibility is a personal view setting (kept in this browser), so a host can stream or share a screen without leaking the seed.
const SEED_HIDDEN_KEY = 'hexsettlers.seedHidden';
function readSeedHidden(): boolean {
  try { return localStorage.getItem(SEED_HIDDEN_KEY) === '1'; } catch { return false; }
}
let seedHidden = readSeedHidden();

/** Chips shown until the server's list arrives (and if it never does). */
const FALLBACK_STARTS = [
  { id: 'standard', label: 'Standard' },
  { id: 'goldRush', label: 'Gold rush' },
  { id: 'fogIsland', label: 'Fog island' },
  { id: 'archipelago', label: 'Archipelago' },
  { id: 'blank', label: 'Blank (all water)' }
];

const PHASE_ORDER: Record<string, number> = { base: 0, tweak: 1, carve: 2, scatter: 3 };

const isHost = (): boolean => !!state && state.hostId === socket.id;
const byId = (id: string): MapOptionView | undefined => mapOptions?.options.find(o => o.id === id);

function currentPicks(): string[] {
  const picks = state?.settings?.mapPicks;
  return Array.isArray(picks) ? picks.map(String) : [];
}

function currentParams(): Record<string, number> {
  const params = state?.settings?.mapParams;
  return params && typeof params === 'object' ? params : {};
}

/** Two options cannot be active together: same slot, or either lists the other as a conflict (same rule as the server). */
function clashes(a: MapOptionView, b: MapOptionView): boolean {
  if (a.id === b.id) return false;
  return (!!a.slot && a.slot === b.slot) || a.conflicts.includes(b.id) || b.conflicts.includes(a.id);
}

/** The options that run for these picks: the defaults of empty slots first, then the picks (mirrors the server's resolveMapOptions). */
function activeOptions(picks: string[]): MapOptionView[] {
  if (!mapOptions) return [];
  const chosen = picks.map(id => byId(id)).filter((o): o is MapOptionView => !!o);
  const defaults: MapOptionView[] = [];
  for (const o of mapOptions.options) {
    if (!o.default || !o.slot || !o.met) continue;
    if (chosen.some(k => k.slot === o.slot) || defaults.some(d => d.slot === o.slot)) continue;
    if (chosen.some(k => clashes(o, k))) continue;
    defaults.push(o);
  }
  return [...defaults, ...chosen];
}

/** "Continent + Lake · Realistic · Fog": the active options by their labels (a slot's default stays out, except the shape). */
function summaryOf(active: MapOptionView[]): string {
  const shapes = active
    .filter(o => o.stage === 'shape')
    .sort((a, b) => (PHASE_ORDER[a.phase ?? ''] ?? 9) - (PHASE_ORDER[b.phase ?? ''] ?? 9))
    .map(o => o.label);
  const styled = (stage: string) => active.filter(o => o.stage === stage && !o.default).map(o => o.label);
  const parts = [shapes.join(' + '), ...styled('terrain'), ...styled('numbers'), styled('extras').join(' + ')].filter(Boolean);
  return parts.join(' · ') || 'Hexagon';
}

function clashNames(o: MapOptionView): string {
  if (!mapOptions) return '';
  return mapOptions.options.filter(x => x.id !== o.id && x.slot !== o.slot && clashes(o, x)).map(x => x.label).join(', ');
}

// ---- Rendering --------------------------------------------------------------------------------------------

function optionHtml(o: MapOptionView, active: Set<string>, host: boolean): string {
  const on = active.has(o.id);
  const disabled = !host || !o.met;
  const clash = clashNames(o);
  const title = [o.description, !o.met ? `Needs: ${o.requires.join(', ')}.` : '', clash ? `Conflicts with: ${clash}.` : ''].filter(Boolean).join(' ');
  // Slot members replace each other (radio); free toggles are checkboxes. The click is cancelled so the page always shows the server's answer.
  const kind = o.slot ? 'radio' : 'checkbox';
  return `
    <label class="map-opt${on ? ' on' : ''}${disabled ? ' off' : ''}" title="${esc(title)}">
      <input type="${kind}" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''} onclick="event.preventDefault(); mapPick('${esc(o.id)}')" />
      <span>${esc(o.label)}</span>
    </label>`;
}

function landSliderHtml(active: MapOptionView[], host: boolean): string {
  const base = active.find(o => o.stage === 'shape' && o.phase === 'base');
  const def = base?.params.find(p => p.id === 'land');
  if (!def) return `<div class="map-muted map-land">Land: the whole board</div>`;
  const stored = currentParams().land;
  const value = Math.max(def.min, Math.min(def.max, Number.isFinite(Number(stored)) && stored !== undefined ? Number(stored) : def.default));
  return `
    <label class="map-land" title="How much of the board is land. The coast grows or shrinks in place.">
      <span>Land</span>
      <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${value}" ${host ? '' : 'disabled'}
        oninput="mapLandInput(this.value)" onchange="mapLandChange(this.value)" />
      <span id="mapLandVal" class="map-land-val">${value}%</span>
    </label>`;
}

/**
 * Every param of the active options except `land` (which has its own slider above): one slider each, drawn from the
 * server's option list, so a pack's new param appears here with no change. Params of options that are not active are not shown.
 */
function paramsHtml(active: MapOptionView[], host: boolean): string {
  const seen = new Set<string>(['land']);
  const rows: string[] = [];
  for (const o of active) {
    for (const p of o.params) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const stored = currentParams()[p.id];
      const raw = stored !== undefined && Number.isFinite(Number(stored)) ? Number(stored) : p.default;
      const value = Math.max(p.min, Math.min(p.max, raw));
      rows.push(`
        <label class="map-param" title="${esc(`${o.label}: ${p.label}`)}">
          <span class="map-param-name">${esc(p.label)}</span>
          <input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${value}" ${host ? '' : 'disabled'}
            oninput="mapParamInput('${esc(p.id)}', this.value)" onchange="mapParamChange('${esc(p.id)}', this.value)" />
          <span id="mapParamVal-${esc(p.id)}" class="map-param-val">${value}</span>
        </label>`);
    }
  }
  return rows.length > 0 ? `<div class="map-params"><h5>Settings</h5>${rows.join('')}</div>` : '';
}

function tag(text: string, kind: '' | 'warn' | 'danger', title: string): string {
  return `<span class="map-tag ${kind}" title="${esc(title)}">${esc(text)}</span>`;
}

function reportHtml(meta: MapMetaView): string {
  const st = meta.report.stats;
  const players = state?.players.length ?? 0;
  const biggest = st.landmassSpots && st.landmassSpots.length > 0 ? Math.max(...st.landmassSpots) : st.spots;
  const facts = [
    st.landmasses.length === 1 ? 'one landmass' : `${st.landmasses.length} landmasses`,
    `${st.spots} spots`,
    `${st.ports} ports`,
    st.fairness > 0 ? `fairness ${st.fairness.toFixed(2)}` : ''
  ].filter(Boolean).join(' · ');

  const tags: string[] = [];
  if (meta.edited) tags.push(tag('edited by hand', 'warn', 'The map was painted after it was generated, so the seed no longer describes it.'));
  if (meta.otherVersion) tags.push(tag('older generator', 'warn', 'This seed was made by another generator version and may now give a different map.'));
  if (meta.report.degraded) tags.push(tag(`best of ${st.boardAttempts ?? '?'} tries`, 'warn', 'No attempt passed every check, so the best one was kept. Reroll for another.'));
  if (players * 2 > biggest) tags.push(tag(`small for ${players}`, 'danger', `${players} players need ${players * 2} spots; the biggest landmass has ${biggest}.`));
  const errors = meta.report.errors;
  // The generator drops to a plain hexagon when no shape attempt passes its checks. Say so loudly instead of hiding it in the notes.
  const fell = meta.report.warnings.find(w => w.code === 'shape-fallback');
  if (fell) tags.push(tag('shape not applied', 'danger', `${fell.message} A small board may not fit this combination (islands, rivers, lakes): try a bigger map radius, a different seed or fewer options.`));
  const warnings = meta.report.warnings.filter(w => w.code !== 'shape-fallback');
  if (errors.length > 0) tags.push(tag(`${errors.length} error${errors.length === 1 ? '' : 's'}`, 'danger', errors.map(e => e.message).join('\n')));
  if (warnings.length > 0) tags.push(tag(`${warnings.length} note${warnings.length === 1 ? '' : 's'}`, '', warnings.map(w => w.message).join('\n')));

  return `<div class="map-report"><span class="map-muted">${esc(facts)}</span>${tags.join('')}</div>`;
}

function seedLineHtml(meta: MapMetaView | null, host: boolean): string {
  const s = state?.settings ?? {};
  if (!meta) {
    return `<div class="map-seedline map-muted">Painted or loaded map, so there is no seed. Pick a shape or press Reroll to generate one.</div>`;
  }
  const seed = meta.recipe.seed;
  if (editingSeed && host) {
    return `
      <div class="map-seedline">
        <input id="mapSeedInput" class="num map-seed-input" type="text" maxlength="400" value="${seedHidden ? '' : esc(seed)}"
          placeholder="Seed, or paste a share code" onkeydown="mapSeedKey(event)" />
        <button type="button" class="chip-btn chip-accent" onclick="mapApplySeed()">Apply</button>
        <button type="button" class="chip-btn" onclick="mapCancelSeed()">Cancel</button>
      </div>`;
  }
  const locked = !!s.mapSeedLocked;
  return `
    <div class="map-seedline">
      <span class="map-label">Seed</span>
      <button type="button" class="map-seed" onclick="mapCopySeed()" title="Copy the seed">${seedHidden ? '••••••' : esc(seed)}</button>
      <button type="button" class="chip-btn" onclick="mapToggleSeedVisible()" title="${seedHidden ? 'Show the seed' : 'Hide the seed on your screen'}">${seedHidden ? 'Show' : 'Hide'}</button>
      <button type="button" class="chip-btn" onclick="mapCopyCode()" title="Copy the share code: size, shape, style and seed in one line">Copy code</button>
      ${host ? `
        <button type="button" class="chip-btn" onclick="mapEditSeed()" title="Type a seed, or paste a share code">Edit</button>
        <button type="button" class="chip-btn${locked ? ' chip-accent' : ''}" onclick="mapToggleLock()" title="Keep this seed when you play again">${locked ? 'Locked' : 'Lock'}</button>
        <button type="button" class="chip-btn" onclick="startSavePreset()" title="Save this map and its style as a preset in this browser">Save as preset</button>` : ''}
    </div>`;
}

/** Redraws the map menu in the lobby dock. Skips the work when nothing visible changed, so a half-typed seed survives broadcasts. */
export function renderMapMenu(): void {
  const box = document.getElementById('mapRecipe');
  if (!box || !state) return;
  const host = isHost();
  const s = state.settings ?? {};
  const meta = state.mapMeta ?? null;
  const sig = JSON.stringify([
    host, open, editingSeed, wipeArmed, seedHidden, currentPicks(), currentParams(), s.mapSeed, !!s.mapSeedLocked, s.boardRadius,
    meta, state.players.length, mapOptions ? mapOptions.options.length : 0
  ]);
  if (sig === lastMenuSig) return;
  lastMenuSig = sig;

  if (!mapOptions) {
    box.innerHTML = `<span class="map-muted">Loading map options...</span>`;
    return;
  }

  const active = activeOptions(currentPicks());
  const activeIds = new Set(active.map(o => o.id));
  const list = mapOptions.options;
  const slotted = list.filter(o => o.stage === 'shape' && o.slot);
  const addons = list.filter(o => o.stage === 'shape' && !o.slot);
  const group = (stage: string) => list.filter(o => o.stage === stage).map(o => optionHtml(o, activeIds, host)).join('');

  const head = `
    <div class="map-head">
      <button type="button" class="map-toggle${open ? ' open' : ''}" onclick="toggleMapMenu()" aria-expanded="${open}" title="Choose the map shape, style and perks">
        <span class="map-summary">${esc(summaryOf(active))}</span><span class="map-caret"></span>
      </button>
      ${host ? `<button type="button" class="chip-btn${wipeArmed ? ' chip-danger' : ''}" onclick="mapReroll()" title="A new random seed with the same settings">${uiIcon('refresh', 14)} ${wipeArmed ? 'Replace my edits?' : 'Reroll'}</button>` : ''}
    </div>`;

  const panel = open ? `
    <div class="map-panel">
      <div class="map-col">
        <h5>Shape</h5>
        ${slotted.map(o => optionHtml(o, activeIds, host)).join('')}
        ${addons.length > 0 ? `<h5>Add to the shape</h5>${addons.map(o => optionHtml(o, activeIds, host)).join('')}` : ''}
        ${landSliderHtml(active, host)}
      </div>
      <div class="map-col">
        <h5>Terrain</h5>${group('terrain')}
        <h5>Numbers</h5>${group('numbers')}
        ${list.some(o => o.stage === 'extras') ? `<h5>Perks</h5>${group('extras')}` : ''}
      </div>
      ${paramsHtml(active, host)}
    </div>` : '';

  box.innerHTML = head + seedLineHtml(meta, host) + (meta ? reportHtml(meta) : '') + panel;

  if (editingSeed) {
    const input = document.getElementById('mapSeedInput') as HTMLInputElement | null;
    if (input) { input.focus(); input.select(); }
  }
}

/** The built-in preset chips, drawn from the registry's quick starts. */
export function renderQuickStarts(): void {
  const box = document.getElementById('builtinPresets');
  if (!box) return;
  const list = mapOptions ? mapOptions.quickStarts : FALLBACK_STARTS;
  const sig = JSON.stringify(list.map(q => [q.id, q.label]));
  if (sig === lastChipSig) return;
  lastChipSig = sig;
  box.innerHTML = list
    .map(q => `<button type="button" class="chip-btn" onclick="applyPreset('${esc(q.id)}')">${esc(q.label)}</button>`)
    .join('');
}

// ---- Actions ----------------------------------------------------------------------------------------------

function requireHost(): boolean {
  if (isHost()) return true;
  showToast('Only the host can change the map.');
  return false;
}

function sendSettings(patch: Record<string, any>): void {
  if (!state) return;
  socket.emit('updateSettings', { code: state.code, newSettings: patch });
}

/** A hand-painted map is replaced by any recipe change, so the first click only warns and the second goes through. */
function confirmWipe(): boolean {
  if (!state?.mapMeta?.edited) return true;
  if (wipeArmed) {
    wipeArmed = false;
    clearTimeout(wipeTimer);
    return true;
  }
  wipeArmed = true;
  showToast('Your painted edits will be replaced. Click again to continue.');
  clearTimeout(wipeTimer);
  wipeTimer = setTimeout(() => { wipeArmed = false; renderMapMenu(); }, 4000);
  renderMapMenu();
  return false;
}

export function toggleMapMenu(): void {
  open = !open;
  playTone(480, 0.04);
  renderMapMenu();
}

/** Tick or untick an option. The server resolves slots and conflicts (the later pick wins), so the client only sends the picks. */
export function mapPick(id: string): void {
  if (!state || !mapOptions || !requireHost()) return;
  const opt = byId(id);
  if (!opt || !opt.met) return;

  const picks = currentPicks();
  let next: string[];
  if (picks.includes(id)) {
    next = picks.filter(p => p !== id);
  } else if (opt.default && opt.slot) {
    // A slot's default is "nothing picked": drop the slot's pick, unless something else blocks the default (then pick it so it wins).
    if (activeOptions(picks).some(o => o.id === id)) return;
    const rest = picks.filter(p => byId(p)?.slot !== opt.slot);
    next = rest.some(p => { const o = byId(p); return !!o && clashes(opt, o); }) ? [...rest, id] : rest;
  } else {
    next = [...picks, id];
  }
  if (!confirmWipe()) return;

  const patch: Record<string, any> = { mapPicks: next };
  if (opt.stage === 'shape' && opt.phase === 'base') {
    // Another base shape has its own land default, so the old slider value does not carry over.
    const params = { ...currentParams() };
    delete params.land;
    patch.mapParams = params;
  }
  sendSettings(patch);
  playTone(520, 0.05);
}

export function mapLandInput(value: string): void {
  const out = document.getElementById('mapLandVal');
  if (out) out.textContent = `${value}%`;
}

export function mapLandChange(value: string): void {
  if (!requireHost() || !confirmWipe()) return;
  sendSettings({ mapParams: { ...currentParams(), land: Number(value) } });
}

/** Live readout while a settings slider is dragged. */
export function mapParamInput(id: string, value: string): void {
  const out = document.getElementById(`mapParamVal-${id}`);
  if (out) out.textContent = value;
}

/** Sends the new value of one param. The server clamps it to the option's range and keeps only params an active option declares. */
export function mapParamChange(id: string, value: string): void {
  if (!requireHost() || !confirmWipe()) return;
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  sendSettings({ mapParams: { ...currentParams(), [id]: n } });
}

export function mapReroll(): void {
  if (!state || !requireHost() || !confirmWipe()) return;
  socket.emit('regenerate', { code: state.code });
  playTone(560, 0.08);
}

function copyText(text: string, done: string): void {
  navigator.clipboard.writeText(text).then(
    () => showToast(done),
    () => showToast(text)
  );
  playTone(660, 0.08);
}

/** Hide or show the seed text on this screen only. Copy still works while hidden. */
export function mapToggleSeedVisible(): void {
  seedHidden = !seedHidden;
  try { localStorage.setItem(SEED_HIDDEN_KEY, seedHidden ? '1' : '0'); } catch { /* storage can be blocked; the toggle still works for this session */ }
  playTone(480, 0.04);
  renderMapMenu();
}

export function mapCopySeed(): void {
  const seed = state?.mapMeta?.recipe.seed;
  if (seed) copyText(seed, 'Seed copied');
}

export function mapCopyCode(): void {
  const code = state?.mapMeta?.code;
  if (code) copyText(code, 'Share code copied');
}

export function mapEditSeed(): void {
  if (!requireHost()) return;
  editingSeed = true;
  renderMapMenu();
}

export function mapCancelSeed(): void {
  editingSeed = false;
  renderMapMenu();
}

export function mapSeedKey(ev: KeyboardEvent): void {
  if (ev.key === 'Enter') mapApplySeed();
  else if (ev.key === 'Escape') mapCancelSeed();
}

/** A bare seed applies the seed; a full share code (hx1;...) applies the whole recipe. The server tells them apart. */
export function mapApplySeed(): void {
  if (!requireHost()) return;
  const input = document.getElementById('mapSeedInput') as HTMLInputElement | null;
  if (!input || !confirmWipe()) return;
  editingSeed = false;
  sendSettings({ mapSeed: input.value });
  renderMapMenu();
}

export function mapToggleLock(): void {
  if (!requireHost()) return;
  sendSettings({ mapSeedLocked: !state?.settings?.mapSeedLocked });
  playTone(500, 0.05);
}

// The server sends the option list once per connection.
socket?.on('mapOptions', (view: MapOptionsView) => {
  if (!view || !Array.isArray(view.options) || !Array.isArray(view.quickStarts)) return;
  setMapOptions(view);
  lastMenuSig = '';
  lastChipSig = '';
  renderQuickStarts();
  renderMapMenu();
});
