"""Application-specific frontend test inventory."""

from jellyfin_plugin_toolkit.common.process import ROOT, run

run("node", "--experimental-strip-types", "--test", cwd=ROOT / "frontend")
run(
    "node",
    "--test",
    "tests/tooling/renderer-contract.test.mjs",
    "tests/tooling/typescript-toolchain.test.mjs",
)
