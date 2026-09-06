# Linux desktop ports

The first ports are available in this repository. They use the existing
`usagestat` CLI, provider configuration, icons and preferences. They are
**initial ports with fixture verification**, with further acceptance work
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
| Xfce | StatusNotifier tray | Add **Status Tray Plugin**, run `usagestat-bar tray` |
| LXQt | StatusNotifier tray | Add **Status Notifier** to the panel, run `usagestat-bar tray` |
| Budgie | StatusNotifier tray | Add **System Tray**, run `usagestat-bar tray` |
| COSMIC | Status area | Enable the panel's status area, run `usagestat-bar tray` |
| Sway / Hyprland | Waybar custom module | Merge the provided module into your Waybar configuration |
| i3 / bspwm | Polybar script module | Merge the provided module into your Polybar configuration |

Native widgets show ordered bars, percentages, logos and names. Tray hosts use
one compact percentage/ring icon per selected provider; the host controls icon
placement and order. Waybar and Polybar show text meters, percentages and names.
All these integrations open the same GTK details and preferences windows.
Tray slots and script modules do not reproduce every GNOME panel appearance
option; the report records those gaps.

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

The default prefix is `~/.local`. Put `~/.local/bin` on the **desktop session's**
PATH before starting its panel; exporting it in an existing terminal does not
change an already-running panel's environment. Log out/in after changing your
session environment. Set an explicit backend executable in **Preferences →
Tools** if the desktop cannot find your CLI. The existing `USAGESTAT_CLI`
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

### Waybar and Polybar

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

Quit the service before replacing an installation:

```bash
usagestat-bar quit
```

Build/extract the new archive and run its installer with the same prefix.
Existing provider configuration and appearance settings are preserved, as is
an earlier autostart opt-in. To uninstall:

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
| `platforms/plasma/`, `platforms/cinnamon/`, `platforms/mate/` | Native panel adapters |
| `platforms/waybar/`, `platforms/polybar/` | Panel module examples |

`usagestat-bar snapshot` exposes the presentation model as JSON over the private
session bus. `refresh`, `details`, `preferences [PROVIDER_KEY]`, `select KEY`,
`next`, `previous` and `quit` control the same service. `image [light]` prints
the rendered panel SVG path and tooltip. Generated files stay in the user's
private cache. Provider credentials are not part of the presentation model.

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
