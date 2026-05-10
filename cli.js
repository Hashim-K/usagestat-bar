import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {UsageApiClient} from './usageApi.js';
import {loadLegacyToken} from './secret.js';

const COMMAND_TIMEOUT_SECONDS = 90;

export function findCodexbar() {
    const paths = [
        GLib.getenv('CODEXBAR_CLI'),
        '/home/linuxbrew/.linuxbrew/bin/codexbar',
        `${GLib.get_home_dir()}/.linuxbrew/bin/codexbar`,
        `${GLib.get_home_dir()}/.local/bin/codexbar`,
        '/opt/homebrew/bin/codexbar',
        '/usr/local/bin/codexbar',
        '/usr/bin/codexbar',
    ].filter(Boolean);

    for (const path of paths) {
        if (GLib.file_test(path, GLib.FileTest.IS_EXECUTABLE))
            return path;
    }

    try {
        const proc = Gio.Subprocess.new(
            ['bash', '-lc', 'command -v codexbar'],
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
    const providerId = typeof provider === 'string' ? provider : provider.id;
    const binary = findCodexbar();
    if (!binary)
        throw new Error('codexbar CLI was not found on PATH or in common install locations.');

    const result = await runAsync([
        binary,
        'usage',
        '--provider',
        providerId,
        '--format',
        'json',
        '--json-only',
    ], cancellable);

    const stdout = result.stdout.trim();
    if (!stdout) {
        const detail = result.stderr.trim().split('\n')[0] || `codexbar exited with status ${result.status}`;
        throw new Error(detail);
    }

    try {
        const parsed = JSON.parse(stdout);
        const payload = Array.isArray(parsed) ? parsed[0] : parsed;
        if (payload?.error) {
            const message = payload.error.message || payload.error.code || JSON.stringify(payload.error);
            if (providerId === 'codex' && message.includes('web support'))
                return fetchCodexDirect(provider, cancellable);
            throw new Error(message);
        }
        return payload;
    } catch (error) {
        if (error instanceof SyntaxError)
            throw new Error(`Could not parse codexbar JSON: ${error.message}`);
        throw error;
    }
}

async function fetchCodexDirect(provider, cancellable) {
    const cookieHeader = provider?.cookieHeader || loadLegacyToken('codex') || '';
    if (!cookieHeader)
        throw new Error('Codex web is macOS-only in the CLI. Paste a ChatGPT Cookie header in Preferences -> Providers -> Codex, or import/save one in the old CodexBar GNOME settings, to use the Linux direct API fallback.');

    const client = new UsageApiClient();
    try {
        return await client.fetchSummary(cookieHeader, cancellable);
    } finally {
        client.destroy();
    }
}
