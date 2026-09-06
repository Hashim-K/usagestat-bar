#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
case "${1:-fedora}" in
    fedora) podman build -t localhost/usagestat-linux-lab:44 -f "$source_dir/tests/linux/Containerfile" "$source_dir/tests/linux" ;;
    hyprland) podman build -t localhost/usagestat-hyprland-lab:arch -f "$source_dir/tests/linux/Containerfile.hyprland" "$source_dir/tests/linux" ;;
    *) echo 'Usage: build-lab.sh [fedora|hyprland]' >&2; exit 2 ;;
esac
