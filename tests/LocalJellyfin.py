"""Local sandbox ownership and package replacement checks; no Docker daemon used."""

import http.client
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
spec = importlib.util.spec_from_file_location(
    "local_jellyfin", Path(__file__).resolve().parent.parent / "scripts/local-jellyfin.py"
)
assert spec is not None and spec.loader is not None
sandbox = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sandbox)


class LocalSandboxTests(unittest.TestCase):
    def test_media_mounts_are_read_only_same_path_and_retained(self) -> None:
        with tempfile.TemporaryDirectory(prefix="lyricbridge-media-mount-test-") as directory:
            root = Path(directory)
            media = root / "sample music"
            media.mkdir()
            data = root / "sandbox"
            with patch.object(sandbox, "DATA", data), patch.object(sandbox, "install"), patch.object(sandbox, "wait_ready"), patch.object(sandbox, "run") as run:
                sandbox.start(18096, True, [str(media), str(media)])
                expected = f"type=bind,src={media},dst={media},readonly"
                self.assertEqual(run.call_args.args.count(expected), 1)
                sandbox.start(18096, True)
                self.assertIn(expected, run.call_args.args)
                sandbox.start(18096, True, [])
                self.assertNotIn(expected, run.call_args.args)
                self.assertEqual(json.loads((data / "media-mounts.json").read_text()), [])

    def test_missing_media_mount_fails_before_stopping_or_building(self) -> None:
        with tempfile.TemporaryDirectory(prefix="lyricbridge-media-mount-test-") as directory:
            with patch.object(sandbox, "build") as build, patch.object(sandbox, "install") as install:
                with self.assertRaisesRegex(SystemExit, "directory not found"):
                    sandbox.start(18096, False, [str(Path(directory) / "missing")])
                build.assert_not_called()
                install.assert_not_called()

    def test_relative_media_mount_is_rejected(self) -> None:
        with self.assertRaisesRegex(SystemExit, "absolute directory"):
            sandbox.media_paths(["relative/path"])

    def test_startup_resets_and_closed_connections_are_retried(self) -> None:
        healthy = MagicMock()
        healthy.__enter__.return_value.status = 200
        with patch.object(sandbox.urllib.request, "urlopen", side_effect=[ConnectionResetError("starting"), http.client.RemoteDisconnected("starting"), TimeoutError("starting"), healthy]) as request, patch.object(sandbox.time, "sleep") as delay, patch("builtins.print"):
            sandbox.wait_ready(18096)
        self.assertEqual(request.call_count, 4)
        self.assertEqual(delay.call_count, 3)

    def test_unhealthy_response_waits_before_retry(self) -> None:
        unhealthy, healthy = MagicMock(), MagicMock()
        unhealthy.__enter__.return_value.status = 503
        healthy.__enter__.return_value.status = 200
        with patch.object(sandbox.urllib.request, "urlopen", side_effect=[unhealthy, healthy]), patch.object(sandbox.time, "sleep") as delay, patch("builtins.print"):
            sandbox.wait_ready(18096)
        delay.assert_called_once_with(1)

    def test_startup_failure_is_bounded_and_retains_container(self) -> None:
        with patch.object(sandbox.urllib.request, "urlopen", side_effect=ConnectionResetError("starting")) as request, patch.object(sandbox.time, "sleep"), patch.object(sandbox, "run") as run:
            with self.assertRaisesRegex(SystemExit, "Container retained"):
                sandbox.wait_ready(18096)
        self.assertEqual(request.call_count, 60)
        run.assert_not_called()

    def test_foreign_container_is_never_adopted(self) -> None:
        with patch.object(sandbox.subprocess, "check_output", side_effect=["container-id", json.dumps([{"Config": {"Labels": {}}}])]):
            with self.assertRaisesRegex(SystemExit, "another installation"):
                sandbox.inspect()

    def test_failed_daemon_query_is_not_an_absent_container(self) -> None:
        with patch.object(sandbox.subprocess, "check_output", side_effect=RuntimeError("daemon offline")):
            with self.assertRaisesRegex(RuntimeError, "daemon offline"):
                sandbox.inspect()

    def test_package_validation_precedes_container_removal(self) -> None:
        self.install_fixture(unsafe=True)

    def test_replacement_keeps_database_and_other_plugins(self) -> None:
        self.install_fixture(unsafe=False)

    def install_fixture(self, unsafe: bool) -> None:
        with tempfile.TemporaryDirectory(prefix="lyricbridge-local-helper-test-") as directory:
            root = Path(directory)
            data = root / "data"
            release = SimpleNamespace(version="0.1.1", jellyfin_version="0.1.1.0", guid="fixture-guid")
            plugins = data / "config/plugins"
            old = plugins / "LyricBridge_0.1.0.0"
            old.mkdir(parents=True)
            (old / "meta.json").write_text(json.dumps({"guid": release.guid}))
            database = data / "config/data/LyricBridge/test.db"
            database.parent.mkdir(parents=True)
            database.write_text("saved test data")
            other = plugins / "OtherPlugin"
            other.mkdir()
            (root / "dist").mkdir()
            with zipfile.ZipFile(root / "dist/lyricbridge-0.1.1.zip", "w") as archive:
                archive.writestr("meta.json", json.dumps({"guid": release.guid, "version": release.jellyfin_version}))
                archive.writestr("../escape" if unsafe else "plugin.dll", "fixture")
            with patch.object(sandbox, "REPOSITORY", root), patch.object(sandbox, "DATA", data), patch.object(sandbox, "load_release", return_value=release), patch.object(sandbox, "inspect", return_value={"owned": True}), patch.object(sandbox, "run") as run:
                if unsafe:
                    with self.assertRaisesRegex(SystemExit, "Unsafe archive"):
                        sandbox.install()
                    run.assert_not_called()
                    self.assertTrue(old.exists())
                else:
                    sandbox.install()
                    run.assert_called_once_with("docker", "rm", "-f", sandbox.CONTAINER)
                    self.assertFalse(old.exists())
                    self.assertTrue((plugins / "LyricBridge_0.1.1.0/plugin.dll").exists())
                self.assertTrue(other.exists())
                self.assertEqual(database.read_text(), "saved test data")


if __name__ == "__main__":
    unittest.main()
