"""Lyric-specific renderer, dictionary and inherited-source acceptance."""

import io
import tarfile
import zipfile
from pathlib import Path

from jellyfin_plugin_toolkit.acceptance import inventory
from jellyfin_plugin_toolkit.common.release_metadata import load_release

inventory()
repository = Path(__file__).resolve().parents[2]
root = repository / "dist"
version = load_release(repository).version
with zipfile.ZipFile(root / f"lyricbridge-{version}.zip") as archive:
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
with zipfile.ZipFile(root / f"lyricbridge-source-{version}.zip") as archive:
    for name in ("demo.html", "demo.wav"):
        assert archive.read("frontend/assets/" + name), (
            "Development demo missing from editable source"
        )
    for path in (repository / "frontend" / "renderer").rglob("*.ts"):
        if path.name.endswith(".test.ts"):
            continue
        relative = path.relative_to(repository).as_posix()
        assert b"This Source Code Form" in path.read_bytes(), (
            f"Missing renderer source notice: {relative}"
        )
        assert archive.read(relative) == path.read_bytes(), (
            f"Editable source differs from working build: {relative}"
        )
        assert b"https://mozilla.org/MPL/2.0/" in archive.read(relative), (
            f"Missing derived-source notice: {relative}"
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
