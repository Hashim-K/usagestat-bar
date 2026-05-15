import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const PROVIDERS = [
    ['codex', 'Codex'],
    ['claude', 'Claude'],
    ['cursor', 'Cursor'],
    ['opencode-go', 'OpenCode Go'],
    ['factory', 'Factory'],
    ['gemini', 'Gemini'],
    ['antigravity', 'Antigravity'],
    ['copilot', 'Copilot'],
    ['zai', 'z.ai'],
    ['minimax', 'MiniMax'],
    ['kimi', 'Kimi'],
    ['kilo', 'Kilo'],
    ['kiro', 'Kiro'],
    ['augment', 'Augment'],
    ['jetbrains-ai-assistant', 'JetBrains AI'],
    ['kimi-k2', 'Kimi K2'],
    ['amp', 'Amp'],
    ['ollama', 'Ollama'],
    ['synthetic', 'Synthetic'],
    ['warp', 'Warp'],
    ['openrouter', 'OpenRouter'],
    ['perplexity', 'Perplexity'],
    ['mistral', 'Mistral'],
    ['deepseek', 'DeepSeek'],
    ['codebuff', 'Codebuff'],
    ['crof', 'Crof'],
    ['doubao', 'Doubao'],
    ['nanogpt', 'NanoGPT'],
    ['openai-api', 'OpenAI API'],
    ['venice', 'Venice'],
    ['windsurf', 'Windsurf'],
];

export const PROVIDER_NAMES = Object.fromEntries(PROVIDERS);
const PROVIDER_IDS = new Set(PROVIDERS.map(([id]) => id));

export function configPath() {
    return GLib.build_filenamev([GLib.get_home_dir(), '.config', 'ai-usage', 'config.toml']);
}

export function defaultConfig() {
    return {
        refreshSec: 60,
        pluginDirs: [],
        providers: PROVIDERS.map(([id]) => ({
            id,
            enabled: id === 'codex',
        })),
    };
}

export function ensureProviderShape(config) {
    const next = (config && typeof config === 'object') ? {...config} : defaultConfig();
    next.refreshSec = Number.isInteger(next.refreshSec) && next.refreshSec > 0 ? next.refreshSec : 60;
    next.pluginDirs = Array.isArray(next.pluginDirs) ? next.pluginDirs.filter(item => typeof item === 'string' && item.trim()) : [];
    const existing = Array.isArray(next.providers) ? next.providers : [];
    const providers = [];
    const seenKeys = new Set();
    const seenBaseIds = new Set();

    for (const provider of existing) {
        if (!provider || typeof provider.id !== 'string' || !provider.id.trim())
            continue;

        const id = providerAlias(provider.id.trim());
        const nextProvider = {
            ...provider,
            id,
            enabled: provider.enabled !== false,
        };
        if (provider.workspaceID && !provider.workspaceId)
            nextProvider.workspaceId = provider.workspaceID;
        delete nextProvider.workspaceID;
        delete nextProvider.cookieSource;

        const key = providerKey(nextProvider);
        if (seenKeys.has(key))
            continue;

        providers.push(nextProvider);
        seenKeys.add(key);
        if (PROVIDER_IDS.has(id))
            seenBaseIds.add(id);
    }

    for (const [id] of PROVIDERS) {
        if (!seenBaseIds.has(id)) {
            providers.push({
                id,
                enabled: false,
            });
        }
    }

    next.providers = providers;
    return next;
}

export function loadConfig() {
    const file = Gio.File.new_for_path(configPath());
    try {
        const [ok, contents] = file.load_contents(null);
        if (!ok)
            return defaultConfig();
        return ensureProviderShape(parseConfigToml(new TextDecoder().decode(contents)));
    } catch (error) {
        logError(error, 'AI Usage Bar: failed to read ~/.config/ai-usage/config.toml');
        return defaultConfig();
    }
}

export function saveConfig(config) {
    const dir = Gio.File.new_for_path(GLib.path_get_dirname(configPath()));
    if (!dir.query_exists(null))
        dir.make_directory_with_parents(null);

    const normalized = ensureProviderShape(config);
    const bytes = new TextEncoder().encode(formatConfigToml(normalized));
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

export function providerBaseId(provider) {
    if (typeof provider === 'string')
        return providerAlias(provider);
    return providerAlias(provider?.id || '');
}

export function providerKey(provider) {
    if (typeof provider === 'string')
        return providerAlias(provider);
    return provider?.instanceId || providerAlias(provider?.id || '');
}

export function providerDisplayName(provider) {
    if (!provider || typeof provider === 'string')
        return PROVIDER_NAMES[providerAlias(provider)] || provider || 'AI';
    return provider.displayName || PROVIDER_NAMES[providerBaseId(provider)] || providerBaseId(provider) || 'AI';
}

export function makeProviderInstanceId(id) {
    return `${id}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function providerAlias(id) {
    return {
        opencodego: 'opencode-go',
        kimik2: 'kimi-k2',
        jetbrains: 'jetbrains-ai-assistant',
        'z-ai': 'zai',
    }[id] || id;
}

function parseConfigToml(text) {
    const config = {refreshSec: 60, pluginDirs: [], providers: []};
    let currentProvider = null;

    for (const rawLine of text.split('\n')) {
        const line = stripTomlComment(rawLine).trim();
        if (!line)
            continue;
        if (line === '[[providers]]') {
            currentProvider = {};
            config.providers.push(currentProvider);
            continue;
        }

        const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
        if (!match)
            continue;

        const [, key, rawValue] = match;
        const value = parseTomlValue(rawValue.trim());
        if (currentProvider)
            assignTomlKey(currentProvider, key, value);
        else if (key === 'refreshSec')
            config.refreshSec = Number(value);
        else if (key === 'pluginDirs' && Array.isArray(value))
            config.pluginDirs = value;
    }

    return config;
}

function stripTomlComment(line) {
    let quoted = false;
    let escaped = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = true;
            continue;
        }
        if (char === '"')
            quoted = !quoted;
        if (char === '#' && !quoted)
            return line.slice(0, i);
    }
    return line;
}

function assignTomlKey(target, key, value) {
    const parts = key.split('.');
    let current = target;
    for (const part of parts.slice(0, -1)) {
        if (!current[part] || typeof current[part] !== 'object')
            current[part] = {};
        current = current[part];
    }
    current[parts[parts.length - 1]] = value;
}

function parseTomlValue(value) {
    if (value === 'true')
        return true;
    if (value === 'false')
        return false;
    if (/^-?\d+(\.\d+)?$/.test(value))
        return Number(value);
    if (value.startsWith('"') && value.endsWith('"'))
        return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    if (value.startsWith('[') && value.endsWith(']')) {
        return value.slice(1, -1).split(',')
            .map(part => parseTomlValue(part.trim()))
            .filter(part => typeof part === 'string' && part);
    }
    return value;
}

function formatConfigToml(config) {
    const normalized = ensureProviderShape(config);
    const lines = [
        `refreshSec = ${normalized.refreshSec}`,
        '',
    ];

    if (normalized.pluginDirs.length) {
        lines.splice(1, 0, `pluginDirs = [${normalized.pluginDirs.map(quoteTomlString).join(', ')}]`);
        lines.splice(2, 0, '');
    }

    for (const provider of normalized.providers) {
        lines.push('[[providers]]');
        lines.push(`id = ${quoteTomlString(provider.id)}`);
        for (const key of ['instanceId', 'tabParent', 'displayName', 'source', 'customCommand', 'iconPath', 'apiKey', 'cookieHeader', 'region', 'workspaceId', 'loginUrl']) {
            if (provider[key] !== undefined && provider[key] !== null && String(provider[key]).trim())
                lines.push(`${key} = ${formatTomlValue(provider[key])}`);
        }
        lines.push(`enabled = ${provider.enabled !== false ? 'true' : 'false'}`);
        if (provider.settings && typeof provider.settings === 'object') {
            for (const key of Object.keys(provider.settings).sort()) {
                const value = provider.settings[key];
                if (value !== undefined && value !== null)
                    lines.push(`settings.${key} = ${formatTomlValue(value)}`);
            }
        }
        lines.push('');
    }

    return `${lines.join('\n').trimEnd()}\n`;
}

function quoteTomlString(value) {
    return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function formatTomlValue(value) {
    if (typeof value === 'boolean')
        return value ? 'true' : 'false';
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    if (Array.isArray(value))
        return `[${value.map(formatTomlValue).join(', ')}]`;
    return quoteTomlString(value);
}
