export interface ChunkMessage {
  seq: number;        // Sequential chunk number
  ts: number;         // Timestamp in ms
  hash: string;       // SHA-256 hex hash of data
  data: ArrayBuffer;  // Raw WebM video data
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
