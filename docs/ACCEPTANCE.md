# Acceptance Checklist

## Verified in this workspace

- `pnpm install` completed and generated `pnpm-lock.yaml`.
- `pnpm test` passes.
- `pnpm typecheck` passes.
- `expo export --platform web --output-dir .expo\web-build-check-* --no-minify --max-workers 1` passes.
- Android debug APK generated at `dist/KryptosMobile-debug.apk` and `android/app/build/outputs/apk/debug/app-debug.apk`.
- APK metadata verifies package `com.huasushis.kryptosmobile`, version `1.0`, min SDK 24, target SDK 36, and debug signing.
- Locally self-signed release APK can be generated with `pnpm apk:release`.
- Offline tests verify deterministic generation, import/export, authenticated backup failure, duplicate handling, malformed import rejection, merge/replace import policy, UUID shape, mobile authentication policy, vault state validation, encrypted backup plaintext checks, and local vault AES-GCM plaintext/tamper checks.

## Manual Web Preview

- `pnpm web` starts a long-running development server. Open the local URL and verify:
  - unlock creates or opens the encrypted vault,
  - prefix session starts and shows a countdown,
  - entries can be added, searched, edited, deleted,
  - password show/copy works without showing stored passwords in the list,
  - encrypted export then clear/import restores entries,
  - clear vault requires a second confirmation tap,
  - wrong backup password fails without replacing current entries,
  - Web preview shows the security downgrade notice.
- Inspect the raw vault blob and confirm known test site, username, generated password, and prefix are not searchable plaintext.

## Android Hardware

- Install the generated debug APK on an Android phone.
- On Android later, verify biometric unlock, SecureStore persistence, screen-capture blocking, and background auto-lock.
- On Android later, verify missing hardware/enrollment fails closed instead of opening an existing vault.
