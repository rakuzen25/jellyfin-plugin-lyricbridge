"""Load the locked toolkit for legacy Python module entrypoints."""

import runpy
from pathlib import Path

root = Path(__file__).resolve().parents[1]
runpy.run_path(str(root / "plugin"))["install"](root)
