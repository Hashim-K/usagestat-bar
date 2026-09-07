import GLib from 'gi://GLib';
import {runAsync} from '../../cli.js';
import {BUS} from './protocol.js';
import {desktopName} from './desktop.js';

export function canAnchorToPanel() {
    return Boolean(GLib.find_program_in_path('hyprctl') &&
        (GLib.getenv('HYPRLAND_INSTANCE_SIGNATURE') || desktopName().includes('hyprland')));
}

const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
const contains = (rect, point) => point.x >= rect.x && point.x < rect.x + rect.w &&
    point.y >= rect.y && point.y < rect.y + rect.h;
const distance = (rect, point) => Math.hypot(point.x - clamp(point.x, rect.x, rect.x + rect.w),
    point.y - clamp(point.y, rect.y, rect.y + rect.h));

function monitorRect(monitor) {
    // Hyprland reports physical mode dimensions and logical layout coordinates.
    const rotated = monitor.transform % 2 === 1;
    return {x: monitor.x, y: monitor.y,
        w: (rotated ? monitor.height : monitor.width) / monitor.scale,
        h: (rotated ? monitor.width : monitor.height) / monitor.scale};
}

async function hyprctl(args, cancellable) {
    const result = await runAsync(['hyprctl', ...args], cancellable, 2000);
    if (result.status !== 0) throw new Error(result.stderr.trim() || 'Hyprland did not respond.');
    return result.stdout;
}

export async function anchorToPanel(window, preferredSize, cancellable, previous = null) {
    const info = async name => JSON.parse(await hyprctl(['-j', name], cancellable));
    const [cursor, initialClients] = await Promise.all([previous?.cursor || info('cursorpos'), info('clients')]);
    // GTK maps asynchronously. Resolve this particular window, never whichever
    // app happens to have focus while a panel click is being handled.
    const findWindow = clients => clients.find(client => client.mapped && client.class === BUS && client.title === window.title);
    let client = findWindow(initialClients);
    for (let attempt = 0; !client && attempt < 10; attempt++) {
        await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
            resolve(); return GLib.SOURCE_REMOVE;
        }));
        cancellable.set_error_if_cancelled();
        client = findWindow(await info('clients'));
    }
    if (!client || !/^0x[\da-f]+$/i.test(client.address)) throw new Error('Usage window has not mapped.');
    const [monitors, layers] = await Promise.all([info('monitors'), info('layers')]);
    cancellable.set_error_if_cancelled();
    const monitor = monitors.find(m => m.name === previous?.monitorName) || monitors.find(m => contains(monitorRect(m), cursor))
        || monitors.find(m => m.focused) || monitors[0];
    if (!monitor) throw new Error('No active monitor.');
    const screen = monitorRect(monitor);
    const [left, top, right, bottom] = monitor.reserved || [0, 0, 0, 0];
    const work = {x: screen.x + left, y: screen.y + top,
        w: screen.w - left - right, h: screen.h - top - bottom};
    const gap = 8;
    const width = Math.max(1, Math.floor(Math.min(preferredSize[0] > 0 ? preferredSize[0] : 460, work.w - gap * 2)));
    const height = Math.max(1, Math.floor(Math.min(preferredSize[1] > 0 ? preferredSize[1] : 680, work.h - gap * 2)));
    const bars = Object.values(layers[monitor.name]?.levels || {}).flat()
        .filter(layer => layer.namespace === 'waybar' && layer.w > 0 && layer.h > 0)
        // Layer geometry is monitor-local; cursor and window moves are global.
        .map(layer => ({...layer, x: layer.x + screen.x, y: layer.y + screen.y}));
    bars.sort((a, b) => distance(a, cursor) - distance(b, cursor));
    const bar = bars[0];
    let x = work.x + gap, y = work.y + gap;
    if (bar) {
        // A startup/keyboard opening has no click point: use the panel's start.
        const fraction = {left: 0, center: 0.5, right: 1}[previous?.alignment];
        const point = fraction !== undefined ? {x: bar.x + bar.w * fraction, y: bar.y + bar.h * fraction}
            : contains(bar, cursor) ? cursor : {x: bar.x, y: bar.y};
        if (bar.w >= bar.h) {
            x = point.x - width / 2;
            y = bar.y + bar.h / 2 < screen.y + screen.h / 2 ? bar.y + bar.h + gap : bar.y - height - gap;
        } else {
            x = bar.x + bar.w / 2 < screen.x + screen.w / 2 ? bar.x + bar.w + gap : bar.x - width - gap;
            y = point.y - height / 2;
        }
    }
    x = Math.round(clamp(x, work.x + gap, work.x + work.w - width - gap));
    y = Math.round(clamp(y, work.y + gap, work.y + work.h - height - gap));

    const target = `address:${client.address}`;
    const commands = [[`setfloating ${target}`, `float({action='enable',window='${target}'})`]];
    if (monitor.activeWorkspace?.id > 0 && client.workspace.id !== monitor.activeWorkspace.id) {
        commands.push([`movetoworkspacesilent ${monitor.activeWorkspace.id},${target}`,
            `move({workspace=${monitor.activeWorkspace.id},follow=false,window='${target}'})`]);
    }
    commands.push([`resizewindowpixel exact ${width} ${height},${target}`,
        `resize({x=${width},y=${height},relative=false,window='${target}'})`],
    [`movewindowpixel exact ${x} ${y},${target}`, `move({x=${x},y=${y},relative=false,window='${target}'})`]);
    // Lua sessions changed the dispatch grammar. Use their API directly, with
    // a legacy fallback for older releases and sessions still using .conf.
    let response = await hyprctl(['eval', commands.map(([, lua]) => `hl.dispatch(hl.dsp.window.${lua})`).join('\n')], cancellable);
    if (/eval is only supported with the lua config manager|unknown request/i.test(response))
        response = await hyprctl(['--batch', commands.map(([legacy]) => `dispatch ${legacy}`).join(';')], cancellable);
    if (response.split('\n').some(line => line.trim() && line.trim() !== 'ok'))
        throw new Error(response.trim());
    return {cursor, monitorName: monitor.name, alignment: previous?.alignment};
}
