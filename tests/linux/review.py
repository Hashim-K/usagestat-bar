#!/usr/bin/env python3
"""Record real panel interactions in isolated Linux desktop sessions."""
import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
TARGETS = 'cinnamon plasma mate xfce lxqt sway hyprland budgie cosmic i3 bspwm'.split()


def run(target, output):
    output.mkdir(parents=True, exist_ok=False)
    podman = ['podman', '--root', os.environ.get('USAGESTAT_PODMAN_ROOT', str(Path.home()/'.local/share/containers/storage'))]
    image = 'localhost/usagestat-hyprland-lab:arch' if target == 'hyprland' else os.environ.get('USAGESTAT_LAB_IMAGE', 'localhost/usagestat-linux-lab:44')
    name = f'usagestat-review-{target}-{os.getpid()}'
    args = [*podman, 'run', '--rm', '--name', name, '--network', 'none', '--security-opt', 'label=disable',
            '-e', 'USAGESTAT_LAB_INTERACTIONS=1', '-e', 'USAGESTAT_LAB_HOLD='+os.environ.get('USAGESTAT_LAB_HOLD','0'),
            '-e', 'USAGESTAT_LAB_CORE_ONLY='+os.environ.get('USAGESTAT_LAB_CORE_ONLY','0'),
            '-e', 'USAGESTAT_LAB_TRAY_COMPANION='+os.environ.get('USAGESTAT_LAB_TRAY_COMPANION','0'),
            '-v', f'{output / "source"}:/src:ro', '-v', f'{output}:/out:rw']
    if target in ['cinnamon','sway','hyprland']: args += ['--userns=keep-id:uid=1000,gid=1000']
    if target == 'hyprland': args += ['--device', os.environ.get('USAGESTAT_LAB_RENDER_NODE','/dev/dri/renderD128')]
    args += [image, 'bash', '/src/tests/linux/session.sh', target]
    sources=sorted(p for folder in ['platforms','tests','schemas','assets'] for p in (ROOT/folder).rglob('*')
        if p.is_file() and '__pycache__' not in p.parts)
    sources+=sorted(p for p in ROOT.iterdir() if p.is_file() and (p.suffix in ['.js','.css','.json'] or p.name == 'LICENSE'))
    digest=hashlib.sha256()
    # Freeze the code used by this recording. A read-only bind mount of the
    # working tree still changes underneath a running shell when we edit it.
    for path in sources:
        relative=path.relative_to(ROOT)
        content=path.read_bytes()
        destination=output/'source'/relative
        destination.parent.mkdir(parents=True,exist_ok=True)
        destination.write_bytes(content)
        shutil.copymode(path,destination)
        digest.update(str(relative).encode()+b'\0'+content)
    (output/'environment.json').write_text(json.dumps({'target':target,'image':subprocess.check_output([*podman,'image','inspect',image,'--format','{{.Id}}'],text=True).strip(),
        'sourceSha256':digest.hexdigest(),
        'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
        'dirty':bool(subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=ROOT,text=True)),
        'backend':'synthetic fixtures', 'input':'native mouse / wheel events', 'capture':'unedited frames at 5 FPS',
        'trayCompanion':target in ['cosmic','lxqt','budgie'] and os.environ.get('USAGESTAT_LAB_TRAY_COMPANION')=='1'},indent=2))
    capture = encoder = None
    with (output/'session.log').open('wb') as log, (output/'capture.log').open('wb') as capture_log:
        session = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline=time.monotonic()+100
            while not (output/'capture-env.json').exists():
                if session.poll() is not None: raise RuntimeError(f'{target}: startup failed; see {output}/session.log')
                if time.monotonic()>deadline: raise RuntimeError(f'{target}: startup timed out')
                time.sleep(.2)
            capture=subprocess.Popen([*podman,'exec',name,'python3','/src/tests/linux/capture.py'],stdout=subprocess.PIPE,stderr=capture_log)
            encoder=subprocess.Popen(['ffmpeg','-y','-hide_banner','-loglevel','warning','-f','image2pipe','-framerate','5','-i','pipe:0',
                '-an','-c:v','libx264','-preset','fast','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart',str(output/'review.mp4')],
                stdin=capture.stdout,stdout=capture_log,stderr=capture_log)
            capture.stdout.close()
            session.wait(timeout=300+int(os.environ.get('USAGESTAT_LAB_HOLD','0')))
            capture.wait(timeout=15); encoder.wait(timeout=15)
            result=json.loads((output/'result.json').read_text())
            print(target, result['status'], output, flush=True)
            return result
        finally:
            (output/'recording.stop').touch()
            if session.poll() is None: subprocess.run([*podman,'stop','--time','2',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
            for process in [capture,encoder]:
                if process and process.poll() is None: process.terminate(); process.wait(timeout=10)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target',choices=[*TARGETS,'all'])
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    targets=TARGETS if args.target=='all' else [args.target]
    failed=False
    for target in targets:
        try: failed=run(target,args.output.absolute()/target)['status']!='passed' or failed
        except Exception as error:
            print(str(error),flush=True); failed=True
    raise SystemExit(1 if failed else 0)
