import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {providerBaseId} from './config.js';

const COMMAND_TIMEOUT_SECONDS = 90;

export function findAiUsage() {
    const paths = [
        GLib.getenv('USAGESTAT_CLI'),
        `${GLib.get_home_dir()}/.local/bin/usagestat`,
        '/home/linuxbrew/.linuxbrew/bin/usagestat',
        `${GLib.get_home_dir()}/.linuxbrew/bin/usagestat`,
        '/opt/homebrew/bin/usagestat',
        '/usr/local/bin/usagestat',
        '/usr/bin/usagestat',
    ].filter(Boolean);

    for (const path of paths) {
        if (GLib.file_test(path, GLib.FileTest.IS_EXECUTABLE))
            return path;
    }

    try {
        const proc = Gio.Subprocess.new(
            ['bash', '-lc', 'command -v usagestat'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        );
        const [, stdout] = proc.communicate_utf8(null, null);
        const found = stdout.trim();
        if (found)
            return found;
    } catch {
        // Ignore PATH probe failures.
    }

    return null;
}

function runAsync(argv, cancellable) {
    return new Promise((resolve, reject) => {
        const proc = Gio.Subprocess.new(
            argv,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        );

        const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, COMMAND_TIMEOUT_SECONDS, () => {
            try {
                proc.force_exit();
            } catch {
                // Process may have already exited.
            }
            return GLib.SOURCE_REMOVE;
        });

        proc.communicate_utf8_async(null, cancellable, (process, result) => {
            if (timeoutId)
                GLib.source_remove(timeoutId);

            try {
                const [, stdout, stderr] = process.communicate_utf8_finish(result);
                resolve({
                    stdout: stdout || '',
                    stderr: stderr || '',
                    status: process.get_exit_status(),
                });
            } catch (error) {
                reject(error);
            }
        });
    });
}

export async function fetchProviderUsage(provider, cancellable) {
    const providerId = providerBaseId(provider);
    if (provider?.customCommand || provider?.custom === true || provider?.source === 'custom')
        return fetchCustomCommandUsage(provider, cancellable);

    const binary = findAiUsage();
    if (!binary)
        throw new Error('usagestat CLI was not found on PATH or in common install locations.');

    const argv = [
        binary,
        '--json',
        'usage',
        '--provider',
        providerId,
    ];
    if (provider?.source && provider.source !== 'auto')
        argv.push('--source', provider.source);

    const result = await runAsync(argv, cancellable);

    const stdout = result.stdout.trim();
    if (!stdout) {
        const detail = result.stderr.trim().split('\n')[0] || `usagestat exited with status ${result.status}`;
        throw new Error(detail);
    }

    const payload = parseUsageJson(stdout, 'usagestat');
    if (payload?.error) {
        const message = payload.error.message || payload.error.code || JSON.stringify(payload.error);
        throw new Error(message);
    }
    return normalizeBackendSnapshot(payload, providerId);
}

async function fetchCustomCommandUsage(provider, cancellable) {
    const command = provider.customCommand?.trim() || '';
    if (!command)
        throw new Error('Custom provider command is empty.');

    const result = await runAsync(['bash', '-lc', command], cancellable);
    const stdout = result.stdout.trim();
    if (!stdout) {
        const detail = result.stderr.trim().split('\n')[0] || `custom command exited with status ${result.status}`;
        throw new Error(detail);
    }

    const payload = parseUsageJson(stdout, 'custom command');
    if (payload?.error) {
        const message = payload.error.message || payload.error.code || JSON.stringify(payload.error);
        throw new Error(message);
    }
    return payload;
}

function parseUsageJson(stdout, sourceName) {
    try {
        const parsed = JSON.parse(stdout);
        return Array.isArray(parsed) ? parsed[0] : parsed;
    } catch (error) {
        if (error instanceof SyntaxError)
            throw new Error(`Could not parse ${sourceName} JSON: ${error.message}`);
        throw error;
    }
}

function normalizeBackendSnapshot(snapshot, fallbackProviderId) {
    if (!Array.isArray(snapshot?.metrics))
        return snapshot;

    const progress = [];
    const extraTextLines = [];
    const badges = [];

    for (const metric of snapshot.metrics) {
        if (metric?.type === 'progress') {
            const used = Number(metric.used) || 0;
            const limit = Number(metric.limit) || 0;
            if (limit <= 0)
                continue;
            progress.push({
                id: metric.label || `metric-${progress.length + 1}`,
                title: metric.label || null,
                window: {
                    label: metric.label || null,
                    usedPercent: Math.max(0, Math.min(100, used / limit * 100)),
                    used,
                    limit,
                    format: metric.format || null,
                    resetsAt: metric.resetsAt || null,
                    windowMinutes: metric.periodDurationMs ? Math.round(Number(metric.periodDurationMs) / 60000) : undefined,
                },
            });
        } else if (metric?.type === 'text') {
            extraTextLines.push({
                label: metric.label || '',
                value: metric.value || '',
                subtitle: metric.subtitle || '',
            });
        } else if (metric?.type === 'badge') {
            badges.push({
                label: metric.label || '',
                text: metric.text || '',
                subtitle: metric.subtitle || '',
                color: metric.color || '',
            });
        }
    }

    const usage = {
        updatedAt: snapshot.fetchedAt || new Date().toISOString(),
        plan: snapshot.plan || null,
        extraTextLines,
        badges,
        extraRateWindows: [],
    };

    for (const [index, tier] of ['primary', 'secondary', 'tertiary', 'quaternary'].entries()) {
        if (progress[index])
            usage[tier] = progress[index].window;
    }
    for (const item of progress.slice(4))
        usage.extraRateWindows.push(item);

    return {
        provider: snapshot.providerId || fallbackProviderId,
        displayName: snapshot.displayName || null,
        source: snapshot.source || null,
        plan: snapshot.plan || null,
        usage,
        rawMetrics: snapshot.metrics,
        pace: snapshot.pace || null,
        statusPageUrl: snapshot.statusPageUrl || null,
    };
}
