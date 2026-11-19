import { bytesToHex } from '../kryptos/bytes.ts';
import {
  exportEntriesBase64,
  exportEntriesBase64Async,
  importEntriesBase64,
  importEntriesBase64Async,
  mergeEntries,
  normalizedIdentityKey,
  validateEntry,
  type AccountEntry,
} from '../kryptos/manager.ts';
import type { KryptosCipherOptions } from '../kryptos/crypto.ts';
import { defaultSettings, emptyVault, type VaultEntry, type VaultSettings, type VaultState } from './types.ts';

export function vaultEntryToAccountEntry(entry: VaultEntry): AccountEntry {
  return {
    webname: entry.webname,
    uuid: entry.uuid,
    username: entry.username,
    length: entry.length,
    charsetPreset: entry.charsetPreset,
  };
}

export function accountEntryToVaultEntry(entry: AccountEntry): VaultEntry {
  const now = new Date().toISOString();
  return {
    id: `${entry.webname}:${entry.username}:${entry.uuid}`,
    webname: entry.webname,
    username: entry.username,
    uuid: entry.uuid,
    length: entry.length,
    charsetPreset: entry.charsetPreset,
    createdAt: now,
    updatedAt: now,
  };
}

export function identityKey(entry: Pick<VaultEntry, 'webname' | 'username'>): string {
  return normalizedIdentityKey(entry);
}

// Apply the selected account data even when it has the same identity as a local
// entry. Reusing the entire old VaultEntry would silently discard cloud choices.
export function syncAccountsToVaultEntries(accounts: readonly AccountEntry[], current: readonly VaultEntry[]): VaultEntry[] {
  const existing = new Map(current.map((entry) => [identityKey(entry), entry]));
  return accounts.map((account) => {
    const previous = existing.get(identityKey(account));
    if (!previous) return accountEntryToVaultEntry(account);
    const unchanged = previous.webname === account.webname && previous.username === account.username &&
      previous.uuid === account.uuid && previous.length === account.length && previous.charsetPreset === account.charsetPreset;
    return unchanged ? previous : {
      ...previous, ...account, updatedAt: new Date().toISOString(),
    };
  });
}

export function validateVaultState(value: unknown): VaultState {
  const fallback = emptyVault();
  if (!value || typeof value !== 'object') {
    return fallback;
  }
  const candidate = value as Partial<VaultState>;
  const entries = Array.isArray(candidate.entries) ? candidate.entries : [];
  const cleanEntries: VaultEntry[] = entries.map((entry) => {
    const raw = entry as Partial<VaultEntry>;
    const clean: VaultEntry = {
      id: String(raw.id ?? ''),
      webname: String(raw.webname ?? ''),
      username: String(raw.username ?? ''),
      uuid: String(raw.uuid ?? ''),
      length: Number(raw.length ?? 16),
      charsetPreset: raw.charsetPreset === 'alphanum' ? 'alphanum' : 'full',
      createdAt: String(raw.createdAt ?? new Date().toISOString()),
      updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
    };
    validateEntry(clean);
    return clean;
  });
  const seen = new Set<string>();
  for (const entry of cleanEntries) {
    const key = identityKey(entry);
    if (seen.has(key)) {
      throw new Error('duplicate entry in vault data');
    }
    seen.add(key);
  }
  const rawSettings = { ...defaultSettings, ...(candidate.settings ?? {}) } as VaultSettings;
  const settings: VaultSettings = {
    autoLockMinutes: Math.max(1, Math.min(60, Number(rawSettings.autoLockMinutes) || defaultSettings.autoLockMinutes)),
    backgroundLockSeconds: Math.max(
      5,
      Math.min(30, Number(rawSettings.backgroundLockSeconds) || defaultSettings.backgroundLockSeconds),
    ),
    preventScreenshots: Boolean(rawSettings.preventScreenshots),
    importMode: rawSettings.importMode === 'replace' ? 'replace' : 'merge',
    hasStoredPrefix: Boolean(rawSettings.hasStoredPrefix),
    autoCheckUpdates: rawSettings.autoCheckUpdates === true,
  };
  return {
    version: 1,
    entries: cleanEntries,
    settings,
    ...(candidate.webdav ? { webdav: {
      url: String(candidate.webdav.url ?? ''),
      directory: String(candidate.webdav.directory ?? 'Kryptos'),
      username: String(candidate.webdav.username ?? ''),
      password: String(candidate.webdav.password ?? ''),
    } } : {}),
  };
}

export function createVaultEntryFromUuid(input: {
  webname: string;
  username: string;
  length: number;
  charsetPreset: 'full' | 'alphanum';
  uuidBytes: Uint8Array;
}): VaultEntry {
  if (input.uuidBytes.length !== 16) {
    throw new Error('uuid must be 16 random bytes');
  }
  const uuid = bytesToHex(input.uuidBytes);
  const now = new Date().toISOString();
  const entry: VaultEntry = {
    id: `${input.webname.trim()}:${input.username.trim()}:${uuid}`,
    webname: input.webname.trim(),
    username: input.username.trim(),
    uuid,
    length: input.length,
    charsetPreset: input.charsetPreset,
    createdAt: now,
    updatedAt: now,
  };
  validateEntry(entry);
  return entry;
}

export function assertNoDuplicate(entries: readonly VaultEntry[], candidate: VaultEntry, ignoreId?: string): void {
  const candidateKey = identityKey(candidate);
  const duplicate = entries.find(
    (entry) =>
      entry.id !== ignoreId &&
      identityKey(entry) === candidateKey,
  );
  if (duplicate) {
    throw new Error('An entry for this site and username already exists.');
  }
}

export function exportVaultForBackup(
  entries: readonly VaultEntry[],
  backupPassword: string,
  nonce: Uint8Array,
  options: KryptosCipherOptions = {},
): string {
  if (backupPassword.length === 0) {
    throw new Error('Backup password is required for encrypted backup.');
  }
  return exportEntriesBase64(entries.map(vaultEntryToAccountEntry), backupPassword, nonce, options);
}

export async function exportVaultForBackupAsync(
  entries: readonly VaultEntry[],
  backupPassword: string,
  nonce: Uint8Array,
  options: KryptosCipherOptions = {},
): Promise<string> {
  if (backupPassword.length === 0) {
    throw new Error('Backup password is required for encrypted backup.');
  }
  return exportEntriesBase64Async(entries.map(vaultEntryToAccountEntry), backupPassword, nonce, options);
}

export function importVaultBackup(
  base64: string,
  backupPassword: string,
  current: readonly VaultEntry[],
  mode: 'merge' | 'replace',
  options: KryptosCipherOptions = {},
): VaultEntry[] {
  if (backupPassword.length === 0) {
    throw new Error('Backup password is required for encrypted backup.');
  }
  const incomingAccounts = importEntriesBase64(base64, backupPassword, options);
  if (mode === 'replace') {
    return incomingAccounts.map(accountEntryToVaultEntry);
  }
  const currentAccounts = current.map(vaultEntryToAccountEntry);
  const resultAccounts = mergeEntries(currentAccounts, incomingAccounts);
  return resultAccounts.map((entry) => {
    const existing = current.find(
      (currentEntry) =>
        identityKey(currentEntry) === identityKey(entry),
    );
    return existing ?? accountEntryToVaultEntry(entry);
  });
}

export async function importVaultBackupAsync(
  base64: string,
  backupPassword: string,
  current: readonly VaultEntry[],
  mode: 'merge' | 'replace',
  options: KryptosCipherOptions = {},
): Promise<VaultEntry[]> {
  if (backupPassword.length === 0) {
    throw new Error('Backup password is required for encrypted backup.');
  }
  const incomingAccounts = await importEntriesBase64Async(base64, backupPassword, options);
  if (mode === 'replace') {
    return incomingAccounts.map(accountEntryToVaultEntry);
  }
  const currentAccounts = current.map(vaultEntryToAccountEntry);
  const resultAccounts = mergeEntries(currentAccounts, incomingAccounts);
  return resultAccounts.map((entry) => {
    const existing = current.find(
      (currentEntry) =>
        identityKey(currentEntry) === identityKey(entry),
    );
    return existing ?? accountEntryToVaultEntry(entry);
  });
}
