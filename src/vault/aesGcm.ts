import { gcm } from '@noble/ciphers/aes.js';

import { secureClear, utf8String } from '../kryptos/bytes.ts';

const encoder = new TextEncoder();

export async function encryptAesGcmWithNonce(
  plaintext: string,
  rawKey: Uint8Array,
  nonce: Uint8Array,
): Promise<Uint8Array> {
  if (rawKey.length !== 32) {
    throw new Error('AES-256-GCM requires a 32-byte key');
  }
  if (nonce.length !== 12) {
    throw new Error('AES-GCM nonce must be 12 bytes');
  }
  const plaintextBytes = encoder.encode(plaintext);
  try {
    const encrypted = gcm(rawKey, nonce).encrypt(plaintextBytes);
    const out = new Uint8Array(nonce.length + encrypted.length);
    out.set(nonce, 0);
    out.set(encrypted, nonce.length);
    return out;
  } finally {
    secureClear(plaintextBytes);
  }
}

export async function decryptAesGcm(data: Uint8Array, rawKey: Uint8Array): Promise<string> {
  if (rawKey.length !== 32) {
    throw new Error('AES-256-GCM requires a 32-byte key');
  }
  if (data.length < 29) {
    throw new Error('vault ciphertext is too short');
  }
  const nonce = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const plaintext = gcm(rawKey, nonce).decrypt(ciphertext);
  const text = utf8String(plaintext);
  secureClear(plaintext);
  return text;
}
