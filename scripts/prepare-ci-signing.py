"""Create CI signing config. Secrets give stable releases; no secrets give previews."""
import base64
import os
from pathlib import Path
import secrets
import subprocess

root = Path(__file__).resolve().parent.parent
names = ('ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD')
values = [os.environ.get(name, '') for name in names]
if any(values) and not all(values):
    raise SystemExit('Configure all four Android signing secrets, or leave all four unset for preview builds.')
if os.environ.get('GITHUB_REF', '').startswith('refs/tags/') and not all(values):
    raise SystemExit('Stable releases require the four persistent Android signing secrets. Temporary preview keys cannot support upgrades.')

if all(values):
    encoded, store_password, alias, key_password = values
    (root / 'android/app/ci-signing.keystore').write_bytes(base64.b64decode(encoded, validate=True))
    mode = 'release'
else:
    store_password = key_password = secrets.token_hex(32)
    alias = 'kryptos-preview'
    # keytool reads the password from the environment, keeping it out of arguments/logs.
    signing_env = dict(os.environ, KRYPTOS_CI_SIGNING_PASSWORD=store_password)
    subprocess.run([
        'keytool', '-genkeypair', '-noprompt', '-storetype', 'PKCS12',
        '-keystore', str(root / 'android/app/ci-signing.keystore'),
        '-alias', alias, '-keyalg', 'RSA', '-keysize', '2048', '-validity', '3650',
        '-storepass:env', 'KRYPTOS_CI_SIGNING_PASSWORD', '-keypass:env', 'KRYPTOS_CI_SIGNING_PASSWORD',
        '-dname', 'CN=Kryptos Preview',
    ], env=signing_env, check=True)
    mode = 'preview'

def property_value(value):
    return ''.join('\\u%04x' % ord(ch) if ord(ch) > 126 else '\\' + ch if ch in '\\ :=#!' else
                   {'\n': '\\n', '\r': '\\r', '\t': '\\t'}.get(ch, ch) for ch in value)

properties = {
    'releaseStoreFile': 'ci-signing.keystore',
    'releaseStorePassword': store_password,
    'releaseKeyAlias': alias,
    'releaseKeyPassword': key_password,
}
(root / 'android/keystore.properties').write_text(
    ''.join(key + '=' + property_value(value) + '\n' for key, value in properties.items()), encoding='ascii')
with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
    output.write(f'mode={mode}\n')
