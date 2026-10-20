"""Application-specific frontend test inventory."""

from jellyfin_plugin_toolkit.common.process import run
from jellyfin_plugin_toolkit.context import Context

ROOT = Context.load().root

run("node", "--experimental-strip-types", "--test", cwd=ROOT / "frontend")
run(
    "node",
    "--test",
    "tests/tooling/renderer-contract.test.mjs",
    "tests/tooling/typescript-toolchain.test.mjs",
    cwd=ROOT,
)
