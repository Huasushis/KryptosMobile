import { secureClear } from '../kryptos/bytes.ts';
import { decryptInMemorySecret, encryptInMemorySecret } from './cryptoBox.ts';

export interface PrefixSession {
  expiresAt: number;
  key: Uint8Array;
  ciphertext: Uint8Array;
}

export async function createPrefixSession(prefix: string, ttlMs: number): Promise<PrefixSession> {
  const box = await encryptInMemorySecret(prefix);
  return {
    expiresAt: Date.now() + ttlMs,
    key: box.key,
    ciphertext: box.ciphertext,
  };
}

export function destroyPrefixSession(session: PrefixSession | null): void {
  if (!session) {
    return;
  }
  secureClear(session.key);
  secureClear(session.ciphertext);
  session.expiresAt = 0;
}

export async function withPrefix<T>(session: PrefixSession, fn: (prefix: string) => T | Promise<T>): Promise<T> {
  if (Date.now() > session.expiresAt) {
    throw new Error('prefix session expired');
  }
  const prefix = await decryptInMemorySecret(session);
  try {
    return await fn(prefix);
  } finally {
    // JavaScript strings cannot be reliably wiped; the decrypted value is kept
    // scoped to this function and never persisted.
  }
}
