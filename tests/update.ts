import assert from 'node:assert/strict';
import { parseUpdateManifest } from '../src/update/release.ts';
const manifest = `format=1\nversion=1.2.3\nversionCode=1002003\npackage=com.huasushis.kryptosmobile\nasset=KryptosMobile-release.apk\nsha256=${'a'.repeat(64)}\n`;
const update = parseUpdateManifest(manifest);
assert.equal(update.url, 'https://github.com/Huasushis/KryptosMobile/releases/download/v1.2.3/KryptosMobile-release.apk');
assert.equal(update.versionCode, 1002003);
for (const invalid of [
  manifest + 'version=9.9.9\n',
  manifest.replace('1.2.3', '../bad'),
  manifest.replace('1002003', '1'),
  manifest.replace('1002003', '9999999999'),
  manifest.replace('com.huasushis.kryptosmobile', 'other.package'),
  manifest.replace('KryptosMobile-release.apk', '../bad.apk'),
  manifest.replace('a'.repeat(64), 'bad'),
  manifest.replace('format=1', 'format=2'),
  manifest.replace('1.2.3', '1.2.3-rc1'),
  'x'.repeat(16385),
]) assert.throws(() => parseUpdateManifest(invalid));
console.log('ok - Updates validate version, package, size and checksum; asset URL is pinned to the stable tag');
