#!/usr/bin/env python3
"""Install an extracted runtime bundle into a user prefix without touching provider config."""
import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import tempfile

APP_ID = 'io.github.HashimK.UsageStatBar'
ROOT = Path(__file__).resolve().parents[2]

def desktop_quote(path):
    quoted = '"' + str(path).replace('\\', '\\\\').replace('"', '\\"').replace('`', '\\`').replace('$', '\\$') + '"'
    return quoted.replace('\\', '\\\\').replace('%', '%%')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prefix', type=Path, default=Path.home() / '.local')
    parser.add_argument('--autostart', action='store_true', help='Start the tray on login (panel widgets start the service themselves)')
    parser.add_argument('--uninstall', action='store_true')
    args = parser.parse_args()
    prefix = args.prefix.expanduser().absolute()
    data = prefix / 'share'
    target = data / 'usagestat-bar'
    marker = target / '.usagestat-linux-bundle'
    if target.is_symlink() or (target.exists() and not marker.is_file()):
        parser.error(f'Refusing to replace an unrecognized installation: {target}')
    launcher = prefix / 'bin/usagestat-bar'
    desktop = data / 'applications' / f'{APP_ID}.desktop'
    service = data / 'dbus-1/services' / f'{APP_ID}.service'
    mate_service = data / 'dbus-1/services/org.mate.panel.applet.UsageStatAppletFactory.service'
    mate_applet = data / 'mate-panel/applets/io.github.HashimK.UsageStat.mate-panel-applet'
    plasma = data / 'plasma/plasmoids/io.github.HashimK.usagestat'
    cinnamon = data / 'cinnamon/applets/usagestat-bar@hashimkarim'
    autostart = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'autostart' / f'{APP_ID}.desktop'
    manifest = target / '.install-manifest.json'
    if args.uninstall:
        if not manifest.is_file():
            parser.error(f'No UsageStat installation manifest at {target}')
        owned = json.loads(manifest.read_text())
        for path in [launcher, desktop, service, mate_service, mate_applet, autostart]:
            if str(path) in owned and path.is_file() and not path.is_symlink():
                if path.read_text() == owned[str(path)]:
                    path.unlink()
                else:
                    print(f'Preserved modified file: {path}')
        for path in [plasma, cinnamon]:
            if (path / '.usagestat-linux-bundle').is_file() and not path.is_symlink():
                shutil.rmtree(path)
        shutil.rmtree(target)
        print('Removed UsageStat Bar. Provider and appearance settings were preserved.')
        return
    if not (ROOT / '.usagestat-linux-bundle').is_file():
        parser.error('Build and extract the Linux archive first, then run its platforms/linux/install.py.')
    data.mkdir(parents=True, exist_ok=True)
    # Refuse ownership collisions before any writes.
    previous = json.loads(manifest.read_text()) if manifest.is_file() else {}
    for path in [launcher, desktop, service, mate_service, mate_applet]:
        if path.is_symlink() or (path.exists() and str(path) not in previous):
            parser.error(f'An unrelated file already exists: {path}')
    for path in [plasma, cinnamon]:
        if path.is_symlink() or (path.exists() and not (path / '.usagestat-linux-bundle').is_file()):
            parser.error(f'An unrelated widget already exists: {path}')
    if args.autostart and (autostart.is_symlink() or (autostart.exists() and str(autostart) not in previous)):
        parser.error(f'An unrelated autostart entry already exists: {autostart}')
    with tempfile.TemporaryDirectory(prefix='.usagestat-install.', dir=data) as temp:
        incoming = Path(temp) / 'app'
        shutil.copytree(ROOT, incoming)
        if target.exists():
            target.rename(Path(temp) / 'previous')
        incoming.rename(target)
    files = {
        launcher: '#!/usr/bin/env bash\nexec ' + shlex.quote(str(target / 'platforms/linux/usagestat-bar')) + ' "$@"\n',
        # Keep a literal percent in a custom prefix out of GLib's executable
        # lookup; desktop field codes are expanded only after that lookup.
        desktop: f'[Desktop Entry]\nType=Application\nName=UsageStat Bar\nComment=AI provider quotas and costs\nExec=/usr/bin/env bash {desktop_quote(launcher)} tray\nIcon=office-chart-pie\nTerminal=false\nCategories=Utility;Monitor;\n',
        service: f'[D-BUS Service]\nName={APP_ID}\nExec={shlex.quote(str(launcher))} service\n',
        mate_service: '[D-BUS Service]\nName=org.mate.panel.applet.UsageStatAppletFactory\nExec=/usr/bin/python3 ' + shlex.quote(str(target / 'platforms/mate/applet.py')) + '\n',
        mate_applet: '[Applet Factory]\nId=UsageStatAppletFactory\nInProcess=false\nName=UsageStat Bar\n\n[UsageStatApplet]\nName=UsageStat Bar\nDescription=AI provider quotas and costs\nIcon=office-chart-pie\n',
    }
    if args.autostart:
        files[autostart] = files[desktop]
    elif str(autostart) in previous:
        previous = {str(autostart): previous[str(autostart)]}
    else:
        previous = {}
    for path, contents in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(contents)
    launcher.chmod(0o755)
    for name, destination in [('plasma', plasma), ('cinnamon', cinnamon)]:
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists(): shutil.rmtree(destination)
        shutil.copytree(target / 'platforms' / name, destination)
        (destination / '.usagestat-linux-bundle').write_text('1\n')
    manifest.write_text(json.dumps({**previous, **{str(path): text for path, text in files.items()}}, indent=2))
    print(f'Installed: {launcher}\nAdd {launcher.parent} to PATH before starting your panel.\nPlasma and Cinnamon: add the UsageStat Bar widget using panel settings.\nOther desktops: run usagestat-bar tray. Waybar/Polybar examples are in {target}/platforms.')

if __name__ == '__main__':
    main()
