# Polybar

Install the Linux bundle with `--native polybar`, add `UsageStat Provider Icons` to your bar's font list,
then merge [config.ini](config.ini) and add `usagestat` to a modules list. See the
[Linux setup guide](../../docs/LINUX.md#waybar-text-fallback-and-polybar).

Run **`usagestat-polybar`** with the arguments from your existing panel launch
command. This private Polybar 3.7.2 build leaves the distribution's executable
alone. The stock script-module API cannot expose a module rectangle; the small
[section patch](section-geometry.patch) reports the actual UsageStat click block
after fonts, padding and neighboring modules have been laid out. Keep
`click-left = usagestat-bar toggle`, which identifies that block.

The popup aligns its left/center/right edge to that section, not to the entire
panel or the pointer. It reads `_USAGESTAT_SECTION_V1` again on each open and
resize, so module movement and width changes are reflected. Stock Polybar
without the property opens the application as a fallback; it cannot promise
section alignment. Polybar supports top/bottom bars, not vertical panels.

The installer builds from pinned upstream commit
`b3af5a33166604c689705d7dc67b69c01482d707`, including its pinned submodules.
The first build requires network access, Git, CMake, Make, a C++ compiler and
Polybar development dependencies. On Fedora the lab uses:

```text
gcc-c++ cmake make git patch pkgconf-pkg-config
cairo-devel freetype-devel fontconfig-devel libxcb-devel
xcb-util-devel xcb-util-cursor-devel xcb-util-image-devel xcb-util-wm-devel
xcb-util-xrm-devel xcb-util-renderutil-devel xcb-util-keysyms-devel
pulseaudio-libs-devel alsa-lib-devel libcurl-devel libnl3-devel libuv-devel
xcb-proto jsoncpp-devel i3-devel
```

`USAGESTAT_BUILD_JOBS` sets build parallelism (default 2). Offline builders can
set `USAGESTAT_POLYBAR_SOURCE` to a clean checkout of that exact revision with
its submodules initialized. The patch also supplies explicit standard integer
headers and FreeType/Fontconfig linkage needed by newer toolchains.

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
