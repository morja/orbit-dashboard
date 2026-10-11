from pathlib import Path
from tempfile import TemporaryDirectory
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import recent_commits


class RecentCommitsTests(unittest.TestCase):
    def test_local_history_limit_subject_and_detached_head(self):
        with TemporaryDirectory() as folder:
            def git(*args):
                return subprocess.run(['git', '-C', folder, *args], check=True,
                                      capture_output=True, text=True).stdout

            git('init')
            git('config', 'user.name', 'Synthetic Author')
            git('config', 'user.email', 'test@example.invalid')
            self.assertEqual(recent_commits(folder), [])
            for index in range(12):
                git('commit', '--allow-empty', '-m', f'Commit {index} <tag> | ü')
            rows = recent_commits(folder)
            self.assertEqual(len(rows), 10)
            self.assertEqual(rows[0]['subject'], 'Commit 11 <tag> | ü')
            self.assertIsInstance(rows[0]['timestamp'], int)
            self.assertEqual(rows[0]['id'], git('rev-parse', '--short', 'HEAD').strip())
            git('checkout', '--detach', 'HEAD~2')
            self.assertEqual(recent_commits(folder)[0]['subject'], 'Commit 9 <tag> | ü')
            self.assertEqual(git('status', '--porcelain'), '')

    def test_non_repository(self):
        with TemporaryDirectory() as folder:
            with self.assertRaises(ValueError):
                recent_commits(folder)
