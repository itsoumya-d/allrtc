// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com | +91 7031648617

import { ChunkMessage } from './types';
import { EventEmitter } from './events';

interface VideoAssemblerEvents {
  error: Error;
}

/**
 * Zero-Lag Deduplicating Video Assembler.
 * Handles dual-parent redundant chunk streams seamlessly without stutter.
 */
export class VideoAssembler extends EventEmitter<VideoAssemblerEvents> {
  private mediaSource: MediaSource;
  private sourceBuffer: SourceBuffer | null = null;
  private queue: ArrayBuffer[] = [];
  private seenSequences = new Set<number>();
  private maxSeenHistory = 500;
  public videoElement: HTMLVideoElement;

  constructor(private mimeType: string = 'video/webm; codecs="vp8,opus"') {
    super();
    this.mediaSource = new MediaSource();
    this.videoElement = document.createElement('video');
    this.videoElement.autoplay = true;
    this.videoElement.playsInline = true;
    this.videoElement.muted = true;
    this.videoElement.src = URL.createObjectURL(this.mediaSource);

    this.mediaSource.addEventListener('sourceopen', () => {
      try {
        this.sourceBuffer = this.mediaSource.addSourceBuffer(this.mimeType);
        this.sourceBuffer.mode = 'sequence';
        this.sourceBuffer.addEventListener('updateend', () => this.processQueue());
        this.processQueue();
      } catch (e) {
        this.emit('error', e as Error);
      }
    });
  }

  /**
   * Accepts chunks from primary OR backup parent.
   * Automatically drops duplicates so video playback never stutters!
   */
  addChunk(chunk: ChunkMessage) {
    if (this.seenSequences.has(chunk.seq)) {
      return; // Duplicate chunk from backup parent — drop silently!
    }

    this.seenSequences.add(chunk.seq);
    if (this.seenSequences.size > this.maxSeenHistory) {
      const first = this.seenSequences.values().next().value;
      if (first !== undefined) this.seenSequences.delete(first);
    }

    this.queue.push(chunk.data);
    this.processQueue();
  }

  private processQueue() {
    if (
      this.sourceBuffer &&
      !this.sourceBuffer.updating &&
      this.queue.length > 0 &&
      this.mediaSource.readyState === 'open'
    ) {
      try {
        const data = this.queue.shift();
        if (data) {
          this.sourceBuffer.appendBuffer(data);
        }
      } catch (e) {
        // Handle buffer eviction if full
        if (this.sourceBuffer && this.sourceBuffer.buffered.length > 0) {
          try {
            const start = this.sourceBuffer.buffered.start(0);
            const end = this.sourceBuffer.buffered.end(0);
            if (end - start > 30) {
              this.sourceBuffer.remove(start, end - 15);
            }
          } catch {}
        }
        this.emit('error', e as Error);
      }
    }
  }
}
