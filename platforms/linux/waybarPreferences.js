import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {ROOT} from './settings.js';
import {runAsync} from '../../cli.js';

export function applyDesktopAppearance() {
    try {
        const [ok, bytes] = Gio.File.new_for_path(`${GLib.get_user_config_dir()}/usagestat-bar/desktop.json`).load_contents(null);
        if (!ok) return;
        const {theme} = JSON.parse(new TextDecoder().decode(bytes));
        Adw.StyleManager.get_default().color_scheme = theme === 'dark' ? Adw.ColorScheme.FORCE_DARK
            : theme === 'light' ? Adw.ColorScheme.FORCE_LIGHT : Adw.ColorScheme.DEFAULT;
    } catch { /* Follow the desktop until an appearance is selected. */ }
}

export function waybarRows(window, onChanged) {
    const choices = [
        ['edge', 'Panel placement', 'Choose the screen edge for this Waybar panel.', ['Top', 'Bottom', 'Left', 'Right'], ['top', 'bottom', 'left', 'right']],
        ['alignment', 'Provider position', 'Place UsageStat at the start, center or end of the panel.', ['Start', 'Center', 'End'], ['left', 'center', 'right']],
        ['theme', 'Desktop appearance', 'Theme for UsageStat and this Waybar panel.', ['System', 'Light', 'Dark'], ['system', 'light', 'dark']],
    ];
    const rows = choices.map(([, title, subtitle, labels]) => new Adw.ComboRow({title, subtitle,
        model: Gtk.StringList.new(labels), sensitive: false}));
    const indexRow = new Adw.SpinRow({title: 'Position index', sensitive: false,
        subtitle: 'Order among items in the selected section. 0 is first.',
        adjustment: new Gtk.Adjustment({lower: 0, upper: 0, step_increment: 1, page_increment: 1})});
    const allRows = [rows[0], rows[1], indexRow, rows[2]];
    const cancellable = new Gio.Cancellable();
    let state, updating = false, indexTimer = 0;
    window.connect('destroy', () => {
        if (indexTimer) GLib.source_remove(indexTimer);
        cancellable.cancel();
    });
    const read = async (command, value) => {
        const result = await runAsync(['python3', `${ROOT}/platforms/linux/waybar_config.py`, command,
            ...(value === undefined ? [] : [String(value)])],
            command === 'get' ? cancellable : null, 5000);
        if (result.status) throw new Error(result.stderr.trim() || 'Could not update Waybar settings.');
        return JSON.parse(result.stdout);
    };
    const update = next => {
        updating = true; state = next;
        rows.forEach((row, index) => { row.selected = Math.max(0, choices[index][4].indexOf(state[choices[index][0]])); row.sensitive = true; });
        indexRow.adjustment.upper = state.indexMax;
        indexRow.adjustment.value = state.index;
        indexRow.sensitive = state.indexMax > 0;
        indexRow.subtitle = state.indexMax > 0 ? 'Order among items in the selected section. 0 is first.'
            : 'UsageStat is the only item in this section.';
        updating = false;
    };
    const apply = async (command, value) => {
        if (updating || !state) return;
        if (indexTimer) { GLib.source_remove(indexTimer); indexTimer = 0; }
        allRows.forEach(item => { item.sensitive = false; });
        try {
            const next = await read(command, value);
            applyDesktopAppearance();
            if (cancellable.is_cancelled()) { onChanged?.(next); return; }
            update(next);
            // Waybar reloads its layer surfaces after accepting SIGUSR2.
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                if (!cancellable.is_cancelled()) onChanged?.(state);
                return GLib.SOURCE_REMOVE;
            });
        } catch (error) {
            if (cancellable.is_cancelled()) return;
            update(state);
            const dialog = new Adw.MessageDialog({transient_for: window, heading: 'Could not apply panel settings', body: error.message});
            dialog.add_response('ok', 'OK'); dialog.present();
        }
    };
    rows.forEach((row, index) => row.connect('notify::selected', () =>
        apply(choices[index][0], choices[index][4][row.selected])));
    indexRow.adjustment.connect('value-changed', () => {
        if (updating || !state) return;
        if (indexTimer) GLib.source_remove(indexTimer);
        // Coalesce repeated +/- clicks into one panel reload.
        indexTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            indexTimer = 0;
            apply('index', Math.round(indexRow.adjustment.value));
            return GLib.SOURCE_REMOVE;
        });
    });
    window.connect('close-request', () => {
        if (indexTimer) apply('index', Math.round(indexRow.adjustment.value));
        return false;
    });
    read('get').then(update).catch(error => {
        if (!cancellable.is_cancelled()) allRows.forEach(row => { row.subtitle = error.message; });
    });
    return allRows;
}
