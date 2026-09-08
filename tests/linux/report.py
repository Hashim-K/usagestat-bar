#!/usr/bin/env python3
"""Collect recorded desktop runs into a local, self-contained review gallery."""
import argparse
from collections import Counter
from html import escape
import json
from pathlib import Path
import shutil
from urllib.parse import quote

ORDER = 'gnome plasma cinnamon mate xfce lxqt sway hyprland budgie cosmic i3 bspwm'.split()
LABELS = dict(zip(ORDER, ['GNOME', 'Plasma', 'Cinnamon', 'MATE', 'Xfce', 'LXQt',
                         'Sway', 'Hyprland', 'Budgie', 'COSMIC', 'i3', 'bspwm']))


def collect(batches, output, blocked, notes):
    selected = {}
    for batch in batches:
        for path in sorted(batch.glob('*/result.json')):
            selected[path.parent.name] = path.parent
    if not selected:
        raise ValueError('No target/result.json files found in the supplied batches.')
    output.mkdir(parents=True, exist_ok=False)
    runs = []
    for target in sorted(selected, key=lambda name: (ORDER.index(name) if name in ORDER else 99, name)):
        source = selected[target]
        destination = output / target
        destination.mkdir()
        for path in source.iterdir():
            if path.is_file() and not path.name.startswith('.') and path.suffix in ['.json', '.png', '.mp4', '.log', '.txt']:
                shutil.copy2(path, destination / path.name)
        raw = json.loads((source / 'result.json').read_text())
        checks = raw.get('checks', raw.get('results', []))
        counts = dict(Counter(check['status'] for check in checks))
        runs.append(dict(target=target, label=LABELS.get(target, target), source=str(source.resolve()),
                         status='blocked' if target in blocked else raw['status'], rawStatus=raw['status'],
                         counts=counts, note=notes.get(target, ''), checks=checks))
    (output / 'summary.json').write_text(json.dumps(runs, indent=2) + '\n')
    return runs


def render(runs, title):
    sections, rows = [], []
    for run in runs:
        target, label, status = run['target'], run['label'], run['status']
        counts = ', '.join(f'{count} {kind}' for kind, count in run['counts'].items())
        verdict = 'Environment blocked' if status == 'blocked' else ('Checks passed' if status == 'passed' else 'Needs fixes / review')
        rows.append(f'<tr><th><a href="#{target}">{escape(label)}</a></th><td class="{status}">{verdict}</td>'
                    f'<td>{escape(counts)}</td><td>{escape(run["note"])}</td></tr>')
        cards = []
        for check in run['checks']:
            name, result = check['name'], check['status']
            shot = check.get('screenshot')
            figure = (f'<a href="{target}/{quote(shot)}"><img loading="lazy" src="{target}/{quote(shot)}" '
                      f'alt="{escape(label)}: {escape(name)}"></a>') if shot else ''
            cue = (f'<button data-player="video-{target}" data-time="{check["seconds"]}">Play near this step</button>') if 'seconds' in check else ''
            details = {key: check[key] for key in ['observation', 'error', 'reason'] if key in check}
            cards.append(f'<article class="check" data-status="{result}"><h3>{escape(name)}</h3>'
                         f'<p class="{result}">{result}</p>{figure}{cue}<details><summary>Observed result</summary>'
                         f'<pre>{escape(json.dumps(details, indent=2))}</pre></details></article>')
        sections.append(f'<section id="{target}"><div class="section-heading"><h2>{escape(label)}</h2>'
                        f'<span class="{status}">{verdict}</span></div><p>{escape(run["note"])}</p>'
                        f'<video id="video-{target}" controls preload="none" src="{target}/review.mp4"></video>'
                        f'<p class="links"><a href="{target}/review.mp4">Download video</a>'
                        f'<a href="{target}/result.json">Raw results</a><a href="{target}/environment.json">Environment</a></p>'
                        f'<div class="checks">{"".join(cards)}</div></section>')
    return '''<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>''' + escape(title) + '''</title>
<style>
:root{color-scheme:dark;font:16px/1.55 system-ui,sans-serif;background:#11161d;color:#e8edf4}
*{box-sizing:border-box}body{margin:0}main{max-width:1440px;margin:auto;padding:32px}
h1{font-size:2.2rem;line-height:1.2}h2{font-size:1.7rem}h3{font-size:1rem;overflow-wrap:anywhere}
a{color:#9cc9ff}button{background:#26394e;color:#fff;border:1px solid #4b6580;border-radius:7px;padding:8px 12px;cursor:pointer}
header p{max-width:950px;color:#bdc8d6}.passed{color:#7bddb1}.failed{color:#ffb1a2}.blocked,.unsupported{color:#efcb80}
table{border-collapse:collapse;width:100%;font-size:.93rem}th,td{text-align:left;padding:12px;border-bottom:1px solid #344150}
th{white-space:nowrap}.table-wrap{overflow-x:auto}section{margin:64px 0;scroll-margin-top:20px}
.section-heading{display:flex;align-items:center;gap:24px}video{width:100%;max-height:78vh;background:#050708;border-radius:10px}
.links{display:flex;gap:24px;flex-wrap:wrap}.checks{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:18px}
.check{background:#1c2530;padding:18px;border-radius:10px}.check p{margin:0 0 12px}.check img{width:100%;aspect-ratio:16/10;object-fit:contain;background:#080c11}
details{margin-top:14px}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.78rem}label{display:block;margin:25px 0}
.only-problems .check[data-status="passed"]{display:none}footer{color:#bdc8d6;border-top:1px solid #344150;padding-top:20px}
@media(max-width:600px){main{padding:18px}.section-heading{display:block}}
</style><main><header><p>UsageStat Bar · Linux interaction review</p><h1>''' + escape(title) + '''</h1>
<p>Real mouse and wheel events in isolated native desktop sessions, using four synthetic providers.
The results cover pinning, both scroll directions, panel region and item order, screen edges,
popup alignment, dismissal, and content sizing where supported.</p>
<p>These are scenario results for the recorded versions, not certification of every distro or hardware setup.
Settings were applied through their native settings/configuration interfaces; this does not validate every Preferences control by clicking it.
Videos contain unedited desktop frames at 5 FPS. Step links are approximate. Raw logs and environment metadata are included beside each video.</p>
</header><div class="table-wrap"><table><thead><tr><th>Platform</th><th>Assessment</th><th>Raw checks</th><th>Notes</th></tr></thead><tbody>''' + ''.join(rows) + '''</tbody></table></div>
<label><input id="problems" type="checkbox"> Show only failed or unsupported screenshot steps</label>''' + ''.join(sections) + '''
<footer>All account data in these captures is synthetic. COSMIC's raw passing checks do not establish working native input when its session is marked blocked.
Unsupported cases are not counted as passes. <a href="summary.json">Download the result matrix</a>.</footer></main>
<script>
document.getElementById('problems').addEventListener('change', e => document.body.classList.toggle('only-problems',e.target.checked));
document.querySelectorAll('button[data-player]').forEach(button => button.addEventListener('click',()=>{
 const player=document.getElementById(button.dataset.player);
 const seek=()=>{player.currentTime=Number(button.dataset.time);player.play().catch(()=>{});};
 if(player.readyState) seek(); else {player.addEventListener('loadedmetadata',seek,{once:true});player.load();}
 player.scrollIntoView({behavior:'smooth',block:'center'});
}));
</script></html>'''


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('batches', nargs='+', type=Path, help='Later batches replace earlier runs of the same target')
    parser.add_argument('--output', required=True, type=Path, help='New directory for the gallery and copied evidence')
    parser.add_argument('--title', default='Linux interaction validation')
    parser.add_argument('--blocked', action='append', default=[], help='Target whose lab environment prevents validation')
    parser.add_argument('--note', action='append', default=[], metavar='TARGET=TEXT')
    args = parser.parse_args()
    notes = dict(note.split('=', 1) for note in args.note)
    runs = collect(args.batches, args.output, args.blocked, notes)
    (args.output / 'index.html').write_text(render(runs, args.title))
    print(args.output / 'index.html')
