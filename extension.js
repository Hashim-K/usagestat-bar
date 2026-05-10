import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {fetchProviderUsage, findCodexbar} from './cli.js';
import {enabledProviders, loadConfig, PROVIDER_NAMES, configPath} from './config.js';

const TIERS = ['primary', 'secondary', 'tertiary', 'quaternary'];

export default class AIUsageBarExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._signals = [];
        this._usage = new Map();
        this._errors = new Map();
        this._activeId = null;
        this._loading = false;
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
            'panel-position',
            'panel-index',
            'indicator-style',
            'show-label',
            'show-overview',
            'accent-color',
            'warning-color',
            'danger-color',
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
        this._header.add_child(this._iconButton('document-edit-symbolic', () => this._openConfig()));
        this._header.add_child(this._iconButton('preferences-system-symbolic', () => {
            this.openPreferences();
            this._indicator.menu.close();
        }));
        this._indicator.menu.box.add_child(this._header);

        this._tabs = new St.BoxLayout({style_class: 'ai-usage-tabs'});
        this._indicator.menu.box.add_child(this._tabs);

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
        if (!this._providers.length)
            this._providers = [];
        if (!this._activeId || !this._providers.some(provider => provider.id === this._activeId))
            this._activeId = this._providers[0]?.id ?? null;
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

        for (const provider of this._providers) {
            if (!this._cancellable || this._cancellable.is_cancelled())
                return;
            try {
                const data = await fetchProviderUsage(provider, this._cancellable);
                this._usage.set(provider.id, data);
                this._errors.delete(provider.id);
            } catch (error) {
                if (!this._cancellable || this._cancellable.is_cancelled())
                    return;
                this._errors.set(provider.id, error.message || String(error));
            }
        }

        this._loading = false;
        this._title.set_text(_('AI Usage Bar'));
        this._render();
    }

    _render() {
        if (!this._indicator)
            return;

        this._loadProviders();
        this._tabs.destroy_all_children();
        this._content.destroy_all_children();

        const active = this._activeSnapshot();
        this._renderPanel(active);

        if (!findCodexbar()) {
            this._renderMessage(
                _('CodexBar CLI not found'),
                _('Install it with `brew install steipete/tap/codexbar`, or set CODEXBAR_CLI to the binary path.'),
            );
            return;
        }

        if (!this._providers.length) {
            this._renderMessage(
                _('No providers enabled'),
                _('Enable providers in preferences or edit ~/.codexbar/config.json.'),
            );
            return;
        }

        if (this._settings.get_boolean('show-overview') && this._providers.length > 1)
            this._addTab('overview', _('Overview'), this._activeId === 'overview' || !this._activeId);
        for (const provider of this._providers)
            this._addTab(provider.id, this._providerName(provider.id), provider.id === this._activeId);

        if (this._activeId === 'overview' || !this._activeId)
            this._renderOverview();
        else
            this._renderProvider(this._activeId);
    }

    _addTab(id, label, active) {
        const button = new St.Button({
            label,
            style_class: active ? 'ai-usage-tab active' : 'ai-usage-tab',
            can_focus: true,
        });
        button.connect('clicked', () => {
            this._activeId = id;
            this._render();
        });
        this._tabs.add_child(button);
    }

    _activeSnapshot() {
        const id = this._activeId === 'overview' ? this._providers[0]?.id : this._activeId;
        return id ? this._usage.get(id) : null;
    }

    _renderPanel(snapshot) {
        const style = this._settings.get_string('indicator-style');
        const showLabel = this._settings.get_boolean('show-label');
        const percent = this._snapshotPercent(snapshot);
        const color = this._colorForPercent(percent);
        const displayMode = this._settings.get_string('display-mode');

        this._panelLabel.visible = showLabel;
        this._meter.visible = style !== 'label';
        this._panelLabel.set_text(style === 'percent' ? `${Math.round(percent)}%` : this._panelName());
        this._meter.set_style(`border-color: ${this._settings.get_string('neutral-color')};`);
        this._meterFill.set_width(Math.round(percent * 0.18));
        this._meterFill.set_style(`background-color: ${color};`);
        this._panelLabel.set_style(`color: ${this._settings.get_string('neutral-color')};`);

        if (displayMode === 'used' && style === 'percent')
            this._panelLabel.set_text(`${Math.round(percent)}%`);
    }

    _panelName() {
        if (this._activeId && this._activeId !== 'overview')
            return this._providerName(this._activeId);
        return this._providers.length > 1 ? _('AI') : this._providerName(this._providers[0]?.id);
    }

    _renderOverview() {
        for (const provider of this._providers) {
            const snapshot = this._usage.get(provider.id);
            const error = this._errors.get(provider.id);
            const row = new St.BoxLayout({style_class: 'ai-usage-overview-row'});
            row.add_child(new St.Label({
                text: this._providerName(provider.id),
                style_class: 'ai-usage-row-title',
                x_expand: true,
            }));

            if (error) {
                row.add_child(new St.Label({text: _('Error'), style_class: 'ai-usage-danger'}));
            } else if (snapshot) {
                row.add_child(new St.Label({
                    text: this._formatPercent(this._snapshotPercent(snapshot)),
                    style_class: 'ai-usage-row-value',
                }));
            } else {
                row.add_child(new St.Label({text: this._loading ? _('Loading') : _('Waiting'), style_class: 'ai-usage-muted'}));
            }

            row.reactive = true;
            row.connect('button-press-event', () => {
                this._activeId = provider.id;
                this._render();
                return Clutter.EVENT_STOP;
            });
            this._content.add_child(row);
        }
    }

    _renderProvider(providerId) {
        const snapshot = this._usage.get(providerId);
        const error = this._errors.get(providerId);
        if (error) {
            this._renderMessage(this._providerName(providerId), error, true);
            return;
        }
        if (!snapshot) {
            this._renderMessage(this._providerName(providerId), this._loading ? _('Loading usage...') : _('No usage fetched yet.'));
            return;
        }

        const usage = snapshot.usage || {};
        this._content.add_child(new St.Label({
            text: this._providerHeading(snapshot, providerId),
            style_class: 'ai-usage-provider-heading',
        }));

        const detail = [
            usage.accountEmail,
            usage.accountOrganization,
            usage.loginMethod,
            snapshot.source,
            snapshot.status?.description,
        ].filter(Boolean).join('  |  ');
        if (detail)
            this._content.add_child(new St.Label({text: detail, style_class: 'ai-usage-muted'}));

        for (const tier of TIERS) {
            const window = usage[tier];
            if (window && window.usedPercent !== undefined)
                this._renderUsageWindow(this._windowLabel(tier, window), window);
        }

        if (snapshot.credits?.remaining !== undefined) {
            this._content.add_child(new St.Label({
                text: _('Credits: %s left').format(String(snapshot.credits.remaining)),
                style_class: 'ai-usage-credits',
            }));
        }

        if (snapshot.openaiDashboard?.codeReviewRemainingPercent !== undefined) {
            this._content.add_child(new St.Label({
                text: _('Code review: %s%% left').format(Math.round(snapshot.openaiDashboard.codeReviewRemainingPercent)),
                style_class: 'ai-usage-credits',
            }));
        }
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
        fill.set_width(Math.round(percent * 3.1));
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
        const usage = snapshot?.usage;
        if (!usage)
            return 0;
        const values = TIERS
            .map(tier => usage[tier])
            .filter(window => window && window.usedPercent !== undefined)
            .map(window => this._displayPercent(window));
        if (!values.length)
            return 0;
        return values.reduce((sum, value) => sum + value, 0) / values.length;
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
        const usedMode = this._settings.get_string('display-mode') === 'used';
        const danger = usedMode ? percent >= 90 : percent <= 10;
        const warning = usedMode ? percent >= 75 : percent <= 30;
        if (danger)
            return this._settings.get_string('danger-color');
        if (warning)
            return this._settings.get_string('warning-color');
        return this._settings.get_string('accent-color');
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

    _resetText(window) {
        if (window.resetDescription)
            return window.resetDescription;
        if (window.resetsAt) {
            const date = new Date(window.resetsAt);
            if (!Number.isNaN(date.getTime()))
                return _('Resets %s').format(date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}));
        }
        return '';
    }

    _providerHeading(snapshot, providerId) {
        const version = snapshot.version ? ` ${snapshot.version}` : '';
        return `${this._providerName(providerId)}${version}`;
    }

    _providerName(id) {
        return PROVIDER_NAMES[id] || id || _('AI');
    }

    _openConfig() {
        Gio.app_info_launch_default_for_uri(`file://${configPath()}`, null);
        this._indicator.menu.close();
    }
}
