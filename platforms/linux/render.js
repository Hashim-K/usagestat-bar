import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Rsvg from 'gi://Rsvg?version=2.0';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import {ROOT, writePrivate} from './settings.js';
import {clamp, safeColor} from './model.js';
import {PROVIDER_ICON_FILES} from '../../providerMetadata.js';
import {providerGlyph} from '../polybar/icons.js';

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
function textWidth(text, size = 13, bold = false) {
    const layout = Pango.Layout.new(fontContext);
    layout.set_font_description(Pango.FontDescription.from_string(`Sans${bold ? ' Bold' : ''} ${size}px`));
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

function luminance(color) {
    const channels = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
        .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function verticalPanelSvg(state) {
    const {appearance} = state;
    const width = 40, parts = [];
    let y = 4;
    for (const key of state.panel) {
        const provider = state.providers.find(item => item.key === key);
        if (!provider) continue;
        for (const component of appearance.components) {
            if (component === 'logo') {
                parts.push(inlineLogo(provider, appearance, 8, y, 24, `vertical${y}_`));
                y += 28;
            } else if (component === 'bar') {
                for (const bar of usageBars(provider, appearance)) {
                    parts.push(`<rect x="6" y="${y}" width="28" height="6" rx="2" fill="none" stroke="${appearance.neutral}"/>`);
                    if (!provider.error && provider.percent !== null)
                        parts.push(`<rect x="7" y="${y + 1}" width="${26 * clamp(bar.percent) / 100}" height="4" rx="1" fill="${bar.color}"/>`);
                    y += 9;
                }
            } else if (component === 'percent' || component === 'text') {
                let text = component === 'text' ? compactName(provider.name)
                    : provider.error ? '!' : provider.percent === null ? '—' : `${Math.round(provider.percent)}%`;
                const size = component === 'text' ? 9 : 11;
                if (textWidth(text, size) > width - 4) {
                    while (text && textWidth(text + '…', size) > width - 4) text = text.slice(0, -1);
                    text += '…';
                }
                parts.push(`<text x="20" y="${y + size}" text-anchor="middle" font-family="sans-serif" font-size="${size}" fill="${provider.error ? '#ff5f57' : appearance.neutral}">${escapeXml(text)}</text>`);
                y += size + 5;
            }
        }
        y += Math.max(6, appearance.spacing);
    }
    const height = Math.max(28, y);
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
}

function trayTrackColor(fill, background) {
    const fillLight = luminance(fill), backgroundLight = luminance(background);
    const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    let bestColor = '#23262e', bestContrast = 0;
    // Keep the empty segment opaque. Choose a neutral shade that separates
    // it from both the usage fill and the surface selected by Icon contrast.
    for (let step = 0; step <= 16; step++) {
        const color = '#' + [35, 38, 46].map((channel, index) => Math.round(channel
            + ([244, 245, 246][index] - channel) * step / 16).toString(16).padStart(2, '0')).join('');
        const light = luminance(color);
        const score = Math.min(contrast(light, fillLight), contrast(light, backgroundLight));
        if (score > bestContrast) { bestContrast = score; bestColor = color; }
    }
    return bestColor;
}

export function traySvg(provider, appearance = {}) {
    const style = appearance.style || 'logo-meter';
    const neutral = appearance.neutral || '#23262e';
    const pct = clamp(provider?.percent);
    const parts = [];
    if (!provider) {
        for (const [x, height] of [[5, 10], [13, 18], [21, 26]])
            parts.push(`<rect x="${x}" y="${29 - height}" width="6" height="${height}" rx="1.5" fill="${neutral}"/>`);
    } else if (style === 'percentage') {
        const numeric = !provider.error && !provider.loading && Number.isFinite(provider.percent);
        const text = provider.error ? '!' : provider.loading ? '…' : numeric ? String(Math.round(pct)) : '—';
        // Fit the complete percentage, including 100%, without clipping or
        // squeezing the glyphs. The smaller suffix leaves more room for digits.
        const scale = numeric ? Math.min(1, 30 / (textWidth(text, 26, true) + textWidth('%', 14, true))) : 1;
        const size = 26 * scale;
        parts.push(`<text x="16" y="${16 + size * 0.36}" text-anchor="middle" fill="${provider.error ? '#ff5f57' : neutral}" font-family="sans-serif" font-size="${size}" font-weight="bold">${escapeXml(text)}${numeric ? `<tspan font-size="${14 * scale}">%</tspan>` : ''}</text>`);
    } else {
        const withMeter = style === 'logo-meter';
        const vertical = appearance.barOrientation === 'vertical';
        const thickness = Math.max(2, Math.min(8, appearance.barThickness ?? 5));
        const space = 29 - thickness;
        const size = withMeter ? Math.min(24, space) : 28;
        const fill = ['vertical', 'horizontal', 'pie'].includes(appearance.fill) ? appearance.fill : 'vertical';
        // A tray slot is only about 22–24 pixels. Give the logo the space;
        // detailed numbers remain in the tooltip and usage window.
        parts.push(inlineLogo({...provider, iconStyle: appearance.logoStyle || 'monochromatic'},
            {neutral, fill: style === 'logo-fill' && !provider.error ? fill : 'full'},
            withMeter && vertical ? (space - size) / 2 : (32 - size) / 2,
            withMeter && !vertical ? (space - size) / 2 : (32 - size) / 2, size, 'tray_'));
        if (withMeter) {
            const color = safeColor(provider.error ? '#ff5f57' : provider.threshold ? provider.color : appearance.accent);
            const background = safeColor(appearance.background, luminance(neutral) > 0.5 ? '#23262e' : '#f4f5f6');
            const track = trayTrackColor(color, background);
            const fraction = provider.error ? 1 : provider.loading ? 0.26 : pct / 100;
            const x = vertical ? 31 - thickness : 4, y = vertical ? 4 : 31 - thickness;
            const width = vertical ? thickness : 24, height = vertical ? 24 : thickness;
            const radius = Math.min(2, thickness / 2);
            parts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${track}"/>`);
            if (fraction > 0) parts.push(`<rect x="${x}" y="${vertical ? y + height * (1 - fraction) : y}" width="${vertical ? width : width * fraction}" height="${vertical ? height * fraction : height}" rx="${radius}" fill="${color}"/>`);
        } else if (provider.error) {
            parts.push('<circle cx="26" cy="26" r="5" fill="#ff5f57"/>');
            parts.push('<path d="M26 23v3m0 2v.1" stroke="white" stroke-width="1.5" stroke-linecap="round"/>');
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="32" height="32" viewBox="0 0 32 32">${parts.join('')}</svg>`;
}

export function svgPixels(svg, width, height = width) {
    // Render our composed SVG directly through librsvg. Recent GdkPixbuf
    // versions send SVG to an external decoder, whose font sandbox can fail
    // in nested desktops. Explicit dimensions keep each output crisp.
    const sized = svg.replace(/<svg\b[^>]*>/, tag => tag.replace(/\s(?:width|height)=["'][^"']*["']/g, '')
        .replace('<svg', `<svg width="${Math.round(width)}" height="${Math.round(height)}"`));
    return Rsvg.Handle.new_from_data(new TextEncoder().encode(sized)).get_pixbuf();
}

function writePanelPng(path, svg, width, height = 28) {
    // QtSvg does not implement clipPath. Rasterize through librsvg, as the
    // GTK/tray adapters do, at 3x resolution for sharp scaled Plasma panels.
    const [, bytes] = svgPixels(svg, width * 3, height * 3).save_to_bufferv('png', [], []);
    Gio.File.new_for_path(path).replace_contents(bytes, null, false,
        Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

export function renderFiles(state) {
    const directory = `${GLib.get_user_cache_dir()}/usagestat-bar-linux`;
    const panel = panelSvg(state);
    const path = `${directory}/panel.svg`;
    const panelChanged = read(path) !== panel;
    if (panelChanged) writePrivate(path, panel);
    state.panelImage = path;
    state.panelImageLight = `${directory}/panel-light.svg`;
    const light = panelSvg({...state, appearance: {...state.appearance,
        neutral: state.appearance.neutral === '#e6edf3' ? '#23262e' : state.appearance.neutral}});
    const lightChanged = read(state.panelImageLight) !== light;
    if (lightChanged) writePrivate(state.panelImageLight, light);
    state.panelWidth = Number(panel.match(/width="([\d.]+)"/)[1]);
    state.panelImagePng = `${directory}/panel.png`;
    state.panelImageLightPng = `${directory}/panel-light.png`;
    if (panelChanged || !Gio.File.new_for_path(state.panelImagePng).query_exists(null))
        writePanelPng(state.panelImagePng, panel, state.panelWidth);
    if (lightChanged || !Gio.File.new_for_path(state.panelImageLightPng).query_exists(null))
        writePanelPng(state.panelImageLightPng, light, state.panelWidth);
    const vertical = verticalPanelSvg(state);
    const verticalLight = verticalPanelSvg({...state, appearance: {...state.appearance,
        neutral: state.appearance.neutral === '#e6edf3' ? '#23262e' : state.appearance.neutral}});
    state.panelVerticalWidth = 40;
    state.panelVerticalHeight = Number(vertical.match(/height="([\d.]+)"/)[1]);
    for (const [key, svg, suffix] of [['panelImageVertical', vertical, 'vertical'], ['panelImageVerticalLight', verticalLight, 'vertical-light']]) {
        state[key] = `${directory}/panel-${suffix}.svg`;
        state[key + 'Png'] = `${directory}/panel-${suffix}.png`;
        if (read(state[key]) !== svg || !Gio.File.new_for_path(state[key + 'Png']).query_exists(null)) {
            writePrivate(state[key], svg);
            writePanelPng(state[key + 'Png'], svg, state.panelVerticalWidth, state.panelVerticalHeight);
        }
    }
    state.panelImageKey = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, panel + light + vertical + verticalLight, -1).slice(0, 16);
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
            const filled = Math.round(clamp(bar.percent) * 6 / 100);
            const fill = safeColor(p.error ? '#ff5f57' : bar.color || p.color);
            const background = luminance(safeColor(state.appearance.neutral, '#e6edf3')) > 0.5 ? '#23262e' : '#f4f5f6';
            if (p.error || p.percent === null) return color(p.error ? '!' : '…', fill);
            return color('━'.repeat(filled), fill) + color('━'.repeat(6 - filled), trayTrackColor(fill, background));
        }).join(!polybar && markup && state.appearance.layout === 'vertical' ? '\n' : ' ');
        return state.appearance.components.map(c => c === 'bar' ? meters : c === 'percent'
            ? color(p.error ? '!' : p.percent === null ? '—' : `${Math.round(clamp(p.percent))}%`, safeColor(p.error ? '#ff5f57' : p.color)) : c === 'text' ? clean(compactName(p.name))
            : c === 'logo' ? polybar ? providerGlyph(p) : clean(`[${initials(p.name)}]`) : '').filter(Boolean).join(' ');
    }).join(' '.repeat(Math.max(1, Math.min(20, Math.round((state.appearance.spacing ?? 12) / 4))))) || 'UsageStat · Set up providers';
}

export function waybarOutput(state) {
    const active = state.providers.find(p => p.key === state.active);
    return {text: panelText(state, false, true), tooltip: escapeXml(state.providers.filter(p => !p.parent).map(p => `${p.name}: ${p.error || p.text}\n${(p.windows || []).map(w => `${w.label}: ${w.text}`).join('\n')}`).join('\n\n')),
        class: active?.error ? 'error' : state.loading ? 'loading' : active?.threshold ? ['threshold', active.threshold.id.replace(/[^a-zA-Z0-9_-]/g, '-')] : 'normal',
        percentage: Math.round(active?.percent || 0)};
}
