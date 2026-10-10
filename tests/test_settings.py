from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import json
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from orbit_config import Settings, defaults, detect, migrate_legacy, validate
from server import Dashboard, Handler, Store, ThreadingHTTPServer, discover_projects, open_terminal


class ConfigurationTest(unittest.TestCase):
    def test_clean_install_never_assumes_personal_paths_or_server(self):
        with TemporaryDirectory() as tmp:
            settings = Settings(Path(tmp) / 'settings.json')
            self.assertEqual(settings.value['sources'], [])
            self.assertFalse(settings.value['moon_enabled'])
            self.assertEqual(settings.value['terminal'], 'auto')
            self.assertFalse(settings.path.exists())

    def test_multiple_servers_migrate_validate_and_keep_separate_cache(self):
        old = validate({**defaults(), 'moon_enabled': True, 'moon_host': 'old', 'moon_label': 'Original'})
        self.assertEqual(old['servers'][0]['host'], 'old')
        self.assertTrue(old['servers'][0]['show_in_overview'])
        hidden = validate({**defaults(), 'servers': [{'host':'hidden', 'enabled':True, 'show_in_overview':False}]})
        self.assertFalse(hidden['servers'][0]['show_in_overview'])
        self.assertTrue(hidden['moon_enabled'])
        with self.assertRaises(ValueError):
            validate({**defaults(), 'servers': [{'host':'bad', 'show_in_overview':'false'}]})
        servers = [{'host': 'one', 'label': 'One', 'command': 'status', 'enabled': True},
                   {'host': 'two', 'label': 'Two', 'command': 'status', 'enabled': True}]
        config = validate({**defaults(), 'servers': servers})
        self.assertEqual(config['moon_host'], 'one')
        with TemporaryDirectory() as tmp:
            store = Store(Path(tmp))
            previous = {'sections': {'DIENSTE': []}, 'warnings': [], 'checked_at': 'previous'}
            store.cache('moon:two:status', previous)
            dashboard = Dashboard(store, config)
            def fake_command(args, **kwargs):
                return ('good', 0) if args[-2] == 'one' else ('', 255)
            with patch('server.command', side_effect=fake_command), patch('server.parse_moon', return_value={**previous, 'checked_at': 'fresh'}):
                dashboard.collect_moon()
            values = dashboard.snapshot()['servers']
            self.assertEqual(values[0]['status']['checked_at'], 'fresh')
            self.assertEqual(values[1]['status']['checked_at'], 'previous')
            self.assertIn('Two', values[1]['status']['error'])
            dashboard.pool.shutdown()
        for invalid in [servers + [servers[0]], [{**servers[0], 'command': 'status;evil'}], [{**servers[0], 'host': '-evil'}]]:
            with self.assertRaises(ValueError):
                validate({**defaults(), 'servers': invalid})

    def test_custom_website_links_validate_and_persist_without_defaults(self):
        server = {'host':'example', 'website_links': {'app.example.com':'https://app.example.com/dashboard?a=b'}}
        with TemporaryDirectory() as tmp:
            settings = Settings(Path(tmp) / 'settings.json')
            settings.save({**defaults(), 'servers':[server]})
            self.assertEqual(Settings(settings.path).value['servers'][0]['website_links'], server['website_links'])
        self.assertEqual(validate({'servers':[{'host':'example'}]})['servers'][0]['website_links'], {})
        for url in ['javascript:alert(1)', 'https://user:password@example.com', 'https://example.com/ bad']:
            with self.assertRaises(ValueError):
                validate({'servers':[{**server, 'website_links':{'app.example.com':url}}]})
        self.assertEqual(validate({'category_order':['Clients','Projects','Clients']})['category_order'], ['Clients','Projects'])
        with self.assertRaises(ValueError):
            validate({'category_order':'Clients'})
        legacy = migrate_legacy({'roots':[], 'moon_host':'example', 'moon_command':'/usr/local/bin/custom-status'})
        self.assertEqual(legacy['moon_command'], '/usr/local/bin/custom-status')
        self.assertEqual(migrate_legacy({'roots':[], 'moon_host':'example'})['moon_command'], 'moon-status')

    def test_readability_defaults_ranges_and_persistence(self):
        self.assertEqual([validate({})[key] for key in ('font_size', 'contrast', 'zoom')], [100, 100, 100])
        with TemporaryDirectory() as tmp:
            settings = Settings(Path(tmp) / 'settings.json')
            settings.save({**defaults(), 'font_size': 125, 'contrast': 160, 'zoom': 150, 'density': 'comfortable'})
            self.assertEqual(Settings(settings.path).value['font_size'], 125)
            self.assertEqual(Settings(settings.path).value['density'], 'comfortable')
            self.assertEqual(Settings(settings.path).value['contrast'], 160)
            self.assertEqual(Settings(settings.path).value['zoom'], 150)
            for key, value in [('font_size', 79), ('font_size', 161), ('contrast', 99), ('contrast', 201), ('zoom', 69), ('zoom', 201), ('zoom', True), ('font_size', 100.5)]:
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    settings.save({**defaults(), key: value})
            self.assertEqual(Settings(settings.path).value['zoom'], 150)

    def test_existing_settings_keep_original_palette(self):
        config = defaults()
        del config['palette']
        del config['language']
        config['theme'] = 'dark'
        self.assertEqual(validate(config)['palette'], 'orbit')
        self.assertEqual(validate(config)['theme'], 'dark')
        self.assertEqual(validate(config)['language'], 'en')

    def test_migration_preserves_original_file_and_project_ids(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'Work/Projects/demo/.git').mkdir(parents=True)
            (root / 'Work/Archive/old/.git').mkdir(parents=True)
            legacy = root / 'config.json'
            original = json.dumps({'roots': [str(root / 'Work')], 'moon_host': 'moon'})
            legacy.write_text(original)
            settings = Settings(root / 'data/settings.json', legacy)
            projects, errors = discover_projects(settings.value['sources'])
            self.assertFalse(errors)
            self.assertEqual({p['name'] for p in projects}, {'demo', 'old'})
            self.assertEqual(next(p for p in projects if p['name'] == 'old')['default_state'], 'archived')
            self.assertEqual(legacy.read_text(), original)
            self.assertEqual(Settings(settings.path).value, settings.value)
            self.assertEqual(settings.path.stat().st_mode & 0o777, 0o600)

    def test_invalid_settings_do_not_replace_saved_file(self):
        with TemporaryDirectory() as tmp:
            settings = Settings(Path(tmp) / 'settings.json')
            settings.save(defaults())
            original = settings.path.read_bytes()
            for changes in [{'moon_enabled': True}, {'moon_host': '-oProxyCommand=evil'}, {'moon_command': 'status;touch /tmp/no'}, {'moon_command': 'status --json'}, {'sources': [{'path': 'relative'}]}, {'sources': [{'path': '/tmp', 'archived': 'false'}]}, {'scan_depth': True}, {'excluded_dirs': ['../private']}, {'version': 2}, {'palette': 'unknown'}, {'theme': 'unknown'}, {'language': 'fr'}, {'unknown': 1}, {'density': 'dense'}]:
                with self.subTest(changes=changes), self.assertRaises(ValueError):
                    settings.save({**defaults(), **changes})
                self.assertEqual(settings.path.read_bytes(), original)

    def test_arbitrary_roots_categories_and_direct_project(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'custom/team/api/.git').mkdir(parents=True)
            (root / 'custom/node_modules/ignore/.git').mkdir(parents=True)
            (root / 'custom/dependencies/ignore/.git').mkdir(parents=True)
            sources = [{'path': str(root / 'custom'), 'category': 'Meine Dienste', 'group': 'Team', 'archived': False}]
            projects, errors = discover_projects(sources, excluded_dirs=['node_modules', 'dependencies'])
            self.assertFalse(errors)
            self.assertEqual(len(projects), 1)
            self.assertEqual(projects[0]['category'], 'Meine Dienste')
            self.assertEqual(projects[0]['group'], 'Team')
            direct, _ = discover_projects([{'path': str(root / 'custom/team/api')}])
            self.assertEqual(direct[0]['id'], projects[0]['id'])

    def test_detection_only_suggests_existing_bounded_locations(self):
        with TemporaryDirectory() as tmp:
            home = Path(tmp)
            (home / 'Projects').mkdir()
            (home / 'Private').mkdir()
            (home / 'Code').symlink_to(home / 'Private', target_is_directory=True)
            suggestions = detect(home)
            self.assertEqual([p['path'] for p in suggestions['sources']], [str(home / 'Projects')])
            self.assertFalse(suggestions['sources'][0]['archived'])

    def test_terminal_uses_literal_path_and_auto_falls_back(self):
        with patch('server.shutil.which', return_value=None), patch('server.command', return_value=('', 0)) as run:
            open_terminal({'path': '/tmp/project;echo unsafe'}, defaults())
            self.assertEqual(run.call_args.args[0], ['open', '-a', 'Terminal', '/tmp/project;echo unsafe'])


class SettingsAPITest(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.settings = Settings(Path(self.tmp.name) / 'settings.json')
        self.dashboard = Dashboard(Store(self.tmp.name), self.settings.value, self.settings)
        self.http = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.http.dashboard = self.dashboard
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.url = 'http://127.0.0.1:' + str(self.http.server_address[1])

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        self.dashboard.pool.shutdown()
        self.tmp.cleanup()

    def request(self, value=None, origin=None, key=None):
        headers = {'Content-Type': 'application/json', 'X-Orbit-Key': self.dashboard.action_key if key is None else key}
        if origin:
            headers['Origin'] = origin
        request = urllib.request.Request(self.url + '/api/settings', data=json.dumps(value).encode() if value is not None else None, headers=headers)
        return urllib.request.urlopen(request)

    def test_save_reloads_without_restart_and_survives_reopening(self):
        config = defaults()
        config['sources'] = [{'path': self.tmp.name, 'category': 'Tools', 'group': '', 'archived': False}]
        config['theme'] = 'dark'
        with patch.object(self.dashboard, 'refresh') as refresh, self.request(config) as response:
            saved = json.load(response)
        refresh.assert_called_once_with(True)
        self.assertEqual(saved, Settings(self.settings.path).value)
        self.assertEqual(self.dashboard.snapshot()['config']['theme'], 'dark')
        self.assertEqual(self.dashboard.snapshot()['roots'], [str(Path(self.tmp.name).resolve())])
        with self.request() as response:
            self.assertEqual(json.load(response), saved)

    def test_static_modules_are_served_and_other_files_are_not(self):
        for path, kind in [('/', 'text/html'), ('/js/main.js', 'text/javascript'), ('/js/locales/de.js', 'text/javascript'), ('/css/orbit.css', 'text/css')]:
            with urllib.request.urlopen(self.url + path) as response:
                self.assertTrue(response.headers['Content-Type'].startswith(kind), path)
        for path in ['/css/../../server.py', '/js/%2e%2e/server.py', '/.gitignore', '/js/.hidden.js', '/../orbit_config.py', '/index.py']:
            with self.assertRaises(urllib.error.HTTPError, msg=path) as raised:
                urllib.request.urlopen(self.url + path)
            raised.exception.close()
            self.assertEqual(raised.exception.code, 404, path)

    def test_changes_need_the_private_action_key(self):
        key_file = Path(self.tmp.name) / 'action.key'
        self.assertEqual(oct(key_file.stat().st_mode & 0o777), '0o600')
        self.assertEqual(Store(self.tmp.name).action_key(), self.dashboard.action_key)
        for key in ('', 'wrong', 'ü'):
            with self.assertRaises(urllib.error.HTTPError) as raised:
                self.request(defaults(), key=key)
            raised.exception.close()
            self.assertEqual(raised.exception.code, 403)
        self.assertFalse(self.settings.path.exists())
        with urllib.request.urlopen(self.url + '/api/settings') as response:
            self.assertEqual(response.status, 200)

    def test_cross_origin_and_invalid_mutations_are_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as raised:
            self.request(defaults(), 'https://foreign.example')
        raised.exception.close()
        self.assertEqual(raised.exception.code, 403)
        with self.assertRaises(urllib.error.HTTPError) as raised:
            self.request({'moon_command': 'status && shutdown'})
        raised.exception.close()
        self.assertEqual(raised.exception.code, 400)
        self.assertFalse(self.settings.path.exists())

    def test_disabled_collectors_do_not_run_or_show_cached_values(self):
        self.dashboard.moon = {'checked_at': 'old', 'warnings': ['old server']}
        with patch.object(self.dashboard, 'schedule') as schedule:
            self.dashboard.refresh()
        self.assertEqual([call.args[0] for call in schedule.call_args_list], ['mac', 'projects', 'sizes'])
        self.assertIsNone(self.dashboard.snapshot()['moon'])
        self.assertEqual(self.dashboard.snapshot()['docker']['status'], 'disabled')
        with patch('server.command') as run:
            self.dashboard.collect_moon()
            self.dashboard.collect_ddev()
            self.dashboard.collect_docker()
        run.assert_not_called()

    def test_inflight_server_result_cannot_replace_new_configuration(self):
        config = defaults()
        config.update(moon_enabled=True, moon_host='one')
        self.dashboard.config = validate(config)
        def changing_command(*args, **kwargs):
            self.dashboard.config = validate({**config, 'moon_host': 'two'})
            return ('', 1)
        with patch('server.command', side_effect=changing_command), patch('server.parse_moon', return_value={'warnings': [], 'checked_at': 'old'}):
            self.dashboard.collect_moon()
        self.assertIsNone(self.dashboard.moon)


class StartupStateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        root = Path(self.tmp.name) / 'Projects'
        (root / 'Example/.git').mkdir(parents=True)
        config = defaults()
        config['sources'] = [{'path': str(root), 'category': 'Tools', 'group': '', 'archived': False}]
        self.settings = Settings(Path(self.tmp.name) / 'data/settings.json')
        self.settings.save(config)

    def tearDown(self):
        self.tmp.cleanup()

    def dashboard(self):
        dashboard = Dashboard(Store(Path(self.tmp.name) / 'data'), self.settings.value, self.settings)
        self.addCleanup(dashboard.pool.shutdown)
        return dashboard

    def test_last_projects_appear_at_start_and_progress_is_counted(self):
        first = self.dashboard()
        with patch('server.git_status', return_value={'status': 'clean', 'changed': 0}), patch('server.latest_change', return_value=1), patch.object(first, 'schedule'):
            first._run('projects', first.collect_projects)
        self.assertEqual(first.snapshot()['progress'], {})
        second = self.dashboard()
        snapshot = second.snapshot()
        self.assertEqual([p['name'] for p in snapshot['projects']], ['Example'])
        self.assertEqual(snapshot['projects_checked_at'], first.projects_checked)
        self.assertLessEqual(snapshot['projects_checked_at'], snapshot['started_at'])

    def test_saved_projects_are_ignored_after_folders_change(self):
        first = self.dashboard()
        with patch('server.git_status', return_value={'status': 'clean', 'changed': 0}), patch('server.latest_change', return_value=1), patch.object(first, 'schedule'):
            first.collect_projects()
        config = self.settings.value
        config['scan_depth'] = 2
        self.settings.save(config)
        self.assertEqual(self.dashboard().snapshot()['projects'], [])

    def test_state_answers_not_modified_until_values_change(self):
        dashboard = self.dashboard()
        http = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        http.dashboard = dashboard
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        url = 'http://127.0.0.1:' + str(http.server_address[1]) + '/api/state'
        try:
            with urllib.request.urlopen(url) as response:
                tag = response.headers['ETag']
            with self.assertRaises(urllib.error.HTTPError) as raised:
                urllib.request.urlopen(urllib.request.Request(url, headers={'If-None-Match': tag}))
            raised.exception.close()
            self.assertEqual(raised.exception.code, 304)
            dashboard.progress['projects'] = {'done': 1, 'total': 2}
            with urllib.request.urlopen(urllib.request.Request(url, headers={'If-None-Match': tag})) as response:
                self.assertNotEqual(response.headers['ETag'], tag)
        finally:
            http.shutdown()
            http.server_close()
            thread.join()

    def test_dashboard_refresh_is_validated(self):
        self.assertEqual(defaults()['ui_refresh'], 10)
        for value in (4, 301, '10'):
            with self.assertRaises(ValueError):
                validate({**defaults(), 'ui_refresh': value})


if __name__ == '__main__':
    unittest.main()
