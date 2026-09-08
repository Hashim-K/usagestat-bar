import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import {BUS, OBJECT, INTERFACE} from './protocol.js';
import {ROOT, unixSignal} from './settings.js';
import {panelText, waybarOutput, escapeXml} from './render.js';

const [command = 'tray', value = ''] = ARGV;
const watching = ['waybar', 'polybar'].includes(command) && value === '--watch';
const commands = {snapshot: ['GetSnapshot'], waybar: ['GetSnapshot'], polybar: ['GetSnapshot'], image: ['GetSnapshot'],
    refresh: ['Refresh'], select: ['Select', '(s)', value], next: ['Cycle', '(i)', 1], previous: ['Cycle', '(i)', -1],
    'scroll-next': ['Scroll', '(i)', 1], 'scroll-previous': ['Scroll', '(i)', -1],
    details: ['Details', '(s)', value], toggle: ['ToggleDetails', '(s)', value],
    preferences: ['Preferences', '(s)', value], tray: ['EnableTray'], quit: ['Quit']};
if (!commands[command]) { printerr(`Unknown command: ${command}`); System.exit(2); }
const loop = new GLib.MainLoop(null, false);
let resultCode = 0;
let stopped = false, subscription = 0, watch = 0, lastOutput = '', owner = '', revision = -1;
const signals = [];
const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));

function call(method, signature, value, destination = BUS) {
    return new Promise((resolve, reject) => Gio.DBus.session.call(destination, OBJECT, INTERFACE, method,
        signature ? new GLib.Variant(signature, [value]) : null, null, Gio.DBusCallFlags.NONE, 5000, null,
        (connection, result) => { try { resolve(connection.call_finish(result).deep_unpack()); } catch (error) { reject(error); } }));
}

function output(state) {
    const line = command === 'waybar' ? JSON.stringify(waybarOutput(state)) : panelText(state, true);
    if (!watching || line !== lastOutput) { print(line); lastOutput = line; }
}

function observe() {
    // Subscribe once; wheel actions and settings changes appear immediately.
    // The name watch also reconnects after an upgrade or service restart.
    subscription = Gio.DBus.session.signal_subscribe(BUS, INTERFACE, 'Changed', OBJECT, null, Gio.DBusSignalFlags.NONE,
        (_bus, sender, _path, _interface, _signal, args) => {
            if (stopped || sender !== owner) return;
            const state = JSON.parse(args.deep_unpack()[0]);
            if (state.revision >= revision) { revision = state.revision; output(state); }
        });
    watch = Gio.bus_watch_name(Gio.BusType.SESSION, BUS, Gio.BusNameWatcherFlags.NONE,
        async (_connection, _name, nextOwner) => {
            owner = nextOwner; revision = -1;
            try {
                const result = await call('GetSnapshot', null, null, nextOwner);
                if (stopped || owner !== nextOwner) return;
                const state = JSON.parse(result[0]);
                if (state.revision >= revision) { revision = state.revision; output(state); }
            } catch (error) { if (!stopped && owner === nextOwner) printerr(error.message); }
        }, () => {
            owner = ''; revision = -1;
            const text = 'UsageStat · Click to reconnect';
            lastOutput = command === 'waybar' ? JSON.stringify({text, tooltip: text, class: 'loading'}) : text;
            print(lastOutput);
        });
    for (const signal of [2, 15]) {
        signals.push(unixSignal(signal, () => {
            stopped = true; loop.quit(); return GLib.SOURCE_CONTINUE;
        }));
    }
}

async function main() {
    let started = false;
    for (let attempt = 0; attempt < 40; attempt++) {
        try {
            const result = await call(...commands[command]);
            if (['snapshot', 'waybar', 'polybar', 'image'].includes(command)) {
                const state = JSON.parse(result[0]);
                if (command === 'snapshot') print(JSON.stringify(state));
                else if (['waybar', 'polybar'].includes(command)) output(state);
                else { print(value === 'light' ? state.panelImageLight : state.panelImage); print(escapeXml(panelText(state))); }
            }
            if (watching) observe();
            return;
        } catch (error) {
            const remote = Gio.DBusError.get_remote_error(error);
            if (command === 'quit' || !['org.freedesktop.DBus.Error.ServiceUnknown', 'org.freedesktop.DBus.Error.NameHasNoOwner',
                'org.freedesktop.DBus.Error.UnknownMethod', 'org.freedesktop.DBus.Error.UnknownObject'].includes(remote)) throw error;
            if (!started) {
                const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_SILENCE});
                launcher.spawnv([`${ROOT}/platforms/linux/usagestat-bar`, 'service']);
                started = true;
            }
            await delay(100);
        }
    }
    throw new Error('UsageStat did not start. Check the GJS/GTK dependencies and your desktop session.');
}
main().catch(error => { printerr(error.message); resultCode = 1; }).finally(() => { if (!watching || resultCode || stopped) loop.quit(); });
loop.run();
stopped = true;
if (subscription) Gio.DBus.session.signal_unsubscribe(subscription);
if (watch) Gio.bus_unwatch_name(watch);
signals.forEach(id => GLib.source_remove(id));
System.exit(resultCode);
