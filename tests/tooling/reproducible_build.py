"""Compare a clean candidate with one independent clean build (two builds total).

Requires the pinned SDK, pnpm, cached/available package feeds, and official references.
Uses no running server, account, media directory, or lyric provider.
"""

import hashlib
import json
import os
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from scripts.ci.policy import digest
from scripts.common.source_inventory import source_files

repository = Path(__file__).resolve().parents[2]
version = (
    ET.parse(repository / "Directory.Build.props")
    .getroot()
    .findtext(".//LyricBridgeVersion")
)
source = repository / "dist" / f"lyricbridge-source-{version}.zip"
reference = Path(
    os.environ.get("LYRICBRIDGE_REFERENCE_DIR", repository / ".build/jellyfin")
).resolve()
if not source.is_file():
    raise SystemExit("Build the source archive first.")
if not (reference / "MediaBrowser.Common.dll").is_file():
    raise SystemExit("Set LYRICBRIDGE_REFERENCE_DIR to verified official references.")
environment = dict(os.environ)
environment["LYRICBRIDGE_REFERENCE_ARG"] = "-p:JellyfinReferenceDir=" + str(reference)
environment["NUGET_PACKAGES"] = str(
    Path(os.environ.get("NUGET_PACKAGES", Path.home() / ".nuget/packages")).resolve()
)
candidate = {
    path.name: hashlib.sha256(path.read_bytes()).hexdigest()
    for path in (repository / "dist").iterdir()
    if path.suffix == ".zip" or path.name in ("manifest.json", "SHA256SUMS")
}
proof = json.loads((repository / "dist/clean-build.json").read_text())
if proof != {
    "source": digest(repository, source_files(repository)),
    "artifacts": candidate,
}:
    raise SystemExit(
        "Candidate is not the current verified clean build; run scripts/build/clean_package.py first."
    )
environment.pop("LYRICBRIDGE_PREPARED_WEB", None)
results = []
with tempfile.TemporaryDirectory(prefix="lyricbridge-repro-") as directory:
    for name in ("comparison",):
        root = Path(directory) / name
        root.mkdir()
        with zipfile.ZipFile(source) as archive:
            archive.extractall(root)
            for info in archive.infolist():
                if not info.is_dir():
                    (root / info.filename).chmod(
                        (info.external_attr >> 16) & 0o777 or 0o644
                    )
        log = repository / "dist" / f"reproducibility-{name}.log"
        with log.open("w") as output:
            subprocess.run(
                ["sh", "scripts/build/package.sh"],
                cwd=root,
                env=environment,
                stdout=output,
                stderr=subprocess.STDOUT,
                check=True,
            )
        results.append(
            {
                path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                for path in (root / "dist").iterdir()
                if path.suffix == ".zip" or path.name in ("manifest.json", "SHA256SUMS")
            }
        )
        print("Built clean source root " + name, flush=True)
    if results[0] != candidate:
        different = sorted(
            name
            for name in results[0].keys() | candidate.keys()
            if results[0].get(name) != candidate.get(name)
        )
        raise SystemExit(
            "Independent clean build differs from candidate: " + ", ".join(different)
        )
    print(
        "PASS: two independent clean builds match: candidate and comparison archives, catalog and checksums."
    )
