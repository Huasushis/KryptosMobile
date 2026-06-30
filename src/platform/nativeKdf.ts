import { NativeModules, Platform } from 'react-native';

import { base64ToBytes, bytesToBase64 } from '../kryptos/bytes.ts';
import { setNativeDeriveKey } from '../kryptos/crypto.ts';

type KryptosCryptoNative = {
  pbkdf2Sha256?: (password: string, saltBase64: string, iterations: number) => Promise<string>;
};

const nativeCrypto = NativeModules.KryptosCrypto as KryptosCryptoNative | undefined;
const nativePbkdf2Sha256 = nativeCrypto?.pbkdf2Sha256;

if (Platform.OS === 'android' && typeof nativePbkdf2Sha256 === 'function') {
  setNativeDeriveKey(async (password, salt, iterations) => {
    if (typeof password !== 'string') {
      return null;
    }
    const keyBase64 = await nativePbkdf2Sha256(password, bytesToBase64(salt), iterations);
    const key = base64ToBytes(keyBase64);
    if (key.length !== 32) {
      throw new Error('native PBKDF2 returned an invalid key length');
    }
    return key;
  });
}
