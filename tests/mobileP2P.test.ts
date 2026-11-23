// MODULE: unit tests for embedded P2P host server adapter (virtual room creation, explicit invite-code joins during setup, and rematchLobby openSetup)
import { describe, expect, it } from 'vitest';
import { initEmbeddedHost } from '../src/server/p2pHost';
import { rooms } from '../src/server/rooms';

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('embedded P2P host server', () => {
  it('lets a host create a room and a guest join by explicit invite code while in world setup', async () => {
    const host = initEmbeddedHost();
    const hostEvents: Array<{ event: string; payload: any }> = [];
    const guestEvents: Array<{ event: string; payload: any }> = [];

    const hostClient = host.connectClient('p2p_host_1', (event, payload) => {
      hostEvents.push({ event, payload });
    });
    const guestClient = host.connectClient('p2p_guest_1', (event, payload) => {
      guestEvents.push({ event, payload });
    });

    let code = '';
    try {
      hostClient.emitToServer('createRoom', { name: 'HostPlayer', clientId: 'cid_host_1' });
      await flush();

      const hostState = [...hostEvents].reverse().find(e => e.event === 'gameState')?.payload;
      expect(hostState).toBeTruthy();
      expect(hostState.setup).toBe(true);
      code = hostState.code;
      expect(code).toMatch(/^[A-Z0-9]{5}$/);
      expect(host.hasRoom(code)).toBe(true);

      // Guest joins by explicit invite code while room.setup === true
      guestClient.emitToServer('joinRoom', { code, name: 'GuestPlayer', clientId: 'cid_guest_1' });
      await flush();

      const guestState = [...guestEvents].reverse().find(e => e.event === 'gameState')?.payload;
      expect(guestState).toBeTruthy();
      expect(guestState.code).toBe(code);
      expect(guestState.players.map((p: any) => p.name)).toContain('GuestPlayer');
    } finally {
      guestClient.disconnect();
      hostClient.disconnect();
      if (code) delete rooms[code];
    }
  });

  it('supports returning from an active game to World Setup via rematchLobby({ openSetup: true })', async () => {
    const host = initEmbeddedHost();
    const hostEvents: Array<{ event: string; payload: any }> = [];

    const hostClient = host.connectClient('p2p_host_2', (event, payload) => {
      hostEvents.push({ event, payload });
    });

    let code = '';
    try {
      hostClient.emitToServer('createRoom', { name: 'HostTwo', clientId: 'cid_host_2' });
      await flush();
      code = [...hostEvents].reverse().find(e => e.event === 'gameState')?.payload?.code || '';
      expect(code).toBeTruthy();

      hostClient.emitToServer('addBot', { code });
      await flush();
      hostClient.emitToServer('startGame', { code });
      await flush();

      const startedState = [...hostEvents].reverse().find(e => e.event === 'gameState')?.payload;
      expect(startedState?.status).toBe('SETUP');

      hostClient.emitToServer('rematchLobby', { code, openSetup: true });
      await flush();

      const setupState = [...hostEvents].reverse().find(e => e.event === 'gameState')?.payload;
      expect(setupState?.status).toBe('LOBBY');
      expect(setupState?.setup).toBe(true);
    } finally {
      hostClient.disconnect();
      if (code) delete rooms[code];
    }
  });
});
