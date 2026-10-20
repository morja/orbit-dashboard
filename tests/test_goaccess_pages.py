import json
import unittest

from goaccess_pages import page_requests


def row(path, hits=10, visitors=3, method='GET', protocol='HTTP/1.1'):
    return {'data': path, 'hits': {'count': hits}, 'visitors': {'count': visitors},
            'method': method, 'protocol': protocol}


def report(rows, total=None, assignment='var json_data = '):
    payload = {'requests': {'metadata': {'data': {'total': {'value': len(rows) if total is None else total}}}, 'data': rows}}
    return ('<html><script>' + assignment + json.dumps(payload) + ';</script></html>').encode()


class PageRequestTests(unittest.TestCase):
    def test_content_only_and_query_variants(self):
        rows = [row('/en/teachers', 310, 70), row('/de/teachers', 128, 35), row('/en/events?utm_source=mail', 20, 8),
                row('/en/events?utm_source=search', 10, 4), row('/', 50, 12), row('/article.v2', 4, 1)]
        hidden = ['/js/filament/support.js', '/favicon.svg', '/build/assets/script.js', '/style.CSS?v=1',
                  '/livewire-73df76db/update', '/language/en', '/admin/teachers', '/de/admin/teachers',
                  '/api/pages', '/fonts/demo.woff2', '/robots.txt', '/feed.xml', '/.env', '/en/%61dmin', '/health',
                  '/wp-login.php', '/xmlrpc.php', '/wp-includes/script.php']
        rows.extend(row(path) for path in hidden)
        rows.append(row('/en/events', method='POST'))
        result = page_requests(report(rows))
        self.assertTrue(result['available'])
        self.assertFalse(result['partial'])
        self.assertEqual([page['path'] for page in result['rows']], ['/en/teachers', '/de/teachers', '/', '/en/events', '/article.v2'])
        self.assertEqual(result['requests'], 522)
        self.assertEqual(result['excludedRequests'], 190)
        events = next(page for page in result['rows'] if page['path'] == '/en/events')
        self.assertEqual(events['requests'], 30)
        self.assertIsNone(events['visitors'], 'Visitors across query variants must not be added')
        self.assertEqual(result['rows'][0]['visitors'], 70)

    def test_protocol_variants_keep_unknown_visitors(self):
        result = page_requests(report([row('/page', 10), row('/page', 20, protocol='HTTP/2')]))
        self.assertEqual(result['requests'], 30)
        self.assertIsNone(result['rows'][0]['visitors'])

    def test_missing_or_executable_data_is_unavailable(self):
        for body in (None, b'', b'<script>throw new Error("bad")</script>',
                     report([], assignment='window.someData = '),
                     b'<script>var json_data = getData();</script>',
                     b'<script>var json_data = {"requests":{"data":[]}} + malicious();</script>'):
            with self.subTest(body=body):
                self.assertFalse(page_requests(body)['available'])
        self.assertTrue(page_requests(report([], assignment='const appData = '))['available'])
        self.assertTrue(page_requests(report([]).replace(b';</script>', b'</script>'))['available'])

    def test_truncation_and_malformed_counts_do_not_become_complete_totals(self):
        result = page_requests(report([row('/page')], total=20))
        self.assertTrue(result['partial'])
        for invalid in (-1, True, '30', 1.5, 10 ** 30):
            with self.subTest(invalid=invalid):
                result = page_requests(report([row('/good'), row('/bad', hits=invalid)]))
                self.assertTrue(result['partial'])
                self.assertEqual(result['requests'], 10)

    def test_paths_stay_literal_and_are_not_fetched_or_executed(self):
        paths = ['/Page/', '/page', '/%3Cscript%3E', '/page?q=<script>']
        result = page_requests(report([row(path) for path in paths]))
        self.assertEqual({page['path'] for page in result['rows']}, {'/Page/', '/page', '/%3Cscript%3E'})
        for path in ('https://example.test/', '//example.test/', 'javascript:alert(1)', '/bad\npath'):
            self.assertTrue(page_requests(report([row(path)]))['partial'])

    def test_missing_method_and_metadata_are_not_guessed(self):
        value = row('/page')
        del value['method']
        self.assertFalse(page_requests(report([value]))['available'])
        self.assertTrue(page_requests(b'<script>var json_data={"requests":{"data":[]}};</script>')['partial'])


if __name__ == '__main__':
    unittest.main()
