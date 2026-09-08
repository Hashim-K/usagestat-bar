import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import {ROOT} from './settings.js';
import {desktopName} from './desktop.js';

const actions = [
    ['toggle', 'Show / hide usage', 'U'],
    ['previous', 'Previous provider', 'bracketleft'],
    ['next', 'Next provider', 'bracketright'],
    ['refresh', 'Refresh usage', 'R'],
    ['preferences', 'Open preferences', 'P'],
];

// Absolute paths also work in shortcut managers that do not inherit the
// terminal's PATH. Quoting protects custom installation prefixes with spaces.
const command = action => `${GLib.shell_quote(`${ROOT}/platforms/linux/usagestat-bar`)} ${action}`;
const examples = format => actions.map(([action, description, key]) => {
    const cmd = command(action);
    if (format === 0) return `-- ${description}\nhl.bind("SUPER + ALT + ${key}", hl.dsp.exec_cmd(${JSON.stringify(cmd)}))`;
    if (format === 1) return `# ${description}\nbind = SUPER ALT, ${key}, exec, ${cmd}`;
    if (format === 2) return `# ${description}\nbindsym Mod4+Mod1+${key.toLowerCase()} exec ${cmd}`;
    return `# ${description}\nsuper + alt + ${key.toLowerCase()}\n    ${cmd}`;
}).join('\n\n');

export const ShortcutsPage = GObject.registerClass(
class ShortcutsPage extends Adw.PreferencesPage {
    _init() {
        super._init({name: 'shortcuts', title: 'Shortcuts', icon_name: 'input-keyboard-symbolic'});
        const names = desktopName();
        const keyboard = [
            [['cinnamon', 'x-cinnamon'], ['cinnamon-settings', 'keyboard']],
            [['mate'], ['mate-keybinding-properties']],
            [['xfce'], ['xfce4-keyboard-settings']],
            [['lxqt'], ['lxqt-config-globalkeyshortcuts']],
            [['kde', 'plasma'], ['systemsettings', 'kcm_keys']],
            [['budgie'], ['budgie-control-center', 'keyboard']],
            [['cosmic'], ['cosmic-settings', 'keyboard']],
            [['gnome'], ['gnome-control-center', 'keyboard']],
        ].find(([desktops]) => desktops.some(name => names.includes(name)))?.[1];
        const group = new Adw.PreferencesGroup({title: 'Global shortcuts',
            description: 'Assign these actions in your desktop’s keyboard settings. They work while another app is focused. No keys are assigned automatically.'});
        this.add(group);
        if (keyboard && GLib.find_program_in_path(keyboard[0])) {
            const row = new Adw.ActionRow({title: 'Keyboard settings', subtitle: 'Add a custom shortcut, paste an action’s command, then choose its keys.'});
            const open = new Gtk.Button({label: 'Open settings', valign: Gtk.Align.CENTER});
            open.connect('clicked', () => this.attempt(() => Gio.Subprocess.new(keyboard, Gio.SubprocessFlags.NONE)));
            row.add_suffix(open); row.activatable_widget = open; group.add(row);
        }
        for (const [action, title] of actions) {
            const row = new Adw.ActionRow({title, subtitle: `usagestat-bar ${action}`});
            const copy = new Gtk.Button({icon_name: 'edit-copy-symbolic', tooltip_text: 'Copy command', valign: Gtk.Align.CENTER});
            copy.connect('clicked', () => this.get_display().get_clipboard().set(command(action)));
            row.add_suffix(copy); row.activatable_widget = copy; group.add(row);
        }
        const config = new Adw.PreferencesGroup({title: 'Compositor bindings',
            description: 'Examples for desktops configured with a text file. Change the example keys before adding them if they conflict with your bindings.'});
        this.add(config);
        const format = new Adw.ComboRow({title: 'Configuration format',
            model: Gtk.StringList.new(['Hyprland (Lua)', 'Hyprland (.conf)', 'Sway / i3', 'bspwm (sxhkd)']),
            selected: names.includes('bspwm') ? 3 : names.some(name => ['sway', 'i3'].includes(name)) ? 2 : 0});
        config.add(format);
        const text = new Gtk.TextView({editable: false, cursor_visible: false, monospace: true,
            wrap_mode: Gtk.WrapMode.WORD_CHAR, top_margin: 12, bottom_margin: 12, left_margin: 12, right_margin: 12});
        const scroller = new Gtk.ScrolledWindow({child: text, hscrollbar_policy: Gtk.PolicyType.NEVER,
            min_content_height: 220, max_content_height: 260, propagate_natural_height: true});
        config.add(scroller);
        const update = () => text.buffer.set_text(examples(format.selected), -1);
        format.connect('notify::selected', update); update();
        const copy = new Gtk.Button({label: 'Copy example bindings', halign: Gtk.Align.START, margin_top: 8});
        copy.connect('clicked', () => this.get_display().get_clipboard().set(examples(format.selected)));
        config.add(copy);
        const hint = new Gtk.Label({label: 'Reload your compositor configuration after adding bindings. In a preview, grab the viewer’s keyboard so the host desktop does not intercept Super.',
            wrap: true, xalign: 0, margin_top: 12, css_classes: ['dim-label']});
        config.add(hint);
    }

    attempt(callback) {
        try { callback(); }
        catch (error) {
            const dialog = new Adw.MessageDialog({transient_for: this.get_root(),
                heading: 'Could not open keyboard settings', body: error.message});
            dialog.add_response('ok', 'OK'); dialog.present();
        }
    }
});
