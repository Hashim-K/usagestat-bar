import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import {assert, equal, rejects} from './assert.js';
import {fetchProviderManifests, fetchProviderUsage, findAiUsage, normalizeBackendSnapshot,
    normalizeCostSummary, parseUsageJson, runAsync} from '../cli.js';
import {configPath, defaultConfig, enabledProviders, ensureProviderShape, formatConfigToml,
    loadConfig, parseConfigToml, providerBaseId, providerDisplayName, providerKey, saveConfig} from '../config.js';

const root = GLib.path_get_dirname(GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]));
const fixture = `${root}/tests/fixtures/usagestat`;
const tests = [];
const test = (name, callback) => tests.push({name, callback});
const read = path => new TextDecoder().decode(Gio.File.new_for_path(path).load_contents(null)[1]);
const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));
const usage = (provider = {id: 'codex'}, options = {}) => fetchProviderUsage(provider, null, {cliPath: fixture, ...options});

test('fixture backend is executable and missing explicit paths do not fall back', () => {
    equal(findAiUsage(fixture), fixture);
    equal(findAiUsage('/does-not-exist/usagestat'), null);
});
test('manifest discovery uses the actual subprocess adapter', async () => {
    const manifests = await fetchProviderManifests(null, {cliPath: fixture});
    equal(manifests.map(p => p.id), ['codex', 'claude']);
});
test('normal usage preserves quota units, windows, reset time and provider metadata', async () => {
    const snapshot = await usage();
    equal(snapshot.provider, 'codex');
    equal(snapshot.usage.primary, {label: 'Session', usedPercent: 25, used: 25, limit: 100,
        format: null, resetsAt: '2099-01-15T17:00:00Z', windowMinutes: 300});
    equal(snapshot.usage.secondary.usedPercent, 80);
    equal(snapshot.usage.secondary.windowMinutes, 10080);
    equal(snapshot.usage.updatedAt, '2026-01-15T12:00:00Z');
    equal(snapshot.dashboardUrl, 'https://example.invalid/usage');
    equal(snapshot.usage.extraTextLines, [{label: 'Account', value: 'Fixture account', subtitle: ''}]);
    equal(snapshot.usage.badges[0].text, 'Fixture');
});
test('cost is presented once, with today/yesterday/period totals', async () => {
    const summary = (await usage()).usage.costSummary;
    equal(summary.currency, 'USD');
    equal(summary.lines, [
        {label: 'Today', cost: 2.5, tokens: 2000, currency: 'USD'},
        {label: 'Yesterday', cost: 1.25, tokens: 1000, currency: 'USD'},
        {label: 'Last 30 Days', cost: 12.5, tokens: 10000, currency: 'USD'},
    ]);
});
for (const [scenario, expected] of [['zero', 0], ['warning', 75], ['danger', 90], ['full', 100]]) {
    test(`${scenario} scenario preserves exact quota boundary`, async () => {
        GLib.setenv('USAGESTAT_FIXTURE_SCENARIO', scenario, true);
        equal((await usage()).usage.primary.usedPercent, expected);
    });
}
test('out-of-range metrics clamp display percentage but preserve raw units', async () => {
    GLib.setenv('USAGESTAT_FIXTURE_SCENARIO', 'over-limit', true);
    const snapshot = await usage();
    equal(snapshot.usage.primary.usedPercent, 100);
    equal(snapshot.usage.primary.used, 125);
    equal(snapshot.usage.secondary.usedPercent, 0);
});
test('more than four quota windows remain available in order', async () => {
    GLib.setenv('USAGESTAT_FIXTURE_SCENARIO', 'many-windows', true);
    const {usage: result} = await usage();
    equal(result.tertiary.label, 'Extra 1');
    equal(result.quaternary.label, 'Extra 2');
    equal(result.extraRateWindows.map(w => [w.id, w.window.usedPercent]), [['Extra 3', 30], ['Extra 4', 40]]);
});
test('missing optional fields and unusable limits do not hide valid metrics', async () => {
    GLib.setenv('USAGESTAT_FIXTURE_SCENARIO', 'missing-fields', true);
    const snapshot = await usage();
    equal(snapshot.provider, 'codex');
    equal(snapshot.usage.primary.usedPercent, 20);
    equal(snapshot.usage.secondary, undefined);
});
for (const scenario of ['legacy', 'array']) {
    test(`${scenario} usage payload stays compatible`, async () => {
        GLib.setenv('USAGESTAT_FIXTURE_SCENARIO', scenario, true);
        equal((await usage()).usage.primary.usedPercent, 25);
    });
}
for (const scenario of ['no-cost', 'cost-failure']) {
    test(`${scenario} keeps quota available when cost is unavailable`, async () => {
        GLib.setenv('USAGESTAT_FIXTURE_SCENARIO', scenario, true);
        const snapshot = await usage();
        equal(snapshot.usage.primary.usedPercent, 25);
        equal(snapshot.usage.costSummary, undefined);
    });
}
test('empty cost summaries are absent and token-only totals still count', () => {
    equal(normalizeCostSummary({totals: {}, daily: []}), null);
    equal(normalizeCostSummary({totals: {totalTokens: 20}}).lines[2].tokens, 20);
});
for (const [scenario, pattern] of [
    ['empty', /exited with status 0/], ['malformed', /Could not parse usagestat JSON/],
    ['failure', /Fixture backend failed/], ['api-error', /Fixture account needs setup/],
]) {
    test(`${scenario} reports an actionable error and the next refresh recovers`, async () => {
        GLib.setenv('USAGESTAT_FIXTURE_SCENARIO', scenario, true);
        await rejects(() => usage(), pattern);
        GLib.setenv('USAGESTAT_FIXTURE_SCENARIO', 'normal', true);
        equal((await usage()).usage.primary.usedPercent, 25);
    });
}
test('an empty manifest list is supported', async () => {
    GLib.setenv('USAGESTAT_FIXTURE_SCENARIO', 'empty', true);
    equal(await fetchProviderManifests(null, {cliPath: fixture}), []);
});
test('source, alias, config and plugin paths are passed as separate arguments', async () => {
    await usage({id: 'opencodego', source: 'api'}, {configFile: '/tmp/config with spaces.toml', pluginDir: '/tmp/plugin dir'});
    const calls = read(GLib.getenv('USAGESTAT_FIXTURE_LOG')).trim().split('\n').map(JSON.parse);
    const call = calls.filter(c => c.command === 'usage').at(-1);
    equal(call.options, {'--config': '/tmp/config with spaces.toml', '--plugin-dir': '/tmp/plugin dir',
        '--provider': 'opencode-go', '--source': 'api'});
});
test('custom commands use the legacy payload contract', async () => {
    GLib.setenv('USAGESTAT_FIXTURE_SCENARIO', 'legacy', true);
    const result = await usage({id: 'custom-fixture', source: 'custom',
        customCommand: `${GLib.shell_quote(fixture)} --json usage --provider fixture`});
    equal(result.provider, 'fixture');
    equal(result.usage.primary.usedPercent, 25);
});
test('an empty custom command reports a configuration error', async () => {
    await rejects(() => usage({id: 'custom-fixture', custom: true}), /command is empty/);
});
test('JSON parse errors retain their source name', async () => {
    await rejects(() => parseUsageJson('{bad', 'custom command'), /Could not parse custom command JSON/);
});
test('legacy snapshots pass through without dropping extra provider fields', () => {
    const snapshot = {provider: 'fixture', usage: {primary: {usedPercent: 13}}, extra: 'preserved'};
    equal(normalizeBackendSnapshot(snapshot, 'fallback'), snapshot);
});
test('config uses the isolated XDG directory, including the dev backend variant', () => {
    equal(configPath(), `${GLib.getenv('XDG_CONFIG_HOME')}/usagestat/config.toml`);
    equal(configPath('/tmp/usagestat-dev'), `${GLib.getenv('XDG_CONFIG_HOME')}/usagestat-dev/config.toml`);
});
test('provider normalization preserves order, groups and distinct source instances', () => {
    const config = ensureProviderShape({providers: [
        {id: 'claude', enabled: true}, {id: 'opencodego'},
        {id: 'claude', instanceId: 'work', tabParent: 'claude', source: 'api', workspaceID: 'test'},
        {id: 'claude'}, {id: 'mock'},
    ]});
    equal(enabledProviders(config).map(providerKey), ['claude', 'opencode-go', 'work']);
    equal(config.providers[2].workspaceId, 'test');
    equal(providerBaseId(config.providers[2]), 'claude');
    equal(providerDisplayName({...config.providers[2], displayName: 'Work'}), 'Work');
    assert(!config.providers.some(p => p.id === 'mock'));
});
test('new built-in providers are disabled and default config enables only Codex', () => {
    equal(enabledProviders(defaultConfig()).map(providerKey), ['codex']);
    equal(enabledProviders({providers: []}), []);
});
test('config round-trip retains quoted commands, credentials and source settings', () => {
    const config = {refreshSec: 12, pluginDirs: ['/tmp/plugins'], providers: [{
        id: 'fixture', instanceId: 'work', tabParent: 'claude', displayName: 'A "quoted" # name',
        source: 'custom', customCommand: 'printf "hello\\world"\nprintf "next"',
        apiKey: 'fake-test-token', cookieHeader: 'fake=test', enabled: true,
        settings: {region: 'test', count: 2, enabled: false},
    }]};
    const loaded = ensureProviderShape(parseConfigToml(formatConfigToml(config)));
    equal(loaded, ensureProviderShape(config));
});
test('quoted commas and typed arrays survive a configuration round-trip', () => {
    const config = {pluginDirs: ['/tmp/plugin, one', '/tmp/two'], providers: [{id: 'fixture',
        settings: {values: ['a,b', 'c'], numbers: [1, 2], switches: [true, false]}}]};
    equal(ensureProviderShape(parseConfigToml(formatConfigToml(config))), ensureProviderShape(config));
});
test('saved configuration is private immediately and reloads without losing groups', () => {
    const config = parseConfigToml(read(`${root}/tests/fixtures/config.toml`));
    saveConfig(config);
    const info = Gio.File.new_for_path(configPath()).query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null);
    equal(info.get_attribute_uint32('unix::mode') & 0o777, 0o600);
    equal(enabledProviders(loadConfig()).map(providerKey), ['codex', 'claude', 'codex:fixture-work']);
});
test('subprocess timeout rejects promptly and terminates the fixture process', async () => {
    GLib.setenv('USAGESTAT_FIXTURE_SCENARIO', 'hang', true);
    const before = read(GLib.getenv('USAGESTAT_FIXTURE_LOG')).trim().split('\n').length;
    const start = GLib.get_monotonic_time();
    await rejects(() => runAsync([fixture, '--json', 'usage'], null, 1000), /timed out/);
    assert((GLib.get_monotonic_time() - start) / 1000 < 5000, 'Timeout was not bounded');
    const calls = read(GLib.getenv('USAGESTAT_FIXTURE_LOG')).trim().split('\n').map(JSON.parse);
    equal(calls.length, before + 1, 'Fixture must have started before timeout');
    equal(calls.at(-1).scenario, 'hang');
    await delay(50);
    assert(!Gio.File.new_for_path(`/proc/${calls.at(-1).pid}`).query_exists(null), 'Timed-out process is still running');
});
test('cancellation terminates a running command and the adapter can run again', async () => {
    GLib.setenv('USAGESTAT_FIXTURE_SCENARIO', 'hang', true);
    const before = read(GLib.getenv('USAGESTAT_FIXTURE_LOG')).trim().split('\n').length;
    const cancellable = new Gio.Cancellable();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        cancellable.cancel();
        return GLib.SOURCE_REMOVE;
    });
    await rejects(() => runAsync([fixture, '--json', 'usage'], cancellable), /cancel/i);
    const calls = read(GLib.getenv('USAGESTAT_FIXTURE_LOG')).trim().split('\n').map(JSON.parse);
    equal(calls.length, before + 1, 'Fixture must have started before cancellation');
    equal(calls.at(-1).scenario, 'hang');
    await delay(50);
    assert(!Gio.File.new_for_path(`/proc/${calls.at(-1).pid}`).query_exists(null), 'Cancelled process is still running');
    GLib.setenv('USAGESTAT_FIXTURE_SCENARIO', 'normal', true);
    equal((await usage()).usage.primary.usedPercent, 25);
});
test('an already-cancelled operation does not spawn the command', async () => {
    const before = read(GLib.getenv('USAGESTAT_FIXTURE_LOG'));
    const cancellable = new Gio.Cancellable();
    cancellable.cancel();
    await rejects(() => runAsync([fixture, '--json', 'usage'], cancellable), /cancel/i);
    equal(read(GLib.getenv('USAGESTAT_FIXTURE_LOG')), before);
});
test('a signalled process reports its signal status without a GLib assertion', async () => {
    const result = await runAsync([GLib.find_program_in_path('python3'), '-c',
        'import os, signal; os.kill(os.getpid(), signal.SIGTERM)'], null);
    equal(result.status, 143);
});

const loop = new GLib.MainLoop(null, false);
let failures = 0;
async function run() {
    print(`1..${tests.length}`);
    for (const [index, {name, callback}] of tests.entries()) {
        GLib.setenv('USAGESTAT_FIXTURE_SCENARIO', 'normal', true);
        try {
            await callback();
            print(`ok ${index + 1} - ${name}`);
        } catch (error) {
            failures++;
            print(`not ok ${index + 1} - ${name}`);
            printerr(`${error.message}\n${error.stack || ''}`);
        }
    }
    print(`# ${tests.length - failures} passed, ${failures} failed`);
}
run().catch(error => { failures++; printerr(error.stack); }).finally(() => loop.quit());
loop.run();
System.exit(failures ? 1 : 0);
