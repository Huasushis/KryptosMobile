# Security Audit Notes

## KryptosCore Compatibility

- `src/kryptos/core.ts` preserves SHA-256 raw/hex behavior, big-endian counters, `uint32` rejection sampling, Fisher-Yates shuffle order, exact charset ordering, and null-byte seed delimiters.
- `src/kryptos/manager.ts` preserves the `KRYPTOS:V1` text format and Base64 export/import behavior.
- `pnpm test` runs the local KryptosCore compatibility vectors. The offline runner can also be invoked without Expo dependencies through `node --experimental-strip-types tests/run.ts`.
- Upstream C++ reference vectors should be rechecked against `Huasushis/KryptosCore` before release if new official vectors are published.

## Secrets and Storage

- Passwords are generated on demand and are never written to vault storage.
- The master prefix is encrypted in memory for the active session and is never saved to SecureStore, files, backups, logs, or component state after session start.
- Full lock clears prefix session state, selected entry state, backup text/password fields, search text, generated password state, and the in-memory vault copy.
- Foreground user activity refreshes the prefix session timeout; manual lock, timeout, and background lock clear the session.
- Clearing the local vault requires a second confirmation tap in the settings screen.
- Vault mutations update React state only after encrypted storage writes succeed; failed writes surface an error message and keep the prior in-memory state.
- Local vault metadata is encrypted before writing to disk. The device data key is stored through SecureStore on native platforms.
- Local vault encryption uses AES-256-GCM with a 32-byte data key and 12-byte random nonce; the nonce is prepended to ciphertext.
- Mobile unlock requires enrolled system authentication; missing hardware or missing enrollment fails closed. Web preview is the only intentional downgrade path.
- Android automatic backup for SecureStore is disabled in Expo config; encrypted user backups are handled explicitly through the Kryptos backup flow.
- If SecureStore cannot release the data key while a vault blob exists, the app fails closed and asks the user to restore from backup or clear the local vault.
- Web preview uses browser storage and cannot provide the same security boundary as Android/iOS.

## Randomness

- New entry UUIDs are 128-bit values from `expo-crypto` random bytes.
- Vault AES-GCM keys are 256-bit values from `expo-crypto` random bytes.
- Vault AES-GCM nonces are 96-bit values from `expo-crypto` random bytes.
- Export encryption nonces follow KryptosCore's 16-byte nonce requirement.
- The codebase does not use `Math.random`.

## Import / Export

- Encrypted backups use KryptosCore-compatible Base64 with authenticated encryption.
- Wrong backup passwords fail before mutation because import parsing happens before vault replacement.
- Merge mode skips duplicates; replace mode replaces the local metadata list.
- Backup export requires a separate password of at least 8 characters.
- Backup operations clear temporary password fields unless the user opted to remember the backup password. Leaving the screen and locking clear visible password fields; remembered values remain only inside the encrypted vault.
- Import parsing rejects invalid headers, invalid counts, malformed field counts, overly long fields, unsupported lengths, duplicate site/username pairs, and non-empty trailing data after the declared entry count.
- Loaded vault state is validated and rejects duplicate site/username entries while clamping settings to supported ranges.

## WebDAV synchronization

- Manual sync reuses authenticated encrypted backup payloads; only account metadata is uploaded.
- WebDAV login and backup encryption passwords have separate remember controls. Saved values stay inside the encrypted local vault, are excluded from remote exports, and are removed by clearing saved settings. Locking clears UI state. WebDAV sync is manual.
- Conditional PUT with strong ETags prevents silent overwrites. Conflicts require explicit local/cloud choices for each account before upload; cancelled review or locking aborts without applying choices. Choices are tied to the downloaded snapshot and cannot override a newer ETag.
- Android uses a native OkHttp transport with redirects disabled, TLS verification, cancellation, a 30-second timeout and bounded responses.
- Android INTERNET permission is now enabled. Prefer HTTPS; explicitly configured HTTP endpoints send WebDAV credentials over plaintext transport.
- Web preview requires provider CORS support and exposed ETag headers. See [setup and limitations](WEBDAV.md).

## Existing platform limits

- JavaScript strings cannot be reliably zeroed after decryption. Decrypted prefix/password values are scoped tightly and not persisted.
- Web preview cannot enforce biometric unlock or screen-capture blocking.
- Expo Crypto AES-GCM support is required on native platforms; WebCrypto is a preview fallback.
- Native Expo dependency APIs pass TypeScript compilation; Android hardware behavior still needs device verification before release.
- The debug APK is signed with the Android debug key for local installation/testing only.
- The release APK is locally self-signed with `android/app/kryptos-release.keystore`; keep the keystore and ignored `android/keystore.properties` private and backed up if you want update compatibility for future releases.
