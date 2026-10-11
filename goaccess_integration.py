"""Optional, read-only SSH import of prepared GoAccess reports."""
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import threading
import time


class GoAccessCache:
    def __init__(self, directory):
        self.directory = Path(directory) / 'goaccess'
        self.lock = threading.Lock()
        self.last_attempt = {}

    def read(self):
        try:
            return json.loads((self.directory / 'summary.json').read_text())
        except (OSError, ValueError):
            return {'reports': [], 'downloadedAt': None}

    def report(self, identifier):
        if not re.fullmatch(r'[a-z0-9-]{1,80}', identifier):
            return None
        metadata = next((item for item in self.read()['reports'] if item['id'] == identifier), None)
        if not metadata or not metadata.get('file'):
            return None
        try:
            return (self.directory / metadata['file']).read_bytes()
        except OSError:
            return None

    def refresh(self, config):
        if not config['enabled']:
            raise ValueError('GoAccess integration is disabled')
        if not self.lock.acquire(blocking=False):
            raise ValueError('A report download is already running')
        try:
            source = config['host'] + ':' + config['command']
            if time.monotonic() - self.last_attempt.get(source, -1000) < 300:
                raise ValueError('Wait five minutes before downloading reports again')
            self.last_attempt[source] = time.monotonic()
            # Configuration validation accepts one executable, no shell arguments.
            result = subprocess.run(['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                '-o', 'ConnectTimeout=10', config['host'], config['command']],
                capture_output=True, timeout=45)
            if result.returncode or len(result.stdout) > 40_000_000:
                raise ValueError('GoAccess SSH download failed')
            payload = json.loads(result.stdout)
            if payload.get('schemaVersion') != 1 or not isinstance(payload.get('reports'), list) or len(payload['reports']) > 100:
                raise ValueError('Unsupported GoAccess export')
            self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            reports = []
            identifiers = set()
            for item in payload['reports']:
                identifier = item.get('id', '')
                if not re.fullmatch(r'[a-z0-9-]{1,80}', identifier) or identifier in identifiers:
                    raise ValueError('Invalid report identifier')
                identifiers.add(identifier)
                label = item.get('label')
                if not isinstance(label, str) or len(label) > 200:
                    raise ValueError('Invalid report label')
                hostname = item.get('hostname', '')
                if not isinstance(hostname, str) or len(hostname) > 253:
                    raise ValueError('Invalid report hostname')
                summary = item.get('summary', {})
                if not isinstance(summary, dict):
                    raise ValueError('Invalid report summary')
                values = {key: summary.get(key, 0) for key in ('requests', 'visitors', 'bandwidth')}
                if any(type(value) is not int or value < 0 for value in values.values()):
                    raise ValueError('Invalid report values')
                metadata = {'id': identifier, 'label': label, 'hostname': hostname, 'summary': values,
                            'generatedAt': item.get('generatedAt'), 'status': item.get('status', 'ready')}
                if item.get('html'):
                    html = base64.b64decode(item['html'], validate=True)
                    if len(html) > 10_000_000:
                        raise ValueError('Report too large')
                    name = hashlib.sha256(html).hexdigest() + '.html'
                    self._write(name, html)
                    metadata['file'] = name
                reports.append(metadata)
            data = {'reports': reports, 'source': source, 'downloadedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
            self._write('summary.json', json.dumps(data).encode())
            # Old report versions are removed only after the new manifest commits.
            active = {item.get('file') for item in reports}
            for path in self.directory.glob('*.html'):
                if path.name not in active:
                    path.unlink()
            return data
        except (OSError, subprocess.TimeoutExpired, ValueError, TypeError, KeyError) as error:
            raise ValueError('GoAccess download unavailable; the previous local copy is preserved') from error
        finally:
            self.lock.release()

    def _write(self, name, data):
        descriptor, temporary = tempfile.mkstemp(dir=self.directory, prefix='.download-')
        try:
            with os.fdopen(descriptor, 'wb') as output:
                output.write(data)
            os.replace(temporary, self.directory / name)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
