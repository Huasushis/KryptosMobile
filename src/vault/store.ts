import { secureClear } from '../kryptos/bytes.ts';
import {
  clearVaultBlob,
  deleteSecureItem,
  getSecureItem,
  isWeb,
  promptVaultAuthentication,
  randomBytes,
  readVaultBlob,
  setSecureItem,
  writeVaultBlob,
} from '../platform/runtime.ts';
import { decodeKey, decryptAesGcm, encodeKey, encryptAesGcm } from './cryptoBox.ts';
import {
  assertNoDuplicate,
  createVaultEntryFromUuid,
  exportVaultForBackup,
  exportVaultForBackupAsync,
  importVaultBackup,
  importVaultBackupAsync,
  validateVaultState,
} from './model.ts';
import { emptyVault, type VaultEntry, type VaultState } from './types.ts';
import { DATA_KEY_ID, LEGACY_WEB_DATA_KEY_ID, PREFIX_KEY_ID } from './constants.ts';

const UNAVAILABLE_KEY_MESSAGE =
  'Vault key is unavailable or system authentication was cancelled. Unlock again, or restore from backup if system authentication changed.';

export async function ensureVaultKey(): Promise<Uint8Array> {
  return getVaultKey(true);
}

async function getVaultKey(allowCreate: boolean): Promise<Uint8Array> {
  const existing = await readStoredVaultKey();
  if (existing) {
    return decodeStoredVaultKey(existing);
  }
  if (!allowCreate) {
    throw new Error(UNAVAILABLE_KEY_MESSAGE);
  }
  const key = await randomBytes(32);
  try {
    await setSecureItem(DATA_KEY_ID, encodeKey(key));
  } catch (error) {
    secureClear(key);
    throw error;
  }
  return key;
}

async function readStoredVaultKey(): Promise<string | null> {
  const existing = await getSecureItem(DATA_KEY_ID);
  if (existing || !isWeb) {
    return existing;
  }
  const legacy = await getSecureItem(LEGACY_WEB_DATA_KEY_ID);
  if (!legacy) {
    return null;
  }
  await setSecureItem(DATA_KEY_ID, legacy);
  await deleteSecureItem(LEGACY_WEB_DATA_KEY_ID);
  return legacy;
}

function decodeStoredVaultKey(value: string): Uint8Array {
  const key = decodeKey(value);
  if (key.length !== 32) {
    secureClear(key);
    throw new Error('Stored vault key is invalid. Restore from an encrypted backup or clear the local vault.');
  }
  return key;
}

export async function unlockVault(): Promise<VaultState> {
  const authenticated = await promptVaultAuthentication();
  if (!authenticated) {
    throw new Error('vault unlock was cancelled');
  }
  const blob = await readVaultBlob();
  if (!blob) {
    const state = emptyVault();
    await saveVault(state);
    return state;
  }
  const key = await getVaultKey(false);
  try {
    const json = await decryptAesGcm(blob, key);
    return validateVaultState(JSON.parse(json));
  } finally {
    secureClear(key);
  }
}

export async function saveVault(state: VaultState): Promise<void> {
  const key = await ensureVaultKey();
  let encrypted: Uint8Array | null = null;
  try {
    encrypted = await encryptAesGcm(JSON.stringify(state), key);
    await writeVaultBlob(encrypted);
  } finally {
    if (encrypted) {
      secureClear(encrypted);
    }
    secureClear(key);
  }
}

export async function resetVault(): Promise<void> {
  let blobError: unknown = null;
  try {
    await clearVaultBlob();
  } catch (error) {
    blobError = error;
  }

  try {
    await deleteSecureItem(DATA_KEY_ID);
  } catch {
    // The vault file is the sensitive metadata payload. If SecureStore cleanup
    // fails after the file is gone, the next vault can still create or reuse a
    // device key without exposing old metadata.
  }
  try {
    await deleteSecureItem(PREFIX_KEY_ID);
  } catch {
    // Prefix cleanup is best effort if the system-authenticated item was
    // already invalidated by a biometric or device credential change.
  }
  if (isWeb) {
    try {
      await deleteSecureItem(LEGACY_WEB_DATA_KEY_ID);
    } catch {
      // Legacy web migration cleanup is best effort only.
    }
  }

  if (blobError) {
    throw blobError;
  }
}

export async function saveStoredPrefix(prefix: string): Promise<void> {
  await setSecureItem(PREFIX_KEY_ID, prefix);
}

export async function readStoredPrefix(): Promise<string | null> {
  return getSecureItem(PREFIX_KEY_ID);
}

export async function clearStoredPrefix(): Promise<void> {
  await deleteSecureItem(PREFIX_KEY_ID);
}

export async function createVaultEntry(input: {
  webname: string;
  username: string;
  length: number;
  charsetPreset: 'full' | 'alphanum';
}): Promise<VaultEntry> {
  return createVaultEntryFromUuid({ ...input, uuidBytes: await randomBytes(16) });
}

export { assertNoDuplicate, exportVaultForBackup, exportVaultForBackupAsync, importVaultBackup, importVaultBackupAsync };
