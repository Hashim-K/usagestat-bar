#!/usr/bin/env bash
set -euo pipefail

uuid="usagestat-bar@hashimkarim"
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="${1:-$source_dir/${uuid}.shell-extension.zip}"
if [[ "$out" != /* ]]; then
    out="$PWD/$out"
fi
stage_dir="$(mktemp -d -t usagestat-package.XXXXXX)"
trap 'rm -rf -- "$stage_dir"' EXIT

for app_file in extension.js prefs.js cli.js config.js stylesheet.css metadata.json schemas assets LICENSE; do
    cp -a "$source_dir/$app_file" "$stage_dir/"
done
glib-compile-schemas --strict "$stage_dir/schemas/"

mkdir -p "$(dirname "$out")"
rm -f "$out"
cd "$stage_dir"
zip -qr "$out" \
    extension.js \
    prefs.js \
    cli.js \
    config.js \
    stylesheet.css \
    metadata.json \
    schemas/ \
    assets/ \
    LICENSE \
    -x "schemas/.fuse_hidden*" "schemas/gschemas.compiled"

echo "Built: $out"
