## 2024-05-18 - [String Formatting Allocation Overhead in WebRTC Chunk Hash]
**Learning:** In ultra-low latency WebRTC streaming (50ms interval), using intermediate array allocations, closures (like map), and string formatting overhead (`Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("")`) causes severe GC pauses. This is a critical pattern in this codebase due to the high frequency of chunk processing.
**Action:** When converting ArrayBuffers to hex strings, use a pre-computed lookup table (`byteToHex`) and a simple loop with string concatenation.

## 2024-05-18 - [TextEncoder and TextDecoder Instantiation Overhead]
**Learning:** In ultra-low latency WebRTC streaming (50ms interval), instantiating `TextEncoder` and `TextDecoder` on every chunk processing inside the tight loops causes significant GC pressure and CPU overhead.
**Action:** Always cache instances of `TextEncoder` and `TextDecoder` as static class variables or global singletons to prevent allocation overhead in hot paths.
## 2024-08-13 - [Tracker IPv4 Parsing Zero-Allocation Optimization]
**Learning:** In the Go tracker (`tracker/swarm.go`), `ipPrefix` is a hot path called frequently inside `findBestParentFor` to match clients within the same `/16` subnet via geographical routing. The function initially used `strings.Split`, which unnecessarily allocated slices on the heap inside an `O(N)` loop on every connection join.
**Action:** Replace `strings.Split` with manual string index iteration. Substring slicing (`ip[:i]`) shares the string's backing byte array, turning a 2-alloc/op (~335ns) function into a 0-alloc/op (~8ns) function, heavily improving tracker connection capacity under load.
