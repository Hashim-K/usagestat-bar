#!/usr/bin/env python3
"""Disposable KVM desktop guests; no host display, account config or libvirt domains."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import socket
import subprocess
import time
import tempfile
import shutil
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'artifacts/vm/downloads'
IMAGES = {
    'ubuntu': ('https://cloud-images.ubuntu.com/noble/current/', 'noble-server-cloudimg-amd64.img', None),
    'fedora': ('https://dl.fedoraproject.org/pub/fedora/linux/releases/44/Cloud/x86_64/images/',
               'Fedora-Cloud-Base-Generic-44-1.7.x86_64.qcow2', '28680fe5b371a5a82ebf43a31926e086a168e59949d03969c5093e7071f90b7f'),
}

def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)

def qmp(directory, command, arguments=None):
    info = json.loads((directory / 'vm.json').read_text())
    with socket.socket(socket.AF_UNIX) as connection:
        connection.connect(info['qmp'])
        stream = connection.makefile('rwb', buffering=0)
        stream.readline()
        for message in [{'execute': 'qmp_capabilities'}, {'execute': command, 'arguments': arguments or {}}]:
            stream.write(json.dumps(message).encode() + b'\n')
            while True:
                value = json.loads(stream.readline())
                if 'error' in value: raise RuntimeError(value)
                if 'return' in value: break
        return value['return']

def ssh(directory, command, **kwargs):
    info = json.loads((directory / 'vm.json').read_text())
    return run('ssh', '-F', '/dev/null', '-o', 'IdentitiesOnly=yes', '-i', info['key'], '-p', str(info['port']),
               '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=accept-new',
               '-o', f'UserKnownHostsFile={directory / "known_hosts"}', 'lab@127.0.0.1', command, **kwargs)

def create(directory, distro):
    directory.mkdir(parents=True, exist_ok=False)
    directory.chmod(0o700)
    CACHE.mkdir(parents=True, exist_ok=True)
    base, filename, expected = IMAGES[distro]
    image = CACHE / filename
    if not image.exists():
        urllib.request.urlretrieve(base + filename, image)
    if not expected:
        sums = urllib.request.urlopen(base + 'SHA256SUMS').read().decode()
        (directory / 'SHA256SUMS').write_text(sums)
        expected = next(line.split()[0] for line in sums.splitlines() if line.split()[-1].lstrip('*') == filename)
    actual = hashlib.file_digest(image.open('rb'), 'sha256').hexdigest()
    if actual != expected: raise RuntimeError(f'Image checksum mismatch: {image}')
    # Some shared workspaces cannot enforce 0600; keep guest keys on a native filesystem.
    key_path = Path(tempfile.mkdtemp(prefix='usagestat-vm-key.')) / 'id_ed25519'
    run('ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(key_path))
    key = key_path.with_suffix('.pub').read_text().strip()
    # The disposable guest's only remote login uses its generated SSH key.
    user_data = '#cloud-config\n' + json.dumps({
        'hostname': 'usagestat-lab', 'ssh_pwauth': False,
        'users': [{'name': 'lab', 'uid': 1000, 'shell': '/bin/bash', 'lock_passwd': True,
                   'sudo': 'ALL=(ALL) NOPASSWD:ALL', 'ssh_authorized_keys': [key]}],
    })
    (directory / 'user-data').write_text(user_data)
    (directory / 'meta-data').write_text(f'instance-id: {directory.name}\nlocal-hostname: usagestat-lab\n')
    run('genisoimage', '-quiet', '-output', str(directory / 'seed.iso'), '-volid', 'cidata', '-joliet', '-rock',
        str(directory / 'user-data'), str(directory / 'meta-data'))
    run('qemu-img', 'create', '-f', 'qcow2', '-F', 'qcow2', '-b', str(image), str(directory / 'disk.qcow2'), '24G')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    info = {'distro': distro, 'image': base + filename, 'sha256': actual, 'port': port,
            'key': str(key_path), 'qmp': f'/tmp/usagestat-{directory.name}-{port}.qmp', 'commit': subprocess.check_output(
                ['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()}
    (directory / 'vm.json').write_text(json.dumps(info, indent=2))
    boot(directory)

def boot(directory):
    info = json.loads((directory / 'vm.json').read_text())
    run('qemu-system-x86_64', '-name', f'usagestat-{directory.name}', '-enable-kvm', '-cpu', 'host',
        '-m', '3072', '-smp', '2', '-drive', f'file={directory / "disk.qcow2"},format=qcow2,if=virtio',
        '-drive', f'file={directory / "seed.iso"},format=raw,media=cdrom', '-device', 'virtio-vga',
        '-netdev', f'user,id=net,hostfwd=tcp:127.0.0.1:{info["port"]}-:22', '-device', 'virtio-net-pci,netdev=net',
        '-display', 'none', '-serial', f'file:{directory / "serial.log"}',
        '-qmp', f'unix:{info["qmp"]},server=on,wait=off', '-daemonize', '-pidfile', str(directory / 'qemu.pid'))
    print(f'Guest booted: {directory}', flush=True)

def provision(directory):
    wait_ssh(directory)
    distro = json.loads((directory / 'vm.json').read_text())['distro']
    if distro == 'ubuntu':
        packages = '''sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    gjs gir1.2-adw-1 gir1.2-gtk-4.0 gir1.2-rsvg-2.0 python3-gi dbus-x11 dconf-cli xfce4 xfce4-goodies \
    lightdm xserver-xorg xserver-xorg-video-all xdotool imagemagick xterm librsvg2-common \
    adwaita-icon-theme desktop-file-utils xfonts-base
'''
    else:
        packages = '''sudo dnf install -y --setopt=install_weak_deps=False \
    gjs libadwaita gtk4 python3-gobject dbus-x11 dconf xfce4-panel xfce4-session xfce4-settings \
    xfdesktop xfwm4 thunar lightdm lightdm-gtk xorg-x11-server-Xorg xrandr xdotool ImageMagick xterm librsvg2 \
    adwaita-icon-theme desktop-file-utils xorg-x11-fonts-misc
'''
    script = 'set -eu\nsudo cloud-init status --wait\n' + packages + '''
sudo mkdir -p /etc/lightdm/lightdm.conf.d
printf '[Seat:*]\\nautologin-user=lab\\nautologin-user-timeout=0\\nuser-session=xfce\\n' | sudo tee /etc/lightdm/lightdm.conf.d/90-usagestat-lab.conf >/dev/null
sudo systemctl set-default graphical.target
sudo systemctl enable lightdm
sudo systemctl start lightdm
'''
    ssh(directory, 'bash -s', input=script, text=True)

def wait_ssh(directory, previous_boot=None):
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        try:
            result = ssh(directory, 'cat /proc/sys/kernel/random/boot_id', stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
            if previous_boot is None or result.stdout != previous_boot: return
        except subprocess.CalledProcessError: pass
        time.sleep(1)
    raise RuntimeError('Guest SSH did not become ready')

def check(directory):
    wait_ssh(directory)
    sync(directory)
    try:
        ssh(directory, 'python3 /home/lab/source/tests/linux/vm-check.py install && python3 /home/lab/source/tests/linux/vm-check.py ui')
        before = ssh(directory, 'cat /proc/sys/kernel/random/boot_id', stdout=subprocess.PIPE, text=True).stdout
        ssh(directory, 'sudo reboot')
        wait_ssh(directory, before)
        ssh(directory, 'python3 /home/lab/source/tests/linux/vm-check.py after-reboot')
    finally:
        collect(directory)

def collect(directory):
    result = ssh(directory, 'tar -czf - -C /home/lab/out .', stdout=subprocess.PIPE)
    output = directory / 'evidence'
    output.mkdir(exist_ok=True)
    run('tar', '-xzf', '-', '-C', str(output), input=result.stdout)

def sync(directory):
    with tempfile.TemporaryDirectory(prefix='source.', dir=CACHE.parent) as temporary:
        source = Path(temporary) / 'source'
        run('python3', str(ROOT / 'platforms/linux/package.py'), 'stage', str(source))
        shutil.copytree(ROOT / 'tests', source / 'tests', ignore=shutil.ignore_patterns('__pycache__'))
        archive = subprocess.check_output(['tar', '-czf', '-', '-C', str(source), '.'])
        ssh(directory, 'mkdir -p /home/lab/source && tar -xzf - -C /home/lab/source', input=archive)
        (directory / 'source.json').write_text(json.dumps({
            'sha256': hashlib.sha256(archive).hexdigest(),
            'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
            'dirty': bool(subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=ROOT, text=True).strip())}, indent=2))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['create', 'boot', 'provision', 'sync', 'check', 'ssh', 'screenshot', 'stop', 'collect'])
    parser.add_argument('directory', type=Path)
    parser.add_argument('arguments', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    directory = args.directory.resolve()
    if args.command == 'create': create(directory, args.arguments[0])
    elif args.command == 'boot': boot(directory)
    elif args.command == 'provision': provision(directory)
    elif args.command == 'sync': sync(directory)
    elif args.command == 'check': check(directory)
    elif args.command == 'collect': collect(directory)
    elif args.command == 'ssh': ssh(directory, shlex.join(args.arguments))
    elif args.command == 'screenshot':
        qmp(directory, 'screendump', {'filename': str(directory / (args.arguments[0] if args.arguments else 'desktop.ppm'))})
    elif args.command == 'stop': qmp(directory, 'quit')

if __name__ == '__main__':
    main()
