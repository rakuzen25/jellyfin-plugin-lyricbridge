"""Application-specific tooling regression inventory."""

import sys

from jellyfin_plugin_toolkit.common.process import run
from jellyfin_plugin_toolkit.context import Context

ROOT = Context.load().root

files = [
    str(p.relative_to(ROOT))
    for p in sorted((ROOT / "tests/tooling").glob("*.test.mjs"))
    if p.name not in {"renderer-contract.test.mjs", "typescript-toolchain.test.mjs"}
]
if files:
    run("node", "--test", *files, cwd=ROOT)
for name in (
    "consumer_policy",
    "release_boundaries",
    "release_automation",
):
    run(sys.executable, "-m", "tests.tooling." + name, cwd=ROOT)
