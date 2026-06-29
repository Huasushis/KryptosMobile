import { base64ToBytes, bytesToBase64, utf8Bytes } from '../kryptos/bytes.ts';
import { randomBytes } from '../platform/runtime.ts';
import { decryptAesGcm, encryptAesGcmWithNonce } from './aesGcm.ts';

export async function encryptAesGcm(plaintext: string, rawKey: Uint8Array): Promise<Uint8Array> {
  return encryptAesGcmWithNonce(plaintext, rawKey, await randomBytes(12));
}

export async function encryptInMemorySecret(secret: string): Promise<{ key: Uint8Array; ciphertext: Uint8Array }> {
  const key = await randomBytes(32);
  const ciphertext = await encryptAesGcm(secret, key);
  return { key, ciphertext };
}

export async function decryptInMemorySecret(box: { key: Uint8Array; ciphertext: Uint8Array }): Promise<string> {
  return decryptAesGcm(box.ciphertext, box.key);
}

export function encodeKey(key: Uint8Array): string {
  return bytesToBase64(key);
}

export function decodeKey(value: string): Uint8Array {
  return base64ToBytes(value);
}

export { decryptAesGcm };
export { utf8Bytes };
