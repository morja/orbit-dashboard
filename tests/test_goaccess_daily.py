import datetime as dt
import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from goaccess_daily import daily_statistics, snapshot_lines
from goaccess_integration import validate_daily


def line(path='/en/article', *, date='21/Oct/2026:09:00:00 +0200', ip='192.0.2.1', agent='Browser', status=200, method='GET'):
    return f'{ip} - - [{date}] "{method} {path} HTTP/1.1" {status} 100 "-" "{agent}"\n'


class DailyStatisticsTests(unittest.TestCase):
    def test_rotated_and_current_logs_have_deduplicated_daily_page_visitors(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / 'access.log'
            yesterday = '20/Oct/2026:10:00:00 +0200'
            log.write_text(line() + line('/en/article?utm_source=post') + line('/en/other') +
                           line(ip='192.0.2.2') + line('/en/article', status=302) + line(status=404) +
                           line('/build/assets/app.js') + line('/livewire/update', method='POST'))
            with gzip.open(str(log) + '.1.gz', 'wt') as output:
                output.write(line(date=yesterday))
            result = validate_daily(daily_statistics(log, today=dt.date(2026, 10, 21)))
            self.assertTrue(result['includesCurrentLog'])
            self.assertEqual([day['date'] for day in result['days']], ['2026-10-20', '2026-10-21'])
            today = result['days'][1]
            self.assertEqual(today['requests'], 4)
            self.assertEqual(today['visitors'], 2)
            self.assertEqual(today['rows'][0], {'path': '/en/article', 'requests': 3, 'visitors': 2, 'variants': 1})
            text = json.dumps(result)
            self.assertNotIn('192.0.2', text)
            self.assertNotIn('Browser', text)
            self.assertNotIn('utm_source', text)

    def test_calendar_day_uses_berlin_offset_including_dst(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / 'access.log'
            log.write_text(line(date='20/Oct/2026:23:15:00 +0000') +
                           line(date='21/Oct/2026:22:30:00 +0000'))
            result = daily_statistics(log, today=dt.date(2026, 10, 21))
            self.assertEqual(result['days'][0]['date'], '2026-10-21')
            self.assertEqual(result['days'][0]['requests'], 1)

    def test_empty_day_is_zero_but_older_missing_days_are_not_invented(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / 'access.log'
            log.write_text(line(date='19/Oct/2026:12:00:00 +0200') + line()[:-4])
            result = daily_statistics(log, today=dt.date(2026, 10, 21))
            self.assertEqual([day['requests'] for day in result['days']], [1, 0, 0])
            self.assertEqual(result['days'][0]['date'], '2026-10-19')

    def test_snapshot_is_bounded_and_duplicate_inodes_are_skipped(self):
        import io
        self.assertEqual(list(snapshot_lines(io.BytesIO(b'first\nsecond\n'), 6)), ['first\n'])
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / 'access.log'
            log.write_text(line())
            (Path(directory) / 'access.log.1').hardlink_to(log)
            self.assertEqual(daily_statistics(log, today=dt.date(2026, 10, 21))['days'][0]['requests'], 1)

    def test_invalid_formats_do_not_become_zero_traffic_and_partial_is_marked(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / 'access.log'
            log.write_text('unsupported\n')
            with self.assertRaises(ValueError):
                daily_statistics(log)
            log.write_text(line() + 'unsupported\n')
            self.assertTrue(daily_statistics(log, today=dt.date(2026, 10, 21))['days'][0]['partial'])

    def test_exporter_extension_is_idempotent_and_keeps_import_logic(self):
        spec = importlib.util.spec_from_file_location('installer', Path(__file__).resolve().parents[1] / 'scripts/install-goaccess-daily.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        source = 'def prepare():\n    return "unchanged"\n\ndef export_snapshot():\n    print(json.dumps(manifest))\n'
        patched = module.extend_source(source)
        self.assertIn('def prepare():\n    return "unchanged"', patched)
        self.assertEqual(module.extend_source(patched), patched)
        self.assertIn("daily_statistics(site['log'])", patched)


if __name__ == '__main__':
    unittest.main()
