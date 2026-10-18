"""Source and artifact fingerprints shared by builds and CI evidence."""

import hashlib
import json
import re
from pathlib import Path

from scripts.common.source_inventory import source_files


def digest(root: Path, paths: list[Path], normalize_version: bool = False) -> str:
    value = hashlib.sha256()
    for path in sorted(paths):
        data = (root / path).read_bytes()
        # Only the authoritative release version is non-behavioral. ABI, identity,
        # build options and external dependency versions are never normalized.
        if normalize_version and str(path) == "Directory.Build.props":
            data = re.sub(
                rb"<LyricBridgeVersion>\d+\.\d+\.\d+</LyricBridgeVersion>",
                b"<LyricBridgeVersion>RELEASE</LyricBridgeVersion>",
                data,
            )
        if normalize_version and path.name == "packages.lock.json":
            lock = json.loads(data)
            match = re.search(
                r"<LyricBridgeVersion>(\d+\.\d+\.\d+)</LyricBridgeVersion>",
                (root / "Directory.Build.props").read_text(),
            )
            if not match:
                raise ValueError("Invalid authoritative version")
            for framework in lock["dependencies"].values():
                for dependency in framework.values():
                    if dependency.get("type") == "Project":
                        for name, requested in dependency.get(
                            "dependencies", {}
                        ).items():
                            if (
                                name
                                in {"LyricBridge.Core", "LyricBridge.Infrastructure"}
                                and requested == f"[{match[1]}, )"
                            ):
                                dependency["dependencies"][name] = "[RELEASE, )"
            data = json.dumps(lock, sort_keys=True).encode()
        value.update(str(path).encode() + b"\0" + data + b"\0")
    return value.hexdigest()


def artifact_hashes(root: Path) -> dict[str, str]:
    return {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted((root / "dist").iterdir())
        if p.suffix == ".zip" or p.name in {"manifest.json", "SHA256SUMS"}
    }


def web_inputs(root: Path) -> dict:
    return {
        "input": digest(
            root,
            [
                p
                for p in source_files(root)
                if str(p).startswith("frontend/")
                or str(p)
                in {
                    "Directory.Build.props",
                    "package.json",
                    "pnpm-lock.yaml",
                    "pnpm-workspace.yaml",
                    ".node-version",
                    ".python-version",
                }
            ],
        ),
        "files": {
            p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted((root / "dist/web").glob("*"))
            if p.is_file()
        },
    }


def verify_web(root: Path) -> None:
    if json.loads((root / "dist/web-build.json").read_text()) != web_inputs(root):
        raise ValueError("Prepared frontend inputs or asset hashes changed")
