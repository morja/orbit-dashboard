from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import json
import subprocess
import sys
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import ddev_for_project, docker_bytes, parse_docker_usage, parse_docker_containers, parse_vm_disk, Dashboard, Handler, Store, ThreadingHTTPServer, discover_projects, git_status, latest_change, open_cmux, parse_ddev, parse_moon, project_id
import os
from orbit_config import defaults, migrate_legacy


MOON = """MOON STATUS  |  10.10.2026 10:00 Berlin

DIENSTE
  Webserver               aktiv
  Cron                    failed

WEBSEITEN
  a-very-long-domain.example.com erreichbar (HTTPS, HTTP 200)
  broken.example.com      Zertifikat ungültig
  Prüfumfang: Abruf von Moon über DNS, TLS und HTTP; kein Login-Test.

SPEICHER
  Freier Platz            54.4 GiB

BACKUP
  Letzter Abschluss       erfolgreich

ERGEBNIS
  HINWEIS: Cron: nicht aktiv
  HINWEIS: broken.example.com: Zertifikat ungültig
"""


class CollectorsTest(unittest.TestCase):
    def test_removing_missing_source_clears_old_warning_before_rescan(self):
        with TemporaryDirectory() as tmp:
            dashboard = Dashboard(Store(Path(tmp) / 'data'), {"roots": [str(Path(tmp) / 'missing')]})
            try:
                with patch.object(dashboard, 'schedule'):
                    dashboard.collect_projects()
                    self.assertEqual(len(dashboard.snapshot()['project_errors']), 1)
                    dashboard.update_config({**dashboard.config, 'theme': 'dark'})
                    self.assertEqual(len(dashboard.snapshot()['project_errors']), 1)
                    updated = {**dashboard.config, 'sources': []}
                    dashboard.update_config(updated)
                    self.assertEqual(dashboard.snapshot()['project_errors'], [])
                    dashboard.collect_projects()
                    self.assertEqual(dashboard.snapshot()['project_errors'], [])
            finally:
                dashboard.pool.shutdown()

    def test_docker_units_and_data_partition(self):
        self.assertEqual(docker_bytes("1.408GB (11%)"), 1408000000)
        self.assertEqual(docker_bytes("0B (0%)"), 0)
        disk = parse_vm_disk("Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vdb1 51420776 19974848 29017984 41% /var/lib/docker\n")
        self.assertEqual(disk["free"], 29017984 * 1024)
        self.assertEqual(disk["percent"], 40.8)
        with self.assertRaises(ValueError):
            docker_bytes("unknown")
        with self.assertRaises(ValueError):
            parse_docker_usage('{}')

    def test_all_registered_ddev_projects_count_and_failed_check_is_unknown(self):
        with TemporaryDirectory() as tmp:
            dashboard = Dashboard(Store(tmp), {"roots": []})
            dashboard.ddev = {"projects": [{"name": "client", "approot": "/elsewhere/client", "status": "running"}], "checked_at": "now", "error": None}
            self.assertEqual(dashboard.snapshot()["ddev"]["running"], 1)
            with patch("server.command", return_value=("", 1)):
                dashboard.collect_ddev()
            self.assertIsNone(dashboard.snapshot()["ddev"]["running"])
            self.assertEqual(dashboard.snapshot()["ddev"]["projects"][0]["status"], "unknown")
            dashboard.pool.shutdown()

    def test_container_list_uses_labels_and_bounds_rows(self):
        sample = {'name':'database', 'image':'postgres:17', 'state':'running', 'status':'Up 2 hours', 'ports':'5432/tcp', 'ddev':'', 'project':'demo'}
        rows, truncated = parse_docker_containers(json.dumps(sample))
        self.assertFalse(rows[0]['is_ddev'])
        self.assertEqual(rows[0]['project'], 'demo')
        rows, truncated = parse_docker_containers(json.dumps([{**sample, 'ddev':'ddev'}] * 251))
        self.assertEqual(len(rows), 250)
        self.assertTrue(truncated)
        self.assertTrue(rows[0]['is_ddev'])
        self.assertEqual(parse_docker_containers(''), ([], False))
        with self.assertRaises(ValueError):
            parse_docker_containers('{"name":"incomplete"}')

    def test_docker_failure_clears_old_successful_values(self):
        with TemporaryDirectory() as tmp:
            dashboard = Dashboard(Store(tmp), {"roots": []})
            dashboard.docker = {"status": "running", "vm_disk": {"free": 100}, "usage": [{"active": 2}]}
            with patch("server.command", return_value=("", 1)):
                dashboard.collect_docker()
            self.assertEqual(dashboard.docker["status"], "unreachable")
            self.assertNotIn("vm_disk", dashboard.docker)
            self.assertEqual(dashboard.docker["usage"], [])
            dashboard.pool.shutdown()

    def test_activity_ignores_dependencies_and_git_but_includes_uncommitted_files(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name, modified in [("src/code.py", 200), (".git/index", 900), ("node_modules/a/index.js", 1000), (".ddev/config.yaml", 250)]:
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.touch()
                os.utime(file, (modified, modified))
            log = root / "automatic.log"
            log.write_text("runtime output")
            os.utime(log, (999, 999))
            self.assertEqual(latest_change(root, 100), 250)
            self.assertEqual(latest_change(root, 300), 300)

    def test_activity_tracks_nested_edits_deletions_and_custom_exclusions(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'src/nested/code.py'
            source.parent.mkdir(parents=True)
            source.touch()
            os.utime(source, (200, 200))
            excluded = root / 'generated/output.py'
            excluded.parent.mkdir()
            excluded.touch()
            os.utime(excluded, (900, 900))
            (root / 'linked-file').symlink_to(excluded)
            (root / 'linked-folder').symlink_to(excluded.parent, target_is_directory=True)

            self.assertEqual(latest_change(root, 100, excluded_dirs=['generated']), 200)
            os.utime(source, (300, 300))
            self.assertEqual(latest_change(root, 100, excluded_dirs=['generated']), 300)
            source.unlink()
            self.assertEqual(latest_change(root, 100, excluded_dirs=['generated']), 100)

    def test_project_collection_honors_custom_exclusions_and_ignores_own_data(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            (root / '.git').mkdir()
            for name, modified in [('src.py', 200), ('generated/output.py', 900), ('data/cache.json', 800)]:
                file = root / name
                file.parent.mkdir(exist_ok=True)
                file.touch()
                os.utime(file, (modified, modified))
            config = {**defaults(), 'sources': [{'path': str(root)}], 'excluded_dirs': ['generated']}
            dashboard = Dashboard(Store(root / '.orbit-test-data'), config)
            try:
                with patch('server.APP', root), patch('server.git_status', return_value={'last_commit': 100}), patch.object(dashboard, 'schedule'):
                    dashboard.collect_projects()
                self.assertEqual(dashboard.projects[0]['last_modified'], 200)
            finally:
                dashboard.pool.shutdown()

    def test_tools_wait_five_minutes_in_background_and_catch_up_on_return(self):
        with TemporaryDirectory() as tmp:
            config = {**defaults(), 'ddev_enabled': True, 'docker_enabled': True, 'services_enabled': True}
            dashboard = Dashboard(Store(tmp), config)
            names = ('ddev', 'docker', 'services')
            try:
                dashboard.last.update({name: 1000 for name in names})
                with patch('server.time.monotonic', return_value=100), patch('server.time.time', return_value=1120), patch.object(dashboard.pool, 'submit') as submit:
                    for name in names:
                        dashboard.schedule(name, getattr(dashboard, 'collect_' + name))
                    submit.assert_not_called()
                    dashboard.set_activity('a' * 32, True)
                    self.assertEqual(dashboard.active, {'projects', *names})
                    self.assertEqual(submit.call_count, 4)
                    # Heartbeats and a second window must not duplicate checks.
                    dashboard.set_activity('a' * 32, True)
                    dashboard.set_activity('b' * 32, True)
                    self.assertEqual(submit.call_count, 4)
                dashboard.active.clear()
                with patch('server.time.monotonic', return_value=146), patch('server.time.time', return_value=1299), patch.object(dashboard.pool, 'submit') as submit:
                    for name in names:
                        dashboard.schedule(name, getattr(dashboard, 'collect_' + name))
                    submit.assert_not_called()
                    self.assertEqual(dashboard.foreground_clients, {})
                with patch('server.time.time', return_value=1300), patch.object(dashboard.pool, 'submit') as submit:
                    for name in names:
                        dashboard.schedule(name, getattr(dashboard, 'collect_' + name))
                    self.assertEqual(submit.call_count, 3)
            finally:
                dashboard.pool.shutdown()

    def test_tools_keep_longer_intervals_and_manual_refresh_while_inactive(self):
        with TemporaryDirectory() as tmp:
            config = defaults()
            config['intervals']['ddev'] = 600
            dashboard = Dashboard(Store(tmp), config)
            try:
                dashboard.last['ddev'] = 1000
                with patch('server.time.time', return_value=1300), patch.object(dashboard.pool, 'submit') as submit:
                    dashboard.schedule('ddev', dashboard.collect_ddev)
                    submit.assert_not_called()
                    dashboard.schedule('ddev', dashboard.collect_ddev, True)
                    submit.assert_called_once()
                dashboard.active.clear()
                dashboard.config['tools_background_interval'] = 900
                with patch('server.time.time', return_value=1600), patch.object(dashboard.pool, 'submit') as submit:
                    dashboard.schedule('ddev', dashboard.collect_ddev)
                    submit.assert_not_called()
                with patch('server.time.time', return_value=1900), patch.object(dashboard.pool, 'submit') as submit:
                    dashboard.schedule('ddev', dashboard.collect_ddev)
                    submit.assert_called_once()
            finally:
                dashboard.pool.shutdown()

    def test_project_checks_pause_expire_and_refresh_on_foreground_return(self):
        with TemporaryDirectory() as tmp:
            config = {**defaults(), 'projects_background_enabled': False}
            dashboard = Dashboard(Store(tmp), config)
            client = 'a' * 32
            try:
                with patch('server.time.monotonic', return_value=100), patch.object(dashboard.pool, 'submit') as submit:
                    dashboard.schedule('projects', dashboard.collect_projects)
                    dashboard.schedule('sizes', dashboard.collect_sizes)
                    submit.assert_not_called()

                    dashboard.set_activity(client, True)
                    submit.assert_called_once()
                    self.assertIn('projects', dashboard.active)
                    dashboard.active.clear()
                    dashboard.last['projects'] = 1000

                    # A heartbeat does not force another scan before the foreground interval.
                    with patch('server.time.time', return_value=1030):
                        dashboard.set_activity(client, True)
                        dashboard.schedule('projects', dashboard.collect_projects)
                        self.assertEqual(submit.call_count, 1)
                    with patch('server.time.time', return_value=1060):
                        dashboard.schedule('projects', dashboard.collect_projects)
                        self.assertEqual(submit.call_count, 2)
                    dashboard.active.clear()

                    dashboard.set_activity(client, False)
                    dashboard.schedule('projects', dashboard.collect_projects)
                    self.assertEqual(submit.call_count, 2)
                    dashboard.set_activity(client, True)
                    self.assertEqual(submit.call_count, 3, 'Returning to the foreground must refresh immediately')
                    dashboard.active.clear()

                with patch('server.time.monotonic', return_value=146), patch.object(dashboard.pool, 'submit') as submit:
                    dashboard.schedule('projects', dashboard.collect_projects)
                    submit.assert_not_called()
                    dashboard.schedule('projects', dashboard.collect_projects, True)
                    submit.assert_called_once()  # An explicit Refresh still works.
            finally:
                dashboard.pool.shutdown()

    def test_activity_keeps_other_windows_active_and_uses_background_interval(self):
        with TemporaryDirectory() as tmp:
            dashboard = Dashboard(Store(tmp), defaults())
            try:
                with patch.object(dashboard.pool, 'submit'), patch('server.time.monotonic', return_value=100):
                    dashboard.set_activity('a' * 32, True)
                    dashboard.set_activity('b' * 32, True)
                    dashboard.set_activity('a' * 32, False)
                    dashboard.active.clear()
                    dashboard.last['projects'] = 1000
                    with patch('server.time.time', return_value=1060):
                        dashboard.schedule('projects', dashboard.collect_projects)
                        self.assertIn('projects', dashboard.active)
                    dashboard.active.clear()
                    dashboard.set_activity('b' * 32, False)
                    with patch('server.time.time', return_value=1299):
                        dashboard.schedule('projects', dashboard.collect_projects)
                        self.assertNotIn('projects', dashboard.active)
                    with patch('server.time.time', return_value=1300):
                        dashboard.schedule('projects', dashboard.collect_projects)
                        self.assertIn('projects', dashboard.active)
            finally:
                dashboard.pool.shutdown()

    def test_archive_skips_git_and_preserves_notebook(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "projects"
            (root / "old/.git").mkdir(parents=True)
            key = project_id((root / "old").resolve())
            store = Store(Path(tmp) / "data")
            store.save_note(key, {"state": "archived", "next_step": "Keep this", "priority": "high"})
            dashboard = Dashboard(store, {"roots": [str(root)]})
            with patch("server.git_status") as git, patch.object(dashboard, "schedule"):
                dashboard.collect_projects()
            git.assert_not_called()
            project = dashboard.snapshot()["projects"][0]
            self.assertEqual(project["state"], "archived")
            self.assertEqual(project["next_step"], "Keep this")
            self.assertEqual(project["git"]["status"], "archived")
            dashboard.pool.shutdown()

    def test_moon_preserves_reported_port_rows(self):
        value = parse_moon(MOON + '\nPORTS\n  HTTPS · TCP 443  reachable locally\n  API · TCP 8080  listening\n')
        self.assertEqual(value['sections']['PORTS'], [
            {'label': 'HTTPS · TCP 443', 'value': 'reachable locally'},
            {'label': 'API · TCP 8080', 'value': 'listening'},
        ])
        self.assertEqual(len(value['warnings']), 2)

    def test_moon_accepts_warnings_and_long_domains(self):
        value = parse_moon(MOON)
        self.assertEqual(len(value["warnings"]), 2)
        self.assertEqual(len(value["sections"]["WEBSEITEN"]), 2)
        self.assertEqual(value["sections"]["WEBSEITEN"][0]["value"], "erreichbar (HTTPS, HTTP 200)")

    def test_moon_rejects_truncated_result(self):
        with self.assertRaises(ValueError):
            parse_moon("MOON STATUS\nDIENSTE\n  Webserver   aktiv")

    def test_ddev_empty_and_log_records(self):
        self.assertEqual(parse_ddev('{"raw": []}'), [])
        self.assertEqual(parse_ddev('noise\n{"raw": [{"approot": "/tmp/site", "status": "running"}]}')[0]["status"], "running")
        with self.assertRaises(ValueError):
            parse_ddev('{"level":"fatal","msg":"Docker failed"}')

    def test_ddev_website_subfolder_matches_repo_without_guessing_multiple_sites(self):
        nested = {"approot": "/tmp/client/www", "status": "running"}
        exact = {"approot": "/tmp/client", "status": "stopped"}
        self.assertEqual(ddev_for_project("/tmp/client", [nested]), nested)
        self.assertEqual(ddev_for_project("/tmp/client", [nested, exact]), exact)
        self.assertIsNone(ddev_for_project("/tmp/client", [nested, {"approot": "/tmp/client/other"}]))
        self.assertIsNone(ddev_for_project("/tmp/client", [{"approot": "/tmp/client-other/www"}]))

    def test_work_roots_deep_clients_categories_and_deduplication(self):
        with TemporaryDirectory() as tmp:
            work = Path(tmp) / "Work"
            for folder in ["Projects/own/.git", "AndroidStudioProjects/android/.git", "Clients/Team/Acme/platform/api/.ddev", "Clients/Other/site/.git", "Archive/old/.git", "Playground/demo", "Basic/template"]:
                (work / folder).mkdir(parents=True)
            (work / "Clients/Team/Acme/platform/api/.ddev/config.yaml").touch()
            (work / "Playground/demo/package.json").write_text('{}')
            projects, errors = discover_projects(migrate_legacy({"roots": [str(work), str(work / "Projects")]})["sources"])
            self.assertFalse(errors)
            self.assertEqual(len(projects), 7)
            rows = {p["name"]: p for p in projects}
            self.assertEqual(rows["api"]["category"], "Clients")
            self.assertEqual(rows["api"]["group"], "Team")
            self.assertEqual(rows["own"]["category"], "Projects")
            self.assertEqual(rows["android"]["group"], "Projects")
            self.assertEqual(rows["demo"]["category"], "Playground")
            self.assertEqual(rows["template"]["category"], "Basic")
            self.assertEqual(rows["old"]["default_state"], "archived")

    def test_work_archive_default_respects_manual_status_and_notes(self):
        with TemporaryDirectory() as tmp:
            work = Path(tmp) / "Work"
            (work / "Archive/old/.git").mkdir(parents=True)
            store = Store(Path(tmp) / "db")
            dashboard = Dashboard(store, {"roots": [str(work)]})
            with patch("server.git_status", return_value={"status": "clean"}), patch("server.latest_change", return_value=1), patch.object(dashboard, "schedule"):
                dashboard.collect_projects()
                self.assertEqual(dashboard.snapshot()["projects"][0]["state"], "archived")
                project = dashboard.projects[0]
                store.save_note(project["id"], {"next_step": "Keep working", "state": "active", "priority": "normal"})
                dashboard.collect_projects()
                row = dashboard.snapshot()["projects"][0]
                self.assertEqual(row["state"], "active")
                self.assertEqual(row["next_step"], "Keep working")
            dashboard.pool.shutdown()

    def test_discovery_groups_worktrees_and_ignores_dependencies(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ["Kirby/one/.git", "Kirby/two/.ddev", "simple/node_modules/fake/.git", "plain"]:
                (root / name).mkdir(parents=True)
            (root / "Kirby/two/.ddev/config.yaml").touch()
            (root / "worktree").mkdir()
            (root / "worktree/.git").write_text("gitdir: elsewhere")
            (root / "link").symlink_to(root / "Kirby", target_is_directory=True)
            projects, errors = discover_projects([str(root)])
            self.assertFalse(errors)
            self.assertEqual({p["name"] for p in projects}, {"one", "two", "plain", "simple", "worktree"})
            self.assertEqual(next(p for p in projects if p["name"] == "one")["group"], "Kirby")

    def test_git_rename_newline_filename_and_conflict_counts(self):
        with TemporaryDirectory() as tmp:
            (Path(tmp) / ".git").mkdir()
            output = ('# branch.head feature/test\0# branch.upstream origin/main\0# branch.ab +3 -2\0'
                      '2 R. N... 100644 100644 100644 a b R100 renamed\0old-name\0'
                      '? file\nname\0u UU N... 100644 100644 100644 100644 a b c conflicted\0')
            outputs = [(output, 0), ('abcdef0\0' + '1234567890\n', 0), ('origin\n', 0)]
            with patch("server.command", side_effect=outputs):
                result = git_status(tmp)
            self.assertEqual(result["changed"], 3)
            self.assertEqual(result["conflicts"], 1)
            self.assertEqual(result["untracked"], 1)
            self.assertEqual([f["path"] for f in result["files"]], ["renamed", "file\nname", "conflicted"])
            self.assertEqual((result["behind"], result["ahead"]), (2, 3))

    def test_git_failed_check_is_unknown(self):
        with TemporaryDirectory() as tmp:
            (Path(tmp) / ".git").mkdir()
            with patch("server.command", return_value=("", 128)):
                self.assertEqual(git_status(tmp)["status"], "unknown")

    def test_git_preview_is_bounded(self):
        with TemporaryDirectory() as tmp:
            (Path(tmp) / ".git").mkdir()
            output = '# branch.head main\0' + ''.join(f'1 .M N... 100644 100644 100644 a b file-{n}.txt\0' for n in range(30))
            with patch("server.command", side_effect=[(output, 0), ('abcdef0\0' + '100', 0), ('origin\n', 0)]):
                result = git_status(tmp)
            self.assertEqual(len(result["files"]), 12)
            self.assertEqual(result["files_remaining"], 18)
            self.assertEqual(result["changed"], 30)

    def test_git_remote_and_tracking_states(self):
        with TemporaryDirectory() as tmp:
            def git(*args):
                subprocess.run(["git", "-C", tmp, *args], check=True, capture_output=True)

            git("init", "-b", "main")
            git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "Initial")
            result = git_status(tmp)
            self.assertFalse(result["has_remote"])
            self.assertEqual(result["upstream"], "")
            self.assertIsNone(result["ahead"])

            git("remote", "add", "origin", "https://example.invalid/test.git")
            result = git_status(tmp)
            self.assertTrue(result["has_remote"])
            self.assertEqual(result["upstream"], "")

            git("update-ref", "refs/remotes/origin/main", "HEAD")
            git("branch", "--set-upstream-to=origin/main")
            result = git_status(tmp)
            self.assertEqual(result["upstream"], "origin/main")
            self.assertEqual((result["ahead"], result["behind"]), (0, 0))

            # Tracking remains configured when the last known remote ref is missing.
            git("update-ref", "-d", "refs/remotes/origin/main")
            result = git_status(tmp)
            self.assertEqual(result["upstream"], "origin/main")
            self.assertIsNone(result["ahead"])

            git("checkout", "--detach")
            self.assertEqual(git_status(tmp)["upstream"], "")

    def test_cmux_reuses_workspace_without_sending_shell_commands(self):
        project = {"path": "/tmp/project", "id": "123", "name": "Project"}
        listing = json.dumps({"workspaces": [{"current_directory": "/tmp/project", "id": "workspace-id"}]})
        with patch("server.executable", return_value="/opt/homebrew/bin/cmux"), patch("server.shutil.which", return_value="/opt/homebrew/bin/cmux"), patch("server.command", side_effect=[(listing, 0), ("", 0), ("", 0)]) as run:
            open_cmux(project)
        self.assertEqual(run.call_args_list[1].args[0], ["/opt/homebrew/bin/cmux", "select-workspace", "--workspace", "workspace-id"])
        self.assertEqual(run.call_args_list[2].args[0], ["open", "-a", "cmux"])

    def test_cmux_new_workspace_uses_literal_path_argument(self):
        path = "/tmp/Project with 'quotes' and $(commands)"
        with patch("server.executable", return_value="/opt/homebrew/bin/cmux"), patch("server.shutil.which", return_value="/opt/homebrew/bin/cmux"), patch("server.command", side_effect=[("", 1), ("", 0), ("", 0)]) as run:
            open_cmux({"path": path})
        self.assertEqual(run.call_args_list[1].args[0], ["/opt/homebrew/bin/cmux", path])

    def test_moon_offline_keeps_previous_check_and_data(self):
        with TemporaryDirectory() as tmp:
            store = Store(tmp)
            previous = parse_moon(MOON)
            store.cache("moon", previous)
            dashboard = Dashboard(store, {"roots": [], "moon_host": "example", "moon_label": "Moon"})
            with patch("server.command", return_value=("", 255)):
                dashboard.collect_moon()
            self.assertEqual(dashboard.moon["checked_at"], previous["checked_at"])
            self.assertEqual(dashboard.moon["sections"], previous["sections"])
            self.assertTrue(dashboard.moon["error"])
            dashboard.pool.shutdown()


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.store = Store(self.tmp.name)
        self.dashboard = Dashboard(self.store, {"roots": [], "moon_host": "moon"})
        self.scheduling = patch.object(self.dashboard, "schedule")
        self.scheduling.start()
        self.key = project_id(Path(self.tmp.name))
        self.dashboard.projects = [{"id": self.key, "name": "Test", "path": self.tmp.name, "group": "Tests", "has_ddev": True, "git": {"status": "none"}}]
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.http.dashboard = self.dashboard
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.http.server_address[1]}"

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.dashboard.pool.shutdown()
        self.thread.join()
        self.scheduling.stop()
        self.tmp.cleanup()

    def request(self, path, data=None, origin=None, key=None):
        headers = {"Content-Type": "application/json", "X-Orbit-Key": self.dashboard.action_key if key is None else key}
        if origin:
            headers["Origin"] = origin
        request = urllib.request.Request(self.url + path, data=json.dumps(data).encode() if data is not None else None, headers=headers)
        return urllib.request.urlopen(request)

    def test_notes_persist_and_unknown_ddev_is_not_stopped(self):
        text = '<script>alert("x")</script>\nReview changes'
        with self.request(f"/api/projects/{self.key}", {"next_step": text, "state": "paused", "priority": "high"}) as response:
            self.assertEqual(response.status, 200)
        self.assertEqual(Store(self.tmp.name).notes()[self.key]["next_step"], text)
        self.dashboard.ddev["error"] = "offline"
        with self.request("/api/state") as response:
            project = json.load(response)["projects"][0]
        self.assertEqual(project["ddev"]["status"], "unknown")
        self.assertEqual(project["state"], "paused")

    def test_cross_origin_mutation_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request(f"/api/projects/{self.key}", {"next_step": "unwanted"}, "https://example.com")
        self.assertEqual(context.exception.code, 403)
        self.assertFalse(self.store.notes())

    def test_activity_requires_authentication_and_valid_window_identity(self):
        data = {'client': 'a' * 32, 'active': True}
        for key, origin in [('', None), (self.dashboard.action_key, 'https://example.com')]:
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request('/api/activity', data, origin=origin, key=key)
            self.assertEqual(error.exception.code, 403)
        for invalid in [{**data, 'active': 1}, {**data, 'client': 'invalid'}, []]:
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request('/api/activity', invalid)
            self.assertEqual(error.exception.code, 400)
        with self.request('/api/activity', data) as response:
            self.assertEqual(response.status, 200)
        self.assertTrue(self.dashboard.project_checks_active())
        with self.request('/api/activity', {**data, 'active': False}):
            pass
        self.assertFalse(self.dashboard.foreground_clients)

    def test_path_traversal_and_invalid_metadata_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request("/../server.py")
        self.assertEqual(context.exception.code, 404)
        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request(f"/api/projects/{self.key}", {"state": "invented"})
        self.assertEqual(context.exception.code, 400)


if __name__ == "__main__":
    unittest.main()
