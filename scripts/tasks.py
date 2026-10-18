"""Explicit developer tasks shared by the CLI and CI; no dependency installation in checks."""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

from scripts.build.backend import maintained_csharp, prepare
from scripts.common.process import IMAGES, ROOT, executable, python_checks, run
from scripts.dev.references import ensure, verify

FRONTEND_FORMAT = [
    "frontend/**/*.{ts,mjs,json,css,html}",
    "tests/browser/**/*.{cjs,mjs,json}",
]
TOOLING_FORMAT = [
    "tests/tooling/**/*.mjs",
    "scripts/**/*.{mjs,json}",
    "*.{json,mjs,yaml}",
    ".github/**/*.{yml,yaml}",
]
FRONTEND_NODE_TESTS = ("renderer-contract.test.mjs", "typescript-toolchain.test.mjs")
UNIT_MODULES = (
    "documentation",
    "architecture",
    "ci_policy",
    "release_boundaries",
    "release_automation",
    "local_jellyfin",
    "tasks",
)


def verify_tools() -> None:
    import shutil

    for command in ("docker", "node", executable("pnpm"), executable("dotnet")):
        if not shutil.which(command):
            raise ValueError(
                f"Missing {command}; install the pinned tools in docs/how-to/develop.md"
            )
    expected = (ROOT / ".python-version").read_text().strip()
    if sys.version.split()[0] != expected:
        raise ValueError(f"Python {expected} required; found {sys.version.split()[0]}")
    run("node", "scripts/checks/check-toolchain.mjs")
    actual = subprocess.check_output(
        [executable("dotnet"), "--version"], text=True
    ).strip()
    import json

    expected_dotnet = json.loads((ROOT / "global.json").read_text())["sdk"]["version"]
    if actual != expected_dotnet:
        raise ValueError(f".NET SDK {expected_dotnet} required; found {actual}")


def bootstrap() -> None:
    verify_tools()
    run(executable("pnpm"), "install", "--frozen-lockfile")
    local = ROOT / ".venv/bin/python"
    if (
        not local.exists()
        or subprocess.check_output([str(local), "--version"], text=True).strip()
        != "Python " + sys.version.split()[0]
    ):
        run(sys.executable, "-m", "venv", "--clear", str(ROOT / ".venv"))
    run(str(local), "-m", "scripts.checks.check_pip")
    run(
        str(local),
        "-m",
        "pip",
        "install",
        "--uploaded-prior-to=P1D",
        "-r",
        "requirements-check.txt",
    )
    prepare()


def frontend_build() -> None:
    run("node", "frontend/build.mjs")


def dotnet_format(fix: bool = False) -> None:
    files = [str(p) for p in maintained_csharp("*.cs")]
    projects = maintained_csharp("*.csproj")
    if not files or not projects:
        raise ValueError("No maintained C# projects/files found")
    if not verify(ROOT / ".build/jellyfin"):
        raise ValueError(
            "Official references are missing or outdated; run pnpm bootstrap"
        )
    for project in projects:
        if not (project.parent / "obj/project.assets.json").exists():
            raise ValueError("Backend dependencies are missing; run pnpm bootstrap")
        run(
            executable("dotnet"),
            "format",
            str(project),
            "--no-restore",
            *([] if fix else ["--verify-no-changes"]),
            "--include",
            *files,
        )


def format_target(target: str, fix: bool) -> None:
    if target == "backend":
        dotnet_format(fix)
    else:
        patterns = FRONTEND_FORMAT if target == "frontend" else TOOLING_FORMAT
        run(
            executable("pnpm"),
            "exec",
            "prettier",
            "--write" if fix else "--check",
            *patterns,
        )
        if target == "tooling":
            run(
                python_checks(),
                "-m",
                "ruff",
                "format",
                *([] if fix else ["--check"]),
                "scripts",
                "tests",
            )


def check(target: str) -> None:
    if target == "docs":
        run(sys.executable, "-m", "scripts.checks.docs")
        return
    format_target(target, False)
    if target == "frontend":
        run(
            executable("pnpm"),
            "exec",
            "eslint",
            "frontend",
            "tests/browser",
            "--max-warnings",
            "0",
        )
        run(executable("pnpm"), "exec", "knip")
        run("node", "frontend/check-boundaries.mjs")
        run(executable("pnpm"), "--dir", "frontend", "exec", "tsc", "--noEmit")
    elif target == "tooling":
        run(
            executable("pnpm"),
            "exec",
            "eslint",
            "scripts",
            "tests/tooling",
            "eslint.config.mjs",
            "--max-warnings",
            "0",
        )
        run(python_checks(), "-m", "ruff", "check", "scripts", "tests")
        run(python_checks(), "-m", "mypy")
        run(sys.executable, "-m", "scripts.checks.architecture")


def backend_tests(extra: list[str]) -> None:
    ensure()
    if not (ROOT / "dist/web/config.html").exists():
        frontend_build()
    for boundary in ("Core", "Infrastructure", "Host"):
        project = f"tests/backend/{boundary}/LyricBridge.{boundary}.Tests.csproj"
        run(
            executable("dotnet"),
            "restore",
            project,
            "--locked-mode",
            "-m:1",
            "-p:NuGetAudit=false",
        )
        environment = {**os.environ, "TESTINGPLATFORM_TELEMETRY_OPTOUT": "1"}
        run(
            executable("dotnet"),
            "test",
            "--project",
            project,
            "--no-restore",
            "--minimum-expected-tests",
            "1",
            *extra,
            env=environment,
        )


def browser_tests(extra: list[str]) -> None:
    run("node", "tests/browser/check-image.mjs")
    results = Path(tempfile.mkdtemp(prefix="results-run.", dir=ROOT / "tests/browser"))
    # The inner shell only adapts argv/cwd for the offline image; policy lives here.
    run(
        "docker",
        "run",
        "--rm",
        "--network",
        "none",
        "-e",
        "CI_BROWSER_GROUP",
        "-e",
        "CI_BROWSER_OUTPUT_DIR=" + results.name,
        "-v",
        str(ROOT) + ":/work",
        "-w",
        "/work/tests/browser",
        IMAGES["playwright"],
        "sh",
        "-c",
        'node check-image.mjs --inside && exec node node_modules/playwright/cli.js test "$@"',
        "sh",
        *extra,
    )


def test(target: str, extra: list[str]) -> None:
    if target == "frontend":
        run(
            "node",
            "--experimental-strip-types",
            "--test",
            *extra,
            cwd=ROOT / "frontend",
        )
        run(
            "node",
            "--test",
            *extra,
            *("tests/tooling/" + name for name in FRONTEND_NODE_TESTS),
        )
    elif target == "backend":
        backend_tests(extra)
    elif target == "tooling":
        node_tests = sorted(
            str(path.relative_to(ROOT))
            for path in (ROOT / "tests/tooling").glob("*.test.mjs")
            if path.name not in FRONTEND_NODE_TESTS
        )
        run("node", "--test", *extra, *node_tests)
        for module in UNIT_MODULES:
            run(sys.executable, "-m", "tests.tooling." + module)
    elif target == "browser":
        browser_tests(extra)
    elif target == "installation":
        run(sys.executable, "-m", "tests.installation.web_installation")
        run(sys.executable, "-m", "tests.installation.package_installation", *extra)
    elif target == "reproducibility":
        run(sys.executable, "-m", "tests.tooling.reproducible_build", *extra)
