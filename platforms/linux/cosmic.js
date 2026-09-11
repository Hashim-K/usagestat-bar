import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// COSMIC keeps panel colors independent of GTK's application color scheme.
function config(component, key) {
    for (const base of [GLib.get_user_config_dir(), ...GLib.get_system_data_dirs()]) {
        try {
            return new TextDecoder().decode(Gio.File.new_for_path(
                `${base}/cosmic/com.system76.${component}/v1/${key}`).load_contents(null)[1]).trim();
        } catch { /* Use the packaged default when there is no user override. */ }
    }
    return '';
}

export function cosmicPanel() {
    const entries = config('CosmicPanel', 'entries').match(/"([^"\\]+)"/g)?.map(name => name.slice(1, -1)) || ['Panel', 'Dock'];
    const name = entries.find(name => /UsageStatApplet/.test(config(`CosmicPanel.${name}`, 'plugins_wings')
        + config(`CosmicPanel.${name}`, 'plugins_center'))) || entries.find(name => /StatusArea/.test(config(`CosmicPanel.${name}`, 'plugins_wings')
        + config(`CosmicPanel.${name}`, 'plugins_center'))) || entries[0] || 'Panel';
    const value = key => config(`CosmicPanel.${name}`, key);
    const background = value('background');
    return {
        edge: value('anchor').toLowerCase(),
        output: value('output').match(/Name\("([^"]+)"\)/)?.[1],
        dark: background === 'Dark' || (background !== 'Light' && config('CosmicTheme.Mode', 'is_dark') !== 'false'),
    };
}
