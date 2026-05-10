import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const PROVIDERS = [
    ['codex', 'Codex'],
    ['claude', 'Claude'],
    ['cursor', 'Cursor'],
    ['opencode', 'OpenCode'],
    ['opencodego', 'OpenCode Go'],
    ['alibaba', 'Alibaba Coding Plan'],
    ['factory', 'Factory'],
    ['gemini', 'Gemini'],
    ['antigravity', 'Antigravity'],
    ['copilot', 'Copilot'],
    ['zai', 'z.ai'],
    ['minimax', 'MiniMax'],
    ['kimi', 'Kimi'],
    ['kilo', 'Kilo'],
    ['kiro', 'Kiro'],
    ['vertexai', 'Vertex AI'],
    ['augment', 'Augment'],
    ['jetbrains', 'JetBrains AI'],
    ['kimik2', 'Kimi K2'],
    ['amp', 'Amp'],
    ['ollama', 'Ollama'],
    ['synthetic', 'Synthetic'],
    ['warp', 'Warp'],
    ['openrouter', 'OpenRouter'],
    ['perplexity', 'Perplexity'],
    ['abacus', 'Abacus'],
    ['mistral', 'Mistral'],
    ['deepseek', 'DeepSeek'],
    ['codebuff', 'Codebuff'],
];

export const PROVIDER_NAMES = Object.fromEntries(PROVIDERS);

export function configPath() {
    return GLib.build_filenamev([GLib.get_home_dir(), '.codexbar', 'config.json']);
}

export function defaultConfig() {
    return {
        version: 1,
        providers: PROVIDERS.map(([id]) => ({
            id,
            enabled: id === 'codex',
            source: 'auto',
            cookieSource: 'auto',
        })),
    };
}

export function ensureProviderShape(config) {
    const next = (config && typeof config === 'object') ? {...config} : defaultConfig();
    next.version = Number.isInteger(next.version) ? next.version : 1;
    const existing = Array.isArray(next.providers) ? next.providers : [];
    const byId = new Map();

    for (const provider of existing) {
        if (provider && typeof provider.id === 'string' && provider.id.trim())
            byId.set(provider.id, {...provider});
    }

    for (const [id] of PROVIDERS) {
        if (!byId.has(id)) {
            byId.set(id, {
                id,
                enabled: false,
                source: 'auto',
                cookieSource: 'auto',
            });
        }
    }

    next.providers = [...byId.values()];
    return next;
}

export function loadConfig() {
    const file = Gio.File.new_for_path(configPath());
    try {
        const [ok, contents] = file.load_contents(null);
        if (!ok)
            return defaultConfig();
        return ensureProviderShape(JSON.parse(new TextDecoder().decode(contents)));
    } catch (error) {
        logError(error, 'AI Usage Bar: failed to read ~/.codexbar/config.json');
        return defaultConfig();
    }
}

export function saveConfig(config) {
    const dir = Gio.File.new_for_path(GLib.path_get_dirname(configPath()));
    if (!dir.query_exists(null))
        dir.make_directory_with_parents(null);

    const normalized = ensureProviderShape(config);
    const bytes = new TextEncoder().encode(`${JSON.stringify(normalized, null, 2)}\n`);
    Gio.File.new_for_path(configPath()).replace_contents(
        bytes,
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null,
    );

    try {
        Gio.Subprocess.new(['chmod', '600', configPath()], Gio.SubprocessFlags.NONE);
    } catch (error) {
        logError(error, 'AI Usage Bar: failed to chmod config');
    }
}

export function enabledProviders(config) {
    return ensureProviderShape(config).providers.filter(provider => provider.enabled !== false);
}

