"""Application-specific tooling regression inventory."""

import sys

from jellyfin_plugin_toolkit.common.process import ROOT, run

files = [
    str(p.relative_to(ROOT))
    for p in sorted((ROOT / "tests/tooling").glob("*.test.mjs"))
    if p.name not in {"renderer-contract.test.mjs", "typescript-toolchain.test.mjs"}
]
if files:
    run("node", "--test", *files)
for name in (
    "architecture",
    "consumer_policy",
    "release_boundaries",
    "release_automation",
):
    run(sys.executable, "-m", "tests.tooling." + name)
