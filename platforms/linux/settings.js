import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const ROOT = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent().get_path();
export const APP_ID = 'io.github.HashimK.UsageStatBar';
export const SCHEMA_ID = 'io.github.HashimK.UsageStatBar';

export function settings() {
    const directory = GLib.getenv('USAGESTAT_BAR_SCHEMA_DIR') || `${ROOT}/platforms/linux/schemas`;
    const source = Gio.SettingsSchemaSource.new_from_directory(directory, Gio.SettingsSchemaSource.get_default(), false);
    return new Gio.Settings({settings_schema: source.lookup(SCHEMA_ID, false)});
}

export function jsonSetting(settings, key, fallback = {}) {
    try {
        const value = JSON.parse(settings.get_string(key));
        return Array.isArray(fallback) ? Array.isArray(value) ? value : fallback
            : value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
    } catch { return fallback; }
}

export function writePrivate(path, value) {
    const file = Gio.File.new_for_path(path);
    GLib.mkdir_with_parents(file.get_parent().get_path(), 0o700);
    file.replace_contents(new TextEncoder().encode(value), null, false,
        Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}
