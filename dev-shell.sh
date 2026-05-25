#!/usr/bin/env bash
set -euo pipefail

uuid="usagestat-bar@hashimkarim"
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
shell_major="$(gnome-shell --version | awk '{split($3, parts, "."); print parts[1] + 0}')"

"${source_dir}/dev-link.sh" >/dev/null

if [[ "${shell_major}" -ge 49 ]]; then
  if ! command -v mutter-devkit >/dev/null 2>&1 && [[ ! -x /usr/libexec/mutter-devkit ]]; then
    echo "GNOME ${shell_major} needs the Mutter Development Kit viewer for nested Shell testing." >&2
    echo "Install it with: sudo dnf install mutter-devkit" >&2
    exit 1
  fi
  shell_command='gnome-shell --devkit --wayland'
else
  shell_command='gnome-shell --nested --wayland'
fi

echo "Starting nested GNOME Shell for ${uuid}"
echo "Close the nested Shell window and rerun this script after JS code changes."

UUID="${uuid}" SHELL_COMMAND="${shell_command}" dbus-run-session -- bash -lc '
  set -euo pipefail

  export G_MESSAGES_DEBUG=all
  export SHELL_DEBUG=all

  ${SHELL_COMMAND} &
  shell_pid=$!

  for _ in $(seq 1 80); do
    if gnome-extensions info "${UUID}" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done

  gnome-extensions enable "${UUID}" || true
  wait "${shell_pid}"
'
