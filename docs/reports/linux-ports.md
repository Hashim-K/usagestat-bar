# Initial Linux ports — 2026-09-06

Status: **working initial ports with passing fixture checks; full baseline
acceptance remains open**. These results do not certify every Linux distro,
desktop version, session type or architecture.

Implementation revision: `7fe78b7` on local branch `linux-ports`. The checks
below ran with no tracked source changes. The work and artifacts are local,
not yet published. Reference behavior remains [BASELINE.md](../BASELINE.md),
GNOME `9436c383`; fixture version 1 uses synthetic accounts and no credentials.

## Reproduce

Use [the Linux installation and lab instructions](../LINUX.md). Both checked-in
Containerfiles were built successfully before the final run. Each test starts
from a fresh container, installs the runtime bundle and launches the actual
panel/compositor under a private D-Bus and XDG environment. The runtime has no
network access. The build recipes resolve current package repositories;
retain the image and package list for exact version reproduction.

| Image | Tested content ID |
| --- | --- |
| `localhost/usagestat-linux-lab:44` | `09acea43b48878b7200b572ed4db59b8fb9bfb8d9727c3e4887b5a06f8c2bab5` |
| `localhost/usagestat-hyprland-lab:arch` | `d4e8146633e635449b0e714b28aaf94018a23d80e33b5ffa28746f2c6db865d5` |

All runs used **x86_64** on a Fedora 44 GNOME host. Fedora runtime versions:
GJS 1.88.1, GTK 4.22.4, libadwaita 1.9.3, GLib 2.88.3. The Arch image used the
same upstream library versions. Every run's `packages.txt` retains exact distro
package revisions. COSMIC and Hyprland used a passed-through DRM render node
with a private headless labwc parent, not the host display.

## Desktop results

**119 passed across 11 profiles.** All evidence directories below are under `artifacts/`.

| Target | Environment | Checks | Local evidence directory |
| --- | --- | --- | --- |
| Plasma 6.7.4 / KWin 6.7.4 | Fedora 44 / X11 | 10 passed | `linux-plasma.R1FLPG` |
| Cinnamon 6.6.7 | Fedora 44 / X11 | 10 passed | `linux-cinnamon.JQoEkl` |
| MATE panel 1.28.4 / Openbox | Fedora 44 / X11 | 10 passed | `linux-mate.OSVBPp` |
| Xfce panel 4.20.7 / Openbox | Fedora 44 / X11 | 12 passed | `linux-xfce.hG4OGp` |
| LXQt panel 2.4.1 / Openbox | Fedora 44 / X11 | 13 passed | `linux-lxqt.XZAd44` |
| Budgie 10.10.2 / labwc 0.9.6 | Fedora 44 / Wayland | 12 passed | `linux-budgie.xdPcPI` |
| COSMIC panel/comp/applets 1.6.0 | Fedora 44 / Wayland | 12 passed | `linux-cosmic.14E7oQ` |
| Sway 1.11 / Waybar 0.15.0 | Fedora 44 / Wayland | 10 passed | `linux-sway.11Oby1` |
| Hyprland 0.56.2 / Waybar 0.15.0 | Arch / Wayland | 10 passed | `linux-hyprland.EFKLuI` |
| i3 4.25.1 / Polybar 3.7.2 | Fedora 44 / X11 | 10 passed | `linux-i3.cgDXHk` |
| bspwm 0.9.9 / Polybar 3.7.2 | Fedora 44 / X11 | 10 passed | `linux-bspwm.SF6rKM` |

The shared scenario checks cover provider grouping, automatic mean, switching,
used/remaining mode, selected windows, backend failure/recovery, mapped details
and preferences, optional cost failure, extra windows, legacy/array payloads,
zero/full values and a service restart preserving settings. Tray profiles also
check registration, removing/recreating items without leftovers, pixmap/menu
protocol data and activation opening the actual details window. LXQt checks
real notification delivery through Dunst 1.13.2 and suppresses repeated and
downward notifications. Native panel clicks open details on Cinnamon/MATE and
Polybar; Plasma's overview popup is opened and captured separately.

All panel screenshots were reviewed for visible meters and readable content.
GTK details, preferences and error states were also inspected during development.
Screenshot generation and mapped-window assertions are not automated pixel
comparison or a complete input/accessibility test.

The final native GNOME regression run is `artifacts/gnome.MGH3eN`: **12 passed**.
The shared CLI/config suite passed **36 checks** and the Linux model/rendering
suite passed **22**. Both package suites passed. Their logs are
`artifacts/linux-port-backend-contracts.tap`, `linux-port-contracts.tap`,
`linux-port-gnome-package.log` and `linux-port-package.log`.

The distributable bundle is `artifacts/usagestat-bar-linux.tar.gz`. The package
check builds, installs, upgrades and uninstalls in a temporary prefix; verifies
config preservation and refusal of unrelated files/symlinks; and exercises
launcher paths with spaces, quotes, dollar signs, backticks and percent signs.
This is not a VM login test.

## Feature parity and follow-ups

“Passed” applies to the scope stated in the evidence column. Rows containing
manual or incomplete coverage remain **untested** for full acceptance even
where the implementation and some automated checks pass. Platform limitations
have been identified but have **not** been approved as substitutes for the
GNOME baseline. They do not close the platform issues.

| Feature ID | Status | Evidence / remaining work |
| --- | --- | --- |
| CLI-1 | Passed | Existing CLI discovery/config/plugin/source argument handling reused; 36 shared contract checks. |
| CLI-2 | Passed | Same manifest and metric/legacy normalization; extra windows and array/legacy fixtures run in every profile. |
| CLI-3 | Passed | Shared malformed/empty/missing CLI, timeout and direct-process cancellation checks; visible failure and recovery on every profile. Custom command process trees need separate coverage. |
| CFG-1 | Passed | Same config/provider identity model; ordered accounts and a grouped child tested in every profile. |
| CFG-2 | Passed | Same private config writer and stable/dev paths; package checks preserve existing config. Appearance uses a separate Linux schema. |
| CFG-3 | Untested | Existing provider/source/settings pages reused; complete add/remove/reorder, custom commands/icons and credential-entry UI flows still need manual acceptance. |
| DATA-1 | Passed | Same normalized units/reset metadata, clamped display values, all standard/extra windows; representative fixture views checked. |
| DATA-2 | Passed | Explicit selection and hidden-selection fallback in model contracts; native profiles check selected secondary quota. |
| DATA-3 | Passed | Visible-standard mean plus exhausted-primary paid-usage fallback and hidden-paid-quota behavior covered by contracts. |
| DATA-4 | Passed | Used/remaining snapshot percentages, native screenshots and used-quota threshold logic checked. All custom SVG fill/theme combinations still belong to VIEW-3. |
| DATA-5 | Untested | Cost/text/badges available; missing costs do not hide quota. Provider-cost currencies, credits, code review, pace/ETA and service-status details are implemented but lack full dedicated visual acceptance. |
| VIEW-1 | Passed | Actual indicators, grouped details, provider selection, refresh, errors and timestamps rendered; native Plasma overview and GTK windows available. |
| VIEW-2 | Platform limitation | Plasma/Cinnamon/MATE use the shared rich SVG. Tray hosts show compact ring/percentage icons, with host-controlled ordering/placement. Waybar/Polybar have one text meter per provider, without multi-window graphical bars or logos. Full component/pinning/layout combinations remain untested. See #5–#13. |
| VIEW-3 | Untested | Shared provider icon defaults, per-provider icon source/style, colors and SVG fill geometry are implemented; light Plasma/MATE and dark Cinnamon panels reviewed. Arbitrary custom/raster icons, all fill modes and live theme transitions need acceptance; tray/text modes have appearance limits. See #5–#13. |
| VIEW-4 | Untested | Placement uses desktop controls; native click paths and tray activation checked. Vertical panels are implemented but not visually verified. Keyboard/screen readers, popup focus, scaling and multiple monitors remain. See #5–#13 and #16. |
| ALERT-1 | Passed | Model contracts suppress first/repeated/downward observations; actual Dunst delivery and repeat/downward suppression pass on LXQt. Other notification hosts are untested. |
| PREF-1 | Untested | All four existing preferences pages are shared and the real window maps on every target. Every page flow and per-provider navigation still need manual acceptance. |
| ACTION-1 | Untested | Refresh and provider actions checked; status/dashboard links, reset formats and existing setup/tool actions implemented. Launching real links, terminals and installers is intentionally outside the offline fixture run. |
| LIFE-1 | Untested | Service restart preserves settings; tray item count changes leave no duplicates. Full panel/host restart, missing-host transitions and in-flight shutdown integration still need dedicated checks. |
| LIFE-2 | Untested | Actual bundle build/install/upgrade/uninstall passes in disposable prefixes and installs in every native session. Real login/autostart and clean-VM lifecycle across distro families remain in #16. |

Follow-ups are the existing platform issues:
[Plasma #5](https://github.com/Hashim-K/usagestat-bar/issues/5),
[Xfce #6](https://github.com/Hashim-K/usagestat-bar/issues/6),
[Cinnamon #7](https://github.com/Hashim-K/usagestat-bar/issues/7),
[MATE #8](https://github.com/Hashim-K/usagestat-bar/issues/8),
[LXQt #9](https://github.com/Hashim-K/usagestat-bar/issues/9),
[Budgie #10](https://github.com/Hashim-K/usagestat-bar/issues/10),
[COSMIC #11](https://github.com/Hashim-K/usagestat-bar/issues/11),
[Waybar #12](https://github.com/Hashim-K/usagestat-bar/issues/12), and
[Polybar #13](https://github.com/Hashim-K/usagestat-bar/issues/13).

## Test environment findings

- Cinnamon needs its settings daemon and input-source schema in the isolated
  session. Its applet rasterizes the shared SVG through Clutter/GdkPixbuf.
- Plasma's Qt SVG renderer did not reliably display nested SVG viewports;
  flattening logos into transformed groups fixed the actual widget.
- GTK's automatic renderer produced blank Xvfb windows in some minimal
  sessions. The fixture lab explicitly selects Cairo; normal installations
  use GTK's normal renderer selection.
- Budgie's Wayland tray requires `budgie-daemon`; the lab runs its actual panel
  and daemon over labwc. This is not a complete Budgie login session.
- An isolated COSMIC panel containing only an initially empty tray collapsed
  to one pixel. Keeping its normal clock applet avoids that setup problem.
- Waybar's image module constrained a wide SVG to a small square. The shipped
  adapter uses its custom text module. Polybar uses ASCII meter glyphs so the
  default test font cannot silently drop the bars.
- MATE requires its applet search path in the lab/session environment.
- Hyprland is run directly for nested testing and uses its currently accepted
  `.conf` syntax. Its startup/deprecation banners remain in the screenshots;
  they are compositor diagnostics. Future config-format changes need a lab
  recipe update, not a separate UsageStat frontend.
- GLib 2.88 emits a compatibility warning about the old Unix-signal API used
  by GJS. It is not a JavaScript failure. Minimal sessions also lack some
  portal, accessibility, notifications and system-session services.

## Work still open

No live provider accounts were used. Ubuntu/Debian, Mint, openSUSE, ARM,
additional desktop versions, Plasma Wayland, other desktop session types,
clean-VM login, accessibility and display-layout acceptance remain in
[#16](https://github.com/Hashim-K/usagestat-bar/issues/16). LXDE, Pantheon,
Deepin, Enlightenment and other desktops are not claimed based on tray protocol
compatibility alone.

The repository now shares CLI/config/preferences/assets and keeps thin Linux
panel integrations together. A single automated release matrix, interactive
preview workflow and distro-native publishing are still
[#17](https://github.com/Hashim-K/usagestat-bar/issues/17). Windows
[#14](https://github.com/Hashim-K/usagestat-bar/issues/14) and macOS
[#15](https://github.com/Hashim-K/usagestat-bar/issues/15) remain unimplemented.
