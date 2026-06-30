import { Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as LocalAuthentication from 'expo-local-authentication';
import * as ScreenCapture from 'expo-screen-capture';
import * as SecureStore from 'expo-secure-store';

import { base64ToBytes, bytesToBase64 } from '../kryptos/bytes.ts';
import { assertMobileAuthenticationAvailable } from './authPolicy.ts';

const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const isWeb = Platform.OS === 'web';

function webStorage(): Storage | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window.localStorage;
}

export async function randomBytes(length: number): Promise<Uint8Array> {
  const bytes = await Crypto.getRandomBytesAsync(length);
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

export async function getSecureItem(key: string): Promise<string | null> {
  if (isWeb) {
    return webStorage()?.getItem(`secure:${key}`) ?? null;
  }
  return SecureStore.getItemAsync(key, secureStoreOptions);
}

export async function setSecureItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    webStorage()?.setItem(`secure:${key}`, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, secureStoreOptions);
}

export async function deleteSecureItem(key: string): Promise<void> {
  if (isWeb) {
    webStorage()?.removeItem(`secure:${key}`);
    return;
  }
  await SecureStore.deleteItemAsync(key, secureStoreOptions);
}

export async function assertVaultAuthenticationAvailable(): Promise<void> {
  if (isWeb) {
    return;
  }
  const securityLevel = await LocalAuthentication.getEnrolledLevelAsync();
  assertMobileAuthenticationAvailable(securityLevel);
}

export async function promptVaultAuthentication(): Promise<boolean> {
  if (isWeb) {
    return true;
  }
  await assertVaultAuthenticationAvailable();
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock Kryptos Mobile',
    promptDescription: 'Confirm this action with your device security.',
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
    biometricsSecurityLevel: 'weak',
  });
  return result.success;
}

export async function authenticateVault(): Promise<boolean> {
  return promptVaultAuthentication();
}

export async function readVaultBlob(): Promise<Uint8Array | null> {
  if (isWeb) {
    const stored = webStorage()?.getItem('vault:ciphertext');
    return stored ? base64ToBytes(stored) : null;
  }
  const path = `${FileSystem.documentDirectory ?? ''}kryptos-vault.bin`;
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    return null;
  }
  const base64 = await FileSystem.readAsStringAsync(path, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return base64ToBytes(base64);
}

export async function writeVaultBlob(bytes: Uint8Array): Promise<void> {
  if (isWeb) {
    webStorage()?.setItem('vault:ciphertext', bytesToBase64(bytes));
    return;
  }
  const path = `${FileSystem.documentDirectory ?? ''}kryptos-vault.bin`;
  await FileSystem.writeAsStringAsync(path, bytesToBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
}

export async function clearVaultBlob(): Promise<void> {
  if (isWeb) {
    webStorage()?.removeItem('vault:ciphertext');
    return;
  }
  const path = `${FileSystem.documentDirectory ?? ''}kryptos-vault.bin`;
  const info = await FileSystem.getInfoAsync(path);
  if (info.exists) {
    await FileSystem.deleteAsync(path, { idempotent: true });
  }
}

export async function copyToClipboard(value: string): Promise<void> {
  await Clipboard.setStringAsync(value);
}

export async function readClipboardText(): Promise<string> {
  return Clipboard.getStringAsync();
}

export async function clearClipboardIfUnchanged(value: string): Promise<void> {
  try {
    const current = await Clipboard.getStringAsync();
    if (current === value) {
      await Clipboard.setStringAsync('');
    }
  } catch {
    // Clipboard clearing is best effort because platforms differ.
  }
}

export async function preventSensitiveScreenCapture(enabled: boolean): Promise<void> {
  if (isWeb) {
    return;
  }
  if (enabled) {
    await ScreenCapture.preventScreenCaptureAsync();
  } else {
    await ScreenCapture.allowScreenCaptureAsync();
  }
}

export function webSecurityNotice(): string | null {
  if (!isWeb) {
    return null;
  }
  return 'Web preview uses browser storage and cannot enforce SecureStore, biometric unlock, or screen capture blocking.';
}
