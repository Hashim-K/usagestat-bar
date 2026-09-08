#!/usr/bin/env bash
set -euo pipefail
directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target="${1:?Choose waybar or xfce}"
output="${2:?Output shared library path required}"
packages=(gtk+-3.0 json-glib-1.0 gmodule-2.0)
case "$target" in
    waybar) source_file="$directory/../waybar/module.c" ;;
    xfce) source_file="$directory/../xfce/plugin.c"; packages+=(libxfce4panel-2.0) ;;
    *) echo 'Choose waybar or xfce' >&2; exit 2 ;;
esac
mkdir -p "$(dirname "$output")"
read -r -a flags <<< "$(pkg-config --cflags --libs "${packages[@]}")"
"${CC:-cc}" -shared -fPIC -O2 -Wall -Wextra -Wno-unused-parameter -Werror \
    "$directory/widget.c" "$source_file" "${flags[@]}" -o "$output"
