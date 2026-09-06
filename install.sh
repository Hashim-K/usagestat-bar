#!/usr/bin/env bash
set -euo pipefail

uuid="usagestat-bar@hashimkarim"
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/${uuid}"
stage_dir="$(mktemp -d -t usagestat-install.XXXXXX)"
trap 'rm -rf -- "$stage_dir"' EXIT

"$source_dir/build.sh" "$stage_dir/extension.zip"
mkdir "$stage_dir/extension"
unzip -q "$stage_dir/extension.zip" -d "$stage_dir/extension"
glib-compile-schemas --strict "$stage_dir/extension/schemas"

if [[ -L "$target" ]]; then
    # Replace a development link, never rsync --delete into the source repo.
    rm -- "$target"
fi
mkdir -p "${target}"
rsync -a --delete "$stage_dir/extension/" "${target}/"

echo "Installed ${uuid} to ${target}"
echo "Restart GNOME Shell or log out/in, then enable it in Extensions if needed."
