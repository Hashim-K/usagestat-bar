# Linux popup section alignment: fixes and native review

Popup alignment now uses the actual UsageStat widget section. Left matches
the section's left edge, center matches its center, and right matches its
right edge. Side panels use the section's top, center and bottom. Neighboring
modules and the rest of the panel are excluded. Screen/work-area boundaries
may clamp the result.

The [new review gallery](http://127.0.0.1:34985/section-fixes/index.html)
contains a video and per-step screenshots for all 12 Linux profiles.
The [earlier audit](linux-section-alignment-2026-09-11.md) and its failed
captures remain available; they have not been relabeled as passing.

## Changes

- LXQt and Budgie now have native panel widgets that supply their actual
  bounds. These also use the shared artwork and provider interactions.
- COSMIC now hosts a native applet and popup, anchored to its widget. Its
  popover shares the application view and resizes with provider content.
- i3 and bspwm use a private `usagestat-polybar` build that exports the
  rendered UsageStat action section. It includes actual module padding and
  layout offsets. The system Polybar binary is left in place.
- GNOME's popup body now aligns with the section independently of the
  shell's arrow positioning. Plasma's existing native alignment was verified.
- Cinnamon, MATE, Xfce and Waybar publish geometry before the first click,
  so shortcut activation can use the current section. Budgie's side-panel
  orientation and COSMIC's popup buffer geometry were also corrected.
- Whole-panel and whole-monitor geometry fallbacks were removed. Generic
  tray activation and the Waybar text fallback open the application window
  when the host supplies no section bounds; anchored popups require the
  native integration.

Install the new adapters with `--native lxqt`, `--native budgie`,
`--native cosmic` or `--native polybar`. LXQt uses the
`usagestat-lxqt-panel` launcher for user plugin discovery; Polybar configurations
must run `usagestat-polybar`. See the [installation guide](../LINUX.md).
The default local Fedora preview image now includes the tested native build
dependencies and private Polybar binary.

## Native results

| Profile | Passed | Failed | Unsupported |
| --- | ---: | ---: | ---: |
| GNOME | 19 | 0 | 1 |
| Plasma | 34 | 0 | 0 |
| Cinnamon | 35 | 0 | 0 |
| MATE | 35 | 0 | 0 |
| Xfce | 35 | 0 | 0 |
| LXQt | 35 | 0 | 0 |
| Budgie | 35 | 0 | 0 |
| COSMIC | 35 | 0 | 0 |
| Sway | 35 | 0 | 0 |
| Hyprland | 35 | 0 | 0 |
| i3 | 27 | 0 | 2 |
| bspwm | 27 | 0 | 2 |
| **Total** | **387** | **0** | **5** |

Unsupported checks are GNOME's fixed top-panel edge and Polybar's lack of
vertical panels (two checks each for i3 and bspwm). They are not counted as
passes. The GNOME and port drivers have different check coverage; the gallery
lists every check individually.

The port runs exercise pinning, provider count, bar and popup scrolling in
both directions, disabled scrolling, content resizing, long-content scrolling,
outside-click dismissal, Escape and reopening, panel region/index, supported
panel edges, and matching popup alignment. Native adapters also exercise the
shortcut's D-Bus toggle command before the first panel click. This verifies
the command path, not every desktop's keybinding registration interface.

For bspwm, the rendered section starts at x=637 and is 258 pixels wide. The
popup is 460 pixels wide, with the neighboring module excluded:

| Alignment | Expected popup x | Recorded popup x | Error |
| --- | ---: | ---: | ---: |
| Left | 637 | 635 | −2 px |
| Center | 536 | 535 | −1 px |
| Right | 435 | 434 | −1 px |

Compare the [left capture](http://127.0.0.1:34985/section-fixes/bspwm/25-popup-alignment-left.png),
[center capture](http://127.0.0.1:34985/section-fixes/bspwm/26-popup-alignment-center.png)
and [right capture](http://127.0.0.1:34985/section-fixes/bspwm/27-popup-alignment-right.png),
or watch the [bspwm video](http://127.0.0.1:34985/section-fixes/bspwm/review.mp4).
The port assertions allow four pixels for sampled screenshot bounds and
window borders; they reject the previous whole-panel offsets. GNOME's three
recorded alignment errors are all zero pixels.

## Evidence and validation scope

The selected results come from `artifacts/linux-section-reviewed-2026-09-11`
(Cinnamon, MATE, Xfce, LXQt and Budgie) and
`artifacts/linux-section-rechecked-2026-09-11` (the remaining profiles).
The gallery's `summary.json` records the selected source directory, counts,
observations and screenshots for each profile. Earlier diagnostic runs remain
in their original directories.

The port runner freezes source files before launching a session and records
their hashes, image identity and runtime versions. GNOME uses a separately
packaged extension copied into its nested session. Recorded input events,
native geometry calls and logs accompany the results. All 12 H.264 videos
were decoded successfully; recordings are unedited captures at five frames
per second.

These are single-output native desktop sessions with synthetic provider data.
Settings changes use the real configuration interfaces, rather than clicking
every Preferences control. This is not a multi-monitor, fractional-scale or
every-distro certification. The COSMIC and Hyprland lab images retain their
documented compositor compatibility patches; the recordings identify those
builds. The Fedora image was updated from the existing lab image, rather than
rebuilding the unchanged COSMIC source stage from scratch.

Additional validation passed: 29 GJS contract checks, six focused placement
tests, normal package installation/upgrade/removal, and real native builds
and installation/upgrade/removal for LXQt, Budgie, COSMIC and Polybar. Native
lifecycle checks cover unusual installation paths, persisted adapter choices,
owned files and collision preservation.
