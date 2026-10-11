"""Read local launchd definitions and cron schedules without running their commands."""
from pathlib import Path
import hashlib
import json
import os
import plistlib
import re
import shlex
import sys
from xml.parsers.expat import ExpatError


LIMIT = 1500


def identity(kind, scope, path, label):
    return hashlib.sha256(json.dumps([kind, scope, str(path), label]).encode()).hexdigest()[:20]


def launch_state(output):
    """launchctl print exposes loaded services in a PID/status/label table."""
    table = re.search(r'\bservices\s*=\s*\{(.*?)\n\s*\}', output, re.S)
    if not table:
        return None
    result = {}
    for line in (table[1] if table else '').splitlines():
        match = re.fullmatch(r'\s*(-|\d+)\s+(-|[-\d]+)\s+(\S+)\s*', line)
        if match:
            pid, status, label = match.groups()
            result[label] = {'pid': int(pid) if pid != '-' and int(pid) > 0 else None,
                             'exit_code': int(status) if status != '-' else None}
    return result


def schedule(data):
    if 'StartCalendarInterval' in data:
        entries = data['StartCalendarInterval']
        entries = entries if isinstance(entries, list) else [entries]
        return '; '.join(' '.join(f'{key}={value}' for key, value in entry.items()) for entry in entries if isinstance(entry, dict))[:1000]
    if 'StartInterval' in data:
        return f"Every {data['StartInterval']} seconds"
    if data.get('KeepAlive'):
        return 'Keep alive'
    if data.get('RunAtLoad'):
        return 'At load'
    return 'On demand'



def program_info(data, home, origin):
    """Infer personal scripts from local paths, never from the launchd user alone."""
    arguments = data.get('ProgramArguments', [])
    arguments = arguments if isinstance(arguments, list) else []
    program = data.get('Program') or (arguments[0] if arguments else '')
    program = program if isinstance(program, str) else ''
    candidates = [program]
    # Shell -c text is parsed only to identify a configured script path, never run.
    for argument in arguments[1:]:
        if not isinstance(argument, str):
            continue
        if argument.startswith(('/', '~/', '$HOME/', '${HOME}/')):
            candidates.append(argument)
        elif any(token in argument for token in (str(home) + '/', '$HOME/', '${HOME}/', '~/')):
            try:
                candidates.extend(shlex.split(argument))
            except ValueError:
                pass
    personal = None
    script = None
    script_suffixes = ('.sh', '.bash', '.zsh', '.py', '.js', '.mjs', '.cjs', '.rb', '.pl')
    for candidate in candidates:
        if not isinstance(candidate, str):
            continue
        for prefix in ('~/', '$HOME/', '${HOME}/'):
            if candidate.startswith(prefix):
                candidate = str(home / candidate[len(prefix):])
                break
        if not candidate.startswith('/'):
            continue
        path = Path(candidate)
        is_script = path.suffix.lower() in script_suffixes
        if is_script:
            script = script or path
        if candidate != program and not is_script:
            continue
        try:
            relative = path.resolve().relative_to(home.resolve())
        except (ValueError, OSError, RuntimeError):
            continue
        managed = relative.parts and relative.parts[0] in ('Library', 'Applications', '.cache', '.npm', '.Trash')
        bundled = any(part.endswith('.app') or part in ('node_modules', 'vendor', 'site-packages') for part in relative.parts)
        if not managed and not bundled:
            personal = personal or path
    app = next((part[:-4] for part in Path(program).parts if part.endswith('.app')), '')
    return {'program': program[:4096], 'script': str(script)[:4096] if script else '',
            'display_name': (app or (script.name if script else Path(program).name))[:500],
            'is_own': bool(personal) and origin != 'apple'}

def collect(command, home=None, directories=None, platform=None):
    home = Path(home or Path.home())
    if (platform or sys.platform) != 'darwin':
        return {'items': [], 'notices': ['Local services are available on macOS.']}
    directories = directories if directories is not None else [
        (home / 'Library/LaunchAgents', 'user', 'third_party', f'gui/{os.getuid()}'),
        (Path('/Library/LaunchAgents'), 'user', 'third_party', f'gui/{os.getuid()}'),
        (Path('/Library/LaunchDaemons'), 'system', 'third_party', 'system'),
        (Path('/System/Library/LaunchAgents'), 'user', 'apple', f'gui/{os.getuid()}'),
        (Path('/System/Library/LaunchDaemons'), 'system', 'apple', 'system'),
    ]
    items, notices, runtime, disabled = [], [], {}, {}
    for domain in dict.fromkeys(entry[3] for entry in directories):
        output, code = command(['/bin/launchctl', 'print', domain], timeout=8)
        runtime[domain] = launch_state(output) if code == 0 else None
        if runtime[domain] is None:
            notices.append('Some launchd runtime states could not be read.')
        output, code = command(['/bin/launchctl', 'print-disabled', domain], timeout=8)
        disabled[domain] = set(re.findall(r'"([^"\n]+)"\s*=>\s*true', output)) if code == 0 else set()

    seen = set()
    for directory, scope, origin, domain in directories:
        try:
            paths = sorted(directory.glob('*.plist'))
        except OSError:
            notices.append('Some service definitions could not be read.')
            continue
        for path in paths:
            if len(items) >= LIMIT:
                notices.append('Service list limited to 1500 entries.')
                break
            try:
                if path.stat().st_size > 1024 * 1024:
                    raise ValueError('Oversized definition')
                with path.open('rb') as source:
                    data = plistlib.load(source)
                if not isinstance(data, dict):
                    raise ValueError('Invalid definition')
                label = data.get('Label')
                if not isinstance(label, str) or not label or len(label) > 500:
                    raise ValueError('Invalid label')
                # User definitions shadow global agents with the same launchd label.
                if (domain, label) in seen:
                    continue
                seen.add((domain, label))
                state = (runtime[domain] or {}).get(label)
                status = 'unknown' if runtime[domain] is None else 'not_loaded'
                if label in disabled[domain]:
                    status = 'disabled'
                elif state:
                    status = 'running' if state['pid'] else 'failed' if state['exit_code'] not in (None, 0) else 'waiting'
                info = program_info(data, home, origin)
                items.append({'id': identity('launchd', scope, path, label), 'name': label, 'kind': 'launchd',
                              'scope': scope, 'origin': origin, 'path': str(path),
                              **info,
                              'schedule': schedule(data), 'status': status, **(state or {})})
            except (OSError, ValueError, TypeError, plistlib.InvalidFileException, ExpatError, OverflowError):
                notices.append('Some service definitions could not be read.')

    output, code = command(['/usr/bin/crontab', '-l'], timeout=8)
    sources = [('user', 'crontab', output if code == 0 else '')]
    if code != 0 and (code != 1 or 'no crontab for' not in output.lower()):
        notices.append('The user crontab could not be read.')
    cronfile = Path('/etc/crontab') if home == Path.home() else home / 'etc/crontab'
    try:
        if cronfile.exists():
            sources.append(('system', str(cronfile), cronfile.read_text()))
    except OSError:
        notices.append('The system crontab could not be read.')
    occurrences = {}
    for scope, path, content in sources:
        for line in content.splitlines():
            line = line.strip()
            if not line or line.startswith('#') or re.match(r'^\w+\s*=', line):
                continue
            fields = line.split(None, (2 if scope == 'system' else 1) if line.startswith('@') else (6 if scope == 'system' else 5))
            schedule_fields = 1 if line.startswith('@') else 5
            if len(fields) != schedule_fields + (2 if scope == 'system' else 1):
                continue
            if len(items) >= LIMIT:
                notices.append('Service list limited to 1500 entries.')
                break
            timing = ' '.join(fields[:schedule_fields])
            # Never expose full commands, environment variables or credentials.
            program = fields[-1].split()[0][:4096]
            signature = hashlib.sha256(line.encode()).hexdigest()
            occurrences[signature] = occurrences.get(signature, 0) + 1
            items.append({'id': identity('cron', scope, path, signature + str(occurrences[signature])),
                          'name': Path(program).name, 'kind': 'cron', 'scope': scope, 'origin': 'third_party',
                          'path': path, 'program': program, 'script': '', 'display_name': Path(program).name,
                          'is_own': scope == 'user', 'schedule': timing, 'status': 'scheduled'})
    return {'items': items, 'notices': list(dict.fromkeys(notices))}
