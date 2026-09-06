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
const DEPRECATED_PROVIDER_IDS = new Set(["mock"]);
export const DEFAULT_HIDDEN_IDS = new Set(["synthetic", "smoke"]);

export function configPath(binary = '') {
    const binaryName = binary ? GLib.path_get_basename(binary) : '';
    const configDir = binaryName.includes('usagestat-dev') ? 'usagestat-dev' : 'usagestat';
    return GLib.build_filenamev([GLib.get_user_config_dir(), configDir, 'config.toml']);
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
        if (DEPRECATED_PROVIDER_IDS.has(id))
            continue;

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
                ...(DEFAULT_HIDDEN_IDS.has(id) ? {hidden: true} : {}),
            });
        }
    }

    next.providers = providers;
    return next;
}

export function loadConfig(binary = '') {
    const path = configPath(binary);
    const file = Gio.File.new_for_path(path);
    try {
        const [ok, contents] = file.load_contents(null);
        if (!ok)
            return initializeConfig(path, binary);
        return ensureProviderShape(parseConfigToml(new TextDecoder().decode(contents)));
    } catch (error) {
        if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            return initializeConfig(path, binary);
        logError(error, `UsageStat Bar: failed to read ${path}`);
        return defaultConfig();
    }
}

export function saveConfig(config, binary = '') {
    writeConfig(config, configPath(binary));
}

function initializeConfig(path, binary = '') {
    const stablePath = configPath('');
    let config = defaultConfig();
    if (path !== stablePath) {
        try {
            const [ok, contents] = Gio.File.new_for_path(stablePath).load_contents(null);
            if (ok)
                config = ensureProviderShape(parseConfigToml(new TextDecoder().decode(contents)));
        } catch {
            config = defaultConfig();
        }
    }
    writeConfig(config, path);
    return config;
}

function writeConfig(config, path) {
    const dir = Gio.File.new_for_path(GLib.path_get_dirname(path));
    if (!dir.query_exists(null))
        dir.make_directory_with_parents(null);

    const normalized = ensureProviderShape(config);
    const bytes = new TextEncoder().encode(formatConfigToml(normalized));
    Gio.File.new_for_path(path).replace_contents(
        bytes,
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE,
        null,
    );
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

export function parseConfigToml(text) {
    const config = {refreshSec: 60, pluginDirs: [], providers: []};
    let currentProvider = null;

    for (const rawLine of logicalTomlLines(text)) {
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

function logicalTomlLines(text) {
    const lines = [];
    let pending = null;

    for (const rawLine of text.split('\n')) {
        if (pending !== null) {
            pending += `\n${rawLine}`;
            if (tomlQuotedValueClosed(pending)) {
                lines.push(pending);
                pending = null;
            }
            continue;
        }

        const trimmed = rawLine.trim();
        const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
        if (match && match[2].startsWith('"') && !tomlQuotedValueClosed(trimmed))
            pending = rawLine;
        else
            lines.push(rawLine);
    }

    if (pending !== null)
        lines.push(pending);

    return lines;
}

function tomlQuotedValueClosed(line) {
    const match = line.trim().match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/s);
    if (!match)
        return true;
    const value = match[2];
    if (!value.startsWith('"'))
        return true;

    let escaped = false;
    for (let i = 1; i < value.length; i++) {
        const char = value[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = true;
            continue;
        }
        if (char === '"')
            return true;
    }
    return false;
}

function parseTomlValue(value) {
    if (value === 'true')
        return true;
    if (value === 'false')
        return false;
    if (/^-?\d+(\.\d+)?$/.test(value))
        return Number(value);
    if (value.startsWith('"') && value.endsWith('"'))
        return parseTomlString(value.slice(1, -1));
    if (value.startsWith('[') && value.endsWith(']')) {
        return splitTomlArray(value.slice(1, -1))
            .filter(part => part.trim())
            .map(part => parseTomlValue(part.trim()));
    }
    return value;
}

function splitTomlArray(text) {
    const parts = [];
    let start = 0;
    let quoted = false;
    let escaped = false;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (quoted && char === '\\') {
            escaped = true;
            continue;
        }
        if (char === '"')
            quoted = !quoted;
        if (quoted)
            continue;
        if (char === '[')
            depth++;
        else if (char === ']')
            depth--;
        else if (char === ',' && depth === 0) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts;
}

export function formatConfigToml(config) {
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
        if (provider.hidden)
            lines.push(`hidden = true`);
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
    return `"${String(value)
        .replace(/\\/g, '\\\\')
        .replace(/\x08/g, '\\b')
        .replace(/\t/g, '\\t')
        .replace(/\n/g, '\\n')
        .replace(/\f/g, '\\f')
        .replace(/\r/g, '\\r')
        .replace(/"/g, '\\"')}"`;
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

function parseTomlString(value) {
    let output = '';
    let escaped = false;
    for (const char of value) {
        if (!escaped) {
            if (char === '\\') {
                escaped = true;
                continue;
            }
            output += char;
            continue;
        }

        output += {
            b: '\b',
            t: '\t',
            n: '\n',
            f: '\f',
            r: '\r',
            '"': '"',
            '\\': '\\',
        }[char] ?? char;
        escaped = false;
    }
    if (escaped)
        output += '\\';
    return output;
}
