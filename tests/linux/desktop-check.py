#!/usr/bin/env python3
"""Black-box checks through public D-Bus and a real panel in a private session."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import traceback
import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib

OUT = Path('/out')
TARGET = sys.argv[1]
BUS = 'io.github.HashimK.UsageStatBar'
OBJECT = '/io/github/HashimK/UsageStatBar'
IFACE = BUS + '1'
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
checks = []

def call(method, signature=None, value=None):
    return bus.call_sync(BUS, OBJECT, IFACE, method, GLib.Variant(signature, value) if signature else None,
                         None, Gio.DBusCallFlags.NONE, 5000, None).unpack()

def state():
    return json.loads(call('GetSnapshot')[0])

def wait_for(predicate, timeout=25):
    deadline = time.monotonic() + timeout
    error = None
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value: return value
        except Exception as exc: error = exc
        time.sleep(.15)
    raise AssertionError(f'Timed out; last error: {error}')

def check(name, function):
    function()
    checks.append({'name':name, 'passed':True})
    print(f'Passed: {name}', flush=True)

def screenshot(name):
    time.sleep(.7)
    if TARGET in ['sway','budgie','cosmic','hyprland']:
        subprocess.run(['grim', str(OUT / name)], check=True, timeout=10)
    else:
        subprocess.run(['magick', 'import', '-window', 'root', str(OUT / name)], check=True, timeout=10)

def scenario(name):
    (OUT / 'fixture-state.json').write_text(json.dumps({'scenario': name}))
    before = state()['revision']
    call('Refresh')
    return wait_for(lambda: s if (s := state())['revision'] > before and not s['loading'] else None)

def setting(key, value):
    subprocess.run(['gsettings', 'set', BUS, key, value], check=True)

def registered():
    return bus.call_sync('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher', 'org.freedesktop.DBus.Properties',
        'Get', GLib.Variant('(ss)', ('org.kde.StatusNotifierWatcher', 'RegisteredStatusNotifierItems')),
        None, Gio.DBusCallFlags.NONE, 3000, None).unpack()[0]

def item_call(item, interface, method, signature, values, path=None):
    name, _, suffix = item.partition('/')
    path = path or ('/' + suffix if suffix else '/StatusNotifierItem')
    return bus.call_sync(name, path, interface, method, GLib.Variant(signature, values),
        None, Gio.DBusCallFlags.NONE, 5000, None).unpack()

def mapped(title):
    if TARGET == 'cosmic':
        from toplevels import titles
        return any(title in item for item in titles())
    if TARGET == 'hyprland':
        result = subprocess.run(['hyprctl','clients','-j'], text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        return any(title in c['title'] for c in json.loads(result.stdout))
    if TARGET in ['sway', 'budgie', 'cosmic', 'hyprland']:
        result = subprocess.run(['wlrctl', 'toplevel', 'list'], text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        return title in result.stdout
    return subprocess.run(['xdotool','search','--onlyvisible','--name', title], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).returncode == 0

try:
    initial = wait_for(lambda: s if not (s := state())['loading'] and len(s['providers']) == 3 else None)
    def initial_check():
        assert len(initial['panel']) == 2
        assert initial['providers'][0]['used'] == 52.5
        assert initial['providers'][0]['percent'] == 47.5
        assert initial['providers'][2]['parent'] == 'codex'
        assert len(initial['providers'][0]['cost']['lines']) == 3
    check('fixture accounts, grouping, automatic mean and costs', initial_check)

    if TARGET in ['lxqt', 'xfce', 'budgie', 'cosmic']:
        def tray_check():
            call('EnableTray')
            wait_for(lambda: len(registered()) == 2)
        check('two indicators registered with the real desktop tray', tray_check)
        def resize_tray():
            setting('panel-bar-count', '1')
            wait_for(lambda: len(registered()) == 1)
            setting('panel-bar-count', '2')
            wait_for(lambda: len(registered()) == 2)
        check('removing and restoring indicators leaves no stale tray items', resize_tray)
        def menu_check():
            item = registered()[0]
            props = item_call(item, 'org.freedesktop.DBus.Properties', 'GetAll', '(s)', ('org.kde.StatusNotifierItem',))[0]
            assert sorted((w,h,len(data)) for w,h,data in props['IconPixmap']) == [(32,32,4096),(64,64,16384)]
            layout = item_call(item, 'com.canonical.dbusmenu', 'GetLayout', '(iias)', (0,-1,[]), props['Menu'])[1]
            assert {'Show usage','Refresh','Preferences','Quit UsageStat'} <= {entry[1]['label'] for entry in layout[2]}
        check('tray pixmaps and context menu implement the desktop protocol', menu_check)
    else:
        time.sleep(4)
        log = (OUT / 'panel.log').read_text()
        required = {'plasma':'plasmashell', 'cinnamon':'cinnamon', 'mate':'mate-panel', 'i3':'polybar','bspwm':'polybar','sway':'waybar','hyprland':'waybar'}[TARGET]
        subprocess.run(['pgrep','-x',required], check=True, stdout=subprocess.DEVNULL)
        assert not any(error in log for error in ['GLib-GIO-ERROR', 'JS ERROR', 'Error loading applet', 'TypeError:', 'ReferenceError:']), log[-3000:]
        assert 'io.github.HashimK.usagestat' not in log or 'Error loading' not in log
        checks.append({'name':'panel process launched; screenshot requires visual review', 'passed':True})
    screenshot('01-panel.png')
    if TARGET == 'plasma':
        subprocess.run(['xdotool','mousemove','120','25','click','1'],check=True)
        screenshot('07-native-popup.png')
        assert not any(error in (OUT / 'panel.log').read_text() for error in ['TypeError:', 'ReferenceError:'])
        subprocess.run(['xdotool','key','Escape'],check=True)
    if TARGET in ['lxqt', 'xfce', 'budgie', 'cosmic']:
        item_call(registered()[0], 'org.kde.StatusNotifierItem', 'Activate', '(ii)', (0,0))
    elif TARGET in ['cinnamon','mate','i3','bspwm']:
        x, y = (100, 984) if TARGET == 'cinnamon' else (100, 16)
        subprocess.run(['xdotool','mousemove',str(x),str(y),'click','1'],check=True)
    else:
        call('Details', '(s)', ('codex',))
    check('mapped GTK provider details window', lambda: wait_for(lambda: mapped('UsageStat Bar')))
    call('Select', '(s)', ('codex',))
    screenshot('02-details.png')

    def switch():
        call('Cycle', '(i)', (1,))
        assert state()['active'] == 'claude'
        call('Select', '(s)', ('codex',))
        assert state()['active'] == 'codex'
    check('provider switching', switch)

    def display():
        setting('display-mode', 'used')
        wait_for(lambda: state()['mode'] == 'used')
        assert state()['providers'][0]['percent'] == 52.5
        setting('provider-usage-settings', '{"codex":{"panelUsageTier":"secondary"}}')
        wait_for(lambda: state()['providers'][0]['used'] == 80)
    check('settings update panel selection and used/remaining mode', display)
    screenshot('03-used.png')
    setting('provider-usage-settings', '{}')
    failed = scenario('failure')
    check('backend failure remains visible', lambda: (_ for _ in ()).throw(AssertionError('no error')) if not failed['providers'][0]['error'] else None)
    screenshot('04-error.png')
    recovered = scenario('normal')
    assert not recovered['providers'][0]['error']
    checks.append({'name':'backend recovers on next refresh', 'passed':True})
    if TARGET == 'lxqt':
        def notifications():
            setting('usage-thresholds', '[{"id":"warning","label":"Warning","percent":75,"color":"#f6d32d","notify":true}]')
            scenario('warning')
            wait_for(lambda: 'AI usage threshold crossed' in (OUT / 'notifications.log').read_text())
            screenshot('06-notification.png')
            before = (OUT / 'notifications.log').read_text().count('AI usage threshold crossed')
            scenario('warning')
            scenario('normal')
            time.sleep(.5)
            assert (OUT / 'notifications.log').read_text().count('AI usage threshold crossed') == before
            setting('usage-thresholds', '[{"id":"warning","label":"Warning","percent":75,"color":"#f6d32d","notify":false}]')
        check('real notification daemon receives upward crossings only', notifications)
    call('Preferences', '(s)', ('',))
    check('mapped existing preferences outside GNOME', lambda: wait_for(lambda: mapped('UsageStat Preferences')))
    screenshot('05-preferences.png')
    for name in ['many-windows','no-cost','cost-failure','legacy','array','zero','full']:
        value = scenario(name)
        assert not value['providers'][0]['error'], (name, value)
        if name == 'many-windows': assert len(value['providers'][0]['windows']) == 6
        if name in ['no-cost','cost-failure']: assert value['providers'][0]['cost'] is None
    checks.append({'name':'extra windows, optional cost, legacy, array and boundary fixtures', 'passed':True})
    scenario('normal')
    (OUT / 'snapshot.json').write_text(json.dumps(state(), indent=2))
    call('Quit')
    time.sleep(.5)
    subprocess.run(['usagestat-bar','snapshot'], stdout=subprocess.DEVNULL, check=True, timeout=15)
    check('service restart preserves appearance settings', lambda: wait_for(lambda: state()['mode'] == 'used'))
    call('Quit')
except Exception as error:
    try: screenshot('failure-desktop.png')
    except Exception: pass
    checks.append({'name':'desktop check failure', 'passed':False,'error':str(error),'traceback':traceback.format_exc()})
    print(traceback.format_exc(), file=sys.stderr)
finally:
    (OUT / 'result.json').write_text(json.dumps({'target':TARGET,'checks':checks,'passed':all(c['passed'] for c in checks)}, indent=2))
sys.exit(0 if all(c['passed'] for c in checks) else 1)
