import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {fetchProviderUsage, findAiUsage} from './cli.js';
import {enabledProviders, loadConfig, PROVIDER_NAMES, providerBaseId, providerDisplayName, providerKey} from './config.js';

const TIERS = ['primary', 'secondary', 'tertiary', 'quaternary'];
const PANEL_COMPONENTS = ['bar', 'percent', 'logo', 'text'];
const DEFAULT_THRESHOLDS = [
    {id: 'warning', label: 'Warning', percent: 75, color: '#f6d32d', notify: false},
    {id: 'danger', label: 'Danger', percent: 90, color: '#ff5f57', notify: false},
    {id: 'limit', label: 'Limit reached', percent: 100, color: '#ff2d55', notify: false},
];
const EXTENSION_DIR = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const PROVIDER_ICON_FILES = {
    codex: 'codex.svg',
    claude: 'claude.svg',
    cursor: 'cursor.svg',
    factory: 'factory.svg',
    gemini: 'gemini.svg',
    copilot: 'copilot.svg',
};

export default class AIUsageBarExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._signals = [];
        this._usage = new Map();
        this._errors = new Map();
        this._thresholdStates = new Map();
        this._activeId = null;
        this._loading = false;
        this._lastRefreshAt = null;
        this._cancellable = new Gio.Cancellable();

        this._indicator = new PanelMenu.Button(0.0, _('AI Usage Bar'), false);
        this._indicator.add_style_class_name('ai-usage-panel-button');

        this._panelBox = new St.BoxLayout({
            style_class: 'ai-usage-panel',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._meter = new St.BoxLayout({style_class: 'ai-usage-panel-meter'});
        this._meterFill = new St.Widget({style_class: 'ai-usage-panel-meter-fill'});
        this._meter.add_child(this._meterFill);
        this._panelPercent = new St.Label({
            text: _('0%'),
            style_class: 'ai-usage-panel-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._panelLabel = new St.Label({
            text: _('AI'),
            style_class: 'ai-usage-panel-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._panelBox.add_child(this._meter);
        this._panelBox.add_child(this._panelLabel);
        this._indicator.add_child(this._panelBox);

        this._buildMenu();
        this._attachIndicator(true);

        for (const key of [
            'refresh-interval',
            'display-mode',
            'panel-components',
            'panel-position',
            'panel-index',
            'usage-thresholds',
            'provider-usage-windows',
            'provider-usage-settings',
            'reset-time-format',
            'warning-threshold',
            'danger-threshold',
            'limit-threshold',
            'accent-color',
            'warning-color',
            'danger-color',
            'limit-color',
            'neutral-color',
        ]) {
            this._signals.push(this._settings.connect(`changed::${key}`, () => this._onSettingsChanged(key)));
        }

        this._loadProviders();
        this._setupRefresh();
        this._refresh();
    }

    disable() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._settings) {
            for (const id of this._signals)
                this._settings.disconnect(id);
            this._signals = [];
            this._settings = null;
        }
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._usage = null;
        this._errors = null;
        this._thresholdStates = null;
    }

    _attachIndicator(initial = false) {
        if (!this._indicator)
            return;

        const position = this._settings.get_string('panel-position');
        const index = this._settings.get_int('panel-index');
        if (initial) {
            Main.panel.addToStatusArea(this.uuid, this._indicator, index, position);
            return;
        }

        const box = {
            left: Main.panel._leftBox,
            center: Main.panel._centerBox,
            right: Main.panel._rightBox,
        }[position] || Main.panel._rightBox;
        const actor = this._indicator.container;
        actor.get_parent()?.remove_child(actor);
        box.insert_child_at_index(actor, index);
    }

    _buildMenu() {
        this._indicator.menu.box.add_style_class_name('ai-usage-menu');

        this._header = new St.BoxLayout({style_class: 'ai-usage-header'});
        this._title = new St.Label({
            text: _('AI Usage Bar'),
            style_class: 'ai-usage-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._header.add_child(this._title);
        this._header.add_child(this._iconButton('view-refresh-symbolic', () => this._refresh(true)));
        this._header.add_child(this._iconButton('document-edit-symbolic', () => this._openProviderPreferences()));
        this._header.add_child(this._iconButton('preferences-system-symbolic', () => {
            this.openPreferences();
            this._indicator.menu.close();
        }));
        this._indicator.menu.box.add_child(this._header);

        this._switcher = new St.BoxLayout({style_class: 'ai-usage-provider-switcher'});
        this._indicator.menu.box.add_child(this._switcher);

        this._content = new St.BoxLayout({
            vertical: true,
            style_class: 'ai-usage-content',
        });
        this._indicator.menu.box.add_child(this._content);
    }

    _iconButton(iconName, callback) {
        const button = new St.Button({
            child: new St.Icon({icon_name: iconName, icon_size: 16}),
            style_class: 'ai-usage-icon-button',
            can_focus: true,
        });
        button.connect('clicked', callback);
        return button;
    }

    _onSettingsChanged(key) {
        if (key === 'panel-position' || key === 'panel-index')
            this._attachIndicator();
        if (key === 'refresh-interval')
            this._setupRefresh();
        this._render();
    }

    _loadProviders() {
        this._config = loadConfig();
        this._providers = enabledProviders(this._config);
        this._visibleProviders = this._providers.filter(provider => !provider.tabParent);
        if (!this._providers.length)
            this._providers = [];
        if (!this._visibleProviders.length)
            this._visibleProviders = [];
        if (!this._activeId || !this._visibleProviders.some(provider => providerKey(provider) === this._activeId))
            this._activeId = this._visibleProviders[0] ? providerKey(this._visibleProviders[0]) : null;
    }

    _setupRefresh() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        const minutes = this._settings.get_int('refresh-interval');
        if (minutes > 0) {
            this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, minutes * 60, () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    async _refresh(forceReload = false) {
        if (this._loading)
            return;

        if (forceReload)
            this._loadProviders();

        this._loading = true;
        this._title.set_text(_('Refreshing...'));
        this._render();

        try {
            for (const provider of this._providers) {
                if (!this._cancellable || this._cancellable.is_cancelled())
                    break;
                try {
                    const data = await fetchProviderUsage(provider, this._cancellable);
                    const key = providerKey(provider);
                    this._usage.set(key, data);
                    this._errors.delete(key);
                    this._rememberUsageWindows(key, data);
                    this._maybeNotifyThreshold(key, data);
                    this._render();
                } catch (error) {
                    if (!this._cancellable || this._cancellable.is_cancelled())
                        break;
                    this._errors.set(providerKey(provider), error.message || String(error));
                    this._render();
                }
            }
        } finally {
            this._loading = false;
            this._lastRefreshAt = new Date();
            if (this._title)
                this._title.set_text(_('AI Usage Bar'));
            this._render();
        }
    }

    _render() {
        if (!this._indicator)
            return;

        this._loadProviders();
        this._switcher.destroy_all_children();
        this._content.destroy_all_children();

        const active = this._activeSnapshot();
        this._renderPanel(active);

        if (!this._visibleProviders.length) {
            this._renderMessage(
                _('No providers enabled'),
                _('Enable providers in preferences or edit ~/.config/ai-usage/config.toml.'),
            );
            return;
        }

        for (const provider of this._visibleProviders)
            this._addProviderSwitch(provider);

        if (!findAiUsage() && this._providerNeedsCli(this._activeProviderConfig())) {
            this._renderMessage(
                _('ai-usage CLI not found'),
                _('Install ai-usage, add it to PATH, or set AI_USAGE_CLI before GNOME Shell starts.'),
            );
            return;
        }

        this._renderProvider(this._activeId);
    }

    _addProviderSwitch(provider) {
        const id = providerKey(provider);
        const baseId = providerBaseId(provider);
        const active = id === this._activeId;
        const snapshot = this._usage.get(id);
        const percent = this._snapshotUsedPercent(snapshot);
        const color = this._colorForUsedPercent(percent);

        const box = new St.BoxLayout({
            vertical: true,
            style_class: 'ai-usage-provider-tile-box',
            x_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._providerIcon(baseId, 22));
        box.add_child(new St.Label({
            text: this._providerName(provider),
            style_class: 'ai-usage-provider-tile-label',
            x_align: Clutter.ActorAlign.CENTER,
        }));

        const track = new St.BoxLayout({style_class: 'ai-usage-provider-mini-track'});
        const waiting = this._loading && !snapshot && !this._errors.has(id);
        const fill = new St.Widget({
            style_class: waiting ? 'ai-usage-provider-mini-fill loading' : 'ai-usage-provider-mini-fill',
            style: `background-color: ${this._errors.has(id) ? this._settings.get_string('danger-color') : color};`,
        });
        fill.set_width(waiting ? 18 : this._barFillWidth(this._errors.has(id) ? 100 : percent, 68));
        track.add_child(fill);
        box.add_child(track);

        const button = new St.Button({
            child: box,
            style_class: active ? 'ai-usage-provider-tile active' : 'ai-usage-provider-tile',
            can_focus: true,
        });
        button.connect('clicked', () => {
            this._activeId = providerKey(provider);
            this._render();
        });
        this._switcher.add_child(button);
    }

    _activeSnapshot() {
        return this._activeId ? this._usage.get(this._activeId) : null;
    }

    _renderPanel(snapshot) {
        const shownPercent = this._snapshotPercent(snapshot);
        const usedPercent = this._snapshotUsedPercent(snapshot);
        const color = this._colorForUsedPercent(usedPercent);
        const components = this._panelComponents();

        let child;
        while ((child = this._panelBox.get_first_child()))
            this._panelBox.remove_child(child);

        this._panelLabel.set_text(this._panelName());
        this._panelPercent.set_text(`${Math.round(shownPercent)}%`);
        this._meter.set_style(`border-color: ${this._settings.get_string('neutral-color')};`);
        this._meterFill.set_width(Math.round(shownPercent * 0.18));
        this._meterFill.set_style(`background-color: ${color};`);
        this._panelLabel.set_style(`color: ${this._settings.get_string('neutral-color')};`);
        this._panelPercent.set_style(`color: ${this._settings.get_string('neutral-color')};`);

        const icon = this._providerIcon(providerBaseId(this._activeProviderConfig()) || this._activeId, 16);
        icon.add_style_class_name('ai-usage-panel-icon');

        for (const component of components) {
            if (component === 'bar')
                this._panelBox.add_child(this._meter);
            else if (component === 'percent')
                this._panelBox.add_child(this._panelPercent);
            else if (component === 'logo')
                this._panelBox.add_child(icon);
            else if (component === 'text')
                this._panelBox.add_child(this._panelLabel);
        }
    }

    _panelName() {
        if (this._activeId)
            return this._providerName(this._activeProviderConfig() || this._activeId);
        return this._visibleProviders.length > 1 ? _('AI') : this._providerName(this._visibleProviders[0]?.id);
    }

    _renderProvider(providerId) {
        const snapshot = this._usage.get(providerId);
        const error = this._errors.get(providerId);
        if (error) {
            this._renderMessage(this._providerName(this._providerForKey(providerId) || providerId), error, true);
            return;
        }
        if (!snapshot) {
            if (this._loading)
                this._renderLoadingProvider(providerId);
            else
                this._renderMessage(this._providerName(this._providerForKey(providerId) || providerId), _('No usage fetched yet.'));
            return;
        }

        const usage = snapshot.usage || {};
        this._renderProviderHeader(snapshot, providerId);

        for (const tier of TIERS) {
            const window = usage[tier];
            if (window && window.usedPercent !== undefined && this._usageWindowVisible(providerId, tier))
                this._renderUsageWindow(this._windowLabel(tier, window), window);
        }

        for (const namedWindow of usage.extraRateWindows || []) {
            const id = namedWindow.id || namedWindow.title || 'extra';
            if (namedWindow?.window?.usedPercent !== undefined && this._usageWindowVisible(providerId, id))
                this._renderUsageWindow(namedWindow.title || this._windowLabel(id, namedWindow.window), namedWindow.window);
        }

        if (usage.providerCost && this._usageWindowVisible(providerId, 'extraUsage'))
            this._renderProviderCost(usage.providerCost);

        this._renderMetricLines(providerId, usage);

        if (snapshot.credits?.remaining !== undefined)
            this._renderCreditLine(_('Credits: %s left').format(String(snapshot.credits.remaining)));

        if (snapshot.openaiDashboard?.codeReviewRemainingPercent !== undefined)
            this._renderCreditLine(_('Code review: %s%% left').format(Math.round(snapshot.openaiDashboard.codeReviewRemainingPercent)));

        for (const child of this._childProviders(providerId))
            this._renderChildProvider(child);
    }

    _renderChildProvider(provider) {
        const key = providerKey(provider);
        const snapshot = this._usage.get(key);
        const error = this._errors.get(key);

        this._content.add_child(new St.Widget({style_class: 'ai-usage-separator'}));
        this._content.add_child(new St.Label({
            text: this._providerName(provider),
            style_class: 'ai-usage-provider-heading',
        }));

        if (error) {
            this._content.add_child(new St.Label({
                text: error,
                style_class: 'ai-usage-message-body',
            }));
            return;
        }

        if (!snapshot) {
            this._content.add_child(new St.Label({
                text: this._loading ? _('Fetching usage...') : _('No usage fetched yet.'),
                style_class: 'ai-usage-muted',
            }));
            return;
        }

        const usage = snapshot.usage || {};
        for (const tier of TIERS) {
            const window = usage[tier];
            if (window && window.usedPercent !== undefined && this._usageWindowVisible(key, tier))
                this._renderUsageWindow(this._windowLabel(tier, window), window);
        }
        for (const namedWindow of usage.extraRateWindows || []) {
            const id = namedWindow.id || namedWindow.title || 'extra';
            if (namedWindow?.window?.usedPercent !== undefined && this._usageWindowVisible(key, id))
                this._renderUsageWindow(namedWindow.title || this._windowLabel(id, namedWindow.window), namedWindow.window);
        }
        if (usage.providerCost && this._usageWindowVisible(key, 'extraUsage'))
            this._renderProviderCost(usage.providerCost);
        this._renderMetricLines(key, usage);
    }

    _renderLoadingProvider(providerId) {
        this._content.add_child(new St.Label({
            text: this._providerName(this._providerForKey(providerId) || providerId),
            style_class: 'ai-usage-provider-heading',
        }));

        const meta = new St.BoxLayout({style_class: 'ai-usage-provider-meta'});
        meta.add_child(new St.Label({
            text: _('Fetching usage...'),
            style_class: 'ai-usage-muted',
            x_expand: true,
        }));
        meta.add_child(new St.Icon({
            icon_name: 'process-working-symbolic',
            icon_size: 14,
            style_class: 'ai-usage-loading-icon',
        }));
        this._content.add_child(meta);
        this._content.add_child(new St.Widget({style_class: 'ai-usage-separator'}));

        for (const title of [_('Session'), _('Weekly'), _('Extra usage')])
            this._renderLoadingWindow(title);
    }

    _renderLoadingWindow(title) {
        const row = new St.BoxLayout({vertical: true, style_class: 'ai-usage-window'});
        row.add_child(new St.Label({text: title, style_class: 'ai-usage-window-title'}));

        const track = new St.BoxLayout({style_class: 'ai-usage-track loading'});
        const fill = new St.Widget({style_class: 'ai-usage-track-fill loading'});
        fill.set_width(54);
        track.add_child(fill);
        row.add_child(track);

        row.add_child(new St.Label({
            text: _('Loading...'),
            style_class: 'ai-usage-muted',
        }));
        this._content.add_child(row);
    }

    _renderProviderHeader(snapshot, providerId) {
        const usage = snapshot.usage || {};
        this._content.add_child(new St.Label({
            text: this._providerHeading(snapshot, providerId),
            style_class: 'ai-usage-provider-heading',
        }));

        const meta = new St.BoxLayout({style_class: 'ai-usage-provider-meta'});
        meta.add_child(new St.Label({
            text: this._providerUpdatedText(usage.updatedAt),
            style_class: 'ai-usage-muted',
            x_expand: true,
        }));
        this._content.add_child(meta);

        const detail = [
            usage.accountEmail,
            usage.accountOrganization,
            usage.loginMethod,
            snapshot.source,
            snapshot.status?.description,
        ].filter(Boolean).join('  |  ');
        if (detail)
            this._content.add_child(new St.Label({text: detail, style_class: 'ai-usage-detail'}));

        this._content.add_child(new St.Widget({style_class: 'ai-usage-separator'}));
    }

    _renderUsageWindow(title, window) {
        const percent = this._displayPercent(window);
        const color = this._colorForPercent(percent);
        const row = new St.BoxLayout({vertical: true, style_class: 'ai-usage-window'});
        row.add_child(new St.Label({text: title, style_class: 'ai-usage-window-title'}));

        const track = new St.BoxLayout({style_class: 'ai-usage-track'});
        const fill = new St.Widget({
            style_class: 'ai-usage-track-fill',
            style: `background-color: ${color};`,
        });
        fill.set_width(this._barFillWidth(percent, 390));
        track.add_child(fill);
        row.add_child(track);

        const footer = new St.BoxLayout();
        footer.add_child(new St.Label({
            text: this._formatPercent(percent),
            style_class: 'ai-usage-window-percent',
            x_expand: true,
        }));
        footer.add_child(new St.Label({
            text: this._resetText(window),
            style_class: 'ai-usage-muted',
        }));
        row.add_child(footer);
        this._content.add_child(row);
    }

    _renderProviderCost(cost) {
        if (!cost || !(Number(cost.limit) > 0))
            return;

        const used = Number(cost.used) || 0;
        const limit = Number(cost.limit) || 0;
        const usedPercent = Math.max(0, Math.min(100, (used / limit) * 100));
        const window = {
            usedPercent,
            resetsAt: cost.resetsAt,
            resetDescription: cost.period || null,
        };
        const title = cost.currencyCode === 'Quota' ? _('Quota usage') : _('Extra usage');
        const percent = this._displayPercent(window);
        const color = this._colorForPercent(percent);

        const row = new St.BoxLayout({vertical: true, style_class: 'ai-usage-window'});
        row.add_child(new St.Label({text: title, style_class: 'ai-usage-window-title'}));

        const track = new St.BoxLayout({style_class: 'ai-usage-track'});
        const fill = new St.Widget({
            style_class: 'ai-usage-track-fill',
            style: `background-color: ${color};`,
        });
        fill.set_width(this._barFillWidth(percent, 390));
        track.add_child(fill);
        row.add_child(track);

        const footer = new St.BoxLayout();
        footer.add_child(new St.Label({
            text: this._providerCostText(cost),
            style_class: 'ai-usage-window-percent',
            x_expand: true,
        }));
        footer.add_child(new St.Label({
            text: _('%s%% used').format(Math.round(usedPercent)),
            style_class: 'ai-usage-muted',
        }));
        row.add_child(footer);
        this._content.add_child(row);
    }

    _renderCreditLine(text) {
        this._content.add_child(new St.Label({
            text,
            style_class: 'ai-usage-credits',
        }));
    }

    _renderMetricLines(providerId, usage) {
        for (const badge of usage.badges || []) {
            const id = this._metricLineId('badge', badge.label || badge.text);
            if (!this._usageWindowVisible(providerId, id))
                continue;
            const text = [badge.label, badge.text].filter(Boolean).join(': ');
            if (text)
                this._renderCreditLine(text);
        }

        for (const line of usage.extraTextLines || []) {
            const id = this._metricLineId('text', line.label || line.value);
            if (!this._usageWindowVisible(providerId, id))
                continue;
            const text = [line.label, line.value].filter(Boolean).join(': ');
            if (text)
                this._renderCreditLine(text);
        }
    }

    _providerCostText(cost) {
        const period = cost.period || _('This month');
        if (cost.currencyCode === 'Quota')
            return _('%s: %s / %s').format(period, Math.round(Number(cost.used) || 0), Math.round(Number(cost.limit) || 0));

        return _('%s: %s / %s').format(
            period,
            this._formatMoney(Number(cost.used) || 0, cost.currencyCode),
            this._formatMoney(Number(cost.limit) || 0, cost.currencyCode),
        );
    }

    _formatMoney(value, currencyCode) {
        const code = currencyCode || 'USD';
        try {
            return new Intl.NumberFormat(undefined, {
                style: 'currency',
                currency: code,
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            }).format(value);
        } catch {
            return `${code} ${value.toFixed(2)}`;
        }
    }

    _renderMessage(title, body, isError = false) {
        this._content.add_child(new St.Label({
            text: title,
            style_class: isError ? 'ai-usage-message-title danger' : 'ai-usage-message-title',
        }));
        this._content.add_child(new St.Label({
            text: body,
            style_class: 'ai-usage-message-body',
        }));
    }

    _snapshotPercent(snapshot) {
        const window = this._selectedPanelWindow(snapshot);
        if (!window)
            return 0;
        return this._displayPercent(window);
    }

    _snapshotUsedPercent(snapshot) {
        const window = this._selectedPanelWindow(snapshot);
        if (!window)
            return 0;
        return Math.max(0, Math.min(100, Number(window.usedPercent) || 0));
    }

    _selectedPanelWindow(snapshot) {
        const usage = snapshot?.usage;
        if (!usage)
            return null;

        const providerId = providerKey(this._activeProviderConfig() || this._activeId);
        const tier = this._panelUsageTier(providerId);
        if (tier !== 'auto' && !this._usageWindowVisible(providerId, tier))
            return this._automaticPanelWindow(usage, providerId);
        if (tier === 'extraUsage')
            return this._providerCostWindow(usage.providerCost) || usage.primary || usage.secondary || null;
        const extra = (usage.extraRateWindows || []).find(item => (item.id || item.title) === tier);
        if (extra?.window?.usedPercent !== undefined)
            return extra.window;
        if (TIERS.includes(tier) && usage[tier]?.usedPercent !== undefined)
            return usage[tier];
        return this._automaticPanelWindow(usage, providerId);
    }

    _automaticPanelWindow(usage, providerId) {
        if (usage.primary?.usedPercent >= 100 && this._usageWindowVisible(providerId, 'extraUsage')) {
            const costWindow = this._providerCostWindow(usage.providerCost);
            if (costWindow)
                return costWindow;
        }

        const values = TIERS
            .map(tier => usage[tier])
            .filter((window, index) => window && window.usedPercent !== undefined && this._usageWindowVisible(providerId, TIERS[index]))
            .map(window => ({
                ...window,
                usedPercent: Math.max(0, Math.min(100, Number(window.usedPercent) || 0)),
            }));
        if (!values.length)
            return null;
        const usedPercent = values.reduce((sum, window) => sum + window.usedPercent, 0) / values.length;
        return {usedPercent, windowMinutes: null, resetsAt: null, resetDescription: null};
    }

    _providerCostWindow(cost) {
        if (!cost || !(Number(cost.limit) > 0))
            return null;
        return {
            usedPercent: Math.max(0, Math.min(100, (Number(cost.used) || 0) / Number(cost.limit) * 100)),
            windowMinutes: null,
            resetsAt: cost.resetsAt,
            resetDescription: cost.period || null,
        };
    }

    _displayPercent(window) {
        const used = Math.max(0, Math.min(100, Number(window.usedPercent) || 0));
        return this._settings.get_string('display-mode') === 'used' ? used : 100 - used;
    }

    _formatPercent(percent) {
        const suffix = this._settings.get_string('display-mode') === 'used' ? _('used') : _('left');
        return `${Math.round(percent)}% ${suffix}`;
    }

    _colorForPercent(percent) {
        const used = this._settings.get_string('display-mode') === 'used' ? percent : 100 - percent;
        return this._colorForUsedPercent(used);
    }

    _colorForUsedPercent(percent) {
        return this._thresholdForUsedPercent(percent)?.color || this._settings.get_string('accent-color');
    }

    _thresholdForUsedPercent(percent) {
        const used = Math.max(0, Math.min(100, Number(percent) || 0));
        let current = null;
        for (const threshold of this._thresholds()) {
            if (used >= threshold.percent)
                current = threshold;
        }
        return current;
    }

    _maybeNotifyThreshold(providerId, snapshot) {
        const percent = this._snapshotUsedPercent(snapshot);
        const threshold = this._thresholdForUsedPercent(percent);
        const state = threshold?.id || 'normal';
        if (!this._thresholdStates.has(providerId)) {
            this._thresholdStates.set(providerId, state);
            return;
        }

        const previous = this._thresholdStates.get(providerId) || 'normal';
        this._thresholdStates.set(providerId, state);

        if (state === previous || state === 'normal')
            return;

        const rank = this._thresholdRankMap();
        if ((rank.get(state) || 0) <= (rank.get(previous) || 0))
            return;
        if (!threshold?.notify)
            return;

        Main.notify(
            _('AI usage threshold crossed'),
            _('%s is now %s%% used (%s)').format(this._providerName(this._providerForKey(providerId) || providerId), Math.round(percent), threshold.label),
        );
    }

    _barFillWidth(percent, width) {
        const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
        if (clamped <= 0)
            return 0;
        return Math.max(5, Math.round(width * clamped / 100));
    }

    _windowLabel(tier, window) {
        if (window.label)
            return window.label;
        const minutes = window.windowMinutes || (window.windowSeconds ? window.windowSeconds / 60 : 0);
        if (minutes >= 10080)
            return _('Weekly');
        if (minutes >= 1440)
            return _('%sd').format(Math.round(minutes / 1440));
        if (minutes >= 60)
            return _('%sh').format(Math.round(minutes / 60));
        return tier.charAt(0).toUpperCase() + tier.slice(1);
    }

    _rememberUsageWindows(providerId, snapshot) {
        const usage = snapshot?.usage;
        if (!usage)
            return;

        const windows = {};
        for (const tier of TIERS) {
            const window = usage[tier];
            if (window && window.usedPercent !== undefined)
                windows[tier] = this._windowLabel(tier, window);
        }
        for (const namedWindow of usage.extraRateWindows || []) {
            const id = namedWindow.id || namedWindow.title;
            if (id && namedWindow?.window?.usedPercent !== undefined)
                windows[id] = namedWindow.title || this._windowLabel(id, namedWindow.window);
        }
        if (usage.providerCost && Number(usage.providerCost.limit) > 0)
            windows.extraUsage = usage.providerCost.currencyCode === 'Quota' ? _('Quota usage') : _('Extra usage');
        for (const line of usage.extraTextLines || []) {
            const id = this._metricLineId('text', line.label || line.value);
            if (id)
                windows[id] = line.label || line.value;
        }
        for (const badge of usage.badges || []) {
            const id = this._metricLineId('badge', badge.label || badge.text);
            if (id)
                windows[id] = badge.label || badge.text;
        }

        if (!Object.keys(windows).length)
            return;

        let allWindows = {};
        try {
            allWindows = JSON.parse(this._settings.get_string('provider-usage-windows'));
        } catch {
            allWindows = {};
        }

        const next = {...allWindows, [providerId]: windows};
        const current = JSON.stringify(allWindows[providerId] || {});
        const incoming = JSON.stringify(windows);
        if (current !== incoming)
            this._settings.set_string('provider-usage-windows', JSON.stringify(next));
    }

    _resetText(window) {
        if (window.resetDescription)
            return window.resetDescription;
        if (window.resetsAt) {
            const date = new Date(window.resetsAt);
            if (!Number.isNaN(date.getTime()))
                return _('Resets %s').format(this._formatResetDate(date, window));
        }
        return '';
    }

    _formatResetDate(date, window = null) {
        const mode = this._settings.get_string('reset-time-format');
        const now = new Date();
        const diffSeconds = Math.max(0, Math.round((date.getTime() - now.getTime()) / 1000));

        if (mode === 'relative')
            return this._relativeResetText(diffSeconds);
        if (mode === 'time')
            return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
        if (mode === 'weekday-time')
            return date.toLocaleDateString([], {weekday: 'short', hour: '2-digit', minute: '2-digit'});
        if (mode === 'date-time')
            return date.toLocaleDateString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});

        const windowMinutes = Number(window?.windowMinutes || 0);
        if (windowMinutes >= 7 * 24 * 60)
            return date.toLocaleDateString([], {weekday: 'short', hour: '2-digit', minute: '2-digit'});
        if (diffSeconds < 24 * 60 * 60 && date.toDateString() === now.toDateString())
            return this._relativeResetText(diffSeconds);
        if (diffSeconds < 7 * 24 * 60 * 60)
            return date.toLocaleDateString([], {weekday: 'short', hour: '2-digit', minute: '2-digit'});
        return date.toLocaleDateString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
    }

    _relativeResetText(seconds) {
        if (seconds < 60)
            return _('%ss').format(seconds);
        if (seconds < 3600)
            return _('%sm').format(Math.round(seconds / 60));
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.round((seconds % 3600) / 60);
        if (hours < 24)
            return minutes > 0 ? _('%sh %sm').format(hours, minutes) : _('%sh').format(hours);
        return _('%sd').format(Math.round(seconds / 86400));
    }

    _providerUsageSettings(providerId) {
        try {
            const parsed = JSON.parse(this._settings.get_string('provider-usage-settings')) || {};
            return parsed[providerId] || {};
        } catch {
            return {};
        }
    }

    _panelUsageTier(providerId) {
        return this._providerUsageSettings(providerId).panelUsageTier || 'auto';
    }

    _usageWindowVisible(providerId, windowId) {
        const hidden = this._providerUsageSettings(providerId).hiddenWindows || [];
        return !hidden.includes(windowId);
    }

    _metricLineId(type, label) {
        const safe = String(label || '').trim();
        return safe ? `${type}:${safe}` : '';
    }

    _providerHeading(snapshot, providerId) {
        const version = snapshot.version ? ` ${snapshot.version}` : '';
        return `${this._providerName(this._providerForKey(providerId) || providerId)}${version}`;
    }

    _providerName(provider) {
        const id = providerBaseId(provider);
        if (provider && typeof provider === 'object')
            return providerDisplayName(provider);
        if (id === 'factory')
            return _('Droid');
        return PROVIDER_NAMES[id] || id || _('AI');
    }

    _providerNeedsCli(provider) {
        if (!provider || provider.customCommand)
            return false;
        return true;
    }

    _providerIcon(providerId, size) {
        const fileName = PROVIDER_ICON_FILES[providerId];
        if (fileName) {
            const file = Gio.File.new_for_path(GLib.build_filenamev([EXTENSION_DIR, 'assets', 'provider-icons', fileName]));
            if (file.query_exists(null)) {
                return new St.Icon({
                    gicon: Gio.FileIcon.new(file),
                    icon_size: size,
                    style_class: 'ai-usage-provider-icon',
                });
            }
        }

        return new St.Icon({
            icon_name: 'applications-science-symbolic',
            icon_size: size,
            style_class: 'ai-usage-provider-icon fallback',
        });
    }

    _panelComponents() {
        const raw = this._settings.get_string('panel-components');
        const parts = raw.split(',')
            .map(part => part.trim())
            .filter(part => PANEL_COMPONENTS.includes(part));
        if (!parts.length)
            return ['bar', 'percent', 'text'];
        return [...new Set(parts)];
    }

    _activeProviderConfig() {
        if (!this._activeId)
            return null;
        return this._providerForKey(this._activeId);
    }

    _providerForKey(key) {
        return this._providers.find(provider => providerKey(provider) === key) || null;
    }

    _childProviders(parentKey) {
        return this._providers.filter(provider => provider.tabParent === parentKey);
    }

    _thresholds() {
        try {
            const parsed = JSON.parse(this._settings.get_string('usage-thresholds'));
            if (Array.isArray(parsed)) {
                const thresholds = parsed
                    .map((threshold, index) => this._normalizeThreshold(threshold, index))
                    .filter(Boolean)
                    .sort((a, b) => a.percent - b.percent);
                if (thresholds.length)
                    return thresholds;
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
            : this._settings.get_string('warning-color');

        return {
            id: String(threshold.id || `threshold-${index}`),
            label: String(threshold.label || _('Threshold')),
            percent,
            color,
            notify: Boolean(threshold.notify),
        };
    }

    _thresholdRankMap() {
        const map = new Map([['normal', 0]]);
        this._thresholds().forEach((threshold, index) => map.set(threshold.id, index + 1));
        return map;
    }

    _providerUpdatedText(value) {
        const usageText = value ? this._updatedText(value) : _('Updated just now');
        if (!this._lastRefreshAt)
            return usageText;
        return _('%s · Refreshed %s').format(usageText, this._lastRefreshAt.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}));
    }

    _updatedText(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime()))
            return _('Updated just now');
        const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
        if (seconds < 60)
            return _('Updated just now');
        if (seconds < 3600)
            return _('Updated %sm ago').format(Math.round(seconds / 60));
        if (seconds < 86400)
            return _('Updated %sh ago').format(Math.round(seconds / 3600));
        return _('Updated %sd ago').format(Math.round(seconds / 86400));
    }

    _openProviderPreferences() {
        if (this._activeId)
            this._settings.set_string('preferences-provider', this._activeId);
        this.openPreferences();
        this._indicator.menu.close();
    }
}
