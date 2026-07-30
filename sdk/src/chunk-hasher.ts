// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com | +91 7031648617

// Pre-computed byte to hex string mapping for faster hex conversion
const byteToHex: string[] = [];
for (let n = 0; n <= 0xff; ++n) {
  byteToHex.push(n.toString(16).padStart(2, '0'));
}

export async function hashChunk(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  let hashHex = '';
  // SHA-256 hash is always 32 bytes
  for (let i = 0; i < 32; i++) {
    hashHex += byteToHex[hashArray[i]];
  }
  return hashHex;
}
