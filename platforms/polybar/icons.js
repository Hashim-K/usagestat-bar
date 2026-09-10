import Gio from 'gi://Gio';
import {ROOT} from '../linux/settings.js';
import {PROVIDER_ICON_FILES} from '../../providerMetadata.js';

const file = Gio.File.new_for_path(`${ROOT}/platforms/polybar/glyphs.json`);
const glyphs = JSON.parse(new TextDecoder().decode(file.load_contents(null)[1]));

export function providerGlyph(provider) {
    const id = String(provider.iconId || 'generic');
    const name = (Object.hasOwn(PROVIDER_ICON_FILES, id) ? PROVIDER_ICON_FILES[id] : id).replace(/\.svg$/, '');
    return String.fromCodePoint(Object.hasOwn(glyphs, name) ? glyphs[name] : glyphs.generic);
}
