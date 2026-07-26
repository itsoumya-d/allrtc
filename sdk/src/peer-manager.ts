// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com | +91 7031648617

import { ChunkMessage } from './types';
import { EventEmitter } from './events';
import { TrackerClient } from './tracker-client';

interface PeerManagerEvents {
  chunk: ChunkMessage;
  connected: string;
  disconnected: string;
  webrtc_blocked: void;
}

/**
 * Manages WebRTC DataChannel connections between peers.
 * 
 * Anti-blocking & resilience features:
 * - Multi-region STUN + TURN-over-TLS (port 443) for maximum NAT traversal
 * - ICE restart on network switch (WiFi ↔ Cellular) — no connection drop
 * - Background tab keepalive using silent audio context
 * - Falls back to WebSocket chunk relay when WebRTC is completely blocked
 */
export class PeerManager extends EventEmitter<PeerManagerEvents> {
  private peers = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();
  private keepaliveCtx: AudioContext | null = null;
  private webrtcBlocked = false;
  private connectionAttempts = new Map<string, number>();

  constructor(private tracker: TrackerClient, private myId: string) {
    super();
    this.tracker.on('message', (msg) => {
      if (msg.type === 'signal' && msg.to === this.myId) {
        this.handleSignal(msg.from, msg.payload);
      }
      // Handle WebSocket chunk relay (fallback when WebRTC is blocked)
      if (msg.type === 'ws_chunk_relay' && msg.chunkData) {
        this.handleWsChunkRelay(msg);
      }
    });

    // Detect network changes and trigger ICE restart
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleNetworkChange());
      if ((navigator as any).connection) {
        (navigator as any).connection.addEventListener('change', () =>
          this.handleNetworkChange()
        );
      }
    }
  }

  async connectToPeer(peerId: string) {
    const pc = this.createPeerConnection(peerId);
    const dc = pc.createDataChannel('allrtc-chunks', {
      ordered: false,       // Unordered: don't wait for out-of-order packets
      maxRetransmits: 0,    // No retransmits: skip lost frames, don't wait
    });
    this.setupDataChannel(peerId, dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.tracker.send({
      type: 'signal',
      to: peerId,
      from: this.myId,
      payload: { type: 'offer', sdp: offer },
    });

    // Timeout: if WebRTC can't connect in 8 seconds, mark as blocked
    const attempts = (this.connectionAttempts.get(peerId) || 0) + 1;
    this.connectionAttempts.set(peerId, attempts);

    setTimeout(() => {
      if (pc.connectionState !== 'connected' && attempts >= 2) {
        this.webrtcBlocked = true;
        this.emit('webrtc_blocked', undefined);
      }
    }, 8000);
  }

  private createPeerConnection(peerId: string): RTCPeerConnection {
    /**
     * ICE Server Configuration for Maximum Network Penetration:
     * 
     * 1. Multi-region Google STUN (free, handles 80% of NAT cases)
     * 2. Cloudflare STUN (free, redundant)
     * 3. TURN-over-TLS on port 443 — THIS IS THE KEY:
     *    Traffic on port 443 with TLS encryption is IDENTICAL to regular
     *    HTTPS web browsing. No ISP, corporate firewall, or DPI engine
     *    can distinguish it from someone browsing Google.com.
     *    
     *    To enable: deploy a coturn server with `listening-tls-port=443`
     *    and set the TURN credentials in AllRTC config.
     */
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        // TURN-over-TLS on port 443 (uncomment with your credentials):
        // {
        //   urls: 'turns:your-turn-server.com:443?transport=tcp',
        //   username: 'allrtc',
        //   credential: 'your-secret'
        // }
      ],
      iceTransportPolicy: 'all',
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.tracker.send({
          type: 'signal',
          to: peerId,
          from: this.myId,
          payload: { type: 'ice', candidate: e.candidate },
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      // ICE restart on network switch (WiFi ↔ Cellular)
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        this.performIceRestart(peerId, pc);
      }
    };

    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === 'disconnected' ||
        pc.connectionState === 'failed'
      ) {
        this.peers.delete(peerId);
        this.dataChannels.delete(peerId);
        this.emit('disconnected', peerId);
      } else if (pc.connectionState === 'connected') {
        this.connectionAttempts.delete(peerId);
        this.emit('connected', peerId);
      }
    };

    pc.ondatachannel = (e) => {
      this.setupDataChannel(peerId, e.channel);
    };

    this.peers.set(peerId, pc);
    return pc;
  }

  /**
   * ICE Restart: Handles WiFi ↔ Cellular network switches seamlessly.
   * When the device's IP changes, this gathers new ICE candidates
   * without tearing down the peer connection.
   */
  private async performIceRestart(peerId: string, pc: RTCPeerConnection) {
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      this.tracker.send({
        type: 'signal',
        to: peerId,
        from: this.myId,
        payload: { type: 'offer', sdp: offer },
      });
    } catch {}
  }

  /**
   * Network change handler — restarts ICE on all active connections.
   */
  private handleNetworkChange() {
    for (const [peerId, pc] of this.peers) {
      if (pc.iceConnectionState !== 'connected') {
        this.performIceRestart(peerId, pc);
      }
    }
  }

  /**
   * WebSocket Chunk Relay Fallback.
   * When WebRTC DataChannels are blocked (strict corporate firewall),
   * chunks arrive through the tracker's WebSocket instead.
   * To the network, this is just regular HTTPS WebSocket traffic.
   */
  private handleWsChunkRelay(msg: any) {
    try {
      const binary = atob(msg.chunkData);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      this.emit('chunk', {
        seq: msg.seq,
        ts: Date.now(),
        hash: '',
        data: bytes.buffer,
      });
    } catch {}
  }

  private setupDataChannel(peerId: string, dc: RTCDataChannel) {
    dc.binaryType = 'arraybuffer';
    dc.onmessage = (e) => {
      const buffer = e.data as ArrayBuffer;
      if (buffer.byteLength < 76) return;

      const dv = new DataView(buffer);
      const seq = dv.getUint32(0);
      const ts = dv.getFloat64(4);

      const hashBytes = new Uint8Array(buffer, 12, 64);
      const hash = new TextDecoder().decode(hashBytes).trim();

      const data = buffer.slice(76);

      this.emit('chunk', { seq, ts, hash, data });
    };
    this.dataChannels.set(peerId, dc);
  }

  private async handleSignal(peerId: string, payload: any) {
    let pc = this.peers.get(peerId);
    if (!pc) {
      pc = this.createPeerConnection(peerId);
    }

    try {
      if (payload.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.tracker.send({
          type: 'signal',
          to: peerId,
          from: this.myId,
          payload: { type: 'answer', sdp: answer },
        });
      } else if (payload.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      } else if (payload.type === 'ice') {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      }
    } catch {}
  }

  /**
   * Background tab keepalive.
   * Browsers throttle inactive tabs, which can kill WebRTC connections.
   * A silent AudioContext oscillator prevents the browser from sleeping.
   */
  startKeepalive() {
    if (this.keepaliveCtx) return;
    try {
      this.keepaliveCtx = new AudioContext();
      const osc = this.keepaliveCtx.createOscillator();
      const gain = this.keepaliveCtx.createGain();
      gain.gain.value = 0; // Silent!
      osc.connect(gain);
      gain.connect(this.keepaliveCtx.destination);
      osc.start();
    } catch {}
  }

  stopKeepalive() {
    if (this.keepaliveCtx) {
      this.keepaliveCtx.close();
      this.keepaliveCtx = null;
    }
  }

  get isWebRTCBlocked(): boolean {
    return this.webrtcBlocked;
  }

  broadcastChunk(chunk: ChunkMessage) {
    const hashBytes = new TextEncoder().encode(chunk.hash.padEnd(64, ' '));
    const buffer = new ArrayBuffer(4 + 8 + 64 + chunk.data.byteLength);
    const dv = new DataView(buffer);

    dv.setUint32(0, chunk.seq);
    dv.setFloat64(4, chunk.ts);

    const u8 = new Uint8Array(buffer);
    u8.set(hashBytes, 12);
    u8.set(new Uint8Array(chunk.data), 76);

    let sent = false;
    for (const dc of this.dataChannels.values()) {
      if (dc.readyState === 'open') {
        try {
          dc.send(buffer);
          sent = true;
        } catch {}
      }
    }

    // If no DataChannels are open (WebRTC blocked), relay via WebSocket
    if (!sent && this.webrtcBlocked) {
      this.tracker.sendChunkViaWs(chunk.seq, chunk.data);
    }
  }

  disconnect() {
    this.stopKeepalive();
    for (const pc of this.peers.values()) {
      pc.close();
    }
    this.peers.clear();
    this.dataChannels.clear();
  }
}
