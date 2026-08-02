## 2024-05-18 - [String Formatting Allocation Overhead in WebRTC Chunk Hash]
**Learning:** In ultra-low latency WebRTC streaming (50ms interval), using intermediate array allocations, closures (like map), and string formatting overhead (`Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("")`) causes severe GC pauses. This is a critical pattern in this codebase due to the high frequency of chunk processing.
**Action:** When converting ArrayBuffers to hex strings, use a pre-computed lookup table (`byteToHex`) and a simple loop with string concatenation.

## 2024-05-18 - [Object Allocation Overhead in WebRTC Chunk Hash Encoding/Decoding]
**Learning:** In ultra-low latency WebRTC streaming (50ms interval), instantiating new `TextEncoder` and `TextDecoder` objects for every single chunk causes unnecessary object allocations and contributes to GC stutters.
**Action:** Always reuse a single shared instance of `TextEncoder` and `TextDecoder` (e.g., via static readonly properties) when encoding/decoding strings in hot paths like message handlers.
