"""Plugin-owned standalone web installer contract."""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from jellyfin_plugin_toolkit.common.release_metadata import load_release

ROOT = Path(__file__).resolve().parents[2]


class ReleaseTests(unittest.TestCase):
    def test_web_installation_accepts_frontend_only_and_archive_only_checkouts(self):
        files = (
            "lyricbridge.js",
            "lyricbridge.css",
            "jellyfin-lyric-motion.js",
            "jellyfin-lyric-motion.css",
        )
        for mode in ("frontend", "archive"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for name in (
                    "scripts/installation/__init__.py",
                    "scripts/installation/web_assets.py",
                    "tests/__init__.py",
                    "tests/installation/__init__.py",
                    "tests/installation/web_installation.py",
                    "Directory.Build.props",
                    "plugin.toml",
                    "version.txt",
                ):
                    target = root / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(ROOT / name, target)
                (root / "dist").mkdir()
                if mode == "frontend":
                    (root / "dist/web").mkdir()
                    for name in files:
                        (root / "dist/web" / name).write_text(name)
                else:
                    version = load_release().version
                    with zipfile.ZipFile(
                        root / "dist" / f"lyricbridge-web-{version}.zip", "w"
                    ) as archive:
                        for name in files:
                            archive.writestr(name, name)
                command = [sys.executable, "-m", "tests.installation.web_installation"]
                explicit = ["--assets", "dist/web"]
                result = subprocess.run(
                    command + (explicit if mode == "frontend" else []),
                    env={**os.environ, "JELLYFIN_PLUGIN_ROOT": str(root)},
                    cwd=root,
                    check=False,
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                # Neither caller may silently fall back to the other input type.
                rejected = subprocess.run(
                    command + ([] if mode == "frontend" else explicit),
                    env={**os.environ, "JELLYFIN_PLUGIN_ROOT": str(root)},
                    cwd=root,
                    check=False,
                    capture_output=True,
                    text=True,
                )
                self.assertNotEqual(0, rejected.returncode)


if __name__ == "__main__":
    unittest.main()
