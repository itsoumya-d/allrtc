## 2024-05-24 - Array.from and .map overhead in crypto hash to hex string
**Learning:** `Array.from` and `.map` combined with `.toString(16).padStart(2, '0')` dynamically stringifying bytes in high-frequency chunk-hashing (like in video-assembler/chunk-hasher) is slow.
**Action:** Use a pre-computed string lookup array mapping integers `0-255` to their hex values, and manually loop and concatenate strings. This speeds up hex conversions by roughly 10%.
