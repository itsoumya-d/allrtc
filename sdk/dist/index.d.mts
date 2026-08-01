declare class EventEmitter<T extends Record<string, any>> {
    private listeners;
    on<K extends keyof T>(event: K, listener: (arg: T[K]) => void): void;
    emit<K extends keyof T>(event: K, arg: T[K]): void;
    off<K extends keyof T>(event: K, listener: (arg: T[K]) => void): void;
}

interface PublisherEvents {
    started: void;
    stopped: void;
    peer_connected: string;
}
declare class AllRTCPublisher extends EventEmitter<PublisherEvents> {
    private streamId;
    private tracker;
    private peerManager;
    private encoder;
    private myId;
    constructor(trackerUrl: string, streamId: string);
    start(stream: MediaStream): Promise<void>;
    stop(): void;
}

interface ViewerEvents {
    connected: void;
    disconnected: void;
}
/**
 * AllRTC Viewer with Smart Mobile Data Protection & Dual-Parent Zero-Freeze Relay.
 */
declare class AllRTCViewer extends EventEmitter<ViewerEvents> {
    private tracker;
    private peerManager;
    private assembler;
    private myId;
    private expectedHashes;
    private static readonly MAX_EXPECTED_HASHES;
    canRelay: boolean;
    constructor(trackerUrl: string, streamId: string);
    /**
     * Record an expected chunk hash, bounding the map.
     *
     * Entries are otherwise deleted only when the matching chunk actually
     * arrives, so manifests for chunks that never arrive accumulate forever.
     */
    private rememberExpectedHash;
    /**
     * Smart Device Tiering:
     * Protects mobile users from battery drain and mobile data usage.
     */
    private detectDeviceCapabilities;
    getVideoElement(): HTMLVideoElement;
    start(): void;
    stop(): void;
}

interface ChunkMessage {
    seq: number;
    ts: number;
    hash: string;
    data: ArrayBuffer;
    from?: string;
}
type Role = 'publisher' | 'viewer';
interface SignalMessage {
    type: 'signal';
    to: string;
    from: string;
    payload: any;
}
interface TrackerMessage {
    type: string;
    [key: string]: any;
}

interface QualityTier {
    name: 'Ultra' | 'High' | 'Medium' | 'Low' | 'Audio-only';
    resolution: string;
    maxBitrateKbps: number;
}
declare class AdaptiveBitrateManager {
    private bandwidthHistory;
    private readonly WINDOW_SIZE;
    private qualityChangeListeners;
    private lastTier;
    constructor();
    onQualityChange(listener: (peerId: string, tier: QualityTier) => void): void;
    estimateBandwidth(peerId: string, peer: RTCPeerConnection): Promise<number>;
    selectQualityTier(bandwidthKbps: number): QualityTier;
    /** Returns optimal chunk duration in milliseconds */
    getAdaptiveChunkSize(bandwidthKbps: number): number;
    private emitQualityChange;
}

export { AdaptiveBitrateManager, AllRTCPublisher, AllRTCViewer, type ChunkMessage, type QualityTier, type Role, type SignalMessage, type TrackerMessage };
