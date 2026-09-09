#!/usr/bin/env python3
"""Runtime-only Linux bundle. GNOME keeps its separate extension archive."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ['main.js', 'client.js', 'model.js', 'render.js', 'protocol.js', 'settings.js', 'tray.js', 'trayPreferences.js', 'shortcuts.js', 'desktop.js', 'cosmic.js', 'panelWindow.js', 'x11Panel.py', 'waybarPreferences.js', 'waybar_config.py', 'ui.js', 'usagestat-bar', 'install.py']

def stage(target):
    for name in ['cli.js', 'config.js', 'preferences.js', 'providerMetadata.js', 'LICENSE']:
        shutil.copy2(ROOT / name, target / name)
    shutil.copytree(ROOT / 'assets', target / 'assets', ignore=shutil.ignore_patterns('.fuse_hidden*'))
    runtime = target / 'platforms/linux'
    runtime.mkdir(parents=True)
    for name in RUNTIME:
        shutil.copy2(ROOT / 'platforms/linux' / name, runtime / name)
    (runtime / 'usagestat-bar').chmod(0o755)
    for desktop in ['plasma', 'cinnamon', 'mate', 'waybar', 'polybar', 'gtk-panel', 'xfce']:
        shutil.copytree(ROOT / 'platforms' / desktop, target / 'platforms' / desktop)
    schemas = runtime / 'schemas'
    schemas.mkdir()
    xml = (ROOT / 'schemas/org.gnome.shell.extensions.usagestat-bar.gschema.xml').read_text()
    xml = xml.replace('org.gnome.shell.extensions.usagestat-bar', 'io.github.HashimK.UsageStatBar').replace('/org/gnome/shell/extensions/usagestat-bar/', '/io/github/HashimK/UsageStatBar/')
    (schemas / 'io.github.HashimK.UsageStatBar.gschema.xml').write_text(xml)
    shutil.copy2(ROOT / 'platforms/linux/tray.gschema.xml', schemas / 'io.github.HashimK.UsageStatBar.Tray.gschema.xml')
    compiler = '/usr/bin/glib-compile-schemas' if Path('/usr/bin/glib-compile-schemas').exists() else 'glib-compile-schemas'
    subprocess.run([compiler, '--strict', str(schemas)], check=True)
    (target / '.usagestat-linux-bundle').write_text('1\n')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['build', 'stage'])
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if args.command == 'stage':
        args.output.mkdir(parents=True, exist_ok=True)
        stage(args.output)
        return
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='usagestat-linux-package.') as temp:
        target = Path(temp) / 'usagestat-bar'
        target.mkdir()
        stage(target)
        with tarfile.open(args.output, 'w:gz') as archive:
            archive.add(target, arcname='usagestat-bar')
    print(f'Built: {args.output.resolve()}')

if __name__ == '__main__':
    main()
