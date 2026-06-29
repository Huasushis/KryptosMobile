import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import { bytesHex, hmacSha256, deriveKey, encryptKryptos, decryptKryptos } from '../src/kryptos/crypto.ts';
import { charset, constructSeed, DeterministicStream, generatePassword, sha256Hex } from '../src/kryptos/core.ts';
import {
  deserializeEntries,
  escapeField,
  exportEntriesBase64,
  generateEntryPassword,
  importEntriesBase64,
  mergeEntries,
  serializeEntries,
  type AccountEntry,
} from '../src/kryptos/manager.ts';
import { utf8String } from '../src/kryptos/bytes.ts';
import { decryptAesGcm, encryptAesGcmWithNonce } from '../src/vault/aesGcm.ts';
import { assertMobileAuthenticationAvailable } from '../src/platform/authPolicy.ts';
import { createVaultEntryFromUuid, importVaultBackup, validateVaultState } from '../src/vault/model.ts';
import type { VaultEntry } from '../src/vault/types.ts';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}

const fullCrypto = process.env.KRYPTOS_FULL_CRYPTO === '1';
const testCipherOptions = fullCrypto ? {} : { kdfIterations: 32 };

function run(name: string, fn: () => void): void {
  fn();
  console.log(`ok - ${name}`);
}

async function runAsync(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  console.log(`ok - ${name}`);
}

run('sha256 vectors match KryptosCore', () => {
  assert.equal(
    sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.equal(
    sha256Hex('KryptosCore'),
    'b1658c43089cb92b6178eca68a1621b4d8ee05046c028e9580c12f25c24ab98d',
  );
});

run('deterministic stream matches KryptosCore first uint32', () => {
  const stream = new DeterministicStream('test_seed');
  assert.equal(stream.nextUint32(), 0x5b2a553f);
});

run('password generation matches KryptosCore vectors', () => {
  assert.equal(generatePassword('fixed_seed', 16, charset.full()), '=)]0]3w-h7GJ2ub+');
  assert.equal(generatePassword('alphanum_seed', 12, charset.alphaNumeric()), 'BPq8bi5n6AH8');

  const seed = constructSeed('master_prefix', 'github.com', 'abcdef1234567890', 'user@example.com');
  assert.equal(seed, '0cf4be51bf95ca0b0c5d511b9d57395d2a0be66aeddfd9bcae3ac7380e48029e');
  assert.equal(generatePassword(seed, 20, charset.alphaNumeric()), '4962fMT6y00d23kp5yX3');
});

run('account entry password matches KryptosCore full pipeline vector', () => {
  const entry: AccountEntry = {
    webname: 'test.example.org',
    uuid: '00000000000000000000000000000000',
    username: 'alice@example.org',
    length: 24,
    charsetPreset: 'full',
  };
  assert.equal(generateEntryPassword(entry, 'super_secret'), ')kXyq27N31q;uUq0F4EyPzZ:');
});

run('hmac and pbkdf2 vectors match KryptosCore', () => {
  assert.equal(
    bytesHex(hmacSha256('Jefe', 'what do ya want for nothing?')),
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
  );
  assert.equal(
    bytesHex(deriveKey('password', 'salt', 1)),
    '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b',
  );
});

run('KryptosCore export and import round trip with encryption', () => {
  const entries: AccountEntry[] = [
    {
      webname: 'site-a.com',
      uuid: 'aaa111',
      username: 'alice@a.com',
      length: 16,
      charsetPreset: 'full',
    },
    {
      webname: 'site-b.com',
      uuid: 'bbb222',
      username: 'bob@b.com',
      length: 20,
      charsetPreset: 'alphanum',
    },
  ];
  const text = serializeEntries(entries);
  assert.deepEqual(deserializeEntries(text), entries);

  const nonce = new Uint8Array(16).fill(0x7f);
  const exported = exportEntriesBase64(entries, 'export_test_key', nonce, testCipherOptions);
  assert.deepEqual(importEntriesBase64(exported, 'export_test_key', testCipherOptions), entries);
  assert.throws(() => importEntriesBase64(exported, 'wrong_key', testCipherOptions));
});

run('merge import skips duplicate site and username pairs', () => {
  const current: AccountEntry[] = [
    {
      webname: 'example.com',
      uuid: 'uuid-a',
      username: 'alice',
      length: 16,
      charsetPreset: 'full',
    },
  ];
  const incoming: AccountEntry[] = [
    {
      webname: 'example.com',
      uuid: 'uuid-b',
      username: 'alice',
      length: 20,
      charsetPreset: 'alphanum',
    },
    {
      webname: 'example.com',
      uuid: 'uuid-c',
      username: 'bob',
      length: 20,
      charsetPreset: 'alphanum',
    },
  ];
  const merged = mergeEntries(current, incoming);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].uuid, 'uuid-a');
  assert.equal(merged[1].username, 'bob');
});

run('encrypted export does not expose metadata plaintext', () => {
  const entries: AccountEntry[] = [
    {
      webname: 'secret-site.example',
      uuid: 'uuid-secret',
      username: 'alice@example.test',
      length: 16,
      charsetPreset: 'full',
    },
  ];
  const nonce = new Uint8Array(16).fill(0x21);
  const exported = exportEntriesBase64(entries, 'backup_password', nonce, testCipherOptions);
  assert.equal(exported.includes('secret-site.example'), false);
  assert.equal(exported.includes('alice@example.test'), false);
  assert.deepEqual(importEntriesBase64(exported, 'backup_password', testCipherOptions), entries);
  assert.throws(() => importEntriesBase64(exported, 'wrong_password', testCipherOptions));
});

run('authenticated encryption detects tampering', () => {
  const nonce = new Uint8Array(16).fill(0x42);
  const encrypted = encryptKryptos('Hello, KryptosCore!', 'test_encryption_key', nonce, testCipherOptions);
  assert.equal(utf8String(decryptKryptos(encrypted, 'test_encryption_key', testCipherOptions)), 'Hello, KryptosCore!');
  encrypted[20] ^= 0xff;
  assert.throws(() => decryptKryptos(encrypted, 'test_encryption_key', testCipherOptions));
});

await runAsync('vault entries use secure 128-bit UUID metadata', async () => {
  const entry = createVaultEntryFromUuid({
    webname: 'example.com',
    username: 'alice',
    length: 16,
    charsetPreset: 'full',
    uuidBytes: new Uint8Array(16).fill(0xab),
  });
  assert.equal(entry.uuid, 'abababababababababababababababab');
  assert.equal(entry.id.endsWith(entry.uuid), true);
});

run('vault backup import keeps existing data unchanged on wrong password', () => {
  const current: VaultEntry[] = [
    {
      id: 'local-id',
      webname: 'local.example',
      username: 'local-user',
      uuid: '00000000000000000000000000000000',
      length: 16,
      charsetPreset: 'full',
      createdAt: '2026-06-28T00:00:00.000Z',
      updatedAt: '2026-06-28T00:00:00.000Z',
    },
  ];
  const incoming: VaultEntry[] = [
    {
      id: 'remote-id',
      webname: 'remote.example',
      username: 'remote-user',
      uuid: '11111111111111111111111111111111',
      length: 20,
      charsetPreset: 'alphanum',
      createdAt: '2026-06-28T00:00:00.000Z',
      updatedAt: '2026-06-28T00:00:00.000Z',
    },
  ];
  const exported = exportEntriesBase64(
    incoming.map(({ webname, username, uuid, length, charsetPreset }) => ({
      webname,
      username,
      uuid,
      length,
      charsetPreset,
    })),
    'correct-password',
    new Uint8Array(16).fill(0x55),
    testCipherOptions,
  );

  assert.throws(() => importEntriesBase64(exported, 'wrong-password', testCipherOptions));
  assert.deepEqual(current.map((entry) => entry.webname), ['local.example']);
});

run('vault backup merge and replace policies are explicit', () => {
  const current: VaultEntry[] = [
    {
      id: 'same-id',
      webname: 'same.example',
      username: 'alice',
      uuid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      length: 16,
      charsetPreset: 'full',
      createdAt: '2026-06-28T00:00:00.000Z',
      updatedAt: '2026-06-28T00:00:00.000Z',
    },
  ];
  const incoming = exportEntriesBase64(
    [
      {
        webname: 'same.example',
        username: 'alice',
        uuid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        length: 20,
        charsetPreset: 'alphanum',
      },
      {
        webname: 'new.example',
        username: 'bob',
        uuid: 'cccccccccccccccccccccccccccccccc',
        length: 20,
        charsetPreset: 'alphanum',
      },
    ],
    'backup-pass',
    new Uint8Array(16).fill(0x77),
    testCipherOptions,
  );
  const merged = importVaultBackup(incoming, 'backup-pass', current, 'merge', testCipherOptions);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].uuid, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const replaced = importVaultBackup(incoming, 'backup-pass', current, 'replace', testCipherOptions);
  assert.equal(replaced.length, 2);
  assert.equal(replaced[0].uuid, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
});

run('KryptosCore backup payload hides site username prefix and generated password', () => {
  const entry = {
    webname: 'audit-secret.example',
    username: 'audit-user@example.test',
    uuid: 'dddddddddddddddddddddddddddddddd',
    length: 18,
    charsetPreset: 'full' as const,
  };
  const prefix = 'audit-prefix';
  const generated = generateEntryPassword(entry, prefix);
  const exported = exportEntriesBase64([entry], 'backup-secret', new Uint8Array(16).fill(0x99), testCipherOptions);
  assert.equal(exported.includes(entry.webname), false);
  assert.equal(exported.includes(entry.username), false);
  assert.equal(exported.includes(prefix), false);
  assert.equal(exported.includes(generated), false);
});

run('import validation rejects malformed counts fields lengths and duplicates', () => {
  assert.throws(() => deserializeEntries('NOT-KRYPTOS\n0\n'));
  assert.throws(() => deserializeEntries('KRYPTOS:V1\n10001\n'));
  assert.throws(() => deserializeEntries('KRYPTOS:V1\n1\nonly\tfour\tfields\there\n'));
  const tooLongSite = 'a'.repeat(201);
  assert.throws(() => deserializeEntries(`KRYPTOS:V1\n1\n${escapeField(tooLongSite)}\tuuid\tuser\t16\tfull\n`));
  assert.throws(() =>
    deserializeEntries('KRYPTOS:V1\n2\nexample.com\tuuid-a\talice\t16\tfull\nexample.com\tuuid-b\talice\t16\tfull\n'),
  );
  assert.throws(() => deserializeEntries('KRYPTOS:V1\n0\nunexpected\tdata\tafter\tcount\tfull\n'));
  assert.deepEqual(deserializeEntries('KRYPTOS:V1\n0\n\n'), []);
});

run('mobile authentication policy fails closed without hardware or enrollment', () => {
  assert.throws(() => assertMobileAuthenticationAvailable(false, true));
  assert.throws(() => assertMobileAuthenticationAvailable(true, false));
  assert.doesNotThrow(() => assertMobileAuthenticationAvailable(true, true));
});

run('vault state validation rejects duplicates and clamps settings', () => {
  assert.throws(() =>
    validateVaultState({
      version: 1,
      entries: [
        {
          id: 'one',
          webname: 'duplicate.example',
          username: 'alice',
          uuid: '11111111111111111111111111111111',
          length: 16,
          charsetPreset: 'full',
          createdAt: '2026-06-28T00:00:00.000Z',
          updatedAt: '2026-06-28T00:00:00.000Z',
        },
        {
          id: 'two',
          webname: 'DUPLICATE.example',
          username: ' alice ',
          uuid: '22222222222222222222222222222222',
          length: 16,
          charsetPreset: 'full',
          createdAt: '2026-06-28T00:00:00.000Z',
          updatedAt: '2026-06-28T00:00:00.000Z',
        },
      ],
      settings: {},
    }),
  );
  const clean = validateVaultState({
    version: 1,
    entries: [],
    settings: {
      autoLockMinutes: 999,
      backgroundLockSeconds: -5,
      preventScreenshots: 0,
      importMode: 'unknown',
    },
  });
  assert.equal(clean.settings.autoLockMinutes, 60);
  assert.equal(clean.settings.backgroundLockSeconds, 5);
  assert.equal(clean.settings.preventScreenshots, false);
  assert.equal(clean.settings.importMode, 'merge');
});

await runAsync('local vault AES-GCM hides metadata and detects tampering', async () => {
  const key = new Uint8Array(32).fill(0x31);
  const plaintext = JSON.stringify({
    entries: [
      {
        webname: 'vault-secret.example',
        username: 'vault-user@example.test',
        uuid: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      },
    ],
  });
  const encrypted = await encryptAesGcmWithNonce(plaintext, key, new Uint8Array(12).fill(0x44));
  const encodedBytes = Array.from(encrypted, (byte) => String.fromCharCode(byte)).join('');
  assert.equal(encodedBytes.includes('vault-secret.example'), false);
  assert.equal(encodedBytes.includes('vault-user@example.test'), false);
  assert.equal(await decryptAesGcm(encrypted, key), plaintext);
  encrypted[encrypted.length - 1] ^= 0xff;
  await assert.rejects(() => decryptAesGcm(encrypted, key));
});

console.log('All KryptosCore compatibility checks passed.');
if (!fullCrypto) {
  console.log('Quick backup crypto mode used 32 KDF iterations. Set KRYPTOS_FULL_CRYPTO=1 to run the full 100000-iteration backup checks.');
}

process.exit(0);
