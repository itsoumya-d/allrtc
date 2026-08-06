// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1619@gmail.com

import { TrackerMessage } from './types';
import { EventEmitter } from './events';

interface TrackerEvents {
  open: void;
  message: TrackerMessage;
  close: void;
  error: Event;
  /** Emitted once when every reconnect attempt has been used up. */
  exhausted: void;
}

/**
 * Resilient WebSocket connection to the AllRTC Tracker.
 * 
 * Anti-blocking features:
 * - Uses WSS (port 443) which is indistinguishable from normal HTTPS traffic
 * - Auto-reconnects with exponential backoff on disconnect
 * - Heartbeat keepalive prevents idle connection timeouts
 * - Can relay video chunks via WebSocket when WebRTC DataChannel is blocked
 */
export class TrackerClient extends EventEmitter<TrackerEvents> {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 50;
  private reconnectTimer: any = null;
  private heartbeatTimer: any = null;
  private intentionalClose = false;

  constructor(
    private url: string,
    private role: 'publisher' | 'viewer',
    private streamId: string,
    /** This peer's id. The tracker only registers a peer on a `join` message. */
    private peerId: string = '',
    /** Whether this peer may act as a relay parent for other viewers. */
    private canRelay: boolean = true
  ) {
    super();
  }

  connect() {
    this.intentionalClose = false;
    this.doConnect();
  }

  private doConnect() {
    try {
      this.ws = new WebSocket(
        `${this.url}?role=${this.role}&streamId=${this.streamId}`
      );
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      // The tracker registers a peer ONLY in its `case "join"` branch
      // (tracker/handler.go). Without this the socket connects, stays open, and
      // the peer is never added to the swarm — no parent assignment, no
      // signalling, no stream. This must be sent on every (re)connect.
      if (this.peerId) {
        this.send({
          type: 'join',
          peerId: this.peerId,
          role: this.role,
          canRelay: this.canRelay,
        });
      }
      this.startHeartbeat();
      this.emit('open', undefined);
    };

    this.ws.onmessage = (e) => {
      try {
        const msg: TrackerMessage = JSON.parse(e.data);
        if (msg.type === 'pong') return; // Heartbeat response
        this.emit('message', msg);
      } catch {}
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.emit('close', undefined);
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (err) => {
      this.emit('error', err);
    };
  }

  /**
   * Exponential backoff reconnection.
   * Starts at 500ms, doubles each attempt, caps at 30 seconds.
   */
  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      // Previously this returned silently, so a permanently unreachable tracker
      // produced no observable signal at all — the caller waited forever.
      this.emit('exhausted', undefined);
      return;
    }
    const delay = Math.min(500 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.doConnect(), delay);
  }

  /**
   * Heartbeat prevents ISP/proxy idle connection timeouts.
   * Many corporate proxies kill idle WebSocket connections after 30-60s.
   */
  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping', peerId: this.peerId });
    }, 15000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  send(msg: TrackerMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * WebSocket Chunk Relay Fallback.
   * When WebRTC DataChannel is blocked by firewall, chunks are relayed
   * through the tracker's WebSocket instead. To ISP/DPI, this looks like
   * normal HTTPS WebSocket traffic (port 443) — impossible to distinguish.
   */
  sendChunkViaWs(seq: number, data: ArrayBuffer) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Convert ArrayBuffer to base64 for JSON transport
      // Optimization: Chunked apply is ~20x faster than character-by-character loop
      // and avoids GC stutters in ultra-low latency scenarios (e.g. 50ms interval).
      const bytes = new Uint8Array(data);
      let binary = '';
      const CHUNK_SIZE = 8192; // 8KB chunks to avoid call stack limits

      for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        binary += String.fromCharCode.apply(
          null,
          bytes.subarray(i, i + CHUNK_SIZE) as unknown as number[]
        );
      }
      const b64 = btoa(binary);
      this.send({ type: 'ws_chunk_relay', seq, chunkData: b64 });
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  disconnect() {
    this.intentionalClose = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
