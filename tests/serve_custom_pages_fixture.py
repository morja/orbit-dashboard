"""Serve Orbit with synthetic custom pages and refresh scripts in a temporary folder."""
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from orbit_config import Settings, defaults


# A self-contained page that follows Orbit's appearance parameters.
PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Synthetic status</title>
<style>
  :root { --bg: #fafbf7; --text: #33463d; }
  :root[data-theme="dark"] { --bg: #18201c; --text: #dfe6dc; }
  body { margin: 0; padding: 24px; background: var(--bg); color: var(--text); font: 14px/1.5 system-ui; }
</style>
<script>
  const query = new URLSearchParams(location.search);
  document.documentElement.dataset.theme = query.get('theme') || 'light';
  document.documentElement.dataset.palette = query.get('palette') || 'orbit';
  document.documentElement.style.fontSize = (Number(query.get('scale')) || 1) * 100 + '%';
</script>
</head>
<body>
<h1>Synthetic status</h1>
<p id="version">Version COUNT</p>
<p id="appearance"></p>
<script>document.getElementById('appearance').textContent = location.search;</script>
</body>
</html>
"""


def script(path, body):
    path.write_text('#!/bin/sh\n' + body)
    path.chmod(0o700)


def main():
    with TemporaryDirectory(prefix='orbit-pages-') as tmp:
        directory = Path(tmp).resolve()
        pages = directory / 'pages'
        pages.mkdir()
        template = directory / 'template.html'
        template.write_text(PAGE)
        status = pages / 'status.html'
        status.write_text(PAGE.replace('COUNT', '1'))
        # Each refresh writes the next version after a short pause, so the busy state is visible.
        script(directory / 'make-status', f'sleep 1\ncount=$(cat "{directory}/count" 2>/dev/null || echo 1)\ncount=$((count + 1))\n'
               f'echo "$count" > "{directory}/count"\nsed "s/COUNT/$count/" "{template}" > "{status}"\n')
        script(directory / 'fail-status', 'echo "starting" >&2\necho "synthetic failure: data source unavailable" >&2\nexit 3\n')
        script(directory / 'make-later', f'sed "s/COUNT/later/" "{template}" > "{pages}/later.html"\n')
        config = defaults()
        config['custom_pages'] = [
            {'id': 'status', 'name': 'Status board', 'file': str(status), 'refresh_command': str(directory / 'make-status'), 'enabled': True},
            {'id': 'failing', 'name': 'Failing page', 'file': str(status), 'refresh_command': str(directory / 'fail-status'), 'enabled': True},
            {'id': 'later', 'name': 'Not yet generated', 'file': str(pages / 'later.html'), 'refresh_command': str(directory / 'make-later'), 'enabled': True},
            {'id': 'static', 'name': 'Static <b>page</b>', 'file': str(pages / 'none.html'), 'refresh_command': '', 'enabled': True},
        ]
        settings = Settings(directory / 'data/settings.json')
        settings.save(config)
        dashboard = server.Dashboard(server.Store(directory / 'data'), settings.value, settings)
        # Collectors are stubbed; this harness never reads the user's projects or servers.
        server.command = lambda *args, **kwargs: ('', 1)
        dashboard.refresh = lambda force=False: dashboard.collect_mac()
        dashboard.refresh()
        http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        http.dashboard = dashboard
        print(json.dumps({'url': 'http://127.0.0.1:' + str(http.server_address[1]), 'key': dashboard.action_key,
                          'folder': str(directory)}), flush=True)
        try:
            http.serve_forever()
        finally:
            http.server_close()
            dashboard.pool.shutdown()


if __name__ == '__main__':
    main()
