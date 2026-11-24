// MODULE: dialogue lines for Tidebound DLC events (tides, bridges, harbors, nets, wrecks, pirates; public info only) | DEPENDS ON: server/bots/dialogue/types | USED BY: server/bots/dialogue/lines/index
// Public-info rule: wreck claims and pirate raids/drives never name a resource or card.
import type { Line } from '../types';

export const TIDEBOUND_LINES: Line[] = [
  // ---- A rising tide or sea drowns/floods a coastal tile touching the bot ----
  {
    id: 'tideFlood.main', event: 'tideFlood', style: ['friendly'],
    text: [
      "The tide is coming in fast!",
      "My coast is underwater again!",
      "High water on the shore! Hold on.",
      "Watch the waves, the coast is flooding!"
    ]
  },
  {
    id: 'tideFlood.secondary', event: 'tideFlood', style: ['neutral'],
    text: ["Coast flooded.", "High tide on my shore.", "Water on the coast."]
  },
  {
    id: 'tideFlood.overload', event: 'tideFlood', style: ['cold'],
    text: ["The tide turns.", "Flooded coast. Temporary.", "The sea rises."]
  },

  // ---- A rickety bridge collapses on a 7 ----
  {
    id: 'bridgeCollapsed.main', event: 'bridgeCollapsed', style: ['friendly'],
    text: [
      "Oh no, my rickety bridge gave way!",
      "There goes my bridge into the sea!",
      "Splash! That bridge was too shaky.",
      "My bridge collapsed! Should have reinforced it."
    ]
  },
  {
    id: 'bridgeCollapsed.secondary', event: 'bridgeCollapsed', style: ['neutral'],
    text: ["Bridge collapsed.", "Lost a rickety bridge.", "That span gave out."]
  },
  {
    id: 'bridgeCollapsed.overload', event: 'bridgeCollapsed', style: ['cold'],
    text: ["Acceptable loss.", "A cheap span.", "It served its turn."]
  },

  // ---- A bot upgrades a port to a Harbor ----
  {
    id: 'harborBuilt.main', event: 'harborBuilt', style: ['friendly'],
    text: [
      "Look at that harbor! Open for business.",
      "Full harbor up and running!",
      "Now that is a proper port!",
      "Ships welcome! My harbor is ready."
    ]
  },
  {
    id: 'harborBuilt.secondary', event: 'harborBuilt', style: ['neutral'],
    text: ["Harbor complete.", "Port upgraded to a harbor.", "Harbor online."]
  },
  {
    id: 'harborBuilt.overload', event: 'harborBuilt', style: ['cold'],
    text: ["The port is mine.", "Total control of the dock.", "Trade on my terms."]
  },

  // ---- A bot places a fishing net ----
  {
    id: 'netBuilt.main', event: 'netBuilt', style: ['friendly'],
    text: [
      "Nets in the water! Come on, fish.",
      "Cast the nets! Dinner is on the sea.",
      "Fishing net set! Let's see what bites.",
      "Another net out on the coast!"
    ]
  },
  {
    id: 'netBuilt.secondary', event: 'netBuilt', style: ['neutral'],
    text: ["Net placed.", "Fishing the coast.", "Another net out."]
  },
  {
    id: 'netBuilt.overload', event: 'netBuilt', style: ['cold'],
    text: ["The sea pays.", "Nothing wasted.", "Every shore works."]
  },

  // ---- A bot rolls best on a shipwreck event (private risk: never name what was salvaged) ----
  {
    id: 'wreckClaimed.main', event: 'wreckClaimed', style: ['friendly'], risk: 'private',
    text: [
      "Salvage crew on the wreck! Nice haul.",
      "Best haul off that shipwreck!",
      "Treasure from the deep! Lucky me.",
      "Pulled the cargo off that wreck!"
    ]
  },
  {
    id: 'wreckClaimed.secondary', event: 'wreckClaimed', style: ['neutral'], risk: 'private',
    text: ["Wreck salvaged.", "Good salvage.", "Salvage secured."]
  },
  {
    id: 'wreckClaimed.overload', event: 'wreckClaimed', style: ['cold'], risk: 'private',
    text: ["Salvage taken.", "Mine now.", "The sea provides."]
  },

  // ---- A pirate raid robs a bot (private risk: never name stolen cards) ----
  {
    id: 'pirateRaid.main', event: 'pirateRaid', style: ['friendly'], risk: 'private',
    text: [
      "Pirates! They raided my coast!",
      "Hey! Those pirates just robbed my shore!",
      "Black sails on my coast! Not fair.",
      "Pirates hit my port! Where are my knights?"
    ]
  },
  {
    id: 'pirateRaid.secondary', event: 'pirateRaid', style: ['neutral'], risk: 'private',
    text: ["Raided by pirates.", "Pirates hit my coast.", "Pirate raid on my shore."]
  },
  {
    id: 'pirateRaid.overload', event: 'pirateRaid', style: ['cold'], risk: 'private',
    text: ["Pirates. Not for long.", "A temporary nuisance.", "They will pay for that."]
  },

  // ---- A bot beats a pirate raid (private risk: never name the loot) ----
  {
    id: 'pirateDriven.main', event: 'pirateDriven', style: ['friendly'], risk: 'private',
    text: [
      "Chased those pirates right off the map!",
      "Take that, pirates! The sea is clear.",
      "Driven off! My knights cleared the coast.",
      "Sent that pirate ship packing!"
    ]
  },
  {
    id: 'pirateDriven.secondary', event: 'pirateDriven', style: ['neutral'], risk: 'private',
    text: ["Pirate driven off.", "Cleared the pirate ship.", "Sea lane secured."]
  },
  {
    id: 'pirateDriven.overload', event: 'pirateDriven', style: ['cold'], risk: 'private',
    text: ["Cleared.", "One less pest.", "The sea is mine."]
  }
];
