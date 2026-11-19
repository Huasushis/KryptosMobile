import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { decryptAesGcm, encryptAesGcmWithNonce } from '../src/vault/aesGcm.ts';
import { validateVaultState, withBackupPasswordPreference, withoutSyncSettings, savedWebDavConnection } from '../src/vault/model.ts';
import { emptyVault } from '../src/vault/types.ts';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const connection = { url: 'https://dav.example/root', directory: 'Kryptos', username: 'alice', password: 'private-login-token' };
const original = { ...emptyVault(), webdav: connection };
const remembered = withBackupPasswordPreference(original, 'private-backup-key', true);
assert.equal(original.backupPassword, undefined);
assert.equal(validateVaultState(JSON.parse(JSON.stringify(remembered))).backupPassword, 'private-backup-key');
const forgotten = withBackupPasswordPreference(remembered, '', false);
assert.equal(Object.hasOwn(forgotten, 'backupPassword'), false);
assert.equal(forgotten.webdav, connection); // Forgetting one password preserves the connection.
assert.throws(() => withBackupPasswordPreference(original, '', true));
assert.equal(savedWebDavConnection(connection, false).password, '');
assert.equal(savedWebDavConnection(connection, true).password, connection.password);
const migrated = validateVaultState(original);
assert.equal(migrated.webdav?.rememberPassword, true); // Existing encrypted login settings remain usable.
assert.equal(migrated.backupPassword, undefined); // Older vaults do not opt into backup-password storage.
assert.equal(validateVaultState({ ...remembered, webdav: { ...connection, rememberPassword: false } }).webdav?.password, '');
const cleared = withoutSyncSettings(remembered);
assert.equal(cleared.webdav, undefined);
assert.equal(cleared.backupPassword, undefined);
assert.equal(cleared.entries, original.entries);
assert.deepEqual(cleared.settings, original.settings);
// The same AES-GCM storage format encrypts remembered passwords with the vault.
const key = new Uint8Array(32).fill(3);
const nonce = new Uint8Array(12).fill(4);
const json = JSON.stringify(remembered);
const encrypted = await encryptAesGcmWithNonce(json, key, nonce);
const visible = new TextDecoder().decode(encrypted);
assert(!visible.includes('private-backup-key') && !visible.includes('private-login-token'));
assert.equal((JSON.parse(await decryptAesGcm(encrypted, key))).backupPassword, 'private-backup-key');
console.log('ok - Remembered backup/login preferences survive encrypted storage, migrate old vaults, and clear independently');
