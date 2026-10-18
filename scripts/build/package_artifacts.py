"""Assemble artifacts only from a clean publish directory and explicit source roots."""

import argparse
import hashlib
import json
import os
from pathlib import Path
from scripts.common.release_metadata import load_release
from scripts.common.source_inventory import source_files
import shutil
from urllib.parse import urlparse
import xml.etree.ElementTree as ET
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("staging", type=Path)
parser.add_argument("--release", action="store_true")
args = parser.parse_args()
release = load_release()
version = release.version
abi = release.abi
repository = os.environ.get("LYRICBRIDGE_REPOSITORY_URL", "")
download = os.environ.get("LYRICBRIDGE_DOWNLOAD_BASE_URL", "http://127.0.0.1:18098")
if args.release:
    for value in (repository, download):
        parsed = urlparse(value)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            parser.error(
                "Release artifacts require HTTPS LYRICBRIDGE_REPOSITORY_URL and LYRICBRIDGE_DOWNLOAD_BASE_URL without embedded credentials, query strings or fragments."
            )
plugin = args.staging / "plugin"
# Host-owned libraries must never be copied into the plugin's load context.
for binary in plugin.glob("*.dll"):
    if binary.name.startswith(
        (
            "MediaBrowser.",
            "Jellyfin.Api",
            "Jellyfin.Data",
            "Jellyfin.Database.",
            "Jellyfin.Extensions",
            "Microsoft.AspNetCore.",
            "Microsoft.Data.Sqlite",
            "SQLitePCLRaw.",
        )
    ):
        binary.unlink()
notices = plugin / "notices"
notices.mkdir()
for source in Path("vendor").glob("*LICENSE*"):
    shutil.copy2(source, notices / source.name)
for name in (
    "LIBNMECAB-SOURCE.tar.gz",
    "DOTNET-THIRD-PARTY-NOTICES",
    "LYRICMOTION-THIRD-PARTY-NOTICES.md",
    "OPENCC-THIRD-PARTY-NOTICES.md",
):
    shutil.copy2(Path("vendor") / name, notices / name)
for name in ("LICENSE", "NOTICE"):
    shutil.copy2(name, notices / name)
shutil.copy2(plugin / "KawazuDictionary/COPYING", notices / "IPADIC-COPYING")
dependencies = json.loads(Path("src/Host/packages.lock.json").read_text())[
    "dependencies"
]["net10.0"]
binary_licenses = {
    "Jellyfin.Plugin.LyricBridge.dll": (
        None,
        [
            "LICENSE",
            "LYRICMOTION-LICENSE",
            "LUCIDE-LICENSE",
            "QMC-LICENSE",
            "DYNAMIC-BACKGROUND-LICENSE",
            "KAWARP-LICENSE",
            "LYRICMOTION-THIRD-PARTY-NOTICES.md",
        ],
    ),
    "LyricBridge.Core.dll": (None, ["LICENSE"]),
    "LyricBridge.Infrastructure.dll": (None, ["LICENSE"]),
    "Lyricify.Lyrics.Helper.dll": (None, ["LYRICIFY-LICENSE"]),
    "Kawazu.dll": ("Kawazu", ["KAWAZU-LICENSE"]),
    "LibNMeCab.dll": (
        "LibNMeCab",
        ["LIBNMECAB-LICENSE", "LIBNMECAB-LGPL-LICENSE", "LIBNMECAB-SOURCE.tar.gz"],
    ),
    "LibNMeCab.IpaDicBin.dll": (
        "LibNMeCab.IpaDicBin",
        [
            "LIBNMECAB-LICENSE",
            "LIBNMECAB-LGPL-LICENSE",
            "IPADIC-COPYING",
            "LIBNMECAB-SOURCE.tar.gz",
        ],
    ),
    "Newtonsoft.Json.dll": ("Newtonsoft.Json", ["NEWTONSOFT-LICENSE"]),
    "ICSharpCode.SharpZipLib.dll": ("SharpZipLib", ["SHARPZIPLIB-LICENSE"]),
    "OpenccNetLib.dll": (
        "OpenccNetLib",
        ["OPENCC-LICENSE", "OPENCC-DATA-LICENSE", "OPENCC-THIRD-PARTY-NOTICES.md"],
    ),
    "ZstdSharp.dll": ("ZstdSharp.Port", ["ZSTDSHARP-LICENSE"]),
}
inventory = []
for path in sorted(plugin.rglob("*")):
    if not path.is_file():
        continue
    relative = path.relative_to(plugin).as_posix()
    if path.suffix == ".dll":
        if path.name not in binary_licenses:
            raise SystemExit(
                f"No license inventory entry for shipped binary: {relative}"
            )
        package, licenses = binary_licenses[path.name]
    elif relative.startswith("KawazuDictionary/"):
        package, licenses = "LibNMeCab.IpaDicBin", ["IPADIC-COPYING"]
    else:
        continue
    for notice in licenses:
        if not (notices / notice).is_file():
            raise SystemExit(f"Missing required notice: {notice}")
    inventory.append(
        {
            "file": relative,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "package": package or "project-source",
            "version": dependencies[package]["resolved"]
            if package
            else (
                ET.parse("vendor/Lyricify.Lyrics.Helper/Lyricify.Lyrics.Helper.csproj")
                .getroot()
                .findtext(".//Version")
                if path.name == "Lyricify.Lyrics.Helper.dll"
                else version
            ),
            "notices": ["notices/" + notice for notice in licenses],
        }
    )
(plugin / "dependency-inventory.json").write_text(
    json.dumps({"files": inventory}, indent=2) + "\n"
)
(plugin / "build-info.json").write_text(
    json.dumps(
        {
            "version": version,
            "targetAbi": abi,
            "repositoryUrl": repository,
            "editableSourceArchive": f"lyricbridge-source-{version}.zip",
        },
        indent=2,
    )
    + "\n"
)
(plugin / "meta.json").write_text(
    json.dumps(
        {
            "guid": release.guid,
            "name": release.name,
            "description": release.description,
            "version": release.jellyfin_version,
            "targetAbi": abi,
            "status": "Active",
            "autoUpdate": False,
            "assemblies": [p.name for p in sorted(plugin.glob("*.dll"))],
        },
        indent=2,
    )
    + "\n"
)
out = Path("dist")
out.mkdir(exist_ok=True)


def archive(name, files):
    target = out / name
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        for source, relative in sorted(files, key=lambda pair: str(pair[1])):
            info = zipfile.ZipInfo(str(relative), (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = (
                0o755 if source.stat().st_mode & 0o111 else 0o644
            ) << 16
            z.writestr(info, source.read_bytes())
    return target


binary = archive(
    f"lyricbridge-{version}.zip",
    [(p, p.relative_to(plugin)) for p in plugin.rglob("*") if p.is_file()],
)
web = archive(
    f"lyricbridge-web-{version}.zip",
    [
        (p, p.relative_to("dist/web"))
        for p in Path("dist/web").glob("*")
        if p.is_file() and p.name not in {"NOTICE.txt", "demo.html", "demo.wav"}
    ]
    + [
        (Path("NOTICE"), Path("NOTICE.txt")),
        (
            Path("vendor/DYNAMIC-BACKGROUND-LICENSE"),
            Path("DYNAMIC-BACKGROUND-LICENSE.txt"),
        ),
        (
            Path("vendor/LYRICMOTION-THIRD-PARTY-NOTICES.md"),
            Path("THIRD_PARTY_NOTICES.md"),
        ),
        (Path("vendor/LYRICMOTION-LICENSE"), Path("LICENSE")),
        (Path("vendor/KAWARP-LICENSE"), Path("KAWARP-LICENSE.txt")),
        (Path("vendor/QMC-LICENSE"), Path("QMC-LICENSE.txt")),
    ],
)
sources = [(path, path) for path in source_files(Path("."))]
source = archive(f"lyricbridge-source-{version}.zip", sources)
manifest = [
    {
        "guid": release.guid,
        "name": release.name,
        "owner": release.owner,
        "overview": release.overview,
        "description": release.description,
        "category": release.category,
        "versions": [
            {
                "version": release.jellyfin_version,
                "changelog": release.changelog,
                "targetAbi": abi,
                "sourceUrl": download.rstrip("/") + "/" + binary.name,
                "checksum": hashlib.md5(binary.read_bytes()).hexdigest(),
                "timestamp": release.timestamp,
            }
        ],
    }
]
(out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
(out / "SHA256SUMS").write_text(
    "".join(
        hashlib.sha256(p.read_bytes()).hexdigest() + "  " + p.name + "\n"
        for p in (binary, web, source, out / "manifest.json")
    )
)
print("Built " + ", ".join(p.name for p in (binary, web, source)))
