"""Custom pages: settings validation, the read-only page endpoint and the refresh command."""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import json
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import custom_pages
from orbit_config import defaults, validate
from server import Dashboard, Handler, Store, ThreadingHTTPServer


def page(**values):
    return {'name': 'Status', 'file': '/tmp/orbit-status.html', **values}


class CustomPageSettingsTest(unittest.TestCase):
    def test_defaults_and_normalized_entry(self):
        self.assertEqual(defaults()['custom_pages'], [])
        value = validate({'custom_pages': [page(refresh_command='/usr/local/bin/make-status')]})['custom_pages'][0]
        self.assertEqual(set(value), {'id', 'name', 'file', 'refresh_command', 'enabled'})
        self.assertRegex(value['id'], r'^[a-f0-9]{12}$')
        self.assertTrue(value['enabled'])
        self.assertEqual(value['refresh_command'], '/usr/local/bin/make-status')

    def test_id_is_stable_and_preserved(self):
        first = validate({'custom_pages': [page()]})['custom_pages'][0]['id']
        self.assertEqual(validate({'custom_pages': [page()]})['custom_pages'][0]['id'], first)
        # A saved ID survives a moved file, so direct links keep working.
        moved = validate({'custom_pages': [page(id='status', file='/tmp/other.html')]})['custom_pages'][0]
        self.assertEqual(moved['id'], 'status')

    def test_home_paths_expand(self):
        value = validate({'custom_pages': [page(file='~/status.html', refresh_command='~/bin/make')]})['custom_pages'][0]
        self.assertEqual(value['file'], str(Path.home() / 'status.html'))
        self.assertEqual(value['refresh_command'], str(Path.home() / 'bin/make'))

    def test_invalid_entries_rejected(self):
        invalid = [
            ('not a list', 'maximum of 30'),
            ([page()] * 31, 'maximum of 30'),
            ([{**page(), 'command': '/bin/sh'}], 'Invalid custom page'),
            ([page(name='  ')], 'Provide a name'),
            ([page(file='status.html')], 'absolute paths to .html'),
            ([page(file='/tmp/status.txt')], 'absolute paths to .html'),
            ([page(refresh_command='make-status')], 'single executable'),
            ([page(refresh_command='/bin/make status')], 'single executable'),
            ([page(refresh_command='/bin/make;rm')], 'single executable'),
            ([page(refresh_command='/bin/make $(id)')], 'single executable'),
            ([page(enabled='yes')], 'must be a boolean'),
            ([page(id='Not Valid')], 'Invalid custom page ID'),
            ([page(), page(name='Twice')], 'Duplicate custom page'),
            ([page(name='x\ny')], 'invalid text'),
        ]
        for pages, message in invalid:
            with self.subTest(pages=pages if len(str(pages)) < 200 else 'many'):
                with self.assertRaisesRegex(ValueError, message):
                    validate({'custom_pages': pages})


class CustomPageApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.folder = Path(self.tmp.name).resolve()
        self.file = self.folder / 'status.html'
        self.script = self.folder / 'make-status'
        self.dashboard = Dashboard(Store(self.folder / 'data'), {'custom_pages': [
            {'id': 'status', 'name': 'Status', 'file': str(self.file), 'refresh_command': str(self.script)},
            {'id': 'plain', 'name': 'Plain', 'file': str(self.folder / 'plain.html')},
            {'id': 'hidden', 'name': 'Hidden', 'file': str(self.file), 'enabled': False},
        ]})
        self.scheduling = patch.object(self.dashboard, 'schedule')
        self.scheduling.start()
        self.http = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.http.dashboard = self.dashboard
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.http.server_address[1]}'

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.dashboard.pool.shutdown()
        self.thread.join()
        self.scheduling.stop()
        self.tmp.cleanup()

    def get(self, path):
        return urllib.request.urlopen(self.url + path)

    def post(self, path, key=None):
        headers = {'Content-Type': 'application/json', 'X-Orbit-Key': self.dashboard.action_key if key is None else key}
        return urllib.request.urlopen(urllib.request.Request(self.url + path, data=b'{}', headers=headers))

    def error(self, call, *args, **kwargs):
        with self.assertRaises(urllib.error.HTTPError) as context:
            call(*args, **kwargs)
        with context.exception as failure:
            return failure.code, json.load(failure).get('error', '')

    def write_script(self, body):
        self.script.write_text('#!/bin/sh\n' + body)
        self.script.chmod(0o700)

    def test_serves_only_the_configured_file_with_a_strict_policy(self):
        self.file.write_text('<!doctype html><title>Status</title><p>ok</p>')
        with self.get('/api/custom-pages/status?theme=dark&palette=ocean&scale=1.2') as response:
            self.assertEqual(response.read(), self.file.read_bytes())
            self.assertEqual(response.headers['Content-Type'], 'text/html; charset=utf-8')
            policy = response.headers['Content-Security-Policy']
        for directive in ("default-src 'none'", "style-src 'unsafe-inline'", "script-src 'unsafe-inline'",
                          'img-src data:', 'font-src data:', 'sandbox allow-scripts', "form-action 'none'"):
            self.assertIn(directive, policy)
        self.assertNotIn('connect-src', policy)

    def test_unknown_disabled_missing_and_traversal_are_not_found(self):
        self.file.write_text('<p>ok</p>')
        for path in ('/api/custom-pages/unknown', '/api/custom-pages/hidden', '/api/custom-pages/plain',
                     '/api/custom-pages/status/../../server.py', '/api/custom-pages/' + str(self.file)):
            with self.subTest(path=path):
                code, _ = self.error(self.get, path)
                self.assertEqual(code, 404)

    def test_snapshot_lists_enabled_pages_without_paths(self):
        self.file.write_text('<p>ok</p>')
        with self.get('/api/state') as response:
            pages = json.load(response)['custom_pages']
        self.assertEqual([item['id'] for item in pages], ['status', 'plain'])
        self.assertTrue(pages[0]['generated_at'])
        self.assertIsNone(pages[1]['generated_at'])
        self.assertEqual([item['refreshable'] for item in pages], [True, False])
        self.assertNotIn(str(self.folder), json.dumps(pages))

    def test_refresh_requires_the_action_key(self):
        self.write_script('echo ran > "$0.ran"\n')
        code, _ = self.error(self.post, '/api/custom-pages/status/refresh', key='')
        self.assertEqual(code, 403)
        code, _ = self.error(self.post, '/api/custom-pages/status/refresh', key='0' * 64)
        self.assertEqual(code, 403)
        self.assertFalse(Path(str(self.script) + '.ran').exists())

    def test_refresh_runs_the_command_without_arguments_or_stdin(self):
        self.write_script(f'printf "args:%s stdin:" "$#" > "{self.folder}/log"\ncat >> "{self.folder}/log"\n'
                          f'echo "<p>new</p>" > "{self.file}"\n')
        with self.post('/api/custom-pages/status/refresh') as response:
            result = json.load(response)
        self.assertTrue(result['ok'])
        self.assertTrue(result['generated_at'])
        self.assertEqual((self.folder / 'log').read_text(), 'args:0 stdin:')
        with self.get('/api/custom-pages/status') as response:
            self.assertIn(b'new', response.read())

    def test_refresh_errors_are_clear(self):
        code, error = self.error(self.post, '/api/custom-pages/unknown/refresh')
        self.assertEqual((code, error), (404, 'Page not found'))
        code, error = self.error(self.post, '/api/custom-pages/hidden/refresh')
        self.assertEqual(code, 404)
        code, error = self.error(self.post, '/api/custom-pages/plain/refresh')
        self.assertEqual((code, error), (400, 'This page has no refresh command'))
        # Missing and non-executable commands name the configured path.
        code, error = self.error(self.post, '/api/custom-pages/status/refresh')
        self.assertEqual((code, error), (400, f'The refresh command is not an executable file: {self.script}'))
        self.script.write_text('#!/bin/sh\n')
        self.script.chmod(0o600)
        code, error = self.error(self.post, '/api/custom-pages/status/refresh')
        self.assertEqual(code, 400)
        self.assertIn('not an executable file', error)
        # A failed run reports its exit code and the last lines of stderr.
        self.write_script('for i in 1 2 3 4 5 6 7 8 9 10; do echo "line $i" >&2; done\nexit 4\n')
        code, error = self.error(self.post, '/api/custom-pages/status/refresh')
        self.assertEqual(code, 502)
        self.assertTrue(error.startswith('The refresh command failed with exit code 4:\nline 3\n'))
        self.assertTrue(error.endswith('line 10'))

    def test_refresh_timeout(self):
        self.write_script('sleep 5\n')
        with patch.object(custom_pages, 'REFRESH_TIMEOUT', 0.5):
            started = time.monotonic()
            code, error = self.error(self.post, '/api/custom-pages/status/refresh')
        self.assertEqual(code, 504)
        self.assertIn('did not finish within', error)
        self.assertLess(time.monotonic() - started, 4)

    def test_one_refresh_per_page_at_a_time(self):
        self.write_script(f'touch "{self.folder}/started"\nsleep 1\n')
        results = []
        first = threading.Thread(target=lambda: results.append(self.post('/api/custom-pages/status/refresh').status))
        first.start()
        for _ in range(50):
            if (self.folder / 'started').exists():
                break
            time.sleep(0.05)
        with self.get('/api/state') as response:
            self.assertTrue(json.load(response)['custom_pages'][0]['refreshing'])
        code, error = self.error(self.post, '/api/custom-pages/status/refresh')
        self.assertEqual((code, error), (409, 'This page is already refreshing'))
        first.join()
        self.assertEqual(results, [200])
        # The lock is released afterwards.
        with self.post('/api/custom-pages/status/refresh') as response:
            self.assertEqual(response.status, 200)


if __name__ == '__main__':
    unittest.main()
