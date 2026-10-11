"""Deterministic release identity, public URLs, integrity and retry regressions."""

import copy
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import release
from release_metadata import changelog_for_version, load_release

ROOT = Path(__file__).resolve().parent.parent
REPOSITORY = "rakuzen25/jellyfin-plugin-lyricbridge"


class ReleaseTests(unittest.TestCase):
    def fixture(self, root: Path):
        for name in (
            "Directory.Build.props",
            "version.txt",
            "CHANGELOG.md",
            "src/packages.lock.json",
            "src/Infrastructure/packages.lock.json",
            "tests/packages.lock.json",
        ):
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)

    def artifacts(self, root: Path):
        directory = root / "dist"
        directory.mkdir()
        metadata = load_release(root)
        tag = "v" + metadata.version
        binary = f"lyricbridge-{metadata.version}.zip"
        for name in (
            binary,
            f"lyricbridge-web-{metadata.version}.zip",
            f"lyricbridge-source-{metadata.version}.zip",
        ):
            (directory / name).write_bytes(("synthetic fixture " + name).encode())
        catalog = [
            {
                "guid": metadata.guid,
                "versions": [
                    {
                        "version": metadata.jellyfin_version,
                        "targetAbi": metadata.abi,
                        "sourceUrl": f"https://github.com/{REPOSITORY}/releases/download/{tag}/{binary}",
                        "checksum": hashlib.md5(
                            (directory / binary).read_bytes()
                        ).hexdigest(),
                    }
                ],
            }
        ]
        (directory / "manifest.json").write_text(json.dumps(catalog))
        (directory / "SHA256SUMS").write_text(
            "\n".join(
                hashlib.sha256(p.read_bytes()).hexdigest() + "  " + p.name
                for p in sorted(directory.iterdir())
            )
            + "\n"
        )
        return directory, tag

    def test_identity_changelog_and_preparation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.fixture(root)
            tag = release.check_identity(root)
            env = root / "environment"
            release.prepare(root, REPOSITORY, tag, env)
            self.assertIn(
                "https://github.com/" + REPOSITORY + "/releases/download/" + tag,
                env.read_text(),
            )
            with self.assertRaisesRegex(ValueError, "tag"):
                release.check_identity(root, "v99.0.0")
            (root / "version.txt").write_text("99.0.0")
            with self.assertRaisesRegex(ValueError, "disagree"):
                release.check_identity(root)

    def test_changelog_extracts_only_matching_release_please_section(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "CHANGELOG.md").write_text(
                "# Changelog\n\n## [0.1.1](https://github.com/example/repo/compare/v0.1.0...v0.1.1) (2026-10-12)\n\n### Fixes\n\n* Current notes\n\n## 0.1.0\n\nOld notes\n"
            )
            self.assertEqual(
                changelog_for_version(root, "0.1.1"), "### Fixes\n\n* Current notes"
            )
            with self.assertRaisesRegex(ValueError, "Missing changelog"):
                changelog_for_version(root, "0.1.2")

    def test_stale_lock_metadata_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.fixture(root)
            lock = root / "src/packages.lock.json"
            lock.write_text(
                lock.read_text().replace(
                    "[" + load_release(root).version + ", )", "[99.0.0, )"
                )
            )
            with self.assertRaisesRegex(ValueError, "stale"):
                release.check_identity(root)

    def test_checksums_and_public_url_are_required(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.fixture(root)
            directory, tag = self.artifacts(root)
            release.artifact_hashes(root, directory, REPOSITORY, tag)
            with self.assertRaisesRegex(ValueError, "URL"):
                release.artifact_hashes(root, directory, "other/repository", tag)
            (directory / f"lyricbridge-{load_release(root).version}.zip").write_bytes(
                b"corruption"
            )
            with self.assertRaisesRegex(ValueError, "checksum"):
                release.artifact_hashes(root, directory, REPOSITORY, tag)

    def test_draft_upload_retries_without_overwriting(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.fixture(root)
            directory, tag = self.artifacts(root)
            hashes = release.artifact_hashes(root, directory, REPOSITORY, tag)
            draft = {
                "draft": True,
                "tag_name": tag,
                "assets": [{"name": name} for name in hashes],
            }

            def download(command, **kwargs):
                name = command[command.index("--pattern") + 1]
                target = Path(command[command.index("--dir") + 1]) / name
                shutil.copyfile(directory / name, target)
                return subprocess.CompletedProcess(command, 0)

            with (
                patch.object(
                    release,
                    "github_json",
                    side_effect=[
                        [draft],
                        {"object": {"type": "commit", "sha": "fixture"}},
                    ],
                ),
                patch.object(
                    release.subprocess, "check_output", return_value="fixture\n"
                ),
                patch.object(release.subprocess, "run", side_effect=download) as run,
            ):
                release.upload(root, directory, REPOSITORY, tag)
                self.assertTrue(
                    all(call.args[0][2] == "download" for call in run.call_args_list)
                )
            conflict = copy.deepcopy(draft)

            def corrupted_download(command, **kwargs):
                name = command[command.index("--pattern") + 1]
                (Path(command[command.index("--dir") + 1]) / name).write_bytes(
                    b"conflict"
                )
                return subprocess.CompletedProcess(command, 0)

            with (
                patch.object(
                    release,
                    "github_json",
                    side_effect=[
                        [conflict],
                        {"object": {"type": "commit", "sha": "fixture"}},
                    ],
                ),
                patch.object(
                    release.subprocess, "check_output", return_value="fixture\n"
                ),
                patch.object(release.subprocess, "run", side_effect=corrupted_download),
            ):
                with self.assertRaisesRegex(ValueError, "Conflicting"):
                    release.upload(root, directory, REPOSITORY, tag)

    def test_initial_upload_attaches_only_required_assets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.fixture(root)
            directory, tag = self.artifacts(root)
            with (
                patch.object(
                    release,
                    "github_json",
                    side_effect=[
                        [{"draft": True, "tag_name": tag}],
                        {"object": {"type": "commit", "sha": "tested"}},
                    ],
                ),
                patch.object(
                    release.subprocess, "check_output", return_value="tested\n"
                ),
                patch.object(release.subprocess, "run") as run,
            ):
                release.upload(root, directory, REPOSITORY, tag)
                command = run.call_args.args[0]
                self.assertEqual(command[:4], ["gh", "release", "upload", tag])
                self.assertNotIn("--clobber", command)
                self.assertNotIn("--draft=false", command)
                self.assertEqual(len(command[4:-2]), 5)

    def test_missing_release_date_fails_before_packaging(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "CHANGELOG.md").write_text("## 0.1.0\n\nUndated notes\n")
            with self.assertRaisesRegex(ValueError, "release date"):
                changelog_for_version(root, "0.1.0")

    def test_published_release_and_moved_tag_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.fixture(root)
            directory, tag = self.artifacts(root)
            with patch.object(
                release, "github_json", return_value=[{"draft": False, "tag_name": tag}]
            ):
                with self.assertRaisesRegex(ValueError, "draft"):
                    release.upload(root, directory, REPOSITORY, tag)
            with (
                patch.object(
                    release,
                    "github_json",
                    side_effect=[
                        [{"draft": True, "tag_name": tag}],
                        {"object": {"type": "commit", "sha": "changed"}},
                    ],
                ),
                patch.object(
                    release.subprocess, "check_output", return_value="tested\n"
                ),
            ):
                with self.assertRaisesRegex(ValueError, "moved"):
                    release.upload(root, directory, REPOSITORY, tag)


if __name__ == "__main__":
    unittest.main()
