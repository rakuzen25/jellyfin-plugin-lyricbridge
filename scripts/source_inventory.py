"""One editable-source inventory for archives, clean builds and CI fingerprints."""

import os
from pathlib import Path

ROOTS = ("src", "frontend", "vendor", "scripts", "tests", "browser-tests", ".github")
EXCLUDED = {"bin", "obj", ".git", "node_modules", "results", "__pycache__"}
CONFIGS = {
    "renovate.json",
    "LICENSE",
    "NOTICE",
    "Directory.Build.props",
    "release-please-config.json",
    ".release-please-manifest.json",
    "version.txt",
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "global.json",
    "knip.json",
    "eslint.config.mjs",
    ".prettierrc.json",
    ".prettierignore",
    "pyproject.toml",
    "requirements-check.txt",
    ".node-version",
    ".python-version",
    ".editorconfig",
    ".gitignore",
    ".dockerignore",
}


def source_files(root: Path) -> list[Path]:
    files = []
    for directory in ROOTS:
        # Prune before traversal: restored node_modules and build outputs can be
        # much larger than the source, even though none belongs in the archive.
        for current, directories, names in os.walk(root / directory):
            directories[:] = [
                name
                for name in directories
                if name not in EXCLUDED and not name.startswith("results-")
            ]
            for name in names:
                path = Path(current) / name
                if (
                    path.is_file()
                    and not name.startswith(("core.", ".env"))
                    and not name.endswith((".session.json", ".dmp"))
                ):
                    files.append(path.relative_to(root))
    files.extend(path.relative_to(root) for path in root.glob("*.md"))
    files.extend(Path(name) for name in CONFIGS if (root / name).is_file())
    return sorted(set(files))
