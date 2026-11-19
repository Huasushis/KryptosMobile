"""Stable Android versions and the update manifest consumed by the app."""
import argparse
import hashlib
import re
from pathlib import Path


def version_code(version):
    if not re.fullmatch(r'[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}', version):
        raise ValueError('Stable tags must be vMAJOR.MINOR.PATCH (each component <=999).')
    major, minor, patch = map(int, version.split('.'))
    if version != f'{major}.{minor}.{patch}':
        raise ValueError('Version components cannot contain leading zeros.')
    code = major * 1000000 + minor * 1000 + patch
    if not 0 < code <= 2100000000:
        raise ValueError('Invalid Android version code.')
    return code


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', required=True)
    parser.add_argument('--apk', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    code = version_code(args.version)
    if args.apk:
        if not args.output:
            parser.error('--output required with --apk')
        sha = hashlib.sha256(args.apk.read_bytes()).hexdigest()
        args.output.write_text(f'format=1\nversion={args.version}\nversionCode={code}\n'
                               'package=com.huasushis.kryptosmobile\nasset=KryptosMobile-release.apk\n'
                               f'sha256={sha}\n', encoding='utf-8')
    else:
        print(code)
