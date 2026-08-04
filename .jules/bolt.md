## 2024-05-18 - [String Formatting Allocation Overhead in WebRTC Chunk Hash]
**Learning:** In ultra-low latency WebRTC streaming (50ms interval), using intermediate array allocations, closures (like map), and string formatting overhead (`Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("")`) causes severe GC pauses. This is a critical pattern in this codebase due to the high frequency of chunk processing.
**Action:** When converting ArrayBuffers to hex strings, use a pre-computed lookup table (`byteToHex`) and a simple loop with string concatenation.

## 2024-05-18 - [TextEncoder and TextDecoder Instantiation Overhead]
**Learning:** In ultra-low latency WebRTC streaming (50ms interval), instantiating `TextEncoder` and `TextDecoder` on every chunk processing inside the tight loops causes significant GC pressure and CPU overhead.
**Action:** Always cache instances of `TextEncoder` and `TextDecoder` as static class variables or global singletons to prevent allocation overhead in hot paths.

## 2024-08-04 - [String concatenation GC pauses in Base64 encoding]
**Learning:** In WebRTC WebSocket chunk relay fallback, byte-by-byte string concatenation (`binary += String.fromCharCode(bytes[i])`) inside a tight loop creates large amounts of intermediate garbage strings for large payload sizes, leading to severe GC pauses.
**Action:** When converting large ArrayBuffers to strings (for Base64 encoding), chunk the array into smaller blocks (e.g., 8192) and process them with `String.fromCharCode.apply(null, subarray)` to eliminate heavy string allocations.

## 2024-08-04 - [TextEncoder array allocation optimization]
**Learning:** Even when caching a single `TextEncoder` instance, using `encode()` still allocates a new `Uint8Array` each time. This creates GC pressure in high-frequency operations like 50ms interval WebRTC chunk broadcasting.
**Action:** When writing string data to a fixed layout ArrayBuffer, always use `TextEncoder.encodeInto()` to write directly into an existing `Uint8Array` view (e.g. `.subarray()`), eliminating array allocations entirely.
