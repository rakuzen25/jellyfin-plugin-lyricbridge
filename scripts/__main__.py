"""LyricBridge developer tasks. Run a task without a target for the whole project."""

import argparse
import subprocess
import sys

from scripts import tasks
from scripts.common.process import ROOT


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python3 -m scripts", description=__doc__)
    sub = parser.add_subparsers(dest="task", required=True)
    sub.add_parser(
        "bootstrap",
        help="Prepare installed tools, dependencies, and official references",
    )
    dev_parser = sub.add_parser(
        "dev", help="Run the supervised local Jellyfin development session"
    )
    dev_parser.add_argument("--port", type=int, default=18096)
    dev_parser.add_argument("--open", action="store_true")
    dev_parser.add_argument(
        "--no-watch", action="store_true", help="Start with automatic updates paused"
    )
    mounts = dev_parser.add_mutually_exclusive_group()
    mounts.add_argument("--media-mount", action="append")
    mounts.add_argument("--clear-media-mounts", action="store_true")
    for task in ("build", "check", "format", "test"):
        command = sub.add_parser(task)
        targets = {
            "build": ["frontend", "backend"],
            "check": ["frontend", "backend", "tooling", "docs"],
            "format": ["frontend", "backend", "tooling", "docs"],
            "test": [
                "frontend",
                "backend",
                "tooling",
                "browser",
                "installation",
                "reproducibility",
            ],
        }[task]
        command.add_argument("target", nargs="?", choices=targets)
        if task == "build":
            command.add_argument("--release", action="store_true")
            command.add_argument("--prepared-web", action="store_true")
    args, extra = parser.parse_known_args(argv)
    if extra and args.task != "test":
        parser.error("unrecognized arguments: " + " ".join(extra))
    if args.task == "bootstrap":
        tasks.bootstrap()
    elif args.task == "dev":
        if not 1 <= args.port <= 65535:
            parser.error("--port must be between 1 and 65535")
        from scripts.dev.local_jellyfin import dev

        dev(args)
    elif args.task == "build":
        if args.target and (args.release or args.prepared_web):
            parser.error(
                "--release and --prepared-web apply only to complete distribution builds"
            )
        if args.target == "frontend":
            tasks.frontend_build()
        elif args.target == "backend":
            from scripts.build.backend import publish

            publish(ROOT / ".build/plugin", ROOT / "dist/web")
        else:
            from scripts.build.clean_package import clean_package
            from scripts.dev.references import ensure

            ensure()
            clean_package(args.release, args.prepared_web)
    else:
        defaults = ["frontend", "backend", "tooling"] + (
            ["docs"] if args.task in {"check", "format"} else []
        )
        for target in [args.target] if args.target else defaults:
            if args.task == "check":
                tasks.check(target)
            elif args.task == "format":
                tasks.format_target(target, True)
            else:
                tasks.test(target, extra)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)
