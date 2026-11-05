// MODULE: tech panel (hub-and-spoke tree: a hub, one ring of techs per tier, one spoke per branch, all generated from the server's `techTree` rows; costs as mini resource cards; hover for the description; plus the Harbor charters (raise a whole port to 2:1) and Ground work controls) and the Tech button in the action bar | DEPENDS ON: client/audio, client/icons, client/pieceModel, client/socket, client/store, client/techView, +2 more | USED BY: client/main, client/render/bridgepicker, client/render/buildmenu, client/render/index
import { uiIcon } from '../icons';
import { costStackHtml } from '../pieceModel';
import { playTone } from '../audio';
import { socket } from '../socket';
import { state } from '../store';
import type { Resources, TechActionsView, TechRowView } from '../types';
import { FIT_VIEW, WORLD_SPAN, clampView, costsVisible, panBy, viewCss, zoomAt } from '../techView';
import type { TechView } from '../techView';
import { esc } from '../util';

/** Icon (from `icons.ts`) per tech. A tech added later by a DLC falls back to its branch icon, then to the hub icon. */
const TECH_ICONS: Record<string, string> = {
  'tidebound.harbor_charters': 'waves',
  'tidebound.rickety_bridges': 'bridge',
  'tidebound.fishing_nets': 'net',
  'tidebound.salvage_crew': 'gift',
  'tidebound.net_works': 'fish',
  'tidebound.pirate_hunter': 'sword',
  'tidebound.harbor_master': 'harbor',
  'tidebound.grand_causeway': 'trophy',
  'tidebound.harbor_empire': 'crown',
  'bulwark.stockpiling': 'bank',
  'warlords.plunder': 'sword',
  'wildearth.ground_work': 'tree',
  'guildhall.road_levy': 'road'
};
const BRANCH_ICONS: Record<string, string> = {
  tidebound: 'waves',
  bulwark: 'bank',
  warlords: 'sword',
  wildearth: 'tree',
  guildhall: 'road'
};
/** Muted tile token that tints each branch (flat fill, the glyph stays dark). Unknown branches use fog. */
const BRANCH_TILE: Record<string, string> = {
  tidebound: '--tile-water',
  bulwark: '--tile-ore',
  warlords: '--tile-brick',
  wildearth: '--tile-wood',
  guildhall: '--tile-wheat'
};

let open = false;
let built = false;
let lastHtml = '';
/** The tile picked in the Ground work list, waiting for the resource choice. */
let pickedHex: number | null = null;
/** Pan and zoom of the tree. Kept here, not in the markup, so a redraw does not reset it; `applyView` writes it to the DOM. */
let view: TechView = FIT_VIEW;
/** True while the player drags the tree (the tooltips hide meanwhile). */
let dragging = false;

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const CSS = `
#techPanel{position:fixed;inset:0;z-index:80;display:none;align-items:center;justify-content:center;padding:12px;background:rgba(20,20,20,.5);--tp-node:64px;--tp-hub:76px;--lane-exp:#e2a63c;--lane-ind:#4fa8cf}
#techPanel .tp-card{width:min(760px,100%);max-height:calc(100vh - 24px);overflow:auto;padding:14px 18px 18px;border-radius:var(--r-lg);background:var(--surface);color:var(--ink);box-shadow:var(--shadow)}
#techPanel .tp-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
#techPanel .tp-head h3{margin:0;font-size:15px;font-weight:700}
#techPanel .tp-sub{margin:2px 0 4px;font-size:12px;font-weight:500;color:var(--ink-dim)}

#techPanel .tp-stage{position:relative;aspect-ratio:1;margin:0 auto;width:max(300px,min(640px,100%,calc(100vh - 180px)));overflow:hidden;overflow:clip;border-radius:var(--r);background:radial-gradient(circle at 50% 50%,var(--surface-3) 0,transparent 62%),radial-gradient(var(--line) 1px,transparent 1.6px) 0 0/24px 24px,var(--surface-2);touch-action:none;user-select:none;cursor:grab}
#techPanel .tp-stage.tp-dragging{cursor:grabbing}
#techPanel .tp-stage.tp-dragging .tp-tip{display:none!important}
#techPanel .tp-world{position:absolute;left:0;top:0;width:${WORLD_SPAN * 100}%;height:${WORLD_SPAN * 100}%;transform-origin:0 0}
#techPanel .tp-stage.tp-far .tp-cap .recipe-cards-strip{display:none}
#techPanel .tp-stage.tp-far .tp-node:hover .tp-cap .recipe-cards-strip,#techPanel .tp-stage.tp-far .tp-node:focus-visible .tp-cap .recipe-cards-strip{display:flex}
#techPanel .tp-zoom{display:flex;align-items:center;gap:6px}
#techPanel .tp-stage.tp-deep{--tp-node:48px;--tp-hub:62px}
#techPanel .tp-stage.tp-deep .tp-disc svg.ui-icon{width:22px;height:22px}
#techPanel .tp-stage.tp-deep .tp-cap{width:96px;top:calc(100% + 4px);gap:2px}
#techPanel .tp-stage.tp-deep .tp-name{font-size:10px}
#techPanel .tp-stage.tp-deep .tp-cap .recipe-mini-card{width:18px;height:24px}
#techPanel .tp-stage.tp-deep .tp-cap .recipe-mini-card svg.glyph{width:12px;height:12px}
#techPanel .tp-stage.tp-deep .tp-cap .recipe-stack{--cw:18px;--ch:24px;--dx:3px;--dy:3px}
#techPanel .tp-lines{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
#techPanel .tp-ring{fill:none;stroke:var(--line);stroke-width:1.5px;stroke-dasharray:3 5;vector-effect:non-scaling-stroke}
#techPanel .tp-line{stroke:var(--surface-3);stroke-width:5px;stroke-linecap:round;vector-effect:non-scaling-stroke}
#techPanel .tp-line.lane-expansion{stroke:color-mix(in srgb,var(--lane-exp) 42%,var(--surface-3))}
#techPanel .tp-line.lane-industrial{stroke:color-mix(in srgb,var(--lane-ind) 42%,var(--surface-3))}

#techPanel .tp-line.owned{stroke:var(--ok);filter:drop-shadow(0 0 4px var(--ok))}

#techPanel .tp-hub{position:absolute;left:50%;top:50%;width:var(--tp-hub);height:var(--tp-hub);transform:translate(-50%,-50%);border-radius:50%;background:var(--accent);color:var(--on-accent);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;box-shadow:0 0 0 6px var(--surface-2),0 0 0 8px var(--accent),0 8px 20px rgba(0,0,0,.4)}

#techPanel .tp-node{position:absolute;width:var(--tp-node);height:var(--tp-node);transform:translate(-50%,-50%);outline:none}
#techPanel .tp-node:hover,#techPanel .tp-node:focus-visible{z-index:6}
#techPanel .tp-disc{position:relative;width:100%;height:100%;border-radius:50%;background:radial-gradient(circle at 32% 24%,rgba(255,255,255,.4),transparent 58%),var(--bc,var(--tile-fog));box-shadow:0 5px 12px rgba(0,0,0,.35),inset 0 0 0 3px rgba(255,255,255,.2),inset 0 -5px 9px rgba(0,0,0,.16);color:var(--target-dark);display:flex;align-items:center;justify-content:center;transition:transform .12s}
#techPanel .tp-disc svg.ui-icon{width:30px;height:30px}
#techPanel .tp-node.lane-expansion{--lane:var(--lane-exp)}
#techPanel .tp-node.lane-industrial{--lane:var(--lane-ind)}
#techPanel .tp-disc::before{content:"";position:absolute;inset:-8px;border-radius:50%;border:2px solid var(--lane,transparent);opacity:.7;pointer-events:none}
#techPanel .tp-tier{position:absolute;left:-5px;top:-5px;min-width:20px;height:20px;padding:0 4px;box-sizing:border-box;border-radius:10px;background:var(--surface);color:var(--ink);font-size:11px;font-weight:800;line-height:20px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.45)}
#techPanel .tp-node.st-can .tp-disc{cursor:pointer;box-shadow:0 0 0 3px var(--accent),0 0 20px rgba(217,137,59,.6),0 5px 12px rgba(0,0,0,.35)}

#techPanel .tp-node.st-can:hover .tp-disc,#techPanel .tp-node.st-can:focus-visible .tp-disc{transform:translateY(-3px)}
#techPanel .tp-node.st-owned .tp-disc{box-shadow:0 0 0 3px var(--ok),0 0 16px rgba(79,138,74,.5),0 5px 12px rgba(0,0,0,.35)}
#techPanel .tp-node.st-locked .tp-disc{filter:grayscale(.45) brightness(.82)}
#techPanel .tp-node:focus-visible .tp-disc{outline:2px solid var(--accent);outline-offset:4px}
#techPanel .tp-check{position:absolute;right:-5px;bottom:-5px;width:22px;height:22px;border-radius:50%;background:var(--ok);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px var(--surface)}
#techPanel .tp-check svg.ui-icon{width:14px;height:14px}

#techPanel .tp-cap{position:absolute;top:calc(100% + 6px);left:50%;transform:translateX(-50%) scale(var(--tp-inv,1));transform-origin:50% 0;width:112px;display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none}
#techPanel .tp-name{font-size:11px;font-weight:700;line-height:1.15;text-align:center}
#techPanel .tp-cap .recipe-mini-card{width:22px;height:30px;border-width:1px}
#techPanel .tp-cap .recipe-mini-card svg.glyph{width:15px;height:15px}
#techPanel .tp-cap .recipe-stack{--cw:22px;--ch:30px;--dx:4px;--dy:3px}

#techPanel .tp-tip{position:absolute;display:none;width:220px;padding:10px 12px;border-radius:var(--r);background:#2b2d30;color:#f4f1ea;box-shadow:0 6px 18px rgba(0,0,0,.38);pointer-events:none;z-index:8;animation:tpTipIn .12s ease-out;scale:var(--tp-inv,1);transform-origin:var(--ox,50%) var(--oy,100%)}
#techPanel .tp-node:hover .tp-tip,#techPanel .tp-node:focus-visible .tp-tip{display:block}
#techPanel .tp-tip.tip-t{bottom:calc(100% + 8px);--oy:100%}
#techPanel .tp-tip.tip-b{top:calc(100% + 68px);--oy:0%}
#techPanel .tp-tip.tip-c{left:50%;margin-left:-110px;--ox:50%}
#techPanel .tp-tip.tip-l{left:0;--ox:0%}
#techPanel .tp-tip.tip-r{right:0;--ox:100%}
#techPanel .tp-tip-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
#techPanel .tp-tip-name{font-size:13px;font-weight:700}
#techPanel .tp-tip-tier{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#b8b3a8;white-space:nowrap}
#techPanel .tp-tip-desc{margin-top:4px;font-size:12px;font-weight:500;line-height:1.35;color:#d8d3c8}
#techPanel .tp-tip-foot{margin-top:6px;font-size:11px;font-weight:700;color:#b8b3a8}
#techPanel .tp-tip-foot.can{color:#f0a85e}
#techPanel .tp-tip-foot.owned{color:#8fc489}
@keyframes tpTipIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}

#techPanel .tp-actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:14px}
#techPanel .tp-extra{flex:1 1 240px;max-width:340px;padding:10px 12px;border-radius:var(--r);background:var(--surface-2);display:flex;flex-direction:column;gap:6px}
#techPanel .tp-extra-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:700;font-size:12px}
#techPanel .tp-extra .recipe-cards-strip{align-self:flex-start}
#techPanel .tp-extra .recipe-mini-card{width:22px;height:30px;border-width:1px}
#techPanel .tp-extra .recipe-mini-card svg.glyph{width:15px;height:15px}
#techPanel .tp-extra .recipe-stack{--cw:22px;--ch:30px;--dx:4px;--dy:3px}
#techPanel .tp-port{font-size:12px;font-weight:600}
#techPanel .tp-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
#techPanel .tp-mini{border:0;border-radius:var(--r-sm);padding:5px 10px;min-height:28px;font-size:12px;font-weight:700;cursor:pointer;background:var(--surface-3);color:var(--ink)}
#techPanel .tp-mini:hover{background:var(--surface)}
#techPanel .tp-mini.sel{background:var(--accent);color:var(--on-accent)}
#techPanel .tp-mini:disabled{opacity:.45;cursor:not-allowed}
#techPanel .tp-done{font-size:12px;font-weight:800;color:var(--ok)}
#techPanel .tp-why{font-size:11.5px;font-weight:500;color:var(--ink-dim)}
@media (max-width:640px){#techPanel{--tp-node:52px;--tp-hub:60px}#techPanel .tp-stage.tp-deep{--tp-node:40px;--tp-hub:50px}#techPanel .tp-disc svg.ui-icon{width:24px;height:24px}}
`;

/** Builds the Tech button (inside the action bar, left of Trade) and the panel once. */
function ensureDom(): void {
  if (built) return;
  built = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const btn = document.createElement('button');
  btn.id = 'techPanelBtn';
  btn.type = 'button';
  btn.className = 'act-btn';
  btn.title = 'Open the tech tree';
  btn.style.display = 'none';
  btn.innerHTML = `${uiIcon('tech', 22)}<span class="lbl">Tech</span>`;
  btn.setAttribute('onclick', 'toggleTechPanel()');
  const bar = document.querySelector('.action-bar');
  const trade = document.getElementById('btnTradeDrawer');
  if (bar && trade) bar.insertBefore(btn, trade);
  else if (bar) bar.appendChild(btn);
  else document.body.appendChild(btn);

  const panel = document.createElement('div');
  panel.id = 'techPanel';
  panel.addEventListener('click', e => {
    const zoomBtn = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tz]') : null;
    if (zoomBtn) { zoomButton(zoomBtn.dataset.tz ?? ''); return; }
    if (e.target === panel) toggleTechPanel(false);
  });
  bindPanZoom(panel);
  document.body.appendChild(panel);
}

/** Writes `view` to the stage: the world transform, the tooltip counter-scale (so a tooltip stays readable at any zoom) and the far class that hides the costs. */
function applyView(): void {
  const stage = document.querySelector<HTMLElement>('#techPanel .tp-stage');
  const world = stage?.querySelector<HTMLElement>('.tp-world');
  if (!stage || !world) return;
  view = clampView(view, stage.clientWidth, stage.clientHeight, WORLD_SPAN);
  world.style.transform = viewCss(view);
  stage.style.setProperty('--tp-inv', (1 / view.scale).toFixed(3));
  stage.classList.toggle('tp-far', !costsVisible(view.scale));
  stage.classList.toggle('tp-dragging', dragging);
}

/** The +, - and Reset view buttons: zoom about the middle of the stage. */
function zoomButton(kind: string): void {
  const stage = document.querySelector<HTMLElement>('#techPanel .tp-stage');
  if (!stage) return;
  if (kind === 'reset') view = FIT_VIEW;
  else view = zoomAt(view, kind === 'in' ? 1.25 : 0.8, stage.clientWidth / 2, stage.clientHeight / 2, stage.clientWidth, stage.clientHeight, WORLD_SPAN);
  applyView();
  playTone(520, 0.04);
}

/**
 * Drag to pan, wheel to zoom about the cursor, two fingers to pinch. The listeners sit on the panel, which is never replaced,
 * because the stage inside it is redrawn. A press that does not move 5px is still a click on a tech.
 */
function bindPanZoom(panel: HTMLElement): void {
  const pointers = new Map<number, { x: number; y: number; sx: number; sy: number }>();
  let moved = false;
  let pinch = 0;
  let swallowClick = false;
  const stageOf = (t: EventTarget | null): HTMLElement | null => (t instanceof Element ? t.closest<HTMLElement>('.tp-stage') : null);
  const stage = (): HTMLElement | null => panel.querySelector<HTMLElement>('.tp-stage');
  const spread = (): number => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  panel.addEventListener('wheel', e => {
    const st = stageOf(e.target);
    if (!st) return;
    e.preventDefault();
    const r = st.getBoundingClientRect();
    const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 0.5 : 0.0015;
    view = zoomAt(view, Math.exp(-e.deltaY * unit), e.clientX - r.left, e.clientY - r.top, st.clientWidth, st.clientHeight, WORLD_SPAN);
    applyView();
  }, { passive: false });

  panel.addEventListener('pointerdown', e => {
    if (!stageOf(e.target) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    if (pointers.size === 1) moved = false;
    if (pointers.size === 2) pinch = spread();
  });

  panel.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId);
    const st = stage();
    if (!p || !st) return;
    const w = st.clientWidth;
    const h = st.clientHeight;
    if (pointers.size >= 2) {
      p.x = e.clientX;
      p.y = e.clientY;
      const now = spread();
      const [a, b] = [...pointers.values()];
      if (pinch > 0 && now > 0 && a && b) {
        const r = st.getBoundingClientRect();
        view = zoomAt(view, now / pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, w, h, WORLD_SPAN);
      }
      pinch = now;
      moved = true;
      applyView();
      return;
    }
    if (!moved) {
      if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 5) return;
      moved = true;
      dragging = true;
      try { st.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
    }
    view = panBy(view, e.clientX - p.x, e.clientY - p.y, w, h, WORLD_SPAN);
    p.x = e.clientX;
    p.y = e.clientY;
    applyView();
  });

  const release = (e: PointerEvent): void => {
    if (!pointers.delete(e.pointerId)) return;
    pinch = 0;
    if (pointers.size > 0) return;
    dragging = false;
    applyView();
    if (moved) {
      // The click that ends a drag must not research the tech under the cursor.
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 0);
    }
  };
  panel.addEventListener('pointerup', release);
  panel.addEventListener('pointercancel', release);
  panel.addEventListener('click', e => {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);
}

/** A cost as mini resource cards: one overlapped stack per resource (a bigger count continues in another stack), dimmed when the hand cannot cover it, like the build recipes. */
export function costStripHtml(cost: Resources, hand: Resources | undefined): string {
  const stacks = Object.entries(cost).map(([r, n]) => costStackHtml(r, Number(n) || 0, hand?.[r] || 0)).join('');
  return stacks ? `<div class="recipe-cards-strip">${stacks}</div>` : '';
}

interface Placed {
  row: TechRowView;
  x: number;
  y: number;
  ring: number;
  /** The fork lane the tech belongs to (its own or inherited from a prerequisite), if any. */
  lane?: 'expansion' | 'industrial';
}

/**
 * Sideways offset (world units, 100 = the whole world) of each fork lane from its branch spoke. The lanes are two straight parallel lines along the
 * spoke: the offset is a distance, so it does not grow with the ring (an angle would make the lanes fan out into a V). 18 units apart is wider than a
 * node's caption at the opening zoom, so neighbours on one ring never touch.
 */
const PATH_LATERAL: Record<string, number> = {
  expansion: -9,
  industrial: 9
};
/** Sideways gap between techs of one branch and ring that have no lane (units). */
const SIBLING_GAP = 18;

/**
 * Hub and spoke with 2-path branch forks (T11a):
 *  - One spoke per branch (evenly spaced around the hub, first at the top).
 *  - Ring index is the prerequisite chain depth (`1` for root, `parentRing + 1` for children, at least `row.tier`)
 *    so chained tier-3 steps (`salvage_crew -> pirate_hunter`, `net_works -> harbor_master`) sit on consecutive concentric rings.
 *  - Nodes with `path: 'expansion' | 'industrial'` fork into two straight parallel lanes (`PATH_LATERAL`) along their branch spoke.
 */
export function layout(rows: TechRowView[], branches: string[]): { placed: Placed[]; radii: Map<number, number>; maxRing: number } {
  const byId = new Map<string, TechRowView>(rows.map(r => [r.id, r]));
  const ringMemo = new Map<string, number>();
  const ringOf = (r: TechRowView, visiting = new Set<string>()): number => {
    const hit = ringMemo.get(r.id);
    if (hit !== undefined) return hit;
    if (visiting.has(r.id)) return r.tier;
    visiting.add(r.id);
    let d = Number(r.tier) || 1;
    for (const pId of r.prereqs) {
      const parent = byId.get(pId);
      if (parent) d = Math.max(d, ringOf(parent, visiting) + 1);
    }
    visiting.delete(r.id);
    ringMemo.set(r.id, d);
    return d;
  };
  const pathOf = (r: TechRowView, visiting = new Set<string>()): 'expansion' | 'industrial' | undefined => {
    if (r.path) return r.path;
    if (visiting.has(r.id)) return undefined;
    visiting.add(r.id);
    for (const pId of r.prereqs) {
      const parent = byId.get(pId);
      const found = parent ? pathOf(parent, visiting) : undefined;
      if (found) return found;
    }
    return undefined;
  };

  const maxRing = Math.max(1, ...rows.map(r => ringOf(r)));
  const radius = (ring: number): number => (maxRing === 1 ? 32 : 12 + ((ring - 1) * 33) / (maxRing - 1));
  const radii = new Map<number, number>();
  const groups = new Map<string, TechRowView[]>();
  for (const r of rows) {
    const ring = ringOf(r);
    radii.set(ring, radius(ring));
    const k = `${r.branch}|${ring}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const placed: Placed[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const ring = ringOf(first);
    const rad = radius(ring);
    const base = -90 + (360 * Math.max(0, branches.indexOf(first.branch))) / Math.max(1, branches.length);
    group.forEach((row, j) => {
      const lane = pathOf(row);
      const lateral = lane && PATH_LATERAL[lane] !== undefined ? PATH_LATERAL[lane] : (j - (group.length - 1) / 2) * SIBLING_GAP;
      const a = (base * Math.PI) / 180;
      // Along the spoke by the ring radius, sideways (at a right angle to it) by the lane offset.
      const x = 50 + rad * Math.cos(a) - lateral * Math.sin(a);
      const y = 50 + rad * Math.sin(a) + lateral * Math.cos(a);
      placed.push({ row, x, y, ring, lane });
    });
  }
  return { placed, radii, maxRing };
}

function nodeHtml(p: Placed, canAct: boolean, hand: Resources | undefined): string {
  const r = p.row;
  const mode = r.owned ? 'owned' : r.canResearch && canAct ? 'can' : 'locked';
  const icon = TECH_ICONS[r.id] ?? BRANCH_ICONS[r.branch] ?? 'tech';
  const tile = BRANCH_TILE[r.branch] ?? '--tile-fog';
  const tipPos = `${p.y >= 50 ? 'tip-t' : 'tip-b'} ${p.x < 30 ? 'tip-l' : p.x > 70 ? 'tip-r' : 'tip-c'}`;
  const tierLabel = r.path ? `${cap(r.path)} · Tier ${r.tier}` : `Tier ${r.tier}`;
  const foot = r.owned
    ? 'Researched'
    : mode === 'can'
      ? 'Click to research'
      : r.canResearch
        ? 'Research on your turn'
        : r.reason || 'Not available yet';
  const click = mode === 'can' ? `onclick="researchTechClick('${esc(r.id)}')"` : '';
  // The server texts (`tech.ts`, pinned by the view snapshot) are older than these mechanics, so these nodes show the current rules instead.
  const descOverride: Record<string, string> = {
    'tidebound.fishing_nets': 'Unlocks Fishing Nets: put a net on one free sea tile that touches your settlement or city. It fishes only that tile, like a resource tile: each catch gives 1 fish per settlement and 2 per city of yours on it. Also lets your Settlements on 3:1 ports be raised to 2:1.',
    'tidebound.harbor_master': 'Unlocks Harbors: upgrade a city on a port to 1:1 trades (click the port; up to 4 trades per turn; it keeps working while flooded), and Feed the Sea: pay 1 wheat to refill the fishing ground under one of your nets (click the net tile).'
  };
  const descText = descOverride[r.id] ?? r.description;
  return `
    <div class="tp-node st-${mode}${p.lane ? ` lane-${p.lane}` : ''}" style="left:${p.x.toFixed(2)}%;top:${p.y.toFixed(2)}%;--bc:var(${tile})" tabindex="0" role="button"
         aria-label="${esc(r.name)}${r.owned ? ', researched' : `, ${r.cost} cards`}" ${click}>
      <div class="tp-disc">${uiIcon(icon, 30)}<span class="tp-tier" title="${esc(tierLabel)}">${esc(String(r.tier))}</span>${r.owned ? `<span class="tp-check">${uiIcon('check', 14)}</span>` : ''}</div>
      <div class="tp-cap"><span class="tp-name">${esc(r.name)}</span>${r.owned ? '' : costStripHtml(r.payment, hand)}</div>
      <div class="tp-tip ${tipPos}">
        <div class="tp-tip-head"><span class="tp-tip-name">${esc(r.name)}</span><span class="tp-tip-tier">${esc(tierLabel)}</span></div>
        <div class="tp-tip-desc">${esc(descText)}</div>
        <div class="tp-tip-foot ${r.owned ? 'owned' : mode === 'can' ? 'can' : ''}">${esc(foot)}</div>
      </div>
    </div>`;
}

/** Harbor charters: your cities (and settlements with Fishing nets) on a 3:1 port, each with one button that raises the whole port to 2:1. */
function harborHtml(h: NonNullable<TechActionsView['harbor']>, canAct: boolean, hand: Resources | undefined): string {
  const rows = h.ports.length === 0
    ? '<div class="tp-why">Build a city on a 3:1 port (or a settlement with Fishing nets) to raise it.</div>'
    : h.ports.map(p => {
        const bType = state?.board?.vertices?.[p.vertexId]?.building?.type;
        const bLabel = bType === 'settlement' ? 'Settlement' : 'City';
        if (p.level >= 1) {
          return `<div class="tp-port">${bLabel} #${p.vertexId} · <span class="tp-done">2:1 any resource</span></div>`;
        }
        const button = `<button class="tp-mini" type="button" ${canAct && h.affordable ? '' : 'disabled'} onclick="upgradePortClick(${p.vertexId})">Raise to 2:1</button>`;
        return `<div class="tp-port">${bLabel} #${p.vertexId} · 3:1 port<div class="tp-chips">${button}</div></div>`;
      }).join('');
  return `<div class="tp-extra"><div class="tp-extra-title">Raise the port ${costStripHtml(h.cost, hand)}</div>${rows}</div>`;
}

/** Ground work: pick one of your qualifying tiles, then the basic tile it becomes. One use per game. */
function groundHtml(w: NonNullable<TechActionsView['groundWork']>, canAct: boolean): string {
  const title = '<div class="tp-extra-title">Ground work · one use</div>';
  if (w.used) return `<div class="tp-extra">${title}<div class="tp-done">Used</div></div>`;
  if (w.hexes.length === 0) return `<div class="tp-extra">${title}<div class="tp-why">No land tile next to your settlements or cities qualifies yet.</div></div>`;
  if (pickedHex !== null && !w.hexes.some(h => h.hexId === pickedHex)) pickedHex = null;
  const chosen = w.hexes.find(h => h.hexId === pickedHex);
  const tiles = w.hexes.map(h =>
    `<button class="tp-mini ${h.hexId === pickedHex ? 'sel' : ''}" type="button" onclick="pickGroundHex(${h.hexId})">${esc(cap(h.type))} ${h.number === null ? '(no number)' : h.number} · #${h.hexId}</button>`
  ).join('');
  let picker = '<div class="tp-why">Pick a tile.</div>';
  if (chosen) {
    const note = chosen.number === null ? 'A number is rolled for it.' : `It keeps its ${chosen.number}.`;
    const buttons = w.choices.filter(c => c !== chosen.type).map(c =>
      `<button class="tp-mini" type="button" ${canAct ? '' : 'disabled'} onclick="convertTileClick('${esc(c)}')">${esc(cap(c))}</button>`
    ).join('');
    picker = `<div class="tp-why">${esc(note)} Turn it into:</div><div class="tp-chips">${buttons}</div>`;
  }
  return `<div class="tp-extra">${title}<div class="tp-chips">${tiles}</div>${picker}</div>`;
}

/** Called from renderAll. Shows the Tech button while the tree is on; redraws the panel when it is open and something changed. */
export function renderTechPanel(isMyTurn: boolean): void {
  ensureDom();
  const btn = document.getElementById('techPanelBtn') as HTMLElement;
  const panel = document.getElementById('techPanel') as HTMLElement;
  const rows = state && state.status !== 'LOBBY' ? state.techTree : null;
  if (!rows) {
    btn.style.display = 'none';
    btn.classList.remove('active-mode');
    panel.style.display = 'none';
    open = false;
    lastHtml = '';
    return;
  }
  btn.style.display = '';
  btn.classList.toggle('active-mode', open);
  panel.style.display = open ? 'flex' : 'none';
  if (!open) {
    lastHtml = '';
    return;
  }

  const canAct = isMyTurn && state.phase === 'MAIN';
  const hand = state.players.find(p => p.id === socket.id)?.resources;
  const actions = state.techActions;
  const branches: string[] = [];
  for (const r of rows) if (!branches.includes(r.branch)) branches.push(r.branch);
  const { placed, radii, maxRing } = layout(rows, branches);
  const at = new Map(placed.map(p => [p.row.id, p]));

  const rings = [...radii.values()].map(rad => `<circle class="tp-ring" cx="50" cy="50" r="${rad}"/>`).join('');
  const lines = placed.map(p => {
    const parents = p.row.prereqs.map(id => at.get(id)).filter((q): q is Placed => !!q);
    const from = parents.length > 0 ? parents : [{ x: 50, y: 50 } as Placed];
    return from.map(q => `<line class="tp-line ${p.row.owned ? 'owned' : ''}${p.lane ? ` lane-${p.lane}` : ''}" x1="${q.x.toFixed(2)}" y1="${q.y.toFixed(2)}" x2="${p.x.toFixed(2)}" y2="${p.y.toFixed(2)}"/>`).join('');
  }).join('');
  const nodes = placed.map(p => nodeHtml(p, canAct, hand)).join('');

  const extras = [
    actions?.harbor ? harborHtml(actions.harbor, canAct, hand) : '',
    actions?.groundWork ? groundHtml(actions.groundWork, canAct) : ''
  ].join('');
  const hint = canAct
    ? 'Click a highlighted tech to research it. Hover for details. Prices grow with your settlements and cities.'
    : 'You can research on your own turn, after the roll. Hover a tech for details.';

  const html = `
    <div class="tp-card">
      <div class="tp-head"><h3>Tech tree</h3><div class="tp-zoom"><button class="btn sm" type="button" data-tz="out" title="Zoom out" aria-label="Zoom out">-</button><button class="btn sm" type="button" data-tz="in" title="Zoom in" aria-label="Zoom in">+</button><button class="btn sm" type="button" data-tz="reset" title="Scroll to zoom, drag to pan">Reset view</button><button class="btn sm" type="button" onclick="toggleTechPanel(false)">Close</button></div></div>
      <div class="tp-sub">${esc(hint)}</div>
      <div class="tp-stage${maxRing >= 4 ? ' tp-deep' : ''}">
        <div class="tp-world">
          <svg class="tp-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${rings}${lines}</svg>
          <div class="tp-hub">${uiIcon('tech', 26)}<span>Tech</span></div>
          ${nodes}
        </div>
      </div>
      ${extras ? `<div class="tp-actions">${extras}</div>` : ''}
    </div>`;
  // Skip the redraw when nothing changed, so a hovered description does not flicker on every broadcast.
  if (html !== lastHtml) {
    panel.innerHTML = html;
    lastHtml = html;
    applyView();
  }
}

function myTurnNow(): boolean {
  if (!state) return false;
  const me = state.players.find(p => p.id === socket.id);
  const current = state.players[state.turnIndex];
  return Boolean(me && (state.currentPlayerId === socket.id || (current && current.id === socket.id)));
}

export function toggleTechPanel(force?: boolean): void {
  const wasOpen = open;
  open = typeof force === 'boolean' ? force : !open;
  if (open && !wasOpen) view = FIT_VIEW;
  playTone(open ? 560 : 460, 0.05);
  if (!state) return;
  renderTechPanel(myTurnNow());
}

export function researchTechClick(techId: string): void {
  if (!state?.code) return;
  socket.emit('act', { code: state.code, type: 'research_tech', payload: { techId } });
  playTone(600, 0.08);
}

/** Harbor charters: raise the port under the city on vertex `vertexId` from 3:1 to 2:1 for every resource. */
export function upgradePortClick(vertexId: number): void {
  if (!state?.code) return;
  socket.emit('act', { code: state.code, type: 'upgrade_port', payload: { vertexId } });
  playTone(600, 0.08);
}

/** Ground work, step 1: remember which tile the player picked, then show the resource choice. */
export function pickGroundHex(hexId: number): void {
  pickedHex = pickedHex === hexId ? null : hexId;
  playTone(520, 0.04);
  if (state) renderTechPanel(myTurnNow());
}

/** Ground work, step 2: turn the picked tile into the basic tile `resource`. */
export function convertTileClick(resource: string): void {
  if (!state?.code || pickedHex === null) return;
  socket.emit('act', { code: state.code, type: 'convert_tile', payload: { hexId: pickedHex, resource } });
  pickedHex = null;
  playTone(600, 0.08);
}
