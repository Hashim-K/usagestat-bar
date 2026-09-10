#!/usr/bin/env python3
"""Check that bundled Polybar glyphs retain their SVG silhouettes and cutouts.

Development check: fonttools, Pillow, PyGObject and the librsvg pixbuf loader.
"""
import json
from pathlib import Path
import xml.etree.ElementTree as ET

from fontTools.ttLib import TTFont
from PIL import Image, ImageChops, ImageDraw, ImageFont
import gi
gi.require_version('GdkPixbuf', '2.0')
from gi.repository import GdkPixbuf

ET.register_namespace('', 'http://www.w3.org/2000/svg')

ROOT = Path(__file__).resolve().parents[2]
folder = ROOT / 'platforms/polybar'
mapping = json.loads((folder/'glyphs.json').read_text())
font = TTFont(folder/'UsageStatProviderIcons.ttf')
cmap = font.getBestCmap()
size = 1000  # Compare outlines without small-font grid fitting moving thin strokes.
raster_font = ImageFont.truetype(str(folder/'UsageStatProviderIcons.ttf'), size)
assert len(set(mapping.values())) == len(mapping)
assert set(mapping.values()) <= set(cmap)
failures = []
for path in sorted((ROOT/'assets/provider-icons').glob('*.svg')):
    if '-color' in path.stem: continue
    root = ET.parse(path).getroot()
    root.set('width', str(size * 9 // 10)); root.set('height', str(size * 9 // 10))
    # The monochrome font intentionally uses one opacity for the whole logo.
    for element in root.iter():
        for key in ['opacity', 'fill-opacity', 'stroke-opacity']: element.attrib.pop(key, None)
    loader = GdkPixbuf.PixbufLoader.new_with_type('svg')
    loader.write(ET.tostring(root)); loader.close()
    pix = loader.get_pixbuf()
    image = Image.frombytes('RGBA', (pix.get_width(), pix.get_height()), bytes(pix.get_pixels()), 'raw', 'RGBA', pix.get_rowstride())
    expected = Image.new('L', (size, size))
    expected.paste(image.getchannel('A'), (size // 20, size // 20))
    actual = Image.new('L', (size, size))
    ImageDraw.Draw(actual).text((0, size * 9 // 10), chr(mapping[path.stem]), font=raster_font, fill=255, anchor='ls')
    expected = expected.point(lambda value: 255 if value > 100 else 0)
    actual = actual.point(lambda value: 255 if value > 100 else 0)
    intersection = sum(ImageChops.darker(expected, actual).histogram()[1:])
    union = sum(ImageChops.lighter(expected, actual).histogram()[1:])
    similarity = intersection / union if union else 0
    if similarity < .93: failures.append((path.name, round(similarity, 4)))
assert not failures, f'Logo outlines differ from their source SVGs: {failures}'
print(f'Passed: {len(mapping)-1} provider glyphs, aliases available, source silhouettes and cutouts retained.')
