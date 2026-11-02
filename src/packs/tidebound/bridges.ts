// MODULE: tidebound.bridges addon (wide-water map perk + T3 Bridge piece, ocean placement rule, 2x cost past 10 or 14 with Rickety bridges tech, Longest Road, bot goal, T11f demolish_bridge action & Grand Causeway 16 VP hook) | DEPENDS ON: packs/tidebound/bridgeConsts, packs/tidebound/bridgeCore, packs/tidebound/ricketyBridges, packs/tidebound/seaData, packs/tidebound/tech, shared/index | USED BY: packs/tidebound/addons.generated, packs/tidebound/index, packs/tidebound/wrecks, server/debug
import {
  addWaterTopology,
  bankGive,
  BOT_GOALS,
  COST_MODS,
  doubledCost,
  getPlayer,
  hasTech,
  updateAwards,
  VIEW_DATA
} from '../../shared';
import type {
  ActionDef,
  AddonDef,
  Ctx,
  GameState,
  Id,
  PieceDef,
  Registry,
  Resources,
  ViewDataDef
} from '../../shared';
import {
  bridgesOnBoard,
  effectiveBridgeBaseLimit,
  RICKETY,
  RICKETY_COST,
  ricketyPoolCostMod,
  syncBridgePool
} from './ricketyBridges';
import { applyElevation, placeFish } from './seaData';
import { grandCausewayViewData, grandCausewayVpHook, registerTideboundTechs, TECH_SALVAGE_CREW } from './tech';

// The constants live in bridgeConsts.ts and the bridge rule, piece and bot goal in bridgeCore.ts, so bridges, rickety bridges and tech form no import cycle.
// They are re-exported here so existing imports from './bridges' keep working.
import { BRIDGE, BRIDGE_BASE_LIMIT, BRIDGE_COST } from './bridgeConsts';
import { bridgeBotGoal, bridgePiece } from './bridgeCore';
export { BRIDGE, BRIDGE_BASE_LIMIT, BRIDGE_COST };
export { bridgeBotGoal, bridgePiece, canPlaceBridge, isOceanEdge } from './bridgeCore';
/** Action type: remove one of your own bridges or rickety bridges for `floor(paid / 2)` cards back from the bank (T11f, unlocked by Salvage crew). */
export const DEMOLISH_BRIDGE = 'demolish_bridge';

// ---- T11f: demolish_bridge action (unlocked by Salvage crew) ---------------------------------------------------

/**
 * Paid resource bundle for `pid`'s `pieceType` (`bridge` or `rickety_bridge`) given the current bridge count on the board.
 * When `bridgesOnBoard(g, pid) > effectiveBridgeBaseLimit(g, pid)`, the latest bridge was built above the 1x cap at 2x cost.
 */
export function bridgePaidResources(g: GameState, reg: Registry, pid: Id, pieceType: string): Resources {
  const def = reg.pieces.get(pieceType);
  const baseCost = def?.cost ?? (pieceType === RICKETY ? RICKETY_COST : BRIDGE_COST);
  const limit = effectiveBridgeBaseLimit(g, pid, def?.baseLimit ?? BRIDGE_BASE_LIMIT);
  return bridgesOnBoard(g, pid) > limit ? doubledCost(baseCost) : { ...baseCost };
}

/**
 * Computes the refund (`floor(paid / 2)` cards from the bank) when `pid` demolishes a `bridge` or `rickety_bridge`.
 * Prefers refunding the resources in the bridge's cost (`wood`, `brick`, `ore` for a bridge; `wood` for a rickety bridge)
 * while the bank has them in stock, falling back to any other stocked bank resource if a pile is empty.
 */
export function bridgeDemolishRefund(
  g: GameState,
  reg: Registry,
  pid: Id,
  pieceType: string
): { paidCards: number; refundCards: number; resources: Resources } {
  const paid = bridgePaidResources(g, reg, pid, pieceType);
  const paidCards = Object.values(paid).reduce((a, b) => a + (Number(b) || 0), 0);
  const refundCards = Math.floor(paidCards / 2);
  const resources: Resources = {};
  if (refundCards <= 0) return { paidCards, refundCards: 0, resources };

  const preferredOrder = Object.keys(paid).filter(r => (paid[r] || 0) > 0);
  const fallbackOrder = [...reg.resources.keys()].filter(r => !preferredOrder.includes(r));
  const order = [...preferredOrder, ...fallbackOrder];

  const simBank: Record<string, number> = { ...g.bank };
  let rem = refundCards;
  // First pass: take up to `paid[r]` from the preferred resources in round-robin order
  let progress = true;
  while (rem > 0 && progress) {
    progress = false;
    for (const r of preferredOrder) {
      if (rem <= 0) break;
      if ((simBank[r] || 0) > 0 && (resources[r] || 0) < (paid[r] || 0)) {
        resources[r] = (resources[r] || 0) + 1;
        simBank[r] -= 1;
        rem -= 1;
        progress = true;
      }
    }
  }
  // Second pass: if a preferred bank pile was empty, fill any remaining refund cards from other stocked piles
  progress = true;
  while (rem > 0 && progress) {
    progress = false;
    for (const r of order) {
      if (rem <= 0) break;
      if ((simBank[r] || 0) > 0) {
        resources[r] = (resources[r] || 0) + 1;
        simBank[r] -= 1;
        rem -= 1;
        progress = true;
      }
    }
  }

  return { paidCards, refundCards, resources };
}

/** Validates whether `pid` can demolish the bridge or rickety bridge on `edgeId`. Returns an error string or `null`. */
export function canDemolishBridge(g: GameState, pid: Id, edgeId: number): string | null {
  const p = getPlayer(g, pid);
  if (!p) return 'Unknown player';
  if (!hasTech(g, pid, TECH_SALVAGE_CREW)) return 'Research Salvage crew first';
  const e = Number.isInteger(edgeId) ? g.board.edges[edgeId] : undefined;
  if (!e || !e.piece || e.piece.owner !== pid || (e.piece.type !== BRIDGE && e.piece.type !== RICKETY)) {
    return 'Choose one of your own bridges or rickety bridges';
  }
  return null;
}

/**
 * `demolish_bridge` action (T11f, unlocked by `tidebound.salvage_crew`):
 * Removes one of `pid`'s own bridges or rickety bridges, refunds `floor(paid / 2)` cards from the bank,
 * frees the shared bridge cap slot (`syncBridgePool`), and recalculates Longest Road (`updateAwards`).
 */
export const demolishBridgeAction: ActionDef = {
  type: DEMOLISH_BRIDGE,
  validate(ctx: Ctx, pid: Id, payload: any): string | null {
    return canDemolishBridge(ctx.g, pid, payload?.edgeId);
  },
  apply(ctx: Ctx, pid: Id, payload: any): void {
    const { g, reg } = ctx;
    const p = getPlayer(g, pid)!;
    const edgeId = Number(payload.edgeId);
    const e = g.board.edges[edgeId]!;
    const fromType = e.piece!.type;

    // Compute the refund before removing the piece so `bridgesOnBoard` reflects the count when it stood.
    const { paidCards, refundCards, resources } = bridgeDemolishRefund(g, reg, pid, fromType);

    e.piece = null;
    if (g.ext?.core?.durability) {
      delete g.ext.core.durability[`edge:${edgeId}`];
    }
    syncBridgePool(g, pid);

    let refunded = 0;
    for (const [r, n] of Object.entries(resources)) {
      if (n > 0) refunded += bankGive(ctx, pid, r, n);
    }

    p.stats.bridgesDemolished = (p.stats.bridgesDemolished || 0) + 1;
    updateAwards(ctx);

    ctx.emit('bridgeDemolished', {
      playerId: pid,
      edgeId,
      piece: fromType,
      paidCards,
      refundCards,
      refunded,
      resources
    });
    const label = fromType === RICKETY ? 'rickety bridge' : 'bridge';
    ctx.log(
      `🪓 ${p.avatar} ${p.name} demolished a ${label}${refunded > 0 ? ` and salvaged ${refunded} card${refunded === 1 ? '' : 's'}` : ''}`,
      p.color
    );
  },
  legal(ctx: Ctx, pid: Id): { edgeId: number }[] {
    const { g } = ctx;
    if (!hasTech(g, pid, TECH_SALVAGE_CREW)) return [];
    const out: { edgeId: number }[] = [];
    for (const e of g.board.edges) {
      if (e.piece?.owner === pid && (e.piece.type === BRIDGE || e.piece.type === RICKETY)) {
        out.push({ edgeId: e.id });
      }
    }
    return out;
  }
};

/**
 * VIEW_DATA entry (R7a.5, group 10): `canDemolishBridge`, whether this player can demolish their own bridges (yourself only, with the action in the game
 * and Salvage crew researched). `undefined` otherwise, so the field is absent, as before.
 */
export const bridgesViewData: ViewDataDef = {
  id: 'tidebound.bridges.view',
  player: (g, reg, p, who) => ({
    canDemolishBridge: who.self && reg.actions.has(DEMOLISH_BRIDGE) && hasTech(g, p.id, TECH_SALVAGE_CREW) ? true : undefined
  })
};

export const bridgesAddon: AddonDef = {
  id: 'tidebound.bridges',
  name: 'Bridges',
  description: 'Roads across the sea. Both ends must touch ocean; they count toward Longest Road.',
  links: [
    { target: 'piece-cost', kind: 'mechanic' },
    { target: 'history', kind: 'mechanic' },
    { target: 'bot-goals', kind: 'bot' }
  ],
  rules: {
    pieceLimits: {
      [BRIDGE]: BRIDGE_BASE_LIMIT
    }
  },
  register(api) {
    // Crossing capability unlocks islands/archipelago map shapes and water edge topology.
    api.capability('crossing');
    api.piece(bridgePiece);
    api.define(COST_MODS, ricketyPoolCostMod);
    api.define(BOT_GOALS, bridgeBotGoal);
    registerTideboundTechs(api);
    api.action(demolishBridgeAction);
    api.phaseAction('main', DEMOLISH_BRIDGE);
    api.hook('vp', grandCausewayVpHook);
    // R7a.5: the demolish flag (group 10) and the Grand Causeway VP bonus (group 12) for the client state.
    api.define(VIEW_DATA, bridgesViewData);
    api.define(VIEW_DATA, grandCausewayViewData);
    api.hook('onBuild', (ctx: Ctx, def: PieceDef, pid: Id) => {
      if (def.id === BRIDGE || def.id === RICKETY) syncBridgePool(ctx.g, pid);
    });
    // Ensure custom/prepared boards passed into createGame also have water edges populated when Bridges is enabled.
    api.hook('onGameStart', ctx => {
      addWaterTopology(
        ctx.g.board,
        t => !!ctx.reg.tiles.get(t)?.land,
        t => !!ctx.reg.tiles.get(t)?.noPort
      );
    });

    // T2a/T2b/T2b2/T2c, wide water. Data only: nothing runs during a game. The shape stage reads the `water.extra` param (see shared/mapshape.ts and
    // packs/base/map/shapes.ts) and grows the canvas around the normal map, so with this pick off the generator draws exactly what it drew before.
    // The same pick then writes the sea data later chunks read, with no RNG draws (see seaData.ts): `ext.elevation` 1 to 3 on land by ranked height
    // (higher is rarer) and `ext.fish` on seeded sea tiles.
    api.mapPerk({
      id: 'wide_water',
      label: 'Wide water',
      description: 'Seas and rivers several tiles wider. The board grows around the normal map to make room, so the land count stays the same. Land gets an elevation (1 to 3) and some sea tiles hold fish; both are used by later Tidebound features.',
      stage: 'extras',
      // The default hexagon has no sea to widen, so with this pick the map sits on a continent instead (same as the ragged coast).
      conflicts: ['hexagon'],
      params: [{ id: 'water.extra', label: 'Extra water width (tiles)', min: 1, max: 5, step: 1, default: 4 }],
      afterGenerated(inits, ctx, cells) {
        applyElevation(inits, cells);
        placeFish(inits, ctx);
      }
    });
  }
};

