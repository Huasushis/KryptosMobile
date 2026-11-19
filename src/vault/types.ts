import type { CharsetPreset } from '../kryptos/core.ts';
import type { WebDavConfig } from '../sync/webdav.ts';

export interface VaultEntry {
  id: string;
  webname: string;
  username: string;
  uuid: string;
  length: number;
  charsetPreset: CharsetPreset;
  createdAt: string;
  updatedAt: string;
}

export interface VaultState {
  version: 1;
  entries: VaultEntry[];
  settings: VaultSettings;
  webdav?: WebDavConfig;
}

export interface VaultSettings {
  autoLockMinutes: number;
  backgroundLockSeconds: number;
  preventScreenshots: boolean;
  importMode: 'merge' | 'replace';
  hasStoredPrefix: boolean;
  autoCheckUpdates: boolean;
}

export const defaultSettings: VaultSettings = {
  autoLockMinutes: 5,
  backgroundLockSeconds: 30,
  preventScreenshots: true,
  importMode: 'merge',
  hasStoredPrefix: false,
  autoCheckUpdates: false,
};

export function emptyVault(): VaultState {
  return {
    version: 1,
    entries: [],
    settings: { ...defaultSettings },
  };
}
