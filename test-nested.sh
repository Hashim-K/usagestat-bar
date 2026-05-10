#!/usr/bin/env bash
set -euo pipefail

uuid="ai-usage-bar@local"
log_file="$(mktemp)"

cleanup() {
  rm -f "${log_file}"
}
trap cleanup EXIT

dbus-run-session -- bash -s "${uuid}" "${log_file}" <<'EOF'
set -euo pipefail

uuid="$1"
log_file="$2"

gnome-shell --devkit --wayland >"${log_file}" 2>&1 &
shell_pid=$!

cleanup_nested() {
  kill "${shell_pid}" 2>/dev/null || true
  wait "${shell_pid}" 2>/dev/null || true
}
trap cleanup_nested EXIT

sleep 8
gnome-extensions enable "${uuid}"
gnome-extensions info "${uuid}"
sleep 2
EOF

echo "--- nested shell log tail ---"
tail -n 80 "${log_file}"
