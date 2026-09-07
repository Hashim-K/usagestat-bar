#!/usr/bin/env bash
set -euo pipefail
if [[ "${USAGESTAT_LIVE_CHECK:-}" != yes ]]; then
    echo 'Opt-in required: USAGESTAT_LIVE_CHECK=yes tests/linux/live.sh /absolute/path/to/usagestat' >&2
    exit 2
fi
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test_root="$(mktemp -d -t usagestat-live.XXXXXX)"
display_pid=
trap '[[ -z "$display_pid" ]] || kill "$display_pid" 2>/dev/null || true; rm -rf -- "$test_root"' EXIT
export GSETTINGS_BACKEND=memory XDG_CACHE_HOME="$test_root/cache" GSK_RENDERER=cairo
export GTK_A11Y=none NO_AT_BRIDGE=1
# Leave XDG_CONFIG_HOME unchanged: it selects the account profile the caller requested.
python3 "$source_dir/platforms/linux/package.py" stage "$test_root/app"
export USAGESTAT_BAR_SCHEMA_DIR="$test_root/app/platforms/linux/schemas"
Xvfb -displayfd 3 -screen 0 1600x1000x24 -nolisten tcp 3>"$test_root/display" >"$test_root/display.log" 2>&1 &
display_pid=$!
for attempt in $(seq 1 100); do [[ ! -s "$test_root/display" ]] || break; sleep .1; done
export DISPLAY=":$(cat "$test_root/display")"
unset WAYLAND_DISPLAY USAGESTAT_FIXTURE_STATE USAGESTAT_FIXTURE_SCENARIO
timeout --kill-after=5s 120s dbus-run-session -- gjs -m "$source_dir/tests/linux/live.js" "${1:?Backend path required}"
