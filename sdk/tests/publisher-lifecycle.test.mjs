import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const entrypoints = [
  ['CommonJS', require('../dist/index.js')],
  ['ESM', await import('../dist/index.mjs')],
];

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Drain startup and the finite synthetic frame reader without using real media,
// sockets, device permissions, or a wall-clock race.
const settle = () => new Promise((resolve) => setImmediate(resolve));

function browserFakes(t, { webCodecs = true, video = true } = {}) {
  const probes = [], encoders = [], processors = [], recorders = [];
  let readers = 0, reads = 0, closedFrames = 0, stoppedTracks = 0;
  const track = { stop() { stoppedTracks++; } };
  const stream = {
    getVideoTracks: () => video ? [track] : [],
    getTracks: () => [track],
  };

  class FakeVideoEncoder {
    static isConfigSupported() {
      const probe = deferred();
      probes.push(probe);
      return probe.promise;
    }
    constructor() {
      this.state = 'unconfigured';
      this.frames = [];
      this.closeCalls = 0;
      encoders.push(this);
    }
    configure(config) { this.config = config; this.state = 'configured'; }
    encode(frame) { this.frames.push(frame); }
    close() { this.closeCalls++; this.state = 'closed'; }
  }

  class FakeProcessor {
    constructor(options) {
      processors.push(options.track);
      this.readable = {
        getReader() {
          readers++;
          let yielded = false;
          return {
            async read() {
              reads++;
              if (yielded) return { done: true };
              yielded = true;
              return { done: false, value: { close() { closedFrames++; } } };
            },
          };
        },
      };
    }
  }

  class FakeRecorder {
    constructor(input, options) {
      this.stream = input;
      this.options = options;
      this.state = 'inactive';
      this.stopCalls = 0;
      recorders.push(this);
    }
    start(interval) { this.interval = interval; this.state = 'recording'; }
    stop() { this.stopCalls++; this.state = 'inactive'; }
  }

  const globals = {
    window: {
      addEventListener() {},
      ...(webCodecs ? { VideoEncoder: FakeVideoEncoder } : {}),
      MediaStreamTrackProcessor: FakeProcessor,
    },
    navigator: { connection: null },
    MediaRecorder: FakeRecorder,
    WebSocket: class {
      static OPEN = 1;
      constructor() { this.readyState = 0; }
      send() { throw new Error('No tracker messages expected in lifecycle tests'); }
      close() { this.readyState = 3; }
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else delete globalThis[key];
    });
  }

  return {
    probes, encoders, processors, recorders, stream, track,
    get counts() { return { readers, reads, closedFrames, stoppedTracks }; },
  };
}

function finishProbe(probe, result) {
  if (result === 'rejected') probe.reject(new Error('Synthetic capability failure'));
  else probe.resolve({ supported: result === 'supported' });
}

for (const [format, { AllRTCPublisher }] of entrypoints) {
  describe(`${format} publisher startup lifecycle`, () => {
    for (const result of ['supported', 'unsupported', 'rejected']) {
      test(`stop cancels a pending ${result} capability probe`, async (t) => {
        const fakes = browserFakes(t);
        const publisher = new AllRTCPublisher('wss://tracker.invalid/ws', 'cancelled');
        t.after(() => publisher.stop());
        await publisher.start(fakes.stream);
        assert.equal(fakes.probes.length, 1);
        publisher.stop();
        publisher.stop();
        finishProbe(fakes.probes[0], result);
        await settle();

        assert.equal(fakes.encoders.length, 0);
        assert.equal(fakes.processors.length, 0);
        assert.equal(fakes.recorders.length, 0);
        assert.deepEqual(fakes.counts, { readers: 0, reads: 0, closedFrames: 0, stoppedTracks: 0 });
      });
    }

    for (const result of ['supported', 'rejected']) {
      for (const order of ['old-first', 'new-first']) {
        test(`restart ignores the old ${result} probe (${order})`, async (t) => {
          const fakes = browserFakes(t);
          const publisher = new AllRTCPublisher('wss://tracker.invalid/ws', 'restarted');
          t.after(() => publisher.stop());
          await publisher.start(fakes.stream);
          publisher.stop();
          await publisher.start(fakes.stream);
          assert.equal(fakes.probes.length, 2);

          if (order === 'old-first') {
            finishProbe(fakes.probes[0], result);
            await settle();
            assert.equal(fakes.encoders.length, 0);
            finishProbe(fakes.probes[1], 'supported');
          } else {
            finishProbe(fakes.probes[1], 'supported');
            await settle();
            finishProbe(fakes.probes[0], result);
          }
          await settle();

          assert.equal(fakes.encoders.length, 1);
          assert.equal(fakes.encoders[0].state, 'configured');
          assert.equal(fakes.encoders[0].config.codec, 'av01.0.04M.08');
          assert.deepEqual(fakes.processors, [fakes.track]);
          assert.equal(fakes.counts.readers, 1);
          publisher.stop();
          assert.equal(fakes.encoders[0].closeCalls, 1);
          assert.equal(fakes.counts.stoppedTracks, 0);
        });
      }
    }

    for (const result of ['supported', 'unsupported', 'rejected']) {
      test(`normal ${result} startup encodes a frame and stops`, async (t) => {
        const fakes = browserFakes(t);
        const publisher = new AllRTCPublisher('wss://tracker.invalid/ws', 'normal');
        t.after(() => publisher.stop());
        await publisher.start(fakes.stream);
        finishProbe(fakes.probes[0], result);
        await settle();

        assert.equal(fakes.encoders.length, 1);
        const encoder = fakes.encoders[0];
        assert.equal(encoder.config.codec, result === 'supported' ? 'av01.0.04M.08' : 'avc1.42E01E');
        assert.equal(encoder.frames.length, 1);
        assert.deepEqual(fakes.processors, [fakes.track]);
        assert.deepEqual(fakes.counts, { readers: 1, reads: 2, closedFrames: 1, stoppedTracks: 0 });
        publisher.stop();
        publisher.stop();
        assert.equal(encoder.state, 'closed');
        assert.equal(encoder.closeCalls, 1);
        assert.equal(fakes.counts.stoppedTracks, 0);
      });
    }

    for (const options of [{ webCodecs: false }, { video: false }]) {
      test(`MediaRecorder fallback is preserved (${JSON.stringify(options)})`, async (t) => {
        const fakes = browserFakes(t, options);
        const publisher = new AllRTCPublisher('wss://tracker.invalid/ws', 'recorder');
        t.after(() => publisher.stop());
        await publisher.start(fakes.stream);
        assert.equal(fakes.recorders.length, 1);
        const recorder = fakes.recorders[0];
        assert.equal(recorder.stream, fakes.stream);
        assert.equal(recorder.state, 'recording');
        assert.equal(recorder.interval, 50);
        assert.equal(fakes.probes.length, 0);
        assert.equal(fakes.encoders.length, 0);
        publisher.stop();
        publisher.stop();
        assert.equal(recorder.state, 'inactive');
        assert.equal(recorder.stopCalls, 1);
        assert.equal(fakes.counts.stoppedTracks, 0);
      });
    }
  });
}
