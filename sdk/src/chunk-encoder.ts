// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1619@gmail.com

import { ChunkMessage } from './types';
import { hashChunk } from './chunk-hasher';

export type ChunkCallback = (chunk: ChunkMessage) => void;

export interface ChunkEncoderOptions {
  mimeType?: string;
  useWebCodecs?: boolean;
}

/**
 * Ultra-Low-Latency Chunk Encoder.
 *
 * Optimizations:
 * - 50ms chunk interval (down from 200ms) — 4x lower buffering latency
 * - Async hash computation — hashing runs in parallel, doesn't block forwarding
 * - WebCodecs AV1/H.264 support with MediaRecorder fallback
 */
export class ChunkEncoder {
  private mediaRecorder: MediaRecorder | null = null;
  private videoEncoder: any | null = null; // VideoEncoder type might not be fully available in TS DOM standard yet without libs
  private seq = 0;
  private onChunk: ChunkCallback | null = null;
  
  private mimeType: string;
  private useWebCodecs: boolean;
  private frameCount = 0;

  constructor(
    private stream: MediaStream,
    options: string | ChunkEncoderOptions = {}
  ) {
    if (typeof options === 'string') {
      this.mimeType = options;
      this.useWebCodecs = ChunkEncoder.isWebCodecsSupported();
    } else {
      this.mimeType = options.mimeType || 'video/webm; codecs="vp8,opus"';
      this.useWebCodecs = options.useWebCodecs ?? ChunkEncoder.isWebCodecsSupported();
    }
  }

  static isWebCodecsSupported(): boolean {
    return typeof (window as any).VideoEncoder !== 'undefined';
  }

  /**
   * @param onChunk - Called for each encoded chunk
   * @param chunkTimeMs - Chunk interval in ms. Default 50ms for ultra-low latency.
   */
  start(onChunk: ChunkCallback, chunkTimeMs: number = 50) {
    this.onChunk = onChunk;
    this.seq = 0;

    if (this.useWebCodecs && ChunkEncoder.isWebCodecsSupported()) {
      this.startWebCodecs(chunkTimeMs);
    } else {
      this.startMediaRecorder(chunkTimeMs);
    }
  }

  private async startWebCodecs(chunkTimeMs: number) {
    const videoTrack = this.stream.getVideoTracks()[0];
    if (!videoTrack) {
      this.startMediaRecorder(chunkTimeMs);
      return;
    }

    let codec = 'av01.0.04M.08'; // AV1
    try {
      const VideoEncoder = (window as any).VideoEncoder;
      const support = await VideoEncoder.isConfigSupported({ codec, width: 1280, height: 720, bitrate: 1_500_000, framerate: 30 });
      if (!support.supported) {
        codec = 'avc1.42E01E'; // H.264 fallback
      }
    } catch (e) {
      codec = 'avc1.42E01E';
    }

    this.videoEncoder = new (window as any).VideoEncoder({
      output: (chunk: any, metadata: any) => {
        const arrayBuffer = new ArrayBuffer(chunk.byteLength);
        chunk.copyTo(arrayBuffer);
        const currentSeq = this.seq++;

        hashChunk(arrayBuffer).then((hash) => {
          const chunkMsg: ChunkMessage = {
            seq: currentSeq,
            ts: Date.now(),
            hash,
            data: arrayBuffer,
          };
          if (this.onChunk) {
            this.onChunk(chunkMsg);
          }
        });
      },
      error: (err: any) => {
        console.error("VideoEncoder error", err);
      }
    });

    this.videoEncoder.configure({
      codec: codec,
      width: 1280,
      height: 720,
      bitrate: 1_500_000,
      framerate: 30,
    });

    const trackProcessor = new (window as any).MediaStreamTrackProcessor({ track: videoTrack });
    const reader = trackProcessor.readable.getReader();

    const readFrames = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && this.videoEncoder && this.videoEncoder.state === 'configured') {
            const insertKeyFrame = this.frameCount % 30 === 0;
            this.videoEncoder.encode(value, { keyFrame: insertKeyFrame });
            this.frameCount++;
            value.close();
          } else if (value) {
            value.close();
          }
        }
      } catch (e) {
        console.error("Frame reader error", e);
      }
    };
    readFrames();
  }

  private startMediaRecorder(chunkTimeMs: number) {
    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType: this.mimeType,
      videoBitsPerSecond: 1_500_000,
    });

    this.mediaRecorder.ondataavailable = async (e) => {
      if (e.data && e.data.size > 0) {
        const arrayBuffer = await e.data.arrayBuffer();
        const currentSeq = this.seq++;

        hashChunk(arrayBuffer).then((hash) => {
          const chunk: ChunkMessage = {
            seq: currentSeq,
            ts: Date.now(),
            hash,
            data: arrayBuffer,
          };
          if (this.onChunk) {
            this.onChunk(chunk);
          }
        });
      }
    };

    this.mediaRecorder.start(chunkTimeMs);
  }

  stop() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    if (this.videoEncoder && this.videoEncoder.state !== 'closed') {
      this.videoEncoder.close();
    }
    this.onChunk = null;
  }
}
