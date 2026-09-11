#!/usr/bin/env python3
"""Install an extracted runtime bundle into a user prefix without touching provider config."""
import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import tempfile
import subprocess
import time

def stop_running(target, launcher):
    """Only stop the service executing from this installation, never another prefix."""
    if not os.environ.get('DBUS_SESSION_BUS_ADDRESS') or not shutil.which('gdbus'):
        return None
    result = subprocess.run(['gdbus', 'call', '--session', '--dest', 'org.freedesktop.DBus',
        '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.GetConnectionUnixProcessID',
        APP_ID], capture_output=True, text=True)
    if result.returncode: return None
    import re
    match = re.search(r'uint32 (\d+)', result.stdout)
    if not match: return None
    process = Path('/proc') / match[1]
    try: argv = (process / 'cmdline').read_bytes().split(b'\0')
    except FileNotFoundError: return None
    if os.fsencode(target / 'platforms/linux/main.js') not in argv: return None
    state = json.loads(subprocess.check_output([str(launcher), 'snapshot'], text=True, timeout=10))
    subprocess.run([str(launcher), 'quit'], check=True, timeout=10)
    deadline = time.monotonic() + 5
    def alive():
        try: return (process / 'stat').read_text().split(') ', 1)[1][0] != 'Z'
        except FileNotFoundError: return False
    while alive() and time.monotonic() < deadline:
        time.sleep(.05)
    if alive(): raise RuntimeError('The running UsageStat service did not stop; installation was preserved.')
    return 'tray' if state.get('trayEnabled') else 'service'

APP_ID = 'io.github.HashimK.UsageStatBar'
ROOT = Path(__file__).resolve().parents[2]

def desktop_quote(path):
    quoted = '"' + str(path).replace('\\', '\\\\').replace('"', '\\"').replace('`', '\\`').replace('$', '\\$') + '"'
    return quoted.replace('\\', '\\\\').replace('%', '%%')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prefix', type=Path, default=Path.home() / '.local')
    parser.add_argument('--autostart', action='store_true', help='Start the tray on login (panel widgets start the service themselves)')
    parser.add_argument('--native', choices=['waybar', 'xfce', 'budgie', 'lxqt', 'cosmic', 'polybar'], action='append', default=[], help='Install a native panel adapter (compiled adapters require development packages)')
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
    install_options = target / '.install-options.json'
    native = sorted(set(args.native + (json.loads(install_options.read_text()).get('native', []) if install_options.is_file() else [])))
    xfce_desktop = data / 'xfce4/panel/plugins/usagestat.desktop'
    # Match the running distro's panel library prefix (lib64 or Debian multiarch).
    lib_suffix = 'lib'
    if 'xfce' in native and not args.uninstall:
        libdir = subprocess.check_output(['pkg-config', '--variable=libdir', 'libxfce4panel-2.0'], text=True).strip()
        lib_suffix = libdir.removeprefix('/usr/local/').removeprefix('/usr/')
        if Path(lib_suffix).is_absolute() or '..' in Path(lib_suffix).parts: parser.error('Unrecognized panel library directory')
    xfce_library = prefix / lib_suffix / 'xfce4/panel/plugins/libusagestat.so'
    # Both desktops support user plugins; LXQt uses LXQTPANEL_PLUGIN_PATH.
    budgie_plugin = data / 'budgie-desktop/plugins/usagestat.plugin'
    budgie_library = data / 'budgie-desktop/plugins/libusagestat.so'
    lxqt_desktop = data / 'lxqt/lxqt-panel/usagestat.desktop'
    lxqt_launcher = prefix / 'bin/usagestat-lxqt-panel'
    cosmic_desktop = data / 'applications/io.github.HashimK.UsageStatApplet.desktop'
    polybar_launcher = prefix / 'bin/usagestat-polybar'
    native_files = ([budgie_plugin] if 'budgie' in native else []) + ([lxqt_desktop, lxqt_launcher] if 'lxqt' in native else []) \
        + ([cosmic_desktop] if 'cosmic' in native else []) + ([polybar_launcher] if 'polybar' in native else [])
    icon_font = data / 'fonts/UsageStatProviderIcons.ttf'
    font_link = {'symlink': str(target / 'platforms/polybar/UsageStatProviderIcons.ttf')}
    if args.uninstall:
        if not manifest.is_file():
            parser.error(f'No UsageStat installation manifest at {target}')
        owned = json.loads(manifest.read_text())
        stop_running(target, launcher)
        for name, contents in owned.items():
            path = Path(name)
            if isinstance(contents, dict) and 'symlink' in contents:
                if path.is_symlink() and os.readlink(path) == contents['symlink']: path.unlink()
            elif path.is_file() and not path.is_symlink():
                if path.read_text() == contents:
                    path.unlink()
                else:
                    print(f'Preserved modified file: {path}')
        for path in [plasma, cinnamon]:
            if (path / '.usagestat-linux-bundle').is_file() and not path.is_symlink():
                shutil.rmtree(path)
        shutil.rmtree(target)
        if shutil.which('fc-cache'):
            subprocess.run(['fc-cache', str(icon_font.parent)], check=False, stdout=subprocess.DEVNULL)
        print('Removed UsageStat Bar. Provider and appearance settings were preserved.')
        return
    if not (ROOT / '.usagestat-linux-bundle').is_file():
        parser.error('Build and extract the Linux archive first, then run its platforms/linux/install.py.')
    data.mkdir(parents=True, exist_ok=True)
    # Refuse ownership collisions before any writes.
    previous = json.loads(manifest.read_text()) if manifest.is_file() else {}
    for path in [launcher, desktop, service, mate_service, mate_applet, *native_files, *([xfce_desktop] if 'xfce' in native else [])]:
        if path.is_symlink() or (path.exists() and str(path) not in previous):
            parser.error(f'An unrelated file already exists: {path}')
    for path in [plasma, cinnamon]:
        if path.is_symlink() or (path.exists() and not (path / '.usagestat-linux-bundle').is_file()):
            parser.error(f'An unrelated widget already exists: {path}')
    if args.autostart and (autostart.is_symlink() or (autostart.exists() and str(autostart) not in previous)):
        parser.error(f'An unrelated autostart entry already exists: {autostart}')
    if 'xfce' in native and (xfce_library.exists() or xfce_library.is_symlink()) and previous.get(str(xfce_library)) != {'symlink': str(target / 'platforms/xfce/libusagestat.so')}:
        parser.error(f'An unrelated panel library already exists: {xfce_library}')
    if 'budgie' in native and (budgie_library.exists() or budgie_library.is_symlink()) and previous.get(str(budgie_library)) != {'symlink': str(target / 'platforms/budgie/libusagestat.so')}:
        parser.error(f'An unrelated panel library already exists: {budgie_library}')
    if (icon_font.exists() or icon_font.is_symlink()) and (previous.get(str(icon_font)) != font_link
            or not icon_font.is_symlink() or os.readlink(icon_font) != font_link['symlink']):
        parser.error(f'An unrelated font already exists: {icon_font}')
    with tempfile.TemporaryDirectory(prefix='.usagestat-install.', dir=data) as temp:
        incoming = Path(temp) / 'app'
        shutil.copytree(ROOT, incoming)
        # Compile before touching the current installation or its running service.
        for adapter in native:
            if adapter == 'cosmic': continue
            if adapter in ['lxqt', 'polybar']:
                filename = 'libusagestat.so' if adapter == 'lxqt' else 'usagestat-polybar'
                subprocess.run(['bash', str(incoming / 'platforms' / adapter / 'build.sh'),
                                str(incoming / 'platforms' / adapter / filename)], check=True)
                continue
            filename = 'libusagestat.so' if adapter in ['xfce', 'budgie'] else 'libusagestat-waybar.so'
            subprocess.run(['bash', str(incoming / 'platforms/gtk-panel/build.sh'), adapter,
                            str(incoming / 'platforms' / adapter / filename)], check=True)
        restart = stop_running(target, launcher) if target.exists() else None
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
    if 'xfce' in native:
        files[xfce_desktop] = '[Xfce Panel]\nType=X-XFCE-PanelPlugin\nName=UsageStat Bar\nComment=AI provider quotas and costs\nIcon=office-chart-pie\nX-XFCE-Module=usagestat\nX-XFCE-API=2.0\n'
    if 'waybar' in native:
        (target / 'platforms/waybar/native.jsonc').write_text(json.dumps({'cffi/usagestat': {
            'module_path': str(target / 'platforms/waybar/libusagestat-waybar.so'), 'height': 28}}, indent=2) + '\n')
    if 'budgie' in native:
        files[budgie_plugin] = (target / 'platforms/budgie/usagestat.plugin').read_text()
    if 'lxqt' in native:
        files[lxqt_desktop] = (target / 'platforms/lxqt/usagestat.desktop').read_text()
        files[lxqt_launcher] = '#!/usr/bin/env bash\nexport LXQTPANEL_PLUGIN_PATH=' + shlex.quote(str(target / 'platforms/lxqt')) \
            + '"${LXQTPANEL_PLUGIN_PATH:+:$LXQTPANEL_PLUGIN_PATH}"\nexec lxqt-panel "$@"\n'
    if 'cosmic' in native:
        files[cosmic_desktop] = '[Desktop Entry]\nType=Application\nName=UsageStat Bar\nComment=AI provider quotas and costs\n' \
            + f'Exec=/usr/bin/env GDK_BACKEND=wayland GSK_RENDERER=cairo gjs -m {desktop_quote(target / "platforms/cosmic/applet.js")}\n' \
            + 'Icon=office-chart-pie\nNoDisplay=true\nX-CosmicApplet=true\nX-OverflowPriority=10\n'
    if 'polybar' in native:
        files[polybar_launcher] = '#!/usr/bin/env bash\nexec ' + shlex.quote(str(target / 'platforms/polybar/usagestat-polybar')) + ' "$@"\n'
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
    if 'polybar' in native: polybar_launcher.chmod(0o755)
    if 'lxqt' in native: lxqt_launcher.chmod(0o755)
    for name, destination in [('plasma', plasma), ('cinnamon', cinnamon)]:
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists(): shutil.rmtree(destination)
        shutil.copytree(target / 'platforms' / name, destination)
        if name == 'plasma':
            qml = destination / 'contents/ui/main.qml'
            qml.write_text(qml.read_text().replace('property string launcher: "usagestat-bar"',
                'property string launcher: ' + json.dumps(str(launcher))))
        (destination / '.usagestat-linux-bundle').write_text('1\n')
    if 'xfce' in native:
        xfce_library.parent.mkdir(parents=True, exist_ok=True)
        if xfce_library.is_symlink(): xfce_library.unlink()
        xfce_library.symlink_to(target / 'platforms/xfce/libusagestat.so')
        previous[str(xfce_library)] = {'symlink': str(target / 'platforms/xfce/libusagestat.so')}
    if 'budgie' in native:
        budgie_library.parent.mkdir(parents=True, exist_ok=True)
        if budgie_library.is_symlink(): budgie_library.unlink()
        budgie_library.symlink_to(target / 'platforms/budgie/libusagestat.so')
        previous[str(budgie_library)] = {'symlink': str(target / 'platforms/budgie/libusagestat.so')}
    install_options.write_text(json.dumps({'native': native}))
    icon_font.parent.mkdir(parents=True, exist_ok=True)
    if icon_font.is_symlink(): icon_font.unlink()
    icon_font.symlink_to(font_link['symlink'])
    previous[str(icon_font)] = font_link
    if shutil.which('fc-cache'):
        subprocess.run(['fc-cache', str(icon_font.parent)], check=False, stdout=subprocess.DEVNULL)
    manifest.write_text(json.dumps({**previous, **{str(path): text for path, text in files.items()}}, indent=2))
    if restart:
        subprocess.Popen([str(launcher), restart], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    print(f'Installed: {launcher}\nAdd {launcher.parent} to PATH before starting your panel.\n'
          f'Add UsageStat Bar through your desktop panel settings. Adapter instructions: {target}/platforms.\n'
          'LXQt: launch the panel with usagestat-lxqt-panel so it can load the user plugin.\n'
          'Polybar: use usagestat-polybar with the supplied module configuration.\n'
          'The optional generic tray is started with usagestat-bar tray.')

if __name__ == '__main__':
    main()
