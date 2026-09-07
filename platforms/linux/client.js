import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import {BUS, OBJECT, INTERFACE} from './protocol.js';
import {ROOT} from './settings.js';
import {panelText, waybarOutput, escapeXml} from './render.js';

const [command = 'tray', value = ''] = ARGV;
const commands = {snapshot: ['GetSnapshot'], waybar: ['GetSnapshot'], polybar: ['GetSnapshot'], image: ['GetSnapshot'],
    refresh: ['Refresh'], select: ['Select', '(s)', value], next: ['Cycle', '(i)', 1], previous: ['Cycle', '(i)', -1],
    'scroll-next': ['Scroll', '(i)', 1], 'scroll-previous': ['Scroll', '(i)', -1],
    details: ['Details', '(s)', value], preferences: ['Preferences', '(s)', value], tray: ['EnableTray'], quit: ['Quit']};
if (!commands[command]) { printerr(`Unknown command: ${command}`); System.exit(2); }
const loop = new GLib.MainLoop(null, false);
let resultCode = 0;
const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));

function call(method, signature, value) {
    return new Promise((resolve, reject) => Gio.DBus.session.call(BUS, OBJECT, INTERFACE, method,
        signature ? new GLib.Variant(signature, [value]) : null, null, Gio.DBusCallFlags.NONE, 5000, null,
        (connection, result) => { try { resolve(connection.call_finish(result).deep_unpack()); } catch (error) { reject(error); } }));
}

async function main() {
    let started = false;
    for (let attempt = 0; attempt < 40; attempt++) {
        try {
            const result = await call(...commands[command]);
            if (['snapshot', 'waybar', 'polybar', 'image'].includes(command)) {
                const state = JSON.parse(result[0]);
                if (command === 'snapshot') print(JSON.stringify(state));
                else if (command === 'waybar') print(JSON.stringify(waybarOutput(state)));
                else if (command === 'polybar') print(panelText(state, true));
                else { print(value === 'light' ? state.panelImageLight : state.panelImage); print(escapeXml(panelText(state))); }
            }
            return;
        } catch (error) {
            const remote = Gio.DBusError.get_remote_error(error);
            if (command === 'quit' || !['org.freedesktop.DBus.Error.ServiceUnknown', 'org.freedesktop.DBus.Error.NameHasNoOwner',
                'org.freedesktop.DBus.Error.UnknownMethod', 'org.freedesktop.DBus.Error.UnknownObject'].includes(remote)) throw error;
            if (!started) {
                const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_SILENCE});
                launcher.spawnv(['gjs', '-m', `${ROOT}/platforms/linux/main.js`]);
                started = true;
            }
            await delay(100);
        }
    }
    throw new Error('UsageStat did not start. Check the GJS/GTK dependencies and your desktop session.');
}
main().catch(error => { printerr(error.message); resultCode = 1; }).finally(() => loop.quit());
loop.run();
System.exit(resultCode);
