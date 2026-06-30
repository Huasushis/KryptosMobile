export const MIN_DEVICE_AUTH_SECURITY_LEVEL = 1;

export function assertMobileAuthenticationAvailable(securityLevel: number): void {
  if (securityLevel < MIN_DEVICE_AUTH_SECURITY_LEVEL) {
    throw new Error('Set up a device lock, fingerprint, or face unlock before using the vault on mobile.');
  }
}
