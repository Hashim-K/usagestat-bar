import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
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
    if (provider.iconPath && !svg.includes('<svg')) {
        try {
            // Embed a bounded raster so Qt/GTK render the same self-contained
            // image, including alpha and the selected quota-fill geometry.
            const pixels = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, 128, 128, true);
            const [, bytes] = pixels.save_to_bufferv('png', [], []);
            svg = `<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image x="0" y="0" width="128" height="128" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,${GLib.base64_encode(bytes)}"/></svg>`;
        } catch { /* A missing/unreadable custom icon gets the fallback below. */ }
    }
    if (!svg.includes('<svg')) svg = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="currentColor"/></svg>';
    svg = svg.replaceAll('currentColor', appearance.neutral);
    // Many bundled logos use 1em dimensions. Give file-based GTK/Qt loaders a
    // real intrinsic size; otherwise they can rasterize a single pixel.
    svg = svg.replace(/<svg\b[^>]*>/, tag => tag.replace(/\s(?:width|height)=["'][^"']*["']/g, '').replace('<svg', '<svg width="64" height="64"'));
    if (!['horizontal', 'vertical', 'pie'].includes(appearance.fill)) return svg;
    const root = svg.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i);
    const viewBox = root?.[1].match(/viewBox=["']\s*([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)\s*["']/);
    if (!root || !viewBox || viewBox.slice(3).some(value => Number(value) <= 0)) return svg;
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
    const attrs = [...root[1].matchAll(/\b(style|opacity|color|fill|fill-rule|stroke|stroke-width|stroke-linecap|stroke-linejoin|stroke-miterlimit|stroke-opacity|fill-opacity|clip-rule)=(["'])(.*?)\2/g)]
        .map(m => ` ${m[1]}=${m[2]}${m[3]}${m[2]}`).join('');
    return `<svg width="64" height="64" viewBox="${x} ${y} ${w} ${h}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><clipPath id="quotaClip">${clip}</clipPath></defs><g${attrs}><g opacity="0.22">${root[2]}</g><g clip-path="url(#quotaClip)">${root[2]}</g></g></svg>`;
}

const fontContext = PangoCairo.FontMap.get_default().create_context();
function textWidth(text) {
    const layout = Pango.Layout.new(fontContext);
    layout.set_font_description(Pango.FontDescription.from_string('Sans 13px'));
    layout.set_text(text, -1);
    return layout.get_pixel_size()[0];
}

function compactName(name) {
    const letters = [...String(name || '')];
    return letters.length > 32 ? letters.slice(0, 31).join('') + '…' : letters.join('');
}

export function usageBars(provider, appearance) {
    const bars = appearance.bars > 1 ? (provider.windows || []).slice(0, appearance.bars) : [];
    return bars.length ? bars : [{percent: provider.percent, color: provider.color}];
}

function inlineLogo(provider, appearance, x, y, size, prefix) {
    const source = logoSvg(provider, appearance).replace(/<\?xml[^>]*>/g, '')
        .replace(/id=(["'])([^"']+)\1/g, `id="${prefix}$2"`)
        .replace(/url\(#([^)]*)\)/g, `url(#${prefix}$1)`)
        .replace(/((?:xlink:)?href=)(["'])#([^"']+)\2/g, `$1"#${prefix}$3"`);
    const root = source.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i);
    const box = root?.[1].match(/viewBox=["']\s*([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)\s*["']/);
    if (!root || !box) return '';
    const [vx, vy, vw, vh] = box.slice(1).map(Number);
    if (!(vw > 0 && vh > 0)) return '';
    const scale = Math.min(size / vw, size / vh);
    const attrs = [...root[1].matchAll(/\b(style|opacity|color|fill|fill-rule|stroke|stroke-width|stroke-linecap|stroke-linejoin|stroke-miterlimit|stroke-opacity|fill-opacity|clip-rule)=(["'])(.*?)\2/g)]
        .map(m => ` ${m[1]}=${m[2]}${m[3]}${m[2]}`).join('');
    return `<g transform="translate(${x + (size - vw * scale) / 2},${y + (size - vh * scale) / 2}) scale(${scale}) translate(${-vx},${-vy})"${attrs}>${root[2]}</g>`;
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
                const bars = usageBars(provider, appearance);
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
                // Flatten viewports for QtSvg and namespace repeated logo IDs.
                parts.push(inlineLogo(provider, appearance, x, 4, 20, `p${x}_`));
                x += 26;
            } else if (component === 'percent' || component === 'text') {
                const label = component === 'text' ? compactName(provider.name) : provider.error ? '!' : provider.percent === null ? '—' : `${Math.round(provider.percent)}%`;
                parts.push(textSvg(label, x, provider.error ? '#ff5f57' : appearance.neutral));
                x += textWidth(label) + 6;
            }
        }
        x += appearance.spacing;
    }
    if (!state.panel.length) { parts.push(textSvg('UsageStat · Set up providers', x, appearance.neutral)); x = 218; }
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${Math.ceil(x)}" height="28" viewBox="0 0 ${Math.ceil(x)} 28">${parts.join('')}</svg>`;
}

export function traySvg(provider, appearance = {components: ['bar', 'percent'], bars: 1, neutral: '#ffffff', fill: 'full'}) {
    const components = appearance.components;
    const pct = clamp(provider?.percent);
    const text = provider?.error ? '!' : provider?.percent === null || !provider ? '…' : String(Math.round(pct));
    const parts = ['<rect width="64" height="64" rx="14" fill="#20242b"/>'];
    if (components.includes('bar')) usageBars(provider || {}, appearance).forEach((bar, i) => {
        const r = 28 - i * 5, circumference = Math.PI * 2 * r;
        parts.push(`<circle cx="32" cy="32" r="${r}" fill="none" stroke="#79818d" stroke-width="3"/>`);
        parts.push(`<circle cx="32" cy="32" r="${r}" fill="none" stroke="${provider?.error ? '#ff5f57' : bar.color || '#8ab4f8'}" stroke-width="3" stroke-dasharray="${circumference * clamp(bar.percent) / 100} ${circumference}" transform="rotate(-90 32 32)"/>`);
    });
    const center = components.filter(c => c !== 'bar');
    if (!center.length || provider?.error) center.splice(0, center.length, 'percent');
    const size = center.length === 1 ? 32 : center.length === 2 ? 21 : 15;
    center.forEach((component, i) => {
        const y = (64 - size * center.length) / 2 + size * i;
        if (component === 'logo' && provider)
            parts.push(inlineLogo(provider, {...appearance, neutral: '#ffffff'}, (64 - size) / 2, y, size, 'tray_'));
        else {
            const value = component === 'text' ? initials(provider?.name) : text;
            parts.push(`<text x="32" y="${y + size * .8}" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="${Math.min(size, value.length >= 3 ? size * .8 : size)}" font-weight="bold">${escapeXml(value)}</text>`);
        }
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="64" height="64" viewBox="0 0 64 64">${parts.join('')}</svg>`;
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

function initials(name = '') {
    const words = name.trim().split(/\s+/);
    return (words.length > 1 ? words.slice(0, 2).map(w => [...w][0]).join('') : [...name].slice(0, 2).join('')).toUpperCase();
}

export function panelText(state, polybar = false, markup = false) {
    const clean = polybar ? escapePolybar : markup ? escapeXml : value => String(value).replace(/[\r\n\x00-\x1f]/g, ' ');
    const color = (value, hex) => polybar ? `%{F${hex}}${value}%{F-}` : markup ? `<span foreground="${hex}">${value}</span>` : value;
    return state.panel.map(key => state.providers.find(p => p.key === key)).filter(Boolean).map(p => {
        const meters = usageBars(p, state.appearance).map(bar => {
            const filled = Math.round(clamp(bar.percent) / 20);
            const meter = p.error ? '!' : p.percent === null ? '…' : polybar
                ? '[' + '|'.repeat(filled) + '.'.repeat(5 - filled) + ']'
                : '▰'.repeat(filled) + '▱'.repeat(5 - filled);
            return color(meter, bar.color || p.color || '#8ab4f8');
        }).join(!polybar && markup && state.appearance.layout === 'vertical' ? '\n' : ' ');
        return state.appearance.components.map(c => c === 'bar' ? meters : c === 'percent'
            ? color(clean(p.error ? 'Error' : p.text), p.color || '#8ab4f8') : c === 'text' ? clean(compactName(p.name))
            : c === 'logo' ? clean(`[${initials(p.name)}]`) : '').filter(Boolean).join(' ');
    }).join(' '.repeat(Math.max(1, Math.min(20, Math.round((state.appearance.spacing ?? 12) / 4))))) || 'UsageStat · Set up providers';
}

export function waybarOutput(state) {
    const active = state.providers.find(p => p.key === state.active);
    return {text: panelText(state, false, true), tooltip: escapeXml(state.providers.filter(p => !p.parent).map(p => `${p.name}: ${p.error || p.text}\n${(p.windows || []).map(w => `${w.label}: ${w.text}`).join('\n')}`).join('\n\n')),
        class: active?.error ? 'error' : state.loading ? 'loading' : active?.threshold ? ['threshold', active.threshold.id.replace(/[^a-zA-Z0-9_-]/g, '-')] : 'normal',
        percentage: Math.round(active?.percent || 0)};
}
