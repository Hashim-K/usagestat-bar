import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {findAiUsage} from './cli.js';
import {configPath, DEFAULT_HIDDEN_IDS, loadConfig, makeProviderInstanceId, providerBaseId, providerDisplayName, providerKey, PROVIDERS, saveConfig} from './config.js';

const SOURCE_OPTIONS = ['auto', 'web', 'cli', 'oauth', 'api', 'local'];
const BUILTIN_PROVIDER_IDS = new Set(PROVIDERS.map(([id]) => id));
const CUSTOM_PROVIDER_VALUE = '__custom_provider__';
const TIERS = ['primary', 'secondary', 'tertiary', 'quaternary'];
const VALIDATION_TIMEOUT_SECONDS = 90;
const VALIDATION_DEBOUNCE_SECONDS = 10;
const PANEL_COMPONENTS = [
    ['bar', 'Usage bar'],
    ['percent', 'Usage %'],
    ['logo', 'Logo'],
    ['text', 'Text'],
];
const ICON_STYLE_OPTIONS = [
    ['auto', 'Default'],
    ['color', 'Color'],
    ['monochromatic', 'Monochromatic'],
];
const PROVIDER_ICON_FILES = {
    codex: 'codex.svg',
    openai: 'openai.svg',
    abacus: 'abacus.svg',
    alibaba: 'alibaba.svg',
    claude: 'claude.svg',
    claudecode: 'claudecode.svg',
    bedrock: 'bedrock.svg',
    commandcode: 'commandcode.svg',
    cursor: 'cursor.svg',
    elevenlabs: 'elevenlabs.svg',
    factory: 'factory.svg',
    gemini: 'gemini.svg',
    copilot: 'copilot.svg',
    githubcopilot: 'githubcopilot.svg',
    opencode: 'opencode-go.svg',
    opencodego: 'opencode-go.svg',
    'opencode-go': 'opencode-go.svg',
    antigravity: 'antigravity.svg',
    zai: 'zai.svg',
    manus: 'manus.svg',
    mimo: 'mimo.svg',
    minimax: 'minimax.svg',
    kimi: 'kimi.svg',
    'kimi-k2': 'kimi.svg',
    kilo: 'kilo.svg',
    kiro: 'kiro.svg',
    augment: 'augment.svg',
    jetbrains: 'jetbrains-ai-assistant.svg',
    'jetbrains-ai-assistant': 'jetbrains-ai-assistant.svg',
    amp: 'amp.svg',
    ollama: 'ollama.svg',
    warp: 'warp.svg',
    openrouter: 'openrouter.svg',
    perplexity: 'perplexity.svg',
    mistral: 'mistral.svg',
    deepseek: 'deepseek.svg',
    codebuff: 'codebuff.svg',
    crof: 'crof.svg',
    doubao: 'doubao.svg',
    nanogpt: 'nanogpt.svg',
    synthetic: 'synthetic.svg',
    stepfun: 'stepfun.svg',
    venice: 'venice.svg',
    vertexai: 'vertexai.svg',
    windsurf: 'windsurf.svg',
    'openai-api': 'openai.svg',
};
const DEFAULT_THRESHOLDS = [
    {id: 'warning', label: 'Warning', percent: 75, color: '#f6d32d', notify: false},
    {id: 'danger', label: 'Danger', percent: 90, color: '#ff5f57', notify: false},
    {id: 'limit', label: 'Limit reached', percent: 100, color: '#ff2d55', notify: false},
];
const PROVIDER_LOGIN_URLS = {
    augment: 'https://app.augmentcode.com/account',
    claude: 'https://claude.ai/',
    codebuff: 'https://www.codebuff.com/usage',
    codex: 'https://chatgpt.com/',
    crof: 'https://crof.ai',
    cursor: 'https://www.cursor.com/dashboard',
    deepseek: 'https://platform.deepseek.com/usage',
    doubao: 'https://console.volcengine.com/ark/region:ark+cn-beijing/usage',
    kilo: 'https://app.kilo.ai/usage',
    'kimi-k2': 'https://platform.moonshot.cn',
    mistral: 'https://admin.mistral.ai/organization/usage',
    nanogpt: 'https://nano-gpt.com/usage',
    ollama: 'https://ollama.com/settings',
    'openai-api': 'https://platform.openai.com/usage',
    'opencode-go': 'https://opencode.ai/auth',
    synthetic: 'https://synthetic.new/landing/home',
};

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
    let entry;
    if (secret) {
        entry = new Gtk.PasswordEntry({
            text: value || '',
            placeholder_text: placeholder || '',
            show_peek_icon: true,
            hexpand: true,
        });
    } else {
        entry = new Gtk.Entry({text: value || '', placeholder_text: placeholder || '', hexpand: true});
        entry.width_chars = 34;
    }
    entry.valign = Gtk.Align.CENTER;
    row.add_suffix(entry);
    row.activatable_widget = entry;
    row._entry = entry;
    return row;
}

function settingsBinary(settings) {
    return findAiUsage(settings.get_string('usagestat-cli-path')) || '';
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

const BehaviourPage = GObject.registerClass(
class BehaviourPage extends Adw.PreferencesPage {
    _init(settings) {
        super._init({
            title: _('Behaviour'),
            icon_name: 'preferences-system-symbolic',
        });
        this._settings = settings;
        this.add(this._buildRefreshGroup());
        this.add(this._buildInteractionGroup());
        this.add(this._buildPopupGroup());
        this.add(this._buildCliGroup());
    }

    _setEntryRowPlaceholder(row, text) {
        const input = this._findEditableGtkText(row);
        if (input)
            input.set_placeholder_text(text);
    }

    _findEditableGtkText(parent) {
        for (let child = parent.get_first_child(); child; child = child.get_next_sibling()) {
            if (child instanceof Gtk.Text && child.get_editable())
                return child;
            const found = this._findEditableGtkText(child);
            if (found)
                return found;
        }
        return null;
    }

    _defaultPluginDir(binary = '') {
        const envDir = GLib.getenv('USAGESTAT_PLUGIN_DIR') || GLib.getenv('AI_USAGE_PLUGIN_DIR');
        if (envDir)
            return envDir;

        const binaryName = binary ? GLib.path_get_basename(binary) : '';
        const systemDir = binaryName.includes('usagestat-dev')
            ? '/usr/share/usagestat-dev/plugins'
            : '/usr/share/usagestat/plugins';
        if (GLib.file_test(systemDir, GLib.FileTest.IS_DIR))
            return systemDir;

        return GLib.build_filenamev([
            GLib.getenv('XDG_DATA_HOME') || GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share']),
            binaryName.includes('usagestat-dev') ? 'usagestat-dev' : 'usagestat',
            'plugins',
        ]);
    }

    _resolvedPluginDir(binary = '') {
        const configured = this._settings.get_string('usagestat-plugin-dir').trim();
        if (configured)
            return {path: configured, explicit: true};
        return {path: this._defaultPluginDir(binary), explicit: false};
    }

    _buildCliGroup() {
        const group = new Adw.PreferencesGroup({title: _('CLI')});
        group.add(this._buildBinaryExpander());
        group.add(this._buildPluginExpander());
        return group;
    }

    _buildBinaryExpander() {
        const expander = new Adw.ExpanderRow({title: _('Binary')});

        // Set path row
        const entryRow = new Adw.EntryRow({
            title: _('Set path'),
            text: this._settings.get_string('usagestat-cli-path'),
            show_apply_button: true,
            input_hints: Gtk.InputHints.NO_SPELLCHECK,
        });
        entryRow.set_input_purpose(Gtk.InputPurpose.URL);
        entryRow.connect('apply', () => {
            this._settings.set_string('usagestat-cli-path', entryRow.get_text().trim());
        });
        const browseBtn = new Gtk.Button({
            icon_name: 'document-open-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Choose executable'),
            css_classes: ['flat'],
        });
        browseBtn.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({title: _('Select usagestat executable')});
            const start = entryRow.get_text().trim() || findAiUsage('') || '';
            if (start) dialog.set_initial_file(Gio.File.new_for_path(start));
            dialog.open(this.get_root(), null, (d, res) => {
                try {
                    const path = d.open_finish(res)?.get_path() || '';
                    if (path) { entryRow.set_text(path); this._settings.set_string('usagestat-cli-path', path); }
                } catch { /* cancelled */ }
            });
        });
        entryRow.add_suffix(browseBtn);
        expander.add_row(entryRow);

        // Detected path row
        const detectedRow = new Adw.ActionRow({title: _('Detected path')});
        const detectedLabel = new Gtk.Label({valign: Gtk.Align.CENTER, css_classes: ['dim-label'], ellipsize: 3});
        const copyBtn = new Gtk.Button({icon_name: 'edit-copy-symbolic', valign: Gtk.Align.CENTER, tooltip_text: _('Copy'), css_classes: ['flat']});
        detectedRow.add_suffix(detectedLabel);
        detectedRow.add_suffix(copyBtn);
        expander.add_row(detectedRow);

        // Status row
        const statusRow = new Adw.ActionRow({title: _('Status')});
        const spinner = new Gtk.Spinner({valign: Gtk.Align.CENTER});
        const statusIcon = new Gtk.Image({valign: Gtk.Align.CENTER});
        const statusLabel = new Gtk.Label({valign: Gtk.Align.CENTER});
        statusRow.add_suffix(spinner);
        statusRow.add_suffix(statusIcon);
        statusRow.add_suffix(statusLabel);
        expander.add_row(statusRow);

        let _resolvedBinary = '';
        copyBtn.connect('clicked', () => { if (_resolvedBinary) this.get_clipboard().set(_resolvedBinary); });

        const check = () => {
            _resolvedBinary = findAiUsage(this._settings.get_string('usagestat-cli-path')) || '';
            detectedLabel.set_label(_resolvedBinary || _('Not found'));
            copyBtn.set_sensitive(Boolean(_resolvedBinary));
            expander.set_subtitle(_resolvedBinary || _('Not found'));

            if (!_resolvedBinary) {
                spinner.stop(); spinner.set_visible(false);
                statusIcon.set_from_icon_name('dialog-error-symbolic'); statusIcon.set_css_classes(['error']); statusIcon.set_visible(true);
                statusLabel.set_label(_('Not found')); statusLabel.set_css_classes(['error']);
                return;
            }
            statusIcon.set_visible(false); statusLabel.set_label('');
            spinner.set_visible(true); spinner.start();
            try {
                const proc = Gio.Subprocess.new([_resolvedBinary, '--version'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
                proc.communicate_utf8_async(null, null, (_p, res) => {
                    spinner.stop(); spinner.set_visible(false); statusIcon.set_visible(true);
                    try {
                        const [, stdout] = _p.communicate_utf8_finish(res);
                        const version = (stdout || '').trim().split('\n')[0] || _resolvedBinary;
                        statusIcon.set_from_icon_name('emblem-ok-symbolic'); statusIcon.set_css_classes(['success']);
                        statusLabel.set_label(version); statusLabel.set_css_classes(['success']);
                        expander.set_subtitle(`${version} · ${_resolvedBinary}`);
                    } catch {
                        statusIcon.set_from_icon_name('dialog-error-symbolic'); statusIcon.set_css_classes(['error']);
                        statusLabel.set_label(_('Failed to run')); statusLabel.set_css_classes(['error']);
                    }
                });
            } catch {
                spinner.stop(); spinner.set_visible(false); statusIcon.set_visible(true);
                statusIcon.set_from_icon_name('dialog-error-symbolic'); statusIcon.set_css_classes(['error']);
                statusLabel.set_label(_('Failed to launch')); statusLabel.set_css_classes(['error']);
            }
        };
        this._settings.connect('changed::usagestat-cli-path', check);
        check();
        return expander;
    }

    _buildPluginExpander() {
        const expander = new Adw.ExpanderRow({title: _('Plugin folder')});

        // Set path row
        const entryRow = new Adw.EntryRow({
            title: _('Set path'),
            text: this._settings.get_string('usagestat-plugin-dir'),
            show_apply_button: true,
            input_hints: Gtk.InputHints.NO_SPELLCHECK,
        });
        entryRow.set_input_purpose(Gtk.InputPurpose.URL);
        entryRow.connect('apply', () => {
            this._settings.set_string('usagestat-plugin-dir', entryRow.get_text().trim());
        });
        const browseBtn = new Gtk.Button({
            icon_name: 'document-open-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Choose folder'),
            css_classes: ['flat'],
        });
        browseBtn.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({title: _('Select usagestat plugin folder')});
            const binary = findAiUsage(this._settings.get_string('usagestat-cli-path')) || '';
            const start = entryRow.get_text().trim() || this._defaultPluginDir(binary);
            if (start) dialog.set_initial_folder(Gio.File.new_for_path(start));
            dialog.select_folder(this.get_root(), null, (d, res) => {
                try {
                    const path = d.select_folder_finish(res)?.get_path() || '';
                    if (path) { entryRow.set_text(path); this._settings.set_string('usagestat-plugin-dir', path); }
                } catch { /* cancelled */ }
            });
        });
        entryRow.add_suffix(browseBtn);
        expander.add_row(entryRow);

        // Detected path row
        const detectedRow = new Adw.ActionRow({title: _('Detected path')});
        const detectedLabel = new Gtk.Label({valign: Gtk.Align.CENTER, css_classes: ['dim-label'], ellipsize: 3});
        const copyBtn = new Gtk.Button({icon_name: 'edit-copy-symbolic', valign: Gtk.Align.CENTER, tooltip_text: _('Copy'), css_classes: ['flat']});
        detectedRow.add_suffix(detectedLabel);
        detectedRow.add_suffix(copyBtn);
        expander.add_row(detectedRow);
        let resolvedDir = '';
        copyBtn.connect('clicked', () => { if (resolvedDir) this.get_clipboard().set(resolvedDir); });

        // Status row
        const statusRow = new Adw.ActionRow({title: _('Status')});
        const spinner = new Gtk.Spinner({valign: Gtk.Align.CENTER});
        const statusIcon = new Gtk.Image({valign: Gtk.Align.CENTER});
        const statusLabel = new Gtk.Label({valign: Gtk.Align.CENTER});
        statusRow.add_suffix(spinner);
        statusRow.add_suffix(statusIcon);
        statusRow.add_suffix(statusLabel);
        expander.add_row(statusRow);

        const check = () => {
            const binary = findAiUsage(this._settings.get_string('usagestat-cli-path'));
            if (!binary) {
                resolvedDir = this._resolvedPluginDir('').path;
                detectedLabel.set_label(resolvedDir);
                expander.set_subtitle(resolvedDir);
                copyBtn.set_sensitive(Boolean(resolvedDir));
                spinner.stop(); spinner.set_visible(false);
                statusIcon.set_from_icon_name('dialog-warning-symbolic'); statusIcon.set_css_classes(['warning']); statusIcon.set_visible(true);
                statusLabel.set_label(_('No binary')); statusLabel.set_css_classes(['dim-label']);
                return;
            }
            const resolved = this._resolvedPluginDir(binary);
            resolvedDir = resolved.path;
            detectedLabel.set_label(resolved.path);
            copyBtn.set_sensitive(Boolean(resolved.path));
            expander.set_subtitle(resolved.explicit
                ? _('%s (override)').format(resolved.path)
                : _('%s (binary default)').format(resolved.path));

            statusIcon.set_visible(false); statusLabel.set_label('');
            spinner.set_visible(true); spinner.start();
            const argv = [binary, '--json'];
            argv.push('--config', configPath(binary));
            const pluginDir = this._settings.get_string('usagestat-plugin-dir').trim();
            if (pluginDir) argv.push('--plugin-dir', pluginDir);
            argv.push('list');
            try {
                const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
                proc.communicate_utf8_async(null, null, (_p, res) => {
                    spinner.stop(); spinner.set_visible(false); statusIcon.set_visible(true);
                    try {
                        const [, stdout, stderr] = _p.communicate_utf8_finish(res);
                        if (_p.get_exit_status() !== 0) {
                            const detail = (stderr || stdout || '').trim().split('\n')[0] || 'error';
                            statusIcon.set_from_icon_name('dialog-error-symbolic'); statusIcon.set_css_classes(['error']);
                            statusLabel.set_label(detail); statusLabel.set_css_classes(['error']);
                            return;
                        }
                        const providers = JSON.parse((stdout || '').trim());
                        const count = Array.isArray(providers) ? providers.length : 0;
                        if (count === 0) {
                            statusIcon.set_from_icon_name('dialog-warning-symbolic'); statusIcon.set_css_classes(['warning']);
                            statusLabel.set_label(_('No providers found')); statusLabel.set_css_classes(['dim-label']);
                            expander.set_subtitle(_('No providers found'));
                        } else {
                            statusIcon.set_from_icon_name('emblem-ok-symbolic'); statusIcon.set_css_classes(['success']);
                            const summary = `${count} ${count === 1 ? _('provider') : _('providers')}`;
                            statusLabel.set_label(summary); statusLabel.set_css_classes(['success']);
                            expander.set_subtitle(`${summary} · ${resolved.path}${resolved.explicit ? ` ${_('(override)')}` : ''}`);
                        }
                    } catch {
                        statusIcon.set_from_icon_name('dialog-error-symbolic'); statusIcon.set_css_classes(['error']);
                        statusLabel.set_label(_('Failed to parse output')); statusLabel.set_css_classes(['error']);
                    }
                });
            } catch {
                spinner.stop(); spinner.set_visible(false); statusIcon.set_visible(true);
                statusIcon.set_from_icon_name('dialog-error-symbolic'); statusIcon.set_css_classes(['error']);
                statusLabel.set_label(_('Failed to launch')); statusLabel.set_css_classes(['error']);
            }
        };
        this._settings.connect('changed::usagestat-cli-path', check);
        this._settings.connect('changed::usagestat-plugin-dir', check);
        check();
        return expander;
    }

    _buildRefreshGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('Data'),
        });

        const refreshRow = new Adw.SpinRow({
            title: _('Refresh interval'),
            subtitle: _('Minutes between usagestat CLI refreshes'),
            adjustment: new Gtk.Adjustment({lower: 1, upper: 1440, step_increment: 1, value: this._settings.get_int('refresh-interval')}),
        });
        this._settings.bind('refresh-interval', refreshRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(refreshRow);

        const displayModeRow = combo([_('Remaining'), _('Used')], this._settings.get_string('display-mode') === 'used' ? _('Used') : _('Remaining'));
        displayModeRow.title = _('Meter meaning');
        displayModeRow.connect('notify::selected', () => {
            this._settings.set_string('display-mode', displayModeRow.selected === 1 ? 'used' : 'remaining');
        });
        group.add(displayModeRow);

        const resetOptions = [
            ['smart', _('Smart')],
            ['relative', _('Relative')],
            ['time', _('Time only')],
            ['weekday-time', _('Day and time')],
            ['date-time', _('Date and time')],
        ];
        const resetValues = resetOptions.map(([v]) => v);
        const resetLabels = resetOptions.map(([, l]) => l);
        const selectedReset = resetValues.includes(this._settings.get_string('reset-time-format'))
            ? this._settings.get_string('reset-time-format') : 'smart';
        const resetRow = combo(resetLabels, resetLabels[resetValues.indexOf(selectedReset)]);
        resetRow.title = _('Reset display');
        resetRow.subtitle = _('Smart includes weekday for weekly resets.');
        resetRow.connect('notify::selected', () => {
            this._settings.set_string('reset-time-format', resetValues[resetRow.selected] || 'smart');
        });
        group.add(resetRow);

        return group;
    }

    _buildInteractionGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('Interaction'),
        });

        const scrollRow = new Adw.SwitchRow({
            title: _('Scroll to switch provider'),
            subtitle: _('Scroll on the panel indicator to cycle through active providers.'),
            active: this._settings.get_boolean('scroll-to-switch-provider'),
        });
        this._settings.bind('scroll-to-switch-provider', scrollRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(scrollRow);

        const popupScrollRow = new Adw.SwitchRow({
            title: _('Scroll popup to switch provider'),
            subtitle: _('Scroll inside the popup to cycle through every provider, including pinned providers.'),
            active: this._settings.get_boolean('scroll-popup-to-switch-provider'),
        });
        this._settings.bind('scroll-popup-to-switch-provider', popupScrollRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(popupScrollRow);

        return group;
    }

    _buildPopupGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('Popup'),
            description: _('What appears in the usage popup for each provider.'),
        });

        const paceRow = new Adw.SwitchRow({
            title: _('Show pace indicator'),
            subtitle: _('Whether usage is ahead or behind the expected burn rate.'),
            active: this._settings.get_boolean('show-pace'),
        });
        this._settings.bind('show-pace', paceRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(paceRow);

        const statusLinkRow = new Adw.SwitchRow({
            title: _('Show status page link'),
            subtitle: _('Button in the provider header that opens the provider\'s status page.'),
            active: this._settings.get_boolean('show-status-link'),
        });
        this._settings.bind('show-status-link', statusLinkRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(statusLinkRow);

        return group;
    }
});

const AppearancePage = GObject.registerClass(
class AppearancePage extends Adw.PreferencesPage {
    _init(settings) {
        super._init({
            title: _('Appearance'),
            icon_name: 'preferences-desktop-display-symbolic',
        });
        this._settings = settings;
        this._config = loadConfig(settingsBinary(this._settings));
        this._settings.connect('changed::panel-bar-count', () => this._renderPinnedProviders());
        this.connect('map', () => this._renderPinnedProviders());
        this.add(this._buildPanelGroup());
        this.add(this._buildIconGroup());
        this._buildComponentGroups();
        this.add(this._buildThresholdGroup());
        this.add(this._buildColorGroup());
    }

    _buildPanelGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('Panel'),
            description: _('Placement and display controls.'),
        });

        const positionRow = combo([_('Left'), _('Center'), _('Right')], {
            left: _('Left'), center: _('Center'), right: _('Right'),
        }[this._settings.get_string('panel-position')] || _('Right'));
        positionRow.title = _('Panel position');
        positionRow.connect('notify::selected', () => {
            this._settings.set_string('panel-position', ['left', 'center', 'right'][positionRow.selected] || 'right');
        });
        group.add(positionRow);

        const alignmentRow = combo([_('Left'), _('Center'), _('Right')], {
            left: _('Left'), center: _('Center'), right: _('Right'),
        }[this._settings.get_string('popup-alignment')] || _('Center'));
        alignmentRow.title = _('Popup alignment');
        alignmentRow.subtitle = _('How the popup menu aligns to the panel indicator.');
        alignmentRow.connect('notify::selected', () => {
            this._settings.set_string('popup-alignment', ['left', 'center', 'right'][alignmentRow.selected] || 'center');
        });
        group.add(alignmentRow);

        const indexRow = new Adw.SpinRow({
            title: _('Position index'),
            subtitle: _('Lower values sit closer to the panel edge for that box'),
            adjustment: new Gtk.Adjustment({lower: 0, upper: 20, step_increment: 1, value: this._settings.get_int('panel-index')}),
        });
        this._settings.bind('panel-index', indexRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(indexRow);

        const barCountRow = new Adw.SpinRow({
            title: _('Providers shown'),
            subtitle: _('Number of providers shown simultaneously in the panel.'),
            adjustment: new Gtk.Adjustment({lower: 1, upper: 3, step_increment: 1, value: this._settings.get_int('panel-bar-count')}),
        });
        this._settings.bind('panel-bar-count', barCountRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(barCountRow);

        this._pinnedList = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE});
        this._pinnedList.add_css_class('boxed-list');
        const pinnedRow = new Adw.ExpanderRow({
            title: _('Pinned providers'),
            subtitle: _('Fixed providers shown before the scrolling provider slots.'),
        });
        pinnedRow.add_row(new Adw.PreferencesRow({child: this._pinnedList}));
        group.add(pinnedRow);
        this._renderPinnedProviders();

        const multiProviderRow = new Adw.ExpanderRow({
            title: _('Multi-provider display'),
            subtitle: _('Adjust layout when showing multiple providers.'),
        });

        const usageBarCountRow = new Adw.SpinRow({
            title: _('Usage bars per provider'),
            subtitle: _('Number of usage bars shown per provider in the panel.'),
            adjustment: new Gtk.Adjustment({lower: 1, upper: 3, step_increment: 1, value: this._settings.get_int('panel-usage-bar-count')}),
        });
        this._settings.bind('panel-usage-bar-count', usageBarCountRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        multiProviderRow.add_row(usageBarCountRow);

        const layoutLabels = [_('Vertical stack'), _('Horizontal stack')];
        const layoutValues = ['vertical', 'horizontal'];
        const selectedLayout = layoutValues.includes(this._settings.get_string('panel-usage-bar-layout'))
            ? this._settings.get_string('panel-usage-bar-layout')
            : 'vertical';
        const layoutRow = combo(layoutLabels, layoutLabels[layoutValues.indexOf(selectedLayout)]);
        layoutRow.title = _('Usage bar layout');
        layoutRow.subtitle = _('Vertical stacks shrink to fit the panel height.');
        layoutRow.connect('notify::selected', () => {
            this._settings.set_string('panel-usage-bar-layout', layoutValues[layoutRow.selected] || 'vertical');
        });
        multiProviderRow.add_row(layoutRow);

        const providerSpacingRow = new Adw.SpinRow({
            title: _('Provider spacing'),
            subtitle: _('Spacing between providers in the panel.'),
            adjustment: new Gtk.Adjustment({lower: 0, upper: 16, step_increment: 1, value: this._settings.get_int('panel-provider-spacing')}),
        });
        this._settings.bind('panel-provider-spacing', providerSpacingRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        multiProviderRow.add_row(providerSpacingRow);

        group.add(multiProviderRow);

        return group;
    }

    _renderPinnedProviders() {
        if (!this._pinnedList)
            return;
        while (this._pinnedList.get_first_child())
            this._pinnedList.remove(this._pinnedList.get_first_child());

        const maxPinned = this._maxPinnedProviders();
        const pinned = this._pinnedProviderKeys();
        const enabled = this._enabledProviders();

        if (!enabled.length) {
            this._pinnedList.append(this._disabledPinnedRow(_('No enabled providers'), _('Enable providers before pinning them.')));
            return;
        }

        if (!pinned.length) {
            this._pinnedList.append(this._disabledPinnedRow(
                _('No pinned providers'),
                maxPinned > 0 ? _('Pin providers below. The popup opens on the first pinned provider.') : _('Show at least two providers before pinning.'),
            ));
        } else {
            for (const key of pinned) {
                const provider = enabled.find(item => providerKey(item) === key);
                if (!provider)
                    continue;
                const listRow = new Gtk.ListBoxRow();
                listRow._providerKey = key;
                const row = new Adw.ActionRow({
                    title: providerDisplayName(provider),
                    subtitle: _('Drag to reorder pinned providers.'),
                });
                row.add_prefix(new Gtk.Image({icon_name: 'list-drag-handle-symbolic'}));
                const unpin = new Gtk.Button({
                    icon_name: 'window-close-symbolic',
                    tooltip_text: _('Unpin provider'),
                    valign: Gtk.Align.CENTER,
                });
                unpin.connect('clicked', () => {
                    this._savePinnedProviderKeys(this._pinnedProviderKeys().filter(id => id !== key));
                    this._renderPinnedProviders();
                });
                row.add_suffix(unpin);
                listRow.set_child(row);
                this._setupPinnedDragAndDrop(listRow);
                this._pinnedList.append(listRow);
            }
        }

        for (const provider of enabled) {
            const key = providerKey(provider);
            if (pinned.includes(key))
                continue;
            const row = new Adw.SwitchRow({
                title: providerDisplayName(provider),
                subtitle: maxPinned > 0 ? _('Pin this provider into the panel.') : _('Show at least two providers before pinning.'),
                active: false,
                sensitive: pinned.length < maxPinned,
            });
            row.connect('notify::active', () => {
                if (!row.active)
                    return;
                this._savePinnedProviderKeys([...this._pinnedProviderKeys(), key]);
                this._renderPinnedProviders();
            });
            this._pinnedList.append(row);
        }
    }

    _disabledPinnedRow(title, subtitle) {
        const row = new Adw.ActionRow({title, subtitle});
        row.sensitive = false;
        return row;
    }

    _setupPinnedDragAndDrop(listRow) {
        const drag = new Gtk.DragSource({actions: Gdk.DragAction.MOVE});
        drag.connect('prepare', () => {
            const value = new GObject.Value();
            value.init(GObject.TYPE_STRING);
            value.set_string(listRow._providerKey);
            return Gdk.ContentProvider.new_for_value(value);
        });
        listRow.add_controller(drag);

        const drop = Gtk.DropTarget.new(GObject.TYPE_STRING, Gdk.DragAction.MOVE);
        drop.connect('drop', (_target, sourceId) => {
            this._movePinnedProvider(String(sourceId), listRow._providerKey);
            return true;
        });
        listRow.add_controller(drop);
    }

    _movePinnedProvider(sourceId, targetId) {
        if (sourceId === targetId)
            return;
        const pinned = this._pinnedProviderKeys();
        const sourceIndex = pinned.indexOf(sourceId);
        const targetIndex = pinned.indexOf(targetId);
        if (sourceIndex < 0 || targetIndex < 0)
            return;
        const [provider] = pinned.splice(sourceIndex, 1);
        pinned.splice(targetIndex, 0, provider);
        this._savePinnedProviderKeys(pinned);
        this._renderPinnedProviders();
    }

    _pinnedProviderKeys() {
        const enabled = new Set(this._enabledProviders().map(provider => providerKey(provider)));
        const seen = new Set();
        try {
            const parsed = JSON.parse(this._settings.get_string('panel-pinned-providers'));
            if (!Array.isArray(parsed))
                return [];
            return parsed
                .filter(key => typeof key === 'string' && enabled.has(key) && !seen.has(key) && seen.add(key))
                .slice(0, this._maxPinnedProviders());
        } catch {
            return [];
        }
    }

    _savePinnedProviderKeys(keys) {
        const enabled = new Set(this._enabledProviders().map(provider => providerKey(provider)));
        const seen = new Set();
        const normalized = keys
            .filter(key => typeof key === 'string' && enabled.has(key) && !seen.has(key) && seen.add(key))
            .slice(0, this._maxPinnedProviders());
        this._settings.set_string('panel-pinned-providers', JSON.stringify(normalized));
    }

    _enabledProviders() {
        this._config = loadConfig(settingsBinary(this._settings));
        return this._config.providers.filter(provider => provider.enabled !== false && !provider.tabParent);
    }

    _maxPinnedProviders() {
        return Math.max(0, Math.min(this._settings.get_int('panel-bar-count') - 1, this._enabledProviders().length - 1));
    }

    _buildIconGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('Provider Icons'),
            description: _('Choose the default logo style. Individual providers can override this.'),
        });

        const labels = ICON_STYLE_OPTIONS.filter(([value]) => value !== 'auto').map(([, label]) => _(label));
        const values = ICON_STYLE_OPTIONS.filter(([value]) => value !== 'auto').map(([value]) => value);
        const selected = values.includes(this._settings.get_string('provider-icon-style'))
            ? this._settings.get_string('provider-icon-style')
            : 'monochromatic';
        const row = combo(labels, labels[values.indexOf(selected)]);
        row.title = _('Icon style');
        row.connect('notify::selected', () => {
            this._settings.set_string('provider-icon-style', values[row.selected] || 'monochromatic');
        });
        group.add(row);

        return group;
    }

    _buildComponentGroups() {
        const group = new Adw.PreferencesGroup({
            title: _('Top Bar Components'),
            description: _('Enable components and drag enabled items to set their order.'),
        });

        this._enabledComponentList = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE});
        this._enabledComponentList.add_css_class('boxed-list');
        this._disabledComponentList = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE});
        this._disabledComponentList.add_css_class('boxed-list');

        this._renderPanelComponentLists();

        group.add(new Adw.PreferencesRow({child: this._enabledComponentList}));
        this.add(group);

        const disabledGroup = new Adw.PreferencesGroup({title: _('Disabled Components')});
        disabledGroup.add(new Adw.PreferencesRow({child: this._disabledComponentList}));
        this.add(disabledGroup);
    }

    _panelComponentOrder() {
        const valid = new Set(PANEL_COMPONENTS.map(([id]) => id));
        const enabled = this._settings.get_string('panel-components')
            .split(',').map(part => part.trim()).filter(part => valid.has(part));
        return [...new Set(enabled)];
    }

    _renderPanelComponentLists() {
        while (this._enabledComponentList.get_first_child())
            this._enabledComponentList.remove(this._enabledComponentList.get_first_child());
        while (this._disabledComponentList.get_first_child())
            this._disabledComponentList.remove(this._disabledComponentList.get_first_child());

        const enabled = this._panelComponentOrder();
        const enabledSet = new Set(enabled);

        for (const componentId of enabled)
            this._enabledComponentList.append(this._buildPanelComponentRow(componentId, true));
        for (const [componentId] of PANEL_COMPONENTS) {
            if (!enabledSet.has(componentId))
                this._disabledComponentList.append(this._buildPanelComponentRow(componentId, false));
        }
    }

    _buildPanelComponentRow(componentId, enabled) {
        const listRow = new Gtk.ListBoxRow();
        listRow._componentId = componentId;
        const row = new Adw.ActionRow({
            title: _(PANEL_COMPONENTS.find(([id]) => id === componentId)?.[1] || componentId),
            subtitle: enabled ? _('Shown in the top bar') : _('Hidden'),
        });
        if (enabled) {
            row.add_prefix(new Gtk.Image({
                icon_name: 'list-drag-handle-symbolic',
                tooltip_text: _('Drag to reorder'),
            }));
        }
        const toggle = new Gtk.Switch({active: enabled, valign: Gtk.Align.CENTER});
        toggle.connect('notify::active', () => {
            const order = this._panelComponentOrder().filter(id => id !== componentId);
            if (toggle.active)
                order.push(componentId);
            this._settings.set_string('panel-components', order.join(',') || 'bar');
            this._renderPanelComponentLists();
        });
        row.add_suffix(toggle);
        listRow.set_child(row);
        if (enabled) {
            const drag = new Gtk.DragSource({actions: Gdk.DragAction.MOVE});
            drag.connect('prepare', () => {
                const value = new GObject.Value();
                value.init(GObject.TYPE_STRING);
                value.set_string(listRow._componentId);
                return Gdk.ContentProvider.new_for_value(value);
            });
            listRow.add_controller(drag);
            const drop = Gtk.DropTarget.new(GObject.TYPE_STRING, Gdk.DragAction.MOVE);
            drop.connect('drop', (_target, sourceId) => {
                const order = this._panelComponentOrder();
                const si = order.indexOf(String(sourceId));
                const ti = order.indexOf(componentId);
                if (si >= 0 && ti >= 0 && si !== ti) {
                    const [c] = order.splice(si, 1);
                    order.splice(ti, 0, c);
                    this._settings.set_string('panel-components', order.join(',') || 'bar');
                    this._renderPanelComponentLists();
                }
                return true;
            });
            listRow.add_controller(drop);
        }
        return listRow;
    }

    _buildThresholdGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('Thresholds'),
            description: _('Expand a threshold to set percentage, color, and notifications.'),
        });

        this._thresholdList = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE});
        this._thresholdList.add_css_class('boxed-list');
        this._renderThresholdRows();
        group.add(new Adw.PreferencesRow({child: this._thresholdList}));

        const addRow = new Adw.ActionRow({
            title: _('Add threshold'),
            subtitle: _('Create another usage state.'),
        });
        const addButton = new Gtk.Button({
            label: _('Add'),
            valign: Gtk.Align.CENTER,
        });
        addButton.connect('clicked', () => this._addThreshold());
        addRow.add_suffix(addButton);
        group.add(addRow);

        return group;
    }

    _thresholds() {
        try {
            const parsed = JSON.parse(this._settings.get_string('usage-thresholds'));
            if (Array.isArray(parsed)) {
                const thresholds = parsed.map((threshold, index) => this._normalizeThreshold(threshold, index)).filter(Boolean);
                if (thresholds.length)
                    return thresholds.sort((a, b) => a.percent - b.percent);
            }
        } catch {
            // Fall through to defaults.
        }
        return DEFAULT_THRESHOLDS.map((threshold, index) => this._normalizeThreshold(threshold, index));
    }

    _normalizeThreshold(threshold, index) {
        if (!threshold || typeof threshold !== 'object')
            return null;

        const percent = Math.max(0, Math.min(100, Number(threshold.percent)));
        if (!Number.isFinite(percent))
            return null;

        const color = typeof threshold.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(threshold.color)
            ? threshold.color.toLowerCase()
            : '#8ab4f8';

        return {
            id: String(threshold.id || `threshold-${index}`),
            label: String(threshold.label || _('Threshold')),
            percent,
            color,
            notify: Boolean(threshold.notify),
        };
    }

    _saveThresholds(thresholds) {
        const normalized = thresholds
            .map((threshold, index) => this._normalizeThreshold(threshold, index))
            .filter(Boolean)
            .sort((a, b) => a.percent - b.percent);
        this._settings.set_string('usage-thresholds', JSON.stringify(normalized));
    }

    _renderThresholdRows() {
        while (this._thresholdList.get_first_child())
            this._thresholdList.remove(this._thresholdList.get_first_child());

        for (const threshold of this._thresholds())
            this._thresholdList.append(this._buildThresholdRow(threshold));
    }

    _buildThresholdRow(threshold) {
        const listRow = new Gtk.ListBoxRow();
        const row = new Adw.ExpanderRow({
            title: threshold.label,
            subtitle: _('%s%% used').format(Math.round(threshold.percent)),
        });

        const swatch = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({with_alpha: false}),
            rgba: rgbaFromHex(threshold.color),
            valign: Gtk.Align.CENTER,
        });
        row.add_suffix(swatch);

        const nameRow = entryRow(_('Name'), threshold.label, _('Threshold name'));
        nameRow._entry.connect('changed', () => {
            threshold.label = nameRow._entry.get_text().trim() || _('Threshold');
            row.set_title(threshold.label);
            this._updateThreshold(threshold);
        });
        row.add_row(nameRow);

        const percentRow = new Adw.SpinRow({
            title: _('Percent used'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 100,
                step_increment: 1,
                value: threshold.percent,
            }),
        });
        percentRow.adjustment.connect('notify::value', () => {
            threshold.percent = Math.round(percentRow.adjustment.value);
            row.set_subtitle(_('%s%% used').format(threshold.percent));
            this._updateThreshold(threshold);
        });
        row.add_row(percentRow);

        const colorRow = this._buildThresholdColorRow(threshold, swatch);
        row.add_row(colorRow);

        const notifyRow = new Adw.SwitchRow({
            title: _('Notify when crossed'),
            subtitle: _('Only notifies when usage moves upward into this threshold.'),
            active: threshold.notify,
        });
        notifyRow.connect('notify::active', () => {
            threshold.notify = notifyRow.active;
            this._updateThreshold(threshold);
        });
        row.add_row(notifyRow);

        const deleteRow = new Adw.ActionRow({title: _('Delete threshold')});
        const deleteButton = new Gtk.Button({
            label: _('Delete'),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        deleteButton.connect('clicked', () => this._deleteThreshold(threshold.id));
        deleteRow.add_suffix(deleteButton);
        row.add_row(deleteRow);

        listRow.set_child(row);
        return listRow;
    }

    _buildThresholdColorRow(threshold, swatch) {
        const row = new Adw.ActionRow({
            title: _('Color'),
            subtitle: threshold.color,
        });

        const entry = new Gtk.Entry({
            text: threshold.color,
            placeholder_text: '#8ab4f8',
            width_chars: 9,
            max_width_chars: 9,
            valign: Gtk.Align.CENTER,
        });

        let applying = false;
        const applyHex = (value, updateSwatch = true) => {
            if (!/^#[0-9a-fA-F]{6}$/.test(value))
                return;
            if (applying)
                return;

            applying = true;
            threshold.color = value.toLowerCase();
            row.set_subtitle(threshold.color);
            if (entry.get_text() !== threshold.color)
                entry.set_text(threshold.color);
            if (updateSwatch && swatch)
                swatch.set_rgba(rgbaFromHex(threshold.color));
            this._updateThreshold(threshold);
            applying = false;
        };

        entry.connect('changed', () => applyHex(entry.get_text().trim()));
        if (swatch)
            swatch.connect('notify::rgba', () => applyHex(hexFromRgba(swatch.get_rgba()), false));
        row.add_suffix(entry);
        row.activatable_widget = entry;
        return row;
    }

    _updateThreshold(nextThreshold) {
        const thresholds = this._thresholds();
        const index = thresholds.findIndex(threshold => threshold.id === nextThreshold.id);
        if (index >= 0)
            thresholds[index] = nextThreshold;
        this._saveThresholds(thresholds);
    }

    _deleteThreshold(id) {
        this._saveThresholds(this._thresholds().filter(threshold => threshold.id !== id));
        this._renderThresholdRows();
    }

    _addThreshold() {
        const thresholds = this._thresholds();
        thresholds.push({
            id: `threshold-${Date.now()}`,
            label: _('Threshold'),
            percent: 95,
            color: '#8ab4f8',
            notify: false,
        });
        this._saveThresholds(thresholds);
        this._renderThresholdRows();
    }

    _buildColorGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('Appearance Colors'),
            description: _('Threshold colors live in each threshold row. These colors cover normal state and panel text.'),
        });

        for (const [key, title] of [
            ['accent-color', _('Normal')],
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
    _init(settings) {
        super._init({
            title: _('Providers'),
            icon_name: 'view-grid-symbolic',
        });

        this._settings = settings;
        this._targetProviderId = this._settings.get_string('preferences-provider') || null;
        this._config = loadConfig(settingsBinary(this._settings));
        this._validationCache = new Map();
        this._validationInFlight = new Map();
        this._validationDebounceIds = new Map();
        this._manifests = new Map();
        this._settings.connect('changed::provider-icon-style', () => this._refreshProviderIcons());
        this._settings.connect('changed::usagestat-cli-path', () => this._loadProviderManifests());
        this._settings.connect('changed::usagestat-plugin-dir', () => this._loadProviderManifests());
        this._styleManager = Adw.StyleManager.get_default();
        this._styleManager.connect('notify::dark', () => this._refreshProviderIcons());
        this._save();
        this._loadProviderManifests();

        this._enabledList = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
        });
        this._enabledList.add_css_class('boxed-list');

        this._disabledList = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
        });
        this._disabledList.add_css_class('boxed-list');

        this._pluginList = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
        });
        this._pluginList.add_css_class('boxed-list');

        this._enabledGroup = new Adw.PreferencesGroup({
            title: _('Enabled Providers'),
            description: _('Drag enabled providers to reorder the switcher.'),
        });
        this._enabledGroup.add(new Adw.PreferencesRow({child: this._enabledList}));
        this.add(this._enabledGroup);

        this._addSourceGroup = new Adw.PreferencesGroup({
            title: _('Add Provider Source'),
            description: _('Add another built-in provider source, or define a custom command-backed source.'),
        });
        this._addSourceGroup.add(this._buildAddProviderSourceRow());
        this.add(this._addSourceGroup);

        this._pluginGroup = new Adw.PreferencesGroup({
            title: _('Plugin Providers'),
            description: _('Providers discovered from the plugin folder. Enable to start tracking.'),
        });
        this._pluginGroup.add(new Adw.PreferencesRow({child: this._pluginList}));
        this._pluginGroup.set_visible(false);
        this.add(this._pluginGroup);

        this._disabledGroup = new Adw.PreferencesGroup({
            title: _('Disabled Providers'),
            description: _('Enable a provider to move it into the draggable list.'),
        });
        this._disabledGroup.add(new Adw.PreferencesRow({child: this._disabledList}));
        this.add(this._disabledGroup);

        this._hiddenExpanderRow = new Adw.ExpanderRow({
            title: _('Hidden'),
            expanded: false,
        });
        this._hiddenGroup = new Adw.PreferencesGroup();
        this._hiddenGroup.add(this._hiddenExpanderRow);
        this._hiddenGroup.set_visible(false);
        this.add(this._hiddenGroup);

        this._renderProviders(this._targetProviderId);
        if (this._targetProviderId)
            this._settings.set_string('preferences-provider', '');
    }

    _provider(id) {
        let provider = this._config.providers.find(item => item.id === id);
        if (!provider) {
            provider = {id, enabled: false, source: 'auto'};
            this._config.providers.push(provider);
        }
        return provider;
    }

    async _loadProviderManifests() {
        const cliPath = this._settings.get_string('usagestat-cli-path');
        const pluginDir = this._settings.get_string('usagestat-plugin-dir').trim();
        const binary = findAiUsage(cliPath);
        if (!binary)
            return;
        try {
            const argv = [binary, '--json'];
            argv.push('--config', configPath(binary));
            if (pluginDir)
                argv.push('--plugin-dir', pluginDir);
            argv.push('list');
            const result = await this._runValidationCommand(argv);
            const providers = JSON.parse(result.stdout.trim());
            if (!Array.isArray(providers))
                return;
            this._manifests = new Map(providers.map(p => [p.id, p]));

            const knownIds = new Set(this._config.providers.map(p => p.id));
            let added = false;
            for (const p of providers) {
                if (!p.id || knownIds.has(p.id))
                    continue;
                this._config.providers.push({
                    id: p.id,
                    enabled: false,
                    ...(DEFAULT_HIDDEN_IDS.has(p.id) ? {hidden: true} : {}),
                });
                added = true;
            }
            if (added)
                this._save();

            this._renderProviders(null);
        } catch {
            // Non-critical; fall back to showing all source options.
        }
    }

    _manifest(baseId) {
        return this._manifests.get(baseId) || null;
    }

    _supportedSourceOptions(baseId) {
        const manifest = this._manifest(baseId);
        if (!Array.isArray(manifest?.supportedModes) || !manifest.supportedModes.length)
            return SOURCE_OPTIONS;
        const supported = new Set(manifest.supportedModes);
        return SOURCE_OPTIONS.filter(mode => mode === 'auto' || supported.has(mode));
    }

    _effectiveSource(provider) {
        const source = provider.source || 'auto';
        if (source !== 'auto')
            return source;
        return this._manifest(providerBaseId(provider))?.autoMode || 'auto';
    }

    _buildAddProviderSourceRow() {
        const row = new Adw.ExpanderRow({
            title: _('Add Provider Source'),
            subtitle: _('Pick a known provider or create a custom CLI source.'),
        });

        const providerOptions = [
            ...PROVIDERS.map(([id, name]) => [id, name]),
            [CUSTOM_PROVIDER_VALUE, _('Custom CLI command')],
        ];
        const providerValues = providerOptions.map(([value]) => value);
        const providerLabels = providerOptions.map(([, label]) => label);

        const providerRow = combo(providerLabels, providerLabels[0]);
        providerRow.title = _('Provider');
        row.add_row(providerRow);

        const nameRow = entryRow(_('Name'), '', _('Optional display name'));
        row.add_row(nameRow);

        const commandRow = entryRow(_('CLI command'), '', _('Command that prints usagestat-style usage JSON'));
        row.add_row(commandRow);

        const sourceRow = combo(SOURCE_OPTIONS, 'auto');
        sourceRow.title = _('Source');
        sourceRow.subtitle = _('Only used for built-in providers.');
        row.add_row(sourceRow);

        const addRow = new Adw.ActionRow({
            title: _('Create source'),
            subtitle: _('New sources are enabled immediately and can be reordered above.'),
        });
        const addButton = new Gtk.Button({
            label: _('OK'),
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
        });
        addButton.connect('clicked', () => {
            const selected = providerValues[providerRow.selected] || providerValues[0];
            const source = sourceRow._values[sourceRow.selected] || 'auto';
            if (this._addProviderSource(selected, nameRow._entry.get_text(), commandRow._entry.get_text(), source)) {
                nameRow._entry.set_text('');
                commandRow._entry.set_text('');
                row.set_expanded(false);
            }
        });
        addRow.add_suffix(addButton);
        row.add_row(addRow);

        const syncCommandState = () => {
            const selectedId = providerValues[providerRow.selected];
            const isCustom = selectedId === CUSTOM_PROVIDER_VALUE;
            commandRow.set_sensitive(isCustom);
            sourceRow.set_sensitive(!isCustom);
            commandRow.subtitle = isCustom
                ? _('Required. The command must print a single JSON object or an array with one usage object.')
                : _('Only used for custom CLI sources.');

            if (!isCustom) {
                const options = this._supportedSourceOptions(selectedId);
                const current = sourceRow._values?.[sourceRow.selected] || 'auto';
                sourceRow.set_model(new Gtk.StringList({strings: options}));
                sourceRow._values = options;
                sourceRow.selected = Math.max(0, options.indexOf(current));
            }
        };
        providerRow.connect('notify::selected', syncCommandState);
        syncCommandState();

        return row;
    }

    _addProviderSource(selectedProvider, rawName, rawCommand, rawSource = 'auto') {
        const displayName = rawName.trim();
        const command = rawCommand.trim();

        if (selectedProvider === CUSTOM_PROVIDER_VALUE) {
            if (!command) {
                this._showError(_('Command required'), _('Custom providers need a CLI command that prints usage JSON.'));
                return false;
            }

            const id = 'custom';
            const provider = {
                id,
                instanceId: makeProviderInstanceId(id),
                enabled: true,
                source: 'custom',
                custom: true,
                customCommand: command,
                displayName: displayName || _('Custom Provider'),
            };
            this._config.providers.push(provider);
            this._save();
            this._renderProviders(providerKey(provider));
            return true;
        }

        const provider = {
            id: selectedProvider,
            instanceId: makeProviderInstanceId(selectedProvider),
            enabled: true,
            source: SOURCE_OPTIONS.includes(rawSource) ? rawSource : 'auto',
            displayName: displayName || _('%s Source').format(this._name(selectedProvider)),
        };
        this._config.providers.push(provider);
        this._save();
        this._renderProviders(providerKey(provider));
        return true;
    }

    _save() {
        this._config.providers.sort((a, b) => {
            if ((a.enabled !== false) !== (b.enabled !== false))
                return a.enabled === false ? 1 : -1;
            return 0;
        });
        saveConfig(this._config, settingsBinary(this._settings));
    }

    _renderProviders(expandedId = null) {
        while (this._enabledList.get_first_child())
            this._enabledList.remove(this._enabledList.get_first_child());
        while (this._pluginList.get_first_child())
            this._pluginList.remove(this._pluginList.get_first_child());
        while (this._disabledList.get_first_child())
            this._disabledList.remove(this._disabledList.get_first_child());
        for (const oldRow of (this._hiddenRowsList || []))
            this._hiddenExpanderRow.remove(oldRow);
        this._hiddenRowsList = [];

        const disabledBuiltin = [];
        const disabledPlugin = [];
        const hiddenProviders = [];

        for (const provider of this._orderedProviders()) {
            if (provider.tabParent)
                continue;
            if (provider.hidden) {
                hiddenProviders.push(provider);
            } else if (provider.enabled === false) {
                const isPlugin = !BUILTIN_PROVIDER_IDS.has(providerBaseId(provider)) && !provider.customCommand;
                if (isPlugin)
                    disabledPlugin.push(provider);
                else
                    disabledBuiltin.push(provider);
            } else {
                this._enabledList.append(this._buildProviderListRow(provider, expandedId, true));
            }
        }

        disabledBuiltin.sort((a, b) => this._name(a).localeCompare(this._name(b)));
        for (const provider of disabledBuiltin)
            this._disabledList.append(this._buildProviderListRow(provider, expandedId, false));

        disabledPlugin.sort((a, b) => this._name(a).localeCompare(this._name(b)));
        for (const provider of disabledPlugin)
            this._pluginList.append(this._buildProviderListRow(provider, expandedId, false));
        this._pluginGroup.set_visible(disabledPlugin.length > 0);

        hiddenProviders.sort((a, b) => this._name(a).localeCompare(this._name(b)));
        this._hiddenExpanderRow.set_title(`${_('Hidden')} (${hiddenProviders.length})`);
        for (const provider of hiddenProviders) {
            const r = this._buildHiddenProviderRow(provider);
            this._hiddenExpanderRow.add_row(r);
            this._hiddenRowsList.push(r);
        }
        this._hiddenGroup.set_visible(hiddenProviders.length > 0);
    }

    _refreshProviderIcons() {
        this._renderProviders(this._expandedProviderId());
    }

    _expandedProviderId() {
        for (const list of [this._enabledList, this._pluginList, this._disabledList]) {
            for (let child = list.get_first_child(); child; child = child.get_next_sibling()) {
                const row = child.get_child?.();
                if (row?.get_expanded?.())
                    return child._providerKey || null;
            }
        }
        return null;
    }

    _orderedProviders() {
        for (const [id] of PROVIDERS)
            this._provider(id);
        return this._config.providers;
    }

    _buildProviderListRow(provider, expandedId, draggable) {
        const listRow = new Gtk.ListBoxRow();
        const key = providerKey(provider);
        const baseId = providerBaseId(provider);
        listRow._providerKey = key;

        const row = new Adw.ExpanderRow({
            title: this._name(provider),
            subtitle: provider.enabled === false ? _('Disabled') : this._subtitle(provider),
            expanded: expandedId === key || (expandedId === null && provider.enabled !== false && baseId === 'codex'),
        });

        if (draggable) {
            row.add_prefix(new Gtk.Image({
                icon_name: 'list-drag-handle-symbolic',
                tooltip_text: _('Drag to reorder'),
            }));
        }
        row.add_prefix(this._providerIconPreview(provider, 24));

        const validator = this._sourceValidator(provider);
        const enabled = new Gtk.Switch({
            active: provider.enabled !== false,
            valign: Gtk.Align.CENTER,
        });
        enabled.connect('notify::active', () => {
            provider.enabled = enabled.active;
            row.set_subtitle(provider.enabled ? this._subtitle(provider) : _('Disabled'));
            this._save();
            this._renderProviders(key);
        });
        row.add_suffix(validator.box);
        row.add_suffix(enabled);

        const nameRow = entryRow(_('Name'), provider.displayName || '', this._name(baseId));
        nameRow._entry.connect('changed', () => {
            this._assignOptional(provider, 'displayName', nameRow._entry.get_text());
            row.set_title(this._name(provider));
        });
        row.add_row(nameRow);

        if (!this._isCustomProvider(provider)) {
            row.add_row(this._buildSourceExpanderRow(provider, row, validator));
        } else {
            this._addRelevantRows(row, provider, validator);
        }

        const tierRow = this._usageTierRow(provider);
        row.add_row(tierRow);
        row.add_row(this._providerIconStyleRow(provider));
        if (baseId === 'codex')
            row.add_row(this._codexIconSourceRow(provider));
        if (baseId === 'claude')
            row.add_row(this._claudeIconSourceRow(provider));
        if (baseId === 'copilot')
            row.add_row(this._copilotIconSourceRow(provider));
        row.add_row(this._usageTrackersRow(provider));

        this._addTabExtensionRows(row, provider);
        this._addHideSourceRow(row, provider);
        this._addDeleteSourceRow(row, provider);

        listRow.set_child(row);
        if (draggable)
            this._setupDragAndDrop(listRow);
        return listRow;
    }

    _providerIconStyleRow(provider) {
        const labels = ICON_STYLE_OPTIONS.map(([, label]) => _(label));
        const values = ICON_STYLE_OPTIONS.map(([value]) => value);
        const selectedValue = values.includes(this._providerUsageSetting(provider, 'iconStyle'))
            ? this._providerUsageSetting(provider, 'iconStyle')
            : 'auto';
        const row = combo(labels, labels[values.indexOf(selectedValue)]);
        row.title = _('Icon style');
        row.subtitle = _('Default follows the global Appearance setting.');
        row.connect('notify::selected', () => {
            const value = values[row.selected] || 'auto';
            this._setProviderUsageSetting(provider, 'iconStyle', value === 'auto' ? null : value);
            this._renderProviders(providerKey(provider));
        });
        return row;
    }

    _codexIconSourceRow(provider) {
        const options = [
            ['codex', _('Codex')],
            ['openai', _('OpenAI')],
        ];
        const values = options.map(([value]) => value);
        const labels = options.map(([, label]) => label);
        const selectedValue = values.includes(this._providerUsageSetting(provider, 'iconSource'))
            ? this._providerUsageSetting(provider, 'iconSource')
            : 'codex';
        const row = combo(labels, labels[values.indexOf(selectedValue)]);
        row.title = _('Codex icon');
        row.subtitle = _('Use the Codex logo or the OpenAI logo for this provider.');
        row.connect('notify::selected', () => {
            const value = values[row.selected] || 'codex';
            this._setProviderUsageSetting(provider, 'iconSource', value === 'codex' ? null : value);
            this._renderProviders(providerKey(provider));
        });
        return row;
    }

    _claudeIconSourceRow(provider) {
        const options = [
            ['claude', _('Claude')],
            ['claudecode', _('Claude Code')],
        ];
        const values = options.map(([value]) => value);
        const labels = options.map(([, label]) => label);
        const selectedValue = values.includes(this._providerUsageSetting(provider, 'iconSource'))
            ? this._providerUsageSetting(provider, 'iconSource')
            : 'claude';
        const row = combo(labels, labels[values.indexOf(selectedValue)]);
        row.title = _('Claude icon');
        row.subtitle = _('Use the Claude logo or the Claude Code logo for this provider.');
        row.connect('notify::selected', () => {
            const value = values[row.selected] || 'claude';
            this._setProviderUsageSetting(provider, 'iconSource', value === 'claude' ? null : value);
            this._renderProviders(providerKey(provider));
        });
        return row;
    }

    _copilotIconSourceRow(provider) {
        const options = [
            ['copilot', _('Microsoft Copilot')],
            ['githubcopilot', _('GitHub Copilot')],
        ];
        const values = options.map(([value]) => value);
        const labels = options.map(([, label]) => label);
        const selectedValue = values.includes(this._providerUsageSetting(provider, 'iconSource'))
            ? this._providerUsageSetting(provider, 'iconSource')
            : 'copilot';
        const row = combo(labels, labels[values.indexOf(selectedValue)]);
        row.title = _('Copilot icon');
        row.subtitle = _('Use the Microsoft Copilot logo or the GitHub Copilot logo.');
        row.connect('notify::selected', () => {
            const value = values[row.selected] || 'copilot';
            this._setProviderUsageSetting(provider, 'iconSource', value === 'copilot' ? null : value);
            this._renderProviders(providerKey(provider));
        });
        return row;
    }

    _customIconRow(provider) {
        const row = new Adw.ActionRow({
            title: _('Custom icon SVG'),
            subtitle: provider.iconPath || _('Using default fallback icon'),
        });

        const entry = new Gtk.Entry({
            text: provider.iconPath || '',
            placeholder_text: '/path/to/icon.svg',
            hexpand: true,
            valign: Gtk.Align.CENTER,
        });
        entry.connect('changed', () => {
            this._assignOptional(provider, 'iconPath', entry.get_text());
            row.set_subtitle(provider.iconPath || _('Using default fallback icon'));
            this._save();
        });
        row.add_suffix(entry);

        const browseButton = new Gtk.Button({
            label: _('Browse'),
            valign: Gtk.Align.CENTER,
        });
        browseButton.connect('clicked', () => {
            const filter = new Gtk.FileFilter();
            filter.set_name(_('SVG icons'));
            filter.add_suffix('svg');
            const dialog = new Gtk.FileChooserNative({
                title: _('Choose custom icon'),
                transient_for: this.get_root(),
                action: Gtk.FileChooserAction.OPEN,
                accept_label: _('Choose'),
                cancel_label: _('Cancel'),
            });
            dialog.add_filter(filter);
            dialog.connect('response', (_dialog, response) => {
                if (response === Gtk.ResponseType.ACCEPT) {
                    const file = dialog.get_file();
                    if (file) {
                        entry.set_text(file.get_path());
                        this._renderProviders(providerKey(provider));
                    }
                }
                dialog.destroy();
            });
            dialog.show();
        });
        row.add_suffix(browseButton);

        const clearButton = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            tooltip_text: _('Clear custom icon'),
            valign: Gtk.Align.CENTER,
        });
        clearButton.connect('clicked', () => {
            entry.set_text('');
            this._renderProviders(providerKey(provider));
        });
        row.add_suffix(clearButton);
        row.activatable_widget = entry;
        return row;
    }

    _providerIconPreview(provider, size) {
        const fileName = this._providerIconFile(provider);
        if (fileName) {
            const file = this._providerIconGFile(fileName);
            if (file.query_exists(null)) {
                const renderFile = this._providerIconRenderFile(file, fileName);
                return new Gtk.Image({
                    gicon: Gio.FileIcon.new(renderFile),
                    pixel_size: size,
                    valign: Gtk.Align.CENTER,
                });
            }
        }

        return new Gtk.Image({
            icon_name: 'applications-science-symbolic',
            pixel_size: size,
            valign: Gtk.Align.CENTER,
        });
    }

    _providerIconFile(provider) {
        if (this._isCustomProvider(provider) && provider.iconPath) {
            const customFile = Gio.File.new_for_path(provider.iconPath);
            if (customFile.query_exists(null))
                return provider.iconPath;
        }

        const baseId = providerBaseId(provider);
        const iconSource = this._providerUsageSetting(provider, 'iconSource');
        const iconId = baseId === 'codex' && iconSource === 'openai'
            ? 'openai'
            : baseId === 'claude' && iconSource === 'claudecode'
                ? 'claudecode'
                : baseId === 'copilot' && iconSource === 'githubcopilot'
                    ? 'githubcopilot'
                    : baseId;
        const baseFile = PROVIDER_ICON_FILES[iconId] || `${iconId}.svg`;
        const style = this._providerUsageSetting(provider, 'iconStyle') || this._settings.get_string('provider-icon-style');
        const colorFile = style === 'color' && baseFile ? baseFile.replace(/\.svg$/, '-color.svg') : null;
        if (colorFile) {
            const file = this._providerIconGFile(colorFile);
            if (file.query_exists(null))
                return colorFile;
        }
        const file = this._providerIconGFile(baseFile);
        return file.query_exists(null) ? baseFile : null;
    }

    _providerIconGFile(fileName) {
        if (GLib.path_is_absolute(fileName))
            return Gio.File.new_for_path(fileName);
        return Gio.File.new_for_path(GLib.build_filenamev([GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]), 'assets', 'provider-icons', fileName]));
    }

    _providerIconRenderFile(file, fileName) {
        if (fileName.endsWith('-color.svg'))
            return file;

        return this._themedProviderIconFile(file, this._providerIconForegroundColor());
    }

    _providerIconForegroundColor() {
        try {
            const styleManager = Adw.StyleManager.get_default();
            const isDark = typeof styleManager.get_dark === 'function'
                ? styleManager.get_dark()
                : styleManager.dark;
            return isDark ? '#ffffff' : '#000000';
        } catch {
            return '#ffffff';
        }
    }

    _themedProviderIconFile(file, color) {
        try {
            const [ok, bytes] = file.load_contents(null);
            if (!ok)
                return file;
            const text = new TextDecoder().decode(bytes);
            if (!text.includes('currentColor'))
                return file;

            const themed = text.replace(/currentColor/g, color);
            const cacheDir = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_cache_dir(), 'usagestat-bar', 'provider-icons']));
            if (!cacheDir.query_exists(null))
                cacheDir.make_directory_with_parents(null);
            const sourcePath = file.get_path() || 'provider-icon';
            const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, `${sourcePath}:${color}:${text}`, -1).slice(0, 16);
            const basename = GLib.path_get_basename(sourcePath).replace(/\.svg$/i, '');
            const themedPath = GLib.build_filenamev([cacheDir.get_path(), `${basename}-${hash}.svg`]);
            const themedFile = Gio.File.new_for_path(themedPath);
            if (!themedFile.query_exists(null)) {
                themedFile.replace_contents(
                    new TextEncoder().encode(themed),
                    null,
                    false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION,
                    null,
                );
            }
            return themedFile;
        } catch (error) {
            logError(error, 'UsageStat Bar: failed to theme provider icon');
            return file;
        }
    }

    _usageTierRow(provider) {
        const options = this._usageTierOptions(provider);
        const values = options.map(([value]) => value);
        const labels = options.map(([, label]) => label);
        const selectedValue = values.includes(this._providerUsageSetting(provider, 'panelUsageTier')) ? this._providerUsageSetting(provider, 'panelUsageTier') : 'auto';
        const row = combo(labels, labels[values.indexOf(selectedValue)]);
        row.title = _('Top bar usage window');
        row.subtitle = _('Usage measure shown when this provider is active.');
        row.connect('notify::selected', () => {
            const value = values[row.selected] || 'auto';
            this._setProviderUsageSetting(provider, 'panelUsageTier', value === 'auto' ? null : value);
        });
        return row;
    }

    _usageTrackersRow(provider) {
        const options = this._usageTrackerOptions(provider);
        const row = new Adw.ExpanderRow({
            title: _('Usage trackers'),
            subtitle: _('Choose which usage meters are shown in the popup and auto meter.'),
        });

        if (!options.length) {
            row.add_row(new Adw.ActionRow({
                title: _('No usage trackers discovered yet'),
                subtitle: _('Refresh this provider once to populate tracker controls.'),
            }));
            return row;
        }

        for (const [windowId, label] of options) {
            const item = new Adw.ActionRow({title: label});
            const toggle = new Gtk.Switch({
                active: !this._hiddenUsageWindows(provider).includes(windowId),
                valign: Gtk.Align.CENTER,
            });
            toggle.connect('notify::active', () => {
                this._setUsageWindowVisible(provider, windowId, toggle.active);
            });
            item.add_suffix(toggle);
            item.activatable_widget = toggle;
            row.add_row(item);
        }

        return row;
    }

    _usageTrackerOptions(provider) {
        let discovered = null;
        try {
            const windows = JSON.parse(this._settings.get_string('provider-usage-windows')) || {};
            discovered = windows[providerKey(provider)] || windows[providerBaseId(provider)] || null;
        } catch {
            discovered = null;
        }

        if (!discovered || typeof discovered !== 'object')
            return this._usageTierOptions(provider).filter(([value]) => value !== 'auto');

        return Object.entries(discovered)
            .filter(([, label]) => typeof label === 'string' && label.trim())
            .map(([id, label]) => [id, label.trim()]);
    }

    _usageTierOptions(provider) {
        const fallback = [
            ['auto', _('Auto')],
            ['primary', _('Session')],
            ['secondary', _('Weekly')],
        ];

        let discovered = null;
        try {
            const windows = JSON.parse(this._settings.get_string('provider-usage-windows')) || {};
            discovered = windows[providerKey(provider)] || windows[providerBaseId(provider)] || null;
        } catch {
            discovered = null;
        }

        if (!discovered || typeof discovered !== 'object')
            return fallback;

        const options = [['auto', _('Auto')]];
        for (const tier of ['primary', 'secondary', 'tertiary', 'quaternary']) {
            const label = discovered[tier];
            if (typeof label === 'string' && label.trim())
                options.push([tier, label.trim()]);
        }
        if (typeof discovered.extraUsage === 'string' && discovered.extraUsage.trim())
            options.push(['extraUsage', discovered.extraUsage.trim()]);
        for (const [id, label] of Object.entries(discovered)) {
            if (id.startsWith('text:') || id.startsWith('badge:'))
                continue;
            if (id === 'extraUsage' || TIERS.includes(id))
                continue;
            if (typeof label === 'string' && label.trim())
                options.push([id, label.trim()]);
        }

        return options.length > 1 ? options : fallback;
    }

    _providerUsageSettings() {
        try {
            return JSON.parse(this._settings.get_string('provider-usage-settings')) || {};
        } catch {
            return {};
        }
    }

    _providerUsageSetting(provider, key) {
        return this._providerUsageSettings()[providerKey(provider)]?.[key] || null;
    }

    _setProviderUsageSetting(provider, key, value) {
        const all = this._providerUsageSettings();
        const id = providerKey(provider);
        const next = {...(all[id] || {})};
        if (value === null || value === undefined || value === '')
            delete next[key];
        else
            next[key] = value;
        if (Object.keys(next).length)
            all[id] = next;
        else
            delete all[id];
        this._settings.set_string('provider-usage-settings', JSON.stringify(all));
    }

    _hiddenUsageWindows(provider) {
        const hidden = this._providerUsageSetting(provider, 'hiddenWindows');
        return Array.isArray(hidden) ? hidden : [];
    }

    _setUsageWindowVisible(provider, windowId, visible) {
        const hidden = this._hiddenUsageWindows(provider).filter(id => id !== windowId);
        if (!visible)
            hidden.push(windowId);
        this._setProviderUsageSetting(provider, 'hiddenWindows', hidden.length ? hidden : null);
    }

    _addTabExtensionRows(row, provider) {
        const children = this._childProviders(providerKey(provider));
        if (children.length) {
            const childList = new Gtk.ListBox({
                selection_mode: Gtk.SelectionMode.NONE,
            });
            childList.add_css_class('boxed-list');

            for (const child of children)
                childList.append(this._buildChildSourceRow(child, providerKey(provider)));

            row.add_row(new Adw.PreferencesRow({child: childList}));
        }

        const addSourceRow = new Adw.ActionRow({
            title: _('Add source to this tab'),
            subtitle: _('Add account, API token, or custom command tracking under this provider tab.'),
        });
        const addSourceButton = new Gtk.Button({
            label: _('Add'),
            valign: Gtk.Align.CENTER,
        });
        addSourceButton.connect('clicked', () => this._addChildProvider(provider, {
            source: provider.source || 'auto',
            displayName: _('%s Source').format(this._name(provider)),
        }));
        addSourceRow.add_suffix(addSourceButton);
        row.add_row(addSourceRow);
    }

    _buildChildSourceRow(provider, parentKey) {
        const listRow = new Gtk.ListBoxRow();
        listRow._providerKey = providerKey(provider);

        const row = new Adw.ExpanderRow({
            title: this._name(provider),
            subtitle: this._subtitle(provider),
        });
        row.add_prefix(new Gtk.Image({
            icon_name: 'list-drag-handle-symbolic',
            tooltip_text: _('Drag to reorder'),
        }));
        const validator = this._sourceValidator(provider);
        row.add_suffix(validator.box);

        const nameRow = entryRow(_('Name'), provider.displayName || '', this._name(providerBaseId(provider)));
        nameRow._entry.connect('changed', () => {
            this._assignOptional(provider, 'displayName', nameRow._entry.get_text());
            row.set_title(this._name(provider));
        });
        row.add_row(nameRow);

        if (!this._isCustomProvider(provider)) {
            row.add_row(this._buildSourceExpanderRow(provider, row, validator));
        } else {
            this._addRelevantRows(row, provider, validator);
        }

        const deleteRow = new Adw.ActionRow({
            title: _('Delete from tab'),
            subtitle: _('Remove this section from the provider popup tab.'),
        });
        const deleteButton = new Gtk.Button({
            label: _('Delete'),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        deleteButton.connect('clicked', () => this._deleteProviderInstance(providerKey(provider), parentKey));
        deleteRow.add_suffix(deleteButton);
        row.add_row(deleteRow);

        listRow.set_child(row);
        this._setupDragAndDrop(listRow);
        return listRow;
    }

    _addChildProvider(provider, overrides = {}) {
        const baseId = providerBaseId(provider);
        const copy = {
            id: baseId,
            instanceId: makeProviderInstanceId(baseId),
            enabled: true,
            tabParent: providerKey(provider),
            source: 'auto',
            ...overrides,
        };
        this._config.providers.push(copy);
        this._save();
        this._renderProviders(providerKey(provider));
    }

    _sourceValidator(provider) {
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            valign: Gtk.Align.CENTER,
        });
        const label = new Gtk.Label({
            use_markup: true,
            valign: Gtk.Align.CENTER,
        });
        const button = new Gtk.Button({
            icon_name: 'view-refresh-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Check source now'),
        });
        button.add_css_class('flat');
        button.connect('clicked', () => this._forceValidateProvider(provider, label));
        box.append(label);
        box.append(button);

        if (provider.enabled === false) {
            this._setStatusDot(label, 'orange', _('Disabled'));
            return {box, label};
        }

        const cacheKey = this._validationCacheKey(provider);
        const cached = this._validationCache.get(cacheKey);
        if (cached) {
            this._setStatusDot(label, cached.state, cached.message);
            return {box, label};
        }

        this._setStatusDot(label, 'orange', _('Checking source...'));
        this._validateProvider(provider, label);
        return {box, label};
    }

    _setStatusDot(label, state, tooltip) {
        if (!label)
            return;
        const color = {
            green: '#33d17a',
            orange: '#f6d32d',
            red: '#ff5f57',
        }[state] || '#f6d32d';
        label.set_markup(`<span foreground="${color}" size="large">●</span>`);
        label.set_tooltip_text(tooltip || '');
    }

    async _validateProvider(provider, label) {
        const cacheKey = this._validationCacheKey(provider);
        if (this._validationInFlight.has(cacheKey)) {
            this._validationInFlight.get(cacheKey).then(result => this._setStatusDot(label, result.state, result.message));
            return;
        }

        const promise = this._probeProvider(provider)
            .then(result => {
                this._validationCache.set(cacheKey, result);
                this._validationInFlight.delete(cacheKey);
                return result;
            })
            .catch(error => {
                const result = {state: 'red', message: error.message || String(error)};
                this._validationCache.set(cacheKey, result);
                this._validationInFlight.delete(cacheKey);
                return result;
            });
        this._validationInFlight.set(cacheKey, promise);

        const result = await promise;
        this._setStatusDot(label, result.state, result.message);
    }

    _forceValidateProvider(provider, label) {
        this._clearValidationDebounce(provider);
        this._validationCache.delete(this._validationCacheKey(provider));
        if (provider.enabled === false) {
            this._setStatusDot(label, 'orange', _('Disabled'));
            return;
        }
        this._setStatusDot(label, 'orange', _('Checking source...'));
        this._validateProvider(provider, label);
    }

    _scheduleValidation(provider, label) {
        this._clearValidationDebounce(provider);
        if (provider.enabled === false)
            return;
        this._setStatusDot(label, 'orange', _('Waiting for edits...'));
        const key = providerKey(provider);
        const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, VALIDATION_DEBOUNCE_SECONDS, () => {
            this._validationDebounceIds.delete(key);
            this._forceValidateProvider(provider, label);
            return GLib.SOURCE_REMOVE;
        });
        this._validationDebounceIds.set(key, id);
    }

    _clearValidationDebounce(provider) {
        const key = providerKey(provider);
        const id = this._validationDebounceIds.get(key);
        if (id)
            GLib.source_remove(id);
        this._validationDebounceIds.delete(key);
    }

    async _probeProvider(provider) {
        const result = await this._runValidationCommand(this._validationArgv(provider));
        const stdout = result.stdout.trim();
        const stderr = result.stderr.trim();
        if (!stdout)
            return {state: 'red', message: stderr.split('\n')[0] || _('No output from source validation.')};

        let payload;
        try {
            payload = JSON.parse(stdout);
        } catch (error) {
            return {state: 'red', message: _('Validation returned invalid JSON: %s').format(error.message)};
        }

        const snapshot = Array.isArray(payload) ? payload[0] : payload;
        if (snapshot?.source === 'error' || snapshot?.error) {
            const message = snapshot?.error?.message || snapshot?.error || this._firstErrorMetric(snapshot) || _('Source returned an error.');
            return {state: 'red', message: String(message)};
        }
        if (Array.isArray(snapshot?.metrics) && snapshot.metrics.length)
            return {state: 'green', message: _('Source validated successfully.')};
        if (snapshot && typeof snapshot === 'object')
            return {state: 'orange', message: _('Source responded, but no usage metrics were returned.')};
        return {state: 'red', message: _('Source validation returned an unexpected response.')};
    }

    _validationArgv(provider) {
        if (this._isCustomProvider(provider))
            return ['bash', '-lc', provider.customCommand || ''];

        const binary = findAiUsage(this._settings.get_string('usagestat-cli-path')) || '';
        const pluginDir = this._settings.get_string('usagestat-plugin-dir').trim();
        const argv = [binary, '--json'];
        if (binary)
            argv.push('--config', configPath(binary));
        if (pluginDir)
            argv.push('--plugin-dir', pluginDir);
        argv.push('usage', '--provider', providerBaseId(provider));
        if (provider.source && provider.source !== 'auto')
            argv.push('--source', provider.source);
        return argv;
    }

    _runValidationCommand(argv) {
        return new Promise((resolve, reject) => {
            if (!argv[0]) {
                reject(new Error(_('No validation command configured.')));
                return;
            }

            const proc = Gio.Subprocess.new(
                argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            );

            let timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, VALIDATION_TIMEOUT_SECONDS, () => {
                try {
                    proc.force_exit();
                } catch {
                    // Process may already be gone.
                }
                timeoutId = 0;
                return GLib.SOURCE_REMOVE;
            });

            proc.communicate_utf8_async(null, null, (process, result) => {
                if (timeoutId)
                    GLib.source_remove(timeoutId);
                try {
                    const [, stdout, stderr] = process.communicate_utf8_finish(result);
                    const status = process.get_exit_status();
                    if (status !== 0)
                        reject(new Error((stderr || stdout || `Exited with status ${status}`).trim().split('\n')[0]));
                    else
                        resolve({stdout: stdout || '', stderr: stderr || ''});
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    _validationCacheKey(provider) {
        return JSON.stringify([
            providerKey(provider),
            providerBaseId(provider),
            provider.source || 'auto',
            provider.customCommand || '',
            provider.apiKey || '',
            provider.cookieHeader || '',
            provider.region || '',
            provider.workspaceId || '',
            provider.settings || {},
        ]);
    }

    _firstErrorMetric(snapshot) {
        const metric = (snapshot?.metrics || []).find(item => item?.type === 'badge' && String(item.label || '').toLowerCase().includes('error'));
        return metric?.text || null;
    }

    _buildHiddenProviderRow(provider) {
        const row = new Adw.ActionRow({
            title: this._name(provider),
            subtitle: providerBaseId(provider),
        });
        row.add_prefix(this._providerIconPreview(provider, 24));
        const unhideButton = new Gtk.Button({
            label: _('Unhide'),
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
        });
        unhideButton.connect('clicked', () => {
            delete provider.hidden;
            provider.enabled = false;
            this._save();
            this._renderProviders(null);
        });
        row.add_suffix(unhideButton);
        return row;
    }

    _addHideSourceRow(row, provider) {
        const hideRow = new Adw.ActionRow({
            title: _('Hide provider'),
            subtitle: _('Move to the Hidden section at the bottom of this page.'),
        });
        const hideButton = new Gtk.Button({
            label: _('Hide'),
            valign: Gtk.Align.CENTER,
        });
        hideButton.connect('clicked', () => {
            provider.hidden = true;
            provider.enabled = false;
            this._save();
            this._renderProviders(null);
        });
        hideRow.add_suffix(hideButton);
        row.add_row(hideRow);
    }

    _addDeleteSourceRow(row, provider) {
        if (provider.instanceId) {
            const deleteRow = new Adw.ActionRow({
                title: _('Delete source'),
                subtitle: _('Remove this extra source from the provider list.'),
            });
            const deleteButton = new Gtk.Button({
                label: _('Delete'),
                valign: Gtk.Align.CENTER,
                css_classes: ['destructive-action'],
            });
            deleteButton.connect('clicked', () => this._deleteProviderInstance(providerKey(provider)));
            deleteRow.add_suffix(deleteButton);
            row.add_row(deleteRow);
        }
    }

    _deleteProviderInstance(key, expandedId = null) {
        this._config.providers = this._config.providers.filter(provider =>
            providerKey(provider) !== key && provider.tabParent !== key);
        this._save();
        this._renderProviders(expandedId);
    }

    _buildSourceExpanderRow(provider, parentRow, validator) {
        const baseId = providerBaseId(provider);
        const sourceOptions = this._supportedSourceOptions(baseId);
        const currentSource = provider.source || 'auto';

        const expander = new Adw.ExpanderRow({
            title: _('Source'),
            subtitle: this._sourceSubtitle(baseId, currentSource),
        });

        const valueLabel = new Gtk.Label({
            label: currentSource,
            css_classes: ['dim-label'],
            valign: Gtk.Align.CENTER,
        });
        expander.add_suffix(valueLabel);

        const modeRow = combo(sourceOptions, currentSource);
        modeRow.title = _('Mode');
        expander.add_row(modeRow);

        let trackedRows = [];
        const rebuildRows = () => {
            for (const r of trackedRows)
                expander.remove(r);
            trackedRows = [];
            const sink = {add_row: r => { expander.add_row(r); trackedRows.push(r); }};
            this._addRelevantRows(sink, provider, validator);
        };

        rebuildRows();

        modeRow.connect('notify::selected', () => {
            provider.source = modeRow._values[modeRow.selected] || 'auto';
            valueLabel.set_label(provider.source);
            expander.set_subtitle(this._sourceSubtitle(baseId, provider.source));
            parentRow?.set_subtitle(this._subtitle(provider));
            this._save();
            rebuildRows();
        });

        return expander;
    }

    _addRelevantRows(row, provider, validator = null) {
        const effectiveSource = this._effectiveSource(provider);
        const baseId = providerBaseId(provider);

        if (this._isCustomProvider(provider)) {
            row.add_row(this._customIconRow(provider));

            const commandRow = entryRow(_('CLI command'), provider.customCommand || '', _('Command that prints usagestat-style usage JSON'));
            commandRow._entry.connect('changed', () => {
                this._assignOptional(provider, 'customCommand', commandRow._entry.get_text());
                this._scheduleValidation(provider, validator?.label);
            });
            row.add_row(commandRow);

            const note = new Adw.ActionRow({
                title: _('Custom source'),
                subtitle: _('The command output should be a usage JSON object or an array containing one usage object.'),
            });
            row.add_row(note);
            return;
        }

        if (effectiveSource === 'api') {
            const apiKeyRow = entryRow(_('API key'), provider.apiKey || '', _('Provider API token'), true);
            apiKeyRow._entry.connect('changed', () => {
                this._assignOptional(provider, 'apiKey', apiKeyRow._entry.get_text());
                this._scheduleValidation(provider, validator?.label);
            });
            row.add_row(apiKeyRow);
        }

        if (effectiveSource === 'web') {
            const cookieHeaderRow = entryRow(_('Cookie header'), provider.cookieHeader || '', _('name=value; other=value'), true);
            cookieHeaderRow._entry.connect('changed', () => {
                this._assignOptional(provider, 'cookieHeader', cookieHeaderRow._entry.get_text());
                this._scheduleValidation(provider, validator?.label);
            });
            const importButton = new Gtk.Button({
                icon_name: 'folder-download-symbolic',
                valign: Gtk.Align.CENTER,
                tooltip_text: _('Import browser cookies'),
                css_classes: ['suggested-action'],
            });
            importButton.connect('clicked', () => this._importCookies(provider, cookieHeaderRow._entry, validator?.label));
            const loginUrl = this._providerLoginUrl(provider);
            if (loginUrl) {
                const loginButton = new Gtk.Button({
                    icon_name: 'web-browser-symbolic',
                    valign: Gtk.Align.CENTER,
                    tooltip_text: _('Open provider login'),
                });
                loginButton.connect('clicked', () => this._openProviderLogin(provider));
                cookieHeaderRow.add_suffix(loginButton);
            }
            cookieHeaderRow.add_suffix(importButton);
            row.add_row(cookieHeaderRow);
        }

        if (effectiveSource === 'cli') {
            this._addSettingEntry(row, provider, 'profile', _('CLI profile'), _('Optional provider CLI profile'), validator);
            this._addSettingEntry(row, provider, 'path', _('CLI path'), _('Optional config, database, or executable path'), validator);
        }

        if (effectiveSource === 'oauth') {
            this._addSettingEntry(row, provider, 'account', _('OAuth account'), _('Optional account label'), validator);
            this._addSettingEntry(row, provider, 'tokenPath', _('Token path'), _('Optional OAuth token file'), validator);
        }

        if (effectiveSource === 'local') {
            this._addSettingEntry(row, provider, 'path', _('Local path'), _('Optional local database, cache, or log path'), validator);
            this._addSettingEntry(row, provider, 'project', _('Project'), _('Optional project or workspace label'), validator);
        }

        if (['zai', 'minimax', 'doubao'].includes(baseId)) {
            const regionRow = entryRow(_('Region'), provider.region || '', _('Provider-specific region'));
            regionRow._entry.connect('changed', () => {
                this._assignOptional(provider, 'region', regionRow._entry.get_text());
                this._scheduleValidation(provider, validator?.label);
            });
            row.add_row(regionRow);
        }

        if (['opencode-go', 'openai-api'].includes(baseId)) {
            const workspaceRow = entryRow(_('Workspace ID'), provider.workspaceId || '', _('Provider-specific workspace'));
            workspaceRow._entry.connect('changed', () => {
                this._assignOptional(provider, 'workspaceId', workspaceRow._entry.get_text());
                this._scheduleValidation(provider, validator?.label);
            });
            row.add_row(workspaceRow);
        }
    }

    _addSettingEntry(row, provider, key, title, placeholder, validator = null) {
        const settings = provider.settings || {};
        const settingRow = entryRow(title, settings[key] || '', placeholder);
        settingRow._entry.connect('changed', () => {
            const value = settingRow._entry.get_text().trim();
            provider.settings = {...(provider.settings || {})};
            if (value)
                provider.settings[key] = value;
            else
                delete provider.settings[key];
            if (!Object.keys(provider.settings).length)
                delete provider.settings;
            this._save();
            this._scheduleValidation(provider, validator?.label);
        });
        row.add_row(settingRow);
    }

    async _importCookies(provider, entry, validationLabel = null) {
        try {
            const binary = findAiUsage();
            if (!binary)
                throw new Error(_('usagestat CLI was not found on PATH or in common install locations.'));

            const {stdout, stderr, status} = await this._runCookieImportCommand([
                binary,
                'auth',
                'import-cookies',
                '--provider',
                providerBaseId(provider),
                '--format',
                'json',
            ]);

            const text = stdout.trim();
            if (!text)
                throw new Error(stderr.trim() || _('No cookies were imported.'));

            const parsed = JSON.parse(text);
            const payload = Array.isArray(parsed) ? parsed[0] : parsed;
            const message = this._cookieImportErrorMessage(payload, stderr.trim());
            if (status !== 0) {
                if (this._isCookieSessionNotFound(payload)) {
                    this._showCookieLoginDialog(message, provider, entry, validationLabel);
                    return;
                }
                throw new Error(message);
            }

            const cookieHeader = payload?.cookieHeader || payload?.cookie_header || '';
            if (!cookieHeader)
                throw new Error(message);

            provider.cookieHeader = cookieHeader;
            entry.set_text(cookieHeader);
            this._save();
            this._forceValidateProvider(provider, validationLabel);
        } catch (error) {
            this._showError(_('Could not import cookies'), error.message || String(error));
        }
    }

    _isCookieSessionNotFound(payload) {
        const error = payload?.error;
        const code = typeof error === 'string' ? error : error?.code;
        return code === 'SESSION_NOT_FOUND';
    }

    _cookieImportErrorMessage(payload, stderr = '') {
        const error = payload?.error;
        const candidates = [
            payload?.message,
            payload?.details,
            error?.message,
            error?.details,
            typeof error === 'string' ? error : null,
            error?.code,
            stderr,
            _('No browser cookies found.'),
        ];
        return String(candidates.find(item => item !== undefined && item !== null && String(item).trim()) || '').trim();
    }

    _showCookieLoginDialog(message, provider, entry, validationLabel = null) {
        const loginUrl = this._providerLoginUrl(provider);
        const dialog = new Adw.MessageDialog({
            transient_for: this.get_root(),
            modal: true,
            heading: _('Could not import cookies'),
            body: message || _('No usable ChatGPT/OpenAI browser cookies found.'),
        });
        dialog.add_response('cancel', _('Cancel'));
        if (loginUrl)
            dialog.add_response('login', _('Open Login'));
        dialog.add_response('rescan', _('Rescan'));
        dialog.set_default_response(loginUrl ? 'login' : 'rescan');
        dialog.set_close_response('cancel');
        if (loginUrl)
            dialog.set_response_appearance('login', Adw.ResponseAppearance.SUGGESTED);
        else
            dialog.set_response_appearance('rescan', Adw.ResponseAppearance.SUGGESTED);

        dialog.connect('response', (_dialog, response) => {
            if (response === 'login') {
                this._openProviderLogin(provider);
                this._showCookieRescanDialog(provider, entry, validationLabel);
            } else if (response === 'rescan') {
                this._importCookies(provider, entry, validationLabel);
            }
        });
        dialog.present();
    }

    _showCookieRescanDialog(provider, entry, validationLabel = null) {
        const dialog = new Adw.MessageDialog({
            transient_for: this.get_root(),
            modal: true,
            heading: _('Import browser cookies'),
            body: _('After signing in to %s in the browser, rescan for cookies.').format(this._name(provider)),
        });
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('rescan', _('Rescan'));
        dialog.set_default_response('rescan');
        dialog.set_close_response('cancel');
        dialog.set_response_appearance('rescan', Adw.ResponseAppearance.SUGGESTED);
        dialog.connect('response', (_dialog, response) => {
            if (response === 'rescan')
                this._importCookies(provider, entry, validationLabel);
        });
        dialog.present();
    }

    _providerLoginUrl(provider) {
        const baseId = providerBaseId(provider);
        const manifest = this._manifest(baseId);
        return provider?.loginUrl || provider?.settings?.loginUrl || manifest?.webUrl || PROVIDER_LOGIN_URLS[baseId] || '';
    }

    _openProviderLogin(provider) {
        const url = this._providerLoginUrl(provider);
        if (!url) {
            this._showError(_('No login URL configured'), _('No login URL is available for this provider.'));
            return;
        }
        try {
            Gio.app_info_launch_default_for_uri(url, null);
        } catch (error) {
            logError(error, 'UsageStat Bar: failed to open provider login');
            this._showError(_('Could not open browser'), error.message || String(error));
        }
    }

    _runCookieImportCommand(argv) {
        return new Promise((resolve, reject) => {
            const proc = Gio.Subprocess.new(
                argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            );

            let timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, VALIDATION_TIMEOUT_SECONDS, () => {
                try {
                    proc.force_exit();
                } catch {
                    // Process may already be gone.
                }
                timeoutId = 0;
                return GLib.SOURCE_REMOVE;
            });

            proc.communicate_utf8_async(null, null, (process, result) => {
                if (timeoutId)
                    GLib.source_remove(timeoutId);
                try {
                    const [, stdout, stderr] = process.communicate_utf8_finish(result);
                    resolve({
                        stdout: stdout || '',
                        stderr: stderr || '',
                        status: process.get_exit_status(),
                    });
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    _setupDragAndDrop(listRow) {
        const drag = new Gtk.DragSource({
            actions: Gdk.DragAction.MOVE,
        });
        drag.connect('prepare', () => {
            const value = new GObject.Value();
            value.init(GObject.TYPE_STRING);
            value.set_string(listRow._providerKey);
            return Gdk.ContentProvider.new_for_value(value);
        });
        listRow.add_controller(drag);

        const drop = Gtk.DropTarget.new(GObject.TYPE_STRING, Gdk.DragAction.MOVE);
        drop.connect('drop', (target, sourceId) => {
            this._moveProvider(String(sourceId), listRow._providerKey);
            return true;
        });
        listRow.add_controller(drop);
    }

    _moveProvider(sourceId, targetId) {
        if (!sourceId || !targetId || sourceId === targetId)
            return;

        const providers = this._config.providers;
        const sourceIndex = providers.findIndex(provider => providerKey(provider) === sourceId);
        const targetIndex = providers.findIndex(provider => providerKey(provider) === targetId);
        if (sourceIndex < 0 || targetIndex < 0)
            return;
        if (providers[sourceIndex].enabled === false || providers[targetIndex].enabled === false)
            return;
        if ((providers[sourceIndex].tabParent || '') !== (providers[targetIndex].tabParent || ''))
            return;

        const [provider] = providers.splice(sourceIndex, 1);
        providers.splice(targetIndex, 0, provider);
        this._save();
        this._renderProviders(provider.tabParent || providerKey(provider));
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
        if (this._isCustomProvider(provider))
            return _('Enabled, custom CLI source');
        return _('Enabled, %s source').format(provider.source || 'auto');
    }

    _sourceSubtitle(providerId, source) {
        if (providerId === 'codex' && source === 'auto')
            return _('Uses usagestat provider defaults.');
        if (source === 'auto')
            return _('Uses usagestat provider defaults.');
        if (source === 'api')
            return _('Uses a provider API token.');
        if (source === 'web')
            return _('Uses browser session cookies.');
        if (source === 'cli')
            return _('Uses local CLI/app state, with optional profile or path hints.');
        if (source === 'oauth')
            return _('Uses OAuth login state, with optional account or token path hints.');
        if (source === 'local')
            return _('Uses local files, databases, caches, or services.');
        return _('Uses usagestat %s source.').format(source);
    }

    _apiKeyProviders() {
        return new Set(['codex', 'claude', 'gemini', 'copilot', 'zai', 'minimax', 'kimi', 'kimi-k2', 'kilo', 'warp', 'openrouter', 'synthetic', 'deepseek', 'codebuff', 'doubao', 'mistral', 'openai-api']);
    }

    _name(provider) {
        if (provider && typeof provider === 'object')
            return providerDisplayName(provider);
        return PROVIDERS.find(([providerId]) => providerId === provider)?.[1] || provider;
    }

    _isCustomProvider(provider) {
        return provider?.custom === true || Boolean(provider?.customCommand) || provider?.source === 'custom';
    }

    _childProviders(parentKey) {
        return this._config.providers.filter(provider => provider.tabParent === parentKey);
    }

    _showError(heading, body) {
        const dialog = new Adw.MessageDialog({
            transient_for: this.get_root(),
            modal: true,
            heading,
            body,
        });
        dialog.add_response('ok', _('OK'));
        dialog.present();
    }

});

const MaintenancePage = GObject.registerClass(
class MaintenancePage extends Adw.PreferencesPage {
    _init(settings) {
        super._init({
            title: _('Tools'),
            icon_name: 'applications-system-symbolic',
        });
        this._settings = settings;
        this.add(this._buildTerminalGroup());
        this.add(this._buildGroup());
    }

    _buildTerminalGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('Terminal'),
            description: _('Choose which terminal emulator opens Tools commands.'),
        });

        const detected = this._terminalOptions();
        const options = [['auto', _('Auto')], ...detected];
        const values = options.map(([value]) => value);
        const labels = options.map(([, label]) => label);
        const selected = values.includes(this._settings.get_string('tools-terminal'))
            ? this._settings.get_string('tools-terminal')
            : 'auto';
        const row = combo(labels, labels[values.indexOf(selected)]);
        row.title = _('Open tools with');
        row.connect('notify::selected', () => {
            this._settings.set_string('tools-terminal', values[row.selected] || 'auto');
        });
        group.add(row);

        if (!detected.length) {
            group.add(new Adw.ActionRow({
                title: _('No terminal detected'),
                subtitle: _('Install a terminal emulator to run CLI tools from preferences.'),
            }));
        }

        return group;
    }

    _buildGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('usagestat CLI'),
        });

        for (const [title, command] of [
            [_('Validate config'), 'usagestat config validate'],
            [_('Dump normalized config'), 'usagestat config dump'],
            [_('List providers'), 'usagestat list --all --plain'],
            [_('Show enabled usage'), 'usagestat usage'],
            [_('Show all usage JSON'), 'usagestat --json usage --provider all'],
            [_('Provider status'), 'usagestat status --provider all --plain'],
            [_('Cost summary'), 'usagestat cost --provider all'],
            [_('Export live usage JSON'), 'usagestat export --provider all --format json'],
            [_('Export live usage CSV'), 'usagestat export --provider all --format csv'],
            [_('Clear snapshots cache'), 'usagestat cache clear --snapshots'],
            [_('usagestat help'), 'usagestat --help'],
        ]) {
            const row = new Adw.ActionRow({
                title,
                subtitle: command,
            });
            const button = new Gtk.Button({
                icon_name: 'utilities-terminal-symbolic',
                valign: Gtk.Align.CENTER,
            });
            button.connect('clicked', () => this._runInTerminal(command));
            row.add_suffix(button);
            group.add(row);
        }

        const docsRow = new Adw.ActionRow({
            title: _('usagestat docs'),
            subtitle: _('Provider setup and config schema'),
        });
        const docsButton = new Gtk.Button({
            icon_name: 'help-browser-symbolic',
            valign: Gtk.Align.CENTER,
        });
        docsButton.connect('clicked', () => {
            Gio.app_info_launch_default_for_uri('https://github.com/hashim-k/usagestat', null);
        });
        docsRow.add_suffix(docsButton);
        group.add(docsRow);

        return group;
    }

    _runInTerminal(command) {
        const script = [
            `printf '\\033[1m$ %s\\033[0m\\n' ${this._shellQuote(command)}`,
            command,
            'status=$?',
            'printf "\\nExit status: %s\\n" "$status"',
            'read -r -p "Press enter to close..."',
        ].join('; ');

        const terminals = this._terminalCandidates(script);

        for (const argv of terminals) {
            if (!GLib.find_program_in_path(argv[0]))
                continue;
            try {
                Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
                return;
            } catch (error) {
                logError(error, `UsageStat Bar: failed to launch ${argv[0]}`);
            }
        }

        this._showError(
            _('No terminal found'),
            _('Install GNOME Console, GNOME Terminal, or another terminal emulator to run CLI tools from preferences.'),
        );
    }

    _shellQuote(value) {
        return `'${String(value).replaceAll("'", "'\\''")}'`;
    }

    _terminalCandidates(script) {
        const q = s => this._shellQuote(s);
        const byId = {
            kgx:                  ['kgx', '--', 'bash', '-lc', script],
            ptyxis:               ['ptyxis', '--', 'bash', '-lc', script],
            'gnome-terminal':     ['gnome-terminal', '--', 'bash', '-lc', script],
            'x-terminal-emulator':['x-terminal-emulator', '-e', 'bash', '-lc', script],
            konsole:              ['konsole', '-e', 'bash', '-lc', script],
            yakuake:              ['yakuake', '-e', 'bash', '-lc', script],
            'xfce4-terminal':     ['xfce4-terminal', '-e', `bash -lc ${q(script)}`],
            alacritty:            ['alacritty', '-e', 'bash', '-lc', script],
            kitty:                ['kitty', 'bash', '-lc', script],
            ghostty:              ['ghostty', '-e', 'bash', '-lc', script],
            foot:                 ['foot', 'bash', '-lc', script],
            xterm:                ['xterm', '-e', 'bash', '-lc', script],
            urxvt:                ['urxvt', '-e', 'bash', '-lc', script],
            wezterm:              ['wezterm', 'start', 'bash', '-lc', script],
            terminator:           ['terminator', '-e', `bash -lc ${q(script)}`],
            tilix:                ['tilix', '-e', 'bash', '-lc', script],
            'lxterminal':         ['lxterminal', '-e', `bash -lc ${q(script)}`],
            'mate-terminal':      ['mate-terminal', '-e', `bash -lc ${q(script)}`],
            guake:                ['guake', `--execute-command=bash -lc ${q(script)}`],
            st:                   ['st', '-e', 'bash', '-lc', script],
            terminology:          ['terminology', '-e', 'bash', '-lc', script],
            sakura:               ['sakura', '-e', 'bash', '-lc', script],
            contour:              ['contour', 'terminal', 'bash', '-lc', script],
            rio:                  ['rio', '-e', 'bash', '-lc', script],
            qterminal:            ['qterminal', '-e', `bash -lc ${q(script)}`],
            'cool-retro-term':    ['cool-retro-term', '-e', 'bash', '-lc', script],
        };
        const preferred = this._settings.get_string('tools-terminal');
        const order = this._terminalOptions().map(([id]) => id);
        if (preferred !== 'auto' && byId[preferred])
            return [byId[preferred], ...order.filter(id => id !== preferred).map(id => byId[id])];
        return order.map(id => byId[id]);
    }

    _terminalOptions() {
        return [
            ['kgx',                   _('GNOME Console')],
            ['ptyxis',                _('Ptyxis')],
            ['gnome-terminal',        _('GNOME Terminal')],
            ['x-terminal-emulator',   _('System default terminal')],
            ['konsole',               _('Konsole')],
            ['yakuake',               _('Yakuake')],
            ['xfce4-terminal',        _('Xfce Terminal')],
            ['alacritty',             _('Alacritty')],
            ['kitty',                 _('Kitty')],
            ['ghostty',               _('Ghostty')],
            ['foot',                  _('Foot')],
            ['xterm',                 _('XTerm')],
            ['urxvt',                 _('rxvt-unicode')],
            ['wezterm',               _('WezTerm')],
            ['terminator',            _('Terminator')],
            ['tilix',                 _('Tilix')],
            ['lxterminal',            _('LXTerminal')],
            ['mate-terminal',         _('MATE Terminal')],
            ['guake',                 _('Guake')],
            ['st',                    _('st')],
            ['terminology',           _('Terminology')],
            ['sakura',                _('Sakura')],
            ['contour',               _('Contour')],
            ['rio',                   _('Rio')],
            ['qterminal',             _('QTerminal')],
            ['cool-retro-term',       _('Cool Retro Term')],
        ].filter(([id]) => GLib.find_program_in_path(id));
    }

    _showError(heading, body) {
        const dialog = new Adw.MessageDialog({
            transient_for: this.get_root(),
            modal: true,
            heading,
            body,
        });
        dialog.add_response('ok', _('OK'));
        dialog.present();
    }
});

export default class AIUsageBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const targetProviderId = settings.get_string('preferences-provider');
        const providersPage = new ProvidersPage(settings);
        window.set_default_size(760, 760);
        window.add(new BehaviourPage(settings));
        window.add(new AppearancePage(settings));
        window.add(providersPage);
        window.add(new MaintenancePage(settings));
        if (targetProviderId)
            window.set_visible_page(providersPage);
    }
}
