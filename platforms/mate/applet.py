#!/usr/bin/env python3
"""Native MATE panel host for the UsageStat service (GTK 3, out of process)."""
import json
import gi
gi.require_version('Gtk', '3.0')
gi.require_version('MatePanelApplet', '4.0')
gi.require_foreign('cairo')
from gi.repository import Gtk, Gdk, GdkPixbuf, Gio, GLib, MatePanelApplet

BUS = 'io.github.HashimK.UsageStatBar'
PATH = '/io/github/HashimK/UsageStatBar'
IFACE = BUS + '1'

class Indicator:
    def __init__(self, applet):
        self.applet = applet
        self.bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        self.cancellable = Gio.Cancellable()
        self.state = None
        self.scroll_amount = 0
        self.scroll_time = 0
        self.image = Gtk.Image.new_from_icon_name('office-chart-pie', Gtk.IconSize.MENU)
        self.button = Gtk.Button()
        self.button.set_relief(Gtk.ReliefStyle.NONE)
        self.button.set_name('usagestat-panel')
        css = Gtk.CssProvider()
        css.load_from_data(b'#usagestat-panel { padding: 0 4px; border: none; box-shadow: none; background: transparent; color: inherit; }'
                           b'#usagestat-panel:hover { background: alpha(currentColor, 0.08); border-radius: 6px; }')
        self.button.get_style_context().add_provider(css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        self.button.add(self.image)
        self.button.connect('clicked', lambda *_: self.call('ToggleDetails', '(s)', ('',)))
        self.button.add_events(Gdk.EventMask.SCROLL_MASK | Gdk.EventMask.SMOOTH_SCROLL_MASK | Gdk.EventMask.BUTTON_PRESS_MASK)
        self.button.connect('scroll-event', self.scroll)
        self.button.connect('button-press-event', self.press)
        self.button.connect('style-updated', lambda *_: self.redraw())
        self.image.connect('notify::scale-factor', lambda *_: self.redraw())
        applet.add(self.button)
        applet.set_flags(MatePanelApplet.AppletFlags.EXPAND_MINOR)
        applet.connect('destroy', self.close)
        applet.connect('change-size', lambda *_: self.redraw())
        applet.connect('change-orient', lambda *_: self.redraw())
        self.signal = self.bus.signal_subscribe(BUS, IFACE, 'Changed', PATH, None, Gio.DBusSignalFlags.NONE,
            lambda _bus, _sender, _path, _iface, _signal, args: self.render(json.loads(args.unpack()[0])))
        self.watch = Gio.bus_watch_name(Gio.BusType.SESSION, BUS, Gio.BusNameWatcherFlags.AUTO_START,
            lambda *_: self.request(), lambda *_: self.button.set_tooltip_text('UsageStat is stopped'))
        applet.show_all()

    def call(self, method, signature=None, args=None, done=None):
        def finished(bus, result):
            try:
                values = bus.call_finish(result).unpack()
                if done and not self.cancellable.is_cancelled(): done(values)
            except GLib.Error as error:
                if not self.cancellable.is_cancelled(): self.button.set_tooltip_text(error.message)
        self.bus.call(BUS, PATH, IFACE, method, GLib.Variant(signature, args) if signature else None,
            None, Gio.DBusCallFlags.NONE, 5000, self.cancellable, finished)

    def request(self):
        self.call('GetSnapshot', done=lambda value: self.render(json.loads(value[0])))

    def render(self, state):
        if self.cancellable.is_cancelled(): return
        self.state = state
        self.redraw()
        self.button.set_tooltip_text('\n'.join(f"{p['name']}: {p['error'] or p['text']}" for p in state['providers'] if not p['parent']))

    def redraw(self):
        if not self.state or self.cancellable.is_cancelled(): return
        foreground = self.button.get_style_context().get_color(Gtk.StateFlags.NORMAL)
        key = 'panelImageLight' if (foreground.red + foreground.green + foreground.blue) < 1.5 else 'panelImage'
        path = self.state.get(key + 'Png', self.state[key])
        height = max(16, min(28, self.applet.get_size() - 4))
        scale = self.image.get_scale_factor()
        try:
            pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, -1, height * scale, True)
            if self.applet.get_orient() in [MatePanelApplet.AppletOrient.LEFT, MatePanelApplet.AppletOrient.RIGHT]:
                pixbuf = pixbuf.rotate_simple(GdkPixbuf.PixbufRotation.CLOCKWISE)
            self.image.set_from_surface(Gdk.cairo_surface_create_from_pixbuf(pixbuf, scale, None))
        except GLib.Error as error:
            self.button.set_tooltip_text(error.message)

    def scroll(self, _button, event):
        if self.state and not self.state.get('interaction', {}).get('panelScroll', True): return False
        if event.direction == Gdk.ScrollDirection.SMOOTH:
            valid, dx, dy = event.get_scroll_deltas()
            if not valid: return False
            delta = dy if abs(dy) >= abs(dx) else dx
            now = GLib.get_monotonic_time()
            if now - self.scroll_time > 250000 or delta * self.scroll_amount < 0: self.scroll_amount = 0
            self.scroll_time = now
            self.scroll_amount += delta
            if abs(self.scroll_amount) >= 1:
                self.call('Scroll', '(i)', (1 if self.scroll_amount > 0 else -1,))
                self.scroll_amount = 0
            return True
        if event.direction in [Gdk.ScrollDirection.UP, Gdk.ScrollDirection.DOWN, Gdk.ScrollDirection.LEFT, Gdk.ScrollDirection.RIGHT]:
            self.scroll_amount = 0
            self.call('Scroll', '(i)', (-1 if event.direction in [Gdk.ScrollDirection.UP, Gdk.ScrollDirection.LEFT] else 1,))
            return True
        return False

    def press(self, _button, event):
        if event.button == 3:
            self.call('Preferences', '(s)', ('',))
            return True
        if event.button == 2:
            self.call('Refresh')
            return True
        return False

    def close(self, *_):
        self.cancellable.cancel()
        self.bus.signal_unsubscribe(self.signal)
        Gio.bus_unwatch_name(self.watch)

def factory(applet, iid, _data):
    if iid != 'UsageStatApplet': return False
    applet._usage_stat = Indicator(applet)
    return True

MatePanelApplet.Applet.factory_main('UsageStatAppletFactory', True, MatePanelApplet.Applet.__gtype__, factory, None)
