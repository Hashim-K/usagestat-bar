#!/usr/bin/env bash
set -euo pipefail

uuid="ai-usage-bar@local"
target="${HOME}/.local/share/gnome-shell/extensions/${uuid}"

mkdir -p "${target}"
rsync -a --delete \
  --exclude '.git' \
  --exclude 'inspo' \
  --exclude 'README.md' \
  ./ "${target}/"

glib-compile-schemas "${target}/schemas"

echo "Installed ${uuid} to ${target}"
echo "Restart GNOME Shell or log out/in, then enable it in Extensions if needed."
