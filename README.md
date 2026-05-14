# AI Usage Bar

GNOME Shell extension for the `ai-usage` CLI. It shows normalized provider usage from `ai-usage --json-only usage --provider ...` and edits enabled provider state in `~/.config/ai-usage/config.toml`.

## Install

```bash
cargo install --path /path/to/ai-usage-backend/crates/ai-usage-cli
./install.sh
```

Restart GNOME Shell on X11 with `Alt+F2`, `r`, Enter. On Wayland, log out and back in.

## What It Does

- Shows a compact panel usage meter with remaining/used modes.
- Supports GNOME panel placement: left, center, right, plus position index.
- Adds configurable normal, warning, danger, and neutral colors.
- Uses the installed `ai-usage` CLI, so provider support follows the backend plugin set.
- Edits enabled provider state in `~/.config/ai-usage/config.toml` from preferences.
- Keeps the config file private when saving.

If the CLI is installed somewhere unusual, set `AI_USAGE_CLI=/path/to/ai-usage` before GNOME Shell starts.

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
