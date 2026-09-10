# Linux desktop ports

The first ports are available in this repository. They use the existing
`usagestat` CLI, provider configuration, icons and preferences. They are
**ports checked in desktop labs and disposable VMs**, with remaining appearance limits
tracked in [the roadmap](https://github.com/Hashim-K/usagestat-bar/issues/2).
See the [parity report](reports/linux-acceptance.md) before treating a combination
as fully supported. Windows and macOS remain separate, later tasks.

**Plasma is tentatively complete**, following the user's manual review on
2026-09-07 with the real backend. The [manual review record](reports/plasma-manual-review.md)
covers the panel, popup, application and tray refinements. Other desktops still
need their own manual review of the current version. The
[remaining-desktop review notes](reports/linux-manual-review.md) describe the
follow-up changes and how to open each preview.
The [recorded interaction review](reports/linux-fixes-2026-09-11.md)
covers native clicks, wheel input, provider pins, panel placement and popup
alignment in twelve Linux profiles, with screenshots, videos and runtime limits.
Six affected profiles were re-recorded after the Polybar, COSMIC and bspwm fixes;
the gallery labels the other six recordings retained from 9 September.

## Choose the integration

| Desktop / panel | Integration | Start / add it |
| --- | --- | --- |
| GNOME | Existing Shell extension | Follow the [root README](../README.md) |
| KDE Plasma 6.4+ | Native QML panel widget and popup | Add **UsageStat Bar** in Plasma's widget picker |
| Cinnamon | Native panel applet | Add **UsageStat Bar** in Cinnamon's Applets settings |
| MATE | Native out-of-process panel applet | Set the applet search path below; add **UsageStat Bar** |
| Xfce | Native GTK panel plugin, or tray fallback | Install with `--native xfce`; add **UsageStat Bar** in panel settings |
| LXQt | StatusNotifier tray | Add **Status Notifier** to the panel, run `usagestat-bar tray` |
| Budgie | StatusNotifier tray | Add **System Tray**, run `usagestat-bar tray` |
| COSMIC | Status area | Enable the panel's status area, run `usagestat-bar tray` |
| Sway / Hyprland | Native Waybar CFFI widget, or text fallback | Install with `--native waybar`; merge the generated configuration |
| i3 / bspwm | Polybar script module | Merge the provided module into your Polybar configuration |

Plasma, Cinnamon, MATE, Xfce and the native Waybar widget show ordered bars,
percentages, logos and names, with multiple windows and vertical panels.
Tray icons use a large logo and a small usage bar on a transparent background,
rendered at native tray sizes. **Preferences → Tray** controls them independently
of the panel: show the current provider as one icon, a fixed number of scrolling
providers, all providers, or a chosen set. With a fixed count, scrolling over any
icon advances the unpinned slots and wraps around at the end. **Pinned providers**
keeps selected providers first, in the order they were pinned. One slot remains
available for scrolling; reducing the count releases pins that no longer fit.
Tray pins are separate from panel pins.
Choose a logo with a bar, a quota-filled logo, a logo alone, or a usage percentage.
Logo fill supports vertical, horizontal and pie shapes. Usage bars have adjustable
thickness and horizontal or vertical orientation. Empty tracks automatically
contrast with the usage color and the surface chosen by **Icon contrast**.
Logo colors, contrast, bar color
and scrolling have their own settings. The
right-click menu also opens **Tray settings**. Tray visibility is remembered;
turn **Show tray icons** off to use only a panel widget or the application.
The desktop controls tray size, placement and order. Polybar shows the actual
provider logos using the bundled **UsageStat Provider Icons** font, alongside
colored meters and percentages. The Waybar text fallback uses provider initials;
its native CFFI widget supports image logos. Full names remain in details/tooltips.

Plasma has its own panel popup, with compact provider tiles matching GNOME's
logo, name, mini meter and status-dot layout. Only the selected provider and
its grouped accounts appear in the body. It receives changes over D-Bus;
scrolling and tab selection do not wait for polling or launch CLI processes.
Panel images are rasterized through librsvg at 3× resolution and shared by the
native adapters, so logo fills work consistently in Qt and GTK. Native panel
buttons follow the panel's foreground color and handle smooth scrolling.
The popup uses Plasma's own rounded frame and shadow as its single background.
**Preferences → Appearance → Edit panel** opens Plasma edit mode;
**Open settings** opens Plasma's color-scheme settings.
The same preferences page opens the appropriate settings on Cinnamon and Xfce,
and appearance settings on MATE and LXQt. MATE and LXQt panel placement rows
explain the panel's own context-menu controls. Budgie and COSMIC open their
desktop settings. On Sway and Hyprland, **Panel placement** selects the Waybar
edge, **Provider position** selects its start/center/end module group,
**Position index** sets the order among items in that group (`0` is first), and
**Desktop appearance** selects System/Light/Dark for UsageStat and that Waybar
stylesheet. Changes reload the current session's Waybar. Other modules and
JSONC comments are retained; the original config and stylesheet get a
`.usagestat-backup` copy before the first edit. Polybar shows configuration guidance.
The index range follows the number of other items in the selected group;
when UsageStat is its only item, the index is fixed at `0`. Changing groups
retains the index where possible and clamps it to the new group's last slot.

On LXQt, Budgie and COSMIC, preferences open directly to **Tray**. Controls for
native panel widgets are hidden on these tray integrations so provider count,
scrolling and icon appearance have one clear place to change them.

The separate GTK details window is used by the other integrations and remains
available with `usagestat-bar details`. It follows the popup's provider tiles,
compact account header, quota layout and aligned cost rows. Its tabs stay
visible while long details scroll vertically. Opening usage with a panel's
toggle fits its height to the selected provider, including short loading and
error states. Hyprland caps it to the available monitor area and keeps it
beside the panel when its height changes. All integrations share GTK
preferences. Both details views use the same currency formatting and compact
token counts (`K`, `M`, `B`) as GNOME. Square tray slots and text-only Polybar
modules retain appearance limits; they are documented
in the report and are not claimed as full graphical parity.

## Build and install

Runtime dependencies: Bash, Python 3, GJS, GTK 4, libadwaita, GObject introspection,
GdkPixbuf with SVG support, librsvg with its `Rsvg-2.0` introspection bindings,
the Adwaita icon theme, a session D-Bus and dconf,
plus the `usagestat` CLI. Standalone GTK windows use `adwaita-icon-theme` so
their symbolic controls remain visible in both light and dark application themes.
Wayland panel/tray popups (Sway, Hyprland, Budgie and COSMIC) also need
`gtk4-layer-shell` with its `Gtk4LayerShell-1.0` introspection bindings. Both
preview images include it. GNOME and Plasma use their own native shell popups.
The UI uses GTK 4.12 / libadwaita 1.4 APIs; older library combinations have not
been verified. Python 3 and `glib-compile-schemas` are needed to build/install.
MATE additionally needs Python GObject bindings, GTK 3 and the MatePanelApplet
4.0 typelib. Plasma needs the `org.kde.plasma.workspace.dbus` QML module with
`Properties` support (Plasma 6.4+) and its Plasma 5 Support executable data
engine (`org.kde.plasma.plasma5support`) for starting a missing service. The
optional desktop appearance button opens `systemsettings` or `kcmshell6`.
These are system runtime packages, not npm
or pip dependencies. Exact tested packages are recorded by the lab.

From the checkout:

```bash
./platforms/linux/build.sh artifacts/usagestat-bar-linux.tar.gz
mkdir -p artifacts/linux-install
tar -xzf artifacts/usagestat-bar-linux.tar.gz -C artifacts/linux-install
python3 artifacts/linux-install/usagestat-bar/platforms/linux/install.py
```

The default prefix is `~/.local`. Put `~/.local/bin` on PATH for terminal commands and script modules. Native
widgets use D-Bus activation or an absolute installed launcher, so they do not
require a terminal's PATH to be inherited by the panel. A custom prefix needs
its `share` directory in the desktop session's `XDG_DATA_DIRS`. Set an explicit
backend executable in **Preferences → Behaviour → Binary** if the desktop cannot find your CLI. The existing `USAGESTAT_CLI`
override is also respected.

The installer registers the application launcher, D-Bus service, Plasma widget,
Cinnamon applet and MATE factory under the chosen prefix. It does not add a
widget to your panel automatically. To opt into tray startup at login, use:

```bash
python3 artifacts/linux-install/usagestat-bar/platforms/linux/install.py --autostart
usagestat-bar tray
```

Use autostart for tray desktops. Panel widgets/modules start the service on
demand. Multiple clients share one service in a desktop session. If no tray
host is available, the details window opens with setup guidance.

### MATE discovery

Some MATE builds only search the system applet directory. Add this to the
MATE session environment before starting the panel:

```bash
export MATE_PANEL_APPLETS_DIR="$HOME/.local/share/mate-panel/applets:/usr/share/mate-panel/applets"
```

After starting a new session, use **Add to Panel → UsageStat Bar**. A custom
prefix needs its own `share/mate-panel/applets` path here. The isolated lab
sets this variable explicitly; default discovery without it is not claimed.

### Native Xfce and Waybar widgets

The optional adapters build against the target desktop's GTK 3 libraries.
Install a C compiler, `pkg-config`, GTK 3 development files and JSON-GLib
development files. Xfce also needs its panel development files. On Fedora
these are `gcc pkgconf-pkg-config gtk3-devel json-glib-devel xfce4-panel-devel`;
on Ubuntu they are `gcc pkg-config libgtk-3-dev libjson-glib-dev libxfce4panel-2.0-dev`.

```bash
# Choose the adapter for your desktop; both options may be supplied.
python3 artifacts/linux-install/usagestat-bar/platforms/linux/install.py --native xfce
python3 artifacts/linux-install/usagestat-bar/platforms/linux/install.py --native waybar
```

For Xfce, restart the panel and add **UsageStat Bar** from its item picker.
For Waybar, merge the generated
`~/.local/share/usagestat-bar/platforms/waybar/native.jsonc` into your config,
and add `cffi/usagestat` to a modules list. Set `height` in that module to the
indicator's desired height. For a left/right bar, also set `vertical: true`.
This uses [Waybar's CFFI v2 API](https://github.com/Alexays/Waybar/tree/0.15.0/resources/custom_modules/cffi_example),
verified with Waybar 0.15.0. An installation remembers its chosen adapters and
rebuilds them on upgrade before replacing the running version.

### Waybar text fallback and Polybar

Merge `platforms/waybar/config.jsonc` into your existing Waybar configuration
and add `custom/usagestat` to the desired `modules-left`, `modules-center` or
`modules-right` list. Merge `platforms/waybar/style.css` into your stylesheet.
For Polybar, merge `platforms/polybar/config.ini` and add `usagestat` to your
bar's modules list. Add the logo font to an unused entry in that bar's font list:

```ini
[bar/main]
font-0 = DejaVu Sans:size=11;2
font-1 = UsageStat Provider Icons:pixelsize=20;3
modules-left = usagestat
```

Keep your own text font and other modules. The installer registers the bundled
font under `~/.local/share/fonts/`; restart Polybar after installing or upgrading.
For a custom installation prefix, include its `share/fonts` directory in your
Fontconfig configuration (or use that prefix's `share` as `XDG_DATA_HOME`).
The 155 monochrome logos use Plane 16 private-use glyphs, outside
[Nerd Fonts' assigned ranges](https://github.com/ryanoasis/nerd-fonts/wiki/Glyph-Sets-and-Code-Points).
Provider aliases and renamed accounts keep the appropriate logo. Color artwork,
custom image files and partial logo fills still require a graphical adapter;
the Polybar font renders complete monochrome logos.
Installed examples are in `~/.local/share/usagestat-bar/platforms/`.

Both examples use left click to toggle usage, right click for preferences, middle
click to refresh, and the wheel to switch providers. They keep a `--watch`
client connected to D-Bus, so switching and preference changes update the bar
immediately. Text meters have distinct filled and empty segments, and numeric
indicators include `%`. Plasma's left click opens
its native overview, with a **Details** button for the full GTK view. Cinnamon
has a panel context menu. MATE's right-click menu contains **Preferences** and
the native **Move**, **Lock to Panel** and **Remove From Panel** actions.

Cinnamon, MATE, Xfce, native Waybar and tray icons toggle the popup on a second
left click. **Appearance → Popup alignment** works across the integrations:
Left, Center or Right aligns the popup with its indicator. On a side panel,
these choices mean Top, Center and Bottom, with the popup opening inward.
Cinnamon, MATE, Xfce and native Waybar pass their actual indicator rectangle,
panel edge and monitor area. Tray hosts and text modules do not supply icon
bounds; their fallback is the fixed panel edge, with the same alignment
setting selecting the start, center or end. Click coordinates only identify
the tray's monitor/panel and do not move the popup within it.

Side panels stack providers vertically with upright logos, percentages and
compact names. Component order, provider count, scrolling, logo fill and
contrast settings still apply. Full provider names remain in the tooltip.
X11 popup resizing includes GTK's invisible shadow extents, preserving the
space needed by its content. Short providers shrink; vertical scrolling is
needed only when the content exceeds the available monitor area.
Wayland popups use Layer Shell anchors, so tiling/floating window placement
rules cannot recenter them. X11 popups use the window manager's placement
protocol; i3/bspwm popups are floated explicitly. The application
launcher and explicit `details` command continue to show the application.
Clicking outside the popup dismisses it; Escape and a second indicator click
also close it. The separately launched application stays open. X11 dismissal
uses XInput2 button events (`libXi`), without grabbing clicks from other apps.
Placement controls work with UsageStat directly in a `modules-left`,
`modules-center` or `modules-right` list. They locate the running Waybar's
config and stylesheet, including explicit `--config` and `--style` paths.

Global shortcuts are available through **Preferences → Shortcuts** in the Linux
application. Copy an action's command and assign it in the desktop's keyboard
settings; the page opens that settings tool when installed. Copied commands
use the installed absolute path, so they also work without a terminal PATH.
For Hyprland (Lua or `.conf`), Sway, i3 and bspwm/sxhkd, the page provides
editable-in-your-config binding examples. No bindings are installed or changed
automatically. The actions are:

| Action | Command |
| --- | --- |
| Show / hide the popup | `usagestat-bar toggle` |
| Previous / next provider | `usagestat-bar previous` / `usagestat-bar next` |
| Refresh usage | `usagestat-bar refresh` |
| Open preferences | `usagestat-bar preferences` |

GNOME's native extension exposes the same actions under **Behaviour → Global
shortcuts**, with a key recorder and a remove option. They are disabled by
default and are registered only while the extension is enabled. Install the
updated extension/schema before using them. In a nested preview, grab the
viewer's keyboard so the host desktop does not consume Super shortcuts.
Within the GTK popup/application, Ctrl+Page Up / Page Down switches providers,
F5 refreshes, and Escape closes the window.

### Upgrade and remove

Build/extract the new archive and run its installer with the same prefix.
Existing provider configuration and appearance settings are preserved, as is
an earlier autostart opt-in. The installer stops its running service, cancels
pending work, and starts the replacement in the previous tray/service mode.
Uninstall also stops its running service. Other installations are not stopped.
To uninstall:

```bash
python3 ~/.local/share/usagestat-bar/platforms/linux/install.py --uninstall
```

Remove native widgets from your panel first. The installer removes its owned
launchers/widgets and runtime; it preserves provider and appearance settings.
An unrelated file or symlink at an installation destination causes a refusal.
Locally edited launchers are preserved on uninstall. Native widget directories
are replaced on upgrade, so keep source edits in this repository.

## Configuration and code layout

`~/.config/usagestat/config.toml` (or `$XDG_CONFIG_HOME/usagestat/config.toml`)
is shared with the backend and GNOME, including account IDs and provider order.
A development backend retains the existing separate dev-config behavior.
GNOME and the standalone app have separate appearance settings: the Linux
schema is `io.github.HashimK.UsageStatBar`, under `/io/github/HashimK/UsageStatBar/`.
They do not overwrite each other's panel settings.

| Code | Responsibility |
| --- | --- |
| `cli.js`, `config.js` | Backend process handling, normalization, provider config |
| `preferences.js`, `providerMetadata.js`, `assets/` | Shared settings pages and presentation defaults |
| `prefs.js` | GNOME preferences host |
| `platforms/linux/` | GJS service, GTK details UI, tray, rendering, installer |
| `platforms/plasma/`, `platforms/cinnamon/`, `platforms/mate/`, `platforms/xfce/` | Native panel adapters |
| `platforms/gtk-panel/` | GTK 3 widget used by Xfce and Waybar |
| `platforms/waybar/`, `platforms/polybar/` | Panel module examples |

`usagestat-bar snapshot` exposes the presentation model as JSON over the private
session bus. `refresh`, `details`, `toggle [PROVIDER_KEY]`, `preferences [PROVIDER_KEY]`, `select KEY`,
`next`, `previous` and `quit` control the same service. Explicit next/previous
commands always switch; `scroll-next`/`scroll-previous` respect the scroll
preference. In the details window, scroll over the header or tabs to switch providers;
the body scrolls through long quota/cost views. `image [light]` prints
the rendered panel SVG path and tooltip. Generated files stay in the user's
private cache. The standalone launcher defaults to the CPU renderer so it also
works without a 3D driver; an explicit `GSK_RENDERER` overrides that choice.
Provider credentials are not part of the presentation model.
`waybar --watch` and `polybar --watch` stream changes until stopped and reconnect
when the service returns. The commands without `--watch` still print once.

## Try a desktop yourself with your real backend

Open an interactive Plasma desktop in a window on your current desktop:

```bash
python3 tests/linux/manual.py plasma --backend /usr/bin/usagestat-dev
```

Add `--detach` when opening it from a temporary terminal or coding tool.
This keeps the whole preview, including its host backend bridge, running
after that terminal closes. The command prints a launcher PID and private
startup log. Closing the viewer still cleans up its session; sending SIGTERM
to the launcher also stops it (including a detached `remaining` queue).

The Hyprland preview uses the GPU for GTK and capture, a 60 FPS stream limit,
512 MiB of shared memory and no container CPU or RAM cap. Preview animations
and blur are disabled, and VNC input travels independently of frame delivery.
Use `--fps 30` to lower the stream limit, or `--fps 90` for a higher limit.
The preview's writable Waybar config/style are disposable, so placement and
theme changes stay inside that session.

Cinnamon's manual preview starts a normal `cinnamon-session` as a regular
user, with Nemo desktop icons, wallpaper, menu, window list, workspaces, tray,
clock, settings and a terminal. UsageStat starts on the right of the bottom
panel; click its icon to open the popup. The separate application remains
available from the menu.

Hyprland's manual preview includes its packaged wallpaper, an application
launcher, terminal, file manager, notifications, four workspaces, tray and
clock. **Apps**, **Terminal** and **Files** are clickable in Waybar.
Keyboard shortcuts are Super+R (launcher), Super+Return (terminal), Super+E
(files), Super+1–4 (workspace), and Super+drag (move/resize). The host may
capture Super unless the viewer grabs the keyboard, so panel launchers are
also provided. UsageStat starts on the right; its position index can now be
reviewed alongside other bar items.

Rebuild both lab images after updating these preview components. These are
disposable desktop sessions with local applications, not complete virtual
machines: hardware, login/power management and networking are not provided.

To review the ten remaining desktop profiles one at a time:

```bash
python3 tests/linux/manual.py remaining --backend /usr/bin/usagestat-dev
```

Closing a viewer advances to the next desktop. Ctrl+C stops the queue. To
resume a particular desktop, replace `remaining` with its name below.

Pass the absolute path of the backend you use in GNOME (`usagestat` or
`usagestat-dev`). The launcher selects its matching config under `~/.config`;
use `--config-home /custom/config/directory` for another location. It requires
the Fedora lab image described below (the Arch image for Hyprland), rootless
Podman and `remote-viewer`. The other profiles also require `Xvnc` and
`vncpasswd`; Hyprland uses WayVNC from its container image. On Fedora 44 the viewer/server packages are `virt-viewer`,
`tigervnc-x11-server` and `tigervnc-server-common`.

The window stays open for you to click the panel, switch providers, refresh,
inspect details and edit preferences. No automated scenarios, assertions or
screenshots run. Closing the viewer (or pressing Ctrl+C in the launching
terminal) stops its container, private display and backend bridge. Preferences
are disposable, so restarting gives you a fresh session.
Usage/reset times follow your host timezone; `--timezone Europe/Amsterdam`
overrides it. The tiling-desktop previews start UsageStat as a floating window
so you can review its intended dimensions. The preview images include desktop
appearance tools, and the relevant settings daemons run in the private session.

The guest gets a copy of provider names, enabled states, sources and grouping.
Your actual CLI runs on the host through a private Unix socket. Only version,
provider list, usage and cost queries are forwarded; host config and account
credentials are not mounted in the container. Custom commands are omitted.
The backend uses its normal host cache and authentication behavior. Editing
guest credentials, running login/install tools or choosing another plugin path
does not reconfigure the host backend; manage those from your host session.

The container has no network access. The viewer connects over
password-protected loopback VNC. Hyprland streams a private headless output
through a Unix socket and a host loopback relay; the other profiles use a
separate X server. Logs remain in the
printed private session directory and are not added to acceptance reports.
Live data is visible in the window, so screenshots you take yourself may
contain your account details or usage.

The launcher accepts `plasma`, `cinnamon`, `mate`, `xfce`, `lxqt`, `budgie`,
`cosmic`, `sway`, `hyprland`, `i3` and `bspwm`. COSMIC runs its native Wayland
compositor in a private 1280 × 800 X11 preview window. This avoids the unstable
nested Wayland/EGL capture route; its clients and panel still use Wayland.
This profile keeps that size fixed and does not require a GPU device.
Hyprland needs access to `/dev/dri/renderD128` (override with
`USAGESTAT_LAB_RENDER_NODE`). Hyprland's
viewer captures its own `USAGESTAT-LAB` output directly. Its unused nested
window is disabled because Aquamarine 0.15 can send a frame before acknowledging
the parent's initial configuration, leaving the old Xvnc preview black.
Rebuild older Hyprland images with `bash tests/linux/build-lab.sh hyprland`
to include WayVNC. The launcher restricts the relay to VNC password
authentication because the bundled NeatVNC's Apple DH negotiation aborts
with the host GtkVnc viewer.
These launcher options are separate from the acceptance results below;
each desktop still needs its own human review.

If a coding app uses a separate data directory, the launcher also looks for
the images in the conventional user Podman store. You can explicitly select
an existing image store:

```bash
USAGESTAT_PODMAN_ROOT="$HOME/.local/share/containers/storage" \
  python3 tests/linux/manual.py plasma --backend /usr/bin/usagestat-dev
```

Display options follow the upstream [TigerVNC server documentation](https://tigervnc.org/doc/Xvnc.html),
[WayVNC manual](https://github.com/any1/wayvnc/blob/master/wayvnc.scd)
and [remote-viewer connection format](https://gitlab.com/virt-viewer/virt-viewer/-/blob/master/man/remote-viewer.pod).

## Repeatable desktop checks from GNOME

Install rootless Podman on the development machine. No host desktop switch,
logout, real account or provider credential is needed. Build the lab images:

```bash
./tests/linux/build-lab.sh fedora
./tests/linux/build-lab.sh hyprland
```

These recipes install the actual desktop/panel runtimes into disposable Fedora
44 and Arch containers. The first build downloads several GB. Allow roughly
25 GB of free disk for both images/build layers and 4 GB of free RAM per active
session. These are practical starting allocations, not measured minimums.
Image builds use the network; test sessions run with networking disabled.
Package repositories move over time: keep the tested image IDs and package
manifests when reproducing a particular run. The recipes are not bit-for-bit
package locks.

The Hyprland and COSMIC preview recipes include pinned compositor compatibility
patches under `tests/linux/patches`: Hyprland's upstream pointer-focus fix and a
Smithay guard against validating an already-destroyed layer role. Their first
builds also compile those compositors. `*-build.txt` in each run records this;
passing a patched preview is not a claim that the unpatched distro package
handles those cases. Host compositors are never replaced.

Preview wallpapers match the [website's current selections](reports/linux-preview-wallpapers.md).
Sources and SHA-256 checksums are pinned in `tests/linux/backgrounds.json` and
downloaded when the image is built. `bash tests/linux/build-lab.sh backgrounds`
refreshes only artwork in existing images. Port sessions require no network
access; GNOME's wrapper caches its selected image before starting the isolated
session. Each run records the asset and website revision in `wallpaper.json`.

Run one target:

```bash
./tests/linux/lab.sh plasma
```

Available targets: `plasma`, `cinnamon`, `mate`, `xfce`, `lxqt`, `budgie`,
`cosmic`, `sway`, `hyprland`, `i3`, `bspwm`. Each run installs the actual bundle,
launches its native panel/compositor with fixtures, exercises service/UI
behavior, and saves `result.json`, screenshots, logs, source commit, image ID
and the exact installed package list under `artifacts/linux-TARGET.*`.
Exit status is nonzero on failure. **Review screenshots too**: process and
D-Bus checks alone cannot establish a visible panel.

Hyprland's nested graphics backend needs access to a DRM render node.
The runner passes `/dev/dri/renderD128`; override it when necessary:

```bash
USAGESTAT_LAB_RENDER_NODE=/dev/dri/renderD129 ./tests/linux/lab.sh hyprland
```

The node must already be readable/writable by your user. The lab does not
change permissions. It uses its own compositor/display, session bus, fake
backend and XDG directories; it does not connect to your GNOME display or
read your provider credentials. The source mount is read-only. Containers are
removed after each run; images and evidence are retained. To remove a lab
image later, use `podman image rm` with its exact lab tag above. Do not prune
unrelated containers/images.

Fast checks and package lifecycle checks:

```bash
./tests/run.sh
./tests/linux/run.sh
./tests/package.sh
python3 tests/linux/package.py
./test-nested.sh
```

The Linux package test also checks desktop-launcher quoting and uses GJS.
The [acceptance report](reports/linux-acceptance.md) records current VM
login/upgrade/uninstall, live-provider, theme and display coverage. Additional
versions, distro/session combinations, accessibility, input and physical-display
cases remain in [#16](https://github.com/Hashim-K/usagestat-bar/issues/16).
A nested panel session does not certify a whole distro or a full login session.
Coordinated CI, interactive previews, native distro packages and simultaneous
release publishing remain in [Phase 2](https://github.com/Hashim-K/usagestat-bar/issues/17).

### Recorded interaction checks

Build the lab images as described above, then run a disposable fixture session:

```bash
python3 tests/linux/review.py cinnamon --output artifacts/my-interaction-review
# Replace cinnamon with another target, or all for all eleven port profiles.
# Include an independent tray application when checking COSMIC/LXQt/Budgie:
USAGESTAT_LAB_TRAY_COMPANION=1 python3 tests/linux/review.py cosmic --output artifacts/my-tray-review
USAGESTAT_TEST_INTERACTIONS=1 ./tests/gnome-session.sh --check
```

The port runner records native mouse/wheel events to `review.mp4`, saves a PNG
for each check, and writes `result.json`, package versions and source metadata.
It exits nonzero when a check or session fails. An existing target output
directory is never overwritten. GNOME uses an isolated Shell test driver and
saves numbered frames under its printed `artifacts/gnome.*` directory; encode
those with `ffmpeg -framerate 5 -i frames/%05d.png -c:v libx264 -pix_fmt yuv420p review.mp4`.

The tests cover ordered pins, count reduction, bidirectional bar and popup
scrolling, their independent disable settings, opening/toggling/dismissal,
short and overflowing provider content, panel group/index/edge changes, and
stable popup alignment. Port profiles also exercise Escape and reopening.
Native GNOME has a fixed top edge; Polybar has no
vertical panels. The GNOME reference driver has a narrower content-sizing
matrix than the shared-window driver. Settings are applied through their
native backends/configuration interfaces, so this does not click through every
Preferences control or certify keyboard shortcuts and touchpad gestures.

Create a portable local gallery from one or more batches:

```bash
python3 tests/linux/report.py artifacts/my-interaction-review --output artifacts/my-review-gallery
```

Later batches replace earlier results for the same target. The generated
`index.html` includes videos, per-step screenshots and raw observations.
Open it in a browser rather than an editor. If local file links open as source,
run `python3 -m http.server 8764 --bind 127.0.0.1 --directory artifacts/my-review-gallery`
and open `http://127.0.0.1:8764/`.
Keep environment failures explicit with `--blocked cosmic` and an explanatory
`--note 'cosmic=Reason for the blocked session'`; raw results are preserved.
The [latest behaviour report](reports/linux-fixes-2026-09-11.md)
documents the fixes and six fresh regression recordings. The
[wallpaper regeneration report](reports/linux-behaviour-web-wallpapers-2026-09-09.md)
retains the preceding full batch and its original failures. The
[earlier September report](reports/linux-interaction-validation-2026-09-09.md)
explains the compositor and tray fixes used by these lab images.

## Full login, reboot and uninstall checks

`tests/linux/vm.py` creates separate QEMU/KVM guests with their own Xfce session,
cloud-init account and SSH key. It does not use libvirt domains or the host's
login/display. It requires KVM, QEMU (`qemu-system-x86_64` and `qemu-img`),
`genisoimage`, SSH and Python 3.11+. Each guest uses 3 GiB of RAM and two CPUs.
Images and evidence go under ignored `artifacts/vm/`; image checksums and source
fingerprints are retained. Package provisioning needs network access.

```bash
python3 tests/linux/vm.py create artifacts/vm/ubuntu-check ubuntu
python3 tests/linux/vm.py provision artifacts/vm/ubuntu-check
python3 tests/linux/vm.py check artifacts/vm/ubuntu-check
python3 tests/linux/vm.py ssh artifacts/vm/ubuntu-check sudo poweroff
```

Repeat with a new directory and `fedora` for Fedora 44. The Ubuntu profile uses
24.04. `check` installs the app, verifies login autostart, opens installed UI,
upgrades with a request in flight, restarts the tray host, exercises real GTK
preferences and XTerm actions at 1×/2× in both themes, reboots the guest,
uninstalls, and verifies another login. It collects JSON and screenshots in
`<guest>/evidence/`. All credentials and usage in these guests are synthetic.
`boot`, `ssh`, `screenshot` and `collect` support follow-up inspection. `stop`
ends only the named lab guest. Disposable guest SSH keys live in a private
native temporary directory because shared mounts may not enforce file modes.

If a launcher application changes Podman's storage directory, pass
`USAGESTAT_PODMAN_ROOT=/absolute/path/to/the/original/containers/storage` to
`lab.sh` to use existing images.

## Opt-in live account smoke check

```bash
USAGESTAT_LIVE_CHECK=yes ./tests/linux/live.sh /absolute/path/to/usagestat
```

This uses the caller's configured Codex/Claude accounts and a private headless
GTK display, with appearance settings held in memory. Set `XDG_CONFIG_HOME` to
the intended account profile if your development application overrides it.
`USAGESTAT_LIVE_PROVIDERS` can select other configured provider IDs. The JSON
report contains only backend version, provider IDs and success/availability
booleans. It does not record account names, credentials, usage values or live
screenshots. Temporary rendered files are removed when the check exits.
