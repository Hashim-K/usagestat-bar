import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {fetchProviderUsage, fetchProviderManifests, findAiUsage, normalizeBackendSnapshot} from '../../cli.js';
import {configPath, loadConfig, enabledProviders, providerKey, providerDisplayName} from '../../config.js';
import {jsonSetting} from './settings.js';
import {PROVIDER_DASHBOARD_URLS} from '../../providerMetadata.js';

const TIERS = ['primary', 'secondary', 'tertiary', 'quaternary'];
export const clamp = value => Math.max(0, Math.min(100, Number(value) || 0));
export const shown = (used, mode) => mode === 'used' ? clamp(used) : 100 - clamp(used);
export const percentText = (used, mode) => `${Number(shown(used, mode).toFixed(1))}% ${mode === 'used' ? 'used' : 'left'}`;
export const safeColor = (color, fallback = '#8ab4f8') => /^#[\da-f]{6}$/i.test(color || '') ? color : fallback;

export function formatMoney(value, currency = 'USD') {
    try { return new Intl.NumberFormat(undefined, {style: 'currency', currency,
        minimumFractionDigits: 2, maximumFractionDigits: 2}).format(Number(value) || 0); }
    catch { return `${currency} ${Number(value || 0).toFixed(2)}`; }
}

export function compactNumber(value) {
    const number = Math.max(0, Number(value) || 0);
    for (const [size, suffix] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
        if (number >= size) return (number / size).toFixed(number >= size * 10 ? 0 : 1).replace(/\.0$/, '') + suffix;
    }
    return String(Math.round(number));
}

function statusColor(error, loading, status) {
    if (error) return '#ff5f57';
    if (loading) return '#f6d32d';
    if (status && !['none', 'unknown'].includes(status.indicator))
        return status.indicator === 'minor' ? '#f6d32d' : '#ff5f57';
    return '#33d17a';
}

export function windows(usage = {}) {
    const result = TIERS.filter(id => usage[id]?.usedPercent !== undefined).map(id => ({id, ...usage[id]}));
    for (const item of usage.extraRateWindows || []) {
        if (item?.window?.usedPercent !== undefined)
            result.push({id: item.id || item.title, label: item.title, ...item.window});
    }
    if (Number(usage.providerCost?.limit) > 0) {
        const cost = usage.providerCost;
        result.push({id: 'extraUsage', label: cost.currencyCode === 'Quota' ? 'Quota usage' : 'Extra usage',
            usedPercent: clamp(Number(cost.used) / Number(cost.limit) * 100), used: cost.used, limit: cost.limit,
            format: {kind: cost.currencyCode === 'Quota' ? 'count' : 'currency', currency: cost.currencyCode}, resetsAt: cost.resetsAt, resetDescription: cost.period});
    }
    return result;
}

export function selectedUsage(usage, options = {}) {
    const visible = windows(usage).filter(window => !(options.hiddenWindows || []).includes(window.id));
    const tier = options.panelUsageTier || 'primary';
    const selected = visible.find(window => window.id === tier);
    if (selected) return selected.usedPercent;
    const cost = visible.find(window => window.id === 'extraUsage');
    if (usage?.primary?.usedPercent >= 100 && cost) return cost.usedPercent;
    const standard = visible.filter(window => TIERS.includes(window.id));
    return standard.length ? standard.reduce((sum, window) => sum + clamp(window.usedPercent), 0) / standard.length : null;
}

export function thresholds(settings) {
    const values = jsonSetting(settings, 'usage-thresholds', []);
    return (Array.isArray(values) ? values : []).filter(value => value && Number.isFinite(Number(value.percent)))
        .map((value, i) => ({id: String(value.id || `threshold-${i}`), label: String(value.label || 'Threshold'),
            percent: clamp(value.percent), color: safeColor(value.color, '#f6d32d'), notify: Boolean(value.notify)}))
        .sort((a, b) => a.percent - b.percent);
}

export function thresholdAt(used, list) {
    return list.filter(value => clamp(used) >= value.percent).at(-1) || null;
}

export function panelPins(providers, pinned = [], count = 1) {
    const visible = providers.filter(p => !p.parent);
    return [...new Set(pinned)].filter(key => visible.some(p => p.key === key))
        .slice(0, Math.max(0, Math.min(count, visible.length) - 1));
}

export function panelProviders(providers, active, pinned = [], count = 1) {
    const visible = providers.filter(p => !p.parent);
    const pins = panelPins(providers, pinned, count).map(key => visible.find(p => p.key === key));
    const rest = visible.filter(p => !pins.includes(p));
    const start = Math.max(0, rest.findIndex(p => p.key === active));
    return [...pins, ...rest.slice(start), ...rest.slice(0, start)].slice(0, Math.max(1, count));
}

export class Model {
    constructor(settings, changed = () => {}, notify = () => {}) {
        this.settings = settings;
        this.changed = changed;
        this.notify = notify;
        this.usage = new Map();
        this.errors = new Map();
        this.previousThreshold = new Map();
        this.manifests = new Map();
        this.cancellable = new Gio.Cancellable();
        this.active = '';
        this.loading = false;
        this.revision = 0;
        this.timer = 0;
        this.closed = false;
        this.reload();
        this.settingsId = settings.connect('changed', (_settings, key) => {
            if (key === 'provider-usage-windows') return;
            if (['usagestat-cli-path', 'usagestat-plugin-dir'].includes(key)) {
                this.cancellable.cancel();
                this.pendingRefresh = true;
                if (!this.loading) this.refresh();
            }
            this.reload();
            this.schedule();
            this.emit();
        });
        this.schedule();
    }

    reload() {
        const binary = findAiUsage(this.settings.get_string('usagestat-cli-path')) || '';
        this.configFile = configPath(binary);
        this.providers = enabledProviders(loadConfig(binary));
        const visible = this.providers.filter(p => !p.tabParent);
        if (!visible.some(p => providerKey(p) === this.active)) {
            const pins = jsonSetting(this.settings, 'panel-pinned-providers', []);
            this.active = pins.find(key => visible.some(p => providerKey(p) === key)) || (visible[0] ? providerKey(visible[0]) : '');
        }
        if (this.monitoredPath !== this.configFile) {
            this.monitor?.cancel();
            this.monitoredPath = this.configFile;
            this.monitor = Gio.File.new_for_path(this.configFile).monitor_file(Gio.FileMonitorFlags.NONE, null);
            this.monitor.connect('changed', () => {
                if (this.debounce) GLib.source_remove(this.debounce);
                this.debounce = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                    this.debounce = 0;
                    this.pendingRefresh = true;
                    this.refresh();
                    return GLib.SOURCE_REMOVE;
                });
            });
        }
    }

    schedule() {
        if (this.timer) GLib.source_remove(this.timer);
        this.timer = 0;
        const minutes = this.settings.get_int('refresh-interval');
        if (minutes > 0) this.timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, minutes * 60, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    async refresh() {
        if (this.closed) return;
        if (this.loading) { this.pendingRefresh = true; return; }
        this.pendingRefresh = false;
        this.cancellable = new Gio.Cancellable();
        this.reload();
        this.loading = true;
        this.emit();
        const options = {cliPath: this.settings.get_string('usagestat-cli-path'),
            pluginDir: this.settings.get_string('usagestat-plugin-dir'), configFile: this.configFile};
        try {
            try {
                this.manifests = new Map((await fetchProviderManifests(this.cancellable, options)).map(p => [p.id, p]));
            } catch { /* Bundled metadata remains available. */ }
            // A small fixed concurrency bound avoids one provider delaying every other indicator.
            const queue = [...this.providers];
            const worker = async () => {
                while (queue.length && !this.cancellable.is_cancelled()) {
                    const provider = queue.shift();
                    const key = providerKey(provider);
                    const publish = snapshot => {
                        if (this.cancellable.is_cancelled() || this.closed) return;
                        snapshot = normalizeBackendSnapshot(snapshot, provider.id);
                        this.usage.set(key, snapshot);
                        this.errors.delete(key);
                        this.rememberWindows(key, snapshot);
                        this.checkThreshold(provider, snapshot);
                    };
                    try {
                        const snapshot = await fetchProviderUsage(provider, this.cancellable, {...options, onUsage: partial => {
                            // Retain existing totals during refresh so the cost
                            // section does not disappear while new totals load.
                            const cost = partial.usage?.costSummary || this.usage.get(key)?.usage?.costSummary;
                            publish({...partial, usage: {...partial.usage, costSummary: cost}});
                            this.emit();
                        }});
                        if (this.cancellable.is_cancelled()) break;
                        publish(snapshot);
                    } catch (error) {
                        if (this.cancellable.is_cancelled()) break;
                        this.errors.set(key, error.message || String(error));
                    }
                    this.emit();
                }
            };
            await Promise.all([worker(), worker(), worker()]);
        } finally {
            this.loading = false;
            this.updatedAt = new Date().toISOString();
            this.emit();
            if (this.pendingRefresh && !this.closed) this.refresh();
        }
    }

    rememberWindows(key, snapshot) {
        const usage = snapshot.usage || {};
        const labels = Object.fromEntries(windows(usage).map(w => [w.id, windowLabel(w)]));
        if (usage.costSummary) labels.costSummary = 'Cost';
        if (snapshot.credits?.remaining !== undefined) labels.credits = 'Credits';
        if (snapshot.openaiDashboard?.codeReviewRemainingPercent !== undefined) labels.codeReview = 'Code review';
        for (const item of usage.extraTextLines || []) labels[`text:${item.label || item.value}`] = item.label || item.value;
        for (const item of usage.badges || []) labels[`badge:${item.label || item.text}`] = item.label || item.text;
        const all = jsonSetting(this.settings, 'provider-usage-windows');
        if (JSON.stringify(all[key]) !== JSON.stringify(labels))
            this.settings.set_string('provider-usage-windows', JSON.stringify({...all, [key]: labels}));
    }

    checkThreshold(provider, snapshot) {
        const key = providerKey(provider);
        const used = selectedUsage(snapshot.usage, jsonSetting(this.settings, 'provider-usage-settings')[key]);
        if (used === null) return;
        const list = thresholds(this.settings);
        const current = thresholdAt(used, list);
        const previous = this.previousThreshold.get(key);
        this.previousThreshold.set(key, current?.id || 'normal');
        const rank = id => list.findIndex(value => value.id === id);
        if (previous !== undefined && current?.notify && rank(current.id) > rank(previous))
            this.notify('AI usage threshold crossed', `${providerDisplayName(provider)} is now ${Math.round(used)}% used (${current.label})`);
    }

    select(key) {
        if (key === this.active || !this.providers.some(p => !p.tabParent && providerKey(p) === key)) return;
        this.active = key;
        this.emit();
    }

    cycle(direction, requireScrollSetting = true, excluded = []) {
        if (requireScrollSetting && !this.settings.get_boolean('scroll-to-switch-provider')) return;
        const pins = requireScrollSetting ? panelPins(this.providers.map(p => ({key: providerKey(p), parent: p.tabParent})),
            jsonSetting(this.settings, 'panel-pinned-providers', []), this.settings.get_int('panel-bar-count')) : excluded;
        const visible = this.providers.filter(p => !p.tabParent && !pins.includes(providerKey(p)));
        if (!visible.length) return;
        const index = Math.max(0, visible.findIndex(p => providerKey(p) === this.active));
        this.select(providerKey(visible[(index + (direction > 0 ? 1 : -1) + visible.length) % visible.length]));
    }

    snapshot() {
        const settings = this.settings;
        const mode = settings.get_string('display-mode');
        const list = thresholds(settings);
        const usageSettings = jsonSetting(settings, 'provider-usage-settings');
        const providers = this.providers.map(config => {
            const key = providerKey(config);
            const snapshot = this.usage.get(key);
            const usage = snapshot?.usage || {};
            const options = usageSettings[key] || {};
            const hidden = options.hiddenWindows || [];
            const used = selectedUsage(usage, options);
            const errorBadge = (usage.badges || []).find(b => /error/i.test(b.label) && /red|error/i.test(b.color));
            const error = this.errors.get(key) || snapshot?.error?.message || (errorBadge ? errorBadge.text : '') || '';
            const manifest = this.manifests.get(config.id) || {};
            const cost = hidden.includes('costSummary') ? null : usage.costSummary || null;
            const view = {key, id: config.id, name: providerDisplayName(config), parent: config.tabParent || '',
                used, percent: used === null ? null : shown(used, mode), text: error ? 'Error' : used === null ? '—' : percentText(used, mode),
                threshold: used === null ? null : thresholdAt(used, list),
                color: safeColor(thresholdAt(used, list)?.color || settings.get_string('accent-color')),
                error, loading: this.loading && !snapshot && !error, source: snapshot?.source || config.source || 'auto',
                statusColor: statusColor(error, this.loading && !snapshot, snapshot?.status),
                plan: usage.plan || snapshot?.plan || '', updatedAt: usage.updatedAt || '', serviceStatus: snapshot?.status || null,
                windows: windows(usage).filter(w => !hidden.includes(w.id)).map(w => ({...w, label: windowLabel(w),
                    percent: shown(w.usedPercent, mode), text: percentText(w.usedPercent, mode),
                    color: safeColor(thresholdAt(w.usedPercent, list)?.color || settings.get_string('accent-color')),
                    quantityText: w.limit !== undefined && ['currency', 'count'].includes(w.format?.kind)
                        ? [w.used, w.limit].map(value => w.format.kind === 'currency'
                            ? formatMoney(value, w.format.currency) : Number(value || 0).toLocaleString()).join(' / ') : '',
                    reset: resetText(w, settings.get_string('reset-time-format'))})),
                cost: cost ? {...cost, lines: (cost.lines || []).map(line => ({...line,
                    moneyText: formatMoney(line.cost, line.currency || cost.currency || 'USD'),
                    tokensText: `${compactNumber(line.tokens)} tokens`}))} : null,
                credits: hidden.includes('credits') ? null : snapshot?.credits?.remaining ?? null,
                codeReview: hidden.includes('codeReview') ? null : snapshot?.openaiDashboard?.codeReviewRemainingPercent ?? null,
                badges: (usage.badges || []).filter(b => !hidden.includes(`badge:${b.label || b.text}`)),
                lines: (usage.extraTextLines || []).filter(b => !hidden.includes(`text:${b.label || b.value}`)),
                pace: settings.get_boolean('show-pace') ? snapshot?.pace || null : null,
                dashboardUrl: settings.get_boolean('show-dashboard-link') ? safeUrl(snapshot?.dashboardUrl || snapshot?.usageDashboardUrl
                    || usage.dashboardUrl || usage.usageDashboardUrl || config.dashboardUrl || config.usageDashboardUrl
                    || config.settings?.dashboardUrl || config.settings?.usageDashboardUrl || manifest.usageDashboardUrl
                    || manifest.dashboardUrl || PROVIDER_DASHBOARD_URLS[config.id] || '') : '',
                statusUrl: settings.get_boolean('show-status-link') ? safeUrl(snapshot?.statusPageUrl || manifest.statusPageUrl || '') : '',
                iconPath: config.iconPath || '', iconId: options.iconSource || config.id,
                iconStyle: options.iconStyle || settings.get_string('provider-icon-style')};
            return view;
        });
        return {protocol: 1, revision: this.revision, active: this.active, loading: this.loading,
            updatedAt: this.updatedAt || '', mode, providers,
            interaction: {panelScroll: settings.get_boolean('scroll-to-switch-provider'),
                popupScroll: settings.get_boolean('scroll-popup-to-switch-provider')},
            popupAlignment: settings.get_string('popup-alignment'),
            panel: panelProviders(providers, this.active, jsonSetting(settings, 'panel-pinned-providers', []), settings.get_int('panel-bar-count')).map(p => p.key),
            appearance: {components: settings.get_string('panel-components').split(','),
                bars: Math.min(3, Math.max(1, settings.get_int('panel-usage-bar-count'))),
                layout: settings.get_string('panel-usage-bar-layout'), spacing: Math.max(0, settings.get_int('panel-provider-spacing')),
                neutral: safeColor(settings.get_string('neutral-color'), '#e6edf3'), fill: settings.get_string('provider-logo-fill-mode')}};
    }

    emit() { if (!this.closed) { this.revision++; this.changed(this.snapshot()); } }

    close() {
        this.closed = true;
        this.cancellable.cancel();
        if (this.timer) GLib.source_remove(this.timer);
        if (this.debounce) GLib.source_remove(this.debounce);
        this.monitor?.cancel();
        this.settings.disconnect(this.settingsId);
    }
}

export function safeUrl(url) { return /^https?:\/\//i.test(url || '') ? url : ''; }

export function windowLabel(window) {
    if (window.label) return window.label;
    const minutes = window.windowMinutes || (window.windowSeconds || 0) / 60;
    if (minutes >= 10080) return 'Weekly';
    if (minutes >= 1440) return `${Math.round(minutes / 1440)}d`;
    if (minutes >= 60) return `${Math.round(minutes / 60)}h`;
    return window.id.charAt(0).toUpperCase() + window.id.slice(1);
}

export function resetText(window, mode = 'smart', now = new Date()) {
    if (window.resetDescription) return window.resetDescription;
    if (!window.resetsAt) return '';
    const date = new Date(window.resetsAt);
    if (Number.isNaN(date.getTime())) return '';
    const seconds = Math.max(0, Math.round((date - now) / 1000));
    const minutes = Math.round(seconds / 60);
    let text;
    if (mode === 'relative' || (mode === 'smart' && seconds < 86400 && date.toDateString() === now.toDateString()))
        text = seconds < 60 ? `${seconds}s` : minutes < 60 ? `${minutes}m` : seconds < 86400 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${Math.round(seconds / 86400)}d`;
    else if (mode === 'time') text = date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    else text = date.toLocaleDateString([], mode === 'weekday-time' || (mode === 'smart' && (window.windowMinutes >= 10080 || seconds < 604800))
        ? {weekday: 'short', hour: '2-digit', minute: '2-digit'} : {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
    return `Resets ${text}`;
}
