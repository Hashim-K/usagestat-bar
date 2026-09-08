import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {runAsync} from '../../cli.js';
import {desktopName} from './desktop.js';
import {ROOT} from './settings.js';

let GdkX11, LayerShell;
try { imports.gi.versions.GdkX11 = '4.0'; GdkX11 = imports.gi.GdkX11; } catch { /* Wayland-only GTK */ }
try { imports.gi.versions.Gtk4LayerShell = '1.0'; LayerShell = imports.gi.Gtk4LayerShell; } catch { /* X11/native shell */ }

const isX11 = () => Boolean(GdkX11 && Gdk.Display.get_default() instanceof GdkX11.X11Display);
const hasLayerShell = () => !isX11() && Boolean(LayerShell?.is_supported());
const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
const fraction = alignment => ({left: 0, center: 0.5, right: 1}[alignment] ?? 0.5);
const contains = (rect, point) => point && point.x >= rect.x && point.x < rect.x + rect.w &&
    point.y >= rect.y && point.y < rect.y + rect.h;
const rectangle = rect => rect && ['x', 'y', 'w', 'h'].every(key => Number.isFinite(rect[key])) && rect.w > 0 && rect.h > 0;
const geometry = monitor => {
    const rect = monitor.get_geometry();
    return {x: rect.x, y: rect.y, w: rect.width, h: rect.height};
};

export function canAnchorToPanel() { return isX11() || hasLayerShell(); }

// A layer surface must be configured before GTK realizes the window. Keep it
// separate from the ordinary application window, which the user can still move.
export function preparePanelWindow(window) {
    if (!hasLayerShell()) return false;
    LayerShell.init_for_window(window);
    LayerShell.set_namespace(window, 'usagestat-popup');
    LayerShell.set_layer(window, LayerShell.Layer.OVERLAY);
    LayerShell.set_keyboard_mode(window, LayerShell.KeyboardMode.ON_DEMAND);
    window.decorated = false;
    window.add_css_class('usagestat-panel-popup');
    return true;
}

export function dismissOutside(window, dismiss) {
    if (isX11()) {
        const surface = window.get_surface();
        if (!surface) return () => {};
        window.get_display().flush();
        const process = Gio.Subprocess.new(['python3', `${ROOT}/platforms/linux/x11Panel.py`,
            JSON.stringify({xid: surface.get_xid(), watch: true})], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        let closed = false, finished = false;
        process.communicate_utf8_async(null, null, (child, result) => {
            try {
                const [, output, error] = child.communicate_utf8_finish(result);
                finished = true;
                if (!closed && output.trim() === 'outside') dismiss();
                else if (!closed && error.trim()) console.warn(`UsageStat popup dismissal: ${error.trim()}`);
            } catch (error) { if (!closed) console.warn(error.message); }
        });
        return () => { closed = true; if (!finished) process.force_exit(); };
    }
    if (!hasLayerShell()) return () => {};
    const monitors = window.get_display().get_monitors();
    const backdrops = Array.from({length: monitors.get_n_items()}, (_, index) => {
        const backdrop = new Gtk.Window({application: window.application, decorated: false,
            css_classes: ['usagestat-popup-dismiss'], child: new Gtk.Box()});
        LayerShell.init_for_window(backdrop);
        LayerShell.set_namespace(backdrop, 'usagestat-dismiss');
        LayerShell.set_layer(backdrop, LayerShell.Layer.TOP);
        LayerShell.set_monitor(backdrop, monitors.get_item(index));
        LayerShell.set_keyboard_mode(backdrop, LayerShell.KeyboardMode.NONE);
        // Leave panels clickable/scrollable. Only the work area dismisses the
        // popup; its own interactive layer is above these transparent surfaces.
        LayerShell.set_exclusive_zone(backdrop, 0);
        for (const side of ['LEFT', 'RIGHT', 'TOP', 'BOTTOM']) LayerShell.set_anchor(backdrop, LayerShell.Edge[side], true);
        const click = new Gtk.GestureClick({button: 0, propagation_phase: Gtk.PropagationPhase.CAPTURE});
        click.connect('released', dismiss);
        backdrop.add_controller(click);
        backdrop.present();
        return backdrop;
    });
    return () => backdrops.forEach(backdrop => backdrop.destroy());
}

function read(path) {
    try { return new TextDecoder().decode(Gio.File.new_for_path(path).load_contents(null)[1]).trim(); }
    catch { return ''; }
}

async function configuredPanel(cancellable) {
    const names = desktopName();
    if (names.some(name => ['sway', 'hyprland'].includes(name))) {
        const result = await runAsync(['python3', `${ROOT}/platforms/linux/waybar_config.py`, 'get'], cancellable, 3000);
        if (result.status) throw new Error(result.stderr.trim());
        return JSON.parse(result.stdout);
    }
    if (names.includes('budgie')) {
        const root = new Gio.Settings({schema_id: 'com.solus-project.budgie-panel'});
        const panels = root.get_strv('panels').map(id => new Gio.Settings({
            schema_id: 'com.solus-project.budgie-panel.panel', path: `/com/solus-project/budgie-panel/panels/{${id}}/`}));
        const panel = panels.find(panel => panel.get_strv('applets').some(id => {
            const applet = new Gio.Settings({schema_id: 'com.solus-project.budgie-panel.applet',
                path: `/com/solus-project/budgie-panel/applets/{${id}}/`});
            return /status|tray/i.test(applet.get_string('name'));
        })) || panels[0];
        return {edge: panel?.get_string('location') || 'bottom'};
    }
    if (names.includes('cosmic')) {
        const config = (name, key) => [GLib.get_user_config_dir(), ...GLib.get_system_data_dirs()]
            .map(base => read(`${base}/cosmic/com.system76.CosmicPanel.${name}/v1/${key}`)).find(Boolean) || '';
        const name = ['Panel', 'Dock'].find(name => /StatusArea/.test(config(name, 'plugins_wings') + config(name, 'plugins_center'))) || 'Panel';
        return {edge: config(name, 'anchor').toLowerCase(), output: config(name, 'output').match(/Name\("([^"]+)"\)/)?.[1]};
    }
    return {edge: 'top'};
}

export async function anchorToPanel(window, preferredSize, cancellable, previous = null, alignment = 'center') {
    if (isX11()) {
        cancellable.set_error_if_cancelled();
        const surface = window.get_surface();
        if (!(surface instanceof GdkX11.X11Surface)) throw new Error('Usage window has not mapped.');
        window.get_display().flush();
        const scale = surface.get_scale_factor();
        const monitors = window.get_display().get_monitors();
        const screens = Array.from({length: monitors.get_n_items()}, (_, i) => {
            const rect = geometry(monitors.get_item(i));
            return Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, value * scale]));
        });
        const result = await runAsync(['python3', `${ROOT}/platforms/linux/x11Panel.py`, JSON.stringify({
            xid: surface.get_xid(), size: preferredSize.map(value => Math.ceil(value * scale)),
            screens, anchor: previous, alignment})], cancellable, 3000);
        if (result.status) throw new Error(result.stderr.trim() || 'Could not position the usage window.');
        return JSON.parse(result.stdout);
    }
    if (!hasLayerShell() || !LayerShell.is_layer_window(window))
        throw new Error('Panel popups on this Wayland desktop require gtk4-layer-shell.');

    const exact = rectangle(previous?.rect) && rectangle(previous?.work);
    const source = exact ? previous : {...previous, ...await configuredPanel(cancellable)};
    cancellable.set_error_if_cancelled();
    const list = window.get_display().get_monitors();
    const monitors = Array.from({length: list.get_n_items()}, (_, i) => list.get_item(i));
    const point = source.screen ? {x: source.screen.x + source.screen.w / 2, y: source.screen.y + source.screen.h / 2}
        : source.rect ? {x: source.rect.x + source.rect.w / 2, y: source.rect.y + source.rect.h / 2} : source.point;
    const monitor = monitors.find(m => m.get_connector() === source.monitorName || m.get_connector() === source.output)
        || monitors.find(m => contains(geometry(m), point)) || monitors[0];
    if (!monitor) throw new Error('No active monitor.');
    const screen = geometry(monitor), gap = 8;
    const edge = ['top', 'bottom', 'left', 'right'].includes(source.edge) ? source.edge : 'top';
    const vertical = edge === 'left' || edge === 'right';
    LayerShell.set_monitor(window, monitor);
    for (const side of ['LEFT', 'RIGHT', 'TOP', 'BOTTOM']) {
        LayerShell.set_anchor(window, LayerShell.Edge[side], false);
        LayerShell.set_margin(window, LayerShell.Edge[side], gap);
    }
    if (exact) {
        const work = {x: Math.max(screen.x, source.work.x), y: Math.max(screen.y, source.work.y)};
        work.w = Math.min(screen.x + screen.w, source.work.x + source.work.w) - work.x;
        work.h = Math.min(screen.y + screen.h, source.work.y + source.work.h) - work.y;
        const width = Math.max(1, Math.min(preferredSize[0], work.w - gap * 2));
        const height = Math.max(1, Math.min(preferredSize[1], work.h - gap * 2));
        const f = fraction(alignment), rect = source.rect;
        let x = rect.x + (rect.w - width) * f, y = rect.y + (rect.h - height) * f;
        if (edge === 'top') y = Math.max(rect.y + rect.h, work.y) + gap;
        if (edge === 'bottom') y = Math.min(rect.y, work.y + work.h) - height - gap;
        if (edge === 'left') x = Math.max(rect.x + rect.w, work.x) + gap;
        if (edge === 'right') x = Math.min(rect.x, work.x + work.w) - width - gap;
        x = Math.round(clamp(x, work.x + gap, work.x + work.w - width - gap));
        y = Math.round(clamp(y, work.y + gap, work.y + work.h - height - gap));
        LayerShell.set_exclusive_zone(window, -1); // Geometry already includes the panel's reservation.
        LayerShell.set_anchor(window, LayerShell.Edge.TOP, true);
        LayerShell.set_anchor(window, LayerShell.Edge.LEFT, true);
        LayerShell.set_margin(window, LayerShell.Edge.LEFT, x - screen.x);
        LayerShell.set_margin(window, LayerShell.Edge.TOP, y - screen.y);
        window.set_default_size(width, height);
    } else {
        // SNI/text modules cannot expose their icon rectangle. Pin to their
        // configured panel edge, letting the compositor exclude all panels.
        // Activation coordinates select the output only, never the position.
        LayerShell.set_exclusive_zone(window, 0);
        LayerShell.set_anchor(window, LayerShell.Edge[edge.toUpperCase()], true);
        if (alignment !== 'center') LayerShell.set_anchor(window,
            LayerShell.Edge[vertical ? alignment === 'left' ? 'TOP' : 'BOTTOM' : alignment === 'left' ? 'LEFT' : 'RIGHT'], true);
        window.set_default_size(Math.min(preferredSize[0], screen.w - gap * 2), Math.min(preferredSize[1], screen.h - 96));
    }
    return {...source, point: undefined, edge, monitorName: monitor.get_connector()};
}
