## 2024-05-18 - [String Formatting Allocation Overhead in WebRTC Chunk Hash]
**Learning:** In ultra-low latency WebRTC streaming (50ms interval), using intermediate array allocations, closures (like map), and string formatting overhead (`Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("")`) causes severe GC pauses. This is a critical pattern in this codebase due to the high frequency of chunk processing.
**Action:** When converting ArrayBuffers to hex strings, use a pre-computed lookup table (`byteToHex`) and a simple loop with string concatenation.

## 2024-05-18 - [TextEncoder and TextDecoder Instantiation Overhead]
**Learning:** In ultra-low latency WebRTC streaming (50ms interval), instantiating `TextEncoder` and `TextDecoder` on every chunk processing inside the tight loops causes significant GC pressure and CPU overhead.
**Action:** Always cache instances of `TextEncoder` and `TextDecoder` as static class variables or global singletons to prevent allocation overhead in hot paths.

## 2026-08-14 - [Zero-Allocation IP Prefix Extraction in Hot Paths]
**Learning:** In the Go tracker's `findBestParentFor` function, `ipPrefix(ip)` is called thousands of times per new peer connection to determine geographic proximity. The original implementation used `strings.Split(ip, ".")` which allocates slices and strings on every call (2 allocs/op, ~175ns). This causes significant GC pressure under high churn.
**Action:** Replaced `strings.Split` with a zero-allocation manual byte iteration that finds the index of the second dot and slices the original string directly (0 allocs/op, ~8ns). Always avoid string splitting for simple prefix matching in hot loops.
