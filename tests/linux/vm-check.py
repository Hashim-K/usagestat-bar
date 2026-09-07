#!/usr/bin/env python3
"""Run only inside the disposable lab VM's real LightDM/Xfce session."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import traceback

if Path.home() != Path('/home/lab') or not Path('/var/lib/cloud/instance').exists():
    raise SystemExit('This check requires the disposable cloud-init lab guest.')

ROOT = Path('/home/lab/source')
OUT = Path('/home/lab/out')
PREFIX = Path('/home/lab/.local')
APP = PREFIX / 'share/usagestat-bar'
LAUNCHER = PREFIX / 'bin/usagestat-bar'
BUS = 'io.github.HashimK.UsageStatBar'
OUT.mkdir(exist_ok=True)

import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib

def run(*args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, **kwargs)

def wait(predicate, seconds=40):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value: return value
        except Exception as error: last = error
        time.sleep(.2)
    raise AssertionError(f'Timed out: {last}')

def session():
    pid = subprocess.check_output(['pgrep', '-u', '1000', '-x', 'xfce4-panel'], text=True).split()[0]
    environment = dict(entry.decode().split('=', 1) for entry in Path(f'/proc/{pid}/environ').read_bytes().split(b'\0') if b'=' in entry)
    for key in ['DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'XDG_CURRENT_DESKTOP']:
        if key in environment: os.environ[key] = environment[key]
    os.environ['GSETTINGS_SCHEMA_DIR'] = str(APP / 'platforms/linux/schemas')
    os.environ['GSK_RENDERER'] = 'cairo'
    os.environ['PATH'] = str(PREFIX / 'bin') + ':' + os.environ['PATH']
    return Gio.DBusConnection.new_for_address_sync(environment['DBUS_SESSION_BUS_ADDRESS'],
        Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, None, None)

bus = wait(session)

def call(method, signature=None, values=None):
    return bus.call_sync(BUS, '/io/github/HashimK/UsageStatBar', BUS + '1', method,
        GLib.Variant(signature, values) if signature else None, None, Gio.DBusCallFlags.NONE, 5000, None).unpack()

def state(): return json.loads(call('GetSnapshot')[0])
def ready(): return wait(lambda: s if not (s := state())['loading'] and len(s['providers']) == 3 else None)
def setting(key, value): run('gsettings', 'set', BUS, key, value)
def registered():
    return bus.call_sync('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher', 'org.freedesktop.DBus.Properties',
        'Get', GLib.Variant('(ss)', ('org.kde.StatusNotifierWatcher', 'RegisteredStatusNotifierItems')),
        None, Gio.DBusCallFlags.NONE, 3000, None).unpack()[0]

def processes():
    result = []
    for path in Path('/proc').glob('[0-9]*/cmdline'):
        try:
            if os.fsencode(APP / 'platforms/linux/main.js') in path.read_bytes().split(b'\0'): result.append(int(path.parent.name))
        except (PermissionError, FileNotFoundError): pass
    return result

def screenshot(name):
    time.sleep(.7)
    if shutil.which('magick'): run('magick', 'import', '-window', 'root', OUT / name)
    else: run('import', '-window', 'root', OUT / name)

def restart_login():
    global bus
    old = subprocess.check_output(['pgrep', '-u', '1000', '-x', 'xfce4-panel'], text=True).strip()
    run('sudo', 'systemctl', 'restart', 'lightdm')
    wait(lambda: subprocess.check_output(['pgrep', '-u', '1000', '-x', 'xfce4-panel'], text=True).strip() != old)
    bus = wait(session)

phase = sys.argv[1] if len(sys.argv) > 1 else 'install'
report = {'phase': phase, 'os': Path('/etc/os-release').read_text(), 'checks': []}

def check(name, function):
    function()
    report['checks'].append({'name': name, 'passed': True})
    print(f'Passed: {name}', flush=True)

def installer(*arguments):
    run('python3', ROOT / 'platforms/linux/install.py', '--prefix', PREFIX, *arguments)

try:
    if phase == 'install':
        if APP.exists(): installer('--uninstall')
        fixture = Path('/home/lab/fixture')
        fixture.mkdir(exist_ok=True)
        (OUT / 'fixture-state.json').write_text('{"scenario":"normal"}')
        wrapper = fixture / 'usagestat'
        wrapper.write_text('#!/bin/sh\nexport USAGESTAT_FIXTURE_STATE=/home/lab/out/fixture-state.json\n'
                           'export USAGESTAT_FIXTURE_LOG=/home/lab/out/backend-commands.jsonl\nexec /home/lab/source/tests/fixtures/usagestat "$@"\n')
        wrapper.chmod(0o755)
        (ROOT / 'tests/fixtures/usagestat').chmod(0o755)
        config = Path('/home/lab/.config/usagestat/config.toml')
        config.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / 'tests/fixtures/config.toml', config)
        check('clean user installation', lambda: installer('--autostart'))
        setting('usagestat-cli-path', str(wrapper))
        setting('refresh-interval', '0')
        setting('panel-bar-count', '2')
        setting('display-mode', 'used')
        # Add the real desktop's tray to the disposable panel when its defaults omit it.
        run('xfconf-query', '-c', 'xfce4-panel', '-p', '/plugins/plugin-99', '-n', '-t', 'string', '-s', 'systray')
        ids = subprocess.check_output(['xfconf-query', '-c', 'xfce4-panel', '-p', '/panels/panel-1/plugin-ids'], text=True)
        numbers = [line for line in ids.splitlines() if line.strip().isdigit() and line.strip() != '99'] + ['99']
        arguments = ['xfconf-query', '-c', 'xfce4-panel', '-p', '/panels/panel-1/plugin-ids', '-a']
        for number in numbers: arguments += ['-t', 'int', '-s', number.strip()]
        run(*arguments)
        restart_login()
        def autostart():
            wait(lambda: len(processes()) == 1)
            assert ready()['mode'] == 'used'
            wait(lambda: len(registered()) >= 2)
        check('real login starts the tray without a CLI activation or duplicate service', autostart)
        screenshot('01-login.png')
        call('Details', '(s)', ('codex',))
        check('installed details window opens', lambda: wait(lambda: subprocess.run(
            ['xdotool', 'search', '--onlyvisible', '--name', '^UsageStat Bar$'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0))
        screenshot('02-details.png')
        call('Preferences', '(s)', ('claude',))
        check('provider preferences entry point opens', lambda: wait(lambda: subprocess.run(
            ['xdotool', 'search', '--onlyvisible', '--name', 'UsageStat Preferences'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0))
        screenshot('03-preferences.png')
        before_config = hashlib.sha256(config.read_bytes()).hexdigest()
        old_process = processes()[0]
        (OUT / 'fixture-state.json').write_text('{"scenario":"hang"}')
        call('Refresh')
        def hanging():
            entries = [json.loads(line) for line in (OUT / 'backend-commands.jsonl').read_text().splitlines()]
            return [entry['pid'] for entry in entries if entry['scenario'] == 'hang']
        pending = wait(hanging)
        # The process already running has loaded "hang"; the replacement sees "normal".
        (OUT / 'fixture-state.json').write_text('{"scenario":"normal"}')
        def upgrade():
            installer()
            wait(lambda: len(processes()) == 1 and processes()[0] != old_process)
            assert ready()['mode'] == 'used'
            assert hashlib.sha256(config.read_bytes()).hexdigest() == before_config
            wait(lambda: len(registered()) >= 2)
            for pid in pending: assert not Path(f'/proc/{pid}').exists(), f'Backend {pid} survived upgrade'
        check('live upgrade cancels pending work, preserves config and restarts the tray', upgrade)
        before = len(registered())
        run('xfce4-panel', '--restart')
        check('tray host restart restores exactly the original item count', lambda: wait(lambda: len(registered()) == before))
        call('Select', '(s)', ('codex',))
        setting('scroll-to-switch-provider', 'false')
        run(LAUNCHER, 'next')
        assert state()['active'] == 'claude'
        run(LAUNCHER, 'scroll-previous')
        assert state()['active'] == 'claude'
        report['checks'].append({'name': 'explicit switching works while scroll switching is disabled', 'passed': True})
        setting('scroll-to-switch-provider', 'true')
        call('Select', '(s)', ('codex',))
        # Actual key input to the installed window, not a direct callback invocation.
        call('Details', '(s)', ('codex',))
        window = wait(lambda: subprocess.check_output(['xdotool', 'search', '--onlyvisible', '--name', '^UsageStat Bar$'], text=True).splitlines()[0])
        run('xdotool', 'windowactivate', '--sync', window, 'key', 'F5')
        ready()
        run('xdotool', 'key', 'Escape')
        check('keyboard Escape closes the installed details window', lambda: wait(lambda: subprocess.run(
            ['xdotool', 'search', '--onlyvisible', '--name', '^UsageStat Bar$'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode != 0))
        (OUT / 'config-sha256').write_text(hashlib.sha256(config.read_bytes()).hexdigest())
        (OUT / 'before-boot-id').write_text(Path('/proc/sys/kernel/random/boot_id').read_text())
        screenshot('04-before-reboot.png')
    elif phase == 'ui':
        config = Path('/home/lab/.config/usagestat/config.toml')
        original = config.read_bytes()
        saved_settings = subprocess.check_output(['dconf', 'dump', '/io/github/HashimK/UsageStatBar/'])
        try:
            for scale in [1, 2]:
                directory = OUT / f'ui-{scale}x'
                directory.mkdir(exist_ok=True)
                if scale == 2: run('xrandr', '--output', 'Virtual-1', '--mode', '3840x2160')
                environment = {**os.environ, 'GDK_SCALE': str(scale), 'USAGESTAT_UI_OUT': str(directory),
                    'USAGESTAT_UI_FIXTURE': '/home/lab/fixture/usagestat',
                    'USAGESTAT_UI_COMMAND_LOG': '/home/lab/out/backend-commands.jsonl',
                    'USAGESTAT_UI_STATE': '/home/lab/out/fixture-state.json',
                    'USAGESTAT_BAR_SCHEMA_DIR': str(APP / 'platforms/linux/schemas')}
                def preferences():
                    result = directory / 'preferences.json'
                    result.unlink(missing_ok=True)
                    run('gjs', '-m', ROOT / 'tests/linux/preferences.js', env=environment, timeout=90)
                    assert json.loads(result.read_text())['passed']
                check(f'preferences flows at {scale}x in light and dark themes', preferences)
            run('xrandr', '--output', 'Virtual-1', '--mode', '1280x800')
        finally:
            config.write_bytes(original)
            run('dconf', 'load', '/io/github/HashimK/UsageStatBar/', input=saved_settings)
    elif phase == 'after-reboot':
        assert Path('/proc/sys/kernel/random/boot_id').read_text() != (OUT / 'before-boot-id').read_text()
        check('full guest reboot restores one service through desktop autostart', lambda: wait(lambda: len(processes()) == 1))
        value = ready()
        assert value['mode'] == 'used' and value['trayEnabled']
        wait(lambda: len(registered()) >= 2)
        config = Path('/home/lab/.config/usagestat/config.toml')
        assert hashlib.sha256(config.read_bytes()).hexdigest() == (OUT / 'config-sha256').read_text()
        screenshot('05-after-reboot.png')
        check('uninstall stops the running service', lambda: installer('--uninstall'))
        assert not LAUNCHER.exists() and not APP.exists()
        assert not Path('/home/lab/.config/autostart/io.github.HashimK.UsageStatBar.desktop').exists()
        assert not processes()
        assert hashlib.sha256(config.read_bytes()).hexdigest() == (OUT / 'config-sha256').read_text()
        restart_login()
        time.sleep(5)
        assert not processes()
        report['checks'].append({'name': 'subsequent login leaves no app while preserving provider config', 'passed': True})
        screenshot('06-after-uninstall.png')
    else:
        raise ValueError(phase)
except Exception as error:
    report['checks'].append({'name': 'acceptance failure', 'passed': False, 'error': str(error), 'traceback': traceback.format_exc()})
    print(traceback.format_exc(), file=sys.stderr)
    try: screenshot('failure.png')
    except Exception: pass
finally:
    report['passed'] = all(check['passed'] for check in report['checks'])
    (OUT / f'{phase}.json').write_text(json.dumps(report, indent=2))
sys.exit(0 if report['passed'] else 1)
