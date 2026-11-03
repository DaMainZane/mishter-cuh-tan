import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import { CITY, GENERIC_PORT, SETTLEMENT } from '../src/packs/base/constants';
import { portLevel } from '../src/packs/base/techEffects';
import {
  FLOODED,
  HARBOR_COST,
  HARBOR_LEVEL,
  HARBOR_LIMIT,
  HARBOR_MAX_TRADES,
  TECH_HARBOR_EMPIRE,
  UPGRADE_HARBOR,
  canUpgradeHarbor,
  harborBotGoal,
  harborClientView,
  harborCount,
  harborSpotsView,
  harborTradesLeft,
  harborTradesLeftAt,
  isHarbor,
  isPortFlooded
} from '../src/packs/tidebound';
import {
  buildTopology,
  createGame,
  dispatch,
  explainInvalidBankRatio,
  isPortIdle,
  legalActions,
  makeCtx,
  ratioFor,
  registryFor,
  setTileState,
  tradeRatiosFor
} from '../src/shared';

const on = { dlc: { tidebound: true } };
const harborOff = { dlc: { tidebound: true }, addons: { 'tidebound.harbor': false } };
const dlcOff = { dlc: { tidebound: false } };

function discInits(radius: number): { q: number; r: number; type: string; number: number | null }[] {
  const out: { q: number; r: number; type: string; number: number | null }[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.abs(q + r) > radius) continue;
      out.push({ q, r, type: 'wood', number: 6 });
    }
  }
  return out;
}

function makeGame(rules: Record<string, any> = on, seed = 108) {
  const reg = registryFor(allPacks, rules);
  const board = buildTopology(discInits(2), {
    isLand: t => !!reg.tiles.get(t)?.land,
    portBlocked: t => !!reg.tiles.get(t)?.noPort,
    waterEdges: true
  });
  const g = createGame(reg, {
    players: [
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' }
    ],
    rules,
    board,
    seed,
    shuffleSeats: false
  });
  g.phase = 'main';
  g.turn = 0;
  return { g, reg, ctx: makeCtx(g, reg) };
}

function act(g: any, reg: any, playerId: string, type: string, payload: any = {}) {
  return dispatch(g, reg, { playerId, type, payload });
}

/** Picks two distinct coastal vertices and assigns them the requested port types. */
function assignPorts(g: any, portA = GENERIC_PORT, portB = 'wood'): [number, number] {
  const coastVerts = g.board.vertices.filter((v: any) => v.hexIds.length > 0 && v.hexIds.length < 3);
  const vA = coastVerts[0];
  const vB = coastVerts.find((v: any) => v.id !== vA.id && !vA.adjacentVertices.includes(v.id)) || coastVerts[1];
  vA.port = portA;
  vB.port = portB;
  return [vA.id, vB.id];
}

describe('Tidebound T8a: Harbor 1:1 upgrade, limit 1 per player, works while flooded', () => {
  it('registers nothing when Tidebound DLC or tidebound.harbor addon is off', () => {
    for (const rules of [dlcOff, harborOff]) {
      const { g, reg } = makeGame(rules);
      expect(reg.actions.has(UPGRADE_HARBOR)).toBe(false);
      const [vId] = assignPorts(g, GENERIC_PORT);
      g.board.vertices[vId].piece = { type: CITY, owner: 'a' };
      g.ext = { core: { portUpgrades: { [vId]: { level: HARBOR_LEVEL, by: 'a' } } } };
      // Without the harbor addon registered, level 2 on a 3:1 port stops at the 2:1 floor.
      expect(ratioFor(g, reg, 'a', 'wood')).toBe(2);
    }
  });

  it('requires a port vertex with your own city and HARBOR_COST resources, and draws zero values from g.rng', () => {
    const { g, reg } = makeGame(on);
    const [genericVid, woodVid] = assignPorts(g, GENERIC_PORT, 'wood');
    const p = g.players[0];
    p.resources = { wood: 2, brick: 1, ore: 1, wheat: 0, sheep: 0 };

    // Empty port vertex is refused
    expect(canUpgradeHarbor(g, reg, 'a', genericVid)).toContain('city');

    // Settlement on port is refused (Harbor always needs a city)
    g.board.vertices[genericVid].piece = { type: SETTLEMENT, owner: 'a' };
    expect(canUpgradeHarbor(g, reg, 'a', genericVid)).toContain('city');

    // Another player's city on port is refused
    g.board.vertices[genericVid].piece = { type: CITY, owner: 'b' };
    expect(canUpgradeHarbor(g, reg, 'a', genericVid)).toContain('city');

    // Own city on a non-port vertex is refused
    const inlandVid = g.board.vertices.find(v => !v.port)!.id;
    g.board.vertices[inlandVid].piece = { type: CITY, owner: 'a' };
    expect(canUpgradeHarbor(g, reg, 'a', inlandVid)).toContain('port');

    // Own city on port with insufficient resources is refused
    g.board.vertices[genericVid].piece = { type: CITY, owner: 'a' };
    p.resources = { wood: 1, brick: 1, ore: 1, wheat: 0, sheep: 0 };
    expect(canUpgradeHarbor(g, reg, 'a', genericVid)).toContain('Not enough resources');

    // Give exact HARBOR_COST and upgrade the 3:1 generic port to a Harbor
    p.resources = { ...HARBOR_COST, wheat: 0, sheep: 0 };
    const rngBefore = JSON.stringify(g.rng);
    const res = act(g, reg, 'a', UPGRADE_HARBOR, { vertexId: genericVid });
    expect(res.ok).toBe(true);
    expect(JSON.stringify(g.rng)).toBe(rngBefore);

    expect(portLevel(g, genericVid)).toBe(HARBOR_LEVEL);
    expect(isHarbor(g, genericVid)).toBe(true);
    expect(harborCount(g, 'a')).toBe(1);
    expect(p.resources.wood).toBe(0);
    expect(p.resources.brick).toBe(0);
    expect(p.resources.ore).toBe(0);

    // 3:1 generic harbor trades every resource at 1:1
    const ratios = tradeRatiosFor(g, reg, 'a');
    expect(ratios).toEqual({ wood: 1, brick: 1, sheep: 1, wheat: 1, ore: 1 });

    // Upgrading a 2:1 resource port for player b gives 1:1 only for that resource
    g.turn = 1;
    g.board.vertices[woodVid].piece = { type: CITY, owner: 'b' };
    g.players[1].resources = { ...HARBOR_COST, wheat: 0, sheep: 0 };
    expect(act(g, reg, 'b', UPGRADE_HARBOR, { vertexId: woodVid }).ok).toBe(true);
    expect(ratioFor(g, reg, 'b', 'wood')).toBe(1);
    expect(ratioFor(g, reg, 'b', 'brick')).toBe(4);
  });

  it('enforces HARBOR_LIMIT = 1 per player (and allows 2 with tidebound.harbor_empire)', () => {
    const { g, reg } = makeGame(on);
    const [v1, v2] = assignPorts(g, GENERIC_PORT, 'brick');
    const p = g.players[0];
    g.board.vertices[v1].piece = { type: CITY, owner: 'a' };
    g.board.vertices[v2].piece = { type: CITY, owner: 'a' };
    p.resources = { wood: 10, brick: 10, ore: 10, wheat: 5, sheep: 5 };

    expect(HARBOR_LIMIT).toBe(1);
    expect(act(g, reg, 'a', UPGRADE_HARBOR, { vertexId: v1 }).ok).toBe(true);
    expect(harborCount(g, 'a')).toBe(1);

    // Second harbor is refused at the default limit of 1
    const second = act(g, reg, 'a', UPGRADE_HARBOR, { vertexId: v2 });
    expect(second.ok).toBe(false);
    expect(second.error).toContain('only have 1 harbor');
    expect(legalActions(g, reg, 'a').filter(a => a.type === UPGRADE_HARBOR)).toEqual([]);

    // Granting Harbor empire raises the limit to 2
    g.ext.core.techs = { a: [TECH_HARBOR_EMPIRE] };
    expect(act(g, reg, 'a', UPGRADE_HARBOR, { vertexId: v2 }).ok).toBe(true);
    expect(harborCount(g, 'a')).toBe(2);
  });

  it('keeps working while flooded (exempt from PORT_IDLE_CHECKS and isPortFlooded)', () => {
    const { g, reg } = makeGame(on);
    const [genericVid, woodVid] = assignPorts(g, GENERIC_PORT, 'wood');
    g.board.vertices[genericVid].piece = { type: CITY, owner: 'a' };
    g.board.vertices[woodVid].piece = { type: CITY, owner: 'b' };

    // Flood every land hex touching both ports
    for (const vId of [genericVid, woodVid]) {
      for (const hId of g.board.vertices[vId].hexIds) {
        if (reg.tiles.get(g.board.hexes[hId]?.type)?.land) {
          setTileState(g, hId, { id: FLOODED });
        }
      }
    }

    // Before upgrading to a harbor, both flooded ports are idle and trade at 4:1
    expect(isPortFlooded(g, reg, genericVid)).toBe(true);
    expect(isPortIdle(g, reg, genericVid)).toBe(true);
    expect(ratioFor(g, reg, 'a', 'wood')).toBe(4);
    expect(ratioFor(g, reg, 'b', 'wood')).toBe(4);

    // Upgrade Alice's flooded 3:1 port to a harbor: it immediately works at 1:1 despite flooding
    g.players[0].resources = { ...HARBOR_COST, wheat: 0, sheep: 0 };
    expect(act(g, reg, 'a', UPGRADE_HARBOR, { vertexId: genericVid }).ok).toBe(true);
    expect(isPortFlooded(g, reg, genericVid)).toBe(false);
    expect(isPortIdle(g, reg, genericVid)).toBe(false);
    expect(ratioFor(g, reg, 'a', 'wood')).toBe(1);
    expect(ratioFor(g, reg, 'a', 'ore')).toBe(1);
  });

  it('a port raised to 2:1 (Harbor charters) also keeps trading while flooded, and a harbor on a 2:1 resource port still trades 1:1 flooded', () => {
    const { g, reg } = makeGame(on);
    const [genericVid, woodVid] = assignPorts(g, GENERIC_PORT, 'wood');
    g.board.vertices[genericVid].piece = { type: CITY, owner: 'a' };
    g.board.vertices[woodVid].piece = { type: CITY, owner: 'b' };
    for (const vId of [genericVid, woodVid]) {
      for (const hId of g.board.vertices[vId].hexIds) {
        if (reg.tiles.get(g.board.hexes[hId]?.type)?.land) setTileState(g, hId, { id: FLOODED });
      }
    }
    // Raised to 2:1 (level 1) but not a harbor: the flood must not idle it.
    g.ext.core = g.ext.core || {};
    g.ext.core.portUpgrades = { [genericVid]: { level: 1, by: 'a' } };
    expect(isPortFlooded(g, reg, genericVid)).toBe(false);
    expect(isPortIdle(g, reg, genericVid)).toBe(false);
    expect(ratioFor(g, reg, 'a', 'ore')).toBe(2);
    // An unraised port next to it is still idle in the flood.
    expect(isPortIdle(g, reg, woodVid)).toBe(true);
    expect(ratioFor(g, reg, 'b', 'wood')).toBe(4);
    // A harbor on the 2:1 wood port trades 1:1 for wood while flooded.
    g.board.vertices[woodVid].piece = { type: CITY, owner: 'a' };
    g.players[0].resources = { ...HARBOR_COST, wheat: 0, sheep: 0 };
    expect(act(g, reg, 'a', UPGRADE_HARBOR, { vertexId: woodVid }).ok).toBe(true);
    expect(ratioFor(g, reg, 'a', 'wood')).toBe(1);
  });

  it('provides harborSpotsView, harborClientView, and minimal bot goal support', () => {
    const { g, reg, ctx } = makeGame(on);
    const [genericVid, woodVid] = assignPorts(g, GENERIC_PORT, 'wood');
    const p = g.players[0];
    g.board.vertices[genericVid].piece = { type: CITY, owner: 'a' };
    g.board.vertices[woodVid].piece = { type: CITY, owner: 'a' };

    // Cannot afford yet -> harborSpotsView is [], bot goal is []
    p.resources = { wood: 1, brick: 0, ore: 0, wheat: 0, sheep: 0 };
    expect(harborSpotsView(g, reg, p)).toEqual([]);
    expect(harborBotGoal.goals!(ctx, 'a')).toEqual([]);
    expect(harborClientView(g)).toBeNull();

    // Give enough resources + spare cards for the bot goal; bot prefers the 3:1 generic port
    p.resources = { wood: 3, brick: 2, ore: 2, wheat: 0, sheep: 0 };
    expect(harborSpotsView(g, reg, p)).toEqual([genericVid, woodVid].sort((a, b) => a - b));
    const goals = harborBotGoal.goals!(ctx, 'a');
    expect(goals).toHaveLength(1);
    expect(goals[0].action).toEqual({ type: UPGRADE_HARBOR, payload: { vertexId: genericVid } });
    expect(harborBotGoal.actionScore!(ctx, 'a', goals[0].action)).toBeGreaterThan(0);

    act(g, reg, 'a', UPGRADE_HARBOR, { vertexId: genericVid });
    expect(harborClientView(g)).toEqual({ [genericVid]: HARBOR_LEVEL });
  });
});

describe('T8b: Max 4 1:1 trades per turn per harbor, 2:1 fallback, and invalid-ratio prompt', () => {
  it('allows up to 4 1:1 trades per turn on a harbor, then falls back to 2:1 for the rest of the turn and resets next turn', () => {
    const { g, reg } = makeGame(on);
    const [genericVid] = assignPorts(g, GENERIC_PORT);
    const p = g.players[0];
    g.board.vertices[genericVid].piece = { type: CITY, owner: 'a' };
    p.resources = { wood: 12, brick: 1, ore: 1, wheat: 0, sheep: 0 };

    expect(act(g, reg, 'a', UPGRADE_HARBOR, { vertexId: genericVid }).ok).toBe(true);
    expect(harborTradesLeft(g, 'a')).toBe(HARBOR_MAX_TRADES);
    expect(harborTradesLeftAt(g, genericVid)).toBe(4);
    expect(ratioFor(g, reg, 'a', 'wood')).toBe(1);

    // Execute 4 single 1:1 trades (1 wood -> 1 wheat each)
    for (let i = 1; i <= 4; i++) {
      const tr = act(g, reg, 'a', 'bank_trade', { give: { wood: 1 }, get: { wheat: 1 } });
      expect(tr.ok).toBe(true);
      expect(harborTradesLeft(g, 'a')).toBe(4 - i);
    }

    // After 4 trades, 1:1 is exhausted for this turn and the port falls back to 2:1!
    expect(harborTradesLeft(g, 'a')).toBe(0);
    expect(ratioFor(g, reg, 'a', 'wood')).toBe(2);
    expect(ratioFor(g, reg, 'a', 'brick')).toBe(2);

    // A 5th 1:1 trade is rejected, explaining the 4-trade harbor limit
    const fifthOneToOne = act(g, reg, 'a', 'bank_trade', { give: { wood: 1 }, get: { wheat: 1 } });
    expect(fifthOneToOne.ok).toBe(false);
    expect(fifthOneToOne.error).toContain('harbor 1:1 limit of 4 trades per turn reached');

    // Trading at the fallback 2:1 ratio on the same turn succeeds!
    const fallbackTwoToOne = act(g, reg, 'a', 'bank_trade', { give: { wood: 2 }, get: { wheat: 1 } });
    expect(fallbackTwoToOne.ok).toBe(true);

    // Advance to the next turn: the harbor's 4 1:1 trades reset
    g.turnCount = (g.turnCount || 1) + 1;
    expect(harborTradesLeft(g, 'a')).toBe(4);
    expect(ratioFor(g, reg, 'a', 'wood')).toBe(1);
  });

  it('rejects a single batch trade that asks for more than 4 1:1 trades on one harbor', () => {
    const { g, reg } = makeGame(on);
    const [, woodVid] = assignPorts(g, GENERIC_PORT, 'wood');
    const p = g.players[0];
    g.board.vertices[woodVid].piece = { type: CITY, owner: 'a' };
    p.resources = { wood: 10, brick: 1, ore: 1, wheat: 0, sheep: 0 };

    expect(act(g, reg, 'a', UPGRADE_HARBOR, { vertexId: woodVid }).ok).toBe(true);

    // Offering 5 wood for 5 ore in a single batch exceeds the 4-trade cap
    const overBatch = act(g, reg, 'a', 'bank_trade', { give: { wood: 5 }, get: { ore: 5 } });
    expect(overBatch.ok).toBe(false);
    expect(overBatch.error).toContain('limit of 4 trades per turn');

    // Offering 4 wood for 4 ore in a single batch succeeds and uses all 4 trades
    const exactBatch = act(g, reg, 'a', 'bank_trade', { give: { wood: 4 }, get: { ore: 4 } });
    expect(exactBatch.ok).toBe(true);
    expect(harborTradesLeft(g, 'a')).toBe(0);
    // Specialised 2:1:wood harbor falls back to 2:1 on wood after its 4 trades are used
    expect(ratioFor(g, reg, 'a', 'wood')).toBe(2);
  });

  it('explains harbors in explainInvalidBankRatio both when no harbor is owned and when the 4-trade turn cap is reached', () => {
    const { g, reg } = makeGame(on);
    const [genericVid] = assignPorts(g, GENERIC_PORT);
    const p = g.players[0];
    g.board.vertices[genericVid].piece = { type: CITY, owner: 'a' };
    p.resources = { wood: 10, brick: 2, ore: 2, wheat: 2, sheep: 5 };

    // Before upgrading to a harbor, Alice has a 3:1 port. Offering 1 sheep for 1 ore explains both 3:1 and that 1:1 requires a harbor.
    const noHarbor = explainInvalidBankRatio(g, reg, 'a', { sheep: 1 }, { ore: 1 });
    expect(noHarbor.ok).toBe(false);
    expect(noHarbor.reason).toContain('3:1 for SHEEP');
    expect(noHarbor.reason).toContain('1:1 requires a harbor');

    // Upgrade to a harbor and use all 4 1:1 trades
    expect(act(g, reg, 'a', UPGRADE_HARBOR, { vertexId: genericVid }).ok).toBe(true);
    expect(act(g, reg, 'a', 'bank_trade', { give: { wood: 4 }, get: { wheat: 4 } }).ok).toBe(true);

    // Now offering 1 sheep for 1 ore explains that the harbor 1:1 limit of 4 trades per turn was reached
    const capReached = explainInvalidBankRatio(g, reg, 'a', { sheep: 1 }, { ore: 1 });
    expect(capReached.ok).toBe(false);
    expect(capReached.reason).toContain('2:1 for SHEEP');
    expect(capReached.reason).toContain('harbor 1:1 limit of 4 trades per turn reached');
  });
});
