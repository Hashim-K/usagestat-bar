#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="$(mktemp -d -t usagestat-install-check.XXXXXX)"
trap 'rm -rf -- "$test_root"' EXIT
# Exercise invocation from outside the checkout and installation over a dev link.
cd "$test_root"
"$source_dir/build.sh" "$test_root/extension.zip"
mkdir "$test_root/old-link-target"
printf '%s\n' 'must survive' > "$test_root/old-link-target/sentinel"
install_target="$test_root/data/gnome-shell/extensions/usagestat-bar@hashimkarim"
mkdir -p "$(dirname "$install_target")"
ln -s "$test_root/old-link-target" "$install_target"
XDG_DATA_HOME="$test_root/data" "$source_dir/install.sh"
test -f "$test_root/old-link-target/sentinel"
test ! -L "$install_target"
python3 - "$test_root/extension.zip" "$install_target" <<'PY'
import json
from pathlib import Path
import sys
import zipfile
archive, target = sys.argv[1:]
expected = {'extension.js', 'prefs.js', 'cli.js', 'config.js', 'stylesheet.css',
            'metadata.json', 'schemas', 'assets', 'LICENSE'}
with zipfile.ZipFile(archive) as package:
    paths = package.namelist()
    assert {name.split('/')[0] for name in paths} == expected
    assert 'schemas/gschemas.compiled' not in paths
    assert json.loads(package.read('metadata.json'))['uuid'] == 'usagestat-bar@hashimkarim'
    for name in paths:
        if not name.endswith('/'):
            assert Path(target, name).read_bytes() == package.read(name), name
assert Path(target, 'schemas/gschemas.compiled').is_file()
print('Passed: runtime-only archive, installed files match, schemas compile, dev-link target preserved')
PY
