import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {loadConfig, makeProviderInstanceId, providerBaseId, providerDisplayName, providerKey, PROVIDERS, saveConfig} from './config.js';

const SOURCE_OPTIONS = ['auto', 'web', 'cli', 'oauth', 'api', 'local'];
const CUSTOM_PROVIDER_VALUE = '__custom_provider__';
const EXTENSION_DIR = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const TIERS = ['primary', 'secondary', 'tertiary', 'quaternary'];
const VALIDATION_TIMEOUT_SECONDS = 90;
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
            subtitle: _('Minutes between ai-usage CLI refreshes'),
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

        const resetOptions = [
            ['smart', _('Smart')],
            ['relative', _('Relative')],
            ['time', _('Time only')],
            ['weekday-time', _('Day and time')],
            ['date-time', _('Date and time')],
        ];
        const resetValues = resetOptions.map(([value]) => value);
        const resetLabels = resetOptions.map(([, label]) => label);
        const selectedReset = resetValues.includes(this._settings.get_string('reset-time-format'))
            ? this._settings.get_string('reset-time-format')
            : 'smart';
        const resetRow = combo(resetLabels, resetLabels[resetValues.indexOf(selectedReset)]);
        resetRow.title = _('Reset display');
        resetRow.subtitle = _('Smart includes weekday for weekly resets.');
        resetRow.connect('notify::selected', () => {
            this._settings.set_string('reset-time-format', resetValues[resetRow.selected] || 'smart');
        });
        group.add(resetRow);

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
        this._validationCache = new Map();
        this._validationInFlight = new Map();
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
            provider = {id, enabled: false, source: 'auto'};
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

        const commandRow = entryRow(_('CLI command'), '', _('Command that prints ai-usage-style usage JSON'));
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
            const source = SOURCE_OPTIONS[sourceRow.selected] || 'auto';
            if (this._addProviderSource(selected, nameRow._entry.get_text(), commandRow._entry.get_text(), source)) {
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
            sourceRow.set_sensitive(!isCustom);
            commandRow.subtitle = isCustom
                ? _('Required. The command must print a single JSON object or an array with one usage object.')
                : _('Only used for custom CLI sources.');
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
        saveConfig(this._config);
    }

    _renderProviders(expandedId = null) {
        while (this._enabledList.get_first_child())
            this._enabledList.remove(this._enabledList.get_first_child());
        while (this._disabledList.get_first_child())
            this._disabledList.remove(this._disabledList.get_first_child());

        for (const provider of this._orderedProviders()) {
            if (provider.tabParent)
                continue;
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
        row.add_suffix(this._sourceStatusDot(provider));
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

        this._addRelevantRows(row, provider);

        const tierRow = this._usageTierRow(provider);
        row.add_row(tierRow);
        row.add_row(this._usageTrackersRow(provider));

        this._addTabExtensionRows(row, provider);
        this._addDeleteSourceRow(row, provider);

        listRow.set_child(row);
        if (draggable)
            this._setupDragAndDrop(listRow);
        return listRow;
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
        row.add_suffix(this._sourceStatusDot(provider));

        const nameRow = entryRow(_('Name'), provider.displayName || '', this._name(providerBaseId(provider)));
        nameRow._entry.connect('changed', () => {
            this._assignOptional(provider, 'displayName', nameRow._entry.get_text());
            row.set_title(this._name(provider));
        });
        row.add_row(nameRow);

        if (!this._isCustomProvider(provider)) {
            const sourceRow = combo(SOURCE_OPTIONS, provider.source || 'auto');
            sourceRow.title = _('Source');
            sourceRow.connect('notify::selected', () => {
                provider.source = SOURCE_OPTIONS[sourceRow.selected] || 'auto';
                row.set_subtitle(this._subtitle(provider));
                this._save();
                this._renderProviders(parentKey);
            });
            row.add_row(sourceRow);
        }

        this._addRelevantRows(row, provider);

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

    _sourceStatusDot(provider) {
        const label = new Gtk.Label({
            use_markup: true,
            valign: Gtk.Align.CENTER,
        });

        if (provider.enabled === false) {
            this._setStatusDot(label, 'orange', _('Disabled'));
            return label;
        }

        const cacheKey = this._validationCacheKey(provider);
        const cached = this._validationCache.get(cacheKey);
        if (cached) {
            this._setStatusDot(label, cached.state, cached.message);
            return label;
        }

        this._setStatusDot(label, 'orange', _('Checking source...'));
        this._validateProvider(provider, label);
        return label;
    }

    _setStatusDot(label, state, tooltip) {
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

        const argv = ['ai-usage', '--json-only', 'usage', '--provider', providerBaseId(provider)];
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

    _addRelevantRows(row, provider) {
        const source = provider.source || 'auto';
        const baseId = providerBaseId(provider);

        if (this._isCustomProvider(provider)) {
            const commandRow = entryRow(_('CLI command'), provider.customCommand || '', _('Command that prints ai-usage-style usage JSON'));
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

        if (source === 'api') {
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
            });
            row.add_row(cookieHeaderRow);

            const importRow = new Adw.ActionRow({
                title: _('Auto cookie scraping'),
                subtitle: _('Import browser cookies for ChatGPT/OpenAI sessions.'),
            });
            const importButton = new Gtk.Button({
                label: _('Import'),
                valign: Gtk.Align.CENTER,
                css_classes: ['suggested-action'],
            });
            importButton.connect('clicked', () => this._importCookies(provider, cookieHeaderRow._entry));
            importRow.add_suffix(importButton);
            row.add_row(importRow);
        }

        if (source === 'cli') {
            this._addSettingEntry(row, provider, 'profile', _('CLI profile'), _('Optional provider CLI profile'));
            this._addSettingEntry(row, provider, 'path', _('CLI path'), _('Optional config, database, or executable path'));
        }

        if (source === 'oauth') {
            this._addSettingEntry(row, provider, 'account', _('OAuth account'), _('Optional account label'));
            this._addSettingEntry(row, provider, 'tokenPath', _('Token path'), _('Optional OAuth token file'));
        }

        if (source === 'local') {
            this._addSettingEntry(row, provider, 'path', _('Local path'), _('Optional local database, cache, or log path'));
            this._addSettingEntry(row, provider, 'project', _('Project'), _('Optional project or workspace label'));
        }

        if (['zai', 'minimax', 'doubao'].includes(baseId)) {
            const regionRow = entryRow(_('Region'), provider.region || '', _('Provider-specific region'));
            regionRow._entry.connect('changed', () => this._assignOptional(provider, 'region', regionRow._entry.get_text()));
            row.add_row(regionRow);
        }

        if (['opencode-go', 'openai-api'].includes(baseId)) {
            const workspaceRow = entryRow(_('Workspace ID'), provider.workspaceId || '', _('Provider-specific workspace'));
            workspaceRow._entry.connect('changed', () => this._assignOptional(provider, 'workspaceId', workspaceRow._entry.get_text()));
            row.add_row(workspaceRow);
        }
    }

    _addSettingEntry(row, provider, key, title, placeholder) {
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
        });
        row.add_row(settingRow);
    }

    async _importCookies(provider, entry) {
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
                entry.set_text(payload.cookie_header);
                this._save();
            } else {
                throw new Error(payload.details || payload.message || payload.error || _('No browser cookies found.'));
            }
        } catch (error) {
            this._showError(_('Could not import cookies'), error.message || String(error));
        }
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
            return _('Uses ai-usage provider defaults.');
        if (source === 'auto')
            return _('Uses ai-usage provider defaults.');
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
        return _('Uses ai-usage %s source.').format(source);
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

        const options = [
            ['auto', _('Auto')],
            ['kgx', _('GNOME Console')],
            ['gnome-terminal', _('GNOME Terminal')],
            ['x-terminal-emulator', _('System default terminal')],
            ['konsole', _('Konsole')],
            ['xfce4-terminal', _('Xfce Terminal')],
            ['alacritty', _('Alacritty')],
            ['kitty', _('Kitty')],
        ];
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

        return group;
    }

    _buildGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('ai-usage CLI'),
        });

        for (const [title, command] of [
            [_('Validate config'), 'ai-usage config validate'],
            [_('Dump normalized config'), 'ai-usage config dump'],
            [_('List providers'), 'ai-usage list --all --plain'],
            [_('Show enabled usage'), 'ai-usage usage'],
            [_('Show all usage JSON'), 'ai-usage --json usage --provider all'],
            [_('Provider status'), 'ai-usage status --provider all --plain'],
            [_('Cost summary'), 'ai-usage cost --provider all'],
            [_('Export live usage JSON'), 'ai-usage export --provider all --format json'],
            [_('Export live usage CSV'), 'ai-usage export --provider all --format csv'],
            [_('Clear snapshots cache'), 'ai-usage cache clear --snapshots'],
            [_('ai-usage help'), 'ai-usage --help'],
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
            title: _('ai-usage docs'),
            subtitle: _('Provider setup and config schema'),
        });
        const docsButton = new Gtk.Button({
            icon_name: 'help-browser-symbolic',
            valign: Gtk.Align.CENTER,
        });
        docsButton.connect('clicked', () => {
            Gio.app_info_launch_default_for_uri('https://github.com/hashim-k/ai-usage-backend', null);
        });
        docsRow.add_suffix(docsButton);
        group.add(docsRow);

        return group;
    }

    _runInTerminal(command) {
        const script = [
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
                logError(error, `AI Usage Bar: failed to launch ${argv[0]}`);
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
        const byId = {
            kgx: ['kgx', '--', 'bash', '-lc', script],
            'gnome-terminal': ['gnome-terminal', '--', 'bash', '-lc', script],
            'x-terminal-emulator': ['x-terminal-emulator', '-e', 'bash', '-lc', script],
            konsole: ['konsole', '-e', 'bash', '-lc', script],
            'xfce4-terminal': ['xfce4-terminal', '-e', `bash -lc ${this._shellQuote(script)}`],
            alacritty: ['alacritty', '-e', 'bash', '-lc', script],
            kitty: ['kitty', 'bash', '-lc', script],
        };
        const preferred = this._settings.get_string('tools-terminal');
        const order = ['kgx', 'gnome-terminal', 'x-terminal-emulator', 'konsole', 'xfce4-terminal', 'alacritty', 'kitty'];
        if (preferred !== 'auto' && byId[preferred])
            return [byId[preferred], ...order.filter(id => id !== preferred).map(id => byId[id])];
        return order.map(id => byId[id]);
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
        const generalPage = new GeneralPage(settings);
        const providersPage = new ProvidersPage(settings);
        window.set_default_size(760, 760);
        window.add(generalPage);
        window.add(providersPage);
        window.add(new MaintenancePage(settings));
        if (targetProviderId)
            window.set_visible_page(providersPage);
    }
}
