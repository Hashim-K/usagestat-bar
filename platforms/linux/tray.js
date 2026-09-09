import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Adw from 'gi://Adw?version=1';
import {traySvg, svgPixels} from './render.js';
import {safeColor, panelPins, panelProviders} from './model.js';
import {desktopName} from './desktop.js';
import {cosmicPanel} from './cosmic.js';

const ITEM = `<node><interface name="org.kde.StatusNotifierItem">
  <property name="Category" type="s" access="read"/><property name="Id" type="s" access="read"/>
  <property name="Title" type="s" access="read"/><property name="Status" type="s" access="read"/>
  <property name="WindowId" type="i" access="read"/><property name="IconName" type="s" access="read"/>
  <property name="IconPixmap" type="a(iiay)" access="read"/><property name="OverlayIconName" type="s" access="read"/>
  <property name="OverlayIconPixmap" type="a(iiay)" access="read"/><property name="AttentionIconName" type="s" access="read"/>
  <property name="AttentionIconPixmap" type="a(iiay)" access="read"/><property name="AttentionMovieName" type="s" access="read"/>
  <property name="ToolTip" type="(sa(iiay)ss)" access="read"/><property name="ItemIsMenu" type="b" access="read"/>
  <property name="Menu" type="o" access="read"/>
  <method name="Activate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
  <method name="SecondaryActivate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
  <method name="ContextMenu"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
  <method name="Scroll"><arg type="i" direction="in"/><arg type="s" direction="in"/></method>
  <signal name="NewTitle"/><signal name="NewIcon"/><signal name="NewAttentionIcon"/>
  <signal name="NewOverlayIcon"/><signal name="NewToolTip"/><signal name="NewStatus"><arg type="s"/></signal>
</interface></node>`;

const MENU = `<node><interface name="com.canonical.dbusmenu">
  <property name="Version" type="u" access="read"/><property name="TextDirection" type="s" access="read"/>
  <property name="Status" type="s" access="read"/><property name="IconThemePath" type="as" access="read"/>
  <method name="GetLayout"><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="as" direction="in"/><arg type="u" direction="out"/><arg type="(ia{sv}av)" direction="out"/></method>
  <method name="GetGroupProperties"><arg type="ai" direction="in"/><arg type="as" direction="in"/><arg type="a(ia{sv})" direction="out"/></method>
  <method name="GetProperty"><arg type="i" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method>
  <method name="Event"><arg type="i" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="in"/><arg type="u" direction="in"/></method>
  <method name="EventGroup"><arg type="a(isvu)" direction="in"/><arg type="ai" direction="out"/></method>
  <method name="AboutToShow"><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
  <method name="AboutToShowGroup"><arg type="ai" direction="in"/><arg type="ai" direction="out"/><arg type="ai" direction="out"/></method>
  <signal name="LayoutUpdated"><arg type="u"/><arg type="i"/></signal>
  <signal name="ItemsPropertiesUpdated"><arg type="a(ia{sv})"/><arg type="a(ias)"/></signal>
</interface></node>`;

// Reuse introspection for the lifetime of the service. GJS caches property
// lookups when wrapping an interface; reparsing/freeing one for every tray
// restart can leave that native cache pointing at freed property metadata.
const ITEM_INFO = Gio.DBusInterfaceInfo.new_for_xml(ITEM);
const MENU_INFO = Gio.DBusInterfaceInfo.new_for_xml(MENU);

class Menu {
    constructor(tray, path, connection, provider) {
        this.tray = tray;
        this.provider = provider;
        this.Version = 3; this.TextDirection = 'ltr'; this.Status = 'normal'; this.IconThemePath = [];
        this.object = Gio.DBusExportedObject.wrapJSObject(MENU_INFO, this);
        this.object.export(connection, path);
    }
    entries() {
        return [[1, 'Show usage', () => this.tray.actions.details(this.provider()?.key || '')], [2, 'Refresh', this.tray.actions.refresh],
            [5, 'Tray settings', this.tray.actions.trayPreferences],
            [3, 'Preferences', () => this.tray.actions.preferences('')],
            ...this.tray.state.providers.filter(p => !p.parent).map((p, i) => [100 + i, `${p.name}: ${p.text}`, () => this.tray.actions.details(p.key)]),
            [4, 'Quit UsageStat', this.tray.actions.quit]];
    }
    props(id, names = []) {
        const entry = this.entries().find(e => e[0] === id);
        const props = id === 0 ? {'children-display': new GLib.Variant('s', 'submenu')} : {
            label: new GLib.Variant('s', entry?.[1] || ''), enabled: new GLib.Variant('b', true), visible: new GLib.Variant('b', true)};
        return names.length ? Object.fromEntries(Object.entries(props).filter(([key]) => names.includes(key))) : props;
    }
    GetLayout(parent, depth, names) {
        return [this.tray.state.revision, [parent, this.props(parent, names), parent === 0 && depth !== 0
            ? this.entries().map(e => new GLib.Variant('(ia{sv}av)', [e[0], this.props(e[0], names), []])) : []]];
    }
    GetGroupProperties(ids, names) { return ids.map(id => [id, this.props(id, names)]); }
    GetProperty(id, name) { return this.props(id)[name] || new GLib.Variant('s', ''); }
    Event(id, event) { if (event === 'clicked') this.entries().find(e => e[0] === id)?.[2](); }
    EventGroup(events) { for (const event of events) this.Event(...event); return []; }
    AboutToShow() { return false; }
    AboutToShowGroup() { return [[], []]; }
}

function pixmap(svg, size) {
    const pixbuf = svgPixels(svg, size), pixels = pixbuf.get_pixels();
    const channels = pixbuf.get_n_channels(), stride = pixbuf.get_rowstride();
    const result = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const source = y * stride + x * channels, target = (y * size + x) * 4;
        result[target] = channels === 4 ? pixels[source + 3] : 255;
        result[target + 1] = pixels[source]; result[target + 2] = pixels[source + 1]; result[target + 3] = pixels[source + 2];
    }
    return [size, size, result];
}

class Item {
    constructor(tray, key) {
        this.tray = tray;
        this.path = '/StatusNotifierItem';
        // A separate connection gives each item a lifetime the watcher can track.
        // Removing a selected provider closes its connection and removes that item.
        this.connection = Gio.DBusConnection.new_for_address_sync(GLib.getenv('DBUS_SESSION_BUS_ADDRESS'),
            Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, null, null);
        this.Category = 'ApplicationStatus';
        this.Id = `usagestat-bar-${key === 'active' || key === 'setup' ? key : GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, key, -1).slice(0, 16)}`;
        this.WindowId = 0; this.IconName = ''; this.OverlayIconName = ''; this.AttentionIconName = '';
        this.OverlayIconPixmap = []; this.AttentionIconPixmap = []; this.AttentionMovieName = '';
        this.ItemIsMenu = false; this.Menu = `${this.path}/Menu`;
        this.menu = new Menu(tray, this.Menu, this.connection, () => this.provider);
        this.object = Gio.DBusExportedObject.wrapJSObject(ITEM_INFO, this);
        this.object.export(this.connection, this.path);
    }
    get Title() { return this.provider?.name || 'UsageStat Bar'; }
    get Status() { return this.provider?.error ? 'NeedsAttention' : 'Active'; }
    get ToolTip() {
        const description = this.provider?.error || [this.provider?.text,
            ...(this.provider?.windows || []).map(window => `${window.label}: ${window.text}`)].filter(Boolean).join('\n');
        return ['', [], this.Title, description || 'Set up providers'];
    }
    update(provider) {
        const title = this.Title, status = this.Status, tooltip = JSON.stringify(this.ToolTip);
        this.provider = provider;
        const svg = traySvg(provider, this.tray.appearance());
        if (svg !== this.svg) {
            this.svg = svg;
            this.IconPixmap = [16, 22, 24, 32, 48, 64].map(size => pixmap(svg, size));
            this.object.emit_signal('NewIcon', null);
        }
        if (title !== this.Title) this.object.emit_signal('NewTitle', null);
        if (tooltip !== JSON.stringify(this.ToolTip)) this.object.emit_signal('NewToolTip', null);
        if (status !== this.Status) this.object.emit_signal('NewStatus', new GLib.Variant('(s)', [this.Status]));
        this.menu.object.emit_signal('LayoutUpdated', new GLib.Variant('(ui)', [this.tray.state.revision, 0]));
    }
    Activate(x, y) { this.tray.actions.details(this.provider?.key || '', {point: {x, y}, host: 'tray'}); }
    SecondaryActivate() { this.tray.actions.refresh(); }
    ContextMenu() { this.tray.actions.trayPreferences(); }
    Scroll(delta) {
        if (delta && ['active', 'count'].includes(this.tray.settings.get_string('provider-mode'))
            && this.tray.settings.get_boolean('scroll-to-switch-provider')) this.tray.actions.cycle(delta > 0 ? -1 : 1,
                this.tray.settings.get_string('provider-mode') === 'count'
                    ? panelPins(this.tray.state.providers, this.tray.settings.get_strv('pinned-providers'), this.tray.settings.get_int('provider-count')) : []);
    }
    close() { this.object.unexport(); this.menu.object.unexport(); this.connection.close_sync(null); }
}

export class Tray {
    constructor(settings, actions, missingHost) {
        this.settings = settings;
        this.actions = actions; this.missingHost = missingHost; this.items = new Map(); this.available = false; this.closed = false;
        this.state = {providers: [], panel: [], revision: 0};
        this.style = Adw.StyleManager.get_default();
        this.styleSignal = this.style.connect('notify::dark', () => this.update(this.state));
        if (desktopName().includes('cosmic')) {
            this.cosmicDark = cosmicPanel().dark;
            // User configuration directories may not exist yet. Recheck the
            // small native config values so newly created overrides also work.
            this.cosmicThemeTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
                const dark = cosmicPanel().dark;
                if (dark !== this.cosmicDark) { this.cosmicDark = dark; this.update(this.state); }
                return GLib.SOURCE_CONTINUE;
            });
        }
        if (desktopName().includes('budgie')) {
            // Budgie's panel has an independent dark-theme preference, often
            // enabled while application windows use the light theme.
            const schema = Gio.SettingsSchemaSource.get_default().lookup('com.solus-project.budgie-panel', true);
            if (schema?.has_key('dark-theme')) {
                this.panelTheme = new Gio.Settings({settings_schema: schema});
                this.panelThemeSignal = this.panelTheme.connect('changed::dark-theme', () => this.update(this.state));
            }
        }
        this.watch = Gio.bus_watch_name(Gio.BusType.SESSION, 'org.kde.StatusNotifierWatcher', Gio.BusNameWatcherFlags.NONE,
            () => { this.available = true; this.items.forEach(item => this.register(item)); this.checkHost(); },
            () => { this.available = false; this.missingHost(true); });
        this.hostSignal = Gio.DBus.session.signal_subscribe('org.kde.StatusNotifierWatcher', 'org.kde.StatusNotifierWatcher',
            'StatusNotifierHostRegistered', '/StatusNotifierWatcher', null, Gio.DBusSignalFlags.NONE, () => this.checkHost());
        this.hostRemovedSignal = Gio.DBus.session.signal_subscribe('org.kde.StatusNotifierWatcher', 'org.kde.StatusNotifierWatcher',
            'StatusNotifierHostUnregistered', '/StatusNotifierWatcher', null, Gio.DBusSignalFlags.NONE, () => this.checkHost());
    }
    appearance() {
        const foreground = this.settings.get_string('foreground');
        const darkPanel = this.cosmicDark ?? (this.panelTheme ? this.panelTheme.get_boolean('dark-theme') : this.style.dark);
        const light = foreground === 'light' || (foreground === 'auto' && darkPanel);
        return {style: this.settings.get_string('icon-style'), logoStyle: this.settings.get_string('logo-style'),
            fill: this.settings.get_string('logo-fill-mode'), barOrientation: this.settings.get_string('bar-orientation'),
            barThickness: this.settings.get_int('bar-thickness'),
            background: light ? '#23262e' : '#f4f5f6',
            neutral: light ? '#f4f5f6' : '#23262e', accent: safeColor(this.settings.get_string('accent-color'))};
    }
    checkHost() {
        Gio.DBus.session.call('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher', 'org.freedesktop.DBus.Properties',
            'Get', new GLib.Variant('(ss)', ['org.kde.StatusNotifierWatcher', 'IsStatusNotifierHostRegistered']),
            null, Gio.DBusCallFlags.NONE, 5000, null, (connection, result) => {
                if (this.closed) return;
                try { this.missingHost(!connection.call_finish(result).recursiveUnpack()[0]); }
                catch { this.missingHost(true); }
            });
    }
    register(item) {
        item.connection.call('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher', 'org.kde.StatusNotifierWatcher',
            'RegisterStatusNotifierItem', new GLib.Variant('(s)', [item.connection.get_unique_name()]), null, Gio.DBusCallFlags.NONE, 5000, null,
            (connection, result) => {
                if (this.closed || item.connection.is_closed()) return;
                try { connection.call_finish(result); }
                catch (error) { console.error(error.message); this.missingHost(true); }
            });
    }
    update(state) {
        if (this.closed) return;
        this.state = state;
        const mode = this.settings.get_string('provider-mode');
        const selected = new Set(this.settings.get_strv('providers'));
        const visible = state.providers.filter(provider => !provider.parent);
        let providers;
        if (mode === 'count') {
            providers = panelProviders(visible, state.active, this.settings.get_strv('pinned-providers'), this.settings.get_int('provider-count'));
        } else {
            providers = visible.filter(provider => mode === 'all'
                || (mode === 'custom' ? selected.has(provider.key) : provider.key === state.active));
        }
        // Keep the same tray registrations while rotating their contents, so
        // scrolling does not remove, recreate or reorder the icon slots.
        const entries = providers.map((provider, index) => [mode === 'count' ? index === 0 ? 'active' : `slot:${index}`
            : mode === 'active' ? 'active' : `provider:${provider.key}`, provider]);
        if (!state.providers.length && mode !== 'custom') entries.push(['setup', null]);
        const keys = new Set(entries.map(([key]) => key));
        for (const [key, item] of this.items) {
            if (!keys.has(key)) { item.close(); this.items.delete(key); }
        }
        for (const [key, provider] of entries) {
            let item = this.items.get(key);
            const added = !item;
            if (added) { item = new Item(this, key); this.items.set(key, item); }
            item.update(provider);
            if (added && this.available) this.register(item);
        }
    }
    close() {
        this.closed = true;
        this.style.disconnect(this.styleSignal);
        if (this.cosmicThemeTimer) GLib.source_remove(this.cosmicThemeTimer);
        if (this.panelThemeSignal) this.panelTheme.disconnect(this.panelThemeSignal);
        Gio.bus_unwatch_name(this.watch);
        Gio.DBus.session.signal_unsubscribe(this.hostSignal);
        Gio.DBus.session.signal_unsubscribe(this.hostRemovedSignal);
        this.items.forEach(item => item.close());
    }
}
