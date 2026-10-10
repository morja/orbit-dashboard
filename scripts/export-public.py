#!/usr/bin/env python3
"""Export committed Orbit source without private Git history or local artifacts."""
from pathlib import Path, PurePosixPath
import argparse
import io
import subprocess
import tarfile


ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN = {'.git', '.idea', '.vscode', 'data', 'node_modules', '__pycache__',
             'config.json', 'AGENTS.local.md', '.DS_Store', '.env', '.aws', '.ssh'}


def export_source(root, destination):
    destination = destination.expanduser().resolve()
    if destination.exists():
        raise ValueError('Destination already exists; choose a new folder')
    if root.resolve() in destination.parents:
        raise ValueError('Export must be outside the development checkout')
    # Local ignored and untracked files never enter git archive.
    dirty = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=root)
    if dirty.strip():
        raise ValueError('Commit tracked changes before exporting')
    archive = subprocess.check_output(['git', 'archive', '--format=tar', 'HEAD'], cwd=root)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        members = tar.getmembers()
        for member in members:
            path = PurePosixPath(member.name)
            if (path.is_absolute() or '..' in path.parts or FORBIDDEN.intersection(path.parts)
                    or any(part.endswith('.app') or part.startswith('.env.') for part in path.parts)
                    or path.suffix.lower() in {'.key', '.pem', '.p12', '.pfx', '.db', '.sqlite', '.sqlite3', '.log'}
                    or not (member.isfile() or member.isdir())):
                raise ValueError('Forbidden export entry: ' + member.name)
        destination.mkdir(parents=True)
        for member in members:
            path = destination / member.name
            if member.isdir():
                path.mkdir(parents=True, exist_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(tar.extractfile(member).read())
                path.chmod(member.mode & 0o777)
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    print('Exported committed source:', revision)
    print('Destination:', destination)
    print('No Git history or local configuration copied. Review and test before initializing Git.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    try:
        export_source(ROOT, parser.parse_args().destination)
    except ValueError as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
