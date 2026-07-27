// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com | +91 7031648617

export interface QualityTier {
  name: 'Ultra' | 'High' | 'Medium' | 'Low' | 'Audio-only';
  resolution: string;
  maxBitrateKbps: number;
}

export class AdaptiveBitrateManager {
  private bandwidthHistory: Map<string, number[]> = new Map();
  private readonly WINDOW_SIZE = 10;
  private qualityChangeListeners: ((peerId: string, tier: QualityTier) => void)[] = [];
  private lastTier: Map<string, string> = new Map();

  constructor() {}

  public onQualityChange(listener: (peerId: string, tier: QualityTier) => void) {
    this.qualityChangeListeners.push(listener);
  }

  public async estimateBandwidth(peerId: string, peer: RTCPeerConnection): Promise<number> {
    const stats = await peer.getStats();
    let bandwidthKbps = 0;
    
    // Simplistic bandwidth estimation from stats
    stats.forEach((report) => {
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        if (report.availableOutgoingBitrate) {
          bandwidthKbps = report.availableOutgoingBitrate / 1000;
        }
      }
    });

    if (bandwidthKbps === 0) {
      bandwidthKbps = 1000; // Conservative default until real stats arrive
    }

    let history = this.bandwidthHistory.get(peerId) || [];
    history.push(bandwidthKbps);
    if (history.length > this.WINDOW_SIZE) {
      history.shift();
    }
    this.bandwidthHistory.set(peerId, history);

    const avgBandwidth = history.reduce((a, b) => a + b, 0) / history.length;
    
    const tier = this.selectQualityTier(avgBandwidth);
    const previousTier = this.lastTier.get(peerId);
    if (tier.name !== previousTier) {
      this.lastTier.set(peerId, tier.name);
      this.emitQualityChange(peerId, tier);
    }

    return avgBandwidth;
  }

  public selectQualityTier(bandwidthKbps: number): QualityTier {
    if (bandwidthKbps >= 4000) {
      return { name: 'Ultra', resolution: '1080p', maxBitrateKbps: 4000 };
    } else if (bandwidthKbps >= 2500) {
      return { name: 'High', resolution: '720p', maxBitrateKbps: 2500 };
    } else if (bandwidthKbps >= 1000) {
      return { name: 'Medium', resolution: '480p', maxBitrateKbps: 1000 };
    } else if (bandwidthKbps >= 500) {
      return { name: 'Low', resolution: '360p', maxBitrateKbps: 500 };
    } else {
      return { name: 'Audio-only', resolution: '0p', maxBitrateKbps: 0 };
    }
  }

  /** Returns optimal chunk duration in milliseconds */
  public getAdaptiveChunkSize(bandwidthKbps: number): number {
    if (bandwidthKbps < 1000) {
      return 20; // smaller chunks for slow peers
    } else if (bandwidthKbps < 2500) {
      return 50;
    }
    return 100; // larger chunks for fast peers
  }

  private emitQualityChange(peerId: string, tier: QualityTier) {
    for (const listener of this.qualityChangeListeners) {
      listener(peerId, tier);
    }
  }
}
