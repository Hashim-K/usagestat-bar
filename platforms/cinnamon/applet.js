const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
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
        this._scrollAmount = 0;
        this._scrollTime = 0;
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
            if (this._state?.interaction?.panelScroll === false) return Clutter.EVENT_PROPAGATE;
            const direction = event.get_scroll_direction();
            if (direction === Clutter.ScrollDirection.SMOOTH) {
                const [dx, dy] = event.get_scroll_delta();
                const delta = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
                const now = GLib.get_monotonic_time();
                if (now - this._scrollTime > 250000 || delta * this._scrollAmount < 0) this._scrollAmount = 0;
                this._scrollTime = now;
                this._scrollAmount += delta;
                if (Math.abs(this._scrollAmount) >= 1) {
                    this._call('Scroll', '(i)', this._scrollAmount > 0 ? 1 : -1);
                    this._scrollAmount = 0;
                }
                return Clutter.EVENT_STOP;
            }
            if ([Clutter.ScrollDirection.UP, Clutter.ScrollDirection.DOWN, Clutter.ScrollDirection.LEFT, Clutter.ScrollDirection.RIGHT].includes(direction)) {
                this._scrollAmount = 0;
                this._call('Scroll', '(i)', [Clutter.ScrollDirection.UP, Clutter.ScrollDirection.LEFT].includes(direction) ? -1 : 1);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._subscription = Gio.DBus.session.signal_subscribe(BUS, IFACE, 'Changed', PATH, null, Gio.DBusSignalFlags.NONE,
            (_bus, _sender, _path, _iface, _signal, params) => this._render(JSON.parse(params.deep_unpack()[0])));
        this.actor.connect('style-changed', () => { if (this._state) this._render(this._state); });
        this._theme = St.ThemeContext.get_for_stage(global.stage);
        this._scaleSignal = this._theme.connect('notify::scale-factor', () => { if (this._state) this._render(this._state); });
        this._watch = Gio.bus_watch_name(Gio.BusType.SESSION, BUS, Gio.BusNameWatcherFlags.AUTO_START,
            () => this._call('GetSnapshot', null, null, value => this._render(JSON.parse(value[0]))),
            () => { if (!this._closed) this.set_applet_tooltip('UsageStat is stopped. Click to start it.'); });
    }
    _call(method, signature = null, value = null, done = null) {
        Gio.DBus.session.call(BUS, PATH, IFACE, method, signature ? new GLib.Variant(signature, Array.isArray(value) ? value : [value]) : null,
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
            const vertical = [St.Side.LEFT, St.Side.RIGHT].includes(this._orientation);
            const light = foreground.red + foreground.green + foreground.blue < 382;
            const key = vertical ? light ? 'panelImageVerticalLight' : 'panelImageVertical' : light ? 'panelImageLight' : 'panelImage';
            const path = state[key + 'Png'] || state[key];
            const scale = this._theme.scale_factor;
            const thickness = vertical ? this.panel.actor.width : this.panel.actor.height;
            const size = Math.round(Math.max(16, Math.min(vertical ? 40 : 28, thickness / scale - 4)) * scale);
            const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, vertical ? size : -1, vertical ? -1 : size, true);
            const content = new Clutter.Image();
            content.set_data(pixbuf.get_pixels(), pixbuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888,
                pixbuf.width, pixbuf.height, pixbuf.rowstride);
            this._image.set_content(content);
            this._image.set_size(pixbuf.width, pixbuf.height);
        } catch (error) { this.set_applet_tooltip('UsageStat: ' + error.message); }
    }
    on_applet_clicked() {
        const [x, y] = this.actor.get_transformed_position();
        const [w, h] = this.actor.get_transformed_size();
        const monitor = Main.layoutManager.findMonitorForActor(this.actor);
        const workspace = (global.workspace_manager || global.screen).get_active_workspace();
        const area = workspace.get_work_area_for_monitor(monitor.index);
        const edge = { [St.Side.TOP]: 'top', [St.Side.BOTTOM]: 'bottom', [St.Side.LEFT]: 'left', [St.Side.RIGHT]: 'right' }[this._orientation];
        this._call('ToggleDetailsAt', '(ss)', ['', JSON.stringify({edge, rect: {x, y, w, h},
            work: {x: area.x, y: area.y, w: area.width, h: area.height}})]);
    }
    on_orientation_changed(orientation) {
        this._orientation = orientation;
        if (this._state) this._render(this._state);
    }
    on_panel_height_changed() {
        if (this._state) this._render(this._state);
    }
    on_applet_removed_from_panel() {
        this._closed = true;
        this._cancellable.cancel();
        this._theme.disconnect(this._scaleSignal);
        Gio.DBus.session.signal_unsubscribe(this._subscription);
        Gio.bus_unwatch_name(this._watch);
    }
}

function main(metadata, orientation, height, instanceId) {
    return new UsageStatApplet(metadata, orientation, height, instanceId);
}
