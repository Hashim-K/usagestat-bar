# UsageStat Bar

AI provider usage in your Linux panel, using the `usagestat` CLI. The existing GNOME extension now has initial ports for Plasma, Cinnamon, MATE, tray desktops, Waybar and Polybar.

For other Linux desktops, see [installation and desktop checks](docs/LINUX.md) and the [current parity report](docs/reports/linux-ports.md). Windows and macOS are tracked in the [platform roadmap](https://github.com/Hashim-K/usagestat-bar/issues/2).

## Install

### Step 1 — Install the `usagestat` CLI

**Arch / Manjaro (AUR):**
```bash
yay -S usagestat-bin
```

**Homebrew (any distro):**
```bash
brew install hashim-k/tap/usagestat
```

**Ubuntu / Debian (PPA):**
```bash
sudo add-apt-repository ppa:hashimkarim/usagestat
sudo apt install usagestat
```

**Fedora / RHEL / openSUSE (COPR):**
```bash
sudo dnf copr enable hashimkarim/usagestat
sudo dnf install usagestat
```

**GitHub Release (manual):**
```bash
curl -L -o usagestat https://github.com/Hashim-K/usagestat/releases/latest/download/usagestat-linux-x86_64
chmod +x usagestat
sudo install -Dm755 usagestat /usr/local/bin/usagestat
```

### Step 2 — Install the GNOME extension

**From GNOME Extensions:**

Install from [extensions.gnome.org](https://extensions.gnome.org) once listed, or use the GNOME Extension Manager app.

**Manual:**

```bash
./install.sh
```

Restart GNOME Shell — on X11: `Alt+F2`, `r`, Enter. On Wayland: log out and back in.

Then enable:

```bash
gnome-extensions enable usagestat-bar@hashimkarim
```

If the CLI is in a non-standard location, set `USAGESTAT_CLI=/path/to/usagestat` before GNOME Shell starts.

## What It Does

- Shows a compact panel usage meter with remaining/used modes.
- Supports GNOME panel placement: left, center, right, plus position index.
- Configurable normal, warning, danger, and neutral colors.
- Uses the installed `usagestat` CLI — provider support follows the backend plugin set.
- Toggle and reorder providers from preferences.
- Keeps config private when saving.

## Development

Run the credential-free baseline checks:

```bash
./tests/run.sh       # CLI, usage and config contract checks
./tests/package.sh   # Release archive and isolated install checks
./test-nested.sh     # Isolated GNOME UI checks, logs and screenshots
./dev-shell.sh --fixtures  # Interactive desktop with a fake backend
./tests/linux/run.sh       # Standalone Linux model and rendering checks
./tests/linux/lab.sh plasma # Native desktop check after building the lab image
```

See [testing instructions](docs/TESTING.md), the
[Linux desktop lab](docs/LINUX.md#repeatable-desktop-checks-from-gnome), the
[current-version port baseline](docs/BASELINE.md), and the
[platform roadmap](https://github.com/Hashim-K/usagestat-bar/issues/2).

Link the repo into the extensions directory for live reloading:

```bash
./dev-link.sh
```

Schema changes still need:

```bash
glib-compile-schemas schemas
```

For live development with your normal provider config, open a nested Shell:

```bash
./dev-shell.sh
```

Build the submission zip:

```bash
./build.sh
```

## Donate

If this extension is useful to you:

- [PayPal](https://paypal.me/hashimkarim)
- [GitHub Sponsors](https://github.com/sponsors/Hashim-K)
- [Ko-fi](https://ko-fi.com/hashimkarim)

## Acknowledgements

Inspired by and built on ideas from:

- [CodexBar](https://github.com/steipete/CodexBar) — macOS menu bar app for Codex usage
- [codexbar-gnome](https://github.com/InledGroup/codexbar-gnome) — GNOME port of CodexBar
- [Win-CodexBar](https://github.com/Finesssee/Win-CodexBar) — Windows port of CodexBar
- [openusage](https://github.com/robinebers/openusage) — usage tracking extension
- [crossusage](https://github.com/barramee27/crossusage) — cross-platform fork of openusage

## License

[MIT](LICENSE)
