import base64
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from goaccess_integration import GoAccessCache
from orbit_config import validate
from test_goaccess_pages import report, row


class GoAccessTests(unittest.TestCase):
    def test_pages_read_only_the_selected_cached_period(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = GoAccessCache(directory)
            with patch.object(cache, 'report', return_value=report([row('/en/teachers', 310, 70)])) as saved:
                with patch('goaccess_integration.subprocess.run') as remote:
                    pages = cache.pages('site', '7')
                    remote.assert_not_called()
                saved.assert_called_once_with('site', '7')
                self.assertEqual(pages['requests'], 310)
                self.assertEqual(pages['rows'][0]['visitors'], 70)

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
            malformed = self.payload()
            malformed['reports'].append({**malformed['reports'][0], 'id': '../outside'})
            with patch('goaccess_integration.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout=json.dumps(malformed).encode())):
                with self.assertRaises(ValueError):
                    cache.refresh(self.config())
            self.assertEqual(before, (Path(directory) / 'goaccess/summary.json').read_bytes())

    def test_period_reports_are_validated_and_selected(self):
        payload = self.payload()
        report = payload['reports'][0]
        report['periods'] = {key: {'summary': {'requests': number, 'visitors': 1, 'bandwidth': 10},
            'startDate': '2026-10-01', 'endDate': '2026-10-11',
            'html': base64.b64encode(('period-' + key).encode()).decode()}
            for key, number in [('7', 7), ('30', 30), ('all', 100)]}
        with tempfile.TemporaryDirectory() as directory:
            cache = GoAccessCache(directory)
            with patch('goaccess_integration.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout=json.dumps(payload).encode())):
                data = cache.refresh(self.config())
            self.assertEqual(data['reports'][0]['periods']['30']['summary']['requests'], 30)
            self.assertEqual(cache.report('site', '7'), b'period-7')
            self.assertEqual(cache.report('site', 'all'), b'period-all')
            self.assertIsNone(cache.report('site', '../outside'))
            before = cache.read()
            report['periods']['7']['startDate'] = 'invalid'
            with patch('goaccess_integration.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout=json.dumps(payload).encode())):
                with self.assertRaises(ValueError):
                    cache.refresh(self.config())
            self.assertEqual(cache.read(), before)

    def test_disabled_never_connects_and_sequential_downloads_are_allowed(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = GoAccessCache(directory)
            with patch('goaccess_integration.subprocess.run') as run:
                with self.assertRaises(ValueError):
                    cache.refresh({**self.config(), 'enabled': False})
                run.assert_not_called()
            with patch('goaccess_integration.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout=json.dumps(self.payload()).encode())) as run:
                cache.refresh(self.config())
                cache.refresh(self.config())
                self.assertEqual(run.call_count, 2)

    def test_parallel_download_is_rejected_and_failure_releases_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = GoAccessCache(directory)
            answer = SimpleNamespace(returncode=0, stdout=json.dumps(self.payload()).encode())

            def download(*args, **kwargs):
                # Attempt a second request while the first holds the download lock.
                with self.assertRaisesRegex(ValueError, 'A report download is already running'):
                    cache.refresh(self.config())
                return answer

            with patch('goaccess_integration.subprocess.run', side_effect=download) as run:
                cache.refresh(self.config())
                self.assertEqual(run.call_count, 1)

            with patch('goaccess_integration.subprocess.run', side_effect=OSError):
                with self.assertRaisesRegex(ValueError, 'GoAccess download unavailable'):
                    cache.refresh(self.config())

            with patch('goaccess_integration.subprocess.run', return_value=answer):
                self.assertEqual(len(cache.refresh(self.config())['reports']), 1)
