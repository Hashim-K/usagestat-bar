import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {ROOT, writePrivate} from './settings.js';
import {clamp} from './model.js';
import {PROVIDER_ICON_FILES} from '../../providerMetadata.js';

export const escapeXml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
// Polybar interprets %{...} as formatting/actions. Never pass provider text through it.
export const escapePolybar = value => String(value ?? '').replaceAll('%', '％').replace(/[\r\n\x00-\x1f]/g, ' ');

function read(path) {
    try { return new TextDecoder().decode(Gio.File.new_for_path(path).load_contents(null)[1]); } catch { return ''; }
}

export function logoSvg(provider, appearance) {
    const id = PROVIDER_ICON_FILES[provider.iconId]?.replace(/\.svg$/, '') || provider.iconId;
    const safeId = /^[a-z0-9_-]+$/i.test(id) ? id : 'codex';
    const colorPath = `${ROOT}/assets/provider-icons/${safeId}-color.svg`;
    const path = provider.iconPath || (provider.iconStyle === 'color' && Gio.File.new_for_path(colorPath).query_exists(null)
        ? colorPath : `${ROOT}/assets/provider-icons/${safeId}.svg`);
    let svg = read(path);
    if (!svg.includes('<svg')) svg = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="currentColor"/></svg>';
    svg = svg.replaceAll('currentColor', appearance.neutral);
    // Many bundled logos use 1em dimensions. Give file-based GTK/Qt loaders a
    // real intrinsic size; otherwise they can rasterize a single pixel.
    svg = svg.replace(/<svg\b[^>]*>/, tag => tag.replace(/\s(?:width|height)=["'][^"']*["']/g, '').replace('<svg', '<svg width="64" height="64"'));
    if (!['horizontal', 'vertical', 'pie'].includes(appearance.fill)) return svg;
    const root = svg.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i);
    const viewBox = root?.[1].match(/viewBox=["']\s*([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)\s*["']/);
    if (!root || !viewBox) return svg;
    const [x, y, w, h] = viewBox.slice(1).map(Number);
    const pct = clamp(provider.percent);
    let clip;
    if (pct <= 0) clip = '<rect width="0" height="0"/>';
    else if (pct >= 100) clip = `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`;
    else if (appearance.fill === 'horizontal') clip = `<rect x="${x}" y="${y}" width="${w * pct / 100}" height="${h}"/>`;
    else if (appearance.fill === 'vertical') clip = `<rect x="${x}" y="${y + h * (1 - pct / 100)}" width="${w}" height="${h * pct / 100}"/>`;
    else {
        const cx = x + w / 2, cy = y + h / 2, r = Math.hypot(w, h) / 2;
        const angle = pct / 100 * Math.PI * 2 - Math.PI / 2;
        clip = `<path d="M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 ${pct > 50 ? 1 : 0} 1 ${cx + r * Math.cos(angle)} ${cy + r * Math.sin(angle)} Z"/>`;
    }
    const attrs = [...root[1].matchAll(/\b(color|fill|fill-rule|stroke|stroke-width|stroke-linecap|stroke-linejoin|stroke-miterlimit|stroke-opacity|fill-opacity|clip-rule)=(["'])(.*?)\2/g)]
        .map(m => ` ${m[1]}=${m[2]}${m[3]}${m[2]}`).join('');
    return `<svg width="64" height="64" viewBox="${x} ${y} ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="quotaClip">${clip}</clipPath></defs><g opacity="0.22"${attrs}>${root[2]}</g><g clip-path="url(#quotaClip)"${attrs}>${root[2]}</g></svg>`;
}

function textSvg(text, x, color) {
    return `<text x="${x}" y="19" fill="${color}" font-family="sans-serif" font-size="13">${escapeXml(text)}</text>`;
}

export function panelSvg(state) {
    const parts = [], appearance = state.appearance;
    let x = 2;
    for (const key of state.panel) {
        const provider = state.providers.find(p => p.key === key);
        if (!provider) continue;
        for (const component of appearance.components) {
            if (component === 'bar') {
                const bars = appearance.bars === 1 ? [{percent: provider.percent, color: provider.color}] : provider.windows.slice(0, appearance.bars);
                if (!bars.length) bars.push({percent: 0, color: provider.color});
                const vertical = appearance.layout === 'vertical';
                const height = vertical ? Math.min(12, 18 / bars.length - 2) : 12;
                bars.forEach((bar, i) => {
                    const bx = x + (vertical ? 0 : i * 25), by = vertical ? (28 - bars.length * (height + 2)) / 2 + i * (height + 2) : 8;
                    parts.push(`<rect x="${bx}" y="${by}" width="20" height="${height}" rx="2" fill="none" stroke="${appearance.neutral}"/>`);
                    if (!provider.error && provider.percent !== null)
                        parts.push(`<rect x="${bx + 1}" y="${by + 1}" width="${18 * clamp(bar.percent) / 100}" height="${height - 2}" rx="1" fill="${bar.color}"/>`);
                });
                x += (vertical ? 20 : bars.length * 25) + 6;
            } else if (component === 'logo') {
                const source = logoSvg(provider, appearance).replace(/<\?xml[^>]*>/g, '');
                // Isolate ids when a provider logo occurs more than once in a combined SVG.
                const prefix = `p${x}_`;
                const nested = source.replace(/id="([^"]+)"/g, `id="${prefix}$1"`).replace(/url\(#([^)]*)\)/g, `url(#${prefix}$1)`);
                // QtSvg implements SVG Tiny and does not render nested <svg>
                // viewports consistently. Flatten each logo to a transformed group.
                const root = nested.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i);
                const dimensions = root?.[1].match(/viewBox=["']\s*([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)\s*["']/);
                if (root && dimensions) {
                    const [vx, vy, vw, vh] = dimensions.slice(1).map(Number);
                    const attrs = [...root[1].matchAll(/\b(fill|fill-rule|stroke|stroke-width|stroke-linecap|stroke-linejoin|clip-rule)=(["'])(.*?)\2/g)].map(m => ` ${m[1]}=${m[2]}${m[3]}${m[2]}`).join('');
                    parts.push(`<g transform="translate(${x},4) scale(${20 / vw},${20 / vh}) translate(${-vx},${-vy})"${attrs}>${root[2]}</g>`);
                }
                x += 26;
            } else if (component === 'percent' || component === 'text') {
                const label = component === 'text' ? provider.name : provider.error ? '!' : provider.percent === null ? '—' : `${Math.round(provider.percent)}%`;
                parts.push(textSvg(label, x, provider.error ? '#ff5f57' : appearance.neutral));
                x += [...label].length * 8.2 + 6;
            }
        }
        x += appearance.spacing;
    }
    if (!state.panel.length) { parts.push(textSvg('UsageStat · Set up providers', x, appearance.neutral)); x = 218; }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(x)}" height="28" viewBox="0 0 ${Math.ceil(x)} 28">${parts.join('')}</svg>`;
}

export function traySvg(provider) {
    const pct = clamp(provider?.percent);
    const circumference = Math.PI * 52;
    const text = provider?.error ? '!' : provider?.percent === null || !provider ? '…' : String(Math.round(pct));
    const color = provider?.error ? '#ff5f57' : provider?.color || '#8ab4f8';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="#20242b" stroke="#79818d" stroke-width="5"/><circle cx="32" cy="32" r="26" fill="none" stroke="${color}" stroke-width="5" stroke-dasharray="${circumference * pct / 100} ${circumference}" transform="rotate(-90 32 32)"/><text x="32" y="40" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="${text.length >= 3 ? 23 : 28}" font-weight="bold">${text}</text></svg>`;
}

export function renderFiles(state) {
    const directory = `${GLib.get_user_cache_dir()}/usagestat-bar-linux`;
    const panel = panelSvg(state);
    const path = `${directory}/panel.svg`;
    if (read(path) !== panel) writePrivate(path, panel);
    state.panelImage = path;
    state.panelImageLight = `${directory}/panel-light.svg`;
    const light = panelSvg({...state, appearance: {...state.appearance,
        neutral: state.appearance.neutral === '#e6edf3' ? '#23262e' : state.appearance.neutral}});
    if (read(state.panelImageLight) !== light) writePrivate(state.panelImageLight, light);
    state.panelWidth = Number(panel.match(/width="([\d.]+)"/)[1]);
    state.providers.forEach((provider, i) => {
        provider.logo = `${directory}/provider-${i}.svg`;
        const svg = logoSvg(provider, {...state.appearance, fill: 'full'});
        if (read(provider.logo) !== svg) writePrivate(provider.logo, svg);
        provider.logoLight = `${directory}/provider-${i}-light.svg`;
        const lightSvg = logoSvg(provider, {...state.appearance, fill: 'full', neutral: '#23262e'});
        if (read(provider.logoLight) !== lightSvg) writePrivate(provider.logoLight, lightSvg);
    });
    return state;
}

export function panelText(state, polybar = false) {
    const clean = polybar ? escapePolybar : value => String(value).replace(/[\r\n\x00-\x1f]/g, ' ');
    return state.panel.map(key => state.providers.find(p => p.key === key)).filter(Boolean).map(p => {
        const filled = Math.round((p.percent || 0) / 20);
        const meter = p.error ? '!' : p.percent === null ? '…' : polybar
            ? '[' + '|'.repeat(filled) + '.'.repeat(5 - filled) + ']'
            : '▰'.repeat(filled) + '▱'.repeat(5 - filled);
        return state.appearance.components.map(c => c === 'bar' ? meter : c === 'percent' ? p.error ? 'Error' : p.text : c === 'text' ? clean(p.name) : '').filter(Boolean).join(' ');
    }).join('   ') || 'UsageStat · Set up providers';
}

export function waybarOutput(state) {
    const active = state.providers.find(p => p.key === state.active);
    return {text: escapeXml(panelText(state)), tooltip: escapeXml(state.providers.filter(p => !p.parent).map(p => `${p.name}: ${p.error || p.text}`).join('\n')),
        class: active?.error ? 'error' : state.loading ? 'loading' : active?.used >= 90 ? 'danger' : active?.used >= 75 ? 'warning' : 'normal',
        percentage: Math.round(active?.percent || 0)};
}
