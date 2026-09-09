import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import Adw from 'gi://Adw?version=1';
import {Tray} from '../../platforms/linux/tray.js';
import {settings, TRAY_SCHEMA_ID} from '../../platforms/linux/settings.js';
import {assert, equal} from '../assert.js';

// Exercise real D-Bus property reads after repeatedly replacing tray slots.
// Collection between replacements exposes stale introspection-cache pointers.
Adw.init();
const config = settings(TRAY_SCHEMA_ID);
config.set_string('provider-mode', 'count');
config.set_int('provider-count', 2);
const providers = ['codex', 'claude', 'copilot'].map(key => ({
    key, name: key, iconId: key, percent: 75, color: '#8ab4f8', text: '75% left', windows: [],
}));
const loop = new GLib.MainLoop(null, false);
let failure = 0;
const properties = item => new Promise((resolve, reject) => {
    Gio.DBus.session.call(item.connection.get_unique_name(), item.path,
        'org.freedesktop.DBus.Properties', 'GetAll',
        new GLib.Variant('(s)', ['org.kde.StatusNotifierItem']),
        new GLib.VariantType('(a{sv})'), Gio.DBusCallFlags.NONE, 3000, null,
        (connection, result) => {
            try { resolve(connection.call_finish(result).recursiveUnpack()[0]); }
            catch (error) { reject(error); }
        });
});

(async () => {
    for (let iteration = 0; iteration < 80; iteration++) {
        const tray = new Tray(config, {}, () => {});
        try {
            tray.update({providers, active: providers[iteration % providers.length].key, revision: iteration});
            System.gc();
            for (const item of tray.items.values()) {
                const values = await properties(item);
                equal(values.Category, 'ApplicationStatus', `Lifecycle ${iteration}: ${JSON.stringify(values)}`);
                equal(values.Title, item.provider.name);
                equal(values.Status, 'Active');
                assert(values.IconPixmap.length === 6);
            }
        } finally { tray.close(); }
        System.gc();
    }
    print('ok - 80 tray lifecycles / 160 native property snapshots survive collection');
})().catch(error => {
    printerr(`${error.message}\n${error.stack}`);
    failure = 1;
}).finally(() => loop.quit());
loop.run();
System.exit(failure);
