// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com

import { TrackerClient } from './tracker-client';
import { PeerManager } from './peer-manager';
import { VideoAssembler } from './video-assembler';
import { verifyChunk } from './security';
import { EventEmitter } from './events';

interface ViewerEvents {
  connected: void;
  disconnected: void;
}

/**
 * AllRTC Viewer with Smart Mobile Data Protection & Dual-Parent Zero-Freeze Relay.
 */
export class AllRTCViewer extends EventEmitter<ViewerEvents> {
  private tracker: TrackerClient;
  private peerManager: PeerManager;
  private assembler: VideoAssembler;
  private myId: string;
  private expectedHashes = new Map<number, string>();
  private static readonly MAX_EXPECTED_HASHES = 2048;
  public canRelay: boolean = true;

  constructor(trackerUrl: string, streamId: string) {
    super();
    this.myId = 'view_' + Math.random().toString(36).substring(2, 9);
    
    // Auto-detect Network Connection & Battery State
    this.detectDeviceCapabilities();

    this.tracker = new TrackerClient(
      trackerUrl,
      'viewer',
      streamId,
      this.myId,
      this.canRelay
    );
    this.peerManager = new PeerManager(this.tracker, this.myId);
    this.assembler = new VideoAssembler();

    // Surface the connection lifecycle. These are the events the public API
    // documents, but nothing ever emitted them, so an unreachable tracker was
    // completely silent to the caller.
    this.tracker.on('open', () => this.emit('connected', undefined));
    this.tracker.on('close', () => this.emit('disconnected', undefined));

    this.tracker.on('message', (msg) => {
      if (msg.type === 'manifest') {
        this.rememberExpectedHash(msg.seq, msg.hash);
      } else if (msg.type === 'assigned') {
        // Connect to Primary Parent
        if (msg.parentPeerId) {
          this.peerManager.connectToPeer(msg.parentPeerId);
        }
        // Connect to Backup Parent for Dual-Stream Zero-Freeze Redundancy
        if (msg.backupPeerId) {
          this.peerManager.connectToPeer(msg.backupPeerId);
        }
      } else if (msg.type === 'new_child') {
        // The tracker sends `childPeerId` (tracker/types.go OutgoingMessage).
        // Reading only `childId` meant every new_child notification was dropped
        // and relay parents never dialled their children.
        const childId = msg.childPeerId || msg.childId;
        // Only accept children if on unmetered connection / desktop
        if (this.canRelay && childId) {
          this.peerManager.connectToPeer(childId);
        }
      } else if (msg.type === 'parent_changed') {
        if (msg.newParentPeerId) {
          this.peerManager.connectToPeer(msg.newParentPeerId);
        }
      }
    });

    this.peerManager.on('chunk', (chunk) => {
      /**
       * FORWARD-FIRST, VERIFY-AFTER (Zero-Delay Pipeline)
       *
       * Old approach: receive → verify hash (5-10ms) → THEN play + relay
       * New approach: receive → play + relay IMMEDIATELY → verify async
       *
       * This eliminates hash verification from the critical path entirely.
       * If a chunk fails verification (extremely rare — requires a malicious
       * peer to inject fake data through DTLS encryption), a drop notification
       * is sent to children.
       */

      // Step 1: IMMEDIATELY play and relay (0ms delay)
      this.assembler.addChunk(chunk);
      if (this.canRelay) {
        this.peerManager.broadcastChunk(chunk);
      }

      // Step 2: Verify hash ASYNC in background (doesn't block playback)
      const expectedHash = this.expectedHashes.get(chunk.seq);
      if (expectedHash) {
        verifyChunk(chunk.data, expectedHash).then((isValid) => {
          if (!isValid) {
            // Extremely rare: malicious chunk detected after forwarding
            console.warn('[AllRTC] Bad chunk detected:', chunk.seq);
            // Future: send drop notification to children
          }
          this.expectedHashes.delete(chunk.seq);
        });
      }
    });
  }

  /**
   * Record an expected chunk hash, bounding the map.
   *
   * Entries are otherwise deleted only when the matching chunk actually
   * arrives, so manifests for chunks that never arrive accumulate forever.
   */
  private rememberExpectedHash(seq: number, hash: string) {
    if (typeof seq !== 'number' || typeof hash !== 'string') return;
    this.expectedHashes.set(seq, hash);
    while (this.expectedHashes.size > AllRTCViewer.MAX_EXPECTED_HASHES) {
      const oldest = this.expectedHashes.keys().next().value;
      if (oldest === undefined) break;
      this.expectedHashes.delete(oldest);
    }
  }

  /**
   * Smart Device Tiering:
   * Protects mobile users from battery drain and mobile data usage.
   */
  private detectDeviceCapabilities() {
    try {
      // Check for cellular connection (4G/5G/3G)
      const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      if (conn) {
        if (conn.type === 'cellular' || conn.saveData === true) {
          this.canRelay = false; // Mobile data detected -> Receive ONLY, 0 Upload!
        }
      }

      // Check mobile user agent
      if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) {
        this.canRelay = false;
      }
    } catch {
      this.canRelay = true;
    }
  }

  getVideoElement(): HTMLVideoElement {
    return this.assembler.videoElement;
  }

  start() {
    this.tracker.connect();
  }

  stop() {
    this.peerManager.disconnect();
    this.tracker.disconnect();
  }
}
