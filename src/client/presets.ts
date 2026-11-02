// MODULE: custom map presets (list saved in this browser, preset row in the lobby dock) | DEPENDS ON: client/audio, client/icons, client/socket, client/store, client/ui, client/util | USED BY: client/main, client/render/index
// Built-in presets are fixed chips in index.html. Custom ones are the lobby map saved as JSON in localStorage:
// the server builds the JSON on save and validates it again on load (src/server/presets.ts).
// "Editing" a custom preset = load it, change the map, then save under the same name (it replaces the old one).
import { socket } from './socket';
import { state } from './store';
import { playTone } from './audio';
import { uiIcon } from './icons';
import { showToast } from './ui';
import { esc } from './util';

interface SavedPreset {
  id: string;
  name: string;
  savedAt: number;
  [key: string]: any;
}

const STORAGE_KEY = 'hexsettlers.customPresets.v1';
const MAX_PRESETS = 30;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

let mode: 'idle' | 'naming' = 'idle';
let confirmDeleteId: string | null = null;
let lastSignature = '';

function loadPresets(): SavedPreset[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(p =>
      p && typeof p === 'object' && typeof p.id === 'string' && ID_PATTERN.test(p.id) &&
      typeof p.name === 'string' && Array.isArray(p.hexes)
    );
  } catch (e) {
    return [];
  }
}

function storePresets(list: SavedPreset[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    return false;
  }
}

function isHost(): boolean {
  return !!state && state.hostId === socket.id;
}

/** Redraws the custom part of the preset row. Skips the work when nothing visible changed, so typing a name survives broadcasts. */
export function renderPresetRow(): void {
  const box = document.getElementById('customPresets');
  if (!box) return;
  const host = isHost();
  const list = host ? loadPresets() : [];
  const signature = JSON.stringify([host, mode, confirmDeleteId, list.map(p => [p.id, p.name, !!p.recipe])]);
  if (signature === lastSignature) return;
  lastSignature = signature;

  if (!host) {
    box.innerHTML = '';
    return;
  }

  const chips = list.map(p => {
    if (p.id === confirmDeleteId) {
      return `
        <span class="chip-group confirm">
          <span class="chip-confirm-text">Delete &ldquo;${esc(p.name)}&rdquo;?</span>
          <button type="button" class="chip-btn chip-danger" onclick="deletePreset('${p.id}')">Delete</button>
          <button type="button" class="chip-btn" onclick="cancelDeletePreset()">Keep</button>
        </span>`;
    }
    const when = p.savedAt ? new Date(p.savedAt).toLocaleDateString() : '';
    // A preset saved from a generated map (v2) keeps its recipe: the extra button applies the same style with a fresh seed.
    const restyle = p.recipe
      ? `<button type="button" class="chip-x" onclick="applyPresetStyle('${p.id}')" title="Same style, new seed">${uiIcon('refresh', 12)}</button>`
      : '';
    return `
      <span class="chip-group">
        <button type="button" class="chip-btn" onclick="applyCustomPreset('${p.id}')" title="Load this map and its rules${when ? ` (saved ${esc(when)})` : ''}">${esc(p.name)}</button>
        ${restyle}
        <button type="button" class="chip-x" onclick="askDeletePreset('${p.id}')" title="Delete this preset">${uiIcon('close', 12)}</button>
      </span>`;
  }).join('');

  const saveControl = mode === 'naming'
    ? `
      <input id="presetNameInput" class="num preset-name" type="text" maxlength="24" placeholder="Preset name"
        onkeydown="presetNameKey(event)" />
      <button type="button" class="chip-btn chip-accent" onclick="confirmSavePreset()">Save</button>
      <button type="button" class="chip-btn" onclick="cancelSavePreset()">Cancel</button>`
    : `<button type="button" class="chip-btn" onclick="startSavePreset()" title="Save the current map and rules in this browser">${uiIcon('plus', 14)} Save map as preset</button>`;

  box.innerHTML = chips + saveControl;

  if (mode === 'naming') {
    const input = document.getElementById('presetNameInput') as HTMLInputElement | null;
    if (input) input.focus();
  }
}

export function startSavePreset(): void {
  if (!state || state.status !== 'LOBBY') return;
  if (!isHost()) { showToast('Only the host can save presets.'); return; }
  mode = 'naming';
  confirmDeleteId = null;
  playTone(480, 0.05);
  renderPresetRow();
}

export function cancelSavePreset(): void {
  mode = 'idle';
  renderPresetRow();
}

export function presetNameKey(ev: KeyboardEvent): void {
  if (ev.key === 'Enter') confirmSavePreset();
  else if (ev.key === 'Escape') cancelSavePreset();
}

export function confirmSavePreset(): void {
  if (!state || !isHost()) return;
  const input = document.getElementById('presetNameInput') as HTMLInputElement | null;
  const name = (input?.value || '').replace(/\s+/g, ' ').trim().slice(0, 24) || 'My map';
  const list = loadPresets();
  const replacing = list.some(p => p.name.toLowerCase() === name.toLowerCase());
  if (!replacing && list.length >= MAX_PRESETS) {
    showToast(`You can keep ${MAX_PRESETS} presets. Delete one first.`);
    return;
  }
  socket.emit('savePreset', { code: state.code, name });
  mode = 'idle';
  playTone(560, 0.08);
  renderPresetRow();
}

export function applyCustomPreset(id: string): void {
  if (!state || state.status !== 'LOBBY') return;
  if (!isHost()) { showToast('Only the host can apply map presets.'); return; }
  const preset = loadPresets().find(p => p.id === id);
  if (!preset) { showToast('That preset is no longer saved in this browser.'); renderPresetRow(); return; }
  socket.emit('applyCustomPreset', { code: state.code, preset });
  playTone(520, 0.08);
}

/** "New seed" on a v2 preset: the server applies the preset's radius, picks and params with a fresh seed. */
export function applyPresetStyle(id: string): void {
  if (!state || state.status !== 'LOBBY') return;
  if (!isHost()) { showToast('Only the host can apply map presets.'); return; }
  const preset = loadPresets().find(p => p.id === id);
  if (!preset || !preset.recipe) { showToast('That preset has no map style to reuse.'); renderPresetRow(); return; }
  socket.emit('applyPresetStyle', { code: state.code, preset: { recipe: preset.recipe } });
  playTone(520, 0.08);
}

export function askDeletePreset(id: string): void {
  confirmDeleteId = id;
  mode = 'idle';
  playTone(380, 0.05);
  renderPresetRow();
}

export function cancelDeletePreset(): void {
  confirmDeleteId = null;
  renderPresetRow();
}

export function deletePreset(id: string): void {
  const list = loadPresets();
  const next = list.filter(p => p.id !== id);
  confirmDeleteId = null;
  if (next.length === list.length || storePresets(next)) {
    showToast('Preset deleted.');
    playTone(300, 0.08);
  } else {
    showToast('Could not update the saved presets in this browser.');
  }
  renderPresetRow();
}

// The server answers a save with the finished preset. Same name = replace, so saving again "edits" a preset.
socket?.on('presetSaved', (msg: any) => {
  const p = msg?.preset;
  if (!p || typeof p.id !== 'string' || !ID_PATTERN.test(p.id) || typeof p.name !== 'string' || !Array.isArray(p.hexes)) {
    showToast('Could not save the preset.');
    return;
  }
  const list = loadPresets();
  const at = list.findIndex(x => x.name.toLowerCase() === p.name.toLowerCase());
  if (at >= 0) list[at] = { ...p, id: list[at].id };
  else list.push(p);

  if (storePresets(list)) showToast(at >= 0 ? `Preset "${p.name}" updated.` : `Preset "${p.name}" saved.`);
  else showToast('This browser could not store the preset (storage full or blocked).');
  renderPresetRow();
});
