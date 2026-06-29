import { concatBytes, secureClear, utf8Bytes } from './bytes.ts';
import { sha256Hex, sha256Raw } from './sha256.ts';

export type CharsetPreset = 'full' | 'alphanum';

export const charset = {
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{}|;:,.<>?/~',
  full(): string[] {
    return [this.lowercase, this.uppercase, this.digits, this.symbols];
  },
  alphaNumeric(): string[] {
    return [this.lowercase, this.uppercase, this.digits];
  },
  fromPresetName(name: string): string[] {
    return name === 'alphanum' ? this.alphaNumeric() : this.full();
  },
};

export class DeterministicStream {
  private readonly seed: Uint8Array;
  private counter = 0n;
  private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array();
  private pos = 0;

  constructor(seed: string | Uint8Array) {
    this.seed = sha256Raw(seed);
    this.refill();
  }

  nextByte(): number {
    if (this.pos >= this.buffer.length) {
      this.refill();
    }
    const byte = this.buffer[this.pos];
    this.pos += 1;
    return byte;
  }

  nextUint32(): number {
    let result = 0;
    for (let i = 0; i < 4; i += 1) {
      result = ((result << 8) | this.nextByte()) >>> 0;
    }
    return result;
  }

  uniformRandom(n: number): number {
    if (!Number.isInteger(n) || n < 0) {
      throw new Error('n must be a non-negative integer');
    }
    if (n <= 1) {
      return 0;
    }
    const fullRange = 0x1_0000_0000;
    const limit = Math.floor(fullRange / n) * n;
    let r = 0;
    do {
      r = this.nextUint32();
    } while (r >= limit);
    return r % n;
  }

  private refill(): void {
    const counterBytes = new Uint8Array(8);
    let value = this.counter;
    for (let i = 7; i >= 0; i -= 1) {
      counterBytes[i] = Number(value & 0xffn);
      value >>= 8n;
    }
    this.counter += 1n;
    this.buffer = sha256Raw(concatBytes([this.seed, counterBytes]));
    this.pos = 0;
  }
}

export function generatePassword(seed: string, length: number, charsets: string[]): string {
  if (charsets.length === 0) {
    throw new Error('charsets must not be empty');
  }
  if (!Number.isInteger(length) || length < charsets.length) {
    throw new Error('password length must be >= number of charsets');
  }
  for (const set of charsets) {
    if (set.length === 0) {
      throw new Error('each charset must be non-empty');
    }
  }

  const stream = new DeterministicStream(seed);
  const result = new Array<string>(length).fill('');
  const used = new Array<boolean>(charsets.length).fill(false);
  let usedCount = 0;

  for (let i = 0; i < length; i += 1) {
    const remaining = length - i;
    const unrepresented = charsets.length - usedCount;
    let chosen = 0;

    for (;;) {
      const weights = charsets.map(() => stream.nextUint32());
      if (unrepresented === remaining) {
        for (let j = 0; j < weights.length; j += 1) {
          if (used[j]) {
            weights[j] = 0;
          }
        }
      }

      let maxValue = 0;
      let maxIndex = 0;
      let maxCount = 0;
      for (let j = 0; j < weights.length; j += 1) {
        if (weights[j] > maxValue) {
          maxValue = weights[j];
          maxIndex = j;
          maxCount = 1;
        } else if (weights[j] === maxValue) {
          maxCount += 1;
        }
      }
      if (maxCount === 1) {
        chosen = maxIndex;
        break;
      }
    }

    const charIndex = stream.uniformRandom(charsets[chosen].length);
    result[i] = charsets[chosen][charIndex];

    if (!used[chosen]) {
      used[chosen] = true;
      usedCount += 1;
    }
  }

  for (let i = length - 1; i > 0; i -= 1) {
    const j = stream.uniformRandom(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result.join('');
}

export function constructSeed(
  prefix: string,
  webname: string,
  uuid: string,
  username: string,
): string {
  const prefixHash = sha256Raw(prefix);
  const material = concatBytes([
    prefixHash,
    Uint8Array.of(0),
    utf8Bytes(webname),
    Uint8Array.of(0),
    utf8Bytes(uuid),
    Uint8Array.of(0),
    utf8Bytes(username),
  ]);
  const seed = sha256Hex(material);
  secureClear(prefixHash);
  secureClear(material);
  return seed;
}

export { sha256Hex, sha256Raw };
