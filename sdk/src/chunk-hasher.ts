// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com | +91 7031648617

// Pre-calculate hex string representation for bytes 0-255
const hexTable: string[] = [];
for (let i = 0; i < 256; i++) {
  hexTable[i] = i.toString(16).padStart(2, '0');
}

/**
 * Generates a SHA-256 hash of the given ArrayBuffer.
 * Optimized with a pre-calculated hex table to avoid intermediate array
 * allocations and string processing during the high-frequency 50ms chunking loop.
 */
export async function hashChunk(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  let hashHex = '';
  for (let i = 0; i < hashArray.length; i++) {
    hashHex += hexTable[hashArray[i]];
  }
  return hashHex;
}
