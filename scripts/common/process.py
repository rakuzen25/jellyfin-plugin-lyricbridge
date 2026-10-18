"""Repository paths, executable selection, and checked subprocesses."""

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IMAGES = json.loads((Path(__file__).parent / "images.json").read_text())


def executable(name: str) -> str:
    return os.environ.get("LYRICBRIDGE_" + name.upper(), name)


def run(*args: str, cwd: Path = ROOT, env: dict[str, str] | None = None) -> None:
    display = args
    if "--include" in args:
        boundary = args.index("--include") + 1
        display = (*args[:boundary], f"[{len(args) - boundary} maintained files]")
    print("$ " + " ".join(display), flush=True)
    subprocess.run(args, cwd=cwd, env=env, check=True)


def python_checks() -> str:
    selected = os.environ.get("LYRICBRIDGE_PYTHON")
    if selected:
        return selected
    local = ROOT / ".venv/bin/python"
    selected = str(local) if local.exists() else sys.executable
    expected = (ROOT / ".python-version").read_text().strip()
    found = subprocess.check_output([selected, "--version"], text=True).strip()
    if found != "Python " + expected:
        raise ValueError("The Python check environment is outdated; run pnpm bootstrap")
    return selected
