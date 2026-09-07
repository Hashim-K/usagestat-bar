import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {settings} from './settings.js';
import {BUS, OBJECT, XML} from './protocol.js';
import {Model} from './model.js';
import {renderFiles} from './render.js';
import {DetailsWindow, preferencesWindow} from './ui.js';
import {Tray} from './tray.js';

const app = new Adw.Application({application_id: BUS, flags: Gio.ApplicationFlags.DEFAULT_FLAGS});
let model, exported, state, details, prefs, tray, quitSignal;

function showDetails(provider = '') {
    if (provider) model.select(provider);
    details ||= new DetailsWindow(app, model, showPreferences);
    details.update(state);
    details.window.present();
}

function showPreferences(provider = '') {
    prefs?.close();
    prefs = preferencesWindow(app, model.settings, provider);
    const current = prefs;
    current.connect('destroy', () => { if (prefs === current) prefs = null; });
}

function enableTray() {
    if (tray) return;
    tray = new Tray({details: showDetails, preferences: showPreferences, refresh: () => model.refresh(),
        cycle: direction => model.cycle(direction), quit: () => app.quit()}, missing => {
        if (missing) showDetails();
        if (details) { details.hostMissing = missing; details.update(state); }
    });
    model.emit();
}

app.connect('startup', () => {
    app.hold();
    model = new Model(settings(), next => {
        state = renderFiles({...next, trayEnabled: Boolean(tray)});
        exported?.emit_signal('Changed', new GLib.Variant('(s)', [JSON.stringify(state)]));
        tray?.update(state);
        if (details?.window.visible) details.update(state);
    }, (title, body) => {
        const notification = new Gio.Notification();
        notification.set_title(title); notification.set_body(body);
        app.send_notification(null, notification);
    });
    exported = Gio.DBusExportedObject.wrapJSObject(XML, {
        GetSnapshot: () => JSON.stringify(state), RequestSnapshot: () => model.emit(), Refresh: () => { model.refresh(); },
        Select: key => model.select(key), Cycle: direction => model.cycle(direction, false), Scroll: direction => model.cycle(direction),
        Details: showDetails, Preferences: showPreferences, EnableTray: enableTray, Quit: () => app.quit(),
    });
    exported.export(app.get_dbus_connection(), OBJECT);
    model.emit();
    model.refresh();
    quitSignal = GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, 15, () => { quitSignal = 0; app.quit(); return GLib.SOURCE_REMOVE; });
});
app.connect('activate', () => {});
app.connect('shutdown', () => {
    if (quitSignal) GLib.source_remove(quitSignal);
    prefs?.close();
    model?.close(); tray?.close(); exported?.unexport();
    Gio.Settings.sync();
});
app.run([]);
