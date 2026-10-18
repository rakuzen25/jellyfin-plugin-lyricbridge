"""Interactive, isolated Jellyfin sandbox for unpublished LyricBridge builds."""

import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request
import zipfile

from scripts.common.release_metadata import load_release

REPOSITORY = Path(__file__).resolve().parents[2]
DATA = REPOSITORY / ".build/local-jellyfin"
IMAGE = "jellyfin/jellyfin@sha256:357724bf0ae27a672c7cbaa899db2d9abeb13dbd8657ccce750258a4c059d037"
OWNER_LABEL = "lyricbridge.local-checkout"
OWNER = str(REPOSITORY)
CONTAINER = "lyricbridge-local-" + hashlib.sha256(OWNER.encode()).hexdigest()[:10]


def run(*command: str) -> None:
    subprocess.run(command, cwd=REPOSITORY, check=True)


def inspect() -> dict | None:
    # Listing avoids treating daemon/permission errors as an absent container.
    result = subprocess.check_output(
        [
            "docker",
            "ps",
            "-a",
            "--filter",
            "name=^/" + CONTAINER + "$",
            "--format",
            "{{.ID}}",
        ],
        text=True,
    ).strip()
    if not result:
        return None
    container = json.loads(
        subprocess.check_output(["docker", "inspect", CONTAINER], text=True)
    )[0]
    if container["Config"].get("Labels", {}).get(OWNER_LABEL) != OWNER:
        raise SystemExit(
            "Container name belongs to another installation; refusing to change it."
        )
    return container


def build() -> None:
    for executable in (
        "docker",
        "python3",
        os.environ.get("LYRICBRIDGE_PNPM", "pnpm"),
        os.environ.get("LYRICBRIDGE_DOTNET", "dotnet"),
    ):
        if not shutil.which(executable):
            raise SystemExit(
                f"Missing {executable}. Install the pinned tools described in docs/how-to/develop.md."
            )
    reference = REPOSITORY / ".build/jellyfin"
    if not (reference / "MediaBrowser.Common.dll").exists():
        run("sh", "scripts/dev/bootstrap-references.sh")
    run("sh", "scripts/build/package.sh")


def install() -> None:
    release = load_release(REPOSITORY)
    archive = REPOSITORY / "dist" / f"lyricbridge-{release.version}.zip"
    if not archive.is_file():
        raise SystemExit(
            "Package not found. Run python3 -m scripts.dev.local_jellyfin rebuild to build the current checkout."
        )
    plugins = DATA / "config/plugins"
    plugins.mkdir(parents=True, exist_ok=True)
    # Validate/extract before taking a running sandbox down.
    with tempfile.TemporaryDirectory(prefix="lyricbridge-local-package-") as directory:
        staged = Path(directory)
        with zipfile.ZipFile(archive) as package:
            metadata = json.loads(package.read("meta.json"))
            if (
                metadata.get("guid") != release.guid
                or metadata.get("version") != release.jellyfin_version
            ):
                raise SystemExit(
                    "Package identity/version does not match this checkout. Rebuild it."
                )
            for entry in package.infolist():
                if (
                    not (staged / entry.filename)
                    .resolve()
                    .is_relative_to(staged.resolve())
                ):
                    raise SystemExit("Unsafe archive path.")
            package.extractall(staged)
        previous = list(plugins.glob("LyricBridge_*"))
        for folder in previous:
            meta = folder / "meta.json"
            if (
                not meta.is_file()
                or json.loads(meta.read_text()).get("guid") != release.guid
            ):
                raise SystemExit(
                    f"Unexpected plugin folder: {folder}. Resolve it manually before rebuilding."
                )
        if inspect():
            run("docker", "rm", "-f", CONTAINER)
        for folder in previous:
            shutil.rmtree(folder)
        shutil.copytree(staged, plugins / ("LyricBridge_" + release.jellyfin_version))


def media_paths(requested: list[str] | None) -> list[str]:
    settings = DATA / "media-mounts.json"
    values = (
        requested
        if requested is not None
        else json.loads(settings.read_text())
        if settings.exists()
        else []
    )
    if not isinstance(values, list) or not all(
        isinstance(value, str) for value in values
    ):
        raise SystemExit(
            "Invalid saved media mounts. Use --clear-media-mounts to clear them."
        )
    paths: list[str] = []
    for value in values:
        path = Path(value).expanduser()
        if not path.is_absolute():
            raise SystemExit(
                "--media-mount requires an absolute directory path: " + value
            )
        # Preserve the host path used by absolute symlinks, rather than resolving
        # it to a different target. Normalize only lexical path components.
        path = Path(os.path.abspath(path))
        if not path.is_dir():
            raise SystemExit("Media mount directory not found: " + str(path))
        if (
            "," in str(path)
            or path == Path("/")
            or any(
                path == base or base in path.parents
                for base in (Path("/config"), Path("/cache"), Path("/media"))
            )
        ):
            raise SystemExit(
                "Media mount conflicts with sandbox paths or Docker mount syntax: "
                + str(path)
            )
        if str(path) not in paths:
            paths.append(str(path))
    return paths


def start(port: int, requested_mounts: list[str] | None = None) -> None:
    mounts = media_paths(requested_mounts)
    DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name in ("config", "cache", "media"):
        (DATA / name).mkdir(exist_ok=True)
    install()
    run(
        "docker",
        "run",
        "-d",
        "--platform",
        "linux/amd64",
        "--name",
        CONTAINER,
        "--label",
        OWNER_LABEL + "=" + OWNER,
        "-p",
        f"127.0.0.1:{port}:8096",
        "-v",
        f"{DATA / 'config'}:/config",
        "-v",
        f"{DATA / 'cache'}:/cache",
        "-v",
        f"{DATA / 'media'}:/media:ro",
        *(
            argument
            for path in mounts
            for argument in ("--mount", f"type=bind,src={path},dst={path},readonly")
        ),
        IMAGE,
    )
    (DATA / "media-mounts.json").write_text(json.dumps(mounts, indent=2) + "\n")
    wait_ready(port)


def rebuild(port: int, requested_mounts: list[str] | None = None) -> None:
    mounts = media_paths(requested_mounts)
    build()
    start(port, mounts)


def wait_ready(port: int) -> None:
    url = f"http://localhost:{port}/web/"
    for _ in range(60):
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{port}/health", timeout=2
            ) as response:
                if response.status == 200:
                    print(
                        f"\nReady: {url}\nTest media: {DATA / 'media'}\nAdd /media as a music library. Configuration and data are retained across rebuilds."
                    )
                    return
        except OSError, http.client.HTTPException:
            # The published port can accept connections before Jellyfin is ready.
            pass
        time.sleep(1)
    raise SystemExit(
        f"Startup timed out. Inspect with: python3 -m scripts.dev.local_jellyfin logs\nContainer retained at {url}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("start", "rebuild", "stop", "status", "logs"),
        help="start uses the existing plugin ZIP; rebuild packages the checkout first",
    )
    parser.add_argument(
        "--port", type=int, default=18096, help="Localhost-only port (default: 18096)"
    )
    mount_options = parser.add_mutually_exclusive_group()
    mount_options.add_argument(
        "--media-mount",
        action="append",
        metavar="PATH",
        help="Read-only host directory mounted at the same absolute path; repeatable and retained across rebuilds",
    )
    mount_options.add_argument(
        "--clear-media-mounts",
        action="store_true",
        help="Remove remembered extra media mounts",
    )
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    if not shutil.which("docker"):
        parser.error("Docker is required")
    if args.command in ("start", "rebuild"):
        action = rebuild if args.command == "rebuild" else start
        action(
            args.port,
            [] if args.clear_media_mounts else args.media_mount,
        )
    else:
        container = inspect()
        if not container:
            print("Local Jellyfin is stopped. Retained data:", DATA)
        elif args.command == "stop":
            run("docker", "rm", "-f", CONTAINER)
            print("Stopped. Test configuration, media and database retained:", DATA)
        elif args.command == "logs":
            run("docker", "logs", "--tail", "100", "-f", CONTAINER)
        else:
            ports = container["NetworkSettings"].get("Ports", {}).get("8096/tcp") or []
            print("Container:", CONTAINER, "State:", container["State"]["Status"])
            for binding in ports:
                print("URL: http://localhost:" + binding["HostPort"] + "/web/")
            print("Data:", DATA)
            for path in media_paths(None):
                print("Read-only media mount:", path)


if __name__ == "__main__":
    main()
