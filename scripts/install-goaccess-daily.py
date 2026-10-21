#!/usr/bin/env python3
"""Manually extend the prepared-report exporter with read-only daily statistics."""
import argparse
import ast
import hashlib
import os
from pathlib import Path
import shutil
import tempfile


MARKER = '    print(json.dumps(manifest))'
EXTENSION = '''    # Orbit daily export: read logs in memory, without updating the GoAccess store.
    import sys
    sys.dont_write_bytecode = True
    from goaccess_daily import daily_statistics
    for report in manifest['reports']:
        site = sites.get(report['id'], {})
        if site.get('log'):
            try:
                report['daily'] = daily_statistics(site['log'])
            except (OSError, ValueError, EOFError):
                report['dailyStatus'] = 'unavailable'
        # Period-aware clients use periods['all']; avoid transferring legacy HTML twice.
        if report.get('periods', {}).get('all', {}).get('html'):
            report.pop('html', None)
    print(json.dumps(manifest))'''


def extend_source(source):
    if '# Orbit daily export:' in source:
        return source
    if source.count(MARKER) != 1 or 'def export_snapshot():' not in source:
        raise ValueError('Unsupported exporter; review its export_snapshot function first')
    updated = source.replace(MARKER, EXTENSION)
    ast.parse(updated)
    return updated


def install(target):
    target = target.resolve(strict=True)
    updated = extend_source(target.read_text())
    root = Path(__file__).resolve().parents[1]
    files = [(target.parent / name, (root / name).read_bytes())
              for name in ('goaccess_daily.py', 'goaccess_pages.py')]
    files.append((target, updated.encode()))
    for path, body in files:
        previous = path.read_bytes() if path.exists() else None
        if previous == body:
            continue
        mode = path.stat().st_mode & 0o777 if path.exists() else 0o600
        if previous is not None:
            backup = path.with_name(path.name + '.before-daily-' + hashlib.sha256(previous).hexdigest()[:12])
            if not backup.exists():
                shutil.copy2(path, backup)
        descriptor, temporary = tempfile.mkstemp(dir=path.parent)
        try:
            with os.fdopen(descriptor, 'wb') as output:
                output.write(body)
            os.chmod(temporary, mode)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('exporter', type=Path)
    install(parser.parse_args().exporter)
