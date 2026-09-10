# Polybar

Install the Linux bundle, add `UsageStat Provider Icons` to your bar's font list,
then merge [config.ini](config.ini) and add `usagestat` to a modules list. See the
[Linux setup guide](../../docs/LINUX.md#waybar-text-fallback-and-polybar).

`UsageStatProviderIcons.ttf` contains 155 monochrome logos derived from the
existing SVGs in `assets/provider-icons`, plus a neutral fallback for unknown
icons. `glyphs.json` gives each logo a stable Plane 16 private-use codepoint;
the renderer resolves provider aliases through `providerMetadata.js`.
Polybar uses its configured font fallback, so the logo font can occupy any font
index after the normal text font. No Nerd Font is required.

The font, mapping and runtime adapter ship in the archive. Font generation has
no runtime dependencies. Maintainers can regenerate it in a Python environment
with `fonttools==4.62.1` and `skia-pathops==0.9.2`:

```bash
python3 platforms/polybar/build-font.py
```

Commit the font and mapping together. Existing codepoints must be retained when
adding assets. The generator preserves SVG holes, strokes and transforms, and
produces identical bytes on repeated builds. `tests/linux/polybar-font.py`
compares every rendered glyph against its source silhouette; that development
check needs fonttools, Pillow, PyGObject and the librsvg pixbuf loader.

The text module supports ordered components, pinning, provider count, scrolling,
colored usage meters and percentages. Its glyphs are complete monochrome logos;
SVG color artwork, custom images, partial logo fills and vertical/multi-row
panels need a graphical adapter.
