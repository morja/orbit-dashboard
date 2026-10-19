import time
"""Serve a synthetic workspace for the dashboard browser checks, without real collectors or SSH."""
from collections import namedtuple
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import sys
import faulthandler

# Report a slow fixture's exact wait without exposing its generated action key.
faulthandler.dump_traceback_later(8, repeat=True)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import server
from orbit_config import Settings, defaults
from test_server import MOON


PROJECTS = {
    'Projects/alpha-app': {'changed': 3, 'modified': 1760000000},
    'Projects/beta-site': {'ahead': 2, 'behind': 1, 'modified': 1759900000},
    'Projects/gamma-tool': {'modified': 1759800000},
    'Clients/Acme/shop': {'changed': 1, 'has_remote': False, 'upstream': '', 'modified': 1759700000},
    'Clients/Acme/portal': {'ddev': True, 'comparison_unavailable': True, 'modified': 1759600000},
    'Clients/Globex/intranet': {'upstream': '', 'modified': 1759500000},
    'Archive/old-site': {'modified': 1700000000},
    'Archive/legacy-api': {'modified': 1690000000},
}
DOCKER_USAGE = '\n'.join(json.dumps(row) for row in [
    {'Type': 'Images', 'TotalCount': '12', 'Active': '4', 'Size': '6.2GB', 'Reclaimable': '2.1GB (33%)'},
    {'Type': 'Containers', 'TotalCount': '5', 'Active': '2', 'Size': '120MB', 'Reclaimable': '20MB (16%)'},
    {'Type': 'Local Volumes', 'TotalCount': '3', 'Active': '2', 'Size': '1.4GB', 'Reclaimable': '0B'},
    {'Type': 'Build Cache', 'TotalCount': '30', 'Active': '0', 'Size': '800MB', 'Reclaimable': '800MB'},
])


def main():
    with TemporaryDirectory(prefix='orbit-dashboard-') as tmp:
        work = Path(tmp).resolve() / 'Work'
        for relative, details in PROJECTS.items():
            marker = work / relative / ('.ddev' if details.get('ddev') else '.git')
            marker.mkdir(parents=True)
            if details.get('ddev'):
                (marker / 'config.yaml').touch()
        portal = str(work / 'Clients/Acme/portal')

        def command(args, timeout=8):
            # Answer only the read-only commands the collectors use; everything else fails.
            if args[0].endswith('ddev') and 'list' in args:
                return json.dumps({'raw': [{'name': 'portal', 'approot': portal, 'status': 'running', 'primary_url': 'https://portal.ddev.site'}]}), 0
            if args[0].endswith('docker') and args[1] == 'ps':
                return '\n'.join(json.dumps(row) for row in [
                    {'name':'app-database', 'image':'postgres:17', 'state':'running', 'status':'Up 2 hours', 'ports':'127.0.0.1:5432->5432/tcp', 'ddev':'', 'project':'app'},
                    {'name':'worker', 'image':'python:3.13', 'state':'exited', 'status':'Exited (0) 1 day ago', 'ports':'', 'ddev':'', 'project':'app'},
                    {'name':'ddev-portal-web', 'image':'ddev/webserver', 'state':'running', 'status':'Up 1 hour', 'ports':'80/tcp', 'ddev':'ddev', 'project':'ddev-portal'},
                ]), 0
            if args[0].endswith('docker') and args[1:3] == ['system', 'df']:
                return DOCKER_USAGE, 0
            if args[:2] == ['du', '-sk']:
                return '\n'.join(f'{len(path) * 1000}\t{path}' for path in args[2:]), 0
            return '', 1

        def git_status(path):
            details = PROJECTS[str(Path(path).relative_to(work))]
            changed = details.get('changed', 0)
            has_remote = details.get('has_remote', True)
            upstream = details.get('upstream', 'origin/main')
            comparable = bool(upstream) and not details.get('comparison_unavailable')
            files = [{'path': f'src/file-{index}.js', 'status': ' M'} for index in range(changed)]
            return {'available': True, 'status': 'dirty' if changed else 'clean', 'branch': 'main', 'changed': changed,
                    'staged': 0, 'unstaged': changed, 'untracked': 0, 'conflicts': 0,
                    'has_remote': has_remote, 'upstream': upstream, 'ahead': details.get('ahead', 0) if comparable else None,
                    'behind': details.get('behind', 0) if comparable else None, 'files': files, 'last_commit': details['modified']}

        server.command = command
        # Fixed machine values keep screenshots comparable between runs.
        usage = namedtuple('Usage', 'total used free')
        server.shutil.disk_usage = lambda path: usage(500 * 1024 ** 3, 320 * 1024 ** 3, 180 * 1024 ** 3)
        server.socket.gethostname = lambda: 'example-mac.local'
        server.recent_commits = lambda path: [{
            "id": f"{i + 1:07x}", "subject": "Synthetic commit <script> & " + "long subject " * 12,
            "timestamp": int(time.time()) - i * 3600} for i in range(10)]
        server.git_status = git_status
        server.latest_change = lambda path, last_commit=None, **kwargs: last_commit

        config = defaults()
        config.update(sources=[
            {'path': str(work / 'Projects'), 'category': 'Own projects', 'group': '', 'archived': False},
            {'path': str(work / 'Clients'), 'category': 'Clients', 'group': '', 'archived': False},
            {'path': str(work / 'Archive'), 'category': 'Archive', 'group': '', 'archived': True},
        ], services_enabled=True, ddev_enabled=True, docker_enabled=True, moon_enabled=True, moon_host='example', moon_label='Moon', terminal='Terminal')
        settings = Settings(Path(tmp) / 'data/settings.json')
        settings.save(config)
        store = server.Store(Path(tmp) / 'data')
        dashboard = server.Dashboard(store, settings.value, settings)
        dashboard.collect_mac()
        dashboard.collect_projects()
        # One active project is archived by hand and keeps its category.
        gamma = next(p for p in dashboard.projects if p['name'] == 'gamma-tool')
        store.save_note(gamma['id'], {'next_step': '', 'state': 'archived', 'priority': 'normal'})
        dashboard.collect_projects()
        dashboard.collect_sizes()
        dashboard.collect_ddev()
        dashboard.collect_docker()
        dashboard.moon = {**server.parse_moon(MOON), 'checked_at': server.stamp()}
        dashboard.servers[dashboard.server_key(dashboard.config['servers'][0])] = dashboard.moon
        dashboard.services = {'checked_at': server.stamp(), 'notices': [], 'items': [
            {'id': f'{index:020x}', 'name': name, 'kind': kind, 'scope': scope, 'origin': origin,
             'path': '/Library/LaunchDaemons/' + name + '.plist',
             'program': '/System/Library/PrivateFrameworks/' + ('VeryLongFrameworkName' * 12) + '.framework/Versions/A/Resources/' + name,
             'is_own': name == 'custom-backup',
             'display_name': 'backup.sh' if name == 'custom-backup' else name,
             'script': '/Users/example/Work/scripts/backup.sh' if name == 'custom-backup' else '',
             'schedule': 'On demand' if kind == 'launchd' else '0 3 * * *', 'status': status,
             'exit_code': 7 if status == 'failed' else 0, 'pid': 123 if status == 'running' else 0}
            for index, (name, kind, scope, origin, status) in enumerate([
                ('custom-backup', 'launchd', 'user', 'third_party', 'waiting'),
                ('com.apple.fixture', 'launchd', 'system', 'apple', 'running'),
                ('broken-worker', 'launchd', 'system', 'third_party', 'failed'),
                ('nightly-cleanup', 'cron', 'user', 'third_party', 'scheduled'),
            ], 1)
        ]}
        # Values stay fixed during the browser run.
        dashboard.refresh = lambda force=False: None

        http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        http.dashboard = dashboard
        faulthandler.cancel_dump_traceback_later()
        print(json.dumps({'url': 'http://127.0.0.1:' + str(http.server_address[1]), 'key': dashboard.action_key}), flush=True)
        try:
            http.serve_forever()
        finally:
            http.server_close()
            dashboard.pool.shutdown()


if __name__ == '__main__':
    main()
