import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {loadConfig, PROVIDERS, saveConfig} from './config.js';

const SOURCE_OPTIONS = ['auto', 'web', 'cli', 'oauth', 'api'];
const EXTENSION_DIR = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);

function combo(strings, selectedValue) {
    const row = new Adw.ComboRow({
        model: new Gtk.StringList({strings}),
        selected: Math.max(0, strings.indexOf(selectedValue)),
    });
    row._values = strings;
    return row;
}

function entryRow(title, value, placeholder, secret = false) {
    const row = new Adw.ActionRow({title});
    const entry = secret
        ? new Gtk.PasswordEntry({text: value || '', placeholder_text: placeholder || ''})
        : new Gtk.Entry({text: value || '', placeholder_text: placeholder || '', hexpand: true});
    entry.valign = Gtk.Align.CENTER;
    entry.width_chars = 34;
    row.add_suffix(entry);
    row.activatable_widget = entry;
    row._entry = entry;
    return row;
}

function rgbaFromHex(hex) {
    const rgba = new Gdk.RGBA();
    if (!rgba.parse(hex))
        rgba.parse('#8ab4f8');
    return rgba;
}

function hexFromRgba(rgba) {
    const channel = value => Math.round(Math.max(0, Math.min(1, value)) * 255)
        .toString(16)
        .padStart(2, '0');
    return `#${channel(rgba.red)}${channel(rgba.green)}${channel(rgba.blue)}`;
}

const GeneralPage = GObject.registerClass(
class GeneralPage extends Adw.PreferencesPage {
    _init(settings) {
        super._init({
            title: _('Display'),
            icon_name: 'preferences-desktop-display-symbolic',
        });

        this._settings = settings;
        this.add(this._buildPanelGroup());
        this.add(this._buildColorGroup());
    }

    _buildPanelGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('Panel'),
            description: _('GNOME-specific placement and compact display controls.'),
        });

        const refreshRow = new Adw.SpinRow({
            title: _('Refresh interval'),
            subtitle: _('Minutes between CodexBar CLI refreshes'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 1440,
                step_increment: 1,
                value: this._settings.get_int('refresh-interval'),
            }),
        });
        this._settings.bind('refresh-interval', refreshRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(refreshRow);

        const positionRow = combo([_('Left'), _('Center'), _('Right')], {
            left: _('Left'),
            center: _('Center'),
            right: _('Right'),
        }[this._settings.get_string('panel-position')] || _('Right'));
        positionRow.title = _('Panel position');
        positionRow.connect('notify::selected', () => {
            this._settings.set_string('panel-position', ['left', 'center', 'right'][positionRow.selected] || 'right');
        });
        group.add(positionRow);

        const indexRow = new Adw.SpinRow({
            title: _('Position index'),
            subtitle: _('Lower values sit closer to the panel edge for that box'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 20,
                step_increment: 1,
                value: this._settings.get_int('panel-index'),
            }),
        });
        this._settings.bind('panel-index', indexRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(indexRow);

        const displayModeRow = combo([_('Remaining'), _('Used')], this._settings.get_string('display-mode') === 'used' ? _('Used') : _('Remaining'));
        displayModeRow.title = _('Meter meaning');
        displayModeRow.connect('notify::selected', () => {
            this._settings.set_string('display-mode', displayModeRow.selected === 1 ? 'used' : 'remaining');
        });
        group.add(displayModeRow);

        const styleRow = combo([_('Meter'), _('Percent'), _('Label only')], {
            meter: _('Meter'),
            percent: _('Percent'),
            label: _('Label only'),
        }[this._settings.get_string('indicator-style')] || _('Meter'));
        styleRow.title = _('Panel style');
        styleRow.connect('notify::selected', () => {
            this._settings.set_string('indicator-style', ['meter', 'percent', 'label'][styleRow.selected] || 'meter');
        });
        group.add(styleRow);

        const labelRow = new Adw.SwitchRow({
            title: _('Show panel text'),
            active: this._settings.get_boolean('show-label'),
        });
        this._settings.bind('show-label', labelRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(labelRow);

        const overviewRow = new Adw.SwitchRow({
            title: _('Show overview tab'),
            subtitle: _('Mirrors CodexBar merge-icons overview for multiple providers'),
            active: this._settings.get_boolean('show-overview'),
        });
        this._settings.bind('show-overview', overviewRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(overviewRow);

        return group;
    }

    _buildColorGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('Colors'),
            description: _('Pick a color or type a CSS hex value such as #8ab4f8.'),
        });

        for (const [key, title] of [
            ['accent-color', _('Normal')],
            ['warning-color', _('Warning')],
            ['danger-color', _('Danger')],
            ['neutral-color', _('Text and outline')],
        ]) {
            const row = this._buildColorRow(key, title);
            group.add(row);
        }

        return group;
    }

    _buildColorRow(key, title) {
        const row = new Adw.ActionRow({
            title,
            subtitle: this._settings.get_string(key),
        });

        const entry = new Gtk.Entry({
            text: this._settings.get_string(key),
            placeholder_text: '#8ab4f8',
            width_chars: 9,
            max_width_chars: 9,
            valign: Gtk.Align.CENTER,
        });

        const colorButton = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({with_alpha: false}),
            rgba: rgbaFromHex(this._settings.get_string(key)),
            valign: Gtk.Align.CENTER,
        });

        const applyHex = value => {
            if (!/^#[0-9a-fA-F]{6}$/.test(value))
                return;
            const normalized = value.toLowerCase();
            if (this._settings.get_string(key) !== normalized)
                this._settings.set_string(key, normalized);
            row.set_subtitle(normalized);
            if (entry.get_text() !== normalized)
                entry.set_text(normalized);
            colorButton.set_rgba(rgbaFromHex(normalized));
        };

        entry.connect('changed', () => applyHex(entry.get_text().trim()));
        colorButton.connect('notify::rgba', () => applyHex(hexFromRgba(colorButton.get_rgba())));

        row.add_suffix(entry);
        row.add_suffix(colorButton);
        row.activatable_widget = colorButton;
        return row;
    }
});

const ProvidersPage = GObject.registerClass(
class ProvidersPage extends Adw.PreferencesPage {
    _init() {
        super._init({
            title: _('Providers'),
            icon_name: 'view-grid-symbolic',
        });

        this._config = loadConfig();
        this._save();
        this._providerList = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
        });
        this._providerList.add_css_class('boxed-list');

        this._group = new Adw.PreferencesGroup({
            title: _('CodexBar Providers'),
            description: _('Drag providers to reorder. Disabled providers are kept at the bottom.'),
        });
        this._group.add(new Adw.PreferencesRow({child: this._providerList}));
        this.add(this._group);
        this._renderProviders();
    }

    _provider(id) {
        let provider = this._config.providers.find(item => item.id === id);
        if (!provider) {
            provider = {id, enabled: false, source: 'auto', cookieSource: 'auto'};
            this._config.providers.push(provider);
        }
        return provider;
    }

    _save() {
        this._config.providers.sort((a, b) => {
            if ((a.enabled !== false) !== (b.enabled !== false))
                return a.enabled === false ? 1 : -1;
            return 0;
        });
        saveConfig(this._config);
    }

    _renderProviders(expandedId = null) {
        while (this._providerList.get_first_child())
            this._providerList.remove(this._providerList.get_first_child());

        for (const provider of this._orderedProviders()) {
            this._providerList.append(this._buildProviderListRow(provider, expandedId));
        }
    }

    _orderedProviders() {
        for (const [id] of PROVIDERS)
            this._provider(id);
        return this._config.providers;
    }

    _buildProviderListRow(provider, expandedId) {
        const listRow = new Gtk.ListBoxRow();
        listRow._providerId = provider.id;

        const row = new Adw.ExpanderRow({
            title: this._name(provider.id),
            subtitle: provider.enabled === false ? _('Disabled') : this._subtitle(provider),
            expanded: expandedId === provider.id || (expandedId === null && provider.enabled !== false && provider.id === 'codex'),
        });

        row.add_prefix(new Gtk.Image({
            icon_name: 'list-drag-handle-symbolic',
            tooltip_text: _('Drag to reorder'),
        }));

        const enabled = new Gtk.Switch({
            active: provider.enabled !== false,
            valign: Gtk.Align.CENTER,
        });
        enabled.connect('notify::active', () => {
            provider.enabled = enabled.active;
            row.set_subtitle(provider.enabled ? this._subtitle(provider) : _('Disabled'));
            this._save();
            this._renderProviders(provider.id);
        });
        row.add_suffix(enabled);

        const sourceRow = combo(SOURCE_OPTIONS, provider.source || 'auto');
        sourceRow.title = _('Source');
        sourceRow.subtitle = this._sourceSubtitle(provider.id, provider.source || 'auto');
        sourceRow.connect('notify::selected', () => {
            provider.source = SOURCE_OPTIONS[sourceRow.selected] || 'auto';
            row.set_subtitle(this._subtitle(provider));
            this._save();
            this._renderProviders(provider.id);
        });
        row.add_row(sourceRow);

        this._addRelevantRows(row, provider);

        listRow.set_child(row);
        this._setupDragAndDrop(listRow);
        return listRow;
    }

    _addRelevantRows(row, provider) {
        const source = provider.source || 'auto';

        if (provider.id === 'codex' && (source === 'auto' || source === 'web')) {
            this._addCodexAutoLoginRows(row, provider);
            return;
        }

        if (source === 'api' || this._apiKeyProviders().has(provider.id)) {
            const apiKeyRow = entryRow(_('API key'), provider.apiKey || '', _('Provider API token'), true);
            apiKeyRow._entry.connect('changed', () => {
                this._assignOptional(provider, 'apiKey', apiKeyRow._entry.get_text());
            });
            row.add_row(apiKeyRow);
        }

        if (source === 'web') {
            const cookieHeaderRow = entryRow(_('Cookie header'), provider.cookieHeader || '', _('name=value; other=value'), true);
            cookieHeaderRow._entry.connect('changed', () => {
                this._assignOptional(provider, 'cookieHeader', cookieHeaderRow._entry.get_text());
                if (cookieHeaderRow._entry.get_text().trim())
                    provider.cookieSource = 'manual';
            });
            row.add_row(cookieHeaderRow);
        }

        if (['zai', 'minimax', 'alibaba'].includes(provider.id)) {
            const regionRow = entryRow(_('Region'), provider.region || '', _('Provider-specific region'));
            regionRow._entry.connect('changed', () => this._assignOptional(provider, 'region', regionRow._entry.get_text()));
            row.add_row(regionRow);
        }

        if (['opencode', 'opencodego'].includes(provider.id)) {
            const workspaceRow = entryRow(_('Workspace ID'), provider.workspaceID || '', _('Provider-specific workspace'));
            workspaceRow._entry.connect('changed', () => this._assignOptional(provider, 'workspaceID', workspaceRow._entry.get_text()));
            row.add_row(workspaceRow);
        }

        if (source === 'cli' || source === 'oauth' || source === 'auto') {
            const note = new Adw.ActionRow({
                title: source === 'auto' ? _('Automatic source') : _('%s source').format(source),
                subtitle: source === 'auto'
                    ? _('CodexBar CLI will use the provider fallback order.')
                    : _('No extra GNOME-side fields are needed for this source.'),
            });
            row.add_row(note);
        }
    }

    _addCodexAutoLoginRows(row, provider) {
        const cookieRow = entryRow(_('Session cookies'), provider.cookieHeader || '', _('ChatGPT Cookie header'), true);
        cookieRow._entry.connect('changed', () => {
            this._assignOptional(provider, 'cookieHeader', cookieRow._entry.get_text());
            if (cookieRow._entry.get_text().trim())
                provider.cookieSource = 'manual';
        });
        row.add_row(cookieRow);

        const importRow = new Adw.ActionRow({
            title: _('Auto-Login from Browser'),
            subtitle: _('Imports ChatGPT cookies from Chrome or Brave, matching the original GNOME wrapper.'),
        });
        const importButton = new Gtk.Button({
            label: _('Import'),
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
        });
        importButton.connect('clicked', () => this._importCodexCookies(provider, cookieRow._entry));
        importRow.add_suffix(importButton);
        row.add_row(importRow);
    }

    _setupDragAndDrop(listRow) {
        const drag = new Gtk.DragSource({
            actions: Gdk.DragAction.MOVE,
        });
        drag.connect('prepare', () => {
            const value = new GObject.Value();
            value.init(GObject.TYPE_STRING);
            value.set_string(listRow._providerId);
            return Gdk.ContentProvider.new_for_value(value);
        });
        listRow.add_controller(drag);

        const drop = Gtk.DropTarget.new(GObject.TYPE_STRING, Gdk.DragAction.MOVE);
        drop.connect('drop', (target, sourceId) => {
            this._moveProvider(String(sourceId), listRow._providerId);
            return true;
        });
        listRow.add_controller(drop);
    }

    _moveProvider(sourceId, targetId) {
        if (!sourceId || !targetId || sourceId === targetId)
            return;

        const providers = this._config.providers;
        const sourceIndex = providers.findIndex(provider => provider.id === sourceId);
        const targetIndex = providers.findIndex(provider => provider.id === targetId);
        if (sourceIndex < 0 || targetIndex < 0)
            return;

        const [provider] = providers.splice(sourceIndex, 1);
        providers.splice(targetIndex, 0, provider);
        this._save();
        this._renderProviders(provider.id);
    }

    _assignOptional(provider, key, raw) {
        const value = raw.trim();
        if (value)
            provider[key] = value;
        else
            delete provider[key];
        this._save();
    }

    _subtitle(provider) {
        return _('Enabled, %s source').format(provider.source || 'auto');
    }

    _sourceSubtitle(providerId, source) {
        if (providerId === 'codex' && source === 'auto')
            return _('Uses browser auto-login first, then CodexBar fallback behavior.');
        return _('auto mirrors CodexBar fallback behavior');
    }

    _apiKeyProviders() {
        return new Set(['gemini', 'copilot', 'zai', 'minimax', 'kimi', 'kimik2', 'kilo', 'warp', 'openrouter', 'synthetic', 'deepseek', 'codebuff', 'alibaba', 'mistral']);
    }

    _name(id) {
        return PROVIDERS.find(([providerId]) => providerId === id)?.[1] || id;
    }

    async _importCodexCookies(provider, entry) {
        const path = GLib.build_filenamev([EXTENSION_DIR, 'cookie_importer.py']);

        try {
            const proc = Gio.Subprocess.new(
                ['python3', path],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            );
            const [, stdout, stderr] = await new Promise((resolve, reject) => {
                proc.communicate_utf8_async(null, null, (process, result) => {
                    try {
                        resolve(process.communicate_utf8_finish(result));
                    } catch (error) {
                        reject(error);
                    }
                });
            });

            const text = stdout.trim();
            if (!text)
                throw new Error(stderr.trim() || _('No cookies were imported.'));

            const payload = JSON.parse(text);
            if (payload.cookie_header) {
                provider.cookieHeader = payload.cookie_header;
                provider.cookieSource = 'manual';
                entry.set_text(payload.cookie_header);
                this._save();
            } else {
                throw new Error(payload.message || payload.error || _('No ChatGPT cookies found.'));
            }
        } catch (error) {
            const dialog = new Adw.MessageDialog({
                transient_for: this.get_root(),
                modal: true,
                heading: _('Could not import cookies'),
                body: error.message || String(error),
            });
            dialog.add_response('ok', _('OK'));
            dialog.present();
        }
    }
});

const MaintenancePage = GObject.registerClass(
class MaintenancePage extends Adw.PreferencesPage {
    _init() {
        super._init({
            title: _('Tools'),
            icon_name: 'applications-system-symbolic',
        });
        this.add(this._buildGroup());
    }

    _buildGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('CodexBar CLI'),
        });

        for (const [title, command] of [
            [_('Validate config'), 'codexbar config validate'],
            [_('Dump normalized config'), 'codexbar config dump --pretty'],
            [_('Clear cookie cache'), 'codexbar cache clear --cookies'],
        ]) {
            const row = new Adw.ActionRow({
                title,
                subtitle: command,
            });
            const button = new Gtk.Button({
                icon_name: 'utilities-terminal-symbolic',
                valign: Gtk.Align.CENTER,
            });
            button.connect('clicked', () => {
                GLib.spawn_command_line_async(`bash -lc '${command.replaceAll("'", "'\\''")}; read -p "Press enter to close..."'`);
            });
            row.add_suffix(button);
            group.add(row);
        }

        const docsRow = new Adw.ActionRow({
            title: _('CodexBar docs'),
            subtitle: _('Provider setup and config schema'),
        });
        const docsButton = new Gtk.Button({
            icon_name: 'help-browser-symbolic',
            valign: Gtk.Align.CENTER,
        });
        docsButton.connect('clicked', () => {
            Gio.app_info_launch_default_for_uri('https://github.com/steipete/CodexBar/tree/main/docs', null);
        });
        docsRow.add_suffix(docsButton);
        group.add(docsRow);

        return group;
    }
});

export default class AIUsageBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(760, 760);
        window.add(new GeneralPage(settings));
        window.add(new ProvidersPage());
        window.add(new MaintenancePage());
    }
}
