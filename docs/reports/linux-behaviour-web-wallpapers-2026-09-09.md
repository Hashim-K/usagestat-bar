# Linux behaviour recordings with website wallpapers — 9 September 2026

All twelve Linux profiles were recorded again using the [wallpapers selected by usagestat-web at ca2ee11](linux-preview-wallpapers.md). The fresh result is **311 passed, one failed, five unsupported**. Eleven profile suites passed; COSMIC's provider-count/scroll case failed in two independent full runs. The failure remains visible in the gallery and is not replaced by an older passing result.

Open the [video and screenshot gallery](http://127.0.0.1:34985/), its [local index](../../artifacts/linux-behaviour-2026-09-09-web-gallery/index.html), or the [desktop overview](../../artifacts/linux-behaviour-2026-09-09-web-gallery/desktop-overview.png).

The gallery contains **12 primary MP4s and 312 per-step screenshots**, plus a second COSMIC recording with 27 screenshots showing the same failure. All 13 videos decode successfully. All local gallery links resolve, and all twelve original wallpaper checksums match the website's `public/desktops/sources.json`. See [media verification](../../artifacts/linux-behaviour-2026-09-09-web-gallery/media-verification.json), [raw results](../../artifacts/linux-behaviour-2026-09-09-web-gallery/summary.json), and each profile's `wallpaper.json` for evidence. Original failed captures and logs are preserved.

| Profile | Passed | Failed | Unsupported |
| --- | ---: | ---: | ---: |
| GNOME | 19 | 0 | 1 |
| Plasma | 27 | 0 | 0 |
| Cinnamon | 27 | 0 | 0 |
| MATE | 27 | 0 | 0 |
| Xfce | 27 | 0 | 0 |
| LXQt | 27 | 0 | 0 |
| Sway | 27 | 0 | 0 |
| Hyprland | 27 | 0 | 0 |
| Budgie | 27 | 0 | 0 |
| COSMIC | 26 | 1 | 0 |
| i3 | 25 | 0 | 2 |
| bspwm | 25 | 0 | 2 |

The five unsupported cases are GNOME's fixed top-panel edge and vertical Polybar panels on i3/bspwm. These are not counted as passes. Scenarios cover ordered provider pins, count reduction, wheel scrolling in both directions, independently disabling bar and popup scrolling, content resizing/overflow, click toggling, outside dismissal, panel groups/item order/edges, and popup alignment/reopening. Port profiles also exercise Escape and Preferences opening.

## Findings requiring follow-up

**COSMIC — scrolling after reducing tray provider count.** Start with three slots, pin Claude and Codex, and select Copilot in the free slot. Scrolling that free slot works. Reduce to one provider, select Claude, then send one downward wheel notch over the remaining icon. The expected result is Copilot; Claude remains selected. `reduce-provider-count` fails in both fresh full runs; the other 26 COSMIC checks pass. The native StatusNotifier trace contains no `Scroll` call for the failed event, although it records the preceding wheel events. This places the observed interruption before UsageStat's D-Bus scroll handler; it does not yet identify a compositor or status-area fix.

Review the [first COSMIC video](http://127.0.0.1:34985/cosmic/review.mp4), [failed screenshot](http://127.0.0.1:34985/cosmic/13-reduce-provider-count.png), and [independent repeat](http://127.0.0.1:34985/cosmic-repeat/review.mp4). The raw input coordinates and native calls are included in `input-events.jsonl` and `tray-input.log`. Additional isolated diagnostics reproduce missing input after changing the count; their files remain under `artifacts/linux-behaviour-2026-09-09-web-diagnostic/cosmic`.

**bspwm — popup painting during opening.** Some opening/placement screenshots show a black popup surface; subsequent popup-scrolling screenshots display the content. Input and geometry assertions pass, but they do not assert complete painting at the instant of every capture. The original frames remain available for manual review; the overview uses the later provider-scrolling screenshot. This visual observation is not counted as an additional automated failure.

## Runtime and scope

Application code is unchanged from `43e3d0e`. The wallpaper manifest, GNOME cache handling, and image artwork refresh are the only executable changes in this regeneration. All eleven port runs share source fingerprint `dca32f346d664672eb25ffe72978012eb29100624184997999a9c4589459e19b`. The review used Fedora image `6a77c925e01d`, Arch/Hyprland image `62ca881e7721`, and isolated GNOME Shell 50.4. Full fingerprints and package versions are stored beside the captures.

The existing Hyprland 0.56.2 pointer-focus backport and COSMIC 1.6.0 Smithay layer-role patch are retained; see the [earlier compositor report](linux-interaction-validation-2026-09-09.md). These results describe those patched lab versions, not stock distro packages. No desktop application behaviour was modified to make the new runs pass.

Wallpapers use original upstream artwork behind the website's exports. GNOME now uses dark Blobs, Plasma Waterfall, Omarchy the sunset deer, and i3 `000.png`; the other eight originals are unchanged. Images were refreshed without reinstalling packages or rebuilding the compositors. Host wallpaper and saved provider configuration were not changed.

The recordings use synthetic accounts and native mouse/wheel input in isolated desktops. Settings are applied through native configuration/GSettings/API interfaces, rather than clicking every Preferences widget. Global shortcut registration, touchpad gestures, multiple monitors, full distro login/reboot, and the user's appearance sign-off remain outside this run. Videos contain unedited captured frames encoded at 5 FPS; step seek times are approximate.

## Reproduce or serve

Use the [recording instructions](../LINUX.md#recorded-interaction-checks). For existing lab images, refresh artwork first:

```bash
USAGESTAT_PODMAN_ROOT=/home/hashim/.local/share/containers/storage \
  bash tests/linux/build-lab.sh backgrounds
python3 tests/linux/review.py all --output artifacts/new-behaviour-review
USAGESTAT_TEST_INTERACTIONS=1 bash tests/gnome-session.sh --check
```

To serve the completed gallery again:

```bash
python3 -m http.server 34985 --bind 127.0.0.1 \
  --directory artifacts/linux-behaviour-2026-09-09-web-gallery
```

The MP4s, screenshots and logs stay in the local ignored artifact directory. The wallpaper selections, provenance and this report are tracked in the repository.
