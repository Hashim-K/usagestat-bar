#!/usr/bin/env bash
# Runs inside the disposable lab container with a private display and bus.
set -euo pipefail
target="${1:-lxqt}"
export XDG_CONFIG_HOME=/tmp/usagestat-config XDG_DATA_HOME=/tmp/usagestat-prefix/share
export XDG_CACHE_HOME=/tmp/usagestat-cache XDG_STATE_HOME=/tmp/usagestat-state XDG_RUNTIME_DIR=/tmp/usagestat-runtime
export GSETTINGS_BACKEND=dconf GIO_USE_VFS=local GTK_A11Y=none NO_AT_BRIDGE=1
export LC_ALL=C.UTF-8 TZ="${USAGESTAT_LAB_TIMEZONE:-UTC}" LIBGL_ALWAYS_SOFTWARE=1
mkdir -p "$XDG_CONFIG_HOME/usagestat" "$XDG_RUNTIME_DIR" /out
if [[ "$(id -u)" == 0 ]]; then
    mkdir -p /run/dbus
    dbus-daemon --system --fork --nopidfile
fi
chmod 700 "$XDG_RUNTIME_DIR"
if [[ "${USAGESTAT_LAB_INTERACTIVE:-0}" == 1 ]]; then
    cp /bridge/config.toml "$XDG_CONFIG_HOME/usagestat/config.toml"
    mkdir -p /tmp/usagestat-live
    install -m 755 /src/tests/linux/backend_bridge.py /tmp/usagestat-live/usagestat
    export USAGESTAT_CLI=/tmp/usagestat-live/usagestat
    export USAGESTAT_BACKEND_SOCKET=/bridge/backend.sock
else
    cp /src/tests/fixtures/config.toml "$XDG_CONFIG_HOME/usagestat/config.toml"
    if [[ "${USAGESTAT_LAB_INTERACTIONS:-0}" == 1 ]]; then
        cp /src/tests/linux/interactions.toml "$XDG_CONFIG_HOME/usagestat/config.toml"
    fi
    export USAGESTAT_CLI=/src/tests/fixtures/usagestat USAGESTAT_FIXTURE_STATE=/out/fixture-state.json
    export USAGESTAT_FIXTURE_LOG=/out/backend-commands.jsonl
    printf '%s\n' '{"scenario":"normal"}' > "$USAGESTAT_FIXTURE_STATE"
fi
python3 /src/platforms/linux/package.py stage /tmp/usagestat-package
native_options=()
if [[ "$target" == xfce ]]; then native_options=(--native xfce); fi
if [[ "$target" == sway || "$target" == hyprland ]]; then native_options=(--native waybar); fi
python3 /tmp/usagestat-package/platforms/linux/install.py --prefix /tmp/usagestat-prefix "${native_options[@]}" > /out/install.log
export PATH="/tmp/usagestat-prefix/bin:$PATH"
export GSETTINGS_SCHEMA_DIR=/tmp/usagestat-prefix/share/usagestat-bar/platforms/linux/schemas
if command -v rpm >/dev/null; then
    rpm -qa --qf '%{NAME} %{VERSION}-%{RELEASE}.%{ARCH}\n' | sort > /out/packages.txt
else
    pacman -Q > /out/packages.txt
fi
if [[ "${USAGESTAT_LAB_BUS:-}" != yes ]]; then
    export USAGESTAT_LAB_BUS=yes
    exec dbus-run-session -- bash /src/tests/linux/session-inner.sh "$target"
fi
