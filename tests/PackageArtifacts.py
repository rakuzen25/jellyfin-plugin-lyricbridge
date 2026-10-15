"""Validate built archives without loading code or contacting external services."""

import hashlib
import io
import json
import sys
import tarfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from release_metadata import load_release

repository = Path(__file__).resolve().parent.parent
root = repository / "dist"
release = load_release(repository)
version = release.version

for line in (root / "SHA256SUMS").read_text().splitlines():
    digest, name = line.split("  ", 1)
    assert Path(name).name == name, "Unexpected checksum path"
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest, name
with zipfile.ZipFile(root / f"lyricbridge-{version}.zip") as archive:
    metadata = json.loads(archive.read("meta.json"))
    assert (metadata["guid"], metadata["version"], metadata["targetAbi"]) == (
        release.guid,
        release.jellyfin_version,
        release.abi,
    )
    manifest = json.loads((root / "manifest.json").read_text())
    assert manifest[0]["guid"] == release.guid
    assert manifest[0]["versions"][0]["version"] == release.jellyfin_version
    assert manifest[0]["versions"][0]["targetAbi"] == release.abi
    inventory = json.loads(archive.read("dependency-inventory.json"))["files"]
    assert {name for name in archive.namelist() if name.endswith(".dll")} <= {
        entry["file"] for entry in inventory
    }
    for entry in inventory:
        assert (
            hashlib.sha256(archive.read(entry["file"])).hexdigest() == entry["sha256"]
        ), entry["file"]
        for notice in entry["notices"]:
            assert archive.read(notice), notice
    with tarfile.open(
        fileobj=io.BytesIO(archive.read("notices/LIBNMECAB-SOURCE.tar.gz")), mode="r:gz"
    ) as source:
        names = source.getnames()
        assert any(name.endswith(".csproj") for name in names), (
            "Missing LibNMeCab build source"
        )
        assert any(name.endswith("/LGPL") for name in names), (
            "Missing upstream LGPL terms"
        )
        assert any(name.endswith("/dic/ipadic/COPYING") for name in names), (
            "Missing dictionary redistribution terms"
        )
    assert (
        archive.read("notices/OPENCC-THIRD-PARTY-NOTICES.md")
        == (repository / "vendor/OPENCC-THIRD-PARTY-NOTICES.md").read_bytes()
    ), "Missing pinned OpenCC attribution"
    assert not any(
        name.startswith(
            ("MediaBrowser.", "Microsoft.Data.Sqlite", "SQLitePCLRaw.", "Jellyfin.Api.")
        )
        for name in archive.namelist()
    )
    print(
        f"PASS: {len(inventory)} binary/dictionary inventory entries, hashes and notices."
    )
with zipfile.ZipFile(root / f"lyricbridge-source-{version}.zip") as archive:
    for name in ("demo.html", "demo.wav"):
        assert archive.read("frontend/assets/" + name), (
            "Development demo missing from editable source"
        )
    assert archive.getinfo("scripts/package.sh").external_attr >> 16 & 0o111
    assert ".github/workflows/validate.yml" in archive.namelist()
    for name in (
        "package.json",
        "pnpm-workspace.yaml",
        "pnpm-lock.yaml",
        "pyproject.toml",
        "requirements-check.txt",
        "eslint.config.mjs",
        ".prettierrc.json",
        ".prettierignore",
        "knip.json",
        "release-please-config.json",
        ".release-please-manifest.json",
        "version.txt",
        ".python-version",
        "docs/RELEASING.md",
        "scripts/release.py",
    ):
        assert archive.read(name) == (repository / name).read_bytes(), (
            f"Missing or stale validation/workspace input: {name}"
        )
    assert not any(name.endswith("package-lock.json") for name in archive.namelist()), (
        "Obsolete npm lockfile packaged"
    )
    assert "frontend/bridge/transport.ts" in archive.namelist()
    assert "frontend/admin/config.ts" in archive.namelist()
    assert "docs/ARCHITECTURE.md" in archive.namelist()
    for path in (repository / "frontend" / "renderer").glob("*.ts"):
        if path.name.endswith(".test.ts"):
            continue
        relative = path.relative_to(repository).as_posix()
        assert archive.read(relative) == path.read_bytes(), (
            f"Editable source differs from working build: {relative}"
        )
        assert b"https://mozilla.org/MPL/2.0/" in archive.read(relative), (
            f"Missing derived-source notice: {relative}"
        )
    for name in (
        "frontend/renderer.ts",
        "frontend/build.mjs",
        "frontend/package.json",
        "frontend/tsconfig.json",
    ):
        assert archive.read(name) == (repository / name).read_bytes(), (
            f"Missing or stale source/build input: {name}"
        )
    for path in (repository / "frontend").rglob("*.ts"):
        if "node_modules" in path.parts:
            continue
        relative = path.relative_to(repository).as_posix()
        assert archive.read(relative) == path.read_bytes(), (
            f"Missing or stale editable application source: {relative}"
        )
    assert not any(
        name in archive.namelist()
        for name in ("frontend/bridge.js", "frontend/renderer.js")
    ), "Unchecked legacy application source retained"
    assert not any(
        "/node_modules/" in name or "/obj/" in name for name in archive.namelist()
    )
    assert not any(
        name.startswith("browser-tests/results") for name in archive.namelist()
    ), "Generated browser diagnostics shipped as source"
    print(
        "PASS: executable source scripts, typed modules and CI included; build caches excluded."
    )
with zipfile.ZipFile(root / f"lyricbridge-web-{version}.zip") as archive:
    assert not {"demo.html", "demo.wav"}.intersection(archive.namelist()), (
        "Development demos shipped in web release"
    )
    assert len(archive.namelist()) == len(set(archive.namelist())), (
        "Duplicate web archive paths"
    )
    for name in ("lyricbridge.js", "jellyfin-lyric-motion.js", "config.html"):
        assert (
            archive.read(name) == (repository / "dist" / "web" / name).read_bytes()
        ), "Browser-tested asset differs from archive: " + name
    for notice in (
        "LICENSE",
        "NOTICE.txt",
        "KAWARP-LICENSE.txt",
        "DYNAMIC-BACKGROUND-LICENSE.txt",
        "THIRD_PARTY_NOTICES.md",
    ):
        assert archive.read(notice), notice
    print("PASS: pinned renderer and background notices in web archive.")
print("PASS: artifact checksums.")
