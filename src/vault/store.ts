import { secureClear } from '../kryptos/bytes.ts';
import {
  authenticateVault,
  clearVaultBlob,
  deleteSecureItem,
  getSecureItem,
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
  importVaultBackup,
  validateVaultState,
} from './model.ts';
import { emptyVault, type VaultEntry, type VaultState } from './types.ts';

const DATA_KEY_ID = 'kryptos:vault-data-key:v1';

export async function ensureVaultKey(): Promise<Uint8Array> {
  return getVaultKey(true);
}

async function getVaultKey(allowCreate: boolean): Promise<Uint8Array> {
  const existing = await getSecureItem(DATA_KEY_ID);
  if (existing) {
    return decodeKey(existing);
  }
  if (!allowCreate) {
    throw new Error('Vault key is unavailable. Restore from an encrypted backup or clear the local vault.');
  }
  const key = await randomBytes(32);
  await setSecureItem(DATA_KEY_ID, encodeKey(key));
  return key;
}

export async function unlockVault(): Promise<VaultState> {
  const authenticated = await authenticateVault();
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
  try {
    const encrypted = await encryptAesGcm(JSON.stringify(state), key);
    await writeVaultBlob(encrypted);
    secureClear(encrypted);
  } finally {
    secureClear(key);
  }
}

export async function resetVault(): Promise<void> {
  await clearVaultBlob();
  await deleteSecureItem(DATA_KEY_ID);
}

export async function createVaultEntry(input: {
  webname: string;
  username: string;
  length: number;
  charsetPreset: 'full' | 'alphanum';
}): Promise<VaultEntry> {
  return createVaultEntryFromUuid({ ...input, uuidBytes: await randomBytes(16) });
}

export { assertNoDuplicate, exportVaultForBackup, importVaultBackup };
