// src/events.ts
var EventEmitter = class {
  constructor() {
    this.listeners = {};
  }
  on(event, listener) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener);
  }
  emit(event, arg) {
    const eventListeners = this.listeners[event];
    if (eventListeners) {
      eventListeners.forEach((listener) => listener(arg));
    }
  }
  off(event, listener) {
    const eventListeners = this.listeners[event];
    if (eventListeners) {
      this.listeners[event] = eventListeners.filter((l) => l !== listener);
    }
  }
};

// src/tracker-client.ts
var TrackerClient = class extends EventEmitter {
  constructor(url, role, streamId) {
    super();
    this.url = url;
    this.role = role;
    this.streamId = streamId;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 50;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.intentionalClose = false;
  }
  connect() {
    this.intentionalClose = false;
    this.doConnect();
  }
  doConnect() {
    try {
      this.ws = new WebSocket(
        `${this.url}?role=${this.role}&streamId=${this.streamId}`
      );
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.emit("open", void 0);
    };
    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "pong") return;
        this.emit("message", msg);
      } catch {
      }
    };
    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.emit("close", void 0);
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };
    this.ws.onerror = (err) => {
      this.emit("error", err);
    };
  }
  /**
   * Exponential backoff reconnection.
   * Starts at 500ms, doubles each attempt, caps at 30 seconds.
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    const delay = Math.min(500 * Math.pow(2, this.reconnectAttempts), 3e4);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.doConnect(), delay);
  }
  /**
   * Heartbeat prevents ISP/proxy idle connection timeouts.
   * Many corporate proxies kill idle WebSocket connections after 30-60s.
   */
  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: "ping", peerId: "" });
    }, 15e3);
  }
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
  /**
   * WebSocket Chunk Relay Fallback.
   * When WebRTC DataChannel is blocked by firewall, chunks are relayed
   * through the tracker's WebSocket instead. To ISP/DPI, this looks like
   * normal HTTPS WebSocket traffic (port 443) — impossible to distinguish.
   */
  sendChunkViaWs(seq, data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const bytes = new Uint8Array(data);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const b64 = btoa(binary);
      this.send({ type: "ws_chunk_relay", seq, chunkData: b64 });
    }
  }
  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
  disconnect() {
    this.intentionalClose = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
};

// src/peer-manager.ts
var PeerManager = class extends EventEmitter {
  constructor(tracker, myId) {
    super();
    this.tracker = tracker;
    this.myId = myId;
    this.peers = /* @__PURE__ */ new Map();
    this.dataChannels = /* @__PURE__ */ new Map();
    this.keepaliveCtx = null;
    this.webrtcBlocked = false;
    this.connectionAttempts = /* @__PURE__ */ new Map();
    this.tracker.on("message", (msg) => {
      if (msg.type === "signal" && msg.to === this.myId) {
        this.handleSignal(msg.from, msg.payload);
      }
      if (msg.type === "ws_chunk_relay" && msg.chunkData) {
        this.handleWsChunkRelay(msg);
      }
    });
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.handleNetworkChange());
      if (navigator.connection) {
        navigator.connection.addEventListener(
          "change",
          () => this.handleNetworkChange()
        );
      }
    }
  }
  async connectToPeer(peerId) {
    const pc = this.createPeerConnection(peerId);
    const dc = pc.createDataChannel("allrtc-chunks", {
      ordered: false,
      // Unordered: don't wait for out-of-order packets
      maxRetransmits: 0
      // No retransmits: skip lost frames, don't wait
    });
    this.setupDataChannel(peerId, dc);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.tracker.send({
      type: "signal",
      to: peerId,
      from: this.myId,
      payload: { type: "offer", sdp: offer }
    });
    const attempts = (this.connectionAttempts.get(peerId) || 0) + 1;
    this.connectionAttempts.set(peerId, attempts);
    setTimeout(() => {
      if (pc.connectionState !== "connected" && attempts >= 2) {
        this.webrtcBlocked = true;
        this.emit("webrtc_blocked", void 0);
      }
    }, 8e3);
  }
  createPeerConnection(peerId) {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun.cloudflare.com:3478" }
        // TURN-over-TLS on port 443 (uncomment with your credentials):
        // {
        //   urls: 'turns:your-turn-server.com:443?transport=tcp',
        //   username: 'allrtc',
        //   credential: 'your-secret'
        // }
      ],
      iceTransportPolicy: "all"
    });
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.tracker.send({
          type: "signal",
          to: peerId,
          from: this.myId,
          payload: { type: "ice", candidate: e.candidate }
        });
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
        this.performIceRestart(peerId, pc);
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        this.peers.delete(peerId);
        this.dataChannels.delete(peerId);
        this.emit("disconnected", peerId);
      } else if (pc.connectionState === "connected") {
        this.connectionAttempts.delete(peerId);
        this.emit("connected", peerId);
      }
    };
    pc.ondatachannel = (e) => {
      this.setupDataChannel(peerId, e.channel);
    };
    this.peers.set(peerId, pc);
    return pc;
  }
  /**
   * ICE Restart: Handles WiFi ↔ Cellular network switches seamlessly.
   * When the device's IP changes, this gathers new ICE candidates
   * without tearing down the peer connection.
   */
  async performIceRestart(peerId, pc) {
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      this.tracker.send({
        type: "signal",
        to: peerId,
        from: this.myId,
        payload: { type: "offer", sdp: offer }
      });
    } catch {
    }
  }
  /**
   * Network change handler — restarts ICE on all active connections.
   */
  handleNetworkChange() {
    for (const [peerId, pc] of this.peers) {
      if (pc.iceConnectionState !== "connected") {
        this.performIceRestart(peerId, pc);
      }
    }
  }
  /**
   * WebSocket Chunk Relay Fallback.
   * When WebRTC DataChannels are blocked (strict corporate firewall),
   * chunks arrive through the tracker's WebSocket instead.
   * To the network, this is just regular HTTPS WebSocket traffic.
   */
  handleWsChunkRelay(msg) {
    try {
      const binary = atob(msg.chunkData);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      this.emit("chunk", {
        seq: msg.seq,
        ts: Date.now(),
        hash: "",
        data: bytes.buffer
      });
    } catch {
    }
  }
  setupDataChannel(peerId, dc) {
    dc.binaryType = "arraybuffer";
    dc.onmessage = (e) => {
      const buffer = e.data;
      if (buffer.byteLength < 76) return;
      const dv = new DataView(buffer);
      const seq = dv.getUint32(0);
      const ts = dv.getFloat64(4);
      const hashBytes = new Uint8Array(buffer, 12, 64);
      const hash = new TextDecoder().decode(hashBytes).trim();
      const data = buffer.slice(76);
      this.emit("chunk", { seq, ts, hash, data });
    };
    this.dataChannels.set(peerId, dc);
  }
  async handleSignal(peerId, payload) {
    let pc = this.peers.get(peerId);
    if (!pc) {
      pc = this.createPeerConnection(peerId);
    }
    try {
      if (payload.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.tracker.send({
          type: "signal",
          to: peerId,
          from: this.myId,
          payload: { type: "answer", sdp: answer }
        });
      } else if (payload.type === "answer") {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      } else if (payload.type === "ice") {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      }
    } catch {
    }
  }
  /**
   * Background tab keepalive.
   * Browsers throttle inactive tabs, which can kill WebRTC connections.
   * A silent AudioContext oscillator prevents the browser from sleeping.
   */
  startKeepalive() {
    if (this.keepaliveCtx) return;
    try {
      this.keepaliveCtx = new AudioContext();
      const osc = this.keepaliveCtx.createOscillator();
      const gain = this.keepaliveCtx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(this.keepaliveCtx.destination);
      osc.start();
    } catch {
    }
  }
  stopKeepalive() {
    if (this.keepaliveCtx) {
      this.keepaliveCtx.close();
      this.keepaliveCtx = null;
    }
  }
  get isWebRTCBlocked() {
    return this.webrtcBlocked;
  }
  broadcastChunk(chunk) {
    const hashBytes = new TextEncoder().encode(chunk.hash.padEnd(64, " "));
    const buffer = new ArrayBuffer(4 + 8 + 64 + chunk.data.byteLength);
    const dv = new DataView(buffer);
    dv.setUint32(0, chunk.seq);
    dv.setFloat64(4, chunk.ts);
    const u8 = new Uint8Array(buffer);
    u8.set(hashBytes, 12);
    u8.set(new Uint8Array(chunk.data), 76);
    let sent = false;
    for (const dc of this.dataChannels.values()) {
      if (dc.readyState === "open") {
        try {
          dc.send(buffer);
          sent = true;
        } catch {
        }
      }
    }
    if (!sent && this.webrtcBlocked) {
      this.tracker.sendChunkViaWs(chunk.seq, chunk.data);
    }
  }
  disconnect() {
    this.stopKeepalive();
    for (const pc of this.peers.values()) {
      pc.close();
    }
    this.peers.clear();
    this.dataChannels.clear();
  }
};

// src/chunk-hasher.ts
var byteToHex = [];
for (let i = 0; i < 256; i++) {
  byteToHex.push(i.toString(16).padStart(2, "0"));
}
async function hashChunk(data) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  let hashHex = "";
  for (let i = 0; i < hashArray.length; i++) {
    hashHex += byteToHex[hashArray[i]];
  }
  return hashHex;
}

// src/chunk-encoder.ts
var ChunkEncoder = class _ChunkEncoder {
  constructor(stream, options = {}) {
    this.stream = stream;
    this.mediaRecorder = null;
    this.videoEncoder = null;
    // VideoEncoder type might not be fully available in TS DOM standard yet without libs
    this.seq = 0;
    this.onChunk = null;
    this.frameCount = 0;
    if (typeof options === "string") {
      this.mimeType = options;
      this.useWebCodecs = _ChunkEncoder.isWebCodecsSupported();
    } else {
      this.mimeType = options.mimeType || 'video/webm; codecs="vp8,opus"';
      this.useWebCodecs = options.useWebCodecs ?? _ChunkEncoder.isWebCodecsSupported();
    }
  }
  static isWebCodecsSupported() {
    return typeof window.VideoEncoder !== "undefined";
  }
  /**
   * @param onChunk - Called for each encoded chunk
   * @param chunkTimeMs - Chunk interval in ms. Default 50ms for ultra-low latency.
   */
  start(onChunk, chunkTimeMs = 50) {
    this.onChunk = onChunk;
    this.seq = 0;
    if (this.useWebCodecs && _ChunkEncoder.isWebCodecsSupported()) {
      this.startWebCodecs(chunkTimeMs);
    } else {
      this.startMediaRecorder(chunkTimeMs);
    }
  }
  async startWebCodecs(chunkTimeMs) {
    const videoTrack = this.stream.getVideoTracks()[0];
    if (!videoTrack) {
      this.startMediaRecorder(chunkTimeMs);
      return;
    }
    let codec = "av01.0.04M.08";
    try {
      const VideoEncoder = window.VideoEncoder;
      const support = await VideoEncoder.isConfigSupported({ codec, width: 1280, height: 720, bitrate: 15e5, framerate: 30 });
      if (!support.supported) {
        codec = "avc1.42E01E";
      }
    } catch (e) {
      codec = "avc1.42E01E";
    }
    this.videoEncoder = new window.VideoEncoder({
      output: (chunk, metadata) => {
        const arrayBuffer = new ArrayBuffer(chunk.byteLength);
        chunk.copyTo(arrayBuffer);
        const currentSeq = this.seq++;
        hashChunk(arrayBuffer).then((hash) => {
          const chunkMsg = {
            seq: currentSeq,
            ts: Date.now(),
            hash,
            data: arrayBuffer
          };
          if (this.onChunk) {
            this.onChunk(chunkMsg);
          }
        });
      },
      error: (err) => {
        console.error("VideoEncoder error", err);
      }
    });
    this.videoEncoder.configure({
      codec,
      width: 1280,
      height: 720,
      bitrate: 15e5,
      framerate: 30
    });
    const trackProcessor = new window.MediaStreamTrackProcessor({ track: videoTrack });
    const reader = trackProcessor.readable.getReader();
    const readFrames = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && this.videoEncoder && this.videoEncoder.state === "configured") {
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
  startMediaRecorder(chunkTimeMs) {
    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType: this.mimeType,
      videoBitsPerSecond: 15e5
    });
    this.mediaRecorder.ondataavailable = async (e) => {
      if (e.data && e.data.size > 0) {
        const arrayBuffer = await e.data.arrayBuffer();
        const currentSeq = this.seq++;
        hashChunk(arrayBuffer).then((hash) => {
          const chunk = {
            seq: currentSeq,
            ts: Date.now(),
            hash,
            data: arrayBuffer
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
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
    if (this.videoEncoder && this.videoEncoder.state !== "closed") {
      this.videoEncoder.close();
    }
    this.onChunk = null;
  }
};

// src/publisher.ts
var AllRTCPublisher = class extends EventEmitter {
  constructor(trackerUrl, streamId) {
    super();
    this.streamId = streamId;
    this.encoder = null;
    this.myId = "pub_" + Math.random().toString(36).substring(2, 9);
    this.tracker = new TrackerClient(trackerUrl, "publisher", streamId);
    this.peerManager = new PeerManager(this.tracker, this.myId);
    this.tracker.on("message", (msg) => {
      if (msg.type === "new_child") {
        this.peerManager.connectToPeer(msg.childId);
      }
    });
    this.peerManager.on("connected", (peerId) => {
      this.emit("peer_connected", peerId);
    });
  }
  async start(stream) {
    this.tracker.connect();
    this.encoder = new ChunkEncoder(stream);
    this.encoder.start((chunk) => {
      this.tracker.send({
        type: "manifest",
        seq: chunk.seq,
        hash: chunk.hash
      });
      this.peerManager.broadcastChunk(chunk);
    });
    this.emit("started", void 0);
  }
  stop() {
    if (this.encoder) {
      this.encoder.stop();
    }
    this.peerManager.disconnect();
    this.tracker.disconnect();
    this.emit("stopped", void 0);
  }
};

// src/video-assembler.ts
var VideoAssembler = class extends EventEmitter {
  constructor(mimeType = 'video/webm; codecs="vp8,opus"') {
    super();
    this.mimeType = mimeType;
    this.sourceBuffer = null;
    this.queue = [];
    this.seenSequences = /* @__PURE__ */ new Set();
    this.maxSeenHistory = 500;
    this.mediaSource = new MediaSource();
    this.videoElement = document.createElement("video");
    this.videoElement.autoplay = true;
    this.videoElement.playsInline = true;
    this.videoElement.muted = true;
    this.videoElement.src = URL.createObjectURL(this.mediaSource);
    this.mediaSource.addEventListener("sourceopen", () => {
      try {
        this.sourceBuffer = this.mediaSource.addSourceBuffer(this.mimeType);
        this.sourceBuffer.mode = "sequence";
        this.sourceBuffer.addEventListener("updateend", () => this.processQueue());
        this.processQueue();
      } catch (e) {
        this.emit("error", e);
      }
    });
  }
  /**
   * Accepts chunks from primary OR backup parent.
   * Automatically drops duplicates so video playback never stutters!
   */
  addChunk(chunk) {
    if (this.seenSequences.has(chunk.seq)) {
      return;
    }
    this.seenSequences.add(chunk.seq);
    if (this.seenSequences.size > this.maxSeenHistory) {
      const first = this.seenSequences.values().next().value;
      if (first !== void 0) this.seenSequences.delete(first);
    }
    this.queue.push(chunk.data);
    this.processQueue();
  }
  processQueue() {
    if (this.sourceBuffer && !this.sourceBuffer.updating && this.queue.length > 0 && this.mediaSource.readyState === "open") {
      try {
        const data = this.queue.shift();
        if (data) {
          this.sourceBuffer.appendBuffer(data);
        }
      } catch (e) {
        if (this.sourceBuffer && this.sourceBuffer.buffered.length > 0) {
          try {
            const start = this.sourceBuffer.buffered.start(0);
            const end = this.sourceBuffer.buffered.end(0);
            if (end - start > 30) {
              this.sourceBuffer.remove(start, end - 15);
            }
          } catch {
          }
        }
        this.emit("error", e);
      }
    }
  }
};

// src/security.ts
async function verifyChunk(data, expectedHash) {
  const actualHash = await hashChunk(data);
  return actualHash === expectedHash;
}

// src/viewer.ts
var AllRTCViewer = class extends EventEmitter {
  constructor(trackerUrl, streamId) {
    super();
    this.expectedHashes = /* @__PURE__ */ new Map();
    this.canRelay = true;
    this.myId = "view_" + Math.random().toString(36).substring(2, 9);
    this.detectDeviceCapabilities();
    this.tracker = new TrackerClient(trackerUrl, "viewer", streamId);
    this.peerManager = new PeerManager(this.tracker, this.myId);
    this.assembler = new VideoAssembler();
    this.tracker.on("message", (msg) => {
      if (msg.type === "manifest") {
        this.expectedHashes.set(msg.seq, msg.hash);
      } else if (msg.type === "assigned") {
        if (msg.parentPeerId) {
          this.peerManager.connectToPeer(msg.parentPeerId);
        }
        if (msg.backupPeerId) {
          this.peerManager.connectToPeer(msg.backupPeerId);
        }
      } else if (msg.type === "new_child") {
        if (this.canRelay && msg.childId) {
          this.peerManager.connectToPeer(msg.childId);
        }
      } else if (msg.type === "parent_changed") {
        if (msg.newParentPeerId) {
          this.peerManager.connectToPeer(msg.newParentPeerId);
        }
      }
    });
    this.peerManager.on("chunk", (chunk) => {
      this.assembler.addChunk(chunk);
      if (this.canRelay) {
        this.peerManager.broadcastChunk(chunk);
      }
      const expectedHash = this.expectedHashes.get(chunk.seq);
      if (expectedHash) {
        verifyChunk(chunk.data, expectedHash).then((isValid) => {
          if (!isValid) {
            console.warn("[AllRTC] Bad chunk detected:", chunk.seq);
          }
          this.expectedHashes.delete(chunk.seq);
        });
      }
    });
  }
  /**
   * Smart Device Tiering:
   * Protects mobile users from battery drain and mobile data usage.
   */
  detectDeviceCapabilities() {
    try {
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn) {
        if (conn.type === "cellular" || conn.saveData === true) {
          this.canRelay = false;
        }
      }
      if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) {
        this.canRelay = false;
      }
    } catch {
      this.canRelay = true;
    }
  }
  getVideoElement() {
    return this.assembler.videoElement;
  }
  start() {
    this.tracker.connect();
  }
  stop() {
    this.peerManager.disconnect();
    this.tracker.disconnect();
  }
};

// src/adaptive-bitrate.ts
var AdaptiveBitrateManager = class {
  constructor() {
    this.bandwidthHistory = /* @__PURE__ */ new Map();
    this.WINDOW_SIZE = 10;
    this.qualityChangeListeners = [];
    this.lastTier = /* @__PURE__ */ new Map();
  }
  onQualityChange(listener) {
    this.qualityChangeListeners.push(listener);
  }
  async estimateBandwidth(peerId, peer) {
    const stats = await peer.getStats();
    let bandwidthKbps = 0;
    stats.forEach((report) => {
      if (report.type === "candidate-pair" && report.state === "succeeded") {
        if (report.availableOutgoingBitrate) {
          bandwidthKbps = report.availableOutgoingBitrate / 1e3;
        }
      }
    });
    if (bandwidthKbps === 0) {
      bandwidthKbps = 1e3;
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
  selectQualityTier(bandwidthKbps) {
    if (bandwidthKbps >= 4e3) {
      return { name: "Ultra", resolution: "1080p", maxBitrateKbps: 4e3 };
    } else if (bandwidthKbps >= 2500) {
      return { name: "High", resolution: "720p", maxBitrateKbps: 2500 };
    } else if (bandwidthKbps >= 1e3) {
      return { name: "Medium", resolution: "480p", maxBitrateKbps: 1e3 };
    } else if (bandwidthKbps >= 500) {
      return { name: "Low", resolution: "360p", maxBitrateKbps: 500 };
    } else {
      return { name: "Audio-only", resolution: "0p", maxBitrateKbps: 0 };
    }
  }
  /** Returns optimal chunk duration in milliseconds */
  getAdaptiveChunkSize(bandwidthKbps) {
    if (bandwidthKbps < 1e3) {
      return 20;
    } else if (bandwidthKbps < 2500) {
      return 50;
    }
    return 100;
  }
  emitQualityChange(peerId, tier) {
    for (const listener of this.qualityChangeListeners) {
      listener(peerId, tier);
    }
  }
};
export {
  AdaptiveBitrateManager,
  AllRTCPublisher,
  AllRTCViewer
};
//# sourceMappingURL=index.mjs.map