#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec python3 "$source_dir/platforms/linux/package.py" build "${1:-$source_dir/artifacts/usagestat-bar-linux.tar.gz}"
