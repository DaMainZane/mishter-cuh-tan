// MODULE: embedded browser/mobile host server adapter (runs the authoritative server and bots locally in-app for P2P player-hosted rooms) | DEPENDS ON: server/bots/scheduler, server/bots/trainingLog, server/net, server/rooms, server/socket | USED BY: none
import type { Server } from 'socket.io';
import { initBots } from './bots/scheduler';
import { exportTrainingLogsJsonl } from './bots/trainingLog';
import { setIo } from './net';
import { rooms } from './rooms';
import { registerSocketHandlers } from './socket';

export interface EmbeddedClientHandle {
  id: string;
  emitToServer: (event: string, payload?: any) => void;
  disconnect: () => void;
}

export interface EmbeddedHostController {
  connectClient: (clientId: string, onServerEmit: (event: string, payload?: any) => void) => EmbeddedClientHandle;
  hasRoom: (code: string) => boolean;
  getRoomCodes: () => string[];
  exportTrainingLogs: (roomCode?: string) => string;
}

function clonePayload<T>(payload: T): T {
  if (payload === undefined || payload === null || typeof payload !== 'object') return payload;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(payload);
    } catch {
      // Fall through to JSON clone if payload has non-cloneable fields.
    }
  }
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch {
    return payload;
  }
}

class VirtualServerSocket {
  id: string;
  data: Record<string, any> = {};
  rooms = new Set<string>();
  private listeners = new Map<string, Array<(data?: any) => void>>();
  private sendToClient: (event: string, payload?: any) => void;
  private getAllSockets: () => IterableIterator<VirtualServerSocket>;
  private onRemove: (id: string) => void;
  private disconnected = false;

  constructor(
    id: string,
    sendToClient: (event: string, payload?: any) => void,
    getAllSockets: () => IterableIterator<VirtualServerSocket>,
    onRemove: (id: string) => void
  ) {
    this.id = id;
    this.rooms.add(id);
    this.sendToClient = sendToClient;
    this.getAllSockets = getAllSockets;
    this.onRemove = onRemove;
  }

  join(roomCode: string): void {
    this.rooms.add(roomCode);
  }

  on(event: string, fn: (data?: any) => void): this {
    const list = this.listeners.get(event) || [];
    list.push(fn);
    this.listeners.set(event, list);
    return this;
  }

  emit(event: string, payload?: any): boolean {
    if (this.disconnected) return false;
    const cloned = clonePayload(payload);
    queueMicrotask(() => {
      if (!this.disconnected) {
        this.sendToClient(event, cloned);
      }
    });
    return true;
  }

  to(roomCode: string) {
    const broadcastToOthers = (event: string, payload?: any) => {
      for (const s of this.getAllSockets()) {
        if (s.id !== this.id && s.rooms.has(roomCode)) {
          s.emit(event, payload);
        }
      }
    };
    return {
      emit: broadcastToOthers,
      volatile: {
        emit: broadcastToOthers
      }
    };
  }

  receiveFromClient(event: string, payload?: any): void {
    if (this.disconnected) return;
    const list = this.listeners.get(event);
    if (!list) return;
    const cloned = clonePayload(payload);
    for (const fn of list) {
      fn(cloned);
    }
  }

  disconnect(): void {
    if (this.disconnected) return;
    this.disconnected = true;
    const list = this.listeners.get('disconnect') || [];
    for (const fn of list) {
      try {
        fn();
      } catch (err) {
        console.error('Embedded host disconnect error:', err);
      }
    }
    this.onRemove(this.id);
  }
}

class VirtualIoServer {
  sockets = {
    sockets: new Map<string, VirtualServerSocket>()
  };
  private connectionHandlers: Array<(socket: VirtualServerSocket) => void> = [];

  on(event: string, fn: (socket: VirtualServerSocket) => void): this {
    if (event === 'connection') {
      this.connectionHandlers.push(fn);
    }
    return this;
  }

  to(target: string) {
    return {
      emit: (event: string, payload?: any) => {
        const direct = this.sockets.sockets.get(target);
        if (direct) {
          direct.emit(event, payload);
          return;
        }
        for (const s of this.sockets.sockets.values()) {
          if (s.rooms.has(target)) {
            s.emit(event, payload);
          }
        }
      }
    };
  }

  connectClient(clientId: string, onServerEmit: (event: string, payload?: any) => void): EmbeddedClientHandle {
    const existing = this.sockets.sockets.get(clientId);
    if (existing) {
      existing.disconnect();
    }
    const sock = new VirtualServerSocket(
      clientId,
      onServerEmit,
      () => this.sockets.sockets.values(),
      (id) => this.sockets.sockets.delete(id)
    );
    this.sockets.sockets.set(clientId, sock);
    for (const handler of this.connectionHandlers) {
      handler(sock);
    }
    return {
      id: clientId,
      emitToServer: (event: string, payload?: any) => sock.receiveFromClient(event, payload),
      disconnect: () => sock.disconnect()
    };
  }
}

let hostInstance: EmbeddedHostController | null = null;

export function initEmbeddedHost(): EmbeddedHostController {
  if (hostInstance) return hostInstance;
  const virtualIo = new VirtualIoServer();
  setIo(virtualIo as unknown as Server);
  initBots();
  registerSocketHandlers(virtualIo as unknown as Server);

  hostInstance = {
    connectClient: (clientId, onServerEmit) => virtualIo.connectClient(clientId, onServerEmit),
    hasRoom: (code: string) => Boolean(rooms[String(code || '').trim().toUpperCase()]),
    getRoomCodes: () => Object.keys(rooms),
    exportTrainingLogs: (roomCode?: string) => exportTrainingLogsJsonl(roomCode)
  };

  if (typeof globalThis !== 'undefined') {
    (globalThis as any).__HEX_EMBEDDED_HOST__ = hostInstance;
  }
  return hostInstance;
}

if (typeof window !== 'undefined') {
  initEmbeddedHost();
}
