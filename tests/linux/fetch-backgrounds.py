#!/usr/bin/env python3
"""Install checksum-pinned preview wallpapers while building the lab image."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import tarfile
from urllib.request import urlopen


def verify(data, expected, label):
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError(f'{label}: downloaded content differs from the pinned checksum')


def install(asset, root):
    destination = root / asset['path'].lstrip('/')
    if destination.is_file() and hashlib.sha256(destination.read_bytes()).hexdigest() == asset['sha256']:
        return
    with urlopen(asset['url'], timeout=60) as response:
        data = response.read()
    if 'archiveMember' in asset:
        verify(data, asset['archiveSha256'], asset['url'])
        # Read only the named regular file. Never extract archive paths/links.
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            member = archive.getmember(asset['archiveMember'])
            if not member.isfile():
                raise ValueError('Wallpaper archive member is not a regular file')
            data = archive.extractfile(member).read()
    verify(data, asset['sha256'], asset['name'])
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    destination.chmod(0o644)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=Path(__file__).with_name('backgrounds.json'))
    parser.add_argument('--root', type=Path, default=Path('/'))
    parser.add_argument('--target', default='all')
    args = parser.parse_args()
    for target, asset in json.loads(args.manifest.read_text()).items():
        if args.target in ['all', target]:
            install(asset, args.root)
            print(f'{target}: {asset["name"]}', flush=True)
