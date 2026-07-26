# AllRTC Client SDK

P2P swarm-based live video streaming protocol.

## Features
- WebRTC P2P DataChannels for video chunk relay
- SHA-256 chunk verification
- Seamless parent handover
- Lightweight and dependency-free

## Usage

### Publisher (Broadcaster)
```typescript
import { AllRTCPublisher } from 'allrtc';

const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
const publisher = new AllRTCPublisher('wss://tracker.example.com', 'stream-id');

publisher.start(stream);
```

### Viewer (Player)
```typescript
import { AllRTCViewer } from 'allrtc';

const viewer = new AllRTCViewer('wss://tracker.example.com', 'stream-id');
const video = viewer.getVideoElement();
document.body.appendChild(video);

viewer.start();
```
