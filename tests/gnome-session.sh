#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:---check}"
if [[ "$mode" != --check && "$mode" != --interactive ]]; then
    echo "Usage: $0 [--check|--interactive]" >&2
    exit 2
fi
for required_command in gnome-shell gjs glib-compile-schemas gsettings dbus-run-session python3 zip unzip timeout; do
    command -v "$required_command" >/dev/null || { echo "Missing dependency: $required_command" >&2; exit 1; }
done
# Match the desktop's GLib installation, even when Homebrew tools lead PATH.
desktop_bin="$(dirname "$(command -v gnome-shell)")"
export USAGESTAT_GSETTINGS="$desktop_bin/gsettings"
if [[ ! -x "$USAGESTAT_GSETTINGS" ]]; then
    echo "Expected the desktop's gsettings at $USAGESTAT_GSETTINGS" >&2
    exit 1
fi
# Prepare the selected website artwork outside the disposable desktop session.
# Cached files are checksum-verified, so later runs also work offline.
export USAGESTAT_LAB_BACKGROUND_ROOT="${USAGESTAT_LAB_BACKGROUND_ROOT:-${XDG_CACHE_HOME:-$HOME/.cache}/usagestat-lab/wallpapers}"
python3 "$source_dir/tests/linux/fetch-backgrounds.py" --target gnome --root "$USAGESTAT_LAB_BACKGROUND_ROOT"
mkdir -p "$source_dir/artifacts"
output_dir="$(mktemp -d "$source_dir/artifacts/gnome.XXXXXX")"
test_root="$(mktemp -d -t usagestat-gnome.XXXXXX)"
cleanup_test_root() {
    # The document portal may still be releasing its FUSE mount after bus exit.
    for _ in $(seq 1 10); do
        if rm -rf --one-file-system -- "$test_root" 2>/dev/null; then
            return
        fi
        sleep 0.2
    done
    echo "Could not remove temporary session state: $test_root" >&2
    return 1
}
trap cleanup_test_root EXIT
if [[ "$mode" == --interactive ]]; then
    # Devkit transports the virtual display over the parent session's PipeWire.
    export PIPEWIRE_RUNTIME_DIR="${PIPEWIRE_RUNTIME_DIR:-${XDG_RUNTIME_DIR:?}}"
fi
if [[ "$mode" == --interactive && -n "${WAYLAND_DISPLAY:-}" && "$WAYLAND_DISPLAY" != /* ]]; then
    export WAYLAND_DISPLAY="${XDG_RUNTIME_DIR:?}/$WAYLAND_DISPLAY"
fi
export XDG_RUNTIME_DIR="$test_root/runtime"
export XDG_CONFIG_HOME="$test_root/config"
export XDG_CACHE_HOME="$test_root/cache"
export XDG_DATA_HOME="$test_root/data"
export XDG_STATE_HOME="$test_root/state"
export GSETTINGS_BACKEND=dconf
export GIO_USE_VFS=local
# The disposable bus has no user-systemd accessibility registry.
export GTK_A11Y=none
export NO_AT_BRIDGE=1
export DCONF_PROFILE=user
export LC_ALL=C.UTF-8
export TZ=UTC
export USAGESTAT_TEST_OUTPUT_DIR="$output_dir"
export USAGESTAT_FIXTURE_STATE="$test_root/fixture-state.json"
export USAGESTAT_FIXTURE_LOG="$output_dir/backend-commands.jsonl"
unset USAGESTAT_FIXTURE_SCENARIO
mkdir -p "$XDG_CONFIG_HOME/usagestat" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
if [[ "${USAGESTAT_TEST_INTERACTIONS:-0}" == 1 ]]; then
    cp "$source_dir/tests/linux/interactions.toml" "$XDG_CONFIG_HOME/usagestat/config.toml"
else
    cp "$source_dir/tests/fixtures/config.toml" "$XDG_CONFIG_HOME/usagestat/config.toml"
fi
chmod 600 "$XDG_CONFIG_HOME/usagestat/config.toml"
printf '%s\n' '{"scenario":"normal"}' > "$USAGESTAT_FIXTURE_STATE"

app_dir="$XDG_DATA_HOME/gnome-shell/extensions/usagestat-bar@hashimkarim"
driver_dir="$XDG_DATA_HOME/gnome-shell/extensions/usagestat-baseline-test@local"
mkdir -p "$app_dir" "$driver_dir"
"$source_dir/build.sh" "$test_root/extension.zip" > "$output_dir/build.log"
unzip -q "$test_root/extension.zip" -d "$app_dir"
cp "$source_dir/tests/gnome-driver/"* "$driver_dir/"
cp "$source_dir/tests/assert.js" "$driver_dir/"
"$desktop_bin/glib-compile-schemas" --strict "$app_dir/schemas"
export GSETTINGS_SCHEMA_DIR="$app_dir/schemas"

python3 - "$source_dir" "$output_dir" "$mode" <<'PY'
import json
import pathlib
import platform
import subprocess
import sys
source, output, mode = sys.argv[1:]
def command(args):
    return subprocess.check_output(args, text=True).strip()
data = {
    'sourceCommit': command(['git', '-C', source, 'rev-parse', 'HEAD']),
    'trackedChanges': bool(subprocess.run(['git', '-C', source, 'diff', '--quiet']).returncode),
    'kernel': platform.release(), 'architecture': platform.machine(),
    'shell': command(['gnome-shell', '--version']), 'gjs': command(['gjs', '--version']),
    'osRelease': pathlib.Path('/etc/os-release').read_text(),
    'mode': mode, 'command': './test-nested.sh' if mode == '--check' else './dev-shell.sh --fixtures',
}
pathlib.Path(output, 'environment.json').write_text(json.dumps(data, indent=2) + '\n')
PY

echo "Isolated GNOME session; results: $output_dir"
if [[ "$mode" == --interactive ]]; then
    echo "Fixture state: $USAGESTAT_FIXTURE_STATE (edit the scenario, then refresh)"
fi
session_command=(dbus-run-session -- bash -s -- "$source_dir" "$mode")
if [[ "$mode" == --check ]]; then
    session_command=(timeout --kill-after=5s 100s "${session_command[@]}")
fi
session_status=0
"${session_command[@]}" > "$output_dir/session.log" 2>&1 <<'SESSION' || session_status=$?
set -euo pipefail
source_dir="$1"
mode="$2"
uuid=usagestat-bar@hashimkarim
schema=org.gnome.shell.extensions.usagestat-bar
gsettings() { "$USAGESTAT_GSETTINGS" "$@"; }
gsettings set "$schema" usagestat-cli-path "$source_dir/tests/fixtures/usagestat"
gsettings set "$schema" refresh-interval 0
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.desktop.interface enable-animations false
wallpaper="$(python3 "$source_dir/tests/linux/background.py" gnome --output "$USAGESTAT_TEST_OUTPUT_DIR")"
gsettings set org.gnome.desktop.background picture-uri "file://$wallpaper"
gsettings set org.gnome.desktop.background picture-uri-dark "file://$wallpaper"
gsettings set org.gnome.desktop.background picture-options zoom
gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
if [[ "$mode" == --check ]]; then
    # Load the driver first so disabling the tested extension does not rebase it.
    gsettings set org.gnome.shell enabled-extensions "['usagestat-baseline-test@local', '$uuid']"
    shell_args=(--headless --wayland --no-x11 --virtual-monitor 1600x1000)
else
    gsettings set org.gnome.shell enabled-extensions "['$uuid']"
    shell_major="$(gnome-shell --version | awk '{split($3, parts, "."); print parts[1] + 0}')"
    if (( shell_major >= 49 )); then
        shell_args=(--devkit --wayland)
    else
        shell_args=(--nested --wayland)
    fi
fi
gnome-shell "${shell_args[@]}" > "$USAGESTAT_TEST_OUTPUT_DIR/shell.log" 2>&1 &
shell_pid=$!
cleanup_shell() {
    kill "$shell_pid" 2>/dev/null || true
    wait "$shell_pid" 2>/dev/null || true
}
trap cleanup_shell EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [[ "$mode" == --interactive ]]; then
    wait "$shell_pid"
else
    for _ in $(seq 1 360); do
        if [[ -f "$USAGESTAT_TEST_OUTPUT_DIR/result.json" ]]; then
            exit 0
        fi
        if ! kill -0 "$shell_pid" 2>/dev/null; then
            echo 'GNOME Shell exited before producing a test result' >&2
            exit 1
        fi
        sleep 0.25
    done
    echo 'Timed out waiting for the GNOME test driver; inspect shell.log' >&2
    exit 1
fi
SESSION
if (( session_status != 0 )); then
    echo "GNOME session failed (status $session_status); inspect $output_dir/session.log and shell.log" >&2
    exit "$session_status"
fi
if [[ "$mode" == --check ]]; then
    python3 - "$output_dir/result.json" <<'PY'
import json
import sys
data = json.load(open(sys.argv[1]))
for result in data['results']:
    print(f"{result['status']}: {result['name']}")
    if result.get('error'):
        print(result['error'])
sys.exit(0 if data['status'] == 'passed' else 1)
PY
fi
