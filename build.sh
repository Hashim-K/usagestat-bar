#!/usr/bin/env bash
set -euo pipefail

uuid="ai-usage-bar@hashimkarim"
out="${uuid}.shell-extension.zip"

glib-compile-schemas schemas/

rm -f "$out"
zip -r "$out" \
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
