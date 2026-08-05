## 2024-10-24 - TextEncoder allocations in hot loops
**Learning:** In the WebRTC chunk relay path (`PeerManager.broadcastChunk`), which runs very frequently (e.g., every 50ms per active connection), creating new `Uint8Array` allocations for string-to-byte encoding causes unnecessary GC pressure. `TextEncoder.encode` allocates a new array each time.
**Action:** Use `TextEncoder.encodeInto(string, existingBuffer)` to encode strings directly into pre-allocated memory slices when formatting binary protocol headers, entirely avoiding the intermediate array allocation.
