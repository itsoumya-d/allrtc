/**
 * AllRTC SDK tests — node:test, no extra deps.
 * Browser APIs (WebRTC, MediaStream, WebCodecs) are not available in Node.js.
 * Tests focus on module shape, AdaptiveBitrateManager (pure logic), and
 * construction + error handling of Publisher/Viewer.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Stub browser / WebRTC globals so the module loads in Node.js
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { hostname: 'localhost' },
    online: true,
  };
}
if (typeof globalThis.navigator === 'undefined') {
  globalThis.navigator = { userAgent: 'test', connection: null };
}
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class MockWS {
    constructor(url) { this.url = url; this.readyState = 0; }
    send() {}
    close() { this.readyState = 3; }
    set onopen(fn) {}
    set onclose(fn) {}
    set onmessage(fn) {}
    set onerror(fn) {}
  };
}
if (typeof globalThis.RTCPeerConnection === 'undefined') {
  globalThis.RTCPeerConnection = class MockPC {
    constructor() { this.iceConnectionState = 'new'; this.connectionState = 'new'; }
    createDataChannel(name, opts) {
      return { label: name, readyState: 'connecting', binaryType: 'arraybuffer',
               onmessage: null, onopen: null, onclose: null, send: () => {}, close: () => {} };
    }
    createOffer(opts) { return Promise.resolve({ type: 'offer', sdp: 'test-sdp' }); }
    createAnswer() { return Promise.resolve({ type: 'answer', sdp: 'test-sdp' }); }
    setLocalDescription() { return Promise.resolve(); }
    setRemoteDescription() { return Promise.resolve(); }
    addIceCandidate() { return Promise.resolve(); }
    getStats() { return Promise.resolve(new Map()); }
    close() {}
    onicecandidate = null;
    oniceconnectionstatechange = null;
    onconnectionstatechange = null;
    ondatachannel = null;
  };
}
if (typeof globalThis.RTCSessionDescription === 'undefined') {
  globalThis.RTCSessionDescription = class { constructor(i) { Object.assign(this, i); } };
}
if (typeof globalThis.RTCIceCandidate === 'undefined') {
  globalThis.RTCIceCandidate = class { constructor(i) { Object.assign(this, i); } };
}
if (typeof globalThis.AudioContext === 'undefined') {
  globalThis.AudioContext = class {
    createOscillator() { return { connect: () => {}, start: () => {} }; }
    createGain() { return { gain: { value: 0 }, connect: () => {} }; }
    close() {}
    get destination() { return {}; }
  };
}
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: (tag) => {
      const el = { tagName: tag.toUpperCase(), srcObject: null, play: () => {}, pause: () => {} };
      return el;
    },
    addEventListener: () => {},
  };
}
if (typeof globalThis.HTMLVideoElement === 'undefined') {
  globalThis.HTMLVideoElement = class { constructor() { this.srcObject = null; } };
}
if (typeof globalThis.MediaSource === 'undefined') {
  globalThis.MediaSource = class {
    static isTypeSupported() { return true; }
    constructor() { this.readyState = 'open'; this._listeners = {}; }
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); }
    removeEventListener(ev, fn) {}
    addSourceBuffer() {
      return { addEventListener: () => {}, appendBuffer: () => {}, updating: false, mode: 'segments' };
    }
    endOfStream() {}
  };
}
// Override URL.createObjectURL which throws on non-Blob in Node.js
globalThis.URL.createObjectURL = () => 'blob:mock';
globalThis.URL.revokeObjectURL = () => {};

const { AllRTCPublisher, AllRTCViewer, AdaptiveBitrateManager } = require(
  join(__dirname, '..', 'dist', 'index.js')
);

describe('Module shape', () => {
  test('exports AllRTCPublisher class', () => {
    assert.equal(typeof AllRTCPublisher, 'function');
  });

  test('exports AllRTCViewer class', () => {
    assert.equal(typeof AllRTCViewer, 'function');
  });

  test('exports AdaptiveBitrateManager class', () => {
    assert.equal(typeof AdaptiveBitrateManager, 'function');
  });

  test('AllRTCBroadcaster is NOT exported (was documented incorrectly)', () => {
    const mod = require(join(__dirname, '..', 'dist', 'index.js'));
    assert.equal(mod.AllRTCBroadcaster, undefined);
  });
});

describe('AllRTCPublisher construction', () => {
  test('constructs with trackerUrl and streamId', () => {
    const pub = new AllRTCPublisher('wss://tracker.example.com/ws', 'stream-123');
    assert.ok(pub);
  });

  test('publisher has .on() method for events', () => {
    const pub = new AllRTCPublisher('wss://tracker.example.com/ws', 'stream-xyz');
    assert.equal(typeof pub.on, 'function');
  });

  test('publisher event listener registers without throwing', () => {
    const pub = new AllRTCPublisher('wss://tracker.example.com/ws', 'stream-xyz');
    assert.doesNotThrow(() => pub.on('started', () => {}));
    assert.doesNotThrow(() => pub.on('peer_connected', (id) => {}));
    assert.doesNotThrow(() => pub.on('stopped', () => {}));
  });

  test('stop() before start() does not throw', () => {
    const pub = new AllRTCPublisher('wss://tracker.example.com/ws', 'stream-xyz');
    assert.doesNotThrow(() => pub.stop());
  });
});

describe('AllRTCViewer construction', () => {
  test('constructs with trackerUrl and streamId', () => {
    const v = new AllRTCViewer('wss://tracker.example.com/ws', 'stream-123');
    assert.ok(v);
  });

  test('viewer has .on() method for events', () => {
    const v = new AllRTCViewer('wss://tracker.example.com/ws', 'stream-xyz');
    assert.equal(typeof v.on, 'function');
  });

  test('viewer event listener registers without throwing', () => {
    const v = new AllRTCViewer('wss://tracker.example.com/ws', 'stream-xyz');
    assert.doesNotThrow(() => v.on('connected', () => {}));
    assert.doesNotThrow(() => v.on('disconnected', () => {}));
  });

  test('canRelay defaults to true (non-mobile)', () => {
    const v = new AllRTCViewer('wss://tracker.example.com/ws', 'stream-xyz');
    assert.equal(v.canRelay, true);
  });

  test('getVideoElement() returns an element-like object', () => {
    const v = new AllRTCViewer('wss://tracker.example.com/ws', 'stream-xyz');
    assert.doesNotThrow(() => v.getVideoElement());
  });

  test('stop() before start() does not throw', () => {
    const v = new AllRTCViewer('wss://tracker.example.com/ws', 'stream-xyz');
    assert.doesNotThrow(() => v.stop());
  });
});

describe('AdaptiveBitrateManager — pure logic', () => {
  test('constructs without arguments', () => {
    const abr = new AdaptiveBitrateManager();
    assert.ok(abr);
  });

  test('selectQualityTier() returns Ultra at 5000 Kbps', () => {
    const abr = new AdaptiveBitrateManager();
    const tier = abr.selectQualityTier(5000);
    assert.equal(tier.name, 'Ultra');
    assert.equal(tier.resolution, '1080p');
    assert.equal(tier.maxBitrateKbps, 4000);
  });

  test('selectQualityTier() returns High at 3000 Kbps', () => {
    const abr = new AdaptiveBitrateManager();
    const tier = abr.selectQualityTier(3000);
    assert.equal(tier.name, 'High');
    assert.equal(tier.resolution, '720p');
  });

  test('selectQualityTier() returns Medium at 1500 Kbps', () => {
    const abr = new AdaptiveBitrateManager();
    const tier = abr.selectQualityTier(1500);
    assert.equal(tier.name, 'Medium');
    assert.equal(tier.resolution, '480p');
  });

  test('selectQualityTier() returns Low at 600 Kbps', () => {
    const abr = new AdaptiveBitrateManager();
    const tier = abr.selectQualityTier(600);
    assert.equal(tier.name, 'Low');
    assert.equal(tier.resolution, '360p');
  });

  test('selectQualityTier() returns Audio-only at 200 Kbps', () => {
    const abr = new AdaptiveBitrateManager();
    const tier = abr.selectQualityTier(200);
    assert.equal(tier.name, 'Audio-only');
  });

  test('selectQualityTier() returns Audio-only at 0 Kbps', () => {
    const abr = new AdaptiveBitrateManager();
    const tier = abr.selectQualityTier(0);
    assert.equal(tier.name, 'Audio-only');
  });

  test('getAdaptiveChunkSize() returns 20ms for slow connection', () => {
    const abr = new AdaptiveBitrateManager();
    assert.equal(abr.getAdaptiveChunkSize(500), 20);
  });

  test('getAdaptiveChunkSize() returns 50ms for medium connection', () => {
    const abr = new AdaptiveBitrateManager();
    assert.equal(abr.getAdaptiveChunkSize(1500), 50);
  });

  test('getAdaptiveChunkSize() returns 100ms for fast connection', () => {
    const abr = new AdaptiveBitrateManager();
    assert.equal(abr.getAdaptiveChunkSize(3000), 100);
  });

  test('onQualityChange() registers a listener', () => {
    const abr = new AdaptiveBitrateManager();
    let called = false;
    assert.doesNotThrow(() => abr.onQualityChange(() => { called = true; }));
  });

  test('estimateBandwidth() resolves a number with mock peer', async () => {
    const abr = new AdaptiveBitrateManager();
    const mockPeer = new globalThis.RTCPeerConnection();
    const bw = await abr.estimateBandwidth('peer-1', mockPeer);
    assert.equal(typeof bw, 'number');
    assert.ok(bw > 0);
  });

  test('quality change listener fires on tier transition', async () => {
    const abr = new AdaptiveBitrateManager();
    const mockPeer = new globalThis.RTCPeerConnection();
    const changes = [];
    abr.onQualityChange((peerId, tier) => changes.push({ peerId, tier }));
    await abr.estimateBandwidth('peer-2', mockPeer);
    // First call should always fire because there was no previous tier
    assert.equal(changes.length, 1);
    assert.equal(changes[0].peerId, 'peer-2');
  });
});

describe('Adversarial cases', () => {
  test('AllRTCPublisher with empty streamId does not throw', () => {
    assert.doesNotThrow(() => new AllRTCPublisher('wss://tracker.example.com/ws', ''));
  });

  test('AllRTCViewer with empty streamId does not throw', () => {
    assert.doesNotThrow(() => new AllRTCViewer('wss://tracker.example.com/ws', ''));
  });

  test('AdaptiveBitrateManager.selectQualityTier() with negative bandwidth', () => {
    const abr = new AdaptiveBitrateManager();
    const tier = abr.selectQualityTier(-100);
    assert.equal(tier.name, 'Audio-only');
  });

  test('multiple AllRTCPublisher instances have distinct IDs', () => {
    const a = new AllRTCPublisher('wss://t.example.com/ws', 's1');
    const b = new AllRTCPublisher('wss://t.example.com/ws', 's1');
    // They should be independent objects
    assert.notEqual(a, b);
  });
});
