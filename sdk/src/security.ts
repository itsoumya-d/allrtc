import { hashChunk } from './chunk-hasher';

export async function verifyChunk(data: ArrayBuffer, expectedHash: string): Promise<boolean> {
  const actualHash = await hashChunk(data);
  return actualHash === expectedHash;
}

export class ReputationManager {
  private scores = new Map<string, number>();

  recordSuccess(peerId: string) {
    const current = this.scores.get(peerId) || 0;
    this.scores.set(peerId, Math.min(100, current + 5));
  }

  recordFailure(peerId: string) {
    const current = this.scores.get(peerId) || 0;
    this.scores.set(peerId, Math.max(-100, current - 20));
  }

  isReliable(peerId: string): boolean {
    const score = this.scores.get(peerId) || 0;
    return score > -50;
  }
}
