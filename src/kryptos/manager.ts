import { utf8String } from './bytes.ts';
import {
  decryptKryptosWithOptionsAsync,
  decryptKryptosWithOptions,
  encryptKryptosWithOptionsAsync,
  encryptKryptosWithOptions,
  base64ToBytes,
  bytesToBase64,
  type KryptosCipherOptions,
} from './crypto.ts';
import { charset, constructSeed, generatePassword, type CharsetPreset } from './core.ts';

export interface AccountEntry {
  webname: string;
  uuid: string;
  username: string;
  length: number;
  charsetPreset: CharsetPreset;
}

export function generateEntryPassword(entry: AccountEntry, prefix: string): string {
  const seed = constructSeed(prefix, entry.webname, entry.uuid, entry.username);
  return generatePassword(seed, entry.length, charset.fromPresetName(entry.charsetPreset));
}

export function escapeField(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

export function unescapeField(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '\\' && i + 1 < value.length) {
      const next = value[i + 1];
      if (next === '\\') {
        out += '\\';
        i += 1;
      } else if (next === 't') {
        out += '\t';
        i += 1;
      } else if (next === 'n') {
        out += '\n';
        i += 1;
      } else if (next === 'r') {
        out += '\r';
        i += 1;
      } else {
        out += value[i];
      }
    } else {
      out += value[i];
    }
  }
  return out;
}

export function serializeEntries(entries: readonly AccountEntry[]): string {
  const lines = ['KRYPTOS:V1', String(entries.length)];
  for (const entry of entries) {
    lines.push(
      [
        escapeField(entry.webname),
        escapeField(entry.uuid),
        escapeField(entry.username),
        String(entry.length),
        escapeField(entry.charsetPreset),
      ].join('\t'),
    );
  }
  return `${lines.join('\n')}\n`;
}

export function deserializeEntries(text: string): AccountEntry[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== 'KRYPTOS:V1') {
    throw new Error('invalid Kryptos header');
  }
  const countText = lines[1] ?? '';
  if (!/^(0|[1-9]\d*)$/.test(countText)) {
    throw new Error('invalid entry count');
  }
  const count = Number(countText);
  if (!Number.isInteger(count) || count < 0 || count > 10000) {
    throw new Error('invalid entry count');
  }
  const entries: AccountEntry[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    const line = lines[2 + i];
    if (line === undefined) {
      throw new Error('missing entry line');
    }
    const fields = line.split('\t');
    if (fields.length !== 5) {
      throw new Error('invalid entry field count');
    }
    if (!/^(0|[1-9]\d*)$/.test(fields[3])) {
      throw new Error('invalid password length');
    }
    const length = Number(fields[3]);
    const charsetPreset = unescapeField(fields[4]);
    const entry: AccountEntry = {
      webname: unescapeField(fields[0]),
      uuid: unescapeField(fields[1]),
      username: unescapeField(fields[2]),
      length,
      charsetPreset: charsetPreset === 'alphanum' ? 'alphanum' : 'full',
    };
    validateEntry(entry);
    const duplicateKey = normalizedIdentityKey(entry);
    if (seen.has(duplicateKey)) {
      throw new Error('duplicate entry in imported data');
    }
    seen.add(duplicateKey);
    entries.push(entry);
  }
  const trailing = lines.slice(2 + count);
  if (trailing.some((line) => line.trim().length > 0)) {
    throw new Error('unexpected trailing data in imported data');
  }
  return entries;
}

export function exportEntriesBase64(
  entries: readonly AccountEntry[],
  key = '',
  nonce?: Uint8Array,
  options: KryptosCipherOptions = {},
): string {
  const text = serializeEntries(entries);
  let encrypted: Uint8Array;
  if (key.length > 0) {
    if (!nonce || nonce.length !== 16) {
      throw new Error('nonce must be 16 bytes when export key is provided');
    }
    encrypted = encryptKryptosWithOptions(text, key, nonce, options);
  } else {
    encrypted = new TextEncoder().encode(text);
  }
  return bytesToBase64(encrypted);
}

export async function exportEntriesBase64Async(
  entries: readonly AccountEntry[],
  key = '',
  nonce?: Uint8Array,
  options: KryptosCipherOptions = {},
): Promise<string> {
  const text = serializeEntries(entries);
  let encrypted: Uint8Array;
  if (key.length > 0) {
    if (!nonce || nonce.length !== 16) {
      throw new Error('nonce must be 16 bytes when export key is provided');
    }
    encrypted = await encryptKryptosWithOptionsAsync(text, key, nonce, options);
  } else {
    encrypted = new TextEncoder().encode(text);
  }
  return bytesToBase64(encrypted);
}

export function importEntriesBase64(
  base64: string,
  key = '',
  options: KryptosCipherOptions = {},
): AccountEntry[] {
  const raw = base64ToBytes(base64);
  if (raw.length === 0) {
    throw new Error('invalid base64 data');
  }
  const plaintext = key.length > 0 ? decryptKryptosWithOptions(raw, key, options) : raw;
  return deserializeEntries(utf8String(plaintext));
}

export async function importEntriesBase64Async(
  base64: string,
  key = '',
  options: KryptosCipherOptions = {},
): Promise<AccountEntry[]> {
  const raw = base64ToBytes(base64);
  if (raw.length === 0) {
    throw new Error('invalid base64 data');
  }
  const plaintext = key.length > 0 ? await decryptKryptosWithOptionsAsync(raw, key, options) : raw;
  return deserializeEntries(utf8String(plaintext));
}

export function mergeEntries(current: readonly AccountEntry[], incoming: readonly AccountEntry[]): AccountEntry[] {
  const out = [...current];
  const seen = new Set(out.map(normalizedIdentityKey));
  for (const entry of incoming) {
    const key = normalizedIdentityKey(entry);
    if (!seen.has(key)) {
      out.push(entry);
      seen.add(key);
    }
  }
  return out;
}

export function normalizedIdentityKey(entry: Pick<AccountEntry, 'webname' | 'username'>): string {
  return `${entry.webname.trim().toLowerCase()}\u0000${entry.username.trim().toLowerCase()}`;
}

export function validateEntry(entry: AccountEntry): void {
  if (entry.webname.trim().length === 0 || entry.webname.length > 200) {
    throw new Error('site name is required and must be shorter than 200 characters');
  }
  if (entry.username.trim().length === 0 || entry.username.length > 200) {
    throw new Error('username is required and must be shorter than 200 characters');
  }
  if (entry.uuid.length < 1 || entry.uuid.length > 128) {
    throw new Error('uuid length is invalid');
  }
  if (!Number.isInteger(entry.length) || entry.length < 4 || entry.length > 128) {
    throw new Error('password length must be between 4 and 128');
  }
  if (entry.charsetPreset !== 'full' && entry.charsetPreset !== 'alphanum') {
    throw new Error('unsupported charset preset');
  }
  if (entry.length < charset.fromPresetName(entry.charsetPreset).length) {
    throw new Error('password length is shorter than required character classes');
  }
}
