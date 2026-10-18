"""Shared locked backend compilation; development never assembles release archives."""

import os
import shutil
from pathlib import Path

from scripts.common.process import ROOT, executable, run
from scripts.dev.references import ensure

HOST_LIBRARIES = (
    "MediaBrowser.",
    "Jellyfin.Api",
    "Jellyfin.Data",
    "Jellyfin.Database.",
    "Jellyfin.Extensions",
    "Microsoft.AspNetCore.",
    "Microsoft.Data.Sqlite",
    "SQLitePCLRaw.",
)


def publish(
    output: Path,
    web: Path,
    *,
    configuration: str = "Release",
    root: Path = ROOT,
    references: Path | None = None,
) -> None:
    if not (web / "config.html").is_file():
        raise ValueError("Frontend assets are missing; run pnpm build frontend first")
    references = references or ensure()
    if output.exists():
        shutil.rmtree(output)
    project = str(root / "src/Host/LyricBridge.csproj")
    properties = [
        "-p:JellyfinReferenceDir=" + str(references),
        "-p:LyricBridgeWebAssets=" + str(web),
    ]
    run(
        executable("dotnet"),
        "restore",
        project,
        "--locked-mode",
        "--nologo",
        "-m:1",
        "-p:NuGetAuditMode=all",
        "-p:WarningsAsErrors=NU1900",
        *properties,
        cwd=root,
    )
    run(
        executable("dotnet"),
        "publish",
        project,
        "--no-restore",
        "-c",
        configuration,
        "-o",
        str(output),
        "--nologo",
        "-m:1",
        "-p:UseSharedCompilation=false",
        *properties,
        cwd=root,
    )
    for binary in output.glob("*.dll"):
        if binary.name.startswith(HOST_LIBRARIES):
            binary.unlink()


def reference_directory() -> Path:
    return Path(
        os.environ.get("LYRICBRIDGE_REFERENCE_DIR", ROOT / ".build/jellyfin")
    ).resolve()


def maintained_csharp(pattern: str) -> list[Path]:
    return sorted(
        p
        for directory in ("src", "tests")
        for p in (ROOT / directory).rglob(pattern)
        if not {"bin", "obj"}.intersection(p.relative_to(ROOT).parts)
    )


def prepare() -> None:
    ensure()
    for project in maintained_csharp("*.csproj"):
        run(
            executable("dotnet"),
            "restore",
            str(project),
            "--locked-mode",
            "-m:1",
            "-p:NuGetAudit=false",
        )


if __name__ == "__main__":
    prepare()
