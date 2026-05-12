import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {loadConfig, makeProviderInstanceId, providerBaseId, providerDisplayName, providerKey, PROVIDERS, saveConfig} from './config.js';

const SOURCE_OPTIONS = ['auto', 'web', 'cli', 'oauth', 'api'];
const CUSTOM_PROVIDER_VALUE = '__custom_provider__';
const EXTENSION_DIR = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const PANEL_COMPONENTS = [
    ['bar', 'Usage bar'],
    ['percent', 'Usage %'],
    ['logo', 'Logo'],
    ['text', 'Text'],
];
const DEFAULT_THRESHOLDS = [
    {id: 'warning', label: 'Warning', percent: 75, color: '#f6d32d', notify: false},
    {id: 'danger', label: 'Danger', percent: 90, color: '#ff5f57', notify: false},
    {id: 'limit', label: 'Limit reached', percent: 100, color: '#ff2d55', notify: false},
];

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
        this.add(this._buildPanelComponentsGroup());
        this.add(this._buildThresholdGroup());
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

        return group;
    }

    _buildPanelComponentsGroup() {
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
        const disabledGroup = new Adw.PreferencesGroup({title: _('Disabled Components')});
        disabledGroup.add(new Adw.PreferencesRow({child: this._disabledComponentList}));

        this.add(group);
        return disabledGroup;
    }

    _panelComponentOrder() {
        const valid = new Set(PANEL_COMPONENTS.map(([id]) => id));
        const enabled = this._settings.get_string('panel-components')
            .split(',')
            .map(part => part.trim())
            .filter(part => valid.has(part));
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
            title: this._componentLabel(componentId),
            subtitle: enabled ? _('Shown in the top bar') : _('Hidden'),
        });

        if (enabled) {
            row.add_prefix(new Gtk.Image({
                icon_name: 'list-drag-handle-symbolic',
                tooltip_text: _('Drag to reorder'),
            }));
        }

        const toggle = new Gtk.Switch({
            active: enabled,
            valign: Gtk.Align.CENTER,
        });
        toggle.connect('notify::active', () => this._setPanelComponentEnabled(componentId, toggle.active));
        row.add_suffix(toggle);
        listRow.set_child(row);

        if (enabled)
            this._setupPanelComponentDragAndDrop(listRow);

        return listRow;
    }

    _componentLabel(componentId) {
        return _(PANEL_COMPONENTS.find(([id]) => id === componentId)?.[1] || componentId);
    }

    _setPanelComponentEnabled(componentId, enabled) {
        const order = this._panelComponentOrder().filter(id => id !== componentId);
        if (enabled)
            order.push(componentId);
        this._settings.set_string('panel-components', order.join(',') || 'bar');
        this._renderPanelComponentLists();
    }

    _setupPanelComponentDragAndDrop(listRow) {
        const drag = new Gtk.DragSource({actions: Gdk.DragAction.MOVE});
        drag.connect('prepare', () => {
            const value = new GObject.Value();
            value.init(GObject.TYPE_STRING);
            value.set_string(listRow._componentId);
            return Gdk.ContentProvider.new_for_value(value);
        });
        listRow.add_controller(drag);

        const drop = Gtk.DropTarget.new(GObject.TYPE_STRING, Gdk.DragAction.MOVE);
        drop.connect('drop', (target, sourceId) => {
            this._movePanelComponent(String(sourceId), listRow._componentId);
            return true;
        });
        listRow.add_controller(drop);
    }

    _movePanelComponent(sourceId, targetId) {
        const order = this._panelComponentOrder();
        const sourceIndex = order.indexOf(sourceId);
        const targetIndex = order.indexOf(targetId);
        if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex)
            return;

        const [component] = order.splice(sourceIndex, 1);
        order.splice(targetIndex, 0, component);
        this._settings.set_string('panel-components', order.join(',') || 'bar');
        this._renderPanelComponentLists();
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
        this._config = loadConfig();
        this._save();

        this._enabledList = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
        });
        this._enabledList.add_css_class('boxed-list');

        this._disabledList = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
        });
        this._disabledList.add_css_class('boxed-list');

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

        this._disabledGroup = new Adw.PreferencesGroup({
            title: _('Disabled Providers'),
            description: _('Enable a provider to move it into the draggable list.'),
        });
        this._disabledGroup.add(new Adw.PreferencesRow({child: this._disabledList}));
        this.add(this._disabledGroup);

        this._renderProviders(this._targetProviderId);
        if (this._targetProviderId)
            this._settings.set_string('preferences-provider', '');
    }

    _provider(id) {
        let provider = this._config.providers.find(item => item.id === id);
        if (!provider) {
            provider = {id, enabled: false, source: 'auto', cookieSource: 'auto'};
            this._config.providers.push(provider);
        }
        return provider;
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

        const commandRow = entryRow(_('CLI command'), '', _('Command that prints CodexBar-style usage JSON'));
        row.add_row(commandRow);

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
            if (this._addProviderSource(selected, nameRow._entry.get_text(), commandRow._entry.get_text())) {
                nameRow._entry.set_text('');
                commandRow._entry.set_text('');
                row.set_expanded(false);
            }
        });
        addRow.add_suffix(addButton);
        row.add_row(addRow);

        const syncCommandState = () => {
            const isCustom = providerValues[providerRow.selected] === CUSTOM_PROVIDER_VALUE;
            commandRow.set_sensitive(isCustom);
            commandRow.subtitle = isCustom
                ? _('Required. The command must print a single JSON object or an array with one usage object.')
                : _('Only used for custom CLI sources.');
        };
        providerRow.connect('notify::selected', syncCommandState);
        syncCommandState();

        return row;
    }

    _addProviderSource(selectedProvider, rawName, rawCommand) {
        const displayName = rawName.trim();
        const command = rawCommand.trim();

        if (selectedProvider === CUSTOM_PROVIDER_VALUE) {
            if (!command) {
                this._showError(_('Command required'), _('Custom providers need a CLI command that prints usage JSON.'));
                return false;
            }

            const id = `custom-${Date.now().toString(36)}`;
            const provider = {
                id,
                instanceId: makeProviderInstanceId(id),
                enabled: true,
                source: 'custom',
                cookieSource: 'auto',
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
            source: 'auto',
            cookieSource: 'auto',
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
        saveConfig(this._config);
    }

    _renderProviders(expandedId = null) {
        while (this._enabledList.get_first_child())
            this._enabledList.remove(this._enabledList.get_first_child());
        while (this._disabledList.get_first_child())
            this._disabledList.remove(this._disabledList.get_first_child());

        for (const provider of this._orderedProviders()) {
            if (provider.enabled === false)
                this._disabledList.append(this._buildProviderListRow(provider, expandedId, false));
            else
                this._enabledList.append(this._buildProviderListRow(provider, expandedId, true));
        }
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
        row.add_suffix(enabled);

        const nameRow = entryRow(_('Name'), provider.displayName || '', this._name(baseId));
        nameRow._entry.connect('changed', () => {
            this._assignOptional(provider, 'displayName', nameRow._entry.get_text());
            row.set_title(this._name(provider));
        });
        row.add_row(nameRow);

        if (!this._isCustomProvider(provider)) {
            const sourceRow = combo(SOURCE_OPTIONS, provider.source || 'auto');
            sourceRow.title = _('Source');
            sourceRow.subtitle = this._sourceSubtitle(baseId, provider.source || 'auto');
            sourceRow.connect('notify::selected', () => {
                provider.source = SOURCE_OPTIONS[sourceRow.selected] || 'auto';
                row.set_subtitle(this._subtitle(provider));
                this._save();
                this._renderProviders(key);
            });
            row.add_row(sourceRow);
        }

        const tierRow = this._usageTierRow(provider);
        row.add_row(tierRow);

        this._addRelevantRows(row, provider);
        this._addTrackingRows(row, provider);
        this._addSourceInstanceRows(row, provider);

        listRow.set_child(row);
        if (draggable)
            this._setupDragAndDrop(listRow);
        return listRow;
    }

    _usageTierRow(provider) {
        const options = this._usageTierOptions(provider);
        const values = options.map(([value]) => value);
        const labels = options.map(([, label]) => label);
        const selectedValue = values.includes(provider.panelUsageTier) ? provider.panelUsageTier : 'auto';
        const row = combo(labels, labels[values.indexOf(selectedValue)]);
        row.title = _('Top bar usage window');
        row.subtitle = _('Usage measure shown when this provider is active.');
        row.connect('notify::selected', () => {
            provider.panelUsageTier = values[row.selected] || 'auto';
            if (provider.panelUsageTier === 'auto')
                delete provider.panelUsageTier;
            this._save();
        });
        return row;
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

        return options.length > 1 ? options : fallback;
    }

    _addTrackingRows(row, provider) {
        if (!this._apiKeyProviders().has(providerBaseId(provider)))
            return;

        if ((provider.source || 'auto') !== 'api') {
            const apiSourceRow = new Adw.ActionRow({
                title: _('Add API token source'),
                subtitle: _('Create a separate source for API usage tracking.'),
            });
            const apiSourceButton = new Gtk.Button({
                label: _('Add'),
                valign: Gtk.Align.CENTER,
            });
            apiSourceButton.connect('clicked', () => this._addApiProvider(provider));
            apiSourceRow.add_suffix(apiSourceButton);
            row.add_row(apiSourceRow);
        }

        if ((provider.source || 'auto') === 'api')
            return;

        const trackingRow = new Adw.ActionRow({
            title: _('Use API tracking here'),
            subtitle: _('Switch this provider to API source and show token fields.'),
        });
        const button = new Gtk.Button({
            label: _('Add'),
            valign: Gtk.Align.CENTER,
        });
        button.connect('clicked', () => {
            provider.source = 'api';
            this._save();
            this._renderProviders(providerKey(provider));
        });
        trackingRow.add_suffix(button);
        row.add_row(trackingRow);
    }

    _addApiProvider(provider) {
        const baseId = providerBaseId(provider);
        const copy = {
            id: baseId,
            instanceId: makeProviderInstanceId(baseId),
            enabled: true,
            source: 'api',
            cookieSource: 'auto',
            displayName: _('%s API').format(this._name(baseId)),
        };
        this._config.providers.push(copy);
        this._save();
        this._renderProviders(providerKey(copy));
    }

    _addSourceInstanceRows(row, provider) {
        const duplicateRow = new Adw.ActionRow({
            title: _('Add alternative source'),
            subtitle: _('Create another account/source as a separate draggable switcher tab.'),
        });
        const duplicateButton = new Gtk.Button({
            label: _('Add'),
            valign: Gtk.Align.CENTER,
        });
        duplicateButton.connect('clicked', () => this._duplicateProvider(provider));
        duplicateRow.add_suffix(duplicateButton);
        row.add_row(duplicateRow);

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

    _duplicateProvider(provider) {
        const baseId = providerBaseId(provider);
        const copy = {
            ...provider,
            id: baseId,
            instanceId: makeProviderInstanceId(baseId),
            enabled: true,
            displayName: _('%s Source').format(this._name(baseId)),
        };
        delete copy.cookieHeader;
        delete copy.apiKey;
        this._config.providers.push(copy);
        this._save();
        this._renderProviders(providerKey(copy));
    }

    _deleteProviderInstance(key) {
        this._config.providers = this._config.providers.filter(provider => providerKey(provider) !== key);
        this._save();
        this._renderProviders();
    }

    _addRelevantRows(row, provider) {
        const source = provider.source || 'auto';
        const baseId = providerBaseId(provider);

        if (this._isCustomProvider(provider)) {
            const commandRow = entryRow(_('CLI command'), provider.customCommand || '', _('Command that prints CodexBar-style usage JSON'));
            commandRow._entry.connect('changed', () => {
                this._assignOptional(provider, 'customCommand', commandRow._entry.get_text());
            });
            row.add_row(commandRow);

            const note = new Adw.ActionRow({
                title: _('Custom source'),
                subtitle: _('The command output should be a usage JSON object or an array containing one usage object.'),
            });
            row.add_row(note);
            return;
        }

        if (baseId === 'codex' && (source === 'auto' || source === 'web')) {
            this._addCodexAutoLoginRows(row, provider);
            return;
        }

        if (source === 'api' || this._apiKeyProviders().has(baseId)) {
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

        if (['zai', 'minimax', 'alibaba'].includes(baseId)) {
            const regionRow = entryRow(_('Region'), provider.region || '', _('Provider-specific region'));
            regionRow._entry.connect('changed', () => this._assignOptional(provider, 'region', regionRow._entry.get_text()));
            row.add_row(regionRow);
        }

        if (['opencode', 'opencodego'].includes(baseId)) {
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

        const [provider] = providers.splice(sourceIndex, 1);
        providers.splice(targetIndex, 0, provider);
        this._save();
        this._renderProviders(providerKey(provider));
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
            return _('Uses browser auto-login first, then CodexBar fallback behavior.');
        return _('auto mirrors CodexBar fallback behavior');
    }

    _apiKeyProviders() {
        return new Set(['codex', 'claude', 'gemini', 'copilot', 'zai', 'minimax', 'kimi', 'kimik2', 'kilo', 'warp', 'openrouter', 'synthetic', 'deepseek', 'codebuff', 'alibaba', 'mistral']);
    }

    _name(provider) {
        if (provider && typeof provider === 'object')
            return providerDisplayName(provider);
        return PROVIDERS.find(([providerId]) => providerId === provider)?.[1] || provider;
    }

    _isCustomProvider(provider) {
        return provider?.custom === true || Boolean(provider?.customCommand) || provider?.source === 'custom';
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
        const targetProviderId = settings.get_string('preferences-provider');
        const generalPage = new GeneralPage(settings);
        const providersPage = new ProvidersPage(settings);
        window.set_default_size(760, 760);
        window.add(generalPage);
        window.add(providersPage);
        window.add(new MaintenancePage());
        if (targetProviderId)
            window.set_visible_page(providersPage);
    }
}
