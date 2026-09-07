// Exercises the shared, real GTK widgets in a disposable settings/config profile.
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import {fillPreferencesWindow} from '../../preferences.js';
import {settings, ROOT} from '../../platforms/linux/settings.js';
import {loadConfig, providerKey} from '../../config.js';
import {assert, equal} from '../assert.js';

String.prototype.format ??= imports.format.format;
const out = GLib.getenv('USAGESTAT_UI_OUT');
if (!out || !GLib.getenv('USAGESTAT_UI_FIXTURE')) throw new Error('Disposable UI fixture environment required');
const prefs = settings();
const fixture = GLib.getenv('USAGESTAT_UI_FIXTURE');
const checks = [];
const app = new Adw.Application({application_id: 'io.github.HashimK.UsageStatPreferencesAcceptance'});
let failed = false;
const pause = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
async function wait(predicate) { for (let n = 0; n < 100; n++) { if (predicate()) return; await pause(100); } throw new Error('UI condition timed out'); }
function all(root) {
    const result = [root];
    for (let child = root.get_first_child?.(); child; child = child.get_next_sibling()) result.push(...all(child));
    return result;
}
function row(root, title) {
    const value = all(root).find(widget => widget instanceof Adw.PreferencesRow && widget.get_title() === title);
    assert(value, `Missing row: ${title}`); return value;
}
function click(root, title) {
    const button = all(title ? row(root, title) : root).find(w => w instanceof Gtk.Button && w.sensitive);
    assert(button, `Missing button: ${title}`); button.emit('clicked');
}
function entry(root, title, text) {
    const widget = all(row(root, title)).find(w => w instanceof Gtk.Entry || w instanceof Gtk.PasswordEntry);
    assert(widget, `Missing entry: ${title}`); widget.set_text(text);
}
function provider(page, key) {
    const value = all(page).find(w => w instanceof Gtk.ListBoxRow && w._providerKey === key);
    assert(value, `Missing provider ${key}`); return value;
}
function config() { return loadConfig(fixture).providers; }
function read(path) { return new TextDecoder().decode(Gio.File.new_for_path(path).load_contents(null)[1]); }
async function screenshot(name) {
    await pause(400);
    const argv = GLib.find_program_in_path('magick') ? ['magick', 'import'] : ['import'];
    const process = Gio.Subprocess.new([...argv, '-window', 'root', `${out}/${name}.png`], Gio.SubprocessFlags.NONE);
    process.wait_check(null);
}
async function check(name, action) {
    await action(); checks.push({name, passed: true}); print(`Passed: ${name}`);
}

app.connect('activate', () => {
    app.hold();
    (async () => {
        prefs.set_string('usagestat-cli-path', fixture);
        prefs.set_string('preferences-provider', 'claude');
        const window = new Adw.PreferencesWindow({application: app, title: 'UsageStat Preferences Acceptance'});
        fillPreferencesWindow(window, prefs, {desktopPlacement: true});
        window.present();
        const pages = all(window).filter(w => w instanceof Adw.PreferencesPage && w.title);
        const providers = pages.find(p => p.title === 'Providers');
        const appearance = pages.find(p => p.title === 'Appearance');
        const behaviour = pages.find(p => p.title === 'Behaviour');
        const tools = pages.find(p => p.title === 'Tools');
        await wait(() => providers._manifests.size === 2);
        await check('preferences icons resolve and remain symbolic for both themes', () => {
            const theme = Gtk.IconTheme.get_for_display(window.get_display());
            const names = new Set(all(window).filter(widget => widget instanceof Gtk.Image || widget instanceof Adw.PreferencesPage)
                .map(widget => widget.icon_name).filter(Boolean));
            // Include asynchronous success/error states that may not be visible yet.
            for (const match of read(`${ROOT}/preferences.js`).matchAll(/['"]([a-z0-9-]+-symbolic)['"]/g)) names.add(match[1]);
            assert(names.size > 10, 'Preferences icon inventory was empty');
            const missing = [...names].filter(name => !theme.has_icon(name));
            equal(missing, [], `Missing UI icons: ${missing.join(', ')}`);
            const uncolored = [...names].filter(name => !theme.lookup_icon(name, null, 16, 1, Gtk.TextDirection.LTR, Gtk.IconLookupFlags.FORCE_SYMBOLIC).is_symbolic());
            equal(uncolored, [], `Icons cannot follow light/dark colors: ${uncolored.join(', ')}`);
        });
        await check('all four preferences pages and provider navigation survive manifest loading', () => {
            equal(pages.map(p => p.title).sort(), ['Appearance', 'Behaviour', 'Providers', 'Tools']);
            assert(window.get_visible_page() === providers);
            assert(provider(providers, 'claude').get_child().expanded, 'Target provider collapsed after discovery');
        });
        await check('display mode and multi-window appearance controls persist', () => {
            window.set_visible_page(behaviour);
            const mode = all(behaviour).find(w => w instanceof Adw.ComboRow && w._values?.includes('remaining'));
            // Display-mode rows use separate labels and values; select Used.
            const display = mode || row(behaviour, 'Meter meaning');
            display.selected = 1;
            equal(prefs.get_string('display-mode'), 'used');
            window.set_visible_page(appearance);
            row(appearance, 'Usage bars per provider').adjustment.value = 3;
            equal(prefs.get_int('panel-usage-bar-count'), 3);
        });
        await check('create, rename and reorder an additional provider through widgets', () => {
            window.set_visible_page(providers);
            const add = all(providers).find(w => w instanceof Adw.ExpanderRow && w.title === 'Add Provider Source');
            add.expanded = true;
            entry(add, 'Name', 'Acceptance extra account');
            click(add, 'Create source');
            const added = config().find(p => p.displayName === 'Acceptance extra account');
            assert(added?.instanceId);
            entry(provider(providers, providerKey(added)), 'Name', 'Renamed extra account');
            assert(config().some(p => p.displayName === 'Renamed extra account'));
            const target = provider(providers, 'codex');
            const controllers = target.observe_controllers();
            const drop = Array.from({length: controllers.get_n_items()}, (_, i) => controllers.get_item(i)).find(c => c instanceof Gtk.DropTarget);
            assert(drop.emit('drop', providerKey(added), 0, 0));
            assert(config().findIndex(p => p.instanceId === added.instanceId) < config().findIndex(p => p.id === 'codex' && !p.instanceId));
            click(provider(providers, providerKey(added)), 'Delete source');
            assert(!config().some(p => p.instanceId === added.instanceId));
        });
        await check('create and remove a grouped API source, including a private credential field', () => {
            const before = new Set(config().map(providerKey));
            click(provider(providers, 'codex'), 'Add source to this tab');
            const child = config().find(p => !before.has(providerKey(p)));
            equal(child.tabParent, 'codex');
            const childRow = provider(providers, providerKey(child));
            const source = all(childRow).find(w => w instanceof Adw.ComboRow && w._values?.includes('api'));
            source.selected = source._values.indexOf('api');
            entry(childRow, 'API key', 'synthetic-acceptance-token');
            const saved = config().find(p => p.instanceId === child.instanceId);
            equal(saved.apiKey, 'synthetic-acceptance-token'); equal(saved.source, 'api');
            const configFile = Gio.File.new_for_path(`${GLib.get_user_config_dir()}/usagestat/config.toml`);
            equal(configFile.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null).get_attribute_uint32('unix::mode') & 0o777, 0o600);
            click(childRow, 'Delete from tab');
            assert(!config().some(p => p.instanceId === child.instanceId));
        });
        await check('custom command and icon flow persists and removes the source', () => {
            const add = all(providers).find(w => w instanceof Adw.ExpanderRow && w.title === 'Add Provider Source');
            const selector = row(add, 'Provider');
            selector.selected = selector.model.get_n_items() - 1;
            entry(add, 'Name', 'Acceptance custom');
            entry(add, 'CLI command', `${GLib.shell_quote(fixture)} --json usage --provider codex`);
            click(add, 'Create source');
            const custom = config().find(p => p.displayName === 'Acceptance custom');
            assert(custom.customCommand.includes('--provider codex'));
            const customRow = provider(providers, providerKey(custom));
            entry(customRow, 'Custom icon SVG', `${ROOT}/assets/provider-icons/codex.svg`);
            assert(config().find(p => p.instanceId === custom.instanceId).iconPath.endsWith('codex.svg'));
            click(customRow, 'Delete source');
            assert(!config().some(p => p.instanceId === custom.instanceId));
        });
        await check('hide and restore a provider without losing its identity', () => {
            click(provider(providers, 'claude'), 'Hide provider');
            assert(config().find(p => p.id === 'claude').hidden);
            const hidden = all(providers).find(w => w instanceof Adw.ActionRow && w.title === 'Claude' && w.subtitle === 'claude');
            click(hidden);
            assert(!config().find(p => p.id === 'claude').hidden);
            const enabled = all(provider(providers, 'claude')).find(w => w instanceof Gtk.Switch);
            enabled.active = true;
            assert(config().find(p => p.id === 'claude').enabled);
        });
        await check('Tools opens the real desktop URL handler and runs the backend in XTerm', async () => {
            window.set_visible_page(tools);
            const handler = Gio.AppInfo.create_from_commandline(`python3 ${GLib.shell_quote(`${ROOT}/tests/linux/record-link.py`)} %u`,
                'UsageStat acceptance URL handler', Gio.AppInfoCreateFlags.SUPPORTS_URIS);
            handler.set_as_default_for_type('x-scheme-handler/https');
            click(tools, 'usagestat docs');
            await wait(() => Gio.File.new_for_path(`${out}/opened-links.jsonl`).query_exists(null));
            assert(read(`${out}/opened-links.jsonl`).includes('https://github.com/hashim-k/usagestat'));
            const terminal = row(tools, 'Open tools with');
            assert(terminal._values.includes('XTerm'));
            terminal.selected = terminal._values.indexOf('XTerm');
            const commandLog = GLib.getenv('USAGESTAT_UI_COMMAND_LOG');
            const calls = () => read(commandLog).trim().split('\n').map(line => JSON.parse(line))
                .filter(entry => entry.command === 'usage' && !entry.options['--provider']).length;
            const before = calls();
            click(tools, 'Show enabled usage');
            await wait(() => calls() > before);
            await pause(300);
            const process = Gio.Subprocess.new(['xdotool', 'search', '--onlyvisible', '--class', 'XTerm'], Gio.SubprocessFlags.STDOUT_PIPE);
            const id = process.communicate_utf8(null, null)[1].trim().split('\n')[0];
            assert(id, 'XTerm did not map');
            Gio.Subprocess.new(['xdotool', 'windowactivate', '--sync', id, 'key', 'Return'], Gio.SubprocessFlags.NONE).wait_check(null);
            window.present();
        });
        for (const dark of [false, true]) {
            Adw.StyleManager.get_default().color_scheme = dark ? Adw.ColorScheme.FORCE_DARK : Adw.ColorScheme.FORCE_LIGHT;
            for (const page of pages) {
                window.set_visible_page(page);
                await screenshot(`prefs-${page.title.toLowerCase()}-${dark ? 'dark' : 'light'}`);
            }
        }
        await check('every page renders under light and dark application themes', () => {});
        window.close();
        await check('closing preferences disconnects persistent settings and theme listeners', async () => {
            await pause(200);
            assert(pages.every(page => page._closed && page._externalSignals.length === 0));
            prefs.set_int('panel-bar-count', 2);
            prefs.set_string('provider-icon-style', 'color');
            Adw.StyleManager.get_default().color_scheme = Adw.ColorScheme.FORCE_LIGHT;
            await pause(200);
        });
        await check('closing during source validation terminates its running backend processes', async () => {
            const fixtureState = Gio.File.new_for_path(GLib.getenv('USAGESTAT_UI_STATE'));
            fixtureState.replace_contents('{"scenario":"hang"}', null, false, Gio.FileCreateFlags.PRIVATE, null);
            let pending;
            try {
                pending = new Adw.PreferencesWindow({application: app, title: 'Pending source validation'});
                fillPreferencesWindow(pending, prefs, {desktopPlacement: true});
                pending.present();
                const pendingPages = all(pending).filter(w => w instanceof Adw.PreferencesPage && w.title);
                const processes = pendingPages.flatMap(page => [...(page._processes || [])]);
                await pause(300);
                const pids = processes.map(process => process.get_identifier()).filter(Boolean);
                assert(pids.length >= 3, 'No in-flight validations to cancel');
                pending.close(); pending = null;
                await wait(() => pids.every(pid => !Gio.File.new_for_path(`/proc/${pid}`).query_exists(null)));
            } finally {
                pending?.close();
                fixtureState.replace_contents('{"scenario":"normal"}', null, false, Gio.FileCreateFlags.PRIVATE, null);
            }
        });
    })().catch(error => {
        failed = true;
        checks.push({name: 'UI acceptance failure', passed: false, error: error.message, stack: error.stack});
        printerr(`${error.message}\n${error.stack}`);
    }).finally(() => {
        Gio.File.new_for_path(`${out}/preferences.json`).replace_contents(JSON.stringify({checks, passed: !failed}, null, 2), null, false, Gio.FileCreateFlags.PRIVATE, null);
        app.quit();
    });
});
app.run([]);
System.exit(failed ? 1 : 0);
