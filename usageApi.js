import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

const API_BASE_URL = 'https://chatgpt.com';

export class UsageApiError extends Error {
    constructor(message, statusCode = 0) {
        super(message);
        this.name = 'UsageApiError';
        this.statusCode = statusCode;
    }
}

export class UsageApiClient {
    constructor() {
        this._session = new Soup.Session({timeout: 30});
    }

    destroy() {
        this._session?.abort();
        this._session = null;
    }

    async fetchSummary(cookieHeader, cancellable = null) {
        if (!cookieHeader)
            throw new UsageApiError('Codex requires a ChatGPT Cookie header in ~/.codexbar/config.json.');

        const session = await this._getJson('/api/auth/session', cookieHeader, null, cancellable);
        const accessToken = session?.accessToken;
        if (!accessToken)
            throw new UsageApiError('Could not get ChatGPT access token from the configured cookies.');

        const usagePayload = await this._getJson('/backend-api/wham/usage', null, accessToken, cancellable);
        if (!usagePayload.email) {
            try {
                const me = await this._getJson('/backend-api/me', null, accessToken, cancellable);
                if (me?.email)
                    usagePayload.email = me.email;
            } catch {
                // Account metadata is optional for rendering the usage bars.
            }
        }

        return this._normalizeSummary(usagePayload);
    }

    async _getJson(path, cookieHeader, accessToken, cancellable) {
        const message = Soup.Message.new('GET', `${API_BASE_URL}${path}`);
        const headers = message.get_request_headers();
        headers.append('Accept', 'application/json');
        headers.append('Referer', 'https://chatgpt.com/');
        headers.append('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

        if (cookieHeader) {
            headers.append('Cookie', cookieHeader.replace(/^Cookie:\s*/i, '').trim());
            const match = cookieHeader.match(/oai-did=([^;]+)/);
            if (match)
                headers.append('oai-device-id', match[1]);
        }
        if (accessToken)
            headers.append('Authorization', `Bearer ${accessToken}`);

        const bytes = await new Promise((resolve, reject) => {
            this._session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                cancellable,
                (session, result) => {
                    try {
                        resolve(session.send_and_read_finish(result));
                    } catch (error) {
                        reject(error);
                    }
                },
            );
        }).catch(error => {
            throw new UsageApiError(error.message || String(error));
        });

        const statusCode = message.get_status();
        const body = new TextDecoder().decode(bytes?.toArray?.() ?? bytes?.get_data?.() ?? []);
        let payload;
        try {
            payload = body ? JSON.parse(body) : null;
        } catch (error) {
            throw new UsageApiError(`Invalid ChatGPT JSON response: ${error.message}`, statusCode);
        }

        if (statusCode < 200 || statusCode >= 300) {
            let messageText = payload?.message || payload?.error?.message || payload?.error || `HTTP ${statusCode}`;
            if (typeof messageText === 'object')
                messageText = JSON.stringify(messageText);
            throw new UsageApiError(messageText, statusCode);
        }

        return payload;
    }

    _normalizeSummary(payload) {
        const windows = this._extractWindows(payload)
            .sort((a, b) => (a.windowSeconds || 0) - (b.windowSeconds || 0));

        const mapWindow = window => window ? {
            usedPercent: window.percent * 100,
            windowMinutes: window.windowSeconds ? Math.round(window.windowSeconds / 60) : undefined,
            resetDescription: this._formatReset(window.resetAfterSeconds),
        } : null;

        return {
            provider: 'codex',
            source: 'chatgpt-direct',
            usage: {
                accountEmail: payload?.email || null,
                updatedAt: new Date().toISOString(),
                primary: mapWindow(windows[0]),
                secondary: mapWindow(windows[1]),
                tertiary: mapWindow(windows[2]),
                quaternary: mapWindow(windows[3]),
            },
        };
    }

    _extractWindows(payload) {
        const windows = [];
        const seen = new Set();

        const collect = value => {
            if (!value || typeof value !== 'object' || seen.has(value))
                return;
            seen.add(value);

            if (value.used_percent !== undefined) {
                const percent = Number(value.used_percent) / 100;
                if (!Number.isNaN(percent)) {
                    windows.push({
                        percent,
                        windowSeconds: Number(value.limit_window_seconds || value.window_seconds || value.duration_seconds || 0),
                        resetAfterSeconds: Number(value.reset_after_seconds || value.reset_after || 0),
                    });
                }
            }

            let used = value.used ?? value.usage ?? value.count ?? value.current_usage;
            const limit = value.limit ?? value.cap ?? value.max ?? value.usage_limit ?? value.total;
            if (used === undefined && value.remaining !== undefined && limit !== undefined)
                used = Number(limit) - Number(value.remaining);

            if (used !== undefined && limit !== undefined) {
                const usedNumber = Number(used);
                const limitNumber = Number(limit);
                if (!Number.isNaN(usedNumber) && !Number.isNaN(limitNumber) && limitNumber > 0) {
                    windows.push({
                        percent: usedNumber / limitNumber,
                        windowSeconds: Number(value.window_seconds || value.duration_seconds || value.limit_window_seconds || 0),
                        resetAfterSeconds: Number(value.reset_after_seconds || value.reset_after || 0),
                    });
                }
            }

            for (const key in value)
                collect(value[key]);
        };

        collect(payload);
        return windows.filter((window, index, all) =>
            index === all.findIndex(other =>
                other.windowSeconds === window.windowSeconds &&
                other.percent === window.percent));
    }

    _formatReset(seconds) {
        if (!seconds)
            return '';
        if (seconds < 60)
            return `Resets in ${Math.round(seconds)}s`;
        if (seconds < 3600)
            return `Resets in ${Math.round(seconds / 60)}m`;
        if (seconds < 86400)
            return `Resets in ${Math.round(seconds / 3600)}h`;
        return `Resets in ${Math.round(seconds / 86400)}d`;
    }
}
