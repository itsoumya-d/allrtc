// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1619@gmail.com

export interface ChunkMessage {
  seq: number;        // Sequential chunk number
  ts: number;         // Timestamp in ms
  hash: string;       // SHA-256 hex hash of data
  data: ArrayBuffer;  // Raw WebM video data
  from?: string;      // Peer id the chunk arrived from; absent when locally produced
}

export type Role = 'publisher' | 'viewer';

export interface SignalMessage {
  type: 'signal';
  to: string;
  from: string;
  payload: any;
}

export interface TrackerMessage {
  type: string;
  [key: string]: any;
}
