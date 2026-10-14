import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AllRTCPublisher, AllRTCViewer } from '../dist/index.mjs';

globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = { createElement() { return { pause() {}, play() {} }; } };
globalThis.MediaSource = class { addEventListener() {} };
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.URL.revokeObjectURL = () => {};
const hash = 'a'.repeat(64);

test('publisher sends the tracker chunk_manifest contract including sequence zero', async t => {
 const pub = new AllRTCPublisher('wss://test.invalid', 'stream');
 pub.tracker.connect = () => {}; pub.peerManager.broadcastChunk = () => {};
 const sent = []; pub.tracker.send = message => sent.push(message);
 const original = globalThis.MediaRecorder;
 globalThis.MediaRecorder = class { start() {} stop() {} };
 t.after(() => { pub.stop(); globalThis.MediaRecorder = original; });
 await pub.start({});
 pub.encoder.onChunk({seq: 0, hash, data: new ArrayBuffer(0), ts: 0});
 assert.deepEqual(sent, [{type: 'chunk_manifest', peerId: pub.myId, seq: 0, hashes: [hash]}]);
});

test('viewer records consecutive tracker hashes starting at explicit seq', () => {
 const viewer = new AllRTCViewer('wss://test.invalid', 'stream');
 viewer.tracker.emit('message', {type: 'chunk_manifest', seq: 0, hashes: [hash, 'b'.repeat(64)]});
 assert.equal(viewer.expectedHashes.get(0), hash); assert.equal(viewer.expectedHashes.get(1), 'b'.repeat(64));
});

for (const manifest of [
 {hashes: [hash]}, {seq: -1, hashes: [hash]}, {seq: 1.5, hashes: [hash]},
 {seq: 0, hashes: 'bad'}, {seq: 0, hashes: []}, {seq: 0, hashes: ['bad']},
 {seq: 0xffffffff, hashes: [hash, hash]}, {seq: 0, hashes: Array(257).fill(hash)},
 {seq: 0, hashes: [hash, 42]},
]) test(`viewer rejects malformed manifest ${JSON.stringify(manifest).slice(0, 90)}`, () => {
 const viewer = new AllRTCViewer('wss://test.invalid', 'stream');
 viewer.tracker.emit('message', {type: 'chunk_manifest', ...manifest});
 assert.equal(viewer.expectedHashes.size, 0);
});

test('viewer bounds missing chunk manifests to 2048 hashes', () => {
 const viewer = new AllRTCViewer('wss://test.invalid', 'stream');
 for (let seq = 0; seq < 2304; seq += 256) viewer.tracker.emit('message', {type: 'chunk_manifest', seq, hashes: Array(256).fill(hash)});
 assert.equal(viewer.expectedHashes.size, 2048); assert.equal(viewer.expectedHashes.has(0), false); assert.equal(viewer.expectedHashes.get(2303), hash);
});

test('received manifest reaches asynchronous corruption verification', async t => {
 const viewer = new AllRTCViewer('wss://test.invalid', 'stream');
 viewer.assembler.addChunk = () => {}; viewer.peerManager.broadcastChunk = () => {};
 const warnings = []; t.mock.method(console, 'warn', (...args) => warnings.push(args));
 viewer.tracker.emit('message', {type: 'chunk_manifest', seq: 5, hashes: [hash]});
 viewer.peerManager.emit('chunk', {seq: 5, data: new Uint8Array([1,2,3]).buffer});
 for (let i = 0; i < 100 && viewer.expectedHashes.has(5); i++) await new Promise(resolve => setTimeout(resolve, 1));
 assert.equal(viewer.expectedHashes.has(5), false);
 assert.equal(warnings.some(args => args[0] === '[AllRTC] Bad chunk detected:' && args[1] === 5), true);
});
