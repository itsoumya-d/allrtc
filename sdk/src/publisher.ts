import { TrackerClient } from './tracker-client';
import { PeerManager } from './peer-manager';
import { ChunkEncoder } from './chunk-encoder';
import { EventEmitter } from './events';

interface PublisherEvents {
  started: void;
  stopped: void;
  peer_connected: string;
}

export class AllRTCPublisher extends EventEmitter<PublisherEvents> {
  private tracker: TrackerClient;
  private peerManager: PeerManager;
  private encoder: ChunkEncoder | null = null;
  private myId: string;

  constructor(trackerUrl: string, private streamId: string) {
    super();
    this.myId = 'pub_' + Math.random().toString(36).substring(2, 9);
    this.tracker = new TrackerClient(trackerUrl, 'publisher', streamId);
    this.peerManager = new PeerManager(this.tracker, this.myId);

    this.tracker.on('message', (msg) => {
      if (msg.type === 'new_child') {
        this.peerManager.connectToPeer(msg.childId);
      }
    });

    this.peerManager.on('connected', (peerId) => {
      this.emit('peer_connected', peerId);
    });
  }

  async start(stream: MediaStream) {
    this.tracker.connect();
    
    this.encoder = new ChunkEncoder(stream);
    this.encoder.start((chunk) => {
      // Send manifest to tracker
      this.tracker.send({
        type: 'manifest',
        seq: chunk.seq,
        hash: chunk.hash
      });
      // Broadcast to all seed peers
      this.peerManager.broadcastChunk(chunk);
    });
    
    this.emit('started', undefined);
  }

  stop() {
    if (this.encoder) {
      this.encoder.stop();
    }
    this.peerManager.disconnect();
    this.tracker.disconnect();
    this.emit('stopped', undefined);
  }
}
