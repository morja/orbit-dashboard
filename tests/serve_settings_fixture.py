"""Serve synthetic settings and project data, without real collectors or SSH."""
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from orbit_config import Settings, defaults


def main():
    with TemporaryDirectory(prefix='orbit-ui-') as tmp:
        directory = Path(tmp).resolve()
        projects = directory / 'Projects'
        (projects / 'Example/.git').mkdir(parents=True)
        settings = Settings(directory / 'data/settings.json')
        dashboard = server.Dashboard(server.Store(directory / 'data'), defaults(), settings)
        # Commands are stubbed; this harness never contacts the user's projects or server.
        server.command = lambda *args, **kwargs: ('', 1)
        def refresh(force=False):
            dashboard.collect_mac()
            dashboard.collect_projects()
        dashboard.refresh = refresh
        dashboard.refresh()
        http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        http.dashboard = dashboard
        print(json.dumps({'url': 'http://127.0.0.1:' + str(http.server_address[1]), 'key': dashboard.action_key, 'projects': str(projects)}), flush=True)
        try:
            http.serve_forever()
        finally:
            http.server_close()
            dashboard.pool.shutdown()


if __name__ == '__main__':
    main()
