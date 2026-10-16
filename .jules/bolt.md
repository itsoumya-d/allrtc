## 2024-05-18 - [String Formatting Allocation Overhead in WebRTC Chunk Hash]
**Learning:** In ultra-low latency WebRTC streaming (50ms interval), using intermediate array allocations, closures (like map), and string formatting overhead (`Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("")`) causes severe GC pauses. This is a critical pattern in this codebase due to the high frequency of chunk processing.
**Action:** When converting ArrayBuffers to hex strings, use a pre-computed lookup table (`byteToHex`) and a simple loop with string concatenation.

## 2024-05-18 - [TextEncoder and TextDecoder Instantiation Overhead]
**Learning:** In ultra-low latency WebRTC streaming (50ms interval), instantiating `TextEncoder` and `TextDecoder` on every chunk processing inside the tight loops causes significant GC pressure and CPU overhead.
**Action:** Always cache instances of `TextEncoder` and `TextDecoder` as static class variables or global singletons to prevent allocation overhead in hot paths.

## 2024-08-10 - [String Concatenation Overhead in ArrayBuffer to Base64 Encoding]
**Learning:** Iterating byte-by-byte and using string concatenation (`binary += String.fromCharCode(bytes[i])`) to convert an ArrayBuffer to a base64 string is extremely slow (O(N^2) behavior in some JS engines) and causes massive GC pressure for payloads like video chunks in WebRTC fallbacks.
**Action:** When converting ArrayBuffers to binary strings synchronously for base64 encoding, process the bytes in chunks using `String.fromCharCode.apply` (e.g., in chunks of 8192 bytes) to minimize string allocations and avoid call stack limits.
