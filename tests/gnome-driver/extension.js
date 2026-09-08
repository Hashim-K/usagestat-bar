import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import {assert, equal} from './assert.js';

const UUID = 'usagestat-bar@hashimkarim';
const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));
const writeJson = (path, value) => Gio.File.new_for_path(path).replace_contents(
    new TextEncoder().encode(JSON.stringify(value, null, 2)), null, false,
    Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE, null);

export default class BaselineDriver extends Extension {
    enable() {
        this._stopped = false;
        this._run().catch(error => this._finish([{name: 'session setup', status: 'failed',
            error: `${error.message}\n${error.stack}`} ]));
    }

    disable() {
        this._stopped = true;
    }

    async _until(predicate, description, timeoutMs = 15000) {
        const deadline = GLib.get_monotonic_time() + timeoutMs * 1000;
        while (!this._stopped && GLib.get_monotonic_time() < deadline) {
            if (predicate())
                return;
            await delay(100);
        }
        throw new Error(`Timed out waiting for ${description}`);
    }

    _app() {
        return Main.extensionManager.lookup(UUID)?.stateObj;
    }

    async _ready() {
        await this._until(() => this._app()?._indicator && !this._app()._loading &&
            this._app()._usage?.size === 3, 'three fixture provider instances');
        return this._app();
    }

    async _screenshot(name) {
        await delay(300);
        const path = GLib.build_filenamev([GLib.getenv('USAGESTAT_TEST_OUTPUT_DIR'), `${name}.png`]);
        const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.PRIVATE, null);
        try {
            await new Shell.Screenshot().screenshot(false, stream);
        } finally {
            stream.close(null);
        }
    }

    _finish(results) {
        writeJson(`${GLib.getenv('USAGESTAT_TEST_OUTPUT_DIR')}/result.json`, {
            status: results.some(result => result.status === 'failed') ? 'failed' : 'passed',
            referenceCommit: '9436c3834522745076c60937dc7c4c4a1649e6e8',
            shellVersion: Config.PACKAGE_VERSION,
            session: 'isolated GNOME Wayland',
            backend: 'credential-free fixture v1',
            results,
        });
    }

    async _run() {
        if (GLib.getenv('USAGESTAT_TEST_INTERACTIONS') === '1') {
            const {runInteractions} = await import('./interactions.js');
            return runInteractions(this);
        }
        let app = await this._ready();
        Main.overview.hide();
        await delay(700);
        const results = [];
        const check = async (name, callback) => {
            try {
                await callback();
                results.push({name, status: 'passed'});
            } catch (error) {
                results.push({name, status: 'failed', error: `${error.message}\n${error.stack}`});
            }
        };
        await check('native panel indicator and grouped fixture providers', () => {
            assert(Main.panel.statusArea[UUID] === app._indicator, 'Indicator not registered in the panel');
            assert(app._indicator.mapped, 'Panel indicator is not visible');
            equal(app._visibleProviders.map(p => p.id), ['codex', 'claude']);
            equal(app._childProviders('codex').map(p => p.instanceId), ['codex:fixture-work']);
            equal(app._usage.get('codex').usage.primary.usedPercent, 25);
        });
        await check('auto usage averages visible standard windows', () => {
            equal(app._snapshotUsedPercent(app._usage.get('codex'), 'codex'), 52.5);
        });
        await check('used/remaining modes affect meter meaning and text', () => {
            app._settings.set_string('display-mode', 'used');
            equal(app._displayPercent({usedPercent: 25}), 25);
            equal(app._formatPercent(25), '25% used');
            app._settings.set_string('display-mode', 'remaining');
            equal(app._displayPercent({usedPercent: 25}), 75);
            equal(app._formatPercent(75), '75% left');
            equal(app._displayPercent({usedPercent: 125}), 0);
        });
        await check('panel window selection and hidden-window fallback', () => {
            app._settings.set_string('provider-usage-settings', JSON.stringify({codex: {panelUsageTier: 'secondary'}}));
            equal(app._snapshotUsedPercent(app._usage.get('codex'), 'codex'), 80);
            app._settings.set_string('provider-usage-settings', JSON.stringify({codex: {
                panelUsageTier: 'secondary', hiddenWindows: ['secondary'],
            }}));
            equal(app._snapshotUsedPercent(app._usage.get('codex'), 'codex'), 25);
            app._settings.set_string('provider-usage-settings', '{}');
        });
        await check('threshold boundaries and ascending-only notifications', () => {
            app._settings.set_string('usage-thresholds', JSON.stringify([
                {id: 'warning', label: 'Warning', percent: 75, color: '#f6d32d', notify: true},
                {id: 'danger', label: 'Danger', percent: 90, color: '#ff5f57', notify: true},
                {id: 'limit', label: 'Limit', percent: 100, color: '#ff2d55', notify: true},
            ]));
            equal(app._thresholdForUsedPercent(74.9), null);
            equal(app._thresholdForUsedPercent(75).id, 'warning');
            equal(app._thresholdForUsedPercent(90).id, 'danger');
            equal(app._thresholdForUsedPercent(100).id, 'limit');
            const notificationCount = () => Main.messageTray.getSources()
                .flatMap(source => source.notifications).filter(n => n.title === 'AI usage threshold crossed').length;
            const initial = notificationCount();
            const update = percent => app._maybeNotifyThreshold('codex', {usage: {primary: {usedPercent: percent}}});
            app._thresholdStates.delete('codex');
            update(90);
            equal(notificationCount(), initial, 'Initial high usage should not notify');
            update(25);
            update(75);
            equal(notificationCount(), initial + 1, 'Crossing should notify');
            update(75);
            update(50);
            equal(notificationCount(), initial + 1, 'Same/lower usage should not notify');
            update(90);
            equal(notificationCount(), initial + 2, 'A later ascending crossing should notify again');
        });
        await check('zero and full bar fills use the entire range', () => {
            equal(app._barFillWidth(0, 100), 0);
            equal(app._barFillWidth(100, 100), 100);
        });
        await check('logo clips preserve presentation attributes and actual fill geometry', () => {
            const source = '<svg viewBox="0 0 20 10" fill="#abcdef"><rect width="20" height="10"/></svg>';
            const horizontal = app._usageFilledProviderIconSvg(source, 'horizontal', 25);
            assert(horizontal.includes('width="5" height="10"'));
            assert(horizontal.includes('fill="#abcdef"'));
            assert(app._usageFilledProviderIconSvg(source, 'vertical', 25).includes('y="7.5" width="20" height="2.5"'));
            assert(app._usageFilledProviderIconSvg(source, 'pie', 25).includes('<path d="M '));
            assert(app._usageFilledProviderIconSvg(source, 'pie', 0).includes('<rect width="0" height="0"/>'));
        });
        await check('detail popup renders usage, accounts and costs', async () => {
            app._activeId = 'codex';
            app._render();
            app._indicator.menu.open();
            assert(app._content.get_n_children() > 0);
            assert(app._usage.get('codex').usage.costSummary.lines.length === 3);
            await this._screenshot('01-provider-details');
        });
        await check('multiple panel providers and logo-fill modes render', async () => {
            app._settings.set_int('panel-bar-count', 2);
            app._settings.set_int('panel-usage-bar-count', 2);
            app._settings.set_string('panel-components', 'logo,bar,percent,text');
            app._settings.set_string('provider-logo-fill-mode', 'pie');
            app._settings.set_string('display-mode', 'used');
            app._render();
            await this._screenshot('02-multiple-providers-used');
            app._settings.set_string('provider-logo-fill-mode', 'vertical');
            app._settings.set_string('display-mode', 'remaining');
            app._render();
            await this._screenshot('03-multiple-providers-remaining');
        });
        await check('backend failure is visible and a later refresh recovers', async () => {
            writeJson(GLib.getenv('USAGESTAT_FIXTURE_STATE'), {scenario: 'failure'});
            await app._refresh();
            assert(app._errors.get('codex').includes('Fixture backend failed'));
            await this._screenshot('04-backend-error');
            writeJson(GLib.getenv('USAGESTAT_FIXTURE_STATE'), {scenario: 'normal'});
            await app._refresh();
            equal(app._errors.size, 0);
            equal(app._usage.get('codex').usage.primary.usedPercent, 25);
        });
        await check('preferences window opens on the isolated desktop', async () => {
            app._indicator.menu.close();
            await app.openPreferences();
            await this._until(() => global.get_window_actors().some(actor =>
                actor.mapped && actor.visible && actor.width > 0 && actor.height > 0 &&
                actor.meta_window.get_title()?.includes('UsageStat')), 'mapped UsageStat preferences window', 30000);
            await delay(500);
            await this._screenshot('05-preferences');
            for (const actor of global.get_window_actors()) {
                if (actor.meta_window.get_title()?.includes('UsageStat'))
                    actor.meta_window.delete(global.get_current_time());
            }
        });
        await check('disable/re-enable preserves settings and restores the indicator', async () => {
            Main.extensionManager.disableExtension(UUID);
            await this._until(() => !this._app()?._indicator, 'extension disabled');
            Main.extensionManager.enableExtension(UUID);
            app = await this._ready();
            equal(app._settings.get_int('panel-bar-count'), 2);
            equal(app._settings.get_string('display-mode'), 'remaining');
            assert(Main.panel.statusArea[UUID] === app._indicator);
        });
        this._finish(results);
    }
}
