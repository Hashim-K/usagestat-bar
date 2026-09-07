import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {fillPreferencesWindow} from '../../preferences.js';
import {safeColor} from './model.js';

String.prototype.format ??= imports.format.format;

function button(label, callback, icon = '') {
    const widget = new Gtk.Button(icon ? {icon_name: icon, tooltip_text: label} : {label});
    widget.connect('clicked', callback);
    return widget;
}

function label(text, css = '') {
    return new Gtk.Label({label: String(text || ''), xalign: 0, wrap: true, selectable: true, css_classes: css ? [css] : []});
}

function money(value, currency = 'USD') {
    try { return new Intl.NumberFormat(undefined, {style: 'currency', currency}).format(Number(value) || 0); }
    catch { return `${currency} ${Number(value || 0).toFixed(2)}`; }
}

export class DetailsWindow {
    constructor(app, model, preferences) {
        this.model = model;
        this.preferences = preferences;
        this.window = new Adw.ApplicationWindow({application: app, title: 'UsageStat Bar', default_width: 510, default_height: 720,
            css_classes: ['usagestat-details']});
        this.css = new Gtk.CssProvider();
        const display = this.window.get_display();
        Gtk.StyleContext.add_provider_for_display(display, this.css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        this.window.connect('destroy', () => Gtk.StyleContext.remove_provider_for_display(display, this.css));
        const toolbar = new Adw.ToolbarView();
        const header = new Adw.HeaderBar();
        header.pack_start(button('Previous provider', () => model.cycle(-1, false), 'go-previous-symbolic'));
        header.pack_start(button('Next provider', () => model.cycle(1, false), 'go-next-symbolic'));
        header.pack_end(button('Preferences', () => preferences(''), 'emblem-system-symbolic'));
        this.refreshButton = button('Refresh usage', () => model.refresh(), 'view-refresh-symbolic');
        header.pack_end(this.refreshButton);
        toolbar.add_top_bar(header);
        this.content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 18,
            margin_start: 22, margin_end: 22, margin_top: 14, margin_bottom: 22});
        this.scroll = new Gtk.ScrolledWindow({hscrollbar_policy: Gtk.PolicyType.NEVER, child: this.content});
        toolbar.set_content(this.scroll);
        this.window.set_content(toolbar);
        this.window.connect('close-request', () => { this.window.hide(); return true; });
        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_controller, key) => {
            if (key === Gdk.KEY_Escape) { this.window.hide(); return true; }
            if (key === Gdk.KEY_F5) { model.refresh(); return true; }
            return false;
        });
        this.window.add_controller(keys);
        const providerScroll = new Gtk.EventControllerScroll({flags: Gtk.EventControllerScrollFlags.VERTICAL | Gtk.EventControllerScrollFlags.DISCRETE});
        providerScroll.connect('scroll', (_controller, _dx, dy) => {
            if (!model.settings.get_boolean('scroll-popup-to-switch-provider') || !dy) return false;
            model.cycle(dy > 0 ? 1 : -1, false);
            return true;
        });
        // Long quota/cost views must remain scrollable. The header provides the
        // popup's provider-switch gesture without consuming body scrolling.
        header.add_controller(providerScroll);
    }

    update(state) {
        const colors = new Set(state.providers.flatMap(provider => provider.windows.map(window => safeColor(window.color))));
        this.css.load_from_string([...colors].map(color => `.usagestat-details progressbar.usage-${color.slice(1)} progress {background-color: ${color}; background-image: none; min-height: 7px;}`)
            .join('\n') + '\n.usagestat-details progressbar trough {min-height: 7px;}');
        const position = this._active === state.active ? this.scroll.vadjustment.value : 0;
        this._active = state.active;
        for (let child = this.content.get_first_child(); child; child = this.content.get_first_child()) this.content.remove(child);
        this.refreshButton.sensitive = !state.loading;
        if (this.hostMissing)
            this.content.append(label('No status-notifier tray is available. Add your desktop’s tray plugin, or use a UsageStat panel widget. This window will remain available.', 'warning'));
        const switcher = new Gtk.FlowBox({selection_mode: Gtk.SelectionMode.NONE, row_spacing: 6, column_spacing: 6, homogeneous: true, max_children_per_line: 4});
        for (const provider of state.providers.filter(p => !p.parent)) {
            const item = button(`${provider.name}\n${provider.error ? 'Error' : provider.text}`, () => this.model.select(provider.key));
            if (provider.key === state.active) item.add_css_class('suggested-action');
            switcher.insert(item, -1);
        }
        this.content.append(switcher);
        const provider = state.providers.find(p => p.key === state.active);
        if (!provider) {
            this.content.append(label('Choose your providers', 'title-1'));
            this.content.append(label('Enable a provider in Preferences. UsageStat uses the same CLI and provider configuration as the GNOME extension.'));
            this.content.append(button('Open preferences', () => this.preferences('')));
        } else {
            this.provider(provider);
            for (const child of state.providers.filter(p => p.parent === provider.key)) this.provider(child);
        }
        this.content.append(label(state.loading ? 'Refreshing…' : state.updatedAt ? `Last refresh: ${new Date(state.updatedAt).toLocaleTimeString()}` : 'Waiting for usage…', 'dim-label'));
        if (this._scrollRestore) GLib.source_remove(this._scrollRestore);
        this._scrollRestore = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._scrollRestore = 0;
            this.scroll.vadjustment.value = Math.min(position, Math.max(0, this.scroll.vadjustment.upper - this.scroll.vadjustment.page_size));
            return GLib.SOURCE_REMOVE;
        });
    }

    provider(provider) {
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12, css_classes: ['card'],
            margin_top: 2});
        const inner = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12,
            margin_start: 18, margin_end: 18, margin_top: 18, margin_bottom: 18});
        box.append(inner);
        const heading = new Gtk.Box({spacing: 10});
        if (provider.logo) heading.append(new Gtk.Image({file: Adw.StyleManager.get_default().dark ? provider.logo : provider.logoLight, pixel_size: 26}));
        const title = label(provider.name, provider.parent ? 'title-3' : 'title-1');
        title.hexpand = true;
        heading.append(title);
        heading.append(button(`Edit ${provider.name}`, () => this.preferences(provider.key), 'document-edit-symbolic'));
        inner.append(heading);
        inner.append(label([provider.plan, provider.source].filter(Boolean).join(' · '), 'dim-label'));
        if (provider.serviceStatus?.description && !['none', 'unknown'].includes(provider.serviceStatus.indicator))
            inner.append(label(`Service status: ${provider.serviceStatus.description}`, 'warning'));
        if (provider.error) {
            inner.append(label(provider.error, 'error'));
            inner.append(button('Open provider setup', () => this.preferences(provider.key)));
        } else if (provider.loading) {
            inner.append(new Gtk.Spinner({spinning: true, halign: Gtk.Align.START}));
        } else {
            for (const window of provider.windows) {
                const row = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
                const text = new Gtk.Box({spacing: 10});
                const name = label(window.label); name.hexpand = true;
                text.append(name); text.append(label(window.text)); row.append(text);
                const progress = new Gtk.ProgressBar({fraction: window.percent / 100, css_classes: [`usage-${safeColor(window.color).slice(1)}`]});
                row.append(progress);
                const number = value => window.format?.kind === 'currency' ? money(value, window.format.currency)
                    : Number(value || 0).toLocaleString();
                const quantity = window.limit !== undefined ? `${number(window.used)} / ${number(window.limit)}` : '';
                if (quantity || window.reset) row.append(label([quantity, window.reset].filter(Boolean).join(' · '), 'dim-label'));
                inner.append(row);
            }
            if (!provider.windows.length) inner.append(label('No quota windows reported', 'dim-label'));
            for (const line of provider.cost?.lines || [])
                inner.append(label(`${line.label}: ${money(line.cost, line.currency || provider.cost.currency)} · ${Number(line.tokens || 0).toLocaleString()} tokens`));
            for (const line of provider.lines) inner.append(label([line.label, line.value, line.subtitle].filter(Boolean).join(' · ')));
            for (const badge of provider.badges) inner.append(label([badge.label, badge.text, badge.subtitle].filter(Boolean).join(' · ')));
            if (provider.credits !== null) inner.append(label(`Credits: ${provider.credits} left`));
            if (provider.codeReview !== null) inner.append(label(`Code review: ${Math.round(provider.codeReview)}% left`));
            if (provider.pace?.stage) inner.append(label(`Pace: ${provider.pace.stage.replaceAll('_', ' ')}${Number.isFinite(Number(provider.pace.deltaPercent)) ? ` (${Number(provider.pace.deltaPercent).toFixed(1)}%)` : ''}`));
            if (provider.pace && !provider.pace.willLastToReset && Number(provider.pace.etaSeconds) > 0)
                inner.append(label(`Quota may run out in ${Math.ceil(Number(provider.pace.etaSeconds) / 60)} minutes`, 'warning'));
        }
        const links = new Gtk.Box({spacing: 10});
        for (const [text, uri] of [['Usage dashboard', provider.dashboardUrl], ['Service status', provider.statusUrl]]) {
            if (uri) links.append(new Gtk.LinkButton({label: text, uri}));
        }
        inner.append(links);
        this.content.append(box);
    }
}

export function preferencesWindow(app, settings, provider) {
    settings.set_string('preferences-provider', provider || '');
    const window = new Adw.PreferencesWindow({application: app, title: 'UsageStat Preferences'});
    fillPreferencesWindow(window, settings, {desktopPlacement: true});
    window.connect('close-request', () => { Gio.Settings.sync(); return false; });
    window.present();
    return window;
}
