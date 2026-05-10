# AI Usage Bar

GNOME Shell extension for the Linux `codexbar` CLI. It mirrors CodexBar's provider ordering, enabled state, usage JSON, source selection, cookies, API keys, and token settings through `~/.codexbar/config.json`.

## Install

```bash
brew install steipete/tap/codexbar
./install.sh
```

Restart GNOME Shell on X11 with `Alt+F2`, `r`, Enter. On Wayland, log out and back in.

## What It Does

- Shows a compact panel usage meter with remaining/used modes.
- Supports GNOME panel placement: left, center, right, plus position index.
- Adds configurable normal, warning, danger, and neutral colors.
- Uses the installed `codexbar` CLI, so provider support follows upstream CodexBar.
- Edits `~/.codexbar/config.json` from provider controls in preferences.
- Keeps the config file private when saving.

If the CLI is installed somewhere unusual, set `CODEXBAR_CLI=/path/to/codexbar` before GNOME Shell starts.

## Development Test

For active development, link the extension directory to this repo:

```bash
./dev-link.sh
```

Code changes are picked up on the next extension reload. Schema changes still need:

```bash
glib-compile-schemas schemas
```

Do not delete `schemas/gschemas.compiled` while using the symlinked dev install; GNOME loads it from this repo.

On Wayland, test in a nested GNOME Shell without disrupting the current session:

```bash
./install.sh
./test-nested.sh
```

For the live desktop session, a brand-new extension UUID is discovered only after GNOME Shell reloads. On Wayland, log out and back in, then run:

```bash
gnome-extensions enable ai-usage-bar@local
```
