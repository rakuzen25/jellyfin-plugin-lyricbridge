"""The exported catalog must run independently and never overwrite a checkout."""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from prepare_catalog import prepare

ROOT = Path(__file__).resolve().parent.parent


class CatalogPreparationTests(unittest.TestCase):
    def test_export_is_self_contained_without_plugin_source_or_dependencies(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "catalog"
            prepare(ROOT, destination)
            subprocess.run(
                [sys.executable, "tests/CatalogPublication.py"],
                cwd=destination,
                check=True,
                capture_output=True,
                text=True,
            )
            subprocess.run(
                [sys.executable, "tests/CatalogMaintenance.py"],
                cwd=destination,
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertFalse((destination / "src").exists())
            self.assertTrue((destination / "manifest.json").is_file())
            self.assertTrue((destination / "OPERATIONS.md").is_file())

    def test_existing_destination_is_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary)
            marker = destination / "keep.txt"
            marker.write_text("existing checkout")
            with self.assertRaises(ValueError):
                prepare(ROOT, destination)
            self.assertEqual(marker.read_text(), "existing checkout")
            self.assertEqual(list(destination.iterdir()), [marker])


if __name__ == "__main__":
    unittest.main()
