#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
target="${1:-lxqt}"
case "$target" in
    plasma|cinnamon|mate|xfce|lxqt|budgie|cosmic|sway|hyprland|i3|bspwm) ;;
    *) echo 'Target must be plasma, cinnamon, mate, xfce, lxqt, budgie, cosmic, sway, hyprland, i3 or bspwm.' >&2; exit 2 ;;
esac
lab_image=localhost/usagestat-linux-lab:44
user_options=()
device_options=()
if [[ "$target" == sway || "$target" == hyprland ]]; then user_options=(--userns=keep-id); fi
if [[ "$target" == hyprland || "$target" == cosmic ]]; then
    render_node="${USAGESTAT_LAB_RENDER_NODE:-/dev/dri/renderD128}"
    if [[ ! -r "$render_node" || ! -w "$render_node" ]]; then
        echo "$target nested checks need a readable/writable DRM render node: $render_node" >&2
        exit 2
    fi
    device_options=(--device "$render_node")
fi
if [[ "$target" == hyprland ]]; then lab_image=localhost/usagestat-hyprland-lab:arch; fi
mkdir -p "$source_dir/artifacts"
out="$(mktemp -d "$source_dir/artifacts/linux-${target}.XXXXXX")"
echo "Linux $target check artifacts: $out"
python3 - "$source_dir" "$out" "$target" "$lab_image" <<'PY'
import json, platform, subprocess, sys
from pathlib import Path
root, output, target, image = sys.argv[1:]
run=lambda *args:subprocess.check_output(args,cwd=root,text=True).strip()
Path(output,'environment.json').write_text(json.dumps({'target':target,'commit':run('git','rev-parse','HEAD'),'dirty':bool(run('git','status','--porcelain','--untracked-files=no')),'hostKernel':platform.release(),'architecture':platform.machine(),'image':run('podman','image','inspect',image,'--format','{{.Id}}')},indent=2))
PY
timeout --kill-after=10s 180s podman run --rm --name "$(basename "$out")" --network none --security-opt label=disable \
    "${user_options[@]}" \
    "${device_options[@]}" \
    -e USAGESTAT_LAB_HOLD="${USAGESTAT_LAB_HOLD:-0}" \
    -v "$source_dir:/src:ro" -v "$out:/out:rw" "$lab_image" \
    bash /src/tests/linux/session.sh "$target" > "$out/session.log" 2>&1 || {
        cat "$out/result.json" 2>/dev/null || tail -40 "$out/session.log"
        exit 1
    }
cat "$out/result.json"
