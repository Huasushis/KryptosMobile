const RELEASES = 'https://github.com/Huasushis/KryptosMobile/releases/';
export const RELEASE_PAGE = `${RELEASES}latest`;
export interface AppUpdate { version: string; versionCode: number; sha256: string; url: string }
export function parseUpdateManifest(text: string): AppUpdate {
  if (text.length > 16_384) throw new Error('Update manifest is too large.');
  const fields = new Map<string, string>();
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const split = line.indexOf('=');
    const key = line.slice(0, split);
    if (split < 1 || fields.has(key)) throw new Error('Invalid update manifest.');
    fields.set(key, line.slice(split + 1));
  }
  const version = fields.get('version') ?? '';
  const code = fields.get('versionCode') ?? '';
  const sha256 = fields.get('sha256') ?? '';
  if (fields.get('format') !== '1' || !/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(version) ||
      !/^[1-9][0-9]{0,9}$/.test(code) || Number(code) > 2_100_000_000 ||
      fields.get('package') !== 'com.huasushis.kryptosmobile' || fields.get('asset') !== 'KryptosMobile-release.apk' ||
      !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Unsupported or incomplete release metadata.');
  const [major, minor, patch] = version.split('.').map(Number);
  if (Number(code) !== major * 1_000_000 + minor * 1_000 + patch) throw new Error('Release version does not match its version code.');
  return { version, versionCode: Number(code), sha256, url: `${RELEASES}download/v${version}/KryptosMobile-release.apk` };
}
