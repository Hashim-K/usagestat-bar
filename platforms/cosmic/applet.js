// COSMIC hosts this undecorated GTK surface inside its panel. The native
// xdg_popup belongs to that exact surface, so the compositor handles position,
// output scaling, work-area constraints and outside-click dismissal.
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {BUS, OBJECT, INTERFACE} from '../linux/protocol.js';
import {settings} from '../linux/settings.js';
import {DetailsWindow} from '../linux/ui.js';
import {cosmicPanel} from '../linux/cosmic.js';

const app = new Adw.Application({application_id: `${BUS}.CosmicApplet`, flags: Gio.ApplicationFlags.NON_UNIQUE});
const preferences = settings();
const edge = (GLib.getenv('COSMIC_PANEL_ANCHOR') || 'Top').toLowerCase();
const vertical = ['left', 'right'].includes(edge);
const popupObject = '/io/github/HashimK/UsageStatBar/Panel';
const popupInterface = `${BUS}.Panel1`;
let window, button, picture, popup, view, exported, subscription, watch, state, appearanceTimer;
let appliedDark;

function call(method, args = null, callback = null) {
    Gio.DBus.session.call(BUS, OBJECT, INTERFACE, method, args, null, Gio.DBusCallFlags.NONE, 5000, null,
        (connection, result) => {
            try { const reply = connection.call_finish(result).recursiveUnpack(); callback?.(reply); }
            catch (error) { console.warn(`UsageStat COSMIC: ${error.message}`); }
        });
}

function align() {
    if (!view || !state) return;
    const alignment = {left: Gtk.Align.START, center: Gtk.Align.CENTER, right: Gtk.Align.END}[preferences.get_string('popup-alignment')];
    popup.halign = vertical ? Gtk.Align.CENTER : alignment;
    popup.valign = vertical ? alignment : Gtk.Align.CENTER;
    popup.position = {top: Gtk.PositionType.BOTTOM, bottom: Gtk.PositionType.TOP,
        left: Gtk.PositionType.RIGHT, right: Gtk.PositionType.LEFT}[edge];
    popup.set_offset(edge === 'left' ? 8 : edge === 'right' ? -8 : 0, edge === 'top' ? 8 : edge === 'bottom' ? -8 : 0);
    const [width, height] = view.preferredSize();
    const monitor = window.get_display().get_monitor_at_surface(window.get_surface());
    const screen = monitor?.get_geometry();
    // The child can scroll if the provider exceeds the available output.
    popup.child.set_size_request(Math.min(width, (screen?.width || width + 16) - 16),
        Math.min(height, (screen?.height || height + 96) - 96));
    if (popup.visible) popup.present();
}

function toggle(provider = '') {
    if (popup.visible && (!provider || provider === state?.active)) { popup.popdown(); return; }
    if (provider) call('Select', new GLib.Variant('(s)', [provider]));
    align();
    popup.popup();
}

function update(next) {
    state = next;
    view.update(state);
    const dark = cosmicPanel().dark;
    const path = vertical ? (dark ? state.panelImageVerticalPng : state.panelImageVerticalLightPng)
        : (dark ? state.panelImagePng : state.panelImageLightPng);
    // The renderer rewrites the file in place; reload on each new snapshot.
    if (path) {
        try {
            const texture = Gdk.Texture.new_from_filename(path);
            const size = vertical ? 36 : 24;
            const width = vertical ? size : Math.ceil(texture.get_width() * size / texture.get_height());
            const height = vertical ? Math.ceil(texture.get_height() * size / texture.get_width()) : size;
            picture.paintable = texture;
            picture.set_size_request(width, height);
            window.set_default_size(width + 8, height + 4);
        } catch (error) { console.warn(error.message); }
    }
    appliedDark = dark;
    button.tooltip_text = 'UsageStat Bar';
    align();
}

app.connect('activate', () => {
    if (window) return;
    Gtk.Settings.get_default().gtk_icon_theme_name = 'Adwaita';
    const css = new Gtk.CssProvider();
    css.load_from_string(`
        window.usagestat-cosmic-applet { background: transparent; box-shadow: none; }
        .usagestat-cosmic-button { min-width: 0; min-height: 0; padding: 2px 4px; border: none; border-radius: 6px; }
        .usagestat-cosmic-button:hover { background: alpha(@window_fg_color, 0.08); }
        /* COSMIC proxies the popup's window geometry. Keep shadows inside the
           buffer so its size equals that geometry and the host can render it. */
        popover.usagestat-details, popover.usagestat-details > contents {
            margin: 0; padding: 0; border: none; box-shadow: none; background: transparent;
        }
        popover.usagestat-details .usage-surface { background: @window_bg_color; border-radius: 12px; }
    `);
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    window = new Gtk.ApplicationWindow({application: app, decorated: false, resizable: false,
        css_classes: ['usagestat-cosmic-applet']});
    picture = new Gtk.Picture({can_shrink: true});
    button = new Gtk.Button({child: picture, css_classes: ['flat', 'usagestat-cosmic-button']});
    window.child = button;
    popup = new Gtk.Popover({has_arrow: false, autohide: true});
    popup.set_parent(button);
    const model = {settings: preferences,
        select: key => call('Select', new GLib.Variant('(s)', [key])),
        refresh: () => call('Refresh'),
        cycle: direction => call('Cycle', new GLib.Variant('(i)', [direction]))};
    view = new DetailsWindow(app, model, provider => {
        popup.popdown(); call('Preferences', new GLib.Variant('(s)', [provider]));
    }, align, popup);
    view.panelMode = true;
    button.connect('clicked', () => toggle());
    const scroll = new Gtk.EventControllerScroll({flags: Gtk.EventControllerScrollFlags.VERTICAL | Gtk.EventControllerScrollFlags.DISCRETE});
    scroll.connect('scroll', (_controller, _dx, dy) => {
        if (!dy || state?.interaction?.panelScroll === false) return false;
        call('Scroll', new GLib.Variant('(i)', [dy > 0 ? 1 : -1])); return true;
    });
    button.add_controller(scroll);
    const middle = new Gtk.GestureClick({button: 2});
    middle.connect('released', () => call('Refresh')); button.add_controller(middle);
    const right = new Gtk.GestureClick({button: 3});
    right.connect('released', () => call('Preferences', new GLib.Variant('(s)', ['']))); button.add_controller(right);
    exported = Gio.DBusExportedObject.wrapJSObject(`<node><interface name="${popupInterface}">
        <method name="Toggle"><arg name="provider" type="s" direction="in"/></method>
        <method name="Close"/>
        </interface></node>`, {Toggle: toggle, Close: () => popup.popdown()});
    exported.export(app.get_dbus_connection(), popupObject);
    subscription = Gio.DBus.session.signal_subscribe(BUS, INTERFACE, 'Changed', OBJECT, null, Gio.DBusSignalFlags.NONE,
        (_bus, _sender, _path, _interface, _signal, args) => update(JSON.parse(args.deep_unpack()[0])));
    watch = Gio.bus_watch_name(Gio.BusType.SESSION, BUS, Gio.BusNameWatcherFlags.AUTO_START, () => {
        call('RegisterPopup', new GLib.Variant('(o)', [popupObject]));
        call('GetSnapshot', null, result => update(JSON.parse(result[0])));
    }, () => { button.tooltip_text = 'UsageStat is reconnecting…'; });
    preferences.connect('changed::popup-alignment', align);
    appearanceTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
        if (state && appliedDark !== cosmicPanel().dark) update(state);
        return GLib.SOURCE_CONTINUE;
    });
    window.present();
});
app.connect('shutdown', () => {
    if (appearanceTimer) GLib.source_remove(appearanceTimer);
    if (subscription) Gio.DBus.session.signal_unsubscribe(subscription);
    if (watch) Gio.bus_unwatch_name(watch);
    exported?.unexport();
    view?.dispose();
    popup?.unparent();
});
app.run([]);
