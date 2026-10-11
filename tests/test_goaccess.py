import base64
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from goaccess_integration import GoAccessCache
from orbit_config import validate


class GoAccessTests(unittest.TestCase):
    def config(self):
        return {'enabled': True, 'host': 'synthetic-server', 'command': '/srv/analytics/export'}

    def payload(self):
        return {'schemaVersion': 1, 'reports': [{'id': 'site', 'label': '<unsafe>',
            'summary': {'requests': 4, 'visitors': 2, 'bandwidth': 100},
            'html': base64.b64encode(b'<html><script>window.demo=true</script></html>').decode()}]}

    def test_config_disallows_shell_and_requires_opt_in(self):
        self.assertFalse(validate({})['goaccess']['enabled'])
        for command in ('cat /etc/passwd', '/bin/tool; echo bad', '$(id)', '-bad'):
            with self.assertRaises(ValueError):
                validate({'goaccess': {**self.config(), 'command': command}})
        with self.assertRaises(ValueError):
            validate({'goaccess': {**self.config(), 'host': '-option'}})

    def test_download_atomic_cache_and_safe_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = GoAccessCache(directory)
            answer = SimpleNamespace(returncode=0, stdout=json.dumps(self.payload()).encode())
            with patch('goaccess_integration.subprocess.run', return_value=answer) as run:
                data = cache.refresh(self.config())
            self.assertEqual(data['reports'][0]['summary']['visitors'], 2)
            self.assertIn(b'window.demo', cache.report('site'))
            self.assertIsNone(cache.report('../summary'))
            self.assertEqual(run.call_args.args[0][-1], '/srv/analytics/export')
            self.assertIn('StrictHostKeyChecking=yes', run.call_args.args[0])
            before = (Path(directory) / 'goaccess/summary.json').read_bytes()
            cache.last_attempt.clear()
            malformed = self.payload()
            malformed['reports'].append({**malformed['reports'][0], 'id': '../outside'})
            with patch('goaccess_integration.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout=json.dumps(malformed).encode())):
                with self.assertRaises(ValueError):
                    cache.refresh(self.config())
            self.assertEqual(before, (Path(directory) / 'goaccess/summary.json').read_bytes())

    def test_disabled_never_connects_and_repeated_download_is_limited(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = GoAccessCache(directory)
            with patch('goaccess_integration.subprocess.run') as run:
                with self.assertRaises(ValueError):
                    cache.refresh({**self.config(), 'enabled': False})
                run.assert_not_called()
            with patch('goaccess_integration.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout=json.dumps(self.payload()).encode())) as run:
                cache.refresh(self.config())
                with self.assertRaises(ValueError):
                    cache.refresh(self.config())
                self.assertEqual(run.call_count, 1)
