export type ByteInput = string | Uint8Array;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8Bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

export function utf8String(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new Error('invalid hex string');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const triple =
      (bytes[i] << 16) |
      ((i + 1 < bytes.length ? bytes[i + 1] : 0) << 8) |
      (i + 2 < bytes.length ? bytes[i + 2] : 0);
    out += alphabet[(triple >>> 18) & 0x3f];
    out += alphabet[(triple >>> 12) & 0x3f];
    out += i + 1 < bytes.length ? alphabet[(triple >>> 6) & 0x3f] : '=';
    out += i + 2 < bytes.length ? alphabet[triple & 0x3f] : '=';
  }
  return out;
}

export function base64ToBytes(input: string): Uint8Array {
  const cleaned = input.replace(/[\r\n\s]/g, '');
  if (cleaned.length === 0) {
    return new Uint8Array();
  }
  if (cleaned.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(cleaned)) {
    throw new Error('invalid base64 data');
  }
  if (!/^[A-Za-z0-9+/]*(?:={0,2})$/.test(cleaned)) {
    throw new Error('invalid base64 data');
  }
  const firstPadding = cleaned.indexOf('=');
  if (firstPadding !== -1 && firstPadding < cleaned.length - (cleaned.endsWith('==') ? 2 : 1)) {
    throw new Error('invalid base64 data');
  }
  const table = new Map<string, number>();
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    .split('')
    .forEach((char, index) => table.set(char, index));
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i += 4) {
    const chars = cleaned.slice(i, i + 4);
    const values = chars.split('').map((char) => (char === '=' ? 0 : table.get(char)));
    if (values.some((value) => value === undefined)) {
      throw new Error('invalid base64 data');
    }
    const triple =
      ((values[0] as number) << 18) |
      ((values[1] as number) << 12) |
      ((values[2] as number) << 6) |
      (values[3] as number);
    bytes.push((triple >>> 16) & 0xff);
    if (chars[2] !== '=') {
      bytes.push((triple >>> 8) & 0xff);
    }
    if (chars[3] !== '=') {
      bytes.push(triple & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

export function bytesToBinaryString(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += String.fromCharCode(byte);
  }
  return out;
}

export function binaryStringToBytes(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    out[i] = value.charCodeAt(i) & 0xff;
  }
  return out;
}

export function asBytes(input: ByteInput): Uint8Array {
  return typeof input === 'string' ? utf8Bytes(input) : input;
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export function secureClear(bytes: Uint8Array): void {
  bytes.fill(0);
}
