import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {waybarRows} from './waybarPreferences.js';

export function desktopName() {
    return (GLib.getenv('XDG_CURRENT_DESKTOP') || GLib.getenv('XDG_SESSION_DESKTOP') || '').toLowerCase().split(':');
}

export function trayDesktop() {
    return desktopName().some(name => ['lxqt', 'budgie', 'cosmic'].includes(name));
}

function launch(argv) {
    const program = GLib.find_program_in_path(argv[0]);
    if (!program) throw new Error(`Install ${argv[0]} to open these desktop settings.`);
    Gio.Subprocess.new([program, ...argv.slice(1)], Gio.SubprocessFlags.STDOUT_SILENCE);
}

function action(title, subtitle, argv) {
    const installed = GLib.find_program_in_path(argv[0]);
    return {title, subtitle: installed ? subtitle : `${subtitle} Install ${argv[0]} to open it here.`,
        label: 'Open settings', run: installed ? () => launch(argv) : null};
}

export function desktopActions(window, onChanged) {
    const names = desktopName();
    if (names.some(name => ['kde', 'plasma'].includes(name))) return [
        {title: 'Panel placement', subtitle: 'Open Plasma edit mode to move or resize the panel and its widgets.', label: 'Edit panel',
            run: () => new Promise((resolve, reject) => {
                Gio.DBus.session.call('org.kde.plasmashell', '/PlasmaShell', 'org.freedesktop.DBus.Properties', 'Set',
                    new GLib.Variant('(ssv)', ['org.kde.PlasmaShell', 'editMode', new GLib.Variant('b', true)]),
                    null, Gio.DBusCallFlags.NONE, 5000, null, (connection, result) => {
                        try { connection.call_finish(result); window.hide(); resolve(); }
                        catch (error) { reject(error); }
                    });
            })},
        action('Desktop appearance', 'Change the Plasma color scheme.',
            [GLib.find_program_in_path('systemsettings') ? 'systemsettings' : 'kcmshell6', 'kcm_colors']),
    ];
    if (names.some(name => ['x-cinnamon', 'cinnamon'].includes(name))) return [
        action('Panel placement', 'Move or resize the Cinnamon panel.', ['cinnamon-settings', 'panel']),
        action('Desktop appearance', 'Change Cinnamon themes and colors.', ['cinnamon-settings', 'themes']),
    ];
    if (names.includes('xfce')) return [
        action('Panel placement', 'Move, resize or arrange items in the Xfce panel.', ['xfce4-panel', '--preferences']),
        action('Desktop appearance', 'Change the Xfce style and icons.', ['xfce4-appearance-settings']),
    ];
    if (names.includes('mate')) return [
        {title: 'Panel placement', subtitle: 'Right-click an empty area of the MATE panel and choose Properties. Unlock an applet to move it.'},
        action('Desktop appearance', 'Change the MATE theme and icons.', ['mate-appearance-properties']),
    ];
    if (names.includes('lxqt')) return [
        {title: 'Panel placement', subtitle: 'Right-click an empty area of the LXQt panel and choose Configure Panel.'},
        action('Desktop appearance', 'Change the LXQt panel theme, colors and icons.', ['lxqt-config-appearance']),
    ];
    if (names.includes('budgie')) return [
        action('Panel placement', 'Arrange panels and applets in Budgie Desktop Settings.', ['budgie-desktop-settings']),
        action('Desktop appearance', 'Change the widget, icon and desktop styles.', ['budgie-desktop-settings']),
    ];
    if (names.includes('cosmic')) return [
        action('Panel placement', 'Open Desktop settings to arrange the COSMIC panel and dock.', ['cosmic-settings']),
        action('Desktop appearance', 'Choose Appearance in COSMIC Settings.', ['cosmic-settings']),
    ];
    if (names.some(name => ['sway', 'hyprland'].includes(name))) return [{rows: waybarRows(window, onChanged)}];
    const bar = names.some(name => ['sway', 'hyprland'].includes(name)) ? 'Waybar'
        : names.some(name => ['i3', 'bspwm'].includes(name)) ? 'Polybar' : '';
    if (bar) return [
        {title: 'Panel placement', subtitle: bar === 'Waybar'
            ? 'Set position and modules-left, modules-center or modules-right in your Waybar configuration.'
            : 'Place usagestat in modules-left, modules-center or modules-right in your Polybar configuration.'},
        {title: 'Desktop appearance', subtitle: bar === 'Waybar'
            ? 'Your Waybar stylesheet controls the panel background and text color.'
            : 'Your Polybar configuration controls the panel background and text color.'},
    ];
    return [];
}
