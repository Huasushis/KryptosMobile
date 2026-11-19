import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parent.parent
script = root / 'scripts/release-metadata.py'
with tempfile.TemporaryDirectory() as temp:
    apk = Path(temp) / 'test.apk'
    manifest = Path(temp) / 'update-manifest.txt'
    apk.write_bytes(b'fixture APK bytes')
    subprocess.run([sys.executable, str(script), '--version', '1.2.3', '--apk', str(apk), '--output', str(manifest)], check=True)
    fields = dict(line.split('=', 1) for line in manifest.read_text().splitlines())
    assert fields['versionCode'] == '1002003'
    assert fields['sha256'] == hashlib.sha256(apk.read_bytes()).hexdigest()
    assert fields['asset'] == 'KryptosMobile-release.apk'
    for version in ('01.2.3', '1.2.3-rc1', '../x', '0.0.0', '1000.1.1'):
        result = subprocess.run([sys.executable, str(script), '--version', version], capture_output=True)
        assert result.returncode != 0
    # Stable tag builds must fail before generating a temporary signing key.
    env = dict(os.environ, GITHUB_REF='refs/tags/v1.2.3')
    for key in ('ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'):
        env.pop(key, None)
    result = subprocess.run([sys.executable, str(root / 'scripts/prepare-ci-signing.py')], env=env, capture_output=True, text=True)
    assert result.returncode != 0 and 'persistent Android signing secrets' in result.stderr
print('Release metadata and stable signing guard verified.')
