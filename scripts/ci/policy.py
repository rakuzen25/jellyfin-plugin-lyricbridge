"""Local input classification, fingerprints and artifact inventories."""

import json
import re
import subprocess
from pathlib import Path

from scripts.common.artifacts import digest
from scripts.common.source_inventory import source_files

GROUPS = (
    "metadata",
    "frontend",
    "backend",
    "tooling",
    "workflow",
    "rendering",
    "performance",
    "artifacts",
)


CODE = GROUPS[:-1]


RUNTIME = tuple(group for group in CODE if group != "metadata")


SCHEMA = 3


POLICY = (
    "scripts/ci/__main__.py",
    "scripts/ci/policy.py",
    "scripts/ci/evidence.py",
    "scripts/ci/planning.py",
    "scripts/common/source_inventory.py",
    "scripts/common/artifacts.py",
    "scripts/common/images.json",
    "scripts/common/process.py",
    "scripts/__main__.py",
    "scripts/tasks.py",
    "scripts/checks/architecture.py",
    "tests/browser/groups.json",
)


GROUP_JOB_NAMES = {
    group: {group} for group in CODE if group not in {"rendering", "performance"}
} | {
    "rendering": {
        f"rendering ({engine})"
        for engine in ("chromium", "mobile-chromium", "firefox", "webkit")
    },
    "performance": {
        f"performance ({engine})"
        for engine in ("stress-chromium", "stress-mobile-chromium")
    },
}


def git(root: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def metadata_path(path: str) -> bool:
    return (
        path == "renovate.json"
        or path == ".github/CODEOWNERS"
        or path.startswith(
            (
                ".github/ISSUE_TEMPLATE/",
                ".github/PULL_REQUEST_TEMPLATE/",
                ".github/PULL_REQUEST_TEMPLATE.",
                ".github/pull_request_template.",
            )
        )
    )


def classification(path: str, root: Path | None = None) -> tuple[str, set[str]]:
    if metadata_path(path):
        return "automation-metadata", {"metadata"}
    groups = known_impacts(path, root)
    rule = "documentation" if not groups else "maintained-" + path.split("/")[0]
    return rule, groups


def impacts(path: str, root: Path | None = None) -> set[str]:
    return classification(path, root)[1]


def known_impacts(path: str, root: Path | None = None) -> set[str]:
    all_groups = set(GROUPS)
    if path.startswith("scripts/ci/") or path in {
        "scripts/__main__.py",
        "scripts/tasks.py",
        "scripts/common/process.py",
        "scripts/common/artifacts.py",
        "scripts/common/images.json",
        "scripts/__init__.py",
        "scripts/common/__init__.py",
    }:
        return all_groups
    # Deleted paths remain inputs to cumulative comparisons across this reorganization.
    if path.startswith("browser-tests/") or path in {
        "scripts/ci.py",
        "scripts/ci_policy.py",
        "scripts/ci_evidence.py",
        "scripts/ci_planning.py",
        "scripts/source_inventory.py",
    }:
        return all_groups
    # Classify retired paths while cumulative comparisons still include their deletion.
    if path.startswith("catalog-repository/"):
        return set() if path.endswith(".md") else {"tooling", "artifacts"}
    if path.endswith(".md") or path in {
        "LICENSE",
        "NOTICE",
    }:
        return {"tooling", "artifacts"} if path in {"LICENSE", "NOTICE"} else set()
    if path == ".editorconfig":
        return {"frontend", "backend"}
    if path in {".gitignore", ".dockerignore"}:
        return {"tooling", "artifacts"}
    if path in {"version.txt", ".release-please-manifest.json"}:
        return {"artifacts"}
    if path == "Directory.Build.props":
        return {"backend", "frontend", "tooling", "workflow", "rendering", "artifacts"}
    if (
        path == ".github/actionlint.yaml"
        or path.startswith((".github/workflows/", ".github/actions/"))
        or path in POLICY
    ):
        return all_groups
    if path.startswith("scripts/dev/") and path.endswith(".mjs"):
        return {"frontend", "backend", "tooling", "workflow", "artifacts"}
    if path.startswith(("frontend/renderer", "frontend/assets/")):
        return {"frontend", "rendering", "performance", "artifacts"}
    if path.startswith("frontend/bridge/"):
        name = Path(path).name.removesuffix(".test.ts").removesuffix(".ts")
        if path.removesuffix(".test.ts").removesuffix(
            ".ts"
        ) == "frontend/bridge/transcription/state" or name in {
            "preferences",
            "generation-state",
            "search-session",
            "search-models",
            "source-usage",
            "transcription-state",
        }:
            return {"frontend", "workflow", "artifacts"}
        if name in {
            "controls",
            "display-panel",
            "search-panel",
            "version-panel",
            "version-rows",
        }:
            return {"frontend", "workflow", "rendering", "artifacts"}
        return {"frontend", "workflow", "rendering", "performance", "artifacts"}
    if path in {
        "frontend/build.mjs",
        "frontend/check-boundaries.mjs",
        "frontend/contract-boundaries.mjs",
        "frontend/package.json",
    }:
        return {
            "frontend",
            "tooling",
            "workflow",
            "rendering",
            "performance",
            "artifacts",
        }
    if path.startswith("frontend/"):
        return {"frontend", "workflow", "rendering", "performance", "artifacts"}
    if path in {
        "tests/tooling/renderer-contract.test.mjs",
        "tests/tooling/typescript-toolchain.test.mjs",
    }:
        return {"frontend", "tooling", "artifacts"}
    if path.startswith("tests/browser/"):
        if path.endswith(".spec.cjs"):
            groups = json.loads(
                (
                    (root or Path(__file__).resolve().parents[2])
                    / "tests/browser/groups.json"
                ).read_text()
            )
            matches = {
                name
                for name, files in groups.items()
                if path.removeprefix("tests/browser/") in files
            }
            return (
                (matches | ({"rendering"} if "workflow" in matches else set()))
                if len(matches) == 1
                else all_groups
            )
        return {"frontend", "workflow", "rendering", "performance"}
    if (
        path.startswith(("src/", "vendor/"))
        or path.startswith("tests/")
        and path.endswith((".cs", ".csproj", "lock.json"))
    ):
        result = {"backend", "tooling", "artifacts"}
        if (
            path.startswith("src/Core/")
            or path
            in {
                "src/Host/Api/Api.cs",
                "src/Host/Transcription/TranscriptionApi.cs",
                "src/Host/Transcription/AudioPreparation.cs",
                "src/Infrastructure/Transcription/TranscriptionTasks.cs",
                "src/Infrastructure/Transcription/TranscriptionProvider.cs",
                "src/Infrastructure/Storage/Store.Jobs.cs",
                "src/Infrastructure/Storage/Store.Generation.cs",
                "src/Infrastructure/Maintenance/TransientMaintenance.cs",
                "src/LyricPayload.cs",
            }
            or "Service.cs" in path
        ):
            result |= {"workflow", "rendering"}
        return result
    if (
        path.startswith("scripts/")
        or path.startswith("tests/")
        and path.endswith((".py", ".sh"))
    ):
        if path.endswith(
            (
                "test-browser.sh",
                "check-browser-image.mjs",
                "check-browser-image.test.mjs",
            )
        ):
            return {"frontend", "workflow", "rendering", "performance"}
        if path.endswith(
            (
                "check-toolchain.mjs",
                "check-toolchain.test.mjs",
                "renovate-policy.test.mjs",
            )
        ):
            return {"metadata", "frontend", "tooling", "artifacts"}
        if path.endswith(
            (
                "references.py",
                "backend.py",
                "bootstrap-references.sh",
                "reference_cache.py",
                "reference-cache.py",
                "format-dotnet.sh",
            )
        ):
            return {"backend", "tooling", "artifacts"}
        return {"tooling", "artifacts"}
    if path in {"pyproject.toml", "requirements-check.txt", ".python-version"}:
        return {"tooling", "artifacts"}
    if path in {"global.json"}:
        return {"backend", "artifacts"}
    if path == "release-please-config.json":
        return {"tooling", "artifacts"}
    if path.startswith("tests/"):
        return {"tooling", "artifacts"}
    if path in {
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        ".node-version",
    }:
        return {
            "metadata",
            "frontend",
            "tooling",
            "workflow",
            "rendering",
            "performance",
            "artifacts",
        }
    if path in {
        "knip.json",
        "eslint.config.mjs",
        ".prettierrc.json",
        ".prettierignore",
    }:
        return (
            {"metadata", "frontend", "tooling"}
            if path in {".prettierrc.json", ".prettierignore"}
            else {"frontend", "tooling"}
        )
    raise ValueError(
        "Unclassified CI input: "
        + path
        + ". Add an explicit classification rule before validation can pass."
    )


def tracked_files(root: Path) -> list[str]:
    if not (root / ".git").exists():
        return [str(p) for p in source_files(root)]
    return (
        subprocess.check_output(["git", "-C", str(root), "ls-files", "-z"], text=True)
        .rstrip("\0")
        .split("\0")
    )


def check_classification(root: Path, changed: list[str]) -> list[dict]:
    unknown = []
    for path in sorted(set(tracked_files(root)) | set(changed)):
        try:
            classification(path, root)
        except ValueError:
            unknown.append(path)
    if unknown:
        raise ValueError(
            "Unclassified CI inputs (add explicit rules):\n" + "\n".join(unknown)
        )
    return [
        {
            "path": p,
            "rule": classification(p, root)[0],
            "groups": sorted(impacts(p, root)),
        }
        for p in changed
    ]


def browser_inventory(root: Path) -> None:
    groups = json.loads((root / "tests/browser/groups.json").read_text())
    entries = [file for files in groups.values() for file in files]
    actual = {
        path.relative_to(root / "tests/browser").as_posix()
        for path in (root / "tests/browser").rglob("*.spec.cjs")
        if not any(
            part.startswith("results") or part == "node_modules" for part in path.parts
        )
    }
    if (
        set(groups) != {"workflow", "rendering", "performance"}
        or len(entries) != len(set(entries))
        or set(entries) != actual
    ):
        raise ValueError("Every browser spec must belong to exactly one known group")


def fingerprints(root: Path) -> dict[str, str]:
    files = source_files(root)
    shared = {Path(p) for p in POLICY} | {
        p
        for p in files
        if str(p).startswith((".github/workflows/", ".github/actions/"))
    }
    shared |= {
        Path(p)
        for p in (
            ".node-version",
            ".python-version",
            "global.json",
            "pnpm-lock.yaml",
            "requirements-check.txt",
            "Directory.Build.props",
            "scripts/tasks.py",
            "scripts/dev/references.py",
            "scripts/common/images.json",
        )
    }
    metadata_shared = {
        Path(p)
        for p in (
            ".node-version",
            ".python-version",
            "pnpm-lock.yaml",
            "package.json",
            ".prettierrc.json",
            ".prettierignore",
        )
    }
    classified = {path: impacts(str(path), root) for path in files}
    return {
        group: digest(
            root,
            [
                p
                for p in files
                if group == "artifacts"
                or (group != "metadata" and p in shared)
                or (group == "metadata" and p in metadata_shared)
                or group in classified[p]
            ],
            group != "artifacts",
        )
        for group in GROUPS
    }


def metadata_check(root: Path) -> None:
    paths = [
        p for p in tracked_files(root) if metadata_path(p) and (root / p).is_file()
    ]
    for path in paths:
        text = (root / path).read_text()
        if path.endswith(".json"):
            value = json.loads(text)
            if not isinstance(value, dict):
                raise ValueError(path + ": expected a JSON object")
        if path == ".github/CODEOWNERS":
            import fnmatch

            files = tracked_files(root)
            for number, line in enumerate(text.splitlines(), 1):
                fields = line.split("#", 1)[0].split()
                if not fields:
                    continue
                pattern = fields[0]
                if (
                    pattern.startswith("!")
                    or "[" in pattern
                    or any(
                        not re.fullmatch(
                            r"@[\w.-]+(?:/[\w.-]+)?|[^\s@]+@[^\s@]+\.[^\s@]+", owner
                        )
                        for owner in fields[1:]
                    )
                ):
                    raise ValueError(f"{path}:{number}: invalid pattern or owner")
                pattern = pattern.lstrip("/").rstrip("/")
                candidates = [pattern, pattern + "/*"]
                if "/" not in pattern:
                    candidates.extend(["*/" + pattern, "*/" + pattern + "/*"])
                if not any(
                    fnmatch.fnmatchcase(file, candidate)
                    for file in files
                    for candidate in candidates
                ):
                    raise ValueError(
                        f"{path}:{number}: pattern matches no tracked local paths"
                    )
    formatted = [p for p in paths if p != ".github/CODEOWNERS"]
    if formatted:
        subprocess.run(
            ["pnpm", "exec", "prettier", "--check", *formatted], cwd=root, check=True
        )
    print(
        f"PASS: {len(paths)} automation metadata files checked (syntax/format, not full Renovate schema validation)."
    )
