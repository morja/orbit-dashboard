import importlib.util
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest

SPEC = importlib.util.spec_from_file_location('release_notes', Path(__file__).resolve().parents[1] / 'scripts/release_notes.py')
notes = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(notes)


class ReleaseNotesTests(unittest.TestCase):
    def test_user_visible_filter_and_override(self):
        self.assertEqual(notes.user_change('feat(git): add history', ''), ('New', 'Add history'))
        self.assertIsNone(notes.user_change('fix(ci): repair pipeline', ''))
        self.assertIsNone(notes.user_change('chore: update tooling', ''))
        self.assertIsNone(notes.user_change('feat: internal seam', 'Release-Note: none'))
        self.assertEqual(notes.user_change('refactor(ui): consolidate components', 'Release-Note: Text sizes now match across views'), ('Changed', 'Text sizes now match across views'))
        self.assertEqual(notes.user_change('feat!: change setup', 'Release-Note: Rebuild the app before updating'), ('Breaking changes', 'Rebuild the app before updating'))

    def test_range_deduplication_and_version_validation(self):
        with TemporaryDirectory() as directory:
            def git(*args):
                subprocess.run(['git', '-C', directory, *args], check=True, capture_output=True)

            git('init')
            git('config', 'user.name', 'Synthetic Author')
            git('config', 'user.email', 'test@example.invalid')
            git('commit', '--allow-empty', '-m', 'feat: old feature')
            git('tag', 'v0.1.0-preview.1')
            git('commit', '--allow-empty', '-m', 'fix(ui): stop dialog flicker')
            git('commit', '--allow-empty', '-m', 'fix(ui): stop dialog flicker')
            result = notes.generate(directory, 'v0.1.0-preview.2')
            self.assertNotIn('Old feature', result)
            self.assertEqual(result.count('Stop dialog flicker'), 1)
            with self.assertRaises(ValueError):
                notes.generate(directory, '--invalid')
