#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test_root="$(mktemp -d -t usagestat-tray-lifecycle.XXXXXX)"
display_pid=
cleanup() {
    if [[ -n "$display_pid" ]]; then kill "$display_pid" 2>/dev/null || true; fi
    rm -rf -- "$test_root"
}
trap cleanup EXIT
Xvfb -displayfd 3 -screen 0 640x480x24 -nolisten tcp 3>"$test_root/display" >"$test_root/display.log" 2>&1 &
display_pid=$!
for _ in {1..50}; do [[ -s "$test_root/display" ]] && break; sleep .1; done
[[ -s "$test_root/display" ]] || { cat "$test_root/display.log"; exit 1; }
export DISPLAY=":$(cat "$test_root/display")" GDK_BACKEND=x11 XDG_CURRENT_DESKTOP=LXQt
export XDG_CONFIG_HOME="$test_root/config" XDG_DATA_HOME="$test_root/data" XDG_CACHE_HOME="$test_root/cache"
export GSETTINGS_BACKEND=memory GIO_USE_VFS=local
python3 "$source_dir/platforms/linux/package.py" stage "$test_root/app" >/dev/null
export USAGESTAT_BAR_SCHEMA_DIR="$test_root/app/platforms/linux/schemas"
dbus-run-session -- gjs -m "$source_dir/tests/linux/tray-lifecycle.js"
