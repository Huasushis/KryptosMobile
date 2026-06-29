import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  concatBytes,
  constantTimeEqual,
  secureClear,
  utf8Bytes,
  utf8String,
} from './bytes.ts';
import { DeterministicStream } from './core.ts';
import { sha256Raw } from './sha256.ts';

export const KRYPTOS_DEFAULT_KDF_ITERATIONS = 100000;

export interface KryptosCipherOptions {
  kdfIterations?: number;
}

export function base64Encode(input: string | Uint8Array): string {
  return bytesToBase64(typeof input === 'string' ? utf8Bytes(input) : input);
}

export function base64Decode(input: string): Uint8Array {
  return base64ToBytes(input);
}

export function hmacSha256(key: string | Uint8Array, message: string | Uint8Array): Uint8Array {
  const blockSize = 64;
  let k = typeof key === 'string' ? utf8Bytes(key) : key.slice();
  if (k.length > blockSize) {
    k = sha256Raw(k);
  }
  const padded = new Uint8Array(blockSize);
  padded.set(k);
  const ipad = new Uint8Array(blockSize);
  const opad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i += 1) {
    ipad[i] = padded[i] ^ 0x36;
    opad[i] = padded[i] ^ 0x5c;
  }
  const msg = typeof message === 'string' ? utf8Bytes(message) : message;
  const inner = sha256Raw(concatBytes([ipad, msg]));
  const out = sha256Raw(concatBytes([opad, inner]));
  secureClear(padded);
  secureClear(ipad);
  secureClear(opad);
  secureClear(inner);
  return out;
}

export function deriveKey(
  password: string | Uint8Array,
  salt: string | Uint8Array,
  iterations = 100000,
): Uint8Array {
  const saltBytes = typeof salt === 'string' ? utf8Bytes(salt) : salt;
  const saltBlock = concatBytes([saltBytes, Uint8Array.of(0, 0, 0, 1)]);
  let u = hmacSha256(password, saltBlock);
  const derived = u.slice();
  for (let i = 1; i < iterations; i += 1) {
    u = hmacSha256(password, u);
    for (let j = 0; j < derived.length; j += 1) {
      derived[j] ^= u[j];
    }
  }
  secureClear(saltBlock);
  secureClear(u);
  return derived;
}

export function encryptKryptos(
  plaintext: string | Uint8Array,
  key: string,
  nonce: Uint8Array,
  options: KryptosCipherOptions = {},
): Uint8Array {
  return encryptKryptosWithOptions(plaintext, key, nonce, options);
}

export function encryptKryptosWithOptions(
  plaintext: string | Uint8Array,
  key: string,
  nonce: Uint8Array,
  options: KryptosCipherOptions = {},
): Uint8Array {
  const plain = typeof plaintext === 'string' ? utf8Bytes(plaintext) : plaintext;
  if (key.length === 0) {
    return plain.slice();
  }
  if (nonce.length !== 16) {
    throw new Error('nonce must be 16 bytes');
  }
  const derived = deriveKey(key, nonce, options.kdfIterations ?? KRYPTOS_DEFAULT_KDF_ITERATIONS);
  const stream = new DeterministicStream(derived);
  const ciphertext = new Uint8Array(plain.length);
  for (let i = 0; i < plain.length; i += 1) {
    ciphertext[i] = plain[i] ^ stream.nextByte();
  }
  const tag = hmacSha256(derived, concatBytes([nonce, ciphertext]));
  const out = concatBytes([nonce, ciphertext, tag]);
  secureClear(derived);
  secureClear(tag);
  return out;
}

export function decryptKryptos(
  data: Uint8Array,
  key: string,
  options: KryptosCipherOptions = {},
): Uint8Array {
  return decryptKryptosWithOptions(data, key, options);
}

export function decryptKryptosWithOptions(
  data: Uint8Array,
  key: string,
  options: KryptosCipherOptions = {},
): Uint8Array {
  if (key.length === 0) {
    return data.slice();
  }
  if (data.length < 48) {
    throw new Error('ciphertext too short');
  }
  const nonce = data.slice(0, 16);
  const ciphertext = data.slice(16, data.length - 32);
  const tag = data.slice(data.length - 32);
  const derived = deriveKey(key, nonce, options.kdfIterations ?? KRYPTOS_DEFAULT_KDF_ITERATIONS);
  const expectedTag = hmacSha256(derived, concatBytes([nonce, ciphertext]));
  if (!constantTimeEqual(tag, expectedTag)) {
    throw new Error('decryption failed: invalid key or corrupted data');
  }
  const stream = new DeterministicStream(derived);
  const plaintext = new Uint8Array(ciphertext.length);
  for (let i = 0; i < ciphertext.length; i += 1) {
    plaintext[i] = ciphertext[i] ^ stream.nextByte();
  }
  secureClear(derived);
  secureClear(expectedTag);
  return plaintext;
}

export function bytesHex(input: Uint8Array): string {
  return bytesToHex(input);
}

export { bytesToBase64, base64ToBytes, utf8String };
