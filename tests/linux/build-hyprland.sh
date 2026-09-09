#!/usr/bin/env bash
set -euo pipefail
# Backport the on-map pointer fix from Hyprland PR #15899 onto the lab's
# packaged 0.56.2 ABI. Do not disable popup keyboard navigation as a workaround.
git clone --depth 1 --branch v0.56.2 https://github.com/hyprwm/Hyprland /tmp/hyprland-build
cd /tmp/hyprland-build
test "$(git rev-parse HEAD)" = efb50993780079460b0cbed1363e2166a2de1d9f
git submodule update --init --depth 1 subprojects/udis86 subprojects/hyprland-protocols
git apply /tmp/hyprland-layer-focus.patch
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr \
    -DCMAKE_CXX_FLAGS_RELEASE='-O2 -DNDEBUG' -DBUILD_TESTING=OFF
cmake --build build --target Hyprland --parallel 3
install -m 755 build/Hyprland /usr/bin/Hyprland
mkdir -p /usr/share/usagestat-lab
printf '%s\n' 'Hyprland 0.56.2 + on-map pointer focus fix from upstream PR #15899' \
    > /usr/share/usagestat-lab/hyprland-build.txt
cd /
rm -rf /tmp/hyprland-build
