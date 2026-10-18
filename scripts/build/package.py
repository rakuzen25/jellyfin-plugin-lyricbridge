"""Build and assemble distributions within a selected source root."""

import argparse
import tempfile
from pathlib import Path

from scripts.build.backend import publish, reference_directory
from scripts.build.package_artifacts import assemble
from scripts.common.artifacts import verify_web
from scripts.common.process import ROOT, executable, run


def package(release: bool = False, prepared_web: bool = False) -> None:
    run("node", "scripts/checks/check-toolchain.mjs")
    run(executable("pnpm"), "install", "--frozen-lockfile")
    if prepared_web:
        verify_web(ROOT)
    else:
        run("node", "frontend/build.mjs")
    with tempfile.TemporaryDirectory(prefix="lyricbridge-publish-") as temporary:
        staging = Path(temporary)
        publish(staging / "plugin", ROOT / "dist/web", references=reference_directory())
        assemble(staging, release)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--release", action="store_true")
    parser.add_argument("--prepared-web", action="store_true")
    args = parser.parse_args()
    package(args.release, args.prepared_web)
