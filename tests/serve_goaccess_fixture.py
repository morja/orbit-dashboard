"""Serve synthetic traffic reports without reading projects or using SSH."""
import json
from pathlib import Path
import runpy
import sys

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
import server

original = server.Dashboard.__init__


def initialize(self, store, config, settings=None):
    config['goaccess'] = {'enabled': True, 'host': 'fixture', 'command': '/fixture/export'}
    original(self, store, config, settings)


def metadata(self):
    return {'source': 'fixture:/fixture/export', 'downloadedAt': '2026-10-11T14:00:00Z', 'reports': [
        {'id': 'demo', 'label': 'Example website <script>', 'hostname': 'example.test', 'file': 'fixture.html',
         'generatedAt': '2026-10-11T02:15:00Z', 'status': 'ready',
         'summary': {'requests': 24000, 'visitors': 37, 'bandwidth': 8000},
         'periods': {key: {'summary': {'requests': hits, 'visitors': people, 'bandwidth': 8000},
                          'startDate': '2026-10-01', 'endDate': '2026-10-11',
                          'dataStart': '2026-10-01', 'dataEnd': '2026-10-11', 'file': 'fixture.html'}
                     for key, hits, people in [('7', 12000, 9), ('30', 24000, 37), ('all', 36000, 80)]}},
        {'id': 'legacy', 'label': 'Legacy website', 'hostname': 'legacy.test', 'file': 'legacy.html',
         'status': 'ready', 'summary': {'requests': 50, 'visitors': 5, 'bandwidth': 1000},
         'periods': {key: {'summary': {'requests': 50, 'visitors': 5, 'bandwidth': 1000}, 'file': 'legacy.html'}
                     for key in ('7', '30', 'all')}},
        {'id': 'waiting', 'label': 'New website', 'status': 'waiting-for-logs', 'summary': {}}
    ]}


def report(self, identifier, period='all'):
    factor = {'7': 1, '30': 2, 'all': 3}[period]

    def row(path, hits, visitors, method='GET'):
        return {'data': path, 'hits': {'count': hits * factor}, 'visitors': {'count': visitors},
                'method': method, 'protocol': 'HTTP/1.1'}

    rows = [row('/', 500, 60), row('/en/teachers', 310, 70), row('/de/teachers', 128, 35),
            row('/en/events?utm_source=mail', 100, 38), row('/en/events?utm_source=search', 18, 4),
            row('/en/recognise', 96, 48), row('/js/filament/support.js', 102, 15),
            row('/livewire-73df76db/update', 903, 17, 'POST'), row('/admin/teachers', 20, 2),
            row('/language/en', 408, 31), row('/favicon.svg', 263, 127),
            row('/articles/<img src=x onerror=alert(1)>', 4, 1)]
    rows += [row(f'/en/articles/example-{index:02}', 40 - index, 3) for index in range(35)]
    payload = {'requests': {'metadata': {'data': {'total': {'value': len(rows) + (5 if period == 'all' else 0)}}}, 'data': rows}}
    data = '' if identifier == 'legacy' else '<script>var json_data = ' + json.dumps(payload).replace('<', '\\u003c') + ';</script>'
    return ('''<!doctype html><html><body><h1>Synthetic GoAccess report</h1>''' + data + '''<script>
      window.reportWorks=(new Function("return 1")())===1;
      try { parent.document.body.dataset.compromised='yes'; }
      catch(error) { window.isolated=true; }
    </script></body></html>''').encode()


server.Dashboard.__init__ = initialize
server.GoAccessCache.read = metadata
server.GoAccessCache.report = report
runpy.run_path(str(root / 'tests/serve_dashboard_fixture.py'), run_name='__main__')
