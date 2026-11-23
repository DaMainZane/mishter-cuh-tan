// MODULE: unified P2P and local-host socket transport (WebRTC PeerJS + BroadcastChannel + embedded host server for serverless invite-code multiplayer) | DEPENDS ON: none | USED BY: client/actions, client/cursors, client/debug, client/main, client/mapmenu, client/pieceui, +12 more
import Peer, { type DataConnection } from 'peerjs';

const PEER_PREFIX = 'mct-room-';
const BC_PREFIX = 'mct-p2p-';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' }
];

export interface P2PStatus {
  role: 'idle' | 'host' | 'guest';
  code: string;
  transport: 'embedded' | 'webrtc' | 'broadcast' | 'socketio';
  connectedPeers: number;
  signalingOnline: boolean;
}

type EventCallback = (data?: any) => void;

class HybridP2PSocket {
  id: string;
  connected = true;
  private listeners = new Map<string, EventCallback[]>();
  private localHandle: { id: string; emitToServer: (ev: string, data?: any) => void; disconnect: () => void } | null = null;

  // Host state
  private hostedRoomCode = '';
  private hostPeer: Peer | null = null;
  private hostBc: BroadcastChannel | null = null;
  private remoteGuestHandles = new Map<string, { emitToServer: (ev: string, data?: any) => void; disconnect: () => void }>();

  // Guest state
  private guestMode: 'none' | 'connecting' | 'webrtc' | 'broadcast' | 'socketio' = 'none';
  private guestRoomCode = '';
  private guestPeer: Peer | null = null;
  private guestConn: DataConnection | null = null;
  private guestBc: BroadcastChannel | null = null;
  private pendingGuestQueue: Array<{ event: string; payload: any }> = [];

  // Optional fallback socket.io connection if running against a dedicated Node server without embedded host
  private fallbackIo: any = null;

  status: P2PStatus = {
    role: 'idle',
    code: '',
    transport: 'embedded',
    connectedPeers: 0,
    signalingOnline: false
  };

  constructor() {
    this.id = 'local_' + Math.random().toString(36).substring(2, 10);
    if (typeof window !== 'undefined') {
      queueMicrotask(() => this.attachLocalEmbeddedHost());
    }
  }

  private notifyStatus(): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('hex:p2p-status', { detail: { ...this.status } }));
    }
  }

  private getEmbeddedHost(): any {
    if (typeof globalThis === 'undefined') return null;
    return (globalThis as any).__HEX_EMBEDDED_HOST__ || null;
  }

  private attachLocalEmbeddedHost(): void {
    const host = this.getEmbeddedHost();
    if (!host) {
      if (typeof (globalThis as any).io === 'function' && !this.fallbackIo) {
        this.fallbackIo = (globalThis as any).io();
        this.fallbackIo.on('connect', () => {
          this.id = this.fallbackIo.id || this.id;
        });
        for (const [ev, cbs] of this.listeners.entries()) {
          for (const cb of cbs) this.fallbackIo.on(ev, cb);
        }
      }
      return;
    }

    if (this.localHandle) return;
    this.localHandle = host.connectClient(this.id, (event: string, payload?: any) => {
      if (this.guestMode !== 'none') return; // Ignore local host events while connected as a guest to a remote host
      this.handleIncomingEvent(event, payload);
    });
  }

  private handleIncomingEvent(event: string, payload?: any): void {
    if (event === 'gameState' && payload && typeof payload.code === 'string') {
      const code = payload.code.trim().toUpperCase();
      if (this.guestMode === 'none' && payload.hostId === this.id && code !== this.hostedRoomCode) {
        this.startHostingRoomP2P(code);
      }
    }
    const list = this.listeners.get(event);
    if (!list) return;
    for (const fn of list) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`Error in client listener for ${event}:`, err);
      }
    }
  }

  private startHostingRoomP2P(code: string): void {
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode || this.hostedRoomCode === cleanCode) return;
    this.stopHostingRoomP2P();
    this.hostedRoomCode = cleanCode;
    this.status = {
      role: 'host',
      code: cleanCode,
      transport: 'embedded',
      connectedPeers: 0,
      signalingOnline: false
    };
    this.notifyStatus();

    const host = this.getEmbeddedHost();
    if (!host) return;

    // 1. BroadcastChannel transport for instant offline / multi-tab same-device P2P
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const bc = new BroadcastChannel(BC_PREFIX + cleanCode);
        this.hostBc = bc;
        bc.onmessage = (ev: MessageEvent) => {
          const msg = ev.data;
          if (!msg || typeof msg !== 'object') return;
          if (msg.type === 'HELLO' && typeof msg.guestId === 'string') {
            const guestId = msg.guestId;
            if (!this.remoteGuestHandles.has(guestId)) {
              const handle = host.connectClient(guestId, (serverEvent: string, serverPayload?: any) => {
                bc.postMessage({ type: 'SERVER_EMIT', targetId: guestId, event: serverEvent, payload: serverPayload });
              });
              this.remoteGuestHandles.set(guestId, handle);
              this.status.connectedPeers = this.remoteGuestHandles.size;
              this.notifyStatus();
            }
            bc.postMessage({ type: 'WELCOME', targetId: guestId, code: cleanCode });
          } else if (msg.type === 'CLIENT_EMIT' && typeof msg.guestId === 'string' && typeof msg.event === 'string') {
            let handle = this.remoteGuestHandles.get(msg.guestId);
            if (!handle) {
              handle = host.connectClient(msg.guestId, (serverEvent: string, serverPayload?: any) => {
                bc.postMessage({ type: 'SERVER_EMIT', targetId: msg.guestId, event: serverEvent, payload: serverPayload });
              });
              this.remoteGuestHandles.set(msg.guestId, handle!);
              this.status.connectedPeers = this.remoteGuestHandles.size;
              this.notifyStatus();
            }
            handle!.emitToServer(msg.event, msg.payload);
          } else if (msg.type === 'BYE' && typeof msg.guestId === 'string') {
            const handle = this.remoteGuestHandles.get(msg.guestId);
            if (handle) {
              handle.disconnect();
              this.remoteGuestHandles.delete(msg.guestId);
              this.status.connectedPeers = this.remoteGuestHandles.size;
              this.notifyStatus();
            }
          }
        };
      } catch {}
    }

    // 2. WebRTC PeerJS transport for cross-network internet P2P by Invite Code
    try {
      const peerId = PEER_PREFIX + cleanCode;
      const peer = new Peer(peerId, {
        config: { iceServers: ICE_SERVERS }
      });
      this.hostPeer = peer;

      peer.on('open', () => {
        this.status.signalingOnline = true;
        this.status.transport = 'webrtc';
        this.notifyStatus();
      });

      peer.on('connection', (conn: DataConnection) => {
        const guestId = 'peer_' + conn.peer.replace(/[^a-zA-Z0-9_]/g, '').slice(-12);
        let handle: { emitToServer: (ev: string, data?: any) => void; disconnect: () => void } | null = null;

        const ensureHandle = () => {
          if (handle) return handle;
          handle = host.connectClient(guestId, (serverEvent: string, serverPayload?: any) => {
            if (conn.open) {
              conn.send({ type: 'SERVER_EMIT', event: serverEvent, payload: serverPayload });
            }
          });
          this.remoteGuestHandles.set(guestId, handle!);
          this.status.connectedPeers = this.remoteGuestHandles.size;
          this.notifyStatus();
          return handle!;
        };

        conn.on('open', () => {
          ensureHandle();
          conn.send({ type: 'WELCOME', assignedId: guestId, code: cleanCode });
        });

        conn.on('data', (raw: any) => {
          const msg = raw as any;
          if (!msg || typeof msg !== 'object') return;
          if (msg.type === 'CLIENT_EMIT' && typeof msg.event === 'string') {
            ensureHandle().emitToServer(msg.event, msg.payload);
          }
        });

        const cleanup = () => {
          const h = this.remoteGuestHandles.get(guestId);
          if (h) {
            h.disconnect();
            this.remoteGuestHandles.delete(guestId);
            this.status.connectedPeers = this.remoteGuestHandles.size;
            this.notifyStatus();
          }
        };
        conn.on('close', cleanup);
        conn.on('error', cleanup);
      });

      peer.on('error', () => {
        // Keep BroadcastChannel and local host running even if offline
        this.status.signalingOnline = false;
        this.notifyStatus();
      });
    } catch {}
  }

  private stopHostingRoomP2P(): void {
    for (const h of this.remoteGuestHandles.values()) {
      try { h.disconnect(); } catch {}
    }
    this.remoteGuestHandles.clear();
    if (this.hostBc) {
      try { this.hostBc.close(); } catch {}
      this.hostBc = null;
    }
    if (this.hostPeer) {
      try { this.hostPeer.destroy(); } catch {}
      this.hostPeer = null;
    }
    this.hostedRoomCode = '';
  }

  private disconnectGuestP2P(): void {
    if (this.guestBc && this.guestRoomCode) {
      try {
        this.guestBc.postMessage({ type: 'BYE', guestId: this.id });
        this.guestBc.close();
      } catch {}
    }
    this.guestBc = null;
    if (this.guestConn) {
      try { this.guestConn.close(); } catch {}
      this.guestConn = null;
    }
    if (this.guestPeer) {
      try { this.guestPeer.destroy(); } catch {}
      this.guestPeer = null;
    }
    this.guestMode = 'none';
    this.guestRoomCode = '';
    this.pendingGuestQueue = [];
  }

  private connectAsGuestToCode(code: string, initialEvent: string, initialPayload: any): void {
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) {
      this.handleIncomingEvent('errorMsg', 'Please enter a valid 5-character Invite Code.');
      return;
    }

    // If already connected as a guest to this same room code, emit directly
    if ((this.guestMode === 'webrtc' || this.guestMode === 'broadcast') && this.guestRoomCode === cleanCode) {
      this.sendFromGuest(initialEvent, initialPayload);
      return;
    }

    this.stopHostingRoomP2P();
    this.disconnectGuestP2P();

    this.guestMode = 'connecting';
    this.guestRoomCode = cleanCode;
    this.pendingGuestQueue.push({ event: initialEvent, payload: initialPayload });
    this.status = {
      role: 'guest',
      code: cleanCode,
      transport: 'webrtc',
      connectedPeers: 1,
      signalingOnline: true
    };
    this.notifyStatus();

    let settled = false;
    const flushPending = () => {
      const q = [...this.pendingGuestQueue];
      this.pendingGuestQueue = [];
      for (const item of q) {
        this.sendFromGuest(item.event, item.payload);
      }
    };

    // 1. Try fast same-device BroadcastChannel handshake first
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const bc = new BroadcastChannel(BC_PREFIX + cleanCode);
        this.guestBc = bc;
        bc.onmessage = (ev: MessageEvent) => {
          const msg = ev.data;
          if (!msg || typeof msg !== 'object') return;
          if (msg.type === 'WELCOME' && msg.targetId === this.id && !settled) {
            settled = true;
            this.guestMode = 'broadcast';
            this.status.transport = 'broadcast';
            this.notifyStatus();
            if (this.guestPeer) {
              try { this.guestPeer.destroy(); } catch {}
              this.guestPeer = null;
            }
            flushPending();
          } else if (msg.type === 'SERVER_EMIT' && msg.targetId === this.id && typeof msg.event === 'string') {
            this.handleIncomingEvent(msg.event, msg.payload);
          }
        };
        bc.postMessage({ type: 'HELLO', guestId: this.id });
      } catch {}
    }

    // 2. Connect across the internet via WebRTC PeerJS to the host player's phone
    try {
      const peer = new Peer({
        config: { iceServers: ICE_SERVERS }
      });
      this.guestPeer = peer;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.disconnectGuestP2P();
          this.handleIncomingEvent('errorMsg', `Could not reach room "${cleanCode}". Check the invite code and make sure the host has the room open.`);
        }
      }, 9500);

      peer.on('open', () => {
        if (settled) return;
        const conn = peer.connect(PEER_PREFIX + cleanCode, { reliable: true });
        this.guestConn = conn;

        conn.on('data', (raw: any) => {
          const msg = raw as any;
          if (!msg || typeof msg !== 'object') return;
          if (msg.type === 'WELCOME' && !settled) {
            settled = true;
            clearTimeout(timeout);
            if (typeof msg.assignedId === 'string') {
              this.id = msg.assignedId;
            }
            this.guestMode = 'webrtc';
            this.status.transport = 'webrtc';
            this.notifyStatus();
            if (this.guestBc) {
              try { this.guestBc.close(); } catch {}
              this.guestBc = null;
            }
            flushPending();
          } else if (msg.type === 'SERVER_EMIT' && typeof msg.event === 'string') {
            this.handleIncomingEvent(msg.event, msg.payload);
          }
        });

        conn.on('error', () => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            this.disconnectGuestP2P();
            this.handleIncomingEvent('errorMsg', `Connection to room "${cleanCode}" failed.`);
          }
        });
      });

      peer.on('error', (err: any) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          this.disconnectGuestP2P();
          const reason = err?.type === 'peer-unavailable'
            ? `Room "${cleanCode}" was not found or the host is offline.`
            : `Network error connecting to room "${cleanCode}".`;
          this.handleIncomingEvent('errorMsg', reason);
        }
      });
    } catch {
      if (!settled) {
        this.disconnectGuestP2P();
        this.handleIncomingEvent('errorMsg', `Unable to initialize P2P connection for "${cleanCode}".`);
      }
    }
  }

  private sendFromGuest(event: string, payload?: any): void {
    if (this.guestMode === 'broadcast' && this.guestBc) {
      this.guestBc.postMessage({
        type: 'CLIENT_EMIT',
        guestId: this.id,
        event,
        payload
      });
    } else if (this.guestMode === 'webrtc' && this.guestConn && this.guestConn.open) {
      this.guestConn.send({
        type: 'CLIENT_EMIT',
        event,
        payload
      });
    } else if (this.guestMode === 'connecting') {
      this.pendingGuestQueue.push({ event, payload });
    }
  }

  on(event: string, fn: EventCallback): this {
    const list = this.listeners.get(event) || [];
    list.push(fn);
    this.listeners.set(event, list);
    if (this.fallbackIo) {
      this.fallbackIo.on(event, fn);
    }
    return this;
  }

  emit(event: string, payload?: any): this {
    const host = this.getEmbeddedHost();

    if (host) {
      this.attachLocalEmbeddedHost();

      if (event === 'createRoom') {
        this.disconnectGuestP2P();
        this.localHandle?.emitToServer(event, payload);
        return this;
      }

      if (event === 'joinRoom' || event === 'spectateRoom' || event === 'reconnectRoom') {
        const targetCode = String(payload?.code || '').trim().toUpperCase();
        if (targetCode && host.hasRoom(targetCode)) {
          this.disconnectGuestP2P();
          this.localHandle?.emitToServer(event, payload);
          return this;
        }
        if (!targetCode && host.getRoomCodes().length > 0) {
          this.disconnectGuestP2P();
          this.localHandle?.emitToServer(event, payload);
          return this;
        }
        // Connect to remote friend's P2P-hosted room via invite code
        this.connectAsGuestToCode(targetCode, event, payload);
        return this;
      }

      if (this.guestMode !== 'none') {
        this.sendFromGuest(event, payload);
        return this;
      }

      this.localHandle?.emitToServer(event, payload);
      return this;
    }

    if (this.fallbackIo) {
      this.fallbackIo.emit(event, payload);
    }
    return this;
  }
}

export const socket: any = new HybridP2PSocket();
