#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
podman_command=(podman)
if [[ -n "${USAGESTAT_PODMAN_ROOT:-}" ]]; then podman_command+=(--root "$USAGESTAT_PODMAN_ROOT"); fi
case "${1:-fedora}" in
    fedora) "${podman_command[@]}" build -t localhost/usagestat-linux-lab:44 -f "$source_dir/tests/linux/Containerfile" "$source_dir/tests/linux" ;;
    hyprland) "${podman_command[@]}" build -t localhost/usagestat-hyprland-lab:arch -f "$source_dir/tests/linux/Containerfile.hyprland" "$source_dir/tests/linux" ;;
    backgrounds)
        for target in all hyprland; do
            image=localhost/usagestat-linux-lab:44
            if [[ "$target" == hyprland ]]; then image=localhost/usagestat-hyprland-lab:arch; fi
            "${podman_command[@]}" build --pull=never -t "$image" \
                --build-arg "LAB_IMAGE=$image" --build-arg "WALLPAPER_TARGET=$target" \
                -f "$source_dir/tests/linux/Containerfile.backgrounds" "$source_dir/tests/linux"
        done
        ;;
    *) echo 'Usage: build-lab.sh [fedora|hyprland|backgrounds]' >&2; exit 2 ;;
esac
