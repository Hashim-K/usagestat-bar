#!/usr/bin/env python3
"""Private host CLI bridge for interactive desktop sessions, plus guest CLI shim."""
import json
import os
from pathlib import Path
import select
import signal
import socket
import socketserver
import subprocess
import sys
import threading
import time
import tomllib


class Bridge(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True

    def __init__(self, directory, backend, config_home):
        self.backend = str(backend)
        config_dir = 'usagestat-dev' if 'usagestat-dev' in backend.name else 'usagestat'
        self.config = config_home / config_dir / 'config.toml'
        config = tomllib.loads(self.config.read_text())
        self.providers = {p['id'] for p in config.get('providers', []) if isinstance(p.get('id'), str)}
        # Only display/selection fields enter the guest. Auth, custom commands,
        # plugin paths and arbitrary provider settings stay on the host.
        lines = [f'refreshSec = {int(config.get("refreshSec", 60))}', '']
        for provider in config.get('providers', []):
            if not isinstance(provider.get('id'), str):
                continue
            lines.append('[[providers]]')
            for key in ('id', 'instanceId', 'tabParent', 'displayName', 'source'):
                value = provider.get(key)
                if isinstance(value, str) and value and value != 'custom':
                    lines.append(f'{key} = {json.dumps(value)}')
            enabled = provider.get('enabled', True) and not (
                provider.get('customCommand') or provider.get('custom') or provider.get('source') == 'custom')
            lines.extend([f'enabled = {str(bool(enabled)).lower()}',
                          f'hidden = {str(bool(provider.get("hidden", False))).lower()}', ''])
        (directory / 'config.toml').write_text('\n'.join(lines))
        self.environment = dict(os.environ, XDG_CONFIG_HOME=str(config_home),
                                XDG_DATA_HOME=str(Path.home() / '.local/share'),
                                XDG_CACHE_HOME=str(Path.home() / '.cache'),
                                XDG_STATE_HOME=str(Path.home() / '.local/state'))
        self.stopping = threading.Event()
        self.slots = threading.BoundedSemaphore(4)
        super().__init__(str(directory / 'backend.sock'), Handler)
        os.chmod(self.server_address, 0o600)

    def command(self, args):
        if not isinstance(args, list) or len(args) > 16 or not all(isinstance(a, str) for a in args):
            raise ValueError('Invalid backend request.')
        if args == ['--version']:
            return [self.backend, '--version']
        # The guest's editable config path must never select a file on the host.
        filtered = []
        iterator = iter(args)
        for arg in iterator:
            if arg == '--config':
                if next(iterator, None) is None:
                    raise ValueError('Missing config path.')
            else:
                filtered.append(arg)
        valid = filtered == ['--json', 'list']
        if (len(filtered) in (4, 6) and filtered[:1] == ['--json']
                and filtered[1] in ('usage', 'cost') and filtered[2] == '--provider'
                and filtered[3] in self.providers and filtered[3] not in ('all', 'both')):
            valid = len(filtered) == 4 or (
                filtered[1] == 'usage' and filtered[4] == '--source'
                and filtered[5] in ('auto', 'web', 'cli', 'oauth', 'api', 'local'))
        if not valid:
            raise ValueError('Live desktop bridge supports version, provider list, usage and cost queries only. '
                             'Manage host accounts from GNOME.')
        return [self.backend, '--config', str(self.config), *filtered]


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(95)
        process = None
        acquired = False
        try:
            request = self.rfile.readline(8193)
            if len(request) > 8192 or not request.endswith(b'\n'):
                raise ValueError('Invalid backend request.')
            argv = self.server.command(json.loads(request))
            acquired = self.server.slots.acquire(blocking=False)
            if not acquired:
                raise ValueError('Backend is busy; try refreshing again shortly.')
            process = subprocess.Popen(argv, env=self.server.environment, stdin=subprocess.DEVNULL,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            deadline = time.monotonic() + 80
            while True:
                if self.server.stopping.is_set() or time.monotonic() >= deadline:
                    raise ValueError('Live backend request stopped or timed out.')
                readable, _, _ = select.select([self.connection], [], [], 0)
                if readable and not self.connection.recv(1, socket.MSG_PEEK):
                    return  # Closing/cancelling the guest CLI also cancels its host process.
                try:
                    stdout, stderr = process.communicate(timeout=0.2)
                    break
                except subprocess.TimeoutExpired:
                    continue
            response = {'status': max(0, process.returncode) if process.returncode >= 0 else 128 - process.returncode,
                        'stdout': stdout.decode('utf-8', errors='replace'),
                        'stderr': stderr.decode('utf-8', errors='replace')}
        except (ValueError, OSError) as error:
            response = {'status': 1, 'stdout': '', 'stderr': f'{error}\n'}
        finally:
            if process is not None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.communicate()
            if acquired:
                self.server.slots.release()
        try:
            self.wfile.write(json.dumps(response).encode() + b'\n')
        except OSError:
            pass


def client():
    try:
        with socket.socket(socket.AF_UNIX) as connection:
            connection.settimeout(90)
            connection.connect(os.environ['USAGESTAT_BACKEND_SOCKET'])
            connection.sendall(json.dumps(sys.argv[1:]).encode() + b'\n')
            with connection.makefile('rb') as stream:
                response = json.loads(stream.readline(16 * 1024 * 1024))
        sys.stdout.write(response['stdout'])
        sys.stderr.write(response['stderr'])
        return response['status']
    except (OSError, ValueError, KeyError) as error:
        print(f'Host backend unavailable: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(client())
