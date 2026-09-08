#!/usr/bin/env python3
"""Stream unedited desktop PNG frames to the host's video encoder."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

os.environ.update(json.loads(Path('/out/capture-env.json').read_text()))
wayland = os.environ.get('XDG_SESSION_TYPE') == 'wayland'
command = ['grim', '-'] if wayland else ['magick', 'import', '-window', 'root', 'png:-']
started = time.monotonic()
emitted = 0
previous = None
while not Path('/out/recording.stop').exists():
    frame = subprocess.check_output(command, timeout=10)
    # PNG capture can be slower than 5 FPS on a busy software-rendered desktop.
    # Hold the previous frame across missed samples instead of speeding up the
    # whole recording (which would misrepresent input latency and seek times).
    expected = int((time.monotonic() - started) * 5) + 1
    for _ in range(max(0, expected - emitted - 1)):
        sys.stdout.buffer.write(previous or frame)
    sys.stdout.buffer.write(frame)
    sys.stdout.buffer.flush()
    emitted = max(expected, emitted + 1)
    previous = frame
    Path('/out/recording.ready').touch()
    time.sleep(max(0, started + emitted / 5 - time.monotonic()))
