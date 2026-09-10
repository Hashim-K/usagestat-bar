# Polybar, COSMIC and bspwm fixes — 11 September 2026

**Correction after manual review:** the popup-alignment pass claims below are
withdrawn. The old test accepted three distinct, repeatable screen positions
instead of comparing the popup to the UsageStat section. This missed a real
implementation gap in Polybar and the generic tray integrations. See the
[section-alignment audit](linux-section-alignment-2026-09-11.md). The original
recordings and raw results are preserved, but they do not establish working
section alignment on i3, bspwm, LXQt, Budgie or COSMIC.

Polybar now displays provider logos instead of initials. COSMIC keeps wheel
scrolling after the number of tray providers changes. The bspwm popup paints
normally and applies its configured position on opening, resizing and reopening.

The original [video and screenshot gallery](http://127.0.0.1:34985/) reported **six fresh
suites: 166 passed, zero failed, four unsupported**. The other six recordings
are retained from 9 September and clearly labelled. The combined gallery has
**320 passed, zero failed, five unsupported**, 12 playable MP4s and 320 per-step
screenshots. All videos decoded successfully, all 358 gallery links returned
HTTP 200, and all twelve wallpaper checksums match the current website manifest.

See the [local gallery](../../artifacts/linux-fixes-2026-09-11-gallery/index.html),
[six-desktop overview](../../artifacts/linux-fixes-2026-09-11-gallery/fixed-desktops.png),
[raw results](../../artifacts/linux-fixes-2026-09-11-gallery/summary.json), and
[media verification](../../artifacts/linux-fixes-2026-09-11-gallery/media-verification.json).
The [original failed recordings](linux-behaviour-web-wallpapers-2026-09-09.md)
remain available; they were not overwritten.

| Profile | Recording | Passed | Unsupported |
| --- | --- | ---: | ---: |
| COSMIC | Fresh, 11 September | 29 | 0 |
| bspwm | Fresh, 11 September | 26 | 2 |
| i3 | Fresh, 11 September | 26 | 2 |
| MATE | Fresh, 11 September | 28 | 0 |
| Xfce | Fresh, 11 September | 28 | 0 |
| LXQt | Fresh, 11 September | 29 | 0 |
| GNOME | Retained, 9 September | 19 | 1 |
| Plasma | Retained, 9 September | 27 | 0 |
| Cinnamon | Retained, 9 September | 27 | 0 |
| Sway | Retained, 9 September | 27 | 0 |
| Hyprland | Retained, 9 September | 27 | 0 |
| Budgie | Retained, 9 September | 27 | 0 |

The unsupported cases are vertical Polybar panels on i3/bspwm and GNOME's fixed
top-panel edge. They are not counted as passes.

## Changes and evidence

**Polybar logos.** The installer registers a bundled font generated from all 155
monochrome SVG assets. Provider aliases and renamed accounts resolve to their
logo; unknown icon IDs use a neutral fallback. Stable Plane 16 private-use
codepoints avoid the ranges used by Nerd Fonts. Actual i3 and bspwm Polybar logs
confirm the installed font was loaded, and the opening screenshots show the
Codex and Claude logos. Add the font to an existing bar configuration using the
[setup instructions](../LINUX.md#waybar-text-fallback-and-polybar).
Complete monochrome logos are supported; color artwork, custom image files and
partial logo fills still require a graphical adapter.

**COSMIC wheel input.** The native status area could stop sending `Scroll`
after a provider slot disappeared, while clicks still worked. When the slot
layout changes on COSMIC, UsageStat now unregisters its own entries and gives
the host a short removal interval before registering the new layout. Ordinary
provider scrolling retains the same entries and adds no delay.
The fresh recording passes the original count-reduction case and a new sequence
of **3 → 1 → 2 → 1** providers, with native wheel input in both directions at
each count. An independent tray fixture remains registered throughout. LXQt
passes the same coexistence scenario without using the COSMIC workaround.

**bspwm popup.** Opening at 1% GTK opacity produced a nearly black surface
without a compositor. The popup now renders at normal opacity. The placement
helper also skips redundant `bspc` floating requests, which return a failure
status for an already-floating window, and accounts for the X11 border when
positioning the client. The final bspwm application log is empty; painting,
resizing, reopen and left/center/right alignment checks pass. MATE, Xfce, i3,
LXQt and COSMIC provide regression coverage for the shared popup changes.

The added paint check requires visible labels and a selected tab, rather than
accepting window geometry alone. It supports both light and dark themes; the
COSMIC capture uses a dark theme. An initial COSMIC batch started before the
native tray host was ready. The runner now waits for the host registration
before starting tray scenarios, and the subsequent complete run passes. The
initial startup failure remains in `artifacts/linux-fixes-2026-09-11/cosmic`;
the selected complete COSMIC run is in `artifacts/linux-fixes-2026-09-11-cosmic-ready/cosmic`.

## Other checks and runtime limits

- All 29 Linux contracts pass, including real Polybar glyphs, aliases, renamed
  accounts and unknown-icon fallbacks.
- All 155 generated glyphs pass comparison with their source SVG silhouettes
  and cutouts. Repeated generation is byte-identical.
- Linux packaging passes install, upgrade, uninstall and unrelated-file
  preservation checks, including the new font registration.
- The native tray lifecycle check passes 80 lifecycles and 160 property
  snapshots under collection in the lab container.

The fresh recordings use Fedora lab image `6a77c925e01d`, including the existing
COSMIC 1.6.0 Smithay layer-role patch. Retained Hyprland footage uses the existing
0.56.2 pointer-focus backport. These are the patched lab versions documented in
the [compositor report](linux-interaction-validation-2026-09-09.md), not claims
about every stock distro package. The lab images and wallpapers were not rebuilt
for these application fixes.

Each recording includes its image ID, source fingerprint and package versions.
Captures were made from the working tree based on `72ad415`, so their metadata
correctly reports a dirty tree. The fingerprints differ as the harness gained
the tray readiness wait and the renderer gained unknown-ID guards during the
batch. The recordings use synthetic accounts, real native mouse/wheel input,
and unedited frames encoded at 5 FPS. Settings are applied through native
configuration interfaces; these runs do not click every Preferences widget or
validate global shortcuts, touchpad gestures, multiple monitors or full distro
login/reboot. Manual appearance review remains separate.

## Reproduce and serve

```bash
python3 tests/linux/review.py bspwm --output artifacts/new-bspwm-review
USAGESTAT_LAB_TRAY_COMPANION=1 python3 tests/linux/review.py cosmic --output artifacts/new-cosmic-review
```

Replace the desktop with `i3`, `mate`, `xfce` or `lxqt` for the other fresh suites.
See [recording instructions](../LINUX.md#recorded-interaction-checks) for the full
matrix and gallery generator. To serve the completed gallery again:

```bash
python3 -m http.server 34985 --bind 127.0.0.1 \
  --directory artifacts/linux-fixes-2026-09-11-gallery
```

Videos, screenshots and logs remain in the ignored local artifact directories.
The code, font, regression checks and this report are tracked in the repository.
