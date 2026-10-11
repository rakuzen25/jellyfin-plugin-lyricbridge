"""Concrete source/release boundary checks; no provider or running-server calls."""

import os
import subprocess
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
core = "\n".join(p.read_text() for p in (root / "src/Core").glob("*.cs"))
infra = "\n".join(p.read_text() for p in (root / "src/Infrastructure").glob("*.cs"))
for token in ("Plugin.Instance", "Microsoft.Data.Sqlite", "MediaBrowser.", "Jellyfin."):
    assert token not in core, "Core boundary violation: " + token
assert "Plugin.Instance" not in infra, "Infrastructure configuration must be injected"
controller = (root / "src/Api.cs").read_text()
for token in ("store.Get<", "store.Set(", '"selected"', '"previous"', '"variants"'):
    assert token not in controller, (
        "Controller contains generic persistence workflow: " + token
    )
assert (
    "installLyricTransport" not in (root / "frontend/renderer/runtime.ts").read_text()
)
assert not list((root / "dist" / "web").glob("*.ts")), (
    "Generated assets must preserve the distributed JavaScript filenames"
)
with tempfile.TemporaryDirectory(prefix="lyricbridge-invalid-manifest-") as directory:
    for repository, download in (
        ("http://example.invalid", "https://example.invalid"),
        ("https://example.invalid", "https://example.invalid/path?token=synthetic"),
        ("https://user:synthetic@example.invalid", "https://example.invalid"),
    ):
        environment = dict(
            os.environ,
            LYRICBRIDGE_REPOSITORY_URL=repository,
            LYRICBRIDGE_DOWNLOAD_BASE_URL=download,
        )
        result = subprocess.run(
            ["python3", "scripts/package-artifacts.py", directory, "--release"],
            cwd=root,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 2 and "require HTTPS" in result.stderr, (
            "Unsafe release URL was accepted"
        )
        assert "synthetic" not in result.stderr, (
            "Manifest validation exposed a credential"
        )
print(
    "PASS: Core/Infrastructure/controller boundaries, one transport owner, public asset filenames and sanitized release URL validation."
)
