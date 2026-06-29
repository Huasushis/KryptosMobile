export function assertMobileAuthenticationAvailable(hasHardware: boolean, isEnrolled: boolean): void {
  if (!hasHardware) {
    throw new Error('System authentication hardware is required to unlock the vault on mobile.');
  }
  if (!isEnrolled) {
    throw new Error('Set up biometric or device authentication before unlocking the vault.');
  }
}
