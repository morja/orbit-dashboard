"""Check that a release export preserves source but excludes local files and history."""
from pathlib import Path
from tempfile import TemporaryDirectory
import importlib.util
import subprocess
import unittest


spec = importlib.util.spec_from_file_location('release_export', Path(__file__).resolve().parents[1] / 'scripts/export-public.py')
release_export = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release_export)


class ExportTests(unittest.TestCase):
    def repository(self, root):
        root.mkdir()
        self.git(root, 'init', '-q')
        self.git(root, 'config', 'user.name', 'Test')
        self.git(root, 'config', 'user.email', 'test@example.com')
        (root / 'README.md').write_text('Public source')
        self.git(root, 'add', 'README.md')
        self.git(root, 'commit', '-qm', 'Initial source')

    def git(self, root, *args):
        subprocess.run(['git', *args], cwd=root, check=True, capture_output=True)

    def test_export_omits_untracked_local_data_and_history(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / 'source'
            self.repository(root)
            (root / 'data').mkdir()
            (root / 'data/private.txt').write_text('Private')
            (root / 'AGENTS.local.md').write_text('Private rules')
            destination = Path(tmp) / 'export'
            release_export.export_source(root, destination)
            self.assertEqual(sorted(p.name for p in destination.iterdir()), ['README.md'])
            with self.assertRaises(ValueError):
                release_export.export_source(root, destination)

    def test_rejects_tracked_local_configuration(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / 'source'
            self.repository(root)
            (root / 'config.json').write_text('{}')
            self.git(root, 'add', 'config.json')
            self.git(root, 'commit', '-qm', 'Private config')
            destination = Path(tmp) / 'export'
            with self.assertRaises(ValueError):
                release_export.export_source(root, destination)
            self.assertFalse(destination.exists())

    def test_rejects_dirty_source_and_nested_destination(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / 'source'
            self.repository(root)
            with self.assertRaises(ValueError):
                release_export.export_source(root, root / 'export')
            (root / 'README.md').write_text('Uncommitted')
            with self.assertRaises(ValueError):
                release_export.export_source(root, Path(tmp) / 'export')
