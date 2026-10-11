"""Synthetic service definitions and runtime tables; no real Mac services are read."""
from pathlib import Path
from tempfile import TemporaryDirectory
import plistlib
import unittest
from unittest.mock import patch

import local_services
from orbit_config import defaults, validate


class LocalServicesTest(unittest.TestCase):
    def test_runtime_and_definitions_remain_separate(self):
        with TemporaryDirectory() as tmp:
            home = Path(tmp)
            entries = [ ('backup', {'StartInterval': 300}), ('failed', {}), ('disabled', {}), ('unloaded', {}), ('running', {}) ]
            for label, details in entries:
                (home / (label + '.plist')).write_bytes(plistlib.dumps({'Label': label, 'ProgramArguments': ['/bin/worker', 'secret-argument'], **details}))
            (home / 'broken.plist').write_text('invalid')
            (home / 'broken-xml.plist').write_text('<?xml version="1.0"?><plist><dict>&invalid;</dict></plist>')
            (home / 'array.plist').write_bytes(plistlib.dumps(['invalid definition']))
            output = 'services = {\n - 0 backup\n - 7 failed\n 123 0 running\n}\n'
            calls = []

            def command(args, timeout=8):
                calls.append(args)
                if args[1] == 'print':
                    return output, 0
                if args[1] == 'print-disabled':
                    return '"disabled" => true', 0
                return '# ignore\nTOKEN=secret\n0 3 * * * /bin/cleanup --token secret\n@reboot /bin/start\n', 0

            result = local_services.collect(command, home, [(home, 'user', 'third_party', 'gui/123')], 'darwin')
            states = {row['name']: row['status'] for row in result['items']}
            self.assertEqual(states, {'backup': 'waiting', 'failed': 'failed', 'disabled': 'disabled', 'unloaded': 'not_loaded', 'running': 'running', 'cleanup': 'scheduled', 'start': 'scheduled'})
            self.assertNotIn('secret', str(result))
            self.assertEqual(result['items'][0]['schedule'], 'Every 300 seconds')
            self.assertTrue(result['notices'])
            self.assertTrue(next(row for row in result['items'] if row['name'] == 'cleanup')['is_own'])
            self.assertTrue(all(args[1] in ('print', 'print-disabled', '-l') for args in calls))
            second = local_services.collect(command, home, [(home, 'user', 'third_party', 'gui/123')], 'darwin')
            self.assertEqual([row['id'] for row in result['items']], [row['id'] for row in second['items']])

    def test_custom_script_is_recognized_but_user_app_is_not(self):
        with TemporaryDirectory() as tmp:
            home = Path(tmp)
            definitions = {
                'backup': {'ProgramArguments': ['/bin/zsh', str(home / 'Work/scripts/backup.sh')]},
                'app': {'Program': str(home / 'Applications/Example.app/Contents/MacOS/helper')},
                'installed': {'ProgramArguments': ['/opt/homebrew/bin/vendor-helper', str(home / 'Documents/data.json')]},
            }
            for name, details in definitions.items():
                (home / (name + '.plist')).write_bytes(plistlib.dumps({'Label': name, **details}))
            def command(args, timeout=8):
                return ('services = {\n - 0 backup\n - 0 app\n - 0 installed\n}\n', 0) if args[1] == 'print' else ('', 0)
            result = local_services.collect(command, home, [(home, 'user', 'third_party', 'gui/123')], 'darwin')
            own = {row['name']: row['is_own'] for row in result['items']}
            self.assertEqual(own, {'backup': True, 'app': False, 'installed': False})
            backup = next(row for row in result['items'] if row['name'] == 'backup')
            self.assertEqual(backup['display_name'], 'backup.sh')
            self.assertEqual(backup['script'], str(home / 'Work/scripts/backup.sh'))
            self.assertFalse(local_services.program_info(definitions['backup'], home, 'apple')['is_own'])

    def test_zero_runtime_pid_means_no_process(self):
        self.assertIsNone(local_services.launch_state('services = {\n 0 0 backup\n}\n')['backup']['pid'])

    def test_unreadable_runtime_is_unknown(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path / 'job.plist').write_bytes(plistlib.dumps({'Label': 'job'}))
            result = local_services.collect(lambda *a, **kw: ('', None), path, [(path, 'system', 'apple', 'system')], 'darwin')
            self.assertEqual(result['items'][0]['status'], 'unknown')
            self.assertTrue(result['notices'])

    def test_non_mac_never_executes_commands(self):
        def command(*args, **kwargs):
            self.fail('Must not execute on other platforms')
        self.assertFalse(local_services.collect(command, platform='linux')['items'])

    def test_settings_upgrade_and_annotation_validation(self):
        old = defaults()
        del old['intervals']['services']
        self.assertEqual(validate(old)['intervals']['services'], 120)
        key = 'a' * 20
        config = {**defaults(), 'service_preferences': {key: {'own': True, 'favorite': True, 'description': 'Personal description'}}}
        self.assertEqual(validate(config)['service_preferences'][key]['description'], 'Personal description')
        for item in [{'own': 'true'}, {'description': 'x' * 501}, {'command': 'anything'}]:
            with self.assertRaises(ValueError):
                validate({**defaults(), 'service_preferences': {key: item}})
        with self.assertRaises(ValueError):
            validate({**defaults(), 'service_preferences': {'invalid': {}}})
