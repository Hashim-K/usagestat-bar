#!/usr/bin/env python3
"""Rebuild the bundled Polybar font from the existing monochrome SVG assets.

Development only: fonttools==4.62.1 and skia-pathops==0.9.2. Users install the
prebuilt font; neither Python package is needed to run UsageStat or Polybar.
"""
import json
import math
from pathlib import Path
import re
import xml.etree.ElementTree as ET

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.transform import Identity, Transform
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib import SVGPath
from fontTools.ttLib.tables._g_l_y_f import flagOverlapSimple
import pathops

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parents[1] / 'assets/provider-icons'
MAPPING = HERE / 'glyphs.json'
FONT = HERE / 'UsageStatProviderIcons.ttf'


def transform(text):
    result = Identity
    for name, args in re.findall(r'(\w+)\(([^)]+)\)', text):
        values = [float(value) for value in re.split(r'[\s,]+', args.strip())]
        if name == 'matrix': result = result.transform(Transform(*values))
        elif name == 'translate': result = result.translate(values[0], values[1] if len(values) > 1 else 0)
        elif name == 'scale': result = result.scale(values[0], values[-1])
        elif name == 'rotate':
            cx, cy = values[1:] if len(values) == 3 else (0, 0)
            result = result.translate(cx, cy).rotate(math.radians(values[0])).translate(-cx, -cy)
        else: raise ValueError(f'Unsupported SVG transform: {name}')
    return result


def outline(root):
    """Preserve holes, strokes and group transforms before converting to TTF."""
    result = pathops.Path()
    x, y, width, height = map(float, root.attrib['viewBox'].split())
    bounds = pathops.Path()
    pen = bounds.getPen()
    pen.moveTo((x, y)); pen.lineTo((x + width, y)); pen.lineTo((x + width, y + height)); pen.lineTo((x, y + height)); pen.closePath()

    def visit(element, inherited, matrix):
        nonlocal result
        tag = element.tag.rsplit('}', 1)[-1]
        if tag in ['defs', 'title']: return
        style = {**inherited, **element.attrib,
                 **dict(re.findall(r'([\w-]+)\s*:\s*([^;]+)', element.get('style', '')))}
        matrix = matrix.transform(transform(element.get('transform', '')))
        if tag in ['svg', 'g']:
            for child in element: visit(child, style, matrix)
            return
        if tag not in ['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line']:
            raise ValueError(f'Unsupported SVG element: {tag}')
        shape = pathops.Path()
        attrs = {key: value for key, value in element.attrib.items() if key != 'transform'}
        SVGPath.fromstring(ET.tostring(ET.Element(element.tag, attrs))).draw(shape.getPen())
        painted = pathops.Path()
        if style.get('fill', 'currentColor') != 'none':
            shape.fillType = pathops.FillType.EVEN_ODD if style.get('fill-rule') == 'evenodd' else pathops.FillType.WINDING
            painted = pathops.simplify(shape)
        if style.get('stroke', 'none') != 'none':
            stroke = pathops.Path(shape)
            stroke.stroke(float(style.get('stroke-width', 1)),
                          {'butt': pathops.LineCap.BUTT_CAP, 'round': pathops.LineCap.ROUND_CAP, 'square': pathops.LineCap.SQUARE_CAP}[style.get('stroke-linecap', 'butt')],
                          {'miter': pathops.LineJoin.MITER_JOIN, 'round': pathops.LineJoin.ROUND_JOIN, 'bevel': pathops.LineJoin.BEVEL_JOIN}[style.get('stroke-linejoin', 'miter')],
                          float(style.get('stroke-miterlimit', 4)))
            stroke.convertConicsToQuads(0.01)
            painted = pathops.op(painted, stroke, pathops.PathOp.UNION)
        transformed = pathops.Path()
        painted.draw(TransformPen(transformed.getPen(), matrix))
        # Keep independently painted paths as separate, correctly wound
        # contours. Boolean union can drop nearly coincident edges (Doubao).
        result.addPath(pathops.op(transformed, bounds, pathops.PathOp.INTERSECTION))

    visit(root, {}, Identity)
    return result


def main():
    # Retain codepoints when logos are added or removed. Supplementary private
    # use in Plane 16 avoids Nerd Fonts' BMP and Plane 15 assignments.
    mapping = json.loads(MAPPING.read_text()) if MAPPING.exists() else {}
    mapping['generic'] = 0x100000
    paths = sorted(path for path in ASSETS.glob('*.svg') if '-color' not in path.stem)
    for path in paths:
        if path.stem not in mapping: mapping[path.stem] = max(mapping.values(), default=0x100000) + 1
    glyphs = {'.notdef': TTGlyphPen(None).glyph(), 'space': TTGlyphPen(None).glyph()}
    cmap = {32: 'space'}
    roots = [(path.stem, ET.parse(path).getroot()) for path in paths]
    roots.append(('generic', ET.fromstring('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>')))
    for key, root in roots:
        x, y, width, height = map(float, root.attrib['viewBox'].split())
        scale = 900 / max(width, height)
        matrix = Transform(scale, 0, 0, -scale, (1000 - width * scale) / 2 - x * scale,
                           400 + height * scale / 2 + y * scale)
        pen = TTGlyphPen(None)
        outline(root).draw(TransformPen(Cu2QuPen(pen, max_err=0.5, reverse_direction=True), matrix))
        glyph = pen.glyph()
        if not glyph.numberOfContours: raise ValueError(f'Empty logo: {key}')
        glyph.flags[0] |= flagOverlapSimple
        name = f'logo.{key}'
        glyphs[name] = glyph
        cmap[mapping[key]] = name
    font = FontBuilder(1000, isTTF=True)
    font.setupGlyphOrder(list(glyphs))
    font.setupCharacterMap(cmap)
    font.setupGlyf(glyphs)
    font.setupHorizontalMetrics({name: (500 if name == 'space' else 1000, getattr(glyph, 'xMin', 0)) for name, glyph in glyphs.items()})
    font.setupHorizontalHeader(ascent=900, descent=-100)
    font.setupNameTable({'familyName': 'UsageStat Provider Icons', 'styleName': 'Regular',
                        'uniqueFontIdentifier': 'UsageStatProviderIcons-1.0', 'fullName': 'UsageStat Provider Icons',
                        'psName': 'UsageStatProviderIcons', 'version': 'Version 1.0',
                        'copyright': 'Provider logos from the bundled UsageStat assets/provider-icons.'})
    font.setupOS2(sTypoAscender=900, sTypoDescender=-100, usWinAscent=900, usWinDescent=100)
    font.setupPost()
    font.setupMaxp()
    font.font['head'].created = font.font['head'].modified = 2082844800  # Reproducible, 1970-01-01.
    font.save(FONT)
    MAPPING.write_text(json.dumps(mapping, indent=2, sort_keys=True) + '\n')
    print(f'{FONT.name}: {len(paths)} provider logos')


if __name__ == '__main__':
    main()
