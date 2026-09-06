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
    run('python3',installer,'--prefix',prefix,'--autostart',env=env)
    launcher=prefix/'bin/usagestat-bar'
    assert os.access(launcher,os.X_OK)
    run(launcher,'--help',env=env)
    # The desktop entry has a second escaping layer beyond shell argv parsing.
    desktop=prefix/'share/applications/io.github.HashimK.UsageStatBar.desktop'
    check_desktop=base/'launch-check.desktop'
    check_desktop.write_text(desktop.read_text().replace(' tray\n', ' --help\n'))
    run('gjs','-c','const Gio=imports.gi.Gio; const GLib=imports.gi.GLib; const app=Gio.DesktopAppInfo.new_from_filename(ARGV[0]); if (!app || !app.launch([],null)) throw new Error("Desktop launcher failed"); GLib.usleep(200000);',check_desktop,env=env)
    assert (prefix/'share/usagestat-bar/platforms/linux/schemas/gschemas.compiled').is_file()
    run('python3',installer,'--prefix',prefix,env=env)
    assert provider.read_text()=='sentinel provider configuration\n'
    run('python3',installer,'--prefix',prefix,'--uninstall',env=env)
    assert not launcher.exists()
    assert not (base/'config/autostart/io.github.HashimK.UsageStatBar.desktop').exists()
    assert provider.read_text()=='sentinel provider configuration\n'
    # Refuse an unrelated file instead of replacing it.
    launcher.parent.mkdir(parents=True,exist_ok=True)
    launcher.write_text('unrelated launcher')
    failed=subprocess.run(['python3',str(installer),'--prefix',str(prefix)],env=env,capture_output=True)
    assert failed.returncode != 0 and launcher.read_text()=='unrelated launcher'
    launcher.unlink()
    destination=prefix/'share/usagestat-bar'
    outside=base/'outside'; outside.mkdir()
    (outside/'sentinel').write_text('preserve')
    destination.symlink_to(outside,target_is_directory=True)
    failed=subprocess.run(['python3',str(installer),'--prefix',str(prefix)],env=env,capture_output=True)
    assert failed.returncode != 0 and (outside/'sentinel').read_text()=='preserve'
print('Passed: release contents, unusual paths, install, upgrade, uninstall, config preservation and ownership checks')
