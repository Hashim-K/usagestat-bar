#!/usr/bin/env bash
# Preview-only compositor compatibility fix; never modifies the host desktop.
set -euo pipefail
revision=314fc670a83f1e570b069cd709df809ba99fa334
git clone --depth 1 --branch epoch-1.6.0 https://github.com/pop-os/cosmic-comp.git /tmp/cosmic-comp
cd /tmp/cosmic-comp
test "$(git rev-parse HEAD)" = "$revision"
export CARGO_HOME=/tmp/cosmic-cargo CARGO_BUILD_JOBS=3
export CARGO_PROFILE_RELEASE_LTO=false CARGO_PROFILE_RELEASE_OPT_LEVEL=2
cargo fetch --locked
smithay_source="$(find "$CARGO_HOME/git/checkouts" -path '*/src/wayland/shell/wlr_layer/mod.rs' -print -quit)"
test -n "$smithay_source"
smithay_root="${smithay_source%/src/wayland/shell/wlr_layer/mod.rs}"
test "$(git -C "$smithay_root" rev-parse HEAD)" = 5fb12b87407b3680135c45d94214c5f1b1d0fbea
patch -d "$smithay_root" -p1 < /tmp/smithay-destroyed-layer.patch
cargo build --release --locked --bin cosmic-comp
install -Dm755 target/release/cosmic-comp /usr/local/bin/cosmic-comp
mkdir -p /usr/share/usagestat-lab
printf '%s\n' "COSMIC epoch-1.6.0 $revision" \
    'Smithay 5fb12b87407b3680135c45d94214c5f1b1d0fbea with destroyed-layer pre-commit guard' \
    > /usr/share/usagestat-lab/cosmic-build.txt
