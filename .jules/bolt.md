## 2024-05-18 - [String Formatting Allocation Overhead in WebRTC Chunk Hash]
**Learning:** In ultra-low latency WebRTC streaming (50ms interval), using intermediate array allocations, closures (like map), and string formatting overhead (`Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("")`) causes severe GC pauses. This is a critical pattern in this codebase due to the high frequency of chunk processing.
**Action:** When converting ArrayBuffers to hex strings, use a pre-computed lookup table (`byteToHex`) and a simple loop with string concatenation.

## 2024-05-18 - [TextEncoder and TextDecoder Instantiation Overhead]
**Learning:** In ultra-low latency WebRTC streaming (50ms interval), instantiating `TextEncoder` and `TextDecoder` on every chunk processing inside the tight loops causes significant GC pressure and CPU overhead.
**Action:** Always cache instances of `TextEncoder` and `TextDecoder` as static class variables or global singletons to prevent allocation overhead in hot paths.

## 2024-05-18 - [String Formatting Allocation Overhead in ArrayBuffer to Base64]
**Learning:** In ultra-low latency WebRTC streaming (e.g. 50ms chunk interval), using a character-by-character loop to convert an `ArrayBuffer` to a binary string before `btoa` causes significant CPU overhead and GC stutters.
**Action:** When converting `ArrayBuffer` to base64, use chunked `String.fromCharCode.apply` (e.g., with an 8192 byte chunk size to avoid call stack limits) to speed up conversion by ~20x and avoid GC pauses.
