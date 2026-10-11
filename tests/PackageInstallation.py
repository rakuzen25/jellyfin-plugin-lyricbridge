"""Disposable official-image catalog test. No caller-supplied server targets.

Endpoints follow Jellyfin v12.2 PackageController and PluginsController.
The container owns tmpfs configuration/cache and no host media/data mounts.
"""

import functools
import hashlib
import http.server
import json
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import wave
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from release_metadata import load_release

RELEASE = load_release()
VERSION = RELEASE.version
HOST_VERSION = RELEASE.jellyfin_version

IMAGE = "jellyfin/jellyfin@sha256:357724bf0ae27a672c7cbaa899db2d9abeb13dbd8657ccce750258a4c059d037"
PLUGIN = RELEASE.guid
CONTAINER = "lyricbridge-package-test-" + uuid.uuid4().hex[:12]
DIST = Path(__file__).resolve().parent.parent / "dist"


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()


class QuietFiles(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        pass


with tempfile.TemporaryDirectory(prefix="lyricbridge-catalog-") as directory:
    root = Path(directory)
    media = root / "media"
    for name in ("public", "restricted"):
        folder = media / name
        folder.mkdir(parents=True)
        with wave.open(str(folder / "track.wav"), "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(8000)
            audio.writeframes(bytes(32000))
    media_before = {
        str(path.relative_to(media)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in media.rglob("*")
        if path.is_file()
    }
    archive = DIST / f"lyricbridge-{VERSION}.zip"
    if not archive.is_file():
        raise SystemExit("Build the package first.")
    shutil.copy2(archive, root / archive.name)
    gateway = docker(
        "network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}"
    )
    catalog = http.server.ThreadingHTTPServer(
        (gateway, 0), functools.partial(QuietFiles, directory=directory)
    )
    catalog_url = f"http://{gateway}:{catalog.server_port}/manifest.json"
    manifest = json.loads((DIST / "manifest.json").read_text())
    manifest[0]["versions"][0]["sourceUrl"] = (
        f"http://{gateway}:{catalog.server_port}/{archive.name}"
    )
    (root / "manifest.json").write_text(json.dumps(manifest))
    threading.Thread(target=catalog.serve_forever, daemon=True).start()
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    token = None
    password = None
    credentials = []
    authorization = f'MediaBrowser Client="LyricBridgeTests", Device="Disposable", DeviceId="fixture", Version="{VERSION}"'

    def call(path, method="GET", body=None, anonymous=False):
        headers = {"Authorization": authorization, "Content-Type": "application/json"}
        if token and not anonymous:
            headers["Authorization"] += f', Token="{token}"'
        request = urllib.request.Request(
            base + path,
            data=None if body is None else json.dumps(body).encode(),
            headers=headers,
            method=method,
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            data = response.read()
            return json.loads(data) if data else None

    def call_json(path, method="GET", body=None, anonymous=False):
        """Require response content wherever the fixture consumes JSON."""
        result = call(path, method, body, anonymous)
        if result is None:
            raise AssertionError(f"Expected a JSON response from {method} {path}")
        return result

    def ready():
        for _ in range(120):
            try:
                info = call_json("/System/Info/Public")
                if info.get("Version", "").startswith("12.2"):
                    return
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                pass
            time.sleep(0.5)
        raise RuntimeError("Disposable Jellyfin did not become ready.")

    def restart_server():
        old = docker("exec", CONTAINER, "cat", "/tmp/lyricbridge-server.pid")
        docker(
            "exec",
            CONTAINER,
            "sh",
            "-c",
            'kill -TERM "$(cat /tmp/lyricbridge-server.pid)"',
        )
        for _ in range(120):
            time.sleep(0.5)
            try:
                if (
                    docker("exec", CONTAINER, "cat", "/tmp/lyricbridge-server.pid")
                    != old
                ):
                    break
            except subprocess.CalledProcessError:
                pass
        else:
            raise RuntimeError("Disposable server did not restart.")
        ready()

    try:
        docker(
            "run",
            "-d",
            "--platform",
            "linux/amd64",
            "--name",
            CONTAINER,
            "--label",
            "lyricbridge.disposable-test=true",
            "-p",
            f"127.0.0.1:{port}:8096",
            "--tmpfs",
            "/config:rw,size=3g",
            "--tmpfs",
            "/cache:rw,size=3g",
            "-v",
            f"{media}:/fixture-media:ro",
            "--entrypoint",
            "/bin/sh",
            IMAGE,
            "-c",
            'while true; do /jellyfin/jellyfin & child=$!; echo "$child" > /tmp/lyricbridge-server.pid; wait "$child"; sleep 1; done',
        )
        ready()
        call(
            "/Startup/Configuration",
            "POST",
            {
                "UICulture": "en-US",
                "MetadataCountryCode": "US",
                "PreferredMetadataLanguage": "en",
            },
        )
        password = secrets.token_urlsafe(24)
        call("/Startup/User")
        call("/Startup/User", "POST", {"Name": "fixture-admin", "Password": password})
        call("/Startup/Complete", "POST", {})
        token = call_json(
            "/Users/AuthenticateByName",
            "POST",
            {"Username": "fixture-admin", "Pw": password},
        )["AccessToken"]
        credentials.append(token)
        # Install separate assets into this container's disposable web root only.
        web_root = root / "web"
        web_root.mkdir()
        docker(
            "cp",
            CONTAINER + ":/jellyfin/jellyfin-web/index.html",
            str(web_root / "index.html"),
        )
        web_assets = root / "assets"
        with zipfile.ZipFile(DIST / f"lyricbridge-web-{VERSION}.zip") as web_archive:
            web_archive.extractall(web_assets)
        installer = DIST.parent / "scripts" / "web-assets.py"
        subprocess.run(
            [
                sys.executable,
                str(installer),
                "--web-root",
                str(web_root),
                "--assets",
                str(web_assets),
            ],
            check=True,
        )
        docker(
            "cp",
            str(web_root / "index.html"),
            CONTAINER + ":/jellyfin/jellyfin-web/index.html",
        )
        docker(
            "cp",
            str(web_root / "lyricbridge"),
            CONTAINER + ":/jellyfin/jellyfin-web/lyricbridge",
        )
        network = call_json("/System/Configuration/network")
        network["BaseUrl"] = "/fixture"
        call("/System/Configuration/network", "POST", network)
        base += "/fixture"
        restart_server()
        with urllib.request.urlopen(base + "/web/index.html") as response:
            index = response.read().decode()
        assets = re.findall(r'(?:src|href)="([^"]*lyricbridge/[^"]+)"', index)
        assert len(assets) >= 4, "Installed web asset tags missing"
        for asset in assets:
            with urllib.request.urlopen(
                urllib.parse.urljoin(base + "/web/index.html", asset)
            ) as response:
                assert response.status == 200 and response.read(), (
                    "Base URL asset request failed"
                )
        subprocess.run(
            [
                sys.executable,
                str(installer),
                "--web-root",
                str(web_root),
                "--uninstall",
            ],
            check=True,
        )
        docker(
            "cp",
            str(web_root / "index.html"),
            CONTAINER + ":/jellyfin/jellyfin-web/index.html",
        )
        with urllib.request.urlopen(base + "/web/index.html") as response:
            assert "lyricbridge/lyricbridge.js" not in response.read().decode(), (
                "Web uninstall retained script tag"
            )
        print(
            "PASS: separate web install/uninstall and content-versioned assets served with a Jellyfin base URL.",
            flush=True,
        )
        call(
            "/Repositories",
            "POST",
            [
                {
                    "Name": "Disposable LyricBridge catalog",
                    "Url": catalog_url,
                    "Enabled": True,
                }
            ],
        )
        packages = call_json("/Packages")
        assert any(
            p.get("guid", p.get("Guid", "")).lower().replace("-", "")
            == PLUGIN.replace("-", "")
            for p in packages
        ), f"Catalog package missing: {packages}"
        call(
            f"/Packages/Installed/LyricBridge?assemblyGuid={PLUGIN}&version={HOST_VERSION}",
            "POST",
            {},
        )
        restart_server()
        plugins = call_json("/Plugins")
        plugin = next(
            p
            for p in plugins
            if p["Id"].lower().replace("-", "") == PLUGIN.replace("-", "")
        )
        assert plugin["Status"] == "Active", "Installed plugin is not active"
        configuration = call_json(f"/Plugins/{PLUGIN}/Configuration")
        runtime = call_json("/LyricBridge/admin/runtime")
        assert (
            runtime["activeStoragePath"].startswith("/")
            and not runtime["restartRequired"]
        )
        configured_storage = configuration["StoragePath"]
        configuration["StoragePath"] = "/config/data/lyricbridge-next-fixture"
        call(f"/Plugins/{PLUGIN}/Configuration", "POST", configuration)
        changed_runtime = call_json("/LyricBridge/admin/runtime")
        assert (
            changed_runtime["restartRequired"]
            and changed_runtime["activeStoragePath"] == runtime["activeStoragePath"]
        )
        configuration["StoragePath"] = configured_storage
        call(f"/Plugins/{PLUGIN}/Configuration", "POST", configuration)
        assert not call_json("/LyricBridge/admin/runtime")["restartRequired"]
        print(
            "PASS: active storage reporting and restart-required configuration changes.",
            flush=True,
        )
        # Disable retrieval sources before any feature checks. No media exists here.
        for source in configuration["Sources"]:
            source["Enabled"] = False
        call(f"/Plugins/{PLUGIN}/Configuration", "POST", configuration)
        assert isinstance(call_json("/LyricBridge/services"), list)
        try:
            call("/LyricBridge/jobs", anonymous=True)
            raise AssertionError("Anonymous API access accepted")
        except urllib.error.HTTPError as error:
            assert error.code == 401
        assert call_json("/LyricBridge/jobs?limit=1") == []
        admin_token = token
        admin_preferences = call_json("/LyricBridge/preferences")
        for name in ("public", "restricted"):
            options = {
                "PathInfos": [{"Path": "/fixture-media/" + name}],
                "SaveLyricsWithMedia": False,
                "EnableRealtimeMonitor": False,
                "AutomaticRefreshIntervalDays": 0,
                "MetadataSavers": [],
                "DisabledLyricFetchers": ["LyricBridge"],
                "TypeOptions": [
                    {"Type": kind, "MetadataFetchers": [], "ImageFetchers": []}
                    for kind in ("MusicAlbum", "MusicArtist", "Audio")
                ],
            }
            call(
                "/Library/VirtualFolders?name="
                + name
                + "&collectionType=music&refreshLibrary=true",
                "POST",
                {"LibraryOptions": options},
            )
        tracks = []
        for _ in range(120):
            tracks = call_json(
                "/Items?Recursive=true&IncludeItemTypes=Audio&Fields=Path"
            )["Items"]
            if len(tracks) == 2:
                break
            time.sleep(0.5)
        assert len(tracks) == 2, "Disposable media was not scanned"
        public_id = next(track["Id"] for track in tracks if "/public/" in track["Path"])
        restricted_id = next(
            track["Id"] for track in tracks if "/restricted/" in track["Path"]
        )
        public_api = "/LyricBridge/items/" + public_id
        for item_id in (public_id, restricted_id):
            call(
                "/LyricBridge/items/" + item_id + "/import",
                "POST",
                {"text": "[00:00.00]朝\n[00:01.00]光"},
            )
        native = call_json("/Audio/" + public_id + "/Lyrics")
        assert native["Lyrics"][0]["Text"] == "朝", (
            "Managed import missing from native lyric response"
        )
        call(public_api + "/language-preferences", "PUT", {"sourceLanguage": "ja"})
        rich = call_json(public_api + "/lyrics")
        call(
            public_api + "/pronunciation",
            "POST",
            {"hash": rich["lyrics"]["hash"], "includeSupplied": True, "retry": True},
        )
        for _ in range(100):
            rich = call_json(public_api + "/lyrics")
            if rich["pronunciation"]["state"] == "complete":
                break
            time.sleep(0.1)
        assert rich["pronunciation"]["state"] == "complete", (
            "Packaged Kawazu dictionary generation failed"
        )
        version = next(
            v
            for v in rich["variants"]
            if v["key"] == rich["auxiliaryChoices"]["pronunciation"]
        )
        assert version["originType"] == "local" and version["profile"] is not None
        assert any(
            value.strip().lower() == "asa" for value in version["text"].values()
        ), "Unexpected local pronunciation"
        listener = call_json("/Users/New", "POST", {"Name": "fixture-listener"})
        public_folder = next(
            folder["ItemId"]
            for folder in call_json("/Library/VirtualFolders")
            if folder["Name"] == "public"
        )
        policy = listener["Policy"]
        policy["EnableAllFolders"] = False
        policy["EnabledFolders"] = [public_folder]
        call("/Users/" + listener["Id"] + "/Policy", "POST", policy)
        token = call_json(
            "/Users/AuthenticateByName",
            "POST",
            {"Username": "fixture-listener", "Pw": ""},
        )["AccessToken"]
        credentials.append(token)
        preferences = call_json("/LyricBridge/preferences")
        preferences["originalSize"] = 51
        call("/LyricBridge/preferences", "PUT", preferences)
        assert call_json("/LyricBridge/preferences")["originalSize"] == 51
        for path, method, body in [
            ("/LyricBridge/admin/runtime", "GET", None),
            ("/LyricBridge/admin/reset", "POST", {"confirmation": "RESET"}),
            (f"/Plugins/{PLUGIN}/Configuration", "POST", configuration),
        ]:
            try:
                call(path, method, body)
                raise AssertionError("Ordinary user accepted by administrator endpoint")
            except urllib.error.HTTPError as error:
                assert error.code == 403
        assert call_json(public_api + "/lyrics")["lyrics"]["lines"][0]["text"] == "朝"
        for path in (
            "/LyricBridge/items/" + restricted_id + "/lyrics",
            "/Audio/" + restricted_id + "/Lyrics",
        ):
            try:
                call(path)
                raise AssertionError("Restricted library lyrics were exposed")
            except urllib.error.HTTPError as error:
                assert error.code in (403, 404)
        listener_token = token
        token = admin_token
        call(public_api + "/reject-matches", "POST", {})
        token = listener_token
        call(public_api + "/retry", "POST", {})
        assert call_json(public_api + "/lyrics")["state"] == "rejected", (
            "Listener cleared shared rejection"
        )
        token = admin_token
        assert call_json("/LyricBridge/preferences") == admin_preferences, (
            "Preferences leaked across accounts"
        )
        print(
            "PASS: ordinary-user preference persistence, account isolation and administrator restrictions.",
            flush=True,
        )
        print(
            "PASS: official Linux x64 catalog installation, restart, dependency loading, authenticated API and anonymous rejection.",
            flush=True,
        )
        call("/LyricBridge/admin/reset", "POST", {"confirmation": "RESET"})
        assert call_json("/LyricBridge/preferences") == admin_preferences, (
            "Reset changed preferences"
        )
        assert {
            str(path.relative_to(media)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in media.rglob("*")
            if path.is_file()
        } == media_before, "Media files changed"
        print(
            "PASS: native lyrics, packaged dictionary, restricted libraries, rejection preservation, reset boundaries and read-only media.",
            flush=True,
        )
        call(f"/Plugins/{PLUGIN}/{HOST_VERSION}/Disable", "POST", {})
        restart_server()
        plugin = next(
            p
            for p in call_json("/Plugins")
            if p["Id"].lower().replace("-", "") == PLUGIN.replace("-", "")
        )
        assert plugin["Status"] == "Disabled"
        call(f"/Plugins/{PLUGIN}/{HOST_VERSION}", "DELETE")
        restart_server()
        assert not any(
            p["Id"].lower().replace("-", "") == PLUGIN.replace("-", "")
            for p in call_json("/Plugins")
        )
        print(
            "PASS: disable/restart and uninstall/restart; only disposable storage was used.",
            flush=True,
        )
    except Exception:
        try:
            logs = docker("logs", "--tail", "50", CONTAINER)
            for secret in [*credentials, token, password]:
                if secret:
                    logs = logs.replace(secret, "[redacted]")
            print(logs, flush=True)
        except subprocess.CalledProcessError:
            pass
        raise
    finally:
        subprocess.run(
            ["docker", "rm", "-f", "-v", CONTAINER],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        catalog.shutdown()
        catalog.server_close()
