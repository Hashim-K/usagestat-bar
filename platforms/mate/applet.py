#!/usr/bin/env python3
"""Native MATE panel host for the UsageStat service (GTK 3, out of process)."""
import json
import gi
gi.require_version('Gtk', '3.0')
gi.require_version('MatePanelApplet', '4.0')
from gi.repository import Gtk, Gdk, GdkPixbuf, Gio, GLib, MatePanelApplet

BUS = 'io.github.HashimK.UsageStatBar'
PATH = '/io/github/HashimK/UsageStatBar'
IFACE = BUS + '1'

class Indicator:
    def __init__(self, applet):
        self.applet = applet
        self.bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        self.cancellable = Gio.Cancellable()
        self.image = Gtk.Image.new_from_icon_name('office-chart-pie', Gtk.IconSize.MENU)
        self.button = Gtk.Button()
        self.button.set_relief(Gtk.ReliefStyle.NONE)
        self.button.add(self.image)
        self.button.connect('clicked', lambda *_: self.call('Details', '(s)', ('',)))
        self.button.add_events(Gdk.EventMask.SCROLL_MASK | Gdk.EventMask.BUTTON_PRESS_MASK)
        self.button.connect('scroll-event', self.scroll)
        self.button.connect('button-press-event', self.press)
        applet.add(self.button)
        applet.set_flags(MatePanelApplet.AppletFlags.EXPAND_MINOR)
        applet.connect('destroy', self.close)
        applet.connect('change-size', lambda *_: self.request())
        self.signal = self.bus.signal_subscribe(BUS, IFACE, 'Changed', PATH, None, Gio.DBusSignalFlags.NONE,
            lambda _bus, _sender, _path, _iface, _signal, args: self.render(json.loads(args.unpack()[0])))
        self.watch = Gio.bus_watch_name(Gio.BusType.SESSION, BUS, Gio.BusNameWatcherFlags.AUTO_START,
            lambda *_: self.request(), lambda *_: self.button.set_tooltip_text('UsageStat is stopped'))
        applet.show_all()

    def call(self, method, signature=None, args=None, done=None):
        def finished(bus, result):
            try:
                values = bus.call_finish(result).unpack()
                if done: done(values)
            except GLib.Error as error:
                if not self.cancellable.is_cancelled(): self.button.set_tooltip_text(error.message)
        self.bus.call(BUS, PATH, IFACE, method, GLib.Variant(signature, args) if signature else None,
            None, Gio.DBusCallFlags.NONE, 5000, self.cancellable, finished)

    def request(self):
        self.call('GetSnapshot', done=lambda value: self.render(json.loads(value[0])))

    def render(self, state):
        foreground = self.button.get_style_context().get_color(Gtk.StateFlags.NORMAL)
        path = state['panelImageLight'] if (foreground.red + foreground.green + foreground.blue) < 1.5 else state['panelImage']
        height = max(18, min(36, self.applet.get_size() - 4))
        pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, -1, height, True)
        if self.applet.get_orient() in [MatePanelApplet.AppletOrient.LEFT, MatePanelApplet.AppletOrient.RIGHT]:
            pixbuf = pixbuf.rotate_simple(GdkPixbuf.PixbufRotation.CLOCKWISE)
        self.image.set_from_pixbuf(pixbuf)
        self.button.set_tooltip_text('\n'.join(f"{p['name']}: {p['error'] or p['text']}" for p in state['providers'] if not p['parent']))

    def scroll(self, _button, event):
        if event.direction in [Gdk.ScrollDirection.UP, Gdk.ScrollDirection.DOWN]:
            self.call('Scroll', '(i)', (-1 if event.direction == Gdk.ScrollDirection.UP else 1,))
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
