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
  yieldEveryIterations?: number;
}

export type NativeDeriveKey = (
  password: string | Uint8Array,
  salt: Uint8Array,
  iterations: number,
) => Promise<Uint8Array | null>;

let nativeDeriveKey: NativeDeriveKey | null = null;

export function setNativeDeriveKey(derive: NativeDeriveKey | null): void {
  nativeDeriveKey = derive;
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
    const nextU = hmacSha256(password, u);
    secureClear(u);
    u = nextU;
    for (let j = 0; j < derived.length; j += 1) {
      derived[j] ^= u[j];
    }
  }
  secureClear(saltBlock);
  secureClear(u);
  return derived;
}

async function yieldToUi(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export async function deriveKeyAsync(
  password: string | Uint8Array,
  salt: string | Uint8Array,
  iterations = 100000,
  yieldEveryIterations = 512,
): Promise<Uint8Array> {
  const saltBytes = typeof salt === 'string' ? utf8Bytes(salt) : salt;
  if (nativeDeriveKey) {
    try {
      const nativeKey = await nativeDeriveKey(password, saltBytes, iterations);
      if (nativeKey) {
        if (nativeKey.length !== 32) {
          secureClear(nativeKey);
          throw new Error('native PBKDF2 returned an invalid key length');
        }
        return nativeKey;
      }
    } catch {
      // Fall back to the audited TypeScript implementation if the native module
      // is absent or unavailable on a given build.
    }
  }
  const saltBlock = concatBytes([saltBytes, Uint8Array.of(0, 0, 0, 1)]);
  let u = hmacSha256(password, saltBlock);
  const derived = u.slice();
  try {
    for (let i = 1; i < iterations; i += 1) {
      const nextU = hmacSha256(password, u);
      secureClear(u);
      u = nextU;
      for (let j = 0; j < derived.length; j += 1) {
        derived[j] ^= u[j];
      }
      if (i % yieldEveryIterations === 0) {
        await yieldToUi();
      }
    }
    return derived;
  } finally {
    secureClear(saltBlock);
    secureClear(u);
  }
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
  let expectedTag: Uint8Array | null = null;
  try {
    expectedTag = hmacSha256(derived, concatBytes([nonce, ciphertext]));
    if (!constantTimeEqual(tag, expectedTag)) {
      throw new Error('decryption failed: invalid key or corrupted data');
    }
    const stream = new DeterministicStream(derived);
    const plaintext = new Uint8Array(ciphertext.length);
    for (let i = 0; i < ciphertext.length; i += 1) {
      plaintext[i] = ciphertext[i] ^ stream.nextByte();
    }
    return plaintext;
  } finally {
    secureClear(derived);
    if (expectedTag) {
      secureClear(expectedTag);
    }
  }
}

export async function encryptKryptosWithOptionsAsync(
  plaintext: string | Uint8Array,
  key: string,
  nonce: Uint8Array,
  options: KryptosCipherOptions = {},
): Promise<Uint8Array> {
  const plain = typeof plaintext === 'string' ? utf8Bytes(plaintext) : plaintext;
  if (key.length === 0) {
    return plain.slice();
  }
  if (nonce.length !== 16) {
    throw new Error('nonce must be 16 bytes');
  }
  const derived = await deriveKeyAsync(
    key,
    nonce,
    options.kdfIterations ?? KRYPTOS_DEFAULT_KDF_ITERATIONS,
    options.yieldEveryIterations,
  );
  try {
    const stream = new DeterministicStream(derived);
    const ciphertext = new Uint8Array(plain.length);
    for (let i = 0; i < plain.length; i += 1) {
      ciphertext[i] = plain[i] ^ stream.nextByte();
    }
    const tag = hmacSha256(derived, concatBytes([nonce, ciphertext]));
    try {
      return concatBytes([nonce, ciphertext, tag]);
    } finally {
      secureClear(tag);
    }
  } finally {
    secureClear(derived);
  }
}

export async function decryptKryptosWithOptionsAsync(
  data: Uint8Array,
  key: string,
  options: KryptosCipherOptions = {},
): Promise<Uint8Array> {
  if (key.length === 0) {
    return data.slice();
  }
  if (data.length < 48) {
    throw new Error('ciphertext too short');
  }
  const nonce = data.slice(0, 16);
  const ciphertext = data.slice(16, data.length - 32);
  const tag = data.slice(data.length - 32);
  const derived = await deriveKeyAsync(
    key,
    nonce,
    options.kdfIterations ?? KRYPTOS_DEFAULT_KDF_ITERATIONS,
    options.yieldEveryIterations,
  );
  let expectedTag: Uint8Array | null = null;
  try {
    expectedTag = hmacSha256(derived, concatBytes([nonce, ciphertext]));
    if (!constantTimeEqual(tag, expectedTag)) {
      throw new Error('decryption failed: invalid key or corrupted data');
    }
    const stream = new DeterministicStream(derived);
    const plaintext = new Uint8Array(ciphertext.length);
    for (let i = 0; i < ciphertext.length; i += 1) {
      plaintext[i] = ciphertext[i] ^ stream.nextByte();
    }
    return plaintext;
  } finally {
    secureClear(derived);
    if (expectedTag) {
      secureClear(expectedTag);
    }
  }
}

export function bytesHex(input: Uint8Array): string {
  return bytesToHex(input);
}

export { bytesToBase64, base64ToBytes, utf8String };
