#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="$(mktemp -d -t usagestat-contract.XXXXXX)"
trap 'rm -rf -- "$test_root"' EXIT
export XDG_CONFIG_HOME="$test_root/config"
export XDG_CACHE_HOME="$test_root/cache"
export XDG_DATA_HOME="$test_root/data"
export GSETTINGS_BACKEND=memory
export USAGESTAT_FIXTURE_LOG="$test_root/commands.jsonl"
export TZ=UTC
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME"
unset USAGESTAT_FIXTURE_STATE USAGESTAT_FIXTURE_SCENARIO
cd "$source_dir"
gjs -m tests/contracts.js
