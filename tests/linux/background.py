#!/usr/bin/env python3
"""Resolve a desktop's packaged default wallpaper for a disposable lab session."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import subprocess
from urllib.parse import unquote, urlparse


def setting(schema, key):
    return ast.literal_eval(subprocess.check_output(['gsettings', 'get', schema, key], text=True).strip())


def resolve(target):
    manifest = json.loads(Path(__file__).with_name('backgrounds.json').read_text())
    if target in manifest:
        return manifest[target]
    if target == 'gnome':
        schema, key = 'org.gnome.desktop.background', 'picture-uri'
        value = setting(schema, key)
        path = unquote(urlparse(value).path) if value.startswith('file:') else value
        source = f'{schema} / {key}'
    else:
        raise ValueError(f'No wallpaper configured for {target}')
    return {'name': f'{target} — {Path(path).name}', 'path': path, 'source': source}


def prepare(target, output):
    asset = resolve(target)
    original = Path(os.environ.get('USAGESTAT_LAB_BACKGROUND_ROOT', '/')) / asset['path'].lstrip('/')
    if not original.is_file():
        raise FileNotFoundError(f'{target} default wallpaper is missing: {original}. Rebuild the lab image.')
    digest = hashlib.sha256(original.read_bytes()).hexdigest()
    if 'sha256' in asset and asset['sha256'] != digest:
        raise ValueError(f'{target} wallpaper checksum differs from its pinned source')
    asset['sha256'] = digest
    asset['originalPath'] = str(original)
    output.mkdir(parents=True, exist_ok=True)
    # Background loaders differ between desktops. Decode these formats to PNG
    # once without changing the artwork or depending on optional loader plugins.
    display = original
    if original.suffix.lower() in ['.jxl', '.svg', '.webp']:
        cache = Path(os.environ.get('XDG_CACHE_HOME', '/tmp')) / 'usagestat-lab'
        cache.mkdir(parents=True, exist_ok=True)
        display = cache / f'wallpaper-{digest[:16]}.png'
        if not display.exists():
            subprocess.run(['magick', str(original), str(display)], check=True)
    asset['displayPath'] = str(display)
    (output / 'wallpaper.json').write_text(json.dumps(asset, indent=2) + '\n')
    return str(display)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target')
    parser.add_argument('--output', type=Path, default=Path('/out'))
    args = parser.parse_args()
    print(prepare(args.target, args.output))
