const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Cogl = imports.gi.Cogl;
const GdkPixbuf = imports.gi.GdkPixbuf;
const BUS = 'io.github.HashimK.UsageStatBar';
const PATH = '/io/github/HashimK/UsageStatBar';
const IFACE = 'io.github.HashimK.UsageStatBar1';

class UsageStatApplet extends Applet.Applet {
    constructor(metadata, orientation, height, instanceId) {
        super(orientation, height, instanceId);
        this._closed = false;
        this._orientation = orientation;
        this._cancellable = new Gio.Cancellable();
        this._image = new St.Widget({width: 150, height: 28});
        this.actor.add_child(this._image);
        this.set_applet_tooltip('UsageStat Bar — starting');
        this.setAllowedLayout(Applet.AllowedLayout.BOTH);
        this._applet_context_menu.addMenuItem(new PopupMenu.PopupMenuItem('Refresh usage'));
        this._applet_context_menu._getMenuItems().slice(-1)[0].connect('activate', () => this._call('Refresh'));
        const prefs = new PopupMenu.PopupMenuItem('UsageStat preferences');
        prefs.connect('activate', () => this._call('Preferences', '(s)', ''));
        this._applet_context_menu.addMenuItem(prefs);
        this.actor.connect('scroll-event', (_actor, event) => {
            const direction = event.get_scroll_direction();
            if ([Clutter.ScrollDirection.UP, Clutter.ScrollDirection.DOWN].includes(direction)) {
                this._call('Scroll', '(i)', direction === Clutter.ScrollDirection.UP ? -1 : 1);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._subscription = Gio.DBus.session.signal_subscribe(BUS, IFACE, 'Changed', PATH, null, Gio.DBusSignalFlags.NONE,
            (_bus, _sender, _path, _iface, _signal, params) => this._render(JSON.parse(params.deep_unpack()[0])));
        this.actor.connect('style-changed', () => { if (this._state) this._render(this._state); });
        this._watch = Gio.bus_watch_name(Gio.BusType.SESSION, BUS, Gio.BusNameWatcherFlags.AUTO_START,
            () => this._call('GetSnapshot', null, null, value => this._render(JSON.parse(value[0]))),
            () => { if (!this._closed) this.set_applet_tooltip('UsageStat is stopped. Click to start it.'); });
    }
    _call(method, signature = null, value = null, done = null) {
        Gio.DBus.session.call(BUS, PATH, IFACE, method, signature ? new GLib.Variant(signature, [value]) : null,
            null, Gio.DBusCallFlags.NONE, 5000, this._cancellable, (bus, result) => {
                try { const response = bus.call_finish(result).deep_unpack(); if (!this._closed && done) done(response); }
                catch (error) { if (!this._closed) this.set_applet_tooltip('UsageStat: ' + error.message); }
            });
    }
    _render(state) {
        if (this._closed) return;
        this._state = state;
        this.set_applet_tooltip(state.providers.filter(p => !p.parent).map(p => p.name + ': ' + (p.error || p.text)).join('\n') || 'UsageStat — set up providers');
        try {
            const foreground = this.actor.get_theme_node().get_foreground_color();
            const path = foreground.red + foreground.green + foreground.blue < 382 ? state.panelImageLight : state.panelImage;
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            let pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, state.panelWidth * scale, 28 * scale, true);
            if ([St.Side.LEFT, St.Side.RIGHT].includes(this._orientation))
                pixbuf = pixbuf.rotate_simple(GdkPixbuf.PixbufRotation.CLOCKWISE);
            const content = new Clutter.Image();
            content.set_data(pixbuf.get_pixels(), pixbuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888,
                pixbuf.width, pixbuf.height, pixbuf.rowstride);
            this._image.set_content(content);
            this._image.set_size(pixbuf.width / scale, pixbuf.height / scale);
        } catch (error) { this.set_applet_tooltip('UsageStat: ' + error.message); }
    }
    on_applet_clicked() {
        this._call('Details', '(s)', '');
    }
    on_orientation_changed(orientation) {
        this._orientation = orientation;
        if (this._state) this._render(this._state);
    }
    on_applet_removed_from_panel() {
        this._closed = true;
        this._cancellable.cancel();
        Gio.DBus.session.signal_unsubscribe(this._subscription);
        Gio.bus_unwatch_name(this._watch);
    }
}

function main(metadata, orientation, height, instanceId) {
    return new UsageStatApplet(metadata, orientation, height, instanceId);
}
