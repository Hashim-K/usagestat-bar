# Linux preview fixes and interaction review — 9 September 2026

For fresh recordings using the website's updated wallpapers, see the
[later behaviour review](linux-behaviour-web-wallpapers-2026-09-09.md).
This report preserves the original run and its earlier wallpaper selections.

The Hyprland and COSMIC preview failures from the [previous recording](linux-interaction-validation-2026-09-08.md) are fixed in the lab images. Both previews retain keyboard input, close on a second panel click or an outside click, and reopen at the configured panel edge/alignment. These results use patched compositor builds, as described below; they do not establish that the stock packages handle the same cases.

The new default panel is **logo → usage bar → percentage**, with the **session / primary** meter. Existing explicit appearance and meter overrides remain effective. Every preview uses the [requested distro wallpaper](linux-preview-wallpapers.md), including the exact Sway Blue image, Omarchy's first Tokyo Night wallpaper and EndeavourOS for i3. The wallpaper choice does not change the underlying Fedora/Arch lab runtime into that distro.

## Videos and screenshots

Open the [local gallery](../../artifacts/linux-interaction-validation-2026-09-09/index.html), or serve it in a browser:

```bash
python3 -m http.server 34985 --bind 127.0.0.1 \
  --directory artifacts/linux-interaction-validation-2026-09-09
```

The browser address is `http://127.0.0.1:34985/`. Direct videos are available at `http://127.0.0.1:34985/PLATFORM/review.mp4`, including [COSMIC](http://127.0.0.1:34985/cosmic/review.mp4) and [Hyprland](http://127.0.0.1:34985/hyprland/review.mp4).

The gallery contains **12 MP4 recordings and 312 per-step screenshots**, raw observations and package/source/image metadata. Videos contain unedited desktop frames encoded at 5 FPS; step seek times are approximate. The [media verification](../../artifacts/linux-interaction-validation-2026-09-09/media-verification.json) confirms that every video decodes and every local gallery link exists. Captures use synthetic accounts. Artifacts stay local to the checkout and are not added to GitHub. `wallpaper.json` identifies and hashes each background; compositor build files identify the patched binaries.

## Coverage

All twelve profiles passed their supported scenarios: **312 passed, zero failed, five unsupported**. The [raw matrix](../../artifacts/linux-interaction-validation-2026-09-09/summary.json) retains the unsupported cases.

| Profile | Passed | Unsupported | Scope |
| --- | ---: | ---: | --- |
| GNOME | 19 | 1 | Native Shell reference; fixed top edge |
| Plasma | 27 | 0 | Native widget and popup |
| Cinnamon | 27 | 0 | Native applet |
| MATE | 27 | 0 | Native applet |
| Xfce | 27 | 0 | Native plugin |
| LXQt | 27 | 0 | Native StatusNotifier tray |
| Sway | 27 | 0 | Native Waybar widget |
| Hyprland | 27 | 0 | Native Waybar widget; patched compositor |
| Budgie | 27 | 0 | Native tray |
| COSMIC | 27 | 0 | Native status area; patched compositor |
| i3 | 25 | 2 | Polybar; horizontal panels only |
| bspwm | 25 | 2 | Polybar; horizontal panels only |

The scenarios exercise ordered provider pins, count reduction, six wheel notches in both directions with wraparound, independent bar/popup scrolling controls, short-provider sizing, overflow scrolling, native panel clicks, second-click toggle, outside dismissal, and Preferences opening. All eleven port profiles also exercise Escape and reopening. Placement checks move between panel groups, before/after a neighbor, supported screen edges, and all three popup alignments with reopening.

Settings are applied through native configuration/GSettings/API interfaces; these recordings do not click every Preferences widget. GNOME has a narrower sizing scenario than the shared window. Global shortcut registration, touchpad gestures, multiple monitors, login/reboot and full distro installations are outside this pass. The user's manual appearance review remains pending for the other desktops.

## Fixes and evidence

**Hyprland:** opening a keyboard-focusable layer surface in 0.56.2 changed pointer focus even though the pointer remained over Waybar. The preview build backports the on-map part of the [upstream pointer-focus correction](https://github.com/hyprwm/Hyprland/commit/d29916a91c201cc7043aa68ace2e5dfba59c13d8). Popups retain on-demand keyboard focus, so Escape remains usable. The recipe pins the 0.56.2 source commit and records the patch in `hyprland-build.txt`.

**COSMIC:** UsageStat now sets the output and layer anchors before its initial map. Separately, closing a layer triggered Smithay's precommit validation after the layer role was already destroyed, rejecting GTK's null-buffer commit and disconnecting the application. The private COSMIC 1.6.0 build adds a live-role check to the locked Smithay revision. This is a local preview patch, not an upstream release or a host compositor replacement.

COSMIC's native Wayland compositor now renders inside a fixed 1280 × 800 private X11 preview surface. Capturing that parent avoids the failing nested Wayland/EGL screencopy route. Real pointer events enter COSMIC through that surface and the native status area emits its normal D-Bus events. The pointer driver includes the final two pixels of motion inside an icon before input, so the status area's hover state is established as it is during physical mouse movement. `tray-input.log` records the native events; no extra wheel notches are injected to force a result.

COSMIC panel edge/output and icon contrast now follow the panel's own configuration. Inactive provider-tab icons follow the actual GTK foreground color, including palettes generated independently of libadwaita's light/dark setting.

The minimal Cinnamon recorder paints its configured wallpaper directly because Cinnamon's background daemon otherwise waits for a session-manager signal that this minimal profile does not emit. The interactive Cinnamon preview retains the full session and its native background settings. MATE's native background setting is also populated so its interactive settings daemon uses the selected Ubuntu MATE artwork.

**Tray restarts:** an LXQt run exposed a stale introspection cache after repeated tray reconstruction. The service now reuses its two D-Bus interface descriptions for its lifetime. A dedicated regression reproduced missing properties with the old code at lifecycle 10; the fix passes 80 create/read/destroy cycles and 160 native property snapshots with forced garbage collection. The native LXQt, Budgie and COSMIC recordings were repeated after this change. The earlier failing LXQt run remains under `artifacts/linux-fixes-2026-09-09-final/lxqt`; the gallery selects the corrected run from the later tray batch.

The shared Linux contracts passed **28/28**, the core suite **36/36**, and the build/install/upgrade/uninstall package checks passed. Python and shell syntax and whitespace checks passed. Run the tray lifecycle regression inside the Fedora lab image with `bash /src/tests/linux/tray-lifecycle.sh`; it creates its own disposable X server, D-Bus session and settings.

## Reproduce

Rebuild both images, then follow the [recording instructions](../LINUX.md#recorded-interaction-checks). Wallpaper downloads and compositor source fetches happen only during image builds. Review sessions run with networking disabled.

To interact yourself using your existing backend:

```bash
python3 tests/linux/manual.py cosmic --backend /usr/bin/usagestat-dev
python3 tests/linux/manual.py hyprland --backend /usr/bin/usagestat-dev
```

These commands open manual previews without scripted input. The backend bridge and desktop settings stay private to each preview.
