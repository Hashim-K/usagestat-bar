// Explicit, opt-in live account smoke check. Never writes credentials or usage values to the report.
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import {settings} from '../../platforms/linux/settings.js';
import {Model} from '../../platforms/linux/model.js';
import {renderFiles} from '../../platforms/linux/render.js';
import {DetailsWindow} from '../../platforms/linux/ui.js';

if (GLib.getenv('USAGESTAT_LIVE_CHECK') !== 'yes' || GLib.getenv('GSETTINGS_BACKEND') !== 'memory')
    throw new Error('Use live.sh for an explicitly requested live account check.');
const wanted = new Set((GLib.getenv('USAGESTAT_LIVE_PROVIDERS') || 'codex,claude').split(','));
class LiveModel extends Model {
    reload() { super.reload(); this.providers = this.providers.filter(p => wanted.has(p.id) && !p.tabParent); }
}
const prefs = settings();
prefs.set_string('usagestat-cli-path', ARGV[0]);
prefs.set_int('refresh-interval', 0);
let failed = false, model;
const report = {backendVersion: '', checks: []};
const app = new Adw.Application({application_id: 'io.github.HashimK.UsageStatLiveAcceptance'});
app.connect('activate', () => {
    app.hold();
    (async () => {
        const process = Gio.Subprocess.new([ARGV[0], '--version'], Gio.SubprocessFlags.STDOUT_PIPE);
        report.backendVersion = process.communicate_utf8(null, null)[1].trim();
        model = new LiveModel(prefs);
        await model.refresh();
        const state = renderFiles(model.snapshot());
        const details = new DetailsWindow(app, model, () => {});
        details.update(state); details.window.present();
        await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => { resolve(); return GLib.SOURCE_REMOVE; }));
        for (const provider of state.providers) {
            model.select(provider.key);
            details.update({...state, active: provider.key});
            report.checks.push({provider: provider.id, backendResponded: !provider.error,
                quotaAvailable: provider.windows.length > 0, detailsRealized: details.window.get_realized() && details.window.get_mapped(),
                passed: !provider.error && provider.windows.length > 0 && details.window.get_realized() && details.window.get_mapped()});
        }
        failed = !report.checks.length || report.checks.some(check => !check.passed);
    })().catch(() => { failed = true; report.checks.push({passed: false, error: 'Live check failed; private backend diagnostics were not recorded.'}); })
        .finally(() => { model?.close(); app.quit(); });
});
app.run([]);
report.passed = !failed;
print(JSON.stringify(report, null, 2));
System.exit(failed ? 1 : 0);
