#!/usr/bin/env python3
"""Generate user-facing release notes from local Conventional Commits."""
import argparse
import re
import subprocess
from pathlib import Path

VERSION = re.compile(r'v\d+\.\d+\.\d+(?:-preview\.\d+)?')
HEADER = re.compile(r'(?P<type>feat|fix|perf|docs|style|refactor|test|build|ci|chore|revert)(?:\((?P<scope>[^)]+)\))?(?P<breaking>!)?: (?P<subject>.+)')
INTERNAL_SCOPES = {'build', 'ci', 'deps', 'dev', 'release', 'test', 'tests'}


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], text=True)


def previous_tag(root):
    tags = git(root, 'tag', '--merged', 'HEAD', '--sort=-version:refname').splitlines()
    return next((tag for tag in tags if VERSION.fullmatch(tag)), None)


def user_change(subject, body):
    match = HEADER.fullmatch(subject)
    if not match:
        return None
    explicit = re.search(r'^Release-Note: (.+)$', body, re.MULTILINE | re.IGNORECASE)
    if explicit and explicit[1].strip().lower() == 'none':
        return None
    kind = match['type']
    if not explicit and (kind not in {'feat', 'fix', 'perf'} or match['scope'] in INTERNAL_SCOPES):
        return None
    text = explicit[1].strip() if explicit else match['subject']
    breaking = bool(match['breaking'] or re.search(r'^BREAKING[ -]CHANGE:', body, re.MULTILINE))
    group = 'Breaking changes' if breaking else {'feat': 'New', 'fix': 'Fixed', 'perf': 'Performance'}.get(kind, 'Changed')
    return group, text[0].upper() + text[1:]


def generate(root, version, since=None):
    if not VERSION.fullmatch(version):
        raise ValueError('Use vX.Y.Z or vX.Y.Z-preview.N')
    since = since or previous_tag(root)
    if since:
        if not VERSION.fullmatch(since):
            raise ValueError('The previous release must be an Orbit version tag')
        git(root, 'merge-base', '--is-ancestor', since, 'HEAD')
    history = git(root, 'log', '--no-merges', '--format=%s%x00%b', '-z', f'{since}..HEAD' if since else 'HEAD', '--')
    fields = history.split('\0')
    groups = {key: [] for key in ('Breaking changes', 'New', 'Fixed', 'Performance', 'Changed')}
    for i in range(0, len(fields) - 1, 2):
        change = user_change(fields[i], fields[i + 1])
        if change and change[1] not in groups[change[0]]:
            groups[change[0]].append(change[1])
    lines = [f'# Orbit Dashboard {version}', '']
    for group, entries in groups.items():
        if entries:
            lines.extend([f'## {group}', '', *['- ' + entry for entry in entries], ''])
    if not any(groups.values()):
        lines.extend(['No user-visible changes were recorded in this range.', ''])
    lines.extend(['## Distribution', '',
                  'This is a macOS source preview requiring Python 3.10+. Building the native',
                  'window also requires Apple Command Line Tools. Preserve local settings and notes',
                  'when updating. This release does not include a standalone signed app.', '',
                  'Review these generated notes before publishing; commit types alone do not',
                  'establish product stability or compatibility.', ''])
    return '\n'.join(lines)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True)
    parser.add_argument('--since')
    parser.add_argument('--output', type=Path)
    options = parser.parse_args()
    try:
        notes = generate(Path(__file__).resolve().parents[1], options.version, options.since)
        if options.output:
            options.output.write_text(notes)
        else:
            print(notes, end='')
    except (ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, str(error) + '\n')
