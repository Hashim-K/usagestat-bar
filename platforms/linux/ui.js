import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import {fillPreferencesWindow} from '../../preferences.js';
import {safeColor} from './model.js';
import {TrayPage} from './trayPreferences.js';
import {desktopActions, trayDesktop} from './desktop.js';

String.prototype.format ??= imports.format.format;

function button(label, callback, icon = '') {
    const widget = new Gtk.Button(icon ? {icon_name: icon, tooltip_text: label} : {label});
    if (icon) widget.add_css_class('flat');
    widget.connect('clicked', callback);
    return widget;
}

function label(text, css = '') {
    return new Gtk.Label({label: String(text ?? ''), xalign: 0, wrap: true, wrap_mode: Pango.WrapMode.WORD_CHAR,
        selectable: true, css_classes: css ? css.split(' ') : []});
}

const DETAILS_CSS = `
.usagestat-details .provider-tabs,
.usagestat-details .provider-tabs > flowboxchild { padding: 0; }
.usagestat-details .provider-tabs > flowboxchild { border-radius: 10px; }
.usagestat-details .provider-tab {
    min-width: 68px; min-height: 59px; padding: 7px 4px 6px;
    border: none; border-radius: 10px; box-shadow: none;
    background: transparent; font-size: 12px; font-weight: 600;
}
.usagestat-details .provider-tab:hover { background: alpha(@window_fg_color, 0.08); }
.usagestat-details .provider-tab:checked { background: #2f7df6; color: white; }
.usagestat-details .provider-tab image { opacity: 0.72; }
.usagestat-details .provider-tab:checked image { opacity: 1; }
.usagestat-details progressbar trough,
.usagestat-details progressbar progress {
    min-width: 0; min-height: 7px; border: none; border-radius: 4px;
    box-shadow: none; background-image: none;
}
.usagestat-details progressbar trough { background-color: alpha(@window_fg_color, 0.12); }
.usagestat-details .provider-tab progressbar trough,
.usagestat-details .provider-tab progressbar progress { min-height: 5px; border-radius: 3px; }
.usagestat-details .provider-tab progressbar trough { background-color: alpha(@window_fg_color, 0.16); }
.usagestat-details .provider-tab:checked progressbar trough { background-color: alpha(white, 0.25); }
.usagestat-details .provider-status { min-width: 6px; min-height: 6px; border-radius: 6px; }
.usagestat-details .provider-page { font-size: 12px; }
.usagestat-details .provider-name { font-size: 15px; font-weight: 700; }
.usagestat-details .provider-chip {
    font-size: 11px; font-weight: 600; border-radius: 4px; padding: 1px 4px;
    background-color: alpha(@window_fg_color, 0.09); color: alpha(@window_fg_color, 0.8);
}
.usagestat-details .provider-action { min-width: 24px; min-height: 24px; padding: 2px; color: @window_fg_color; }
.usagestat-details .section-title { font-size: 14px; font-weight: 700; }
.usagestat-details .usage-value { font-weight: 700; }
.usagestat-details .usage-extra { font-weight: 600; }
.usagestat-details .usage-muted { opacity: 0.65; }
.usagestat-details .provider-page separator { min-height: 1px; background-color: alpha(@window_fg_color, 0.12); }
`;

function statusDot(color, size = 6) {
    return new Gtk.Box({width_request: size, height_request: size, halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER,
        css_classes: ['provider-status', `status-${safeColor(color).slice(1)}`]});
}

function meter(percent, color) {
    return new Gtk.ProgressBar({fraction: Math.max(0, Math.min(1, (percent || 0) / 100)),
        hexpand: true, css_classes: [`usage-${safeColor(color).slice(1)}`]});
}

function updatedText(state) {
    if (state.loading) return 'Refreshing…';
    if (!state.updatedAt) return 'Waiting for usage…';
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(state.updatedAt).getTime()) / 60000));
    return minutes < 1 ? 'Updated just now' : minutes < 60 ? `Updated ${minutes}m ago` : `Updated ${Math.floor(minutes / 60)}h ago`;
}

export class DetailsWindow {
    constructor(app, model, preferences, onSizeChanged = null) {
        this.model = model;
        this.preferences = preferences;
        this.onSizeChanged = onSizeChanged;
        this.panelMode = false;
        this.window = new Adw.ApplicationWindow({application: app, title: 'UsageStat Bar', default_width: 460, default_height: 680});
        this.window.add_css_class('usagestat-details');
        this.css = new Gtk.CssProvider();
        const display = this.window.get_display();
        Gtk.StyleContext.add_provider_for_display(display, this.css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        this.style = Adw.StyleManager.get_default();
        const styleChanged = this.style.connect('notify::dark', () => { if (this._state) this.update(this._state); });
        this.window.connect('destroy', () => {
            if (this._scrollRestore) GLib.source_remove(this._scrollRestore);
            if (this._resizeIdle) GLib.source_remove(this._resizeIdle);
            this.style.disconnect(styleChanged);
            Gtk.StyleContext.remove_provider_for_display(display, this.css);
        });
        const toolbar = new Adw.ToolbarView();
        const header = new Adw.HeaderBar();
        this.header = header;
        header.pack_end(button('Preferences', () => preferences(''), 'emblem-system-symbolic'));
        this.editButton = button('Edit current provider', () => preferences(this._active), 'document-edit-symbolic');
        header.pack_end(this.editButton);
        this.refreshButton = button('Refresh usage', () => model.refresh(), 'view-refresh-symbolic');
        header.pack_end(this.refreshButton);
        toolbar.add_top_bar(header);
        const layout = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        const tabsArea = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 10,
            margin_start: 16, margin_end: 16, margin_top: 8, margin_bottom: 14});
        this.tabsArea = tabsArea;
        this.hostWarning = label('No status-notifier tray is available. Add your desktop’s tray plugin, or use a UsageStat panel widget. This window will remain available.', 'warning');
        this.hostWarning.visible = false;
        tabsArea.append(this.hostWarning);
        this.switcher = new Gtk.FlowBox({selection_mode: Gtk.SelectionMode.NONE, row_spacing: 4, column_spacing: 4,
            homogeneous: true, min_children_per_line: 1, max_children_per_line: 6, halign: Gtk.Align.START,
            css_classes: ['provider-tabs']});
        this.tabs = new Map();
        tabsArea.append(this.switcher);
        layout.append(tabsArea);
        this.content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 16,
            margin_start: 16, margin_end: 16, margin_bottom: 16});
        this.scroll = new Gtk.ScrolledWindow({hscrollbar_policy: Gtk.PolicyType.NEVER, vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
            overlay_scrolling: true, vexpand: true, child: this.content});
        layout.append(this.scroll);
        toolbar.set_content(layout);
        this.window.set_content(toolbar);
        this.window.connect('close-request', () => { this.window.hide(); return true; });
        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_controller, key) => {
            if (key === Gdk.KEY_Escape) { this.window.hide(); return true; }
            if (key === Gdk.KEY_F5) { model.refresh(); return true; }
            return false;
        });
        this.window.add_controller(keys);
        // Keep the details scrollable, with provider switching on the fixed
        // header and tabs. Tab widgets survive live usage updates.
        for (const area of [header, this.switcher]) {
            const providerScroll = new Gtk.EventControllerScroll({flags: Gtk.EventControllerScrollFlags.VERTICAL | Gtk.EventControllerScrollFlags.DISCRETE});
            providerScroll.connect('scroll', (_controller, _dx, dy) => {
                if (!model.settings.get_boolean('scroll-popup-to-switch-provider') || !dy) return false;
                model.cycle(dy > 0 ? 1 : -1, false);
                return true;
            });
            area.add_controller(providerScroll);
        }
    }

    preferredSize() {
        const width = 460;
        // Measure the body directly: a scrolled window deliberately hides its
        // child's natural height, which otherwise leaves every provider at 680px.
        const height = [this.header, this.tabsArea, this.content].reduce((sum, widget) =>
            sum + (widget.visible ? widget.measure(Gtk.Orientation.VERTICAL, width)[1] : 0), 0);
        return [width, Math.max(180, Math.ceil(height))];
    }

    queueResize() {
        if (!this.panelMode || this._resizeIdle) return;
        this._resizeIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._resizeIdle = 0;
            if (this.panelMode) this.onSizeChanged?.();
            return GLib.SOURCE_REMOVE;
        });
    }

    update(state) {
        this._state = state;
        const colors = new Set(['#ff5f57', ...state.providers.flatMap(provider => [provider.color, ...provider.windows.map(window => window.color)])].map(color => safeColor(color)));
        const statuses = new Set(state.providers.map(provider => safeColor(provider.statusColor)));
        const css = DETAILS_CSS + [...colors].map(color => `.usagestat-details progressbar.usage-${color.slice(1)} progress {background-color: ${color};}`).join('\n')
            + [...statuses].map(color => `.usagestat-details .status-${color.slice(1)} {background-color: ${color};}`).join('\n');
        if (css !== this._css) { this.css.load_from_string(css); this._css = css; }
        this.refreshButton.sensitive = !state.loading;
        this.editButton.sensitive = !!state.active;
        this.hostWarning.visible = !!this.hostMissing;
        this.updateTabs(state);
        this.queueResize();
        const provider = state.providers.find(p => p.key === state.active);
        const sections = provider ? [provider, ...state.providers.filter(p => p.parent === provider.key)] : [];
        const body = JSON.stringify([sections, state.loading, updatedText(state)]);
        if (this._body === body) return;
        this._body = body;
        const position = this._active === state.active ? this.scroll.vadjustment.value : 0;
        this._active = state.active;
        for (let child = this.content.get_first_child(); child; child = this.content.get_first_child()) this.content.remove(child);
        if (!provider) {
            this.content.append(label('Choose your providers', 'title-1'));
            this.content.append(label('Enable a provider in Preferences. UsageStat uses the same CLI and provider configuration as the GNOME extension.'));
            this.content.append(button('Open preferences', () => this.preferences('')));
        } else {
            for (const section of sections) this.provider(section, state);
        }
        if (this._scrollRestore) GLib.source_remove(this._scrollRestore);
        this._scrollRestore = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._scrollRestore = 0;
            this.scroll.vadjustment.value = Math.min(position, Math.max(0, this.scroll.vadjustment.upper - this.scroll.vadjustment.page_size));
            return GLib.SOURCE_REMOVE;
        });
    }

    updateTabs(state) {
        const providers = state.providers.filter(provider => !provider.parent);
        const keys = [...this.tabs.keys()];
        if (providers.length !== keys.length || providers.some((provider, index) => provider.key !== keys[index])) {
            for (let child = this.switcher.get_first_child(); child; child = this.switcher.get_first_child()) this.switcher.remove(child);
            this.tabs.clear();
            for (const provider of providers) {
                const item = new Gtk.ToggleButton({width_request: 76, height_request: 72, css_classes: ['provider-tab']});
                item.connect('clicked', () => { item.active = true; this.model.select(provider.key); });
                const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 3});
                const icon = new Gtk.Image({pixel_size: 22, halign: Gtk.Align.CENTER});
                const name = new Gtk.Label({ellipsize: Pango.EllipsizeMode.END, max_width_chars: 12});
                const progress = meter(0, provider.color);
                const dot = statusDot(provider.statusColor);
                for (const child of [icon, name, progress, dot]) box.append(child);
                item.child = box;
                this.switcher.insert(item, -1);
                this.tabs.set(provider.key, {item, icon, name, progress, dot});
            }
        }
        this.switcher.visible = providers.length > 0;
        for (const provider of providers) {
            const tab = this.tabs.get(provider.key);
            const active = provider.key === state.active;
            tab.item.active = active;
            tab.item.tooltip_text = `${provider.name}: ${provider.error ? 'Error' : provider.text}`;
            tab.item.update_property([Gtk.AccessibleProperty.LABEL], [tab.item.tooltip_text]);
            tab.name.label = provider.name;
            const path = active || this.style.dark ? provider.logo : provider.logoLight;
            if (path) tab.icon.set_from_file(path);
            else tab.icon.set_from_icon_name('application-x-executable-symbolic');
            const color = safeColor(provider.error ? '#ff5f57' : provider.color);
            tab.progress.set_css_classes([`usage-${color.slice(1)}`]);
            tab.progress.fraction = provider.error ? 1 : provider.loading ? 0.26 : Math.max(0, Math.min(1, (provider.percent || 0) / 100));
            tab.dot.set_css_classes(['provider-status', `status-${safeColor(provider.statusColor).slice(1)}`]);
        }
    }

    provider(provider, state) {
        const inner = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 11, css_classes: ['provider-page']});
        if (provider.parent) inner.append(new Gtk.Separator());
        const heading = new Gtk.Box({spacing: 6});
        heading.append(statusDot(provider.statusColor, 9));
        const title = new Gtk.Label({label: provider.name, ellipsize: Pango.EllipsizeMode.END, max_width_chars: 18,
            xalign: 0, selectable: true, css_classes: ['provider-name']});
        heading.append(title);
        for (const text of [provider.plan, provider.source].filter(Boolean))
            heading.append(new Gtk.Label({label: text, tooltip_text: text, ellipsize: Pango.EllipsizeMode.END,
                max_width_chars: 14, valign: Gtk.Align.CENTER, css_classes: ['provider-chip']}));
        heading.append(new Gtk.Box({hexpand: true}));
        for (const [text, uri, icon] of [['Usage dashboard', provider.dashboardUrl, 'view-statistics-symbolic'],
            ['Service status', provider.statusUrl, 'network-wired-symbolic']]) {
            if (!uri) continue;
            const link = new Gtk.LinkButton({uri, tooltip_text: text, valign: Gtk.Align.CENTER,
                child: new Gtk.Image({icon_name: icon, pixel_size: 16}), css_classes: ['flat', 'provider-action']});
            link.update_property([Gtk.AccessibleProperty.LABEL], [text]);
            heading.append(link);
        }
        if (provider.parent) {
            const edit = button(`Edit ${provider.name}`, () => this.preferences(provider.key), 'document-edit-symbolic');
            edit.add_css_class('provider-action');
            heading.append(edit);
        }
        inner.append(heading);
        if (!provider.parent) inner.append(label(updatedText(state), 'usage-muted'));
        inner.append(new Gtk.Separator());
        if (provider.serviceStatus?.description && !['none', 'unknown'].includes(provider.serviceStatus.indicator))
            inner.append(label(`Service status: ${provider.serviceStatus.description}`, 'warning'));
        if (provider.error) {
            inner.append(label(provider.error, 'error'));
            inner.append(button('Open provider setup', () => this.preferences(provider.key)));
        } else if (provider.loading) {
            inner.append(new Gtk.Spinner({spinning: true, halign: Gtk.Align.START}));
        } else {
            for (const window of provider.windows) {
                const row = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 7, margin_bottom: 4});
                row.append(label(window.label, 'section-title'));
                const progress = meter(window.percent, window.color);
                progress.update_property([Gtk.AccessibleProperty.LABEL], [`${window.label}: ${window.text}`]);
                row.append(progress);
                const text = new Gtk.Box({spacing: 10});
                const value = label(window.text, 'usage-value'); value.hexpand = true;
                const reset = label(window.reset || '', 'usage-muted'); reset.xalign = 1; reset.justify = Gtk.Justification.RIGHT;
                text.append(value); text.append(reset); row.append(text);
                if (window.quantityText) row.append(label(window.quantityText, 'usage-muted'));
                inner.append(row);
            }
            if (!provider.windows.length) inner.append(label('No quota windows reported', 'usage-muted'));
            if (provider.pace?.stage) inner.append(label(`Pace: ${provider.pace.stage.replaceAll('_', ' ')}`));
            if (provider.pace && !provider.pace.willLastToReset && Number(provider.pace.etaSeconds) > 0)
                inner.append(label(`Quota may run out in ${Math.ceil(Number(provider.pace.etaSeconds) / 60)} minutes`, 'warning'));
            for (const line of [...(provider.badges || []), ...(provider.lines || [])]) {
                inner.append(label([line.label, line.value || line.text].filter(Boolean).join(': '), 'usage-extra'));
                if (line.subtitle) inner.append(label(line.subtitle, 'usage-muted'));
            }
            if (provider.cost?.lines.length) {
                const costs = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 7});
                costs.append(label('Cost', 'section-title'));
                for (const line of provider.cost.lines) {
                    const row = new Gtk.Box({spacing: 12});
                    const name = label(line.label, 'usage-muted'); name.hexpand = true;
                    const value = label(`${line.moneyText} · ${line.tokensText}`, 'usage-extra');
                    value.xalign = 1; value.justify = Gtk.Justification.RIGHT;
                    row.append(name); row.append(value); costs.append(row);
                }
                inner.append(costs);
            }
            if (provider.credits !== null) inner.append(label(`Credits: ${provider.credits} left`, 'usage-extra'));
            if (provider.codeReview !== null) inner.append(label(`Code review: ${Math.round(provider.codeReview)}% left`, 'usage-extra'));
        }
        this.content.append(inner);
    }
}

export function preferencesWindow(app, settings, provider, {traySettings = null, providers = [], page = '', desktopChanged = null} = {}) {
    settings.set_string('preferences-provider', provider || '');
    const window = new Adw.PreferencesWindow({application: app, title: 'UsageStat Preferences'});
    const trayPage = traySettings ? new TrayPage(traySettings, providers) : null;
    fillPreferencesWindow(window, settings, {desktopPlacement: true, desktopActions: desktopActions(window, desktopChanged),
        trayOnly: !!trayPage && trayDesktop(), extraPages: trayPage ? [trayPage] : []});
    window.trayPage = trayPage;
    if (trayPage && (page === 'tray' || (!page && !provider && trayDesktop()))) window.set_visible_page(trayPage);
    window.connect('close-request', () => { Gio.Settings.sync(); return false; });
    window.present();
    return window;
}
