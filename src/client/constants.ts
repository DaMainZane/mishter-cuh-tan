// MODULE: resource and dev card metadata (names, token colors) | DEPENDS ON: none | USED BY: client/fishSpend, client/render/board, client/render/drawer, client/render/hand, client/render/sidebar, client/render/trade
// Colors are CSS variables defined in styles.css (design tokens). Never hardcode hex here.

export const RESOURCES: string[] = ['wood', 'brick', 'sheep', 'wheat', 'ore'];

export const RES_META: Record<string, { color: string; border: string; name: string }> = {
  wood:   { color: 'var(--tile-wood)',   border: 'var(--trim-wood)',   name: 'Wood' },
  brick:  { color: 'var(--tile-brick)',  border: 'var(--trim-brick)',  name: 'Brick' },
  sheep:  { color: 'var(--tile-sheep)',  border: 'var(--trim-sheep)',  name: 'Sheep' },
  wheat:  { color: 'var(--tile-wheat)',  border: 'var(--trim-wheat)',  name: 'Wheat' },
  ore:    { color: 'var(--tile-ore)',    border: 'var(--trim-ore)',    name: 'Ore' },
  desert: { color: 'var(--tile-desert)', border: 'var(--trim-desert)', name: 'Desert' },
  gold:   { color: 'var(--tile-gold)',   border: 'var(--trim-gold)',   name: 'Gold' },
  fog:    { color: 'var(--tile-fog)',    border: 'var(--trim-fog)',    name: 'Fog' }
};

export const DEV_META: Record<string, { name: string; desc: string }> = {
  knight:       { name: 'Knight',   desc: 'Move the robber and steal a card from a player next to it.' },
  roadBuilding: { name: 'Roads',    desc: 'Build two roads for free.' },
  yearOfPlenty: { name: 'Plenty',   desc: 'Take any two resources from the bank.' },
  monopoly:     { name: 'Monopoly', desc: 'Name a resource and take every card of it from all other players.' },
  vp:           { name: 'Victory',  desc: 'Worth 1 victory point. Stays hidden until you win.' }
};
