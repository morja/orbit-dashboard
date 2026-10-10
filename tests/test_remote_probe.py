"""Automatic SSH permission, parsing, bundling and retry checks without a server."""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import unittest
import subprocess

from orbit_config import defaults, validate
from remote_probe import BEGIN, END, parse_probe, probe_script
from server import Dashboard, Store


OUTPUT = BEGIN + '\nhostname\tfixture\nos\tLinux\nram\t1073741824\t536870912\ndisk\t1048576\t262144\t786432\n' + END
CUSTOM = 'MOON STATUS\nDIENSTE\n  App  aktiv\nSPEICHER\n  Home-Dateisystem  1 / 4 GiB used (25 %)\n  Freier Platz  3 GiB\nBACKUP\n  Letzter Erfolg  today\nWEBSEITEN\n  example.org erreichbar (HTTPS, HTTP 200)\n'


class ProbeTest(unittest.TestCase):
    def test_permission_defaults_and_validation(self):
        item = validate({'servers': [{'host': 'fixture', 'command': 'status', 'enabled': True}]})['servers'][0]
        self.assertFalse(item['automatic'])
        for changes in ({'automatic': 'yes'}, {'probe_ports': True}, {'command': ''}, {'command': 'status;evil'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate({'servers': [{**item, **changes}]})
        config = validate({'servers': [{'host': 'fixture', 'command': '', 'automatic': True, 'enabled': True}]})
        self.assertEqual(config['servers'][0]['command'], '')
        self.assertEqual(validate(config), config)

    def test_fixed_script_and_partial_data(self):
        for flags in ({}, {'probe_services': True}, {'probe_ports': True}, {'probe_services': True, 'probe_ports': True}):
            syntax = subprocess.run(['sh', '-n'], input=probe_script(flags), text=True, capture_output=True)
            self.assertEqual(syntax.returncode, 0, syntax.stderr)
        basic = probe_script({'host': 'must-not-enter-script'})
        self.assertNotIn('must-not-enter-script', basic)
        self.assertNotIn('systemctl', basic)
        self.assertNotIn('ss -H', basic)
        self.assertIn('ss -H', probe_script({'probe_ports': True}))
        value = parse_probe(OUTPUT)
        self.assertEqual(value['disk']['free'], 786432*1024)
        self.assertEqual(value['memory'], {'total':1073741824, 'used':536870912, 'available':536870912})
        self.assertIn('0.5 / 1.0 GiB', value['sections']['SYSTEM'][-1]['value'])
        with self.assertRaises(ValueError):
            parse_probe(OUTPUT.replace(END, ''))
        with self.assertRaises(ValueError):
            parse_probe(OUTPUT.replace('1048576', '-1'))
        partial = parse_probe(BEGIN + '\nhostname\tfixture\n' + END)
        self.assertEqual(len(partial['warnings']), 2)

    def dashboard(self, directory, **options):
        config = validate({**defaults(), 'servers': [{'host': 'fixture', 'enabled': True, 'command': '', 'automatic': True, **options}]})
        return Dashboard(Store(Path(directory)), config)

    def test_single_connection_combination_and_interval(self):
        with TemporaryDirectory() as tmp:
            dashboard = self.dashboard(tmp, command='status')
            with patch('server.command', return_value=(CUSTOM + '__ORBIT_CUSTOM_EXIT__0\n' + OUTPUT, 0)) as run:
                dashboard.collect_moon()
                dashboard.collect_moon()
            self.assertEqual(run.call_count, 1)
            args, kwargs = run.call_args
            self.assertEqual(args[0][-1], 'sh -s')
            self.assertIn('StrictHostKeyChecking=yes', args[0])
            self.assertIn('status </dev/null', kwargs['input'])
            value = dashboard.snapshot()['servers'][0]['status']
            self.assertEqual(value['sections']['BACKUP'][0]['value'], 'today')
            self.assertEqual(value['sections']['SPEICHER'][1]['value'], '3 GiB')
            self.assertTrue(value['sections']['SYSTEM'])
            dashboard.pool.shutdown()

    def test_failure_keeps_cache_and_backs_off(self):
        with TemporaryDirectory() as tmp:
            dashboard = self.dashboard(tmp)
            with patch('server.command', return_value=(OUTPUT, 0)):
                dashboard.collect_moon()
            original = dashboard.snapshot()['servers'][0]['status']['checked_at']
            dashboard.probe_attempts.clear()
            with patch('server.command', return_value=('', 255)) as run:
                dashboard.collect_moon()
                dashboard.collect_moon()
            self.assertEqual(run.call_count, 1)
            value = dashboard.snapshot()['servers'][0]['status']
            self.assertEqual(value['checked_at'], original)
            self.assertTrue(value['error'])
            dashboard.pool.shutdown()
