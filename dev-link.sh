#!/usr/bin/env bash
set -euo pipefail

uuid="ai-usage-bar@local"
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target="${HOME}/.local/share/gnome-shell/extensions/${uuid}"

mkdir -p "$(dirname "${target}")"

if [[ -e "${target}" && ! -L "${target}" ]]; then
  backup_dir="${HOME}/.local/share/gnome-shell/extensions-backups"
  mkdir -p "${backup_dir}"
  backup="${backup_dir}/${uuid}.backup.$(date +%Y%m%d%H%M%S)"
  mv "${target}" "${backup}"
  echo "Moved existing installed copy to ${backup}"
fi

if [[ -L "${target}" ]]; then
  rm "${target}"
fi

ln -s "${source_dir}" "${target}"
glib-compile-schemas "${source_dir}/schemas"

echo "Linked ${target} -> ${source_dir}"
echo "Reload GNOME Shell or disable/enable ${uuid} after code changes."
