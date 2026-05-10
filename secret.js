import Secret from 'gi://Secret';

const TOKEN_SCHEMA = new Secret.Schema(
    'org.gnome.shell.extensions.codexbar.token',
    Secret.SchemaFlags.NONE,
    {provider_id: Secret.SchemaAttributeType.STRING},
);

export function loadLegacyToken(providerId) {
    try {
        return Secret.password_lookup_sync(TOKEN_SCHEMA, {provider_id: providerId}, null);
    } catch (error) {
        logError(error, 'AI Usage Bar: failed to read legacy CodexBar token');
        return null;
    }
}
