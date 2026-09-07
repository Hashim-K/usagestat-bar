# Linux port acceptance — 2026-09-07

The Linux ports now have richer panel rendering and repeatable desktop, preferences
and VM lifecycle checks. **The tested combinations pass; full Linux baseline
acceptance remains open for the explicit limitations and untested combinations
below.** This supersedes the [initial Linux report](linux-ports.md).

Subsequent Plasma, application and tray refinements were reviewed manually with
the real backend; Plasma is now **tentatively complete**. See the
[Plasma manual review](plasma-manual-review.md) for that scope. The automated
results in this report apply to the revisions recorded below.

Implementation: `ca215bf` on local branch `linux-ports`, following the panel
and VM work in `44e29ec`. The 11-profile matrix ran on `9113641`; Plasma and
Polybar were repeated on `3763642` with screenshots delayed for their polling
interval. Final VMs use `ca215bf`, including the subsequent symbolic-icon
corrections. GNOME regression uses `9113641`. Every recorded run has a clean
tracked source tree; exact per-run revisions are retained below and in JSON.
The work is committed locally and has not been published.

Reference contract: [BASELINE.md](../BASELINE.md). Machine-readable results:
[linux-acceptance.json](linux-acceptance.json).

## What changed

- Xfce has a native GTK panel plugin. Waybar has a native CFFI v2 widget,
  verified with Waybar 0.15.0. Both render ordered names, logos, percentages and
  multiple quota bars at the panel's width, including vertical layouts.
- Tray icons honor the component choices with up to three quota rings, logos,
  percentages and initials. Polybar and the Waybar text fallback show multiple
  colored meters, with initials for logos. Their remaining graphical limits
  are explicit below.
- Rendering preserves SVG presentation attributes, supports custom raster
  icons and all four logo fill modes, measures labels, and applies custom
  threshold colors to the panel and GTK detail meters.
- Normalization retains paid quota currency, credits, code-review quota, pace
  and service status. Long details scroll, while provider switching by scroll
  is confined to the header. Explicit next/previous still work when scroll
  switching is disabled.
- Preferences keep the requested provider expanded during manifest loading,
  disconnect listeners and cancel pending validation processes on close. A
  standalone GTK window uses the installed Adwaita icon theme for consistent
  symbolic recoloring in light and dark modes.
- Upgrade cancels pending work and restarts the installation's service in its
  previous mode; uninstall stops it. Native launchers no longer depend on a
  login shell's PATH. The standalone UI defaults to the CPU renderer.

Visual review found and fixed defects that process checks did not catch:
GTK detail windows lost their default background class; custom meter colors
were not applied; MATE clipped the image after an orientation change; Ubuntu's
Xfce icon theme omitted preferences icons, while an unthemed fallback did
not recolor them in dark mode. The app now selects Adwaita icons for its own
GTK windows. Test setup also moved the wrong
Plasma panel and added a duplicate Fedora tray. MATE vertical clicks, icon
availability/recoloring and unexpected panel failure dialogs now have explicit checks.
The icon inventory includes asynchronous success/error states. Fresh Xfce
defaults may also list an undefined plugin; tray detection handles that case.

## Desktop matrix

**147 checks passed across 11 profiles.** Evidence paths below are local.

| Desktop / panel | Environment | Checks | Revision | Local evidence |
| --- | --- | --- | --- | --- |
| Plasma / KWin 6.7.4 | Fedora 44 / X11 | 13 passed | `3763642` | `artifacts/linux-plasma.JukRaz` |
| Cinnamon 6.6.7 | Fedora 44 / X11 | 13 passed | `9113641` | `artifacts/linux-cinnamon.X5Km27` |
| MATE panel 1.28.4 / Openbox | Fedora 44 / X11 | 14 passed | `9113641` | `artifacts/linux-mate.18h2wB` |
| Xfce panel 4.20.7 / Openbox | Fedora 44 / X11 | 13 passed | `9113641` | `artifacts/linux-xfce.ICSO9X` |
| LXQt panel 2.4.1 / Openbox | Fedora 44 / X11 | 15 passed | `9113641` | `artifacts/linux-lxqt.XHGubo` |
| Budgie 10.10.2 / labwc 0.9.6 | Fedora 44 / Wayland | 14 passed | `9113641` | `artifacts/linux-budgie.UfgCfr` |
| COSMIC panel/comp 1.6.0 | Fedora 44 / Wayland | 14 passed | `9113641` | `artifacts/linux-cosmic.vATwkZ` |
| Sway 1.11 / Waybar 0.15.0 | Fedora 44 / Wayland | 14 passed | `9113641` | `artifacts/linux-sway.cMAk5O` |
| Hyprland 0.56.2 / Waybar 0.15.0 | Arch / Wayland | 13 passed | `9113641` | `artifacts/linux-hyprland.zn3Eao` |
| i3 4.25.1 / Polybar 3.7.2 | Fedora 44 / X11 | 12 passed | `3763642` | `artifacts/linux-i3.iJUWhV` |
| bspwm 0.9.9 / Polybar 3.7.2 | Fedora 44 / X11 | 12 passed | `3763642` | `artifacts/linux-bspwm.OHMDe6` |

All 11 profiles run real panels/compositors in isolated containers on an
x86_64 Fedora 44 GNOME host. X11 profiles use a private X server; Wayland profiles
use their own compositor. COSMIC and Hyprland use a passed-through DRM render
node under a private labwc parent. No test connects to the host GNOME session.
The containers have no network during acceptance and use synthetic fixtures.

Each profile covers grouping, switching, selected windows, used/remaining mode,
backend failure/recovery, paid metadata and supplemental details, pin/component
order, three bars and custom colors, mapped details/preferences, extra windows,
optional cost failure, legacy/array payloads, boundary values and service
restart. Tray hosts also check item registration/removal, menu/pixmap protocol
and activation. LXQt uses the real notification daemon and checks crossing,
repeat and downward suppression.

Vertical panels were visually reviewed on Plasma, Cinnamon, MATE, Xfce, Sway
and Hyprland. The MATE test clicks the rotated indicator below its former
horizontal bounds. Sway creates two compositor outputs, sets them to 1× and
2×, and moves the details window between them. These are virtual outputs,
not physical monitor hotplug tests. Screenshot review covers indicator
visibility and representative details/preferences; it is not a pixel-golden
comparison or full accessibility certification.

| Container image | Tested content ID |
| --- | --- |
| `localhost/usagestat-linux-lab:44` | `5c461d6888a329e4b6f3c14a70327a86c371e095442f8bb1d71b4aced5cf7e10` |
| `localhost/usagestat-hyprland-lab:arch` | `9b3b9c0d24debdac4dcd922ed4e54088906e3277841586892ab2eb088990877d` |


The build recipes use moving package repositories. The image IDs and each
run's complete `packages.txt` pin the tested environments, not future rebuilds.
Reproduction commands and requirements are in [LINUX.md](../LINUX.md).

Selected unedited screenshots retained with this report: [Plasma components and
colors](linux-acceptance/plasma-appearance.png), [Sway mixed-scale outputs](linux-acceptance/sway-mixed-scale.png),
[Ubuntu dark preferences at 2×](linux-acceptance/ubuntu-dark-2x.png), and
[Fedora provider preferences](linux-acceptance/fedora-providers.png).

## Full VM lifecycle and preferences

| Guest | Session | Results | Local evidence |
| --- | --- | --- | --- |
| Ubuntu 24.04.4 / Xfce 4.18.4 | x86_64 / X11 | 12 lifecycle + 22 preferences passed | `artifacts/vm/ubuntu-verified/evidence` |
| Fedora 44 / Xfce 4.20.7 | x86_64 / X11 | 12 lifecycle + 22 preferences passed | `artifacts/vm/fedora-verified/evidence` |

Ubuntu runtime: GJS 1.80.2, GTK 4.14.5, libadwaita 1.5.0, GLib 2.80.0,
Adwaita icons 46.0. Fedora: GJS 1.88.1, GTK 4.22.4, libadwaita 1.9.3,
GLib 2.88.3, Adwaita icons 50.0. Exact selected package revisions are in JSON.

Ubuntu 24.04.4 [base image](https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img) SHA-256:
`d0fe84bb5f80853425fa6be28e2c106f30104c3cfe8611933f2e65c9b63f0e30`.

Fedora 44 [base image](https://dl.fedoraproject.org/pub/fedora/linux/releases/44/Cloud/x86_64/images/Fedora-Cloud-Base-Generic-44-1.7.x86_64.qcow2) SHA-256:
`28680fe5b371a5a82ebf43a31926e086a168e59949d03969c5093e7071f90b7f`.


Both guests start from checksum-verified upstream cloud images, then provision
real LightDM/Xorg/Xfce login sessions with their own account, disk, SSH key,
D-Bus, settings and fixture backend. These runs test the **tray integration**;
the native Xfce plugin is tested separately in the desktop matrix. They do not
certify every desktop on Ubuntu or Fedora.

Each guest passes 12 lifecycle checks: clean user installation, actual login
autostart without CLI activation or duplicate service, no panel failure dialog,
installed details and provider preferences, upgrade with a backend request in
flight, exact tray recovery after panel restart, explicit versus scroll
switching, Escape input, full reboot/autostart, uninstall stopping the process,
and a further login leaving no app while preserving provider configuration.
Two additional phase checks verify successful preferences reports at both scales.
The guests were rerun after the documented icon/test-setup fixes; the final
indexed phase reports all pass. Earlier failed attempts remain in local logs
and are excluded from the final result set.

Each preferences run exercises 11 checks using the actual GTK widgets:
icon resolution and symbolic recoloring; all four pages and asynchronous provider navigation; display
and multi-window settings; add/rename/reorder; grouped API source and private
synthetic credential persistence; custom commands/icons and removal; hide and
restore; a real desktop URL handler and XTerm/backend launch; light/dark page
rendering; listener cleanup; and cancellation of running validation processes
on close. Across two guests and two scales, **44 preferences checks pass**.
Pointer/keyboard coverage is partial: several controls are activated through
GTK signals rather than a complete mouse-driven user journey.

The scale runs use 1280×800 at 1× and 3840×2160 with `GDK_SCALE=2`; application
themes are forced light and dark. Every page is captured. These checks establish
readability in these configurations, not all desktop themes or fractional scales.
The URL handler and all credentials are synthetic, confined to the guests.
No real provider login or package installer is invoked by these UI fixtures.

## Regression, packaging and live backend

- Shared CLI/config contracts: **36 passed**, unchanged by the final visual fixes.
- Linux model/rendering contracts: **26 passed**, including paid fallback,
  raster icons, all fill modes, threshold colors, multiple text meters and tray
  components. Logs: `artifacts/linux-acceptance-{backend,contracts}.tap`.
- GNOME nested regression: **12 passed** in `artifacts/gnome.pDa9xX`.
- GNOME and Linux package suites: **passed**. They verify release contents,
  install/upgrade/uninstall, config preservation, unusual launcher paths and
  refusal to replace unrelated files/symlinks. Logs are
  `artifacts/gnome-acceptance-package.log` and `artifacts/linux-acceptance-package.log`.
- Live-provider smoke check: **Codex and Claude passed** using `usagestat 1.0.3`.
  Both returned quota and opened a realized/mapped GTK details view in an
  isolated application session. Only provider IDs, backend version and pass/fail
  booleans were retained in `artifacts/linux-live-acceptance.json`; no account
  secrets or private usage values were recorded. This smoke ran before the final
  visual-only fixes; the same backend/model path is unchanged.
- Local Linux archive: `artifacts/usagestat-bar-linux.tar.gz`, SHA-256
  `de62a531a9749c06d393c09803ccafe1cf85b6934d7fc5de578d6a894534d0b9`.

## Row-by-row parity

“Passed” is scoped to the evidence below. A limit or untested combination does
not become an accepted substitute for the GNOME baseline. Platform issues
remain open for that review and the outstanding environment matrix.

| Feature | Status | Evidence / remaining scope |
| --- | --- | --- |
| CLI-1 | Passed | Shared discovery/config/plugin/source argument contracts; installed desktop launchers work outside a terminal PATH. |
| CLI-2 | Passed | Manifest, metric and legacy normalization, including retained paid/supplemental metadata. |
| CLI-3 | Passed | Error/recovery fixtures, timeout/cancellation contracts, actual in-flight upgrade and preferences-close cancellation. Arbitrary custom shell process trees remain untested. |
| CFG-1 | Passed | Identity/order/grouping contracts, all desktop profiles, real add/rename/reorder/hide UI flows. |
| CFG-2 | Passed | Private synthetic credential/config writes and stable/dev separation; config survives upgrade, reboot and uninstall. |
| CFG-3 | Passed | Actual widget flows add/remove/reorder providers and grouped API/custom-command sources, set an icon and restore hidden providers. Real external authentication/setup remains provider-specific. |
| DATA-1 | Passed | Standard/extra quota windows, currency, quantities, resets and clamped boundaries in contracts and native views. |
| DATA-2 | Passed | Selected quota and hidden-selection fallback in contracts and native sessions. |
| DATA-3 | Passed | Visible-standard mean and exhausted-primary paid fallback, including hidden paid quota. |
| DATA-4 | Passed | Used/remaining percentages/fills and used-based thresholds; native screenshots and rendering contracts. |
| DATA-5 | Passed | Costs, credits, code review, pace/ETA, paid currency and service status reach representative native details; optional cost failure leaves quota visible. |
| VIEW-1 | Passed | Visible indicators, grouped details, switches, refresh/errors/timestamps and native Plasma overview; GUI background and icon defects fixed during review. |
| VIEW-2 | Platform limitation | Six rich graphical profiles cover ordered/pinned providers, components, three windows and vertical layouts. Square trays abbreviate names and control item order; Polybar remains text-only. Not every setting combination was exercised. #5–#13. |
| VIEW-3 | Platform limitation | Custom threshold colors and SVG/raster rendering/fill contracts pass; light/dark preferences and representative panel themes reviewed. Tray size and Polybar's lack of image logos constrain parity. Arbitrary malformed custom icons and every theme/fill combination remain untested. #5–#13. |
| VIEW-4 | Untested | Six vertical layouts, Sway mixed-scale virtual outputs, two VM DPI settings, native clicks and basic keyboard actions pass. Fractional scaling, physical hotplug, screen readers and all focus/placement combinations remain. #16. |
| ALERT-1 | Passed | Threshold contracts plus real Dunst notification delivery and suppression in LXQt; other notification daemons remain untested. |
| PREF-1 | Passed | Four pages and representative provider, appearance and tool workflows pass on both library generations at both scales and themes. |
| ACTION-1 | Untested | Real URL handler and XTerm/backend launch, refresh and metadata links pass. Actual provider authentication, backend/plugin installer execution and other terminals remain untested. |
| LIFE-1 | Passed | Service/panel restart, exact item recovery, in-flight upgrade, preferences-close cancellation and full reboot on the two Xfce VM profiles. Other desktop host/lifecycle combinations remain. |
| LIFE-2 | Passed | Clean install/upgrade/login/reboot/uninstall on Ubuntu 24.04 and Fedora 44 Xfce x86_64; native bundle installation in all desktop labs. Other distro/session/architecture combinations remain in #16. |

## Remaining work

- **Tray appearance:** LXQt, Budgie and COSMIC use compact square slots. Three
  rings plus logos, percentages and initials can become cramped at small host
  sizes. Full provider names, arbitrary component placement, wide meters and
  application-controlled item ordering are not equivalent to the GNOME bar.
  Follow-ups: [#9](https://github.com/Hashim-K/usagestat-bar/issues/9),
  [#10](https://github.com/Hashim-K/usagestat-bar/issues/10),
  [#11](https://github.com/Hashim-K/usagestat-bar/issues/11).
- **Polybar:** multiple meters and colors work, but image logos and native
  multi-row graphical layouts remain absent. [#13](https://github.com/Hashim-K/usagestat-bar/issues/13).
  Waybar's text mode has similar limits; the native CFFI widget supplies the
  graphical path. [#12](https://github.com/Hashim-K/usagestat-bar/issues/12).
- **Environment coverage:** full login lifecycle currently covers Xfce on two
  distro families. Arch has nested Hyprland evidence. Debian as a separate
  distro, Mint, openSUSE, a COSMIC reference image, Plasma Wayland, other versions,
  arm64 and additional desktops (LXDE, Pantheon, Deepin, Enlightenment, UKUI)
  remain untested. MATE discovery still requires the documented applet search
  path on builds without user-directory discovery. [#16](https://github.com/Hashim-K/usagestat-bar/issues/16).
- **Input and rendering:** complete keyboard/screen-reader journeys, fractional
  scaling, physical displays, full theme transitions and exhaustive custom-icon
  cases remain. Nested sessions emit expected portal/accessibility/GPU warnings;
  those do not replace the explicit pass/fail and visual checks.
- **Next phase:** coordinated frontend CI, convenient previews and simultaneous
  releases remain [#17](https://github.com/Hashim-K/usagestat-bar/issues/17).
  Windows [#14](https://github.com/Hashim-K/usagestat-bar/issues/14) and macOS
  [#15](https://github.com/Hashim-K/usagestat-bar/issues/15) are later, unimplemented ports.
