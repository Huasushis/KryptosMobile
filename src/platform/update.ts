import { NativeModules, Platform } from 'react-native';
import { parseUpdateManifest, type AppUpdate } from '../update/release.ts';
const native = NativeModules.KryptosUpdate as {
  version: string; versionCode: number;
  manifest(): Promise<string>;
  install(url: string, sha256: string, versionCode: number): Promise<'installer' | 'permission'>;
} | undefined;
export const installedVersion = native?.version ?? '1.1.0';
export const installedVersionCode = native?.versionCode ?? 0;
export const canInstallUpdates = Platform.OS === 'android' && Boolean(native);
export async function checkForAppUpdate(): Promise<AppUpdate | null> {
  if (!native || Platform.OS !== 'android') throw new Error('In-app updates are available in the Android app.');
  const update = parseUpdateManifest(await native.manifest());
  return update.versionCode > installedVersionCode ? update : null;
}
export async function installAppUpdate(update: AppUpdate): Promise<'installer' | 'permission'> {
  if (!native) throw new Error('Rebuild Android to enable updates.');
  return native.install(update.url, update.sha256, update.versionCode);
}
