# Linux desktop ports

The first ports are available in this repository. They use the existing
`usagestat` CLI, provider configuration, icons and preferences. They are
**ports checked in desktop labs and disposable VMs**, with remaining appearance limits
tracked in [the roadmap](https://github.com/Hashim-K/usagestat-bar/issues/2).
See the [parity report](reports/linux-ports.md) before treating a combination
as fully supported. Windows and macOS remain separate, later tasks.

## Choose the integration

| Desktop / panel | Integration | Start / add it |
| --- | --- | --- |
| GNOME | Existing Shell extension | Follow the [root README](../README.md) |
| KDE Plasma 6 | Native QML panel widget and popup | Add **UsageStat Bar** in Plasma's widget picker |
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
Tray hosts use one square icon per selected provider: quota rings, logos,
percentages and abbreviated names follow the appearance settings. The desktop
controls tray size, placement and order. Polybar and the Waybar text fallback
show multiple text meters with custom colors and provider initials in place
of image logos. Full names remain in details/tooltips.

All integrations open the same GTK details and preferences. Square tray slots
and text-only Polybar modules retain appearance limits; they are documented
in the report and are not claimed as full graphical parity.

## Build and install

Runtime dependencies: Bash, GJS, GTK 4, libadwaita, GObject introspection,
GdkPixbuf with SVG support, a session D-Bus and dconf, plus the `usagestat` CLI.
The UI uses GTK 4.12 / libadwaita 1.4 APIs; older library combinations have not
been verified. Python 3 and `glib-compile-schemas` are needed to build/install.
MATE additionally needs Python GObject bindings, GTK 3 and the MatePanelApplet
4.0 typelib. Plasma needs its Plasma 5 Support executable data engine
(`org.kde.plasma.plasma5support`). These are system runtime packages, not npm
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
bar's modules list. Installed copies are in
`~/.local/share/usagestat-bar/platforms/`.

Both examples use left click for details, right click for preferences, middle
click to refresh, and the wheel to switch providers. Plasma's left click opens
its native overview, with a **Details** button for the full GTK view. Cinnamon
has a panel context menu. MATE uses right click for preferences.

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
session bus. `refresh`, `details`, `preferences [PROVIDER_KEY]`, `select KEY`,
`next`, `previous` and `quit` control the same service. Explicit next/previous
commands always switch; `scroll-next`/`scroll-previous` respect the scroll
preference. In the details window, scroll over the header to switch providers;
the body scrolls through long quota/cost views. `image [light]` prints
the rendered panel SVG path and tooltip. Generated files stay in the user's
private cache. The standalone launcher defaults to the CPU renderer so it also
works without a 3D driver; an explicit `GSK_RENDERER` overrides that choice.
Provider credentials are not part of the presentation model.

## Repeatable desktop checks from GNOME

Install rootless Podman on the development machine. No host desktop switch,
logout, real account or provider credential is needed. Build the lab images:

```bash
./tests/linux/build-lab.sh fedora
./tests/linux/build-lab.sh hyprland
```

These recipes install the actual desktop/panel runtimes into disposable Fedora
44 and Arch containers. The first build downloads several GB. Allow roughly
15 GB of free disk for both images/build layers and 4 GB of free RAM per active
session. These are practical starting allocations, not measured minimums.
Image builds use the network; test sessions run with networking disabled.
Package repositories move over time: keep the tested image IDs and package
manifests when reproducing a particular run. The recipes are not bit-for-bit
package locks.

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

COSMIC and Hyprland's nested graphics backends need access to a DRM render
node. The runner passes `/dev/dri/renderD128`; override it when necessary:

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
Complete VM login/upgrade/uninstall, live providers, alternate versions,
accessibility, keyboard, scaling, themes and multi-monitor acceptance still
need the follow-ups in [#16](https://github.com/Hashim-K/usagestat-bar/issues/16).
A nested panel session does not certify a whole distro or a full login session.
Coordinated CI, interactive previews, native distro packages and simultaneous
release publishing remain in [Phase 2](https://github.com/Hashim-K/usagestat-bar/issues/17).

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
