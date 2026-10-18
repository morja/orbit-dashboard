from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import os
import sys
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from orbit_config import defaults
from project_changes import FSEventsWatcher, ProjectChanges, IS_DIRECTORY
from server import Dashboard, Store, latest_change


class FakeWatcher:
    def __init__(self, roots, callback):
        self.roots, self.callback = roots, callback
        self.running = False

    def start(self):
        self.running = True
        return True

    def stop(self):
        self.running = False

    def flush(self):
        pass


class IncrementalChecksTest(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.work = self.root / 'projects'
        for name in ('one', 'two', 'three'):
            (self.work / name / '.git').mkdir(parents=True)
            (self.work / name / 'source.py').touch()
        self.changes = ProjectChanges(self.root / 'orbit', watcher_factory=FakeWatcher)
        config = {**defaults(), 'sources': [{'path': str(self.work)}]}
        self.dashboard = Dashboard(Store(self.root / 'data'), config, changes=self.changes)
        self.git_patch = patch('server.git_status', return_value={'status': 'clean', 'last_commit': 100})
        self.scan_patch = patch('server.latest_change', wraps=latest_change)
        self.schedule_patch = patch.object(self.dashboard, 'schedule')
        self.git = self.git_patch.start()
        self.scan = self.scan_patch.start()
        self.schedule_patch.start()
        self.dashboard.collect_projects()
        self.reset_counts()

    def tearDown(self):
        self.dashboard.pool.shutdown()
        self.changes.close()
        self.schedule_patch.stop()
        self.scan_patch.stop()
        self.git_patch.stop()
        self.tmp.cleanup()

    def reset_counts(self):
        self.git.reset_mock()
        self.scan.reset_mock()

    def changed(self, relative, flags=0):
        self.changes.record([(str(self.work / relative), flags)])

    def test_unchanged_checks_skip_discovery_git_and_source_walks(self):
        with patch('server.discover_projects') as discover:
            self.dashboard.collect_projects()
        discover.assert_not_called()
        self.git.assert_not_called()
        self.scan.assert_not_called()
        self.assertEqual(len(self.dashboard.projects), 3)

    def test_only_changed_project_is_inspected(self):
        self.changed('two/source.py')
        self.dashboard.collect_projects()
        self.assertEqual([call.args[0] for call in self.git.call_args_list], [str(self.work / 'two')])
        self.assertEqual(self.scan.call_count, 1)
        self.reset_counts()
        self.dashboard.collect_projects()
        self.git.assert_not_called()
        self.scan.assert_not_called()

    def test_generated_files_and_logs_skip_timestamp_walk_but_update_git(self):
        for path in ('one/node_modules/package/file.js', 'one/runtime.log'):
            with self.subTest(path=path):
                self.changed(path)
                self.dashboard.collect_projects()
                self.assertEqual(self.git.call_count, 1)
                self.scan.assert_not_called()
                self.reset_counts()

    def test_git_metadata_marks_project_and_detects_commit_only_changes(self):
        committed = int(time.time()) + 100
        self.git.return_value = {'status': 'clean', 'last_commit': committed}
        self.changed('one/.git/refs/heads/main')
        self.dashboard.collect_projects()
        self.assertEqual(self.git.call_count, 1)
        self.scan.assert_not_called()
        project = next(row for row in self.dashboard.projects if row['name'] == 'one')
        self.assertEqual(project['last_modified'], committed)

    def test_edits_during_inspection_are_retained_for_next_check(self):
        self.changed('one/source.py')
        def inspect(path):
            self.changed('one/source.py')
            return {'status': 'clean', 'last_commit': 100}
        self.git.side_effect = inspect
        self.dashboard.collect_projects()
        self.git.side_effect = None
        self.reset_counts()
        self.dashboard.collect_projects()
        self.assertEqual(self.git.call_count, 1)

    def test_periodic_and_manual_full_checks_bypass_unchanged_cache(self):
        self.dashboard.projects_full_checked = time.monotonic() - self.dashboard.config['project_full_check_interval'] - 1
        self.dashboard.collect_projects()
        self.assertEqual(self.scan.call_count, 3)
        self.reset_counts()
        self.dashboard.refresh(True)
        self.dashboard.collect_projects()
        self.assertEqual(self.scan.call_count, 3)

    def test_event_loss_and_watcher_failure_fall_back_to_full_checks(self):
        self.changed('one', flags=1)
        self.dashboard.collect_projects()
        self.assertEqual(self.scan.call_count, 3)
        self.reset_counts()
        self.changes.watcher.running = False
        self.dashboard.collect_projects()
        self.assertEqual(self.scan.call_count, 3)

    def test_new_and_removed_projects_trigger_discovery(self):
        new = self.work / 'four'
        (new / '.git').mkdir(parents=True)
        self.changed('four', flags=IS_DIRECTORY | 0x100)
        self.dashboard.collect_projects()
        self.assertEqual(len(self.dashboard.projects), 4)
        self.assertEqual(self.git.call_count, 1)
        self.reset_counts()
        new.rename(self.root / 'removed')
        self.changed('four', flags=IS_DIRECTORY | 0x200)
        self.dashboard.collect_projects()
        self.assertEqual(len(self.dashboard.projects), 3)
        self.git.assert_not_called()

    def test_unarchiving_without_file_changes_rechecks_project(self):
        project = self.dashboard.projects[0]
        self.dashboard.store.save_note(project['id'], {'state': 'archived'})
        self.dashboard.collect_projects()
        self.git.assert_not_called()
        self.dashboard.store.save_note(project['id'], {'state': 'active'})
        self.dashboard.collect_projects()
        self.assertEqual(self.git.call_count, 1)

    def test_new_marker_inside_plain_folder_triggers_rediscovery(self):
        plain = self.work / 'plain'
        (plain / 'nested').mkdir(parents=True)
        self.changed('plain', flags=IS_DIRECTORY | 0x100)
        self.dashboard.collect_projects()
        self.assertIn('plain', [row['name'] for row in self.dashboard.projects])
        self.reset_counts()
        (plain / 'nested/package.json').write_text('{}')
        self.changed('plain/nested/package.json', flags=0x100)
        self.dashboard.collect_projects()
        self.assertNotIn('plain', [row['name'] for row in self.dashboard.projects])
        self.assertIn('nested', [row['name'] for row in self.dashboard.projects])
        self.assertEqual(self.git.call_count, 1)

    def test_root_replacement_restarts_notifications(self):
        watcher = self.changes.watcher
        self.changed('one', flags=0x20)
        self.dashboard.collect_projects()
        self.assertIsNot(self.changes.watcher, watcher)
        self.assertFalse(watcher.running)

    def test_failed_git_checks_are_retried_without_new_events(self):
        self.git.return_value = {'status': 'unknown'}
        self.changed('one/source.py')
        self.dashboard.collect_projects()
        self.reset_counts()
        self.git.return_value = {'status': 'clean'}
        self.dashboard.collect_projects()
        self.assertEqual(self.git.call_count, 1)

    def test_configuration_change_invalidates_reused_results(self):
        self.dashboard.update_config({**self.dashboard.config, 'excluded_dirs': ['generated']})
        self.dashboard.collect_projects()
        self.assertEqual(self.scan.call_count, 3)

    def test_worktree_external_git_directories_are_watched(self):
        project = self.work / 'one'
        (project / '.git').rmdir()
        metadata = self.root / 'external.git/worktrees/one'
        metadata.mkdir(parents=True)
        (metadata / 'commondir').write_text('../..')
        (project / '.git').write_text(f'gitdir: {metadata}\n')
        self.changed('one/.git')
        self.dashboard.collect_projects()
        self.assertIn(str(self.root / 'external.git'), self.changes.roots)
        # Changing watched roots requires a conservative baseline after restarting the stream.
        self.dashboard.collect_projects()
        self.reset_counts()
        self.changes.record([(str(metadata / 'HEAD'), 0)])
        self.dashboard.collect_projects()
        self.assertEqual(self.git.call_count, 1)


class ChangeTrackingTest(unittest.TestCase):
    @unittest.skipUnless(sys.platform == 'darwin', 'Native FSEvents is macOS-only')
    def test_native_events_drive_incremental_collection(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            work = root / 'projects'
            for name in ('one', 'two'):
                (work / name / '.git').mkdir(parents=True)
                (work / name / 'source.py').touch()
            changes = ProjectChanges(root / 'orbit')
            dashboard = Dashboard(Store(root / 'data'), {**defaults(), 'sources': [{'path': str(work)}]}, changes=changes)
            try:
                with patch('server.git_status', return_value={'status': 'clean'}) as git, patch('server.latest_change', wraps=latest_change) as scan, patch.object(dashboard, 'schedule'):
                    dashboard.collect_projects()
                    dashboard.collect_projects()
                    git.reset_mock()
                    scan.reset_mock()
                    dashboard.collect_projects()
                    git.assert_not_called()
                    scan.assert_not_called()

                    def wait_for_edit():
                        deadline = time.monotonic() + 8
                        while time.monotonic() < deadline:
                            if changes.snapshot().source_dirty:
                                return
                            time.sleep(0.05)
                        self.fail('Native change was not marked for collection')

                    (work / 'two/source.py').write_text('changed')
                    wait_for_edit()
                    dashboard.collect_projects()
                    self.assertEqual([call.args[0] for call in git.call_args_list], [str(work / 'two')])
                    self.assertEqual(scan.call_count, 1)
                    git.reset_mock()
                    scan.reset_mock()
                    (work / 'two/source.py').rename(work / 'two/renamed.py')
                    wait_for_edit()
                    dashboard.collect_projects()
                    self.assertEqual(git.call_count, 1)
                    self.assertEqual(scan.call_count, 1)
            finally:
                dashboard.pool.shutdown()
                changes.close()

    def test_own_data_does_not_mark_project_dirty(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            changes = ProjectChanges(root, watcher_factory=FakeWatcher)
            try:
                changes.configure([{'path': str(root)}], [{'id': 'one', 'path': str(root)}], [])
                changes.acknowledge(changes.snapshot().generation)
                changes.record([(str(root / 'data/orbit.sqlite3-wal'), 0)])
                self.assertFalse(changes.snapshot().dirty)
                self.assertFalse(changes.snapshot().discovery)
            finally:
                changes.close()

    @unittest.skipUnless(sys.platform == 'darwin', 'Native FSEvents is macOS-only')
    def test_native_watcher_delivers_file_edits_and_stops(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            source = root / 'source.py'
            source.touch()
            events = []
            watcher = FSEventsWatcher([str(root)], events.extend)
            try:
                self.assertTrue(watcher.start())
                source.write_text('changed')
                deadline = time.monotonic() + 8
                while time.monotonic() < deadline and not any(path == str(source) for path, _ in events):
                    time.sleep(0.05)
                self.assertTrue(any(path == str(source) for path, _ in events), 'Native watcher missed an edit')
            finally:
                watcher.stop()
            self.assertFalse(watcher.running)
            self.assertFalse(watcher.thread.is_alive())


if __name__ == '__main__':
    unittest.main()
