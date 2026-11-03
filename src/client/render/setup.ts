// MODULE: world setup page (host only, between the name page and the board): which screen shows, tile preview, roster, scenarios, DLC cards | DEPENDS ON: client/avatars, client/icons, client/socket, client/store, client/types, client/util | USED BY: client/render/index
// The controls on the page (bots, presets, map menu, rules) keep their ids and handlers; this file decides what is visible
// and draws the preview, player strip, scenario presets, live "what is on" summary, and DLC/addon cards from mapOptions.
import { socket } from '../socket';
import { mapOptions, state } from '../store';
import { avatarFace } from '../avatars';
import { uiIcon } from '../icons';
import { esc } from '../util';
import type { AddonInfoView, DlcInfoView, ScenarioPresetView } from '../types';

let lastPreviewSig = '';
let lastRosterSig = '';
let lastDlcSig = '';

/** Names of the Tides slider positions (1 to 5). Must match TIDE_LEVELS in packs/tidebound/tides.ts. */
const TIDE_LEVEL_NAMES = ['Very low', 'Low', 'Medium', 'High', 'Very high'];
/** Names of the Rising sea slider positions (1 to 5). Must match RISING_SEA_LEVELS in packs/tidebound/risingSea.ts. */
const RISING_SEA_LEVEL_NAMES = ['Very slow', 'Slow', 'Medium', 'Fast', 'Very fast'];

/** Built-in catalog fallback for DLC packs not yet registered in the server registry, matching Ideas.md exactly. */
const CATALOG_DLCS: DlcInfoView[] = [
  {
    id: 'tidebound',
    name: 'Tidebound',
    addons: [
      'tidebound.bridges',
      'tidebound.rickety_bridges',
      'tidebound.tides',
      'tidebound.rising_sea',
      'tidebound.harbor',
      'tidebound.fishing',
      'tidebound.wrecks',
      'tidebound.pirates'
    ]
  },
  {
    id: 'bulwark',
    name: 'Bulwark',
    addons: [
      'bulwark.walls',
      'bulwark.wall_tiers',
      'bulwark.siege',
      'bulwark.castle',
      'bulwark.wall_decay',
      'bulwark.gatehouse',
      'bulwark.castle_sieges',
      'bulwark.sea_wall'
    ]
  },
  {
    id: 'warlords',
    name: 'Warlords',
    addons: [
      'warlords.knights_armies',
      'warlords.mercenaries',
      'warlords.war_mechanic',
      'warlords.diplomacy',
      'warlords.alliances',
      'warlords.wave_defense',
      'warlords.king_vs_peasant',
      'warlords.ai_warlord',
      'warlords.war_weariness'
    ]
  },
  {
    id: 'wildearth',
    name: 'Wild Earth',
    addons: [
      'wildearth.gems',
      'wildearth.gem_market',
      'wildearth.volcano',
      'wildearth.oasis',
      'wildearth.seasons',
      'wildearth.meteor',
      'wildearth.plague',
      'wildearth.aftermath',
      'wildearth.biome_tags',
      'wildearth.quarantine_card',
      'wildearth.plague_doctor'
    ]
  },
  {
    id: 'guildhall',
    name: 'Guildhall',
    addons: [
      'guildhall.sheep_economy',
      'guildhall.debt',
      'guildhall.debt_tieins',
      'guildhall.landmarks',
      'guildhall.landmark_bonus',
      'guildhall.ruins',
      'guildhall.monuments',
      'guildhall.caravans'
    ]
  },
  {
    id: 'rowdy',
    name: 'Rowdy Tavern',
    addons: [
      'rowdy.hat_day',
      'rowdy.drunk_robber',
      'rowdy.karaoke7',
      'rowdy.duels',
      'rowdy.drinking_game',
      'rowdy.instigation',
      'rowdy.hat_unlocks',
      'rowdy.hat_of_shame'
    ]
  }
];

const CATALOG_ADDONS: AddonInfoView[] = [
  // 3. Tidebound
  { id: 'tidebound.bridges', name: 'Bridges', description: 'Roads across the sea. Both ends must touch ocean; they count toward Longest Road.', pack: 'tidebound', deps: [], links: [{ target: 'piece-cost', kind: 'mechanic' }, { target: 'history', kind: 'mechanic' }, { target: 'bot-goals', kind: 'bot' }] },
  { id: 'tidebound.rickety_bridges', name: 'Rickety bridges', description: 'A cheap bridge with 1 health that collapses on a 7. Upgrade it to a full bridge later.', pack: 'tidebound', deps: ['tidebound.bridges'], links: [{ target: 'durability', kind: 'mechanic' }, { target: 'seven-resolver', kind: 'mechanic' }, { target: 'overlay', kind: 'ui' }, { target: 'tidebound.bridges', kind: 'content' }] },
  { id: 'tidebound.tides', name: 'Tides', description: 'Coast tiles flood on a seeded schedule; a flooded tile yields half, rounded up, for every settlement and city on it. Higher ground resists.', pack: 'tidebound', deps: [], links: [{ target: 'round-clock', kind: 'mechanic' }, { target: 'tile-state', kind: 'mechanic' }, { target: 'production', kind: 'mechanic' }, { target: 'overlay', kind: 'ui' }] },
  { id: 'tidebound.rising_sea', name: 'Rising sea', description: 'Land drowns from the lowest ground up. Bridges become the only roads. Works alone or with Tides.', pack: 'tidebound', deps: [], links: [{ target: 'tile-state', kind: 'mechanic' }, { target: 'round-clock', kind: 'mechanic' }, { target: 'tidebound.tides', kind: 'content' }] },
  { id: 'tidebound.harbor', name: 'Harbor', description: 'Upgrade a port city to a harbor for 1:1 trades: click the port itself. One per player. A harbor, and any port raised to 2:1, keeps working while flooded.', pack: 'tidebound', deps: [], links: [{ target: 'trade-ratio', kind: 'mechanic' }, { target: 'piece-cost', kind: 'mechanic' }, { target: 'tidebound.tides', kind: 'mechanic' }] },
  { id: 'tidebound.fishing', name: 'Fishing', description: 'A net on a sea tile catches fish, a token that counts as any one resource. Fish icons on the sea boost the catch; feed the sea to refill them.', pack: 'tidebound', deps: [], links: [{ target: 'wild-token', kind: 'mechanic' }, { target: 'marker', kind: 'mechanic' }, { target: 'piece-cost', kind: 'mechanic' }, { target: 'tidebound.tides', kind: 'content' }] },
  { id: 'tidebound.wrecks', name: 'Shipwreck salvage', description: 'A storm leaves a wreck at sea or on the shore. The first road, bridge or port to reach it claims the loot.', pack: 'tidebound', deps: [], links: [{ target: 'marker', kind: 'mechanic' }, { target: 'event-deck', kind: 'content' }, { target: 'overlay', kind: 'ui' }, { target: 'tidebound.bridges', kind: 'mechanic' }] },
  { id: 'tidebound.pirates', name: 'Pirates', description: 'Up to 2 pirates roam the ocean and rob coastal settlements. Beating one takes knights, and it pays more than a wreck.', pack: 'tidebound', deps: [], links: [{ target: 'strength', kind: 'mechanic' }, { target: 'marker', kind: 'mechanic' }, { target: 'bot-goals', kind: 'bot' }, { target: 'tidebound.wrecks', kind: 'content' }] },

  // 4. Bulwark
  { id: 'bulwark.walls', name: 'Walls & Zone Control', description: 'Build wall rings on edges to enclose territory; controller taxes outside production (~30%).', pack: 'bulwark', deps: [], links: [{ target: 'tile-state', kind: 'mechanic' }, { target: 'production', kind: 'mechanic' }] },
  { id: 'bulwark.wall_tiers', name: 'Wall Tiers', description: 'Upgrade from wooden palisade to permanent stone wall or ore-reinforced siege wall.', pack: 'bulwark', deps: ['bulwark.walls'], links: [{ target: 'durability', kind: 'mechanic' }, { target: 'piece-cost', kind: 'mechanic' }] },
  { id: 'bulwark.siege', name: 'Siege', description: 'Break enemy walls with siege engines while defenders burn resources to repair.', pack: 'bulwark', deps: ['bulwark.walls'], links: [{ target: 'durability', kind: 'mechanic' }, { target: 'strength', kind: 'mechanic' }] },
  { id: 'bulwark.castle', name: 'Castle', description: 'Upgrade a city using all 5 resources for 4x production and 3 public VP.', pack: 'bulwark', deps: [], links: [{ target: 'score', kind: 'mechanic' }, { target: 'production', kind: 'mechanic' }] },
  { id: 'bulwark.wall_decay', name: 'Wall Decay', description: 'Wooden palisades lose durability on a 7 roll unless repaired with wood.', pack: 'bulwark', deps: ['bulwark.walls'], links: [{ target: 'seven-resolver', kind: 'mechanic' }, { target: 'durability', kind: 'mechanic' }] },
  { id: 'bulwark.gatehouse', name: 'Gatehouse', description: 'Grant taxed building permits inside your wall; if a guest exceeds your local VP, they overthrow you.', pack: 'bulwark', deps: ['bulwark.walls'], links: [{ target: 'ledger', kind: 'mechanic' }, { target: 'overlay', kind: 'ui' }] },
  { id: 'bulwark.castle_sieges', name: 'Castle Sieges', description: 'A besieged castle produces half until the siege breaks.', pack: 'bulwark', deps: ['bulwark.castle', 'bulwark.siege'], links: [{ target: 'production', kind: 'mechanic' }, { target: 'strength', kind: 'mechanic' }] },
  { id: 'bulwark.sea_wall', name: 'Sea Wall', description: 'Coastline walls block Tides and Rising Sea for enclosed tiles.', pack: 'bulwark', deps: ['bulwark.walls'], links: [{ target: 'tile-state', kind: 'mechanic' }, { target: 'durability', kind: 'mechanic' }] },

  // 5. Warlords
  { id: 'warlords.knights_armies', name: 'Knights as Armies', description: 'Play knights in classic robber mode or recruit mode to garrison strength tokens on buildings and walls.', pack: 'warlords', deps: [], links: [{ target: 'strength', kind: 'mechanic' }, { target: 'bot-goals', kind: 'bot' }] },
  { id: 'warlords.mercenaries', name: 'Mercenaries', description: 'Pay ore and wheat to the bank to hire temporary strength for one round.', pack: 'warlords', deps: ['warlords.knights_armies'], links: [{ target: 'strength', kind: 'mechanic' }, { target: 'round-clock', kind: 'mechanic' }] },
  { id: 'warlords.war_mechanic', name: 'War Mechanic', description: 'Declare war by spending a knight; warring kingdoms cannot trade until a peace offer is accepted.', pack: 'warlords', deps: ['warlords.knights_armies'], links: [{ target: 'relations', kind: 'mechanic' }, { target: 'overlay', kind: 'ui' }] },
  { id: 'warlords.diplomacy', name: 'Diplomacy & Embassies', description: 'Envoys, Peace pacts, and Embassies that trade at partner ports even at war.', pack: 'warlords', deps: [], links: [{ target: 'relations', kind: 'mechanic' }, { target: 'trade-ratio', kind: 'mechanic' }] },
  { id: 'warlords.alliances', name: 'Alliances & Betrayal', description: 'Share wall zones and garrisons with an ally, or betray them at a treaty-break penalty.', pack: 'warlords', deps: ['warlords.diplomacy'], links: [{ target: 'relations', kind: 'mechanic' }, { target: 'history', kind: 'mechanic' }] },
  { id: 'warlords.wave_defense', name: 'Wave Defense (Co-op)', description: 'Scheduled raider waves arrive from the sea edge; players spread garrison strength to defend.', pack: 'warlords', deps: ['warlords.knights_armies'], links: [{ target: 'strength', kind: 'mechanic' }, { target: 'marker', kind: 'mechanic' }] },
  { id: 'warlords.king_vs_peasant', name: 'King vs. Peasant', description: 'Massive central walled zone where the first occupant becomes King against the table.', pack: 'warlords', deps: ['bulwark.walls'], allowCrossDlcDep: true, links: [{ target: 'score', kind: 'mechanic' }, { target: 'relations', kind: 'mechanic' }] },
  { id: 'warlords.ai_warlord', name: 'Player vs. AI Warlord', description: 'Persistent named AI Warlord invades the leader or holds the fortified center.', pack: 'warlords', deps: ['warlords.knights_armies'], links: [{ target: 'persistence', kind: 'mechanic' }, { target: 'bot-goals', kind: 'bot' }] },
  { id: 'warlords.war_weariness', name: 'War Weariness', description: 'Staying at war for many rounds worsens port trade ratios, pushing peace deals.', pack: 'warlords', deps: ['warlords.war_mechanic'], links: [{ target: 'trade-ratio', kind: 'mechanic' }, { target: 'round-clock', kind: 'mechanic' }] },

  // 6. Wild Earth
  { id: 'wildearth.gems', name: 'Emerald & Diamond Tiles', description: 'Rare gem tiles with their own 2:1 or 1:1 gem ports and special dev cards.', pack: 'wildearth', deps: [], links: [{ target: 'production', kind: 'mechanic' }, { target: 'trade-ratio', kind: 'mechanic' }] },
  { id: 'wildearth.gem_market', name: 'Gem Market', description: 'Gems trade exclusively at gem ports and fund special development cards.', pack: 'wildearth', deps: ['wildearth.gems'], links: [{ target: 'trade-ratio', kind: 'mechanic' }, { target: 'bot-goals', kind: 'bot' }] },
  { id: 'wildearth.volcano', name: 'Volcano', description: 'High-ore gamble tile that erupts on 7s, destroying the nearest settlement and leaving ash then fertile soil.', pack: 'wildearth', deps: [], links: [{ target: 'seven-resolver', kind: 'mechanic' }, { target: 'tile-state', kind: 'mechanic' }] },
  { id: 'wildearth.oasis', name: 'Oasis in the Desert', description: 'Desert oasis tile that yields a wild resource of your choice at low odds.', pack: 'wildearth', deps: [], links: [{ target: 'wild-token', kind: 'mechanic' }, { target: 'production', kind: 'mechanic' }] },
  { id: 'wildearth.seasons', name: 'Seasons', description: 'Every N rounds, biological tiles (sheep, wheat, wood) shift their roll numbers.', pack: 'wildearth', deps: [], links: [{ target: 'round-clock', kind: 'mechanic' }, { target: 'production', kind: 'mechanic' }] },
  { id: 'wildearth.meteor', name: 'Meteor Crater', description: 'Falling star event that removes a tile and leaves a gold or gem crater.', pack: 'wildearth', deps: [], links: [{ target: 'event-deck', kind: 'content' }, { target: 'tile-state', kind: 'mechanic' }] },
  { id: 'wildearth.plague', name: 'Plague', description: 'Spreads from settlement to settlement (faster in wheat/sheep clumps); walls and markets quarantine it.', pack: 'wildearth', deps: [], links: [{ target: 'tile-state', kind: 'mechanic' }, { target: 'overlay', kind: 'ui' }] },
  { id: 'wildearth.aftermath', name: 'Aftermath & Ground Work', description: 'Barren tiles from eruptions or meteors regrow over time or convert via Ground Work tech.', pack: 'wildearth', deps: [], links: [{ target: 'tile-state', kind: 'mechanic' }, { target: 'round-clock', kind: 'mechanic' }] },
  { id: 'wildearth.biome_tags', name: 'Biome Tags', description: 'Connected forest and field clusters swing together in Seasons and accelerate Plague in monocultures.', pack: 'wildearth', deps: [], links: [{ target: 'tile-state', kind: 'mechanic' }, { target: 'bot-goals', kind: 'bot' }] },
  { id: 'wildearth.quarantine_card', name: 'Quarantine Card', description: 'Development card that grants a settlement immunity from Plague spread.', pack: 'wildearth', deps: ['wildearth.plague'], links: [{ target: 'tile-state', kind: 'mechanic' }, { target: 'bot-goals', kind: 'bot' }] },
  { id: 'wildearth.plague_doctor', name: 'Plague Doctor Tech', description: 'Wild Earth tech branch that shortens plague duration and cures settlements.', pack: 'wildearth', deps: ['wildearth.plague'], links: [{ target: 'tile-state', kind: 'mechanic' }, { target: 'round-clock', kind: 'mechanic' }] },

  // 7. Guildhall
  { id: 'guildhall.sheep_economy', name: 'Sheep Economy', description: 'Sheep act as currency for fees and interest, and sheep ports pay triple.', pack: 'guildhall', deps: [], links: [{ target: 'trade-ratio', kind: 'mechanic' }, { target: 'ledger', kind: 'mechanic' }] },
  { id: 'guildhall.debt', name: 'Debt', description: 'Borrow cards from the bank on credit and repay with interest, or have a settlement seized.', pack: 'guildhall', deps: [], links: [{ target: 'ledger', kind: 'mechanic' }, { target: 'round-clock', kind: 'mechanic' }] },
  { id: 'guildhall.debt_tieins', name: 'Debt Tie-ins', description: 'Unpaid debt turns a settlement into an occupied token that can be bought back; Embassies protect against seizure.', pack: 'guildhall', deps: ['guildhall.debt'], links: [{ target: 'marker', kind: 'mechanic' }, { target: 'ledger', kind: 'mechanic' }] },
  { id: 'guildhall.landmarks', name: 'Landmarks', description: 'First-claim Lighthouse, Library, Market, Granary and Outpost bonuses on resource tiles.', pack: 'guildhall', deps: [], links: [{ target: 'trade-ratio', kind: 'mechanic' }, { target: 'piece-cost', kind: 'mechanic' }] },
  { id: 'guildhall.landmark_bonus', name: 'Landmark Set Bonus', description: 'Owning 3 or 5 unique landmark types grants bonus public VP.', pack: 'guildhall', deps: ['guildhall.landmarks'], links: [{ target: 'score', kind: 'mechanic' }, { target: 'bot-goals', kind: 'bot' }] },
  { id: 'guildhall.ruins', name: 'Ruins (Landmark)', description: 'Polytopia-style ruins that grant one-time loot when a road touches them and count as a landmark.', pack: 'guildhall', deps: ['guildhall.landmarks'], links: [{ target: 'marker', kind: 'mechanic' }, { target: 'score', kind: 'mechanic' }] },
  { id: 'guildhall.monuments', name: 'Monuments', description: 'Completing a Tier 3 public contract unlocks a one-per-game Monument worth bonus public VP.', pack: 'guildhall', deps: [], links: [{ target: 'score', kind: 'mechanic' }, { target: 'piece-cost', kind: 'mechanic' }] },
  { id: 'guildhall.caravans', name: 'Trade Caravans', description: 'Route caravans between cities or ports along unblocked roads, bridges and open gates for a payout.', pack: 'guildhall', deps: [], links: [{ target: 'marker', kind: 'mechanic' }, { target: 'production', kind: 'mechanic' }] },

  // 8. Rowdy Tavern
  { id: 'rowdy.hat_day', name: 'Hat Day', description: 'Every settlement and city wears a random hat during Hat Day, with bot commentary.', pack: 'rowdy', deps: [], links: [{ target: 'event-deck', kind: 'content' }, { target: 'overlay', kind: 'ui' }] },
  { id: 'rowdy.drunk_robber', name: 'Drunk Robber', description: 'Robber wanders one hex in a random direction after each roll; controlled by whoever is in last place.', pack: 'rowdy', deps: [], links: [{ target: 'score', kind: 'mechanic' }, { target: 'tile-state', kind: 'mechanic' }] },
  { id: 'rowdy.karaoke7', name: 'Karaoke 7', description: 'On a 7, everyone races to type a one-word chat message; the slowest loses a card.', pack: 'rowdy', deps: [], links: [{ target: 'seven-resolver', kind: 'mechanic' }, { target: 'history', kind: 'mechanic' }] },
  { id: 'rowdy.duels', name: 'Robbery Minigames', description: 'Resolve robber steals and contested claims with fast 1v1 tavern duels.', pack: 'rowdy', deps: [], links: [{ target: 'overlay', kind: 'ui' }, { target: 'history', kind: 'mechanic' }] },
  { id: 'rowdy.drinking_game', name: 'Bot Drinking Game', description: 'Bots comment on dice streaks and repeated robber hits, with optional pity card for hammered players.', pack: 'rowdy', deps: [], links: [{ target: 'history', kind: 'mechanic' }, { target: 'bot-goals', kind: 'bot' }] },
  { id: 'rowdy.instigation', name: 'Instigation', description: 'Bots stir rivalries between players based on public match history and grudges.', pack: 'rowdy', deps: [], links: [{ target: 'history', kind: 'mechanic' }, { target: 'relations', kind: 'mechanic' }] },
  { id: 'rowdy.hat_unlocks', name: 'Hat Unlocks', description: 'Unlock persistent hats from end-game achievements (Longest Road, Largest Army, trades, robber hits).', pack: 'rowdy', deps: [], links: [{ target: 'persistence', kind: 'mechanic' }, { target: 'history', kind: 'mechanic' }] },
  { id: 'rowdy.hat_of_shame', name: 'Hat of Shame', description: 'Joke hat awarded to whoever lost the most cards to the robber this game.', pack: 'rowdy', deps: [], links: [{ target: 'history', kind: 'mechanic' }, { target: 'persistence', kind: 'mechanic' }] }
];

function effectiveDlcsAndAddons(): { dlcs: DlcInfoView[]; addons: Map<string, AddonInfoView> } {
  const srvDlcs = mapOptions?.dlcs && mapOptions.dlcs.length > 0 ? mapOptions.dlcs : [];
  const srvAddons = mapOptions?.addons && mapOptions.addons.length > 0 ? mapOptions.addons : [];
  const dlcMap = new Map<string, DlcInfoView>();
  for (const d of CATALOG_DLCS) dlcMap.set(d.id, d);
  for (const d of srvDlcs) dlcMap.set(d.id, d);

  const addonMap = new Map<string, AddonInfoView>();
  for (const a of CATALOG_ADDONS) addonMap.set(a.id, a);
  for (const a of srvAddons) addonMap.set(a.id, a);
  return { dlcs: [...dlcMap.values()], addons: addonMap };
}

/** Tiles only: no number tokens, ports, robber or pieces. Water stays empty so the shape reads on its own. */
function drawPreview(svg: Element): void {
  const hexes = (state?.board?.hexes || []).filter((h: any) => h.type !== 'water' && Array.isArray(h.corners) && h.corners.length === 6);
  const sig = hexes.map((h: any) => `${h.q},${h.r},${h.type}`).join('|');
  if (sig === lastPreviewSig) return;
  lastPreviewSig = sig;
  if (hexes.length === 0) {
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.innerHTML = '<text x="50" y="52" text-anchor="middle" class="pv-empty">No land</text>';
    return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const h of hexes) {
    for (const c of h.corners) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
    }
  }
  const pad = 12;
  svg.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`);
  svg.innerHTML = hexes.map((h: any) => {
    const pts = h.corners.map((c: any) => `${c.x},${c.y}`).join(' ');
    return `<polygon class="pv-hex" points="${pts}" style="fill:var(--tile-${esc(h.type)}, var(--surface-3))"></polygon>`;
  }).join('');
}

function drawRoster(el: HTMLElement): void {
  const players = state?.players || [];
  const spectators = state?.spectators || [];
  const sig =
    players.map(p => `${p.id}|${p.name}|${p.avatar}|${p.color}|${p.difficulty ?? ''}`).join(';') +
    '||' +
    spectators.map(s => `${s.id}|${s.name}|${s.avatar}|${s.color}`).join(';') +
    `|${state?.settings?.maxPlayers}|${state?.hostId}`;
  if (sig === lastRosterSig) return;
  lastRosterSig = sig;
  const chips = players.map(p => {
    const key = String(p.difficulty || '').toLowerCase();
    const tag = p.isBot
      ? `<span class="tag tier-${esc(key)} tier-pick" onclick="cycleBotTier('${esc(p.id)}')" title="Click to change difficulty">Bot · ${esc(p.difficulty || '')}</span>`
      : p.id === state?.hostId ? '<span class="tag accent">Host</span>' : '';
    const pick = p.isBot || p.id === socket.id;
    return `<div class="setup-chip">
      <div class="avatar p-avatar ${pick ? 'avatar-pick' : ''}" style="background:${esc(p.color)}"
        ${pick ? `onclick="cycleAvatar('${esc(p.id)}')" title="Click to change avatar"` : ''}>${avatarFace(p.avatar, p.name)}</div>
      <span class="nm">${esc(p.name)}</span>${tag}
    </div>`;
  }).join('');
  const specChips = spectators.map(s => {
    const hostTag = s.id === state?.hostId ? '<span class="tag accent">Host</span>' : '';
    const pick = s.id === socket.id;
    return `<div class="setup-chip is-spectator">
      <div class="avatar p-avatar ${pick ? 'avatar-pick' : ''}" style="background:${esc(s.color)}"
        ${pick ? `onclick="cycleAvatar('${esc(s.id)}')" title="Click to change avatar"` : ''}>${avatarFace(s.avatar, s.name)}</div>
      <span class="nm">${esc(s.name)}</span>${hostTag}<span class="tag">${uiIcon('eye', 12)} Spectating</span>
    </div>`;
  }).join('');
  const specCount = spectators.length > 0 ? ` · ${spectators.length} spectating` : '';
  el.innerHTML = `<div class="setup-count">${players.length} / ${esc(state?.settings?.maxPlayers ?? '')} seats${specCount}</div>${chips}${specChips}`;
}

function drawScenariosAndDlcs(): void {
  const s = state?.settings || {};
  const dlcMap: Record<string, boolean> = s.dlc && typeof s.dlc === 'object' ? s.dlc : {};
  const addonFlags: Record<string, boolean> = s.addons && typeof s.addons === 'object' ? s.addons : {};
  const eventsOn = !!s.eventsOn;
  const fateTokens = s.fateTokens ?? 2;
  const techTreeOn = !!s.techTreeOn;
  const fairDice = !!s.fairDice;
  const tideLevel = Math.min(5, Math.max(1, Math.round(Number(s.tideLevel)) || 3));
  const risingSeaLevel = Math.min(5, Math.max(1, Math.round(Number(s.risingSeaLevel)) || 3));
  const scenarios: ScenarioPresetView[] = mapOptions?.scenarios || [];
  const { dlcs, addons } = effectiveDlcsAndAddons();

  const sig = JSON.stringify([dlcMap, addonFlags, eventsOn, fateTokens, techTreeOn, fairDice, tideLevel, risingSeaLevel, s.vpToWin, s.boardRadius, scenarios.length, dlcs.length]);
  if (sig === lastDlcSig) return;
  lastDlcSig = sig;

  // 1. Scenarios row
  const scenBox = document.getElementById('scenarioPresets');
  if (scenBox) {
    scenBox.innerHTML = scenarios
      .map(sc => {
        const dlcKeys = Object.keys(sc.dlc).filter(k => sc.dlc[k]);
        const isCurrent =
          s.boardRadius === sc.boardRadius &&
          s.vpToWin === sc.vpToWin &&
          Boolean(s.eventsOn) === Boolean(sc.eventsOn) &&
          dlcKeys.every(k => dlcMap[k] === true) &&
          Object.keys(dlcMap).filter(k => dlcMap[k]).length === dlcKeys.length;
        return `<button type="button" class="chip-btn${isCurrent ? ' chip-accent' : ''}" onclick="applyScenario('${esc(sc.id)}')" title="${esc(sc.description)}">${esc(sc.label)}</button>`;
      })
      .join('');
  }

  // 2. Compute enabled & blocked addons (mirrors shared resolveAddons)
  const enabledAddons = new Set<string>();
  const blockedAddons: { addon: AddonInfoView; missing: string[] }[] = [];
  for (const d of dlcs) {
    if (dlcMap[d.id] !== true) continue;
    for (const aId of d.addons) {
      const a = addons.get(aId);
      if (!a) continue;
      if (addonFlags[a.id] === false) continue;
      const missing = (a.deps || []).filter(depId => !enabledAddons.has(depId));
      if (missing.length > 0) blockedAddons.push({ addon: a, missing });
      else enabledAddons.add(a.id);
    }
  }

  // 3. Live "what is on" summary strip
  const summaryBox = document.getElementById('setupActiveSummary');
  if (summaryBox) {
    const activeDlcNames = dlcs.filter(d => dlcMap[d.id] === true).map(d => d.name);
    const pills: string[] = [];
    pills.push(`<span class="summary-pill accent">${esc(s.vpToWin ?? 10)} VP · Radius ${esc(s.boardRadius ?? 2)}</span>`);
    if (activeDlcNames.length === 0) {
      pills.push(`<span class="summary-pill">Base game only (0 DLCs)</span>`);
    } else {
      pills.push(`<span class="summary-pill on">${activeDlcNames.length} DLC${activeDlcNames.length === 1 ? '' : 's'}: ${esc(activeDlcNames.join(', '))}</span>`);
      pills.push(`<span class="summary-pill">${enabledAddons.size} addon${enabledAddons.size === 1 ? '' : 's'} active</span>`);
    }
    pills.push(
      eventsOn
        ? `<span class="summary-pill on">Events ON · ${esc(fateTokens)} Fate token${fateTokens === 1 ? '' : 's'}</span>`
        : `<span class="summary-pill">Events off</span>`
    );
    pills.push(techTreeOn ? `<span class="summary-pill on">Tech tree ON</span>` : `<span class="summary-pill">Tech tree off</span>`);
    if (fairDice) pills.push(`<span class="summary-pill on">Fair dice ON</span>`);
    if (enabledAddons.has('tidebound.tides')) pills.push(`<span class="summary-pill on">Tides · ${esc(TIDE_LEVEL_NAMES[tideLevel - 1])}</span>`);
    if (enabledAddons.has('tidebound.rising_sea')) pills.push(`<span class="summary-pill on">Rising sea · ${esc(RISING_SEA_LEVEL_NAMES[risingSeaLevel - 1])}</span>`);

    const blockedHtml = blockedAddons
      .map(b => {
        const missNames = b.missing.map(m => addons.get(m)?.name || m).join(', ');
        return `<div class="dlc-dep-prompt">
          <span><strong>${esc(b.addon.name)}</strong> needs <strong>${esc(missNames)}</strong> to activate.</span>
          <button type="button" class="chip-btn chip-accent" onclick="enableAddonWithDeps('${esc(b.addon.id)}')">Enable ${esc(missNames)}</button>
        </div>`;
      })
      .join('');

    summaryBox.innerHTML = `<div class="summary-pills-row"><span class="tool-label">Active</span>${pills.join('')}</div>${blockedHtml}`;
  }

  // 4. DLC cards grid
  const grid = document.getElementById('setupDlcGrid');
  if (grid) {
    grid.innerHTML = dlcs
      .map(d => {
        const isDlcOn = dlcMap[d.id] === true;
        const addonList = d.addons.map(id => addons.get(id)).filter((a): a is AddonInfoView => !!a);
        const activeCount = addonList.filter(a => enabledAddons.has(a.id)).length;
        const rowsHtml = addonList
          .map(a => {
            const rawWanted = isDlcOn && addonFlags[a.id] !== false;
            const isActuallyOn = enabledAddons.has(a.id);
            const missingDeps = (a.deps || []).filter(depId => !enabledAddons.has(depId));
            const isBlocked = rawWanted && missingDeps.length > 0;
            const depLabels = missingDeps.map(m => addons.get(m)?.name || m).join(', ');
            return `
              <div class="dlc-addon-row${isActuallyOn ? ' on' : ''}${isBlocked ? ' blocked' : ''}">
                <label class="dlc-addon-label" title="${esc(a.description || '')}">
                  <input type="checkbox" ${rawWanted ? 'checked' : ''} ${!isDlcOn ? 'disabled' : ''}
                    onclick="event.preventDefault(); toggleAddon('${esc(a.id)}')" />
                  <span class="dlc-addon-name">${esc(a.name)}</span>
                </label>
                ${a.description ? `<span class="dlc-addon-desc">${esc(a.description)}</span>` : ''}
                ${
                  a.id === 'tidebound.tides' && isActuallyOn
                    ? `<div class="dlc-addon-opt" title="High tides come more often, stay longer, reach deeper inland and flood higher ground. Low tides are the opposite.">
                        <span class="dlc-addon-opt-label">Tide level: <strong id="tideLevelName">${esc(TIDE_LEVEL_NAMES[tideLevel - 1])}</strong></span>
                        <input type="range" min="1" max="5" step="1" value="${tideLevel}" aria-label="Tide level"
                          oninput="previewTideLevel(this.value)" onchange="setTideLevel(this.value)" />
                        <span class="dlc-addon-opt-ends"><span>Low</span><span>High</span></span>
                      </div>`
                    : ''
                }
                ${
                  a.id === 'tidebound.rising_sea' && isActuallyOn
                    ? `<div class="dlc-addon-opt" title="Faster rising sea starts earlier and drowns coastal land more often. Slower gives more rounds before the coast shrinks.">
                        <span class="dlc-addon-opt-label">Rising rate: <strong id="risingSeaLevelName">${esc(RISING_SEA_LEVEL_NAMES[risingSeaLevel - 1])}</strong></span>
                        <input type="range" min="1" max="5" step="1" value="${risingSeaLevel}" aria-label="Rising sea rate"
                          oninput="previewRisingSeaLevel(this.value)" onchange="setRisingSeaLevel(this.value)" />
                        <span class="dlc-addon-opt-ends"><span>Slow</span><span>Fast</span></span>
                      </div>`
                    : ''
                }
                ${
                  isBlocked
                    ? `<button type="button" class="dlc-dep-btn" onclick="enableAddonWithDeps('${esc(a.id)}')" title="Click to enable required dependency">Needs ${esc(depLabels)} · Enable</button>`
                    : ''
                }
              </div>`;
          })
          .join('');

        return `
          <div class="dlc-card${isDlcOn ? ' is-on' : ''}">
            <div class="dlc-card-head" onclick="toggleDlc('${esc(d.id)}')">
              <div class="dlc-card-title">
                <input type="checkbox" class="dlc-master-switch" ${isDlcOn ? 'checked' : ''} onclick="event.stopPropagation(); event.preventDefault(); toggleDlc('${esc(d.id)}')" />
                <strong>${esc(d.name)}</strong>
              </div>
              <span class="dlc-card-badge">${isDlcOn ? `${activeCount}/${addonList.length} on` : 'Off'}</span>
            </div>
            <div class="dlc-card-body">
              ${rowsHtml}
            </div>
          </div>`;
      })
      .join('');
  }
}

/** Host sees the setup page while `state.setup` is on; everyone else sees "Host is creating world" over the board. */
export function renderSetupPage(): void {
  const page = document.getElementById('setupScreen');
  const wait = document.getElementById('hostWaiting');
  if (!page || !wait) return;
  const inLobby = !!state && state.status === 'LOBBY';
  const showSetup = inLobby && !!state!.setup && state!.hostId === socket.id;
  const showWait = inLobby && !!state!.setup && state!.hostId !== socket.id;
  page.style.display = showSetup ? 'flex' : 'none';
  wait.style.display = showWait ? 'flex' : 'none';
  if (!showSetup) return;
  const specBtn = document.getElementById('btnSetupSpectate');
  if (specBtn) {
    const isSpec = !!state?.isSpectator;
    specBtn.classList.toggle('primary', isSpec);
    specBtn.innerHTML = `${uiIcon(isSpec ? 'users' : 'eye', 16)}<span>${isSpec ? 'Join seat' : 'Spectate'}</span>`;
  }
  const svg = document.getElementById('setupPreview');
  const roster = document.getElementById('setupRoster');
  if (svg) drawPreview(svg);
  if (roster) drawRoster(roster);
  drawScenariosAndDlcs();
}

export { effectiveDlcsAndAddons };
