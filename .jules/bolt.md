## 2024-05-18 - [String Formatting Allocation Overhead in WebRTC Chunk Hash]
**Learning:** In ultra-low latency WebRTC streaming (50ms interval), using intermediate array allocations, closures (like map), and string formatting overhead (`Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("")`) causes severe GC pauses. This is a critical pattern in this codebase due to the high frequency of chunk processing.
**Action:** When converting ArrayBuffers to hex strings, use a pre-computed lookup table (`byteToHex`) and a simple loop with string concatenation.

## 2024-05-18 - [TextEncoder and TextDecoder Instantiation Overhead]
**Learning:** In ultra-low latency WebRTC streaming (50ms interval), instantiating `TextEncoder` and `TextDecoder` on every chunk processing inside the tight loops causes significant GC pressure and CPU overhead.
**Action:** Always cache instances of `TextEncoder` and `TextDecoder` as static class variables or global singletons to prevent allocation overhead in hot paths.

## 2024-05-18 - [String Split Allocation Overhead in Go IP Routing]
**Learning:** In the Go tracker's hot loop (`findBestParentFor`), iterating over thousands of peers and calling `strings.Split(ip, ".")` to extract IP prefixes causes severe GC pressure due to array allocation on every loop iteration.
**Action:** When extracting simple prefixes from strings in hot Go loops, use `strings.IndexByte` or `strings.Index` instead of `strings.Split` to slice the string without allocating new memory.
