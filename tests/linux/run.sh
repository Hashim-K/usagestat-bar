#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test_root="$(mktemp -d -t usagestat-linux-contract.XXXXXX)"
trap 'rm -rf -- "$test_root"' EXIT
export XDG_CONFIG_HOME="$test_root/config" XDG_DATA_HOME="$test_root/data" XDG_CACHE_HOME="$test_root/cache"
export GSETTINGS_BACKEND=memory TZ=UTC
export USAGESTAT_FIXTURE_LOG="$test_root/commands.jsonl"
unset USAGESTAT_FIXTURE_STATE USAGESTAT_FIXTURE_SCENARIO
mkdir -p "$XDG_CONFIG_HOME/usagestat"
cp "$source_dir/tests/fixtures/config.toml" "$XDG_CONFIG_HOME/usagestat/config.toml"
python3 "$source_dir/platforms/linux/package.py" stage "$test_root/app"
export USAGESTAT_BAR_SCHEMA_DIR="$test_root/app/platforms/linux/schemas"
gjs -m "$source_dir/tests/linux/contracts.js"
