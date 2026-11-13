"""Custom pages: locally generated HTML files shown in Orbit, each with an optional refresh command.

Orbit never interprets these pages. It serves exactly the configured file of a configured
page and runs the configured executable without arguments, shell or standard input.
"""
from datetime import datetime, timezone
from pathlib import Path
import os
import stat
import subprocess
import threading
import time


REFRESH_TIMEOUT = 180
# A generated status page is small; refuse anything that would only fill memory.
MAX_PAGE_BYTES = 16 * 1024 * 1024
STDERR_LINES = 8
# Pages are opaque documents. Inline styles and scripts work, the network does not.
PAGE_POLICY = ("default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; "
               "font-src data:; frame-ancestors 'self'; sandbox allow-scripts; base-uri 'none'; form-action 'none'")

_locks = {}
_locks_guard = threading.Lock()


def find(config, page_id):
    """The enabled page with this ID, or None. Disabled pages are neither served nor refreshed."""
    return next((page for page in config.get('custom_pages', []) if page['id'] == page_id and page['enabled']), None)


def generated_at(page):
    """Modification time of the page file as an ISO timestamp, or None while it does not exist."""
    try:
        info = os.stat(page['file'])
    except OSError:
        return None
    if not stat.S_ISREG(info.st_mode):
        return None
    return datetime.fromtimestamp(info.st_mtime, timezone.utc).isoformat()


def status(config):
    """What the sidebar and the page view need, without any paths or commands."""
    return [{'id': page['id'], 'name': page['name'], 'refreshable': bool(page['refresh_command']),
             'generated_at': generated_at(page), 'refreshing': _busy(page['id'])}
            for page in config.get('custom_pages', []) if page['enabled']]


def read(page):
    """Bytes of the page file, or None when it is missing. Raises ValueError for oversized files."""
    path = Path(page['file'])
    try:
        if not path.is_file():
            return None
        if path.stat().st_size > MAX_PAGE_BYTES:
            raise ValueError('The page file is larger than 16 MiB')
        return path.read_bytes()
    except OSError:
        return None


def _lock(page_id):
    with _locks_guard:
        return _locks.setdefault(page_id, threading.Lock())


def _busy(page_id):
    lock = _locks.get(page_id)
    return bool(lock and lock.locked())


class RefreshBusy(Exception):
    pass


class RefreshFailed(Exception):
    pass


def refresh(page):
    """Run the page's refresh executable once; a second request for the same page is refused."""
    executable = page['refresh_command']
    if not executable:
        raise ValueError('This page has no refresh command')
    if not os.path.isfile(executable) or not os.access(executable, os.X_OK):
        raise ValueError(f'The refresh command is not an executable file: {executable}')
    lock = _lock(page['id'])
    if not lock.acquire(blocking=False):
        raise RefreshBusy('This page is already refreshing')
    try:
        env = dict(os.environ, PATH='/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin')
        started = time.monotonic()
        try:
            # Argument array, no shell, closed standard input, captured output. The command stays
            # in Orbit's process group, so closing the Mac app also stops a running refresh.
            process = subprocess.Popen([executable], stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL,
                                       text=True, errors='replace', env=env, cwd=str(Path.home()))
        except OSError as error:
            raise ValueError(f'The refresh command could not be started: {error.strerror or error}')
        try:
            output, errors = process.communicate(timeout=REFRESH_TIMEOUT)
        except subprocess.TimeoutExpired:
            process.kill()
            # Child processes may still hold the output pipes; closing them ends the wait.
            try:
                process.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                process.stdout.close()
                process.stderr.close()
            process.wait()
            raise TimeoutError(f'The refresh command did not finish within {REFRESH_TIMEOUT} seconds')
        if process.returncode != 0:
            lines = [line for line in (errors or output).strip().splitlines() if line.strip()][-STDERR_LINES:]
            details = '\n'.join(lines) or 'no output'
            raise RefreshFailed(f'The refresh command failed with exit code {process.returncode}:\n{details}')
        return {'ok': True, 'seconds': round(time.monotonic() - started, 1), 'generated_at': generated_at(page)}
    finally:
        lock.release()
