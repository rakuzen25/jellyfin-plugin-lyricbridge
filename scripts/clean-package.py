"""Build a candidate from the shared source inventory in a disposable clean root."""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from ci import artifact_hashes, digest
from source_inventory import source_files


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--release", action="store_true")
    parser.add_argument("--prepared-web", action="store_true")
    args = parser.parse_args()
    repository = Path(__file__).resolve().parent.parent
    files = source_files(repository)
    environment = dict(os.environ)
    reference = Path(
        environment.get("LYRICBRIDGE_REFERENCE_DIR", repository / ".build/jellyfin")
    ).resolve()
    environment["LYRICBRIDGE_REFERENCE_ARG"] = "-p:JellyfinReferenceDir=" + str(
        reference
    )
    environment["NUGET_PACKAGES"] = str(
        Path(
            environment.get("NUGET_PACKAGES", Path.home() / ".nuget/packages")
        ).resolve()
    )
    if args.prepared_web:
        subprocess.run(
            ["python3", "scripts/ci.py", "web-verify"], cwd=repository, check=True
        )
        environment["LYRICBRIDGE_PREPARED_WEB"] = "true"
    else:
        environment.pop("LYRICBRIDGE_PREPARED_WEB", None)
    with tempfile.TemporaryDirectory(
        prefix="lyricbridge-clean-candidate-"
    ) as temporary:
        root = Path(temporary)
        for relative in files:
            destination = root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(repository / relative, destination)
        if args.prepared_web:
            shutil.copytree(repository / "dist/web", root / "dist/web")
            shutil.copy2(
                repository / "dist/web-build.json", root / "dist/web-build.json"
            )
        subprocess.run(
            ["sh", "scripts/package.sh"] + (["--release"] if args.release else []),
            cwd=root,
            env=environment,
            check=True,
        )
        out = repository / "dist"
        out.mkdir(exist_ok=True)
        for name in artifact_hashes(root):
            shutil.copy2(root / "dist" / name, out / name)
        # A local standalone clean build also supplies the assets inspected by tests.
        if not args.prepared_web:
            shutil.copytree(root / "dist/web", out / "web", dirs_exist_ok=True)
        (out / "clean-build.json").write_text(
            json.dumps(
                {
                    "source": digest(repository, files),
                    "artifacts": artifact_hashes(root),
                },
                indent=2,
            )
            + "\n"
        )


if __name__ == "__main__":
    main()
