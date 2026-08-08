## 2024-05-18 - [String Formatting Allocation Overhead in WebRTC Chunk Hash]
**Learning:** In ultra-low latency WebRTC streaming (50ms interval), using intermediate array allocations, closures (like map), and string formatting overhead (`Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("")`) causes severe GC pauses. This is a critical pattern in this codebase due to the high frequency of chunk processing.
**Action:** When converting ArrayBuffers to hex strings, use a pre-computed lookup table (`byteToHex`) and a simple loop with string concatenation.

## 2024-05-18 - [TextEncoder and TextDecoder Instantiation Overhead]
**Learning:** In ultra-low latency WebRTC streaming (50ms interval), instantiating `TextEncoder` and `TextDecoder` on every chunk processing inside the tight loops causes significant GC pressure and CPU overhead.
**Action:** Always cache instances of `TextEncoder` and `TextDecoder` as static class variables or global singletons to prevent allocation overhead in hot paths.

## 2024-05-18 - [ArrayBuffer to Base64 Allocation Overhead in WebSocket Relay]
**Learning:** When converting ArrayBuffers to Base64 strings in a hot path (like `sendChunkViaWs` relaying video chunks every 50ms), a byte-by-byte `String.fromCharCode(bytes[i])` loop concatenation creates immense garbage collection pressure and CPU overhead, dropping frames.
**Action:** Use a chunked `String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize))` approach to process 8192 bytes at a time. Do not use `Array.from()` inside the loop as it destroys the performance benefit; apply the typed array directly and use `@ts-ignore` to bypass TypeScript's type constraints.
