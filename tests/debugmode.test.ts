// MODULE: tests for server/debug and client/debug (sandbox grants, forced rolls, board piece brush, invariant auditor, and client-vs-server spot desync diffing) | DEPENDS ON: client/debug, packs/tidebound/ricketyBridges, packs/tidebound/tech, server/debug, server/game, server/rooms, +1 more | USED BY: none
import { describe, expect, it } from 'vitest';
import { diffClientVsServerSpots } from '../src/client/debug';
import { BRIDGE } from '../src/packs/tidebound/bridges';
import { RICKETY } from '../src/packs/tidebound/ricketyBridges';
import { TECH_GRAND_CAUSEWAY, TECH_HARBOR_CHARTERS } from '../src/packs/tidebound/tech';
import { applyDebugCommand, auditGameState } from '../src/server/debug';
import { startGame } from '../src/server/game';
import { createLobbyPlayer, createRoom } from '../src/server/rooms';
import { hasTech, wildTokensOf } from '../src/shared';

function makeDebugRoom() {
  const room = createRoom('p1', 'Alice');
  room.lobbyPlayers.push(createLobbyPlayer('p2', 'Bob', 1, true));
  room.settings.dlc = { tidebound: true };
  room.settings.techTreeOn = true;
  const err = startGame(room);
  expect(err).toBeNull();
  return room;
}

describe('Debug Mode — server sandbox commands, invariant auditor, and client-vs-server spot diff', () => {
  it('audits a fresh Tidebound game with 0 invariant issues and reports legal placement spots', () => {
    const room = makeDebugRoom();
    const g = room.game!;
    const currentPid = g.players[g.turn].id;
    const report = auditGameState(room, currentPid);

    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.playerAudits).toHaveLength(2);
    expect(report.legalSpots.settlementVertices.length).toBeGreaterThan(0);
  });

  it('detects VP and piece supply pool desyncs in auditGameState', () => {
    const room = makeDebugRoom();
    const g = room.game!;
    // Corrupt p1's road supply counter so onBoard + left != cap
    g.players[0].pieces.road = 99;
    // Corrupt Longest Road award holder to someone with 0 roads
    g.awards.longestRoad = g.players[0].id;

    const report = auditGameState(room, 'p1');
    expect(report.ok).toBe(false);
    expect(report.issues.some(i => i.includes('Longest Road holder'))).toBe(true);
    expect(report.issues.some(i => i.includes('Supply mismatch'))).toBe(true);
  });

  it('supports grantResources, grantFish, unlockAllTechs, forceRoll, paintPiece, and exportSnapshot', () => {
    const room = makeDebugRoom();
    const g = room.game!;
    g.phase = 'main';
    g.turn = 0;
    const p1 = g.players[0];

    const resGrant = applyDebugCommand(room, p1.id, 'grantResources', { amount: 8 });
    expect(resGrant.ok).toBe(true);
    expect(p1.resources.wood).toBe(8);
    expect(p1.resources.ore).toBe(8);

    const fishGrant = applyDebugCommand(room, p1.id, 'grantFish', { amount: 4 });
    expect(fishGrant.ok).toBe(true);
    expect(wildTokensOf(g, p1.id).fish).toBe(4);

    const techGrant = applyDebugCommand(room, p1.id, 'unlockAllTechs');
    expect(techGrant.ok).toBe(true);
    expect(hasTech(g, p1.id, TECH_HARBOR_CHARTERS)).toBe(true);
    expect(hasTech(g, p1.id, TECH_GRAND_CAUSEWAY)).toBe(true);

    // Paint a settlement, a road, a bridge, and a rickety bridge via paintPiece
    expect(applyDebugCommand(room, p1.id, 'paintPiece', { targetType: 'vertex', id: 0, brush: 'settlement' }).ok).toBe(true);
    expect(g.board.vertices[0].piece).toEqual({ type: 'settlement', owner: p1.id });

    expect(applyDebugCommand(room, p1.id, 'paintPiece', { targetType: 'edge', id: 0, brush: BRIDGE }).ok).toBe(true);
    expect(g.board.edges[0].piece).toEqual({ type: BRIDGE, owner: p1.id });

    expect(applyDebugCommand(room, p1.id, 'paintPiece', { targetType: 'edge', id: 1, brush: RICKETY }).ok).toBe(true);
    expect(g.board.edges[1].piece).toEqual({ type: RICKETY, owner: p1.id });

    // Audit after painting pieces: bridge pool and settlement supply remain synchronized!
    const auditAfterPaint = auditGameState(room, p1.id);
    expect(auditAfterPaint.ok).toBe(true);

    // Force a dice roll
    const rollRes = applyDebugCommand(room, p1.id, 'forceRoll', { sum: 6 });
    expect(rollRes.ok).toBe(true);
    expect(g.dice[0] + g.dice[1]).toBe(6);

    // Export repro snapshot
    const snapRes = applyDebugCommand(room, p1.id, 'exportSnapshot');
    expect(snapRes.ok).toBe(true);
    expect(snapRes.snapshot.seed).toBe(g.seed);
    expect(snapRes.snapshot.placedPieces.vertices.some((v: any) => v.id === 0)).toBe(true);
  });

  it('diffs client vs server placement spots and flags hidden legal spots or shown illegal spots', () => {
    const diffs = diffClientVsServerSpots(
      {
        settlementVertices: [1, 2],
        roadEdges: [5, 9],
        bridgeEdges: [],
        netHexes: [10],
        harborVertices: [],
        portRaiseVertices: []
      },
      {
        settlementVertices: [1, 2, 4],
        roadEdges: [5],
        bridgeEdges: [],
        netHexes: [10],
        harborVertices: [],
        portRaiseVertices: [3]
      }
    );

    expect(diffs).toContain('Client hides legal settlement: V4');
    expect(diffs).toContain('Client shows illegal road: E9');
    expect(diffs).toContain('Client hides legal port raise: V3');
  });
});
