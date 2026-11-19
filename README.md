# Kryptos Mobile

Kryptos Mobile is an Expo + React Native client for KryptosCore. It stores only account metadata and regenerates passwords deterministically from a master prefix at use time.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm web
```

The web preview supports the full UI and KryptosCore compatibility tests. SecureStore, biometric unlock, and screen capture protection are native mobile capabilities and use safe web fallbacks.

This project targets Expo SDK 54, React Native 0.81.5, React 19.1.0, and Node.js 22.13+.

`pnpm web` starts a development server and keeps running until stopped. For a one-shot Web build check, use a fresh ignored output directory:

```bash
$env:EXPO_NO_TELEMETRY='1'
.\node_modules\.bin\expo.cmd export --platform web --output-dir .expo\web-build-check --no-minify --max-workers 1
```

The source and KryptosCore compatibility tests can also run directly:

```bash
node --experimental-strip-types tests/run.ts
```

The KryptosCore/vault test runner uses a fast KDF setting for backup encryption tests by default so the check finishes quickly:

```bash
node --experimental-strip-types tests/run.ts
```

Run the full 100000-iteration KryptosCore backup encryption checks when you want the slower audit path:

```bash
$env:KRYPTOS_FULL_CRYPTO='1'
node --experimental-strip-types tests/run.ts
```

## Android APK

GitHub Actions now builds standalone APKs automatically on push, or manually from
**Actions → Android APK**. Download the APK from the run's Artifacts. Builds need
no signing secrets for previews; configure the four Android signing secrets for
stable release signing. See [WebDAV and APK setup](docs/WEBDAV.md).

This workspace can build a debug APK locally on Windows:

```bash
pnpm apk:debug
```

This workspace can also build a locally self-signed release APK:

```bash
pnpm apk:release
```

The helper scripts use the local JDK 17 under `.jdk17`, the Android SDK at `E:\Android\Sdk`, and E-drive cache/temp folders. They also map a temporary short drive while building to avoid Windows path-length issues in native Expo modules.

Generated APKs:

- `android/app/build/outputs/apk/debug/app-debug.apk`
- `dist/KryptosMobile-debug.apk`
- `android/app/build/outputs/apk/release/app-release.apk`
- `dist/KryptosMobile-release.apk`

Release signing material is generated locally at `android/app/kryptos-release.keystore` with ignored signing properties in `android/keystore.properties`. Keep both files if you want future release builds to be installable as updates over this release.

## Security Model

- Passwords are never written to storage.
- The master prefix is never written to storage.
- Vault metadata is encrypted at rest with a device data key.
- Mobile unlock requires enrolled system authentication; Web preview is explicitly marked as degraded.
- UI state is updated after vault writes succeed, so failed writes do not pretend to be saved.
- Export files are encrypted with a separate backup password.
- Manual WebDAV sync uploads only encrypted KryptosCore-compatible metadata.
- WebDAV settings are stored inside the encrypted local vault; the sync backup password is never stored.
- No analytics SDK or remote logging is included.

## Implemented Screens

- Unlock: creates or opens the encrypted local vault after system authentication.
- Prefix session: stores the master prefix encrypted in memory only and shows the session countdown.
- Home: searchable metadata list with add, backup, settings, prefix, and lock actions.
- Entry detail: generate/show/copy password without listing stored passwords.
- Edit: site, username, length, and `full`/`alphanum` charset controls with duplicate blocking.
- Backup: KryptosCore-compatible encrypted Base64 import/export with merge/replace policy, plus WebDAV sync with automatic directory creation, per-account local/cloud conflict choices, and conditional uploads.
- Settings: auto-lock, background-lock, screenshot blocking, import mode, and two-step vault clear.

## Current Verification

- `pnpm-lock.yaml` is present and dependencies are installed with pnpm.
- `pnpm test` passes.
- `pnpm typecheck` passes.
- Expo Web export passes with `--max-workers 1` into an ignored `.expo\web-build-check-*` directory.
- Android debug APK builds successfully; the verified package name is `com.huasushis.kryptosmobile`, min SDK is 24, and target SDK is 36.
- Offline tests cover SHA-256, deterministic stream, seed construction, password generation, HMAC, PBKDF2, Base64 import/export, backup tamper detection, duplicate merge behavior, UUID metadata shape, wrong-password failure, merge/replace behavior, malformed import rejection, mobile authentication policy, vault state validation, plaintext exposure checks for backup payloads, and local vault AES-GCM ciphertext/tamper checks.
- Manual runtime checks still needed on Android hardware: SecureStore behavior, biometric unlock, screen capture blocking, and background auto-lock.
