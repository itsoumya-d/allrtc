## 2024-05-18 - [String Formatting Allocation Overhead in WebRTC Chunk Hash]
**Learning:** In ultra-low latency WebRTC streaming (50ms interval), using intermediate array allocations, closures (like map), and string formatting overhead (`Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("")`) causes severe GC pauses. This is a critical pattern in this codebase due to the high frequency of chunk processing.
**Action:** When converting ArrayBuffers to hex strings, use a pre-computed lookup table (`byteToHex`) and a simple loop with string concatenation.

## 2024-05-18 - [TextEncoder and TextDecoder Instantiation Overhead]
**Learning:** In ultra-low latency WebRTC streaming (50ms interval), instantiating `TextEncoder` and `TextDecoder` on every chunk processing inside the tight loops causes significant GC pressure and CPU overhead.
**Action:** Always cache instances of `TextEncoder` and `TextDecoder` as static class variables or global singletons to prevent allocation overhead in hot paths.

## 2024-05-18 - Tracker Proximity Routing Bottleneck
**Learning:** In the Go tracker's hot path (`SwarmTree.findBestParentFor`), iterating over thousands of peers and parsing their `IPAddr` to a `/16` subnet string using `strings.Split` resulted in massive O(N) heap allocations and CPU usage due to repeated string splitting during lock holding.
**Action:** Always cache derived routing keys (`IPPrefix`) on the `Peer` struct at connection time, and use allocation-free byte indexing (`strings.IndexByte`) for simple substring extraction in Go hot paths. This avoids blocking concurrent tracker connections waiting on the mutex.
