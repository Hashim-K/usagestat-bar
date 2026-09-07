#!/usr/bin/env python3
"""Open a disposable desktop for a human to review with their real host backend."""
import argparse
import os
import re
from pathlib import Path
import secrets
import select
import shutil
import signal
import socket
import socketserver
import struct
import subprocess
import sys
import tempfile
import threading
import time

from backend_bridge import Bridge

ROOT = Path(__file__).resolve().parents[2]
TARGETS = ('plasma', 'cinnamon', 'mate', 'xfce', 'lxqt', 'budgie', 'cosmic', 'sway', 'hyprland', 'i3', 'bspwm')


class VncRelay(socketserver.ThreadingTCPServer):
    """Reach the guest's private VNC socket without giving it network access."""
    daemon_threads = True

    def __init__(self, path):
        self.path = str(path)
        self.stopping = threading.Event()
        super().__init__(('127.0.0.1', 0), VncRelayHandler)


class VncRelayHandler(socketserver.BaseRequestHandler):
    @staticmethod
    def receive(connection, size):
        data = b''
        while len(data) < size:
            part = connection.recv(size - len(data))
            if not part: raise ConnectionError('VNC connection closed during negotiation')
            data += part
        return data

    def handle(self):
        try:
            with socket.socket(socket.AF_UNIX) as upstream:
                upstream.settimeout(2)
                upstream.connect(self.server.path)
                self.request.settimeout(2)
                self.request.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                # Use the same password authentication as Xvnc. GtkVnc would
                # otherwise prefer Apple DH, which aborts in NeatVNC 1.0.1.
                version = self.receive(upstream, 12)
                if version != b'RFB 003.008\n': return
                self.request.sendall(version)
                version = self.receive(self.request, 12)
                if version != b'RFB 003.008\n': return
                upstream.sendall(version)
                methods = self.receive(upstream, self.receive(upstream, 1)[0])
                if 2 not in methods: return
                self.request.sendall(b'\x01\x02')
                if self.receive(self.request, 1) != b'\x02': return
                upstream.sendall(b'\x02')
                stopped = threading.Event()

                def forward(source, destination):
                    try:
                        while not stopped.is_set() and not self.server.stopping.is_set():
                            ready, _, _ = select.select([source], [], [], 0.2)
                            if not ready: continue
                            data = source.recv(262144)
                            if not data: break
                            destination.sendall(data)
                    except OSError:
                        pass
                    finally:
                        stopped.set()

                # A large frame must never block pointer/keyboard traffic in
                # the other direction while the viewer catches up.
                frames = threading.Thread(target=forward, args=(upstream, self.request), daemon=True)
                frames.start()
                forward(self.request, upstream)
                for connection in (self.request, upstream):
                    try: connection.shutdown(socket.SHUT_RDWR)
                    except OSError: pass
                frames.join(timeout=2)
        except OSError:
            pass  # Closing the viewer or guest ends this connection.


def local_timezone():
    configured = os.environ.get('TZ')
    if configured: return configured
    path = str(Path('/etc/localtime').resolve())
    return path.split('/zoneinfo/', 1)[1] if '/zoneinfo/' in path else 'UTC'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target', choices=(*TARGETS, 'remaining'), nargs='?', default='plasma',
                        help='Desktop to open; remaining opens each unreviewed desktop in order')
    parser.add_argument('--backend', required=True, type=Path, help='Absolute host usagestat or usagestat-dev path')
    parser.add_argument('--config-home', type=Path, default=Path.home() / '.config',
                        help='Host config directory (default: ~/.config)')
    parser.add_argument('--size', default='1500x900', help='Desktop size (default: 1500x900)')
    parser.add_argument('--fps', type=int, default=60, help='Hyprland stream frame-rate limit (default: 60)')
    parser.add_argument('--timezone', default=local_timezone(), help='Timezone for usage/reset times (default: host timezone)')
    args = parser.parse_args()
    if not re.fullmatch(r'[1-9][0-9]{2,3}x[1-9][0-9]{2,3}', args.size):
        parser.error('--size must be WIDTHxHEIGHT, such as 1500x900')
    if not 1 <= args.fps <= 120: parser.error('--fps must be between 1 and 120')
    if not args.backend.is_absolute() or not os.access(args.backend, os.X_OK):
        parser.error('--backend must be an absolute executable path')

    def stop_signal(_signum, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop_signal)
    signal.signal(signal.SIGHUP, stop_signal)
    if args.target == 'remaining':
        print('Manual review: close each viewer to open the next desktop. Ctrl+C stops the review queue.', flush=True)
        for target in TARGETS[1:]:
            print(f'\nOpening {target} ({TARGETS.index(target)}/{len(TARGETS) - 1})', flush=True)
            process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), target,
                '--backend', str(args.backend), '--config-home', str(args.config_home),
                '--size', args.size, '--fps', str(args.fps), '--timezone', args.timezone], start_new_session=True)
            try:
                result = process.wait()
            except BaseException:
                # Let the child close its container, viewer and private bridge
                # when the queue is interrupted; do not kill it mid-cleanup.
                if process.poll() is None: process.terminate()
                try: process.wait(timeout=45)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait()
                raise
            if result:
                raise RuntimeError(f'{target} could not open. Restart with that desktop name after checking its logs.')
        return
    direct_wayland = args.target == 'hyprland'
    programs = ('podman', 'remote-viewer') if direct_wayland else ('podman', 'Xvnc', 'vncpasswd', 'remote-viewer')
    for program in programs:
        if not shutil.which(program):
            parser.error(f'Missing {program}; install the Podman, TigerVNC server and virt-viewer packages.')
    podman = ['podman']
    if os.environ.get('USAGESTAT_PODMAN_ROOT'):
        podman += ['--root', os.environ['USAGESTAT_PODMAN_ROOT']]
    image = 'localhost/usagestat-hyprland-lab:arch' if args.target == 'hyprland' else 'localhost/usagestat-linux-lab:44'
    if not os.environ.get('USAGESTAT_PODMAN_ROOT') and subprocess.run([*podman, 'image', 'exists', image]).returncode:
        # GUI coding tools may set XDG_DATA_HOME to their own data directory.
        # Reuse the user's existing lab images instead of requiring a rebuild.
        conventional_store = Path.home() / '.local/share/containers/storage'
        if conventional_store.is_dir():
            candidate = ['podman', '--root', str(conventional_store)]
            if subprocess.run([*candidate, 'image', 'exists', image]).returncode == 0: podman = candidate
    if subprocess.run([*podman, 'image', 'exists', image]).returncode:
        parser.error('Build the desktop image first: bash tests/linux/build-lab.sh ' + ('hyprland' if args.target == 'hyprland' else 'fedora'))
    render_node = os.environ.get('USAGESTAT_LAB_RENDER_NODE', '/dev/dri/renderD128')
    if args.target in ('cosmic', 'hyprland') and not os.access(render_node, os.R_OK | os.W_OK):
        parser.error(f'{args.target} needs a readable/writable render node; set USAGESTAT_LAB_RENDER_NODE (currently {render_node}).')
    runtime = Path(tempfile.mkdtemp(prefix=f'usagestat-{args.target}-', dir=os.environ.get('XDG_RUNTIME_DIR')))
    os.chmod(runtime, 0o700)
    (runtime / 'session.pid').write_text(str(os.getpid()) + '\n')
    output = runtime / 'logs'
    output.mkdir()
    bridge_dir = runtime / 'bridge'
    bridge_dir.mkdir()
    name = runtime.name
    processes = []
    bridge = None
    container = None
    relay = None
    display_dir = runtime / 'display'

    def start(command, log):
        with (output / log).open('wb') as stream:
            process = subprocess.Popen(command, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        processes.append(process)
        return process

    def wait_for(predicate, description, timeout=60):
        deadline = time.monotonic() + timeout
        while not predicate():
            if any(process.poll() is not None for process in processes):
                raise RuntimeError(f'A session process exited while {description}. See {output}')
            if time.monotonic() > deadline:
                raise RuntimeError(f'Timed out while {description}. See {output}')
            time.sleep(0.2)

    try:
        bridge = Bridge(bridge_dir, args.backend, args.config_home.expanduser().absolute())
        threading.Thread(target=bridge.serve_forever, daemon=True).start()
        password = secrets.token_hex(4)
        if direct_wayland:
            display_dir.mkdir(mode=0o700)
            config = display_dir / 'wayvnc.conf'
            # Match the existing local-only Xvnc authentication. The guest
            # listens only on a private Unix socket; the relay binds loopback.
            config.write_text('enable_auth=true\nrelax_encryption=true\nallow_broken_crypto=true\n'
                              f'password={password}\n')
            config.chmod(0o600)
            display_args = ['-e', 'USAGESTAT_LAB_WAYVNC_SOCKET=/display/vnc.sock',
                            '-v', f'{display_dir}:/display:rw']
        else:
            display_number = next(number for number in range(90, 190)
                                  if not Path(f'/tmp/.X11-unix/X{number}').exists()
                                  and not Path(f'/tmp/.X{number}-lock').exists())
            display = f':{display_number}'
            x_socket = Path(f'/tmp/.X11-unix/X{display_number}')
            # FamilyWild permits the disposable container's hostname, on this
            # display only. Only this private display's socket/cookie are mounted.
            def field(value):
                return struct.pack('!H', len(value)) + value
            authority = runtime / 'display.auth'
            authority.write_bytes(struct.pack('!H', 65535) + field(b'') + field(str(display_number).encode())
                                  + field(b'MIT-MAGIC-COOKIE-1') + field(secrets.token_bytes(16)))
            authority.chmod(0o600)
            password_file = runtime / 'vnc.auth'
            password_file.write_bytes(subprocess.check_output(['vncpasswd', '-f'], input=(password + '\n').encode()))
            password_file.chmod(0o600)
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0))
                port = probe.getsockname()[1]
            start(['Xvnc', display, '-geometry', args.size, '-depth', '24', '-nolisten', 'tcp',
                   '-auth', str(authority), '-SecurityTypes', 'VncAuth', '-PasswordFile', str(password_file),
                   '-interface', '127.0.0.1', '-localhost', '-UseIPv6=0', '-rfbport', str(port),
                   '-desktop', f'UsageStat — {args.target} — live backend', '-noreset'], 'display.log')
            wait_for(x_socket.exists, 'starting the private display', 15)
            display_args = ['-e', f'USAGESTAT_LAB_DISPLAY={display}', '-e', 'XAUTHORITY=/display.auth',
                            '-v', f'{authority}:/display.auth:ro', '-v', f'{x_socket}:{x_socket}:rw']
        command = [*podman, 'run', '--rm', '--name', name, '--network', 'none', '--security-opt', 'label=disable']
        if args.target in ('sway', 'hyprland'):
            command += ['--userns=keep-id']
        if args.target in ('cosmic', 'hyprland'):
            command += ['--device', render_node]
        if direct_wayland:
            command += ['--shm-size=512m', '-e', f'USAGESTAT_LAB_FPS={args.fps}']
        command += [*display_args, '-e', 'USAGESTAT_LAB_INTERACTIVE=1',
                    '-e', f'USAGESTAT_LAB_SIZE={args.size}', '-e', f'USAGESTAT_LAB_TIMEZONE={args.timezone}',
                    '-v', f'{bridge_dir}:/bridge:ro',
                    '-v', f'{ROOT}:/src:ro', '-v', f'{output}:/out:rw', image,
                    'bash', '/src/tests/linux/session.sh', args.target]
        container = start(command, 'session.log')
        print(f'Starting {args.target} with {args.backend}. Private session logs: {output}', flush=True)
        wait_for(lambda: (output / 'interactive-ready').exists(), 'starting the desktop')
        if direct_wayland:
            wait_for(lambda: (display_dir / 'vnc.sock').is_socket(), 'starting the Wayland display stream', 15)
            relay = VncRelay(display_dir / 'vnc.sock')
            threading.Thread(target=relay.serve_forever, daemon=True).start()
            port = relay.server_address[1]
        connection = runtime / 'desktop.vv'
        connection.write_text(f'[virt-viewer]\ntype=vnc\nhost=127.0.0.1\nport={port}\npassword={password}\n'
                              'delete-this-file=1\n')
        connection.chmod(0o600)
        viewer = start(['remote-viewer', '--title', f'UsageStat — {args.target} — live backend',
                        '--auto-resize=never', str(connection)], 'viewer.log')
        print('Desktop open for manual review. Close the viewer or press Ctrl+C here to stop the session.', flush=True)
        print('Host accounts stay on the host; preferences are disposable. No automated checks or screenshots run.', flush=True)
        while viewer.poll() is None:
            if container.poll() is not None:
                raise RuntimeError(f'Desktop session exited. See {output}')
            time.sleep(0.5)
        if viewer.returncode:
            raise RuntimeError(f'Viewer exited with status {viewer.returncode}. See {output / "viewer.log"}')
    finally:
        if relay:
            relay.stopping.set()
            relay.shutdown()
            relay.server_close()
        if bridge:
            bridge.stopping.set()
        if container is not None:
            try:
                subprocess.run([*podman, 'stop', '--time', '2', name], stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=15)
            except (OSError, subprocess.TimeoutExpired):
                # Still close the viewer, display and host bridge if Podman
                # is unavailable; terminating its attached process is next.
                pass
        for process in reversed(processes):
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                except ProcessLookupError:
                    pass
        if bridge:
            bridge.shutdown()
            bridge.server_close()
        for secret in ('display.auth', 'vnc.auth', 'desktop.vv', 'session.pid'):
            (runtime / secret).unlink(missing_ok=True)
        shutil.rmtree(bridge_dir)
        if display_dir.exists(): shutil.rmtree(display_dir)
        print(f'Session stopped. Private logs remain at {output}', flush=True)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
