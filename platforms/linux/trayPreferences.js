import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import {safeColor} from './model.js';

export const TrayPage = GObject.registerClass(
class TrayPage extends Adw.PreferencesPage {
    _init(settings, providers) {
        super._init({name: 'tray', title: 'Tray', icon_name: 'view-grid-symbolic'});
        this.settings = settings;
        this._externalSignals = [];
        this.providerRows = [];

        const visibility = new Adw.PreferencesGroup({title: 'Tray icons',
            description: 'Manage the small icons in your desktop’s system tray separately from the panel widget.'});
        const enabled = new Adw.SwitchRow({title: 'Show tray icons'});
        settings.bind('enabled', enabled, 'active', Gio.SettingsBindFlags.DEFAULT);
        visibility.add(enabled);
        visibility.add(this.combo('provider-mode', 'Providers shown', [
            ['active', 'Current provider (one icon)'], ['count', 'Fixed number of providers'],
            ['all', 'All enabled providers'], ['custom', 'Choose providers'],
        ]));
        this.countRow = new Adw.SpinRow({title: 'Number of providers',
            subtitle: 'Show up to this many providers at once; scroll to move through the rest.',
            adjustment: new Gtk.Adjustment({lower: 1, upper: 20, step_increment: 1, value: settings.get_int('provider-count')})});
        settings.bind('provider-count', this.countRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        visibility.add(this.countRow);
        this.scrollRow = new Adw.SwitchRow({title: 'Scroll to switch provider',
            subtitle: 'Scroll over any rotating tray icon to switch providers.'});
        settings.bind('scroll-to-switch-provider', this.scrollRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        visibility.add(this.scrollRow);
        this.add(visibility);

        this.providersGroup = new Adw.PreferencesGroup({title: 'Visible providers',
            description: 'Each selected provider gets its own icon. Your desktop controls icon placement and order.'});
        this.add(this.providersGroup);

        const appearance = new Adw.PreferencesGroup({title: 'Icon appearance'});
        appearance.add(this.combo('icon-style', 'Icon content', [
            ['logo-meter', 'Logo with usage bar'], ['logo-fill', 'Logo filled by usage'],
            ['logo', 'Logo only'], ['percentage', 'Usage number'],
        ]));
        this.logoRow = this.combo('logo-style', 'Logo colors', [
            ['monochromatic', 'Monochrome'], ['color', 'Provider colors'],
        ]);
        appearance.add(this.logoRow);
        this.fillRow = this.combo('logo-fill-mode', 'Logo fill', [
            ['vertical', 'Vertical'], ['horizontal', 'Horizontal'], ['pie', 'Pie'],
        ]);
        appearance.add(this.fillRow);
        this.orientationRow = this.combo('bar-orientation', 'Usage bar orientation', [
            ['horizontal', 'Horizontal'], ['vertical', 'Vertical'],
        ]);
        appearance.add(this.orientationRow);
        this.thicknessRow = new Adw.SpinRow({title: 'Usage bar thickness',
            subtitle: 'Scales with the tray icon size.',
            adjustment: new Gtk.Adjustment({lower: 2, upper: 8, step_increment: 1, value: settings.get_int('bar-thickness')})});
        settings.bind('bar-thickness', this.thicknessRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        appearance.add(this.thicknessRow);
        const foreground = this.combo('foreground', 'Icon contrast', [
            ['auto', 'Automatic'], ['light', 'Light icons'], ['dark', 'Dark icons'],
        ]);
        foreground.subtitle = 'Match the tray background if it differs from the desktop theme.';
        appearance.add(foreground);
        this.colorRow = new Adw.ActionRow({title: 'Usage bar color',
            subtitle: 'Warning and error states keep their status colors.'});
        this.colorButton = new Gtk.ColorDialogButton({dialog: new Gtk.ColorDialog({with_alpha: false}), valign: Gtk.Align.CENTER});
        this.colorRow.add_suffix(this.colorButton);
        this.colorRow.activatable_widget = this.colorButton;
        this.colorButton.connect('notify::rgba', () => {
            const rgba = this.colorButton.rgba;
            const color = '#' + [rgba.red, rgba.green, rgba.blue].map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('');
            if (settings.get_string('accent-color') !== color) settings.set_string('accent-color', color);
        });
        appearance.add(this.colorRow);
        this.add(appearance);

        this._externalSignals.push([settings, settings.connect('changed', () => this.syncSettings())]);
        this.updateProviders(providers);
        this.syncSettings();
    }

    combo(key, title, choices) {
        const values = choices.map(([value]) => value);
        const row = new Adw.ComboRow({title, model: Gtk.StringList.new(choices.map(([, label]) => label)),
            selected: Math.max(0, values.indexOf(this.settings.get_string(key)))});
        row.connect('notify::selected', () => {
            const value = values[row.selected];
            if (value && this.settings.get_string(key) !== value) this.settings.set_string(key, value);
        });
        this._externalSignals.push([this.settings, this.settings.connect(`changed::${key}`, () => {
            row.selected = Math.max(0, values.indexOf(this.settings.get_string(key)));
        })]);
        return row;
    }

    updateProviders(providers) {
        if (this._closed) return;
        const visible = providers.filter(provider => !provider.parent);
        const signature = JSON.stringify(visible.map(provider => [provider.key, provider.name]));
        if (signature === this._providers) return;
        this._providers = signature;
        for (const row of this.providerRows) this.providersGroup.remove(row);
        this.providerRows = [];
        const selected = new Set(this.settings.get_strv('providers'));
        for (const provider of visible) {
            const row = new Adw.SwitchRow({title: provider.name, use_markup: false, active: selected.has(provider.key)});
            row.providerKey = provider.key;
            row.connect('notify::active', () => {
                const keys = new Set(this.settings.get_strv('providers'));
                if (keys.has(provider.key) === row.active) return;
                if (row.active) keys.add(provider.key);
                else keys.delete(provider.key);
                this.settings.set_strv('providers', [...keys]);
            });
            this.providerRows.push(row);
            this.providersGroup.add(row);
        }
        if (!visible.length) {
            const empty = new Adw.ActionRow({title: 'No enabled providers', subtitle: 'Enable providers on the Providers page.', sensitive: false});
            this.providerRows.push(empty);
            this.providersGroup.add(empty);
        }
    }

    syncSettings() {
        if (this._closed) return;
        const mode = this.settings.get_string('provider-mode');
        const style = this.settings.get_string('icon-style');
        this.providersGroup.visible = mode === 'custom';
        this.countRow.visible = mode === 'count';
        this.scrollRow.sensitive = mode === 'active' || mode === 'count';
        this.logoRow.sensitive = style !== 'percentage';
        this.fillRow.visible = style === 'logo-fill';
        this.orientationRow.visible = this.thicknessRow.visible = this.colorRow.visible = style === 'logo-meter';
        const selected = new Set(this.settings.get_strv('providers'));
        for (const row of this.providerRows) if (row.providerKey) row.active = selected.has(row.providerKey);
        const rgba = new Gdk.RGBA();
        rgba.parse(safeColor(this.settings.get_string('accent-color')));
        if (!this.colorButton.rgba.equal(rgba)) this.colorButton.rgba = rgba;
    }
});
