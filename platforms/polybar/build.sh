#!/usr/bin/env bash
# Build a private Polybar with section geometry support. Never replaces the
# distribution's polybar executable or changes another panel's configuration.
set -euo pipefail
directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
output="${1:?Output executable path required}"
revision=b3af5a33166604c689705d7dc67b69c01482d707
work="$(mktemp -d -t usagestat-polybar.XXXXXXXX)"
trap 'rm -rf "$work"' EXIT
if [[ -n "${USAGESTAT_POLYBAR_SOURCE:-}" ]]; then
    test "$(git -C "$USAGESTAT_POLYBAR_SOURCE" rev-parse HEAD)" = "$revision"
    test -z "$(git -C "$USAGESTAT_POLYBAR_SOURCE" status --porcelain --untracked-files=no)"
    cp -a "$USAGESTAT_POLYBAR_SOURCE" "$work/source"
else
    git clone --quiet --depth 1 --branch 3.7.2 --recursive --shallow-submodules \
        https://github.com/polybar/polybar.git "$work/source"
    test "$(git -C "$work/source" rev-parse HEAD)" = "$revision"
fi
patch -d "$work/source" -p1 < "$directory/section-geometry.patch"
cmake -S "$work/source" -B "$work/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_DOC=OFF -DBUILD_TESTS=OFF
cmake --build "$work/build" --parallel "${USAGESTAT_BUILD_JOBS:-2}"
install -Dm755 "$work/build/bin/polybar" "$output"
