import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {settings, TRAY_SCHEMA_ID, unixSignal} from './settings.js';
import {BUS, OBJECT, XML} from './protocol.js';
import {Model} from './model.js';
import {renderFiles} from './render.js';
import {DetailsWindow, preferencesWindow} from './ui.js';
import {Tray} from './tray.js';
import {canAnchorToPanel, anchorToPanel} from './panelWindow.js';
import {applyDesktopAppearance} from './waybarPreferences.js';

const app = new Adw.Application({application_id: BUS, flags: Gio.ApplicationFlags.DEFAULT_FLAGS});
let model, exported, state, details, prefs, tray, trayConfig, traySettingsId, quitSignal;
let detailsPosition, detailsAnchor, detailsSize;

function cancelDetailsPosition() {
    detailsPosition?.cancel();
    detailsPosition = null;
}

function resizeDetails(force = false) {
    if (!details?.panelMode || !details.window.visible) return;
    const size = details.preferredSize();
    if (!force && detailsSize === size.join('x')) return;
    detailsSize = size.join('x');
    details.window.set_default_size(...size);
    if (!canAnchorToPanel()) return;
    cancelDetailsPosition();
    const pending = detailsPosition = new Gio.Cancellable();
    anchorToPanel(details.window, size, pending, detailsAnchor).then(anchor => {
        if (detailsPosition === pending) detailsAnchor = anchor;
    }).catch(error => {
        if (!pending.is_cancelled()) console.warn(`UsageStat panel placement: ${error.message}`);
    }).finally(() => {
        if (detailsPosition !== pending) return;
        detailsPosition = null;
        details.window.opacity = 1;
    });
}

function showDetails(provider = '', fromPanel = false) {
    cancelDetailsPosition();
    if (provider) model.select(provider);
    if (!details) {
        details = new DetailsWindow(app, model, showPreferences, resizeDetails);
        details.window.connect('hide', cancelDetailsPosition);
    }
    if (details.panelMode && !fromPanel) details.window.set_default_size(460, 680);
    details.panelMode = fromPanel;
    detailsAnchor = null; detailsSize = null;
    details.update(state);
    const anchor = fromPanel && canAnchorToPanel();
    // GTK skips the first buffer at zero opacity, so Hyprland cannot map or
    // position it. A nonzero first frame lets us place it before revealing it.
    details.window.opacity = anchor ? 0.01 : 1;
    if (anchor) { details.window.unmaximize(); details.window.unfullscreen(); }
    if (fromPanel) details.window.set_default_size(...details.preferredSize());
    details.window.present();
    if (fromPanel) resizeDetails(true);
}

function toggleDetails(provider = '') {
    // Panel clicks can take focus before the D-Bus call arrives. Visibility,
    // rather than keyboard focus, determines whether the next click closes it.
    if (details?.window.visible && (!provider || provider === model.active)) {
        details.window.hide();
    } else {
        showDetails(provider, true);
    }
}

function showPreferences(provider = '', page = '') {
    prefs?.close();
    prefs = preferencesWindow(app, model.settings, provider, {traySettings: trayConfig, providers: state.providers, page,
        desktopChanged: next => { detailsAnchor = {...detailsAnchor, alignment: next.alignment}; resizeDetails(true); }});
    const current = prefs;
    current.connect('destroy', () => { if (prefs === current) prefs = null; });
}

function enableTray() {
    if (!trayConfig.get_boolean('enabled')) trayConfig.set_boolean('enabled', true);
    else syncTray();
}

function syncTray() {
    if (trayConfig.get_boolean('enabled')) {
        tray ||= new Tray(trayConfig, {details: showDetails, preferences: showPreferences,
            trayPreferences: () => showPreferences('', 'tray'), refresh: () => model.refresh(),
            cycle: direction => model.cycle(direction, false), quit: () => app.quit()}, missing => {
            if (missing) showDetails();
            if (details) { details.hostMissing = missing; details.update(state); }
        });
    } else if (tray) {
        tray.close(); tray = null;
        if (details) details.hostMissing = false;
    }
    model.emit();
}

app.connect('startup', () => {
    app.hold();
    applyDesktopAppearance();
    Gtk.Settings.get_default().gtk_icon_theme_name = 'Adwaita';
    trayConfig = settings(TRAY_SCHEMA_ID);
    model = new Model(settings(), next => {
        state = renderFiles({...next, trayEnabled: Boolean(tray)});
        const snapshot = JSON.stringify(state);
        exported?.emit_signal('Changed', new GLib.Variant('(s)', [snapshot]));
        exported?.emit_property_changed('Snapshot', new GLib.Variant('s', snapshot));
        tray?.update(state);
        if (details?.window.visible) details.update(state);
        if (prefs?.visible) prefs.trayPage?.updateProviders(state.providers);
    }, (title, body) => {
        const notification = new Gio.Notification();
        notification.set_title(title); notification.set_body(body);
        app.send_notification(null, notification);
    });
    exported = Gio.DBusExportedObject.wrapJSObject(XML, {
        get Snapshot() { return JSON.stringify(state); },
        GetSnapshot: () => JSON.stringify(state), RequestSnapshot: () => model.emit(), Refresh: () => { model.refresh(); },
        Select: key => model.select(key), Cycle: direction => model.cycle(direction, false), Scroll: direction => model.cycle(direction),
        Details: showDetails, ToggleDetails: toggleDetails,
        Preferences: provider => showPreferences(provider), EnableTray: enableTray, Quit: () => app.quit(),
    });
    exported.export(app.get_dbus_connection(), OBJECT);
    traySettingsId = trayConfig.connect('changed', syncTray);
    syncTray();
    model.refresh();
    quitSignal = unixSignal(15, () => { quitSignal = 0; app.quit(); return GLib.SOURCE_REMOVE; });
});
app.connect('activate', () => {});
app.connect('shutdown', () => {
    cancelDetailsPosition();
    if (quitSignal) GLib.source_remove(quitSignal);
    if (traySettingsId) trayConfig.disconnect(traySettingsId);
    prefs?.close();
    model?.close(); tray?.close(); exported?.unexport();
    Gio.Settings.sync();
});
app.run([]);
