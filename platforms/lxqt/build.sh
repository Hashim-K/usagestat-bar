#!/usr/bin/env bash
set -euo pipefail
directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
output="${1:?Output shared library path required}"
work="$(mktemp -d -t usagestat-lxqt.XXXXXXXX)"
trap 'rm -rf "$work"' EXIT
cmake -S "$directory" -B "$work" -DCMAKE_BUILD_TYPE=Release
cmake --build "$work" --parallel "${USAGESTAT_BUILD_JOBS:-2}"
install -Dm755 "$work/libusagestat.so" "$output"
