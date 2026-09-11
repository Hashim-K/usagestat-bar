#!/usr/bin/env python3
"""Check real build/install/upgrade/uninstall and ownership boundaries in a disposable prefix."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import tarfile
import tempfile

ROOT=Path(__file__).resolve().parents[2]
native=os.environ.get('USAGESTAT_TEST_NATIVE', '').split()
def run(*args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, **kwargs)

with tempfile.TemporaryDirectory(prefix='usagestat-linux-install.') as temp:
    base=Path(temp)
    env={**os.environ, 'XDG_CONFIG_HOME':str(base/'config'),'XDG_DATA_HOME':str(base/'data')}
    archive=base/'bundle.tar.gz'
    run('python3',ROOT/'platforms/linux/package.py','build',archive,cwd=base)
    with tarfile.open(archive) as package:
        names=package.getnames()
        assert not any('/tests/' in name or '/screenshots/' in name or '/.git/' in name for name in names)
        package.extractall(base,filter='data')
    app=base/'usagestat-bar'
    installer=app/'platforms/linux/install.py'
    prefix=base/"prefix with 'quotes' $and `ticks` %value"
    provider=base/'config/usagestat/config.toml'
    provider.parent.mkdir(parents=True)
    provider.write_text('sentinel provider configuration\n')
    native_args=[arg for adapter in native for arg in ['--native',adapter]]
    run('python3',installer,'--prefix',prefix,'--autostart',*native_args,env=env)
    launcher=prefix/'bin/usagestat-bar'
    assert os.access(launcher,os.X_OK)
    run(launcher,'--help',env=env)
    # The desktop entry has a second escaping layer beyond shell argv parsing.
    desktop=prefix/'share/applications/io.github.HashimK.UsageStatBar.desktop'
    check_desktop=base/'launch-check.desktop'
    check_desktop.write_text(desktop.read_text().replace(' tray\n', ' --help\n'))
    run('gjs','-c','const Gio=imports.gi.Gio; const GLib=imports.gi.GLib; const app=Gio.DesktopAppInfo.new_from_filename(ARGV[0]); if (!app || !app.launch([],null)) throw new Error("Desktop launcher failed"); GLib.usleep(200000);',check_desktop,env=env)
    assert (prefix/'share/usagestat-bar/platforms/linux/schemas/gschemas.compiled').is_file()
    options=prefix/'share/usagestat-bar/.install-options.json'
    assert json.loads(options.read_text())['native']==sorted(native)
    if 'polybar' in native: run(prefix/'bin/usagestat-polybar','--version',env=env)
    if 'lxqt' in native:
        run('bash','-n',prefix/'bin/usagestat-lxqt-panel')
        assert 'ServiceTypes=LXQtPanel/Plugin' in (prefix/'share/lxqt/lxqt-panel/usagestat.desktop').read_text()
        assert (prefix/'share/usagestat-bar/platforms/lxqt/libusagestat.so').is_file()
    if 'budgie' in native: assert (prefix/'share/budgie-desktop/plugins/libusagestat.so').resolve().is_file()
    if 'cosmic' in native:
        entry=prefix/'share/applications/io.github.HashimK.UsageStatApplet.desktop'
        # Exercise the real desktop Exec parser, including %% field-code
        # expansion. A temporary non-GUI entrypoint records its literal path.
        entrypoint=prefix/'share/usagestat-bar/platforms/cosmic/applet.js'
        original=entrypoint.read_text()
        probe=base/'cosmic-exec-path.txt'
        try:
            entrypoint.write_text('import Gio from "gi://Gio"; import GLib from "gi://GLib"; '
                'GLib.file_set_contents(GLib.getenv("USAGESTAT_DESKTOP_PROBE"), Gio.File.new_for_uri(import.meta.url).get_path());')
            run('gjs','-c','const Gio=imports.gi.Gio; const GLib=imports.gi.GLib; '
                'if (!Gio.DesktopAppInfo.new_from_filename(ARGV[0]).launch([],null)) throw new Error("Launch failed"); '
                'GLib.usleep(500000);',entry,env={**env,'USAGESTAT_DESKTOP_PROBE':str(probe)})
            assert probe.read_text()==str(entrypoint), 'COSMIC desktop argv changed the install path'
        finally: entrypoint.write_text(original)
    font = prefix/'share/fonts/UsageStatProviderIcons.ttf'
    assert font.is_symlink() and font.resolve().is_file()
    assert subprocess.check_output(['fc-scan', '--format', '%{family}', str(font)], text=True) == 'UsageStat Provider Icons'
    run('python3',installer,'--prefix',prefix,env=env)
    assert json.loads(options.read_text())['native']==sorted(native), 'Upgrade lost native adapters'
    assert provider.read_text()=='sentinel provider configuration\n'
    run('python3',installer,'--prefix',prefix,'--uninstall',env=env)
    assert not launcher.exists()
    assert not font.exists() and not font.is_symlink()
    for path in ['bin/usagestat-lxqt-panel','bin/usagestat-polybar','share/lxqt/lxqt-panel/usagestat.desktop',
                 'share/budgie-desktop/plugins/usagestat.plugin','share/budgie-desktop/plugins/libusagestat.so',
                 'share/applications/io.github.HashimK.UsageStatApplet.desktop']:
        assert not (prefix/path).exists() and not (prefix/path).is_symlink(), f'Native adapter left behind: {path}'
    assert not (base/'config/autostart/io.github.HashimK.UsageStatBar.desktop').exists()
    assert provider.read_text()=='sentinel provider configuration\n'
    # Refuse an unrelated file instead of replacing it.
    launcher.parent.mkdir(parents=True,exist_ok=True)
    launcher.write_text('unrelated launcher')
    failed=subprocess.run(['python3',str(installer),'--prefix',str(prefix)],env=env,capture_output=True)
    assert failed.returncode != 0 and launcher.read_text()=='unrelated launcher'
    launcher.unlink()
    font.write_bytes(b'unrelated font')
    failed=subprocess.run(['python3',str(installer),'--prefix',str(prefix)],env=env,capture_output=True)
    assert failed.returncode != 0 and font.read_bytes()==b'unrelated font'
    font.unlink()
    destination=prefix/'share/usagestat-bar'
    outside=base/'outside'; outside.mkdir()
    (outside/'sentinel').write_text('preserve')
    destination.symlink_to(outside,target_is_directory=True)
    failed=subprocess.run(['python3',str(installer),'--prefix',str(prefix)],env=env,capture_output=True)
    assert failed.returncode != 0 and (outside/'sentinel').read_text()=='preserve'
print('Passed: release contents, unusual paths, install, upgrade, uninstall, config preservation and ownership checks')
