"""Read real Git states with a bounded number of read-only subprocesses."""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class GitStatusTest(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.git('init', '-b', 'main')

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args, input=None):
        return subprocess.check_output(
            ['git', '-C', str(self.root), '-c', 'user.name=Test',
             '-c', 'user.email=test@example.invalid', *args],
            input=input, text=True, stderr=subprocess.DEVNULL).strip()

    def commit(self, message='Initial'):
        self.git('commit', '--allow-empty', '-m', message)

    def test_check_reads_branch_tracking_and_commit_with_three_processes(self):
        self.commit()
        self.git('remote', 'add', 'origin', 'https://example.invalid/test.git')
        self.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
        self.git('branch', '--set-upstream-to=origin/main')
        self.git('config', 'status.aheadBehind', 'false')
        self.commit('Local work')
        with patch('server.command', wraps=server.command) as command:
            status = server.git_status(self.root)
        self.assertEqual(status['branch'], 'main')
        self.assertEqual(status['upstream'], 'origin/main')
        self.assertEqual((status['ahead'], status['behind']), (1, 0))
        self.assertEqual(status['last_commit'], int(self.git('log', '-1', '--format=%ct')))
        self.assertLessEqual(command.call_count, 3)

    def test_unborn_and_detached_branches(self):
        status = server.git_status(self.root)
        self.assertEqual(status['branch'], 'main')
        self.assertIsNone(status['last_commit'])
        self.commit()
        self.git('config', 'core.abbrev', '12')
        self.git('checkout', '--detach')
        status = server.git_status(self.root)
        self.assertEqual(status['branch'], self.git('rev-parse', '--short', 'HEAD'))
        self.assertEqual(status['upstream'], '')
        self.assertIsNone(status['ahead'])

    def test_rename_and_unusual_names_preserve_counts_without_index_writes(self):
        (self.root / 'old name.txt').write_text('original\n')
        (self.root / 'modified.txt').write_text('original\n')
        self.git('add', '.')
        self.commit()
        self.git('mv', 'old name.txt', 'new\nname.txt')
        (self.root / 'modified.txt').write_text('modified\n')
        (self.root / '# untracked.txt').touch()
        index = self.root / '.git/index'
        before = (index.read_bytes(), index.stat().st_mtime_ns)
        status = server.git_status(self.root)
        self.assertEqual(status['changed'], 3)
        self.assertEqual((status['staged'], status['unstaged'], status['untracked']), (1, 1, 1))
        self.assertEqual({row['path'] for row in status['files']}, {'new\nname.txt', 'modified.txt', '# untracked.txt'})
        self.assertEqual((index.read_bytes(), index.stat().st_mtime_ns), before)

    def test_unmerged_files_and_diverged_history(self):
        (self.root / 'conflict.txt').write_text('base\n')
        self.git('add', '.')
        self.commit()
        self.git('branch', 'other')
        (self.root / 'conflict.txt').write_text('main\n')
        self.git('commit', '-am', 'Main work')
        self.git('checkout', 'other')
        (self.root / 'conflict.txt').write_text('other\n')
        self.git('commit', '-am', 'Other work')
        self.git('checkout', 'main')
        self.git('remote', 'add', 'origin', 'https://example.invalid/test.git')
        self.git('update-ref', 'refs/remotes/origin/main', 'other')
        self.git('branch', '--set-upstream-to=origin/main')
        with self.assertRaises(subprocess.CalledProcessError):
            self.git('merge', 'other')
        status = server.git_status(self.root)
        self.assertEqual(status['conflicts'], 1)
        self.assertEqual(status['files'], [{'path': 'conflict.txt', 'status': 'UU'}])
        self.assertEqual((status['ahead'], status['behind']), (1, 1))
