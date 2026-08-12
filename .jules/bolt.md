## 2024-05-18 - [String Formatting Allocation Overhead in WebRTC Chunk Hash]
**Learning:** In ultra-low latency WebRTC streaming (50ms interval), using intermediate array allocations, closures (like map), and string formatting overhead (`Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("")`) causes severe GC pauses. This is a critical pattern in this codebase due to the high frequency of chunk processing.
**Action:** When converting ArrayBuffers to hex strings, use a pre-computed lookup table (`byteToHex`) and a simple loop with string concatenation.

## 2024-05-18 - [TextEncoder and TextDecoder Instantiation Overhead]
**Learning:** In ultra-low latency WebRTC streaming (50ms interval), instantiating `TextEncoder` and `TextDecoder` on every chunk processing inside the tight loops causes significant GC pressure and CPU overhead.
**Action:** Always cache instances of `TextEncoder` and `TextDecoder` as static class variables or global singletons to prevent allocation overhead in hot paths.

## 2024-05-18 - [String Allocation Overhead in Go IP Prefix Extraction]
**Learning:** In the Go tracker (`tracker/swarm.go`), using `strings.Split` and string concatenation for extracting IP subnet prefixes causes unnecessary heap allocations (slices and new strings). During high-churn periods (many peers joining/reparenting), this puts pressure on the garbage collector.
**Action:** When extracting substrings based on a known separator byte (like `.` in an IP address), use `strings.IndexByte` along with string slicing instead. String slicing in Go reuses the underlying byte array, resulting in zero allocations and significantly better performance (~14x faster in this case).
