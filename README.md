# AI Usage Bar

GNOME Shell extension that shows normalized AI provider usage in the panel. Reads from the `ai-usage` CLI and lets you toggle providers from preferences.

## Install

### From GNOME Extensions

Install from [extensions.gnome.org](https://extensions.gnome.org/extension/ai-usage-bar) once listed, or use the GNOME Extension Manager app.

### Manual

1. Install the `ai-usage` CLI:

```bash
cargo install ai-usage
```

2. Install the extension:

```bash
./install.sh
gnome-extensions enable ai-usage-bar@hashimkarim
```

Restart GNOME Shell on X11 with `Alt+F2`, `r`, Enter. On Wayland, log out and back in.

If the CLI is installed somewhere unusual, set `AI_USAGE_CLI=/path/to/ai-usage` before GNOME Shell starts.

## What It Does

- Shows a compact panel usage meter with remaining/used modes.
- Supports GNOME panel placement: left, center, right, plus position index.
- Configurable normal, warning, danger, and neutral colors.
- Uses the installed `ai-usage` CLI — provider support follows the backend plugin set.
- Toggle and reorder providers from preferences.
- Keeps config private when saving.

## Development

Link the repo into the extensions directory for live reloading:

```bash
./dev-link.sh
```

Schema changes still need:

```bash
glib-compile-schemas schemas
```

On Wayland, test in a nested GNOME Shell:

```bash
./install.sh
./test-nested.sh
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
