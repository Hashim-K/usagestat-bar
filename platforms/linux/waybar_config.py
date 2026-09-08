#!/usr/bin/env python3
"""Edit the running session's UsageStat Waybar entries, retaining JSONC comments."""
import argparse
import json
import os
from pathlib import Path
import re
import signal
import stat
import tempfile


def clean_jsonc(text):
    chars = list(text)
    index, quoted = 0, False
    while index < len(chars):
        if quoted:
            if chars[index] == '\\': index += 2; continue
            if chars[index] == '"': quoted = False
        elif chars[index] == '"': quoted = True
        elif text[index:index + 2] in ('//', '/*'):
            end = text.find('\n', index) if text[index:index + 2] == '//' else text.find('*/', index + 2)
            if end < 0: end = len(text)
            elif text[index:index + 2] == '/*': end += 2
            for offset in range(index, end):
                if chars[offset] != '\n': chars[offset] = ' '
            index = end
            continue
        index += 1
    clean = ''.join(chars)
    # Skip string tokens when accepting JSONC's trailing commas.
    return re.sub(r'"(?:\\.|[^"\\])*"|,(?=\s*[}\]])',
                  lambda match: ' ' if match[0] == ',' else match[0], clean)


class Document:
    def __init__(self, path):
        self.path = path.resolve()
        self.text = self.path.read_text()
        self.clean = clean_jsonc(self.text)
        self.decoder = json.JSONDecoder()
        self.value = json.loads(self.clean)
        self.edits = []

    def skip(self, index):
        while index < len(self.clean) and self.clean[index].isspace(): index += 1
        return index

    def nodes(self):
        index = self.skip(0)
        if isinstance(self.value, dict): return [(index, self.value)]
        if not isinstance(self.value, list): raise ValueError('Waybar config must contain an object or a list of bars.')
        result, index = [], self.skip(index + 1)
        for value in self.value:
            if not isinstance(value, dict): raise ValueError('A Waybar bar must be an object.')
            result.append((index, value))
            _, index = self.decoder.raw_decode(self.clean, index)
            index = self.skip(index)
            if self.clean[index:index + 1] == ',': index = self.skip(index + 1)
        return result

    def update(self, start, changes):
        index, members = self.skip(start + 1), {}
        while self.clean[index] != '}':
            key, index = self.decoder.raw_decode(self.clean, index)
            index = self.skip(index)
            if self.clean[index] != ':': raise ValueError('Invalid Waybar configuration.')
            value_start = self.skip(index + 1)
            _, index = self.decoder.raw_decode(self.clean, value_start)
            if key in members: raise ValueError(f'Waybar config has duplicate key {key}.')
            members[key] = (value_start, index)
            index = self.skip(index)
            if self.clean[index] == ',': index = self.skip(index + 1)
        additions = []
        for key, value in changes.items():
            encoded = json.dumps(value, ensure_ascii=False)
            if key in members: self.edits.append((*members[key], encoded))
            else: additions.append(f'  {json.dumps(key)}: {encoded}')
        if additions:
            self.edits.append((start + 1, start + 1, '\n' + ',\n'.join(additions) + (',' if members else '') + '\n'))

    def rendered(self):
        text = self.text
        for start, end, value in sorted(self.edits, reverse=True): text = text[:start] + value + text[end:]
        json.loads(clean_jsonc(text))
        return text


def effective(value, parent, seen=()):
    result = dict(value)
    includes = value.get('include', [])
    if isinstance(includes, str): includes = [includes]
    for name in includes:
        path = Path(os.path.expandvars(os.path.expanduser(name)))
        if not path.is_absolute(): path = parent / path
        path = path.resolve()
        if path in seen or len(seen) > 15: raise ValueError('Waybar includes form a loop.')
        included = Document(path).value
        if not isinstance(included, dict): raise ValueError('Included Waybar config must contain an object.')
        included = effective(included, path.parent, (*seen, path))
        for key, item in included.items():
            if key not in result: result[key] = item
            elif isinstance(result[key], dict) and isinstance(item, dict): result[key] = {**item, **result[key]}
    return result


def running_waybar():
    display = os.environ.get('WAYLAND_DISPLAY', '')
    runtime = os.environ.get('XDG_RUNTIME_DIR', '')
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit(): continue
        try:
            if proc.stat().st_uid != os.getuid() or proc.joinpath('comm').read_text().strip() != 'waybar': continue
            env = dict(item.split('=', 1) for item in proc.joinpath('environ').read_text().split('\0') if '=' in item)
            if env.get('WAYLAND_DISPLAY', '') != display or env.get('XDG_RUNTIME_DIR', '') != runtime: continue
            argv = proc.joinpath('cmdline').read_text().rstrip('\0').split('\0')
            cwd = proc.joinpath('cwd').resolve()
            config_home = Path(env.get('XDG_CONFIG_HOME', str(Path.home() / '.config')))

            def option(short, long, defaults):
                for index, arg in enumerate(argv):
                    if arg in (short, long) and index + 1 < len(argv): return (cwd / argv[index + 1]).resolve()
                    if arg.startswith(long + '='): return (cwd / arg.split('=', 1)[1]).resolve()
                return next((path for path in defaults if path.exists()), defaults[0])

            config = option('-c', '--config', [config_home / 'waybar/config', config_home / 'waybar/config.jsonc',
                                              Path.home() / '.waybar/config', Path('/etc/xdg/waybar/config')])
            style = option('-s', '--style', [config_home / 'waybar/style.css', Path('/etc/xdg/waybar/style.css')])
            return proc, proc.joinpath('stat').read_text().split(') ', 1)[1].split()[19], config, style
        except (OSError, ValueError): continue
    raise ValueError('Start Waybar with the UsageStat module to change its placement and appearance.')


def is_usage(module):
    return isinstance(module, str) and module.split('#', 1)[0] in ('cffi/usagestat', 'custom/usagestat')


def placement(bar):
    side = next(side for side in ('left', 'center', 'right')
                if any(is_usage(module) for module in bar.get('modules-' + side, [])))
    items = bar['modules-' + side]
    return {'edge': bar.get('position', 'top'), 'alignment': side,
            'index': next(index for index, module in enumerate(items) if is_usage(module)),
            'indexMax': sum(not is_usage(module) for module in items)}


def atomic_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o600
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, prefix='.usagestat-', delete=False) as stream:
        temp = Path(stream.name)
        try:
            os.chmod(temp, mode)
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
            os.replace(temp, path)
        finally: temp.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['get', 'edge', 'alignment', 'index', 'theme'])
    parser.add_argument('value', nargs='?')
    args = parser.parse_args()
    choices = {'edge': ['top', 'bottom', 'left', 'right'], 'alignment': ['left', 'center', 'right'], 'theme': ['system', 'light', 'dark']}
    if args.command == 'index':
        try: args.value = int(args.value)
        except (TypeError, ValueError): parser.error('Position index must be a non-negative integer.')
        if args.value < 0: parser.error('Position index must be a non-negative integer.')
    elif args.command != 'get' and args.value not in choices[args.command]: parser.error('Invalid setting value.')
    proc, started, config, style = running_waybar()
    document = Document(config)
    targets = []
    for start, value in document.nodes():
        merged = effective(value, config.parent, (config,))
        modules = [module for side in choices['alignment'] for module in merged.get('modules-' + side, []) if is_usage(module)]
        if modules: targets.append((start, merged, modules))
    if not targets: raise ValueError('Add UsageStat directly to a Waybar modules-left, modules-center or modules-right list first.')
    state_file = Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config'))) / 'usagestat-bar/desktop.json'
    saved_state = state_file.read_text() if state_file.exists() else None
    state = json.loads(saved_state) if saved_state is not None else {}
    first = targets[0][1]
    current = {**placement(first), 'theme': state.get('theme', 'system'), 'output': first.get('output')}
    if args.command == 'get': print(json.dumps(current)); return
    writes = {}
    originals = {}
    if args.command in ('edge', 'alignment', 'index'):
        for start, bar, modules in targets:
            if args.command == 'edge':
                vertical = args.value in ('left', 'right')
                old_vertical = bar.get('position', 'top') in ('left', 'right')
                thickness = bar.get('width' if old_vertical else 'height', 36) or 36
                changes = {'position': args.value, 'width': thickness if vertical else 0, 'height': 0 if vertical else thickness}
                for module in modules:
                    options = dict(bar.get(module, bar.get(module.split('#', 1)[0], {})))
                    if module.startswith('cffi/'): options['vertical'] = vertical
                    else: options['rotate'] = 90 if vertical else 0
                    changes[module] = options
            else:
                previous = placement(bar)
                side = args.value if args.command == 'alignment' else previous['alignment']
                index = args.value if args.command == 'index' else previous['index']
                changes = {'modules-' + side: [module for module in bar.get('modules-' + side, []) if not is_usage(module)]
                           for side in choices['alignment']}
                items = changes['modules-' + side]
                index = min(index, len(items))
                items[index:index] = dict.fromkeys(modules)
            document.update(start, changes)
            if start == targets[0][0]: current.update(placement({**bar, **changes}))
        writes[config] = document.rendered()
        originals[config] = document.text
    else:
        text = style.read_text()
        originals[style] = text
        originals[state_file] = saved_state
        text = re.sub(r'\n?/\* UsageStat appearance start \*/.*?/\* UsageStat appearance end \*/\n?', '\n', text, flags=re.S)
        if args.value != 'system':
            background, foreground = ('#242428', '#f5f5f7') if args.value == 'dark' else ('#f7f7f9', '#20242b')
            text += f'\n/* UsageStat appearance start */\nwindow#waybar {{ background: {background}; color: {foreground}; }}\n/* UsageStat appearance end */\n'
        writes[style] = text
        writes[state_file] = json.dumps({**state, 'theme': args.value}, indent=2) + '\n'
        current['theme'] = args.value
    completed = []
    try:
        for path, text in writes.items():
            if (path.read_text() if path.exists() else None) != originals[path]:
                raise ValueError(f'{path.name} changed while applying settings. Please try again.')
            if originals[path] is not None and path != state_file:
                backup = path.with_name(path.name + '.usagestat-backup')
                if not backup.exists(): atomic_write(backup, originals[path])
            atomic_write(path, text)
            completed.append(path)
        # Signal this exact Waybar instance, never every panel on the host.
        if proc.joinpath('stat').read_text().split(') ', 1)[1].split()[19] != started:
            raise ValueError('Waybar restarted while applying settings. Please try again.')
        os.kill(int(proc.name), signal.SIGUSR2)
    except Exception:
        for path in reversed(completed):
            if originals[path] is None: path.unlink(missing_ok=True)
            else: atomic_write(path, originals[path])
        raise
    print(json.dumps(current))


if __name__ == '__main__':
    try: main()
    except (OSError, ValueError) as error:
        raise SystemExit(str(error))
