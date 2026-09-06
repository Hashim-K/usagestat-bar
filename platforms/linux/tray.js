import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import {traySvg} from './render.js';

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

class Menu {
    constructor(tray, path, connection) {
        this.tray = tray;
        this.Version = 3; this.TextDirection = 'ltr'; this.Status = 'normal'; this.IconThemePath = [];
        this.object = Gio.DBusExportedObject.wrapJSObject(MENU, this);
        this.object.export(connection, path);
    }
    entries() {
        return [[1, 'Show usage', () => this.tray.actions.details('')], [2, 'Refresh', this.tray.actions.refresh],
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
    const loader = GdkPixbuf.PixbufLoader.new_with_type('svg');
    loader.set_size(size, size);
    loader.write(new TextEncoder().encode(svg)); loader.close();
    const pixbuf = loader.get_pixbuf(), pixels = pixbuf.get_pixels();
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
    constructor(tray, index) {
        this.tray = tray;
        this.path = '/StatusNotifierItem';
        // A separate connection gives each item a lifetime the watcher can track.
        // Removing a pinned provider closes its connection and removes that item.
        this.connection = Gio.DBusConnection.new_for_address_sync(GLib.getenv('DBUS_SESSION_BUS_ADDRESS'),
            Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, null, null);
        this.Category = 'ApplicationStatus'; this.Id = `usagestat-bar-${index}`;
        this.WindowId = 0; this.IconName = ''; this.OverlayIconName = ''; this.AttentionIconName = '';
        this.OverlayIconPixmap = []; this.AttentionIconPixmap = []; this.AttentionMovieName = '';
        this.ItemIsMenu = false; this.Menu = `${this.path}/Menu`;
        this.menu = new Menu(tray, this.Menu, this.connection);
        this.object = Gio.DBusExportedObject.wrapJSObject(ITEM, this);
        this.object.export(this.connection, this.path);
    }
    get Title() { return this.provider?.name || 'UsageStat Bar'; }
    get Status() { return this.provider?.error ? 'NeedsAttention' : 'Active'; }
    get ToolTip() { return ['', [], this.Title, this.provider?.error || this.provider?.text || 'Set up providers']; }
    update(provider) {
        this.provider = provider;
        const svg = traySvg(provider);
        if (svg !== this.svg) {
            this.svg = svg;
            this.IconPixmap = [32, 64].map(size => pixmap(svg, size));
            this.object.emit_signal('NewIcon', null);
        }
        this.object.emit_signal('NewTitle', null);
        this.object.emit_signal('NewToolTip', null);
        this.object.emit_signal('NewStatus', new GLib.Variant('(s)', [this.Status]));
        this.menu.object.emit_signal('LayoutUpdated', new GLib.Variant('(ui)', [this.tray.state.revision, 0]));
    }
    Activate() { this.tray.actions.details(this.provider?.key || ''); }
    SecondaryActivate() { this.tray.actions.refresh(); }
    ContextMenu() { this.tray.actions.preferences(this.provider?.key || ''); }
    Scroll(delta) { this.tray.actions.cycle(delta > 0 ? -1 : 1); }
    close() { this.object.unexport(); this.menu.object.unexport(); this.connection.close_sync(null); }
}

export class Tray {
    constructor(actions, missingHost) {
        this.actions = actions; this.missingHost = missingHost; this.items = []; this.available = false;
        this.state = {providers: [], panel: [], revision: 0};
        this.watch = Gio.bus_watch_name(Gio.BusType.SESSION, 'org.kde.StatusNotifierWatcher', Gio.BusNameWatcherFlags.NONE,
            () => { this.available = true; this.items.forEach(item => this.register(item)); this.checkHost(); },
            () => { this.available = false; this.missingHost(true); });
        this.hostSignal = Gio.DBus.session.signal_subscribe('org.kde.StatusNotifierWatcher', 'org.kde.StatusNotifierWatcher',
            'StatusNotifierHostRegistered', '/StatusNotifierWatcher', null, Gio.DBusSignalFlags.NONE, () => this.checkHost());
        this.hostRemovedSignal = Gio.DBus.session.signal_subscribe('org.kde.StatusNotifierWatcher', 'org.kde.StatusNotifierWatcher',
            'StatusNotifierHostUnregistered', '/StatusNotifierWatcher', null, Gio.DBusSignalFlags.NONE, () => this.checkHost());
    }
    checkHost() {
        Gio.DBus.session.call('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher', 'org.freedesktop.DBus.Properties',
            'Get', new GLib.Variant('(ss)', ['org.kde.StatusNotifierWatcher', 'IsStatusNotifierHostRegistered']),
            null, Gio.DBusCallFlags.NONE, 5000, null, (connection, result) => {
                try { this.missingHost(!connection.call_finish(result).recursiveUnpack()[0]); }
                catch { this.missingHost(true); }
            });
    }
    register(item) {
        item.connection.call('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher', 'org.kde.StatusNotifierWatcher',
            'RegisterStatusNotifierItem', new GLib.Variant('(s)', [item.connection.get_unique_name()]), null, Gio.DBusCallFlags.NONE, 5000, null,
            (connection, result) => { try { connection.call_finish(result); } catch (error) { console.error(error.message); this.missingHost(true); } });
    }
    update(state) {
        this.state = state;
        const providers = state.panel.map(key => state.providers.find(p => p.key === key));
        const count = Math.max(1, providers.length);
        while (this.items.length > count) this.items.pop().close();
        while (this.items.length < count) {
            const item = new Item(this, this.items.length);
            this.items.push(item); item.update(providers[this.items.length - 1]);
            if (this.available) this.register(item);
        }
        this.items.forEach((item, i) => item.update(providers[i]));
    }
    close() {
        Gio.bus_unwatch_name(this.watch);
        Gio.DBus.session.signal_unsubscribe(this.hostSignal);
        Gio.DBus.session.signal_unsubscribe(this.hostRemovedSignal);
        this.items.forEach(item => item.close());
    }
}
