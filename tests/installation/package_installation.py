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

from jellyfin_plugin_toolkit.common.release_metadata import load_release

RELEASE = load_release()
VERSION = RELEASE.version
HOST_VERSION = RELEASE.jellyfin_version

from jellyfin_plugin_toolkit.common.process import IMAGES

IMAGE = IMAGES["jellyfin"]
PLUGIN = RELEASE.guid
CONTAINER = "lyricbridge-package-test-" + uuid.uuid4().hex[:12]
DIST = Path(__file__).resolve().parents[2] / "dist"


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()


class QuietFiles(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        pass

    def do_POST(self):
        if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
            chunks = []
            while length := int(self.rfile.readline().split(b";", 1)[0], 16):
                chunks.append(self.rfile.read(length))
                assert self.rfile.read(2) == b"\r\n"
            assert self.rfile.readline() == b"\r\n"
            payload = b"".join(chunks)
        else:
            payload = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if self.path == "/mock/v1/audio/transcriptions":
            assert (
                self.headers.get("Authorization") == "Bearer fixture-transcription-key"
            )
            assert (
                b"verbose_json" in payload and b"timestamp_granularities[]" in payload
            )
            response = {
                "language": "en",
                "text": "Hello world!",
                "words": [
                    {"word": "Hello", "start": 0.1, "end": 0.8},
                    {"word": "world!", "start": 0.7, "end": 1.6},
                ],
            }
        elif self.path == "/mock/v1/chat/completions":
            request = json.loads(payload)
            source = json.loads(request["messages"][1]["content"])
            response = {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {"endTokenIds": source["eligibleEndTokenIds"]}
                            )
                        }
                    }
                ]
            }
        else:
            self.send_error(404)
            return
        encoded = json.dumps(response).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


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
        if isinstance(body, bytes):
            headers["Content-Type"] = "application/octet-stream"
        request = urllib.request.Request(
            base + path,
            data=None
            if body is None
            else body
            if isinstance(body, bytes)
            else json.dumps(body).encode(),
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
            except urllib.error.URLError, TimeoutError, ConnectionError:
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
            IMAGES["platform"],
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
        installer = [sys.executable, "-m", "scripts.installation.web_assets"]
        subprocess.run(
            [
                *installer,
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
                *installer,
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

        settings_api = "/LyricBridge/admin/settings"
        initial_settings = call_json(settings_api)
        assert (
            initial_settings["configuration"]["StoragePath"]
            == configuration["StoragePath"]
        )
        saved_settings = call_json(
            settings_api,
            "PUT",
            {
                "revision": initial_settings["revision"],
                "configuration": initial_settings["configuration"],
                "credentials": [
                    {
                        "kind": "source",
                        "id": "Spotify",
                        "action": "replace",
                        "value": "fixture-admin-settings-secret",
                    }
                ],
            },
        )
        assert "fixture-admin-settings-secret" not in json.dumps(saved_settings)
        spotify = next(
            source
            for source in saved_settings["configuration"]["Sources"]
            if source["Name"] == "Spotify"
        )
        assert spotify["CredentialPresent"] and spotify["Credential"] == ""
        try:
            call(
                settings_api,
                "PUT",
                {
                    "revision": initial_settings["revision"],
                    "configuration": initial_settings["configuration"],
                },
            )
            raise AssertionError("Stale settings revision accepted")
        except urllib.error.HTTPError as error:
            assert error.code == 409
        saved_settings = call_json(
            settings_api,
            "PUT",
            {
                "revision": saved_settings["revision"],
                "configuration": saved_settings["configuration"],
                "credentials": [],
            },
        )
        restart_server()
        persisted_settings = call_json(settings_api)
        assert next(
            source
            for source in persisted_settings["configuration"]["Sources"]
            if source["Name"] == "Spotify"
        )["CredentialPresent"]
        call(
            settings_api,
            "PUT",
            {
                "revision": persisted_settings["revision"],
                "configuration": persisted_settings["configuration"],
                "credentials": [{"kind": "source", "id": "Spotify", "action": "clear"}],
            },
        )
        assert isinstance(
            call_json("/LyricBridge/admin/requests?group=finished")["items"], list
        )

        def renderer_index():
            with urllib.request.urlopen(base + "/web/index.html") as response:
                return response.read().decode()

        def verify_renderer():
            state = call_json("/LyricBridge/admin/web-renderer/repair", "POST", {})
            assert state["enabled"] and state["mechanism"] == "direct", state
            html = renderer_index()
            assert html.count("<!-- LyricBridge managed assets -->") == 1
            urls = re.findall(r'(?:src|href)="([^"]*LyricBridge/assets/[^"]+)"', html)
            assert len(urls) == 4, html
            for url in urls:
                with urllib.request.urlopen(
                    urllib.parse.urljoin(base + "/web/index.html", url)
                ) as response:
                    assert response.status == 200 and response.read()

        verify_renderer()
        restart_server()
        verify_renderer()
        restart_server()
        verify_renderer()
        configuration["EnableWebRenderer"] = False
        call(f"/Plugins/{PLUGIN}/Configuration", "POST", configuration)
        assert not call_json("/LyricBridge/admin/web-renderer/repair", "POST", {})[
            "enabled"
        ]
        assert "<!-- LyricBridge managed assets -->" not in renderer_index()
        configuration["EnableWebRenderer"] = True
        call(f"/Plugins/{PLUGIN}/Configuration", "POST", configuration)
        verify_renderer()
        # A prior manual install is replaced without loading either renderer twice.
        subprocess.run(
            [
                *installer,
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
        verify_renderer()
        assert "lyricbridge/lyricbridge.js" not in renderer_index()
        # Verify root URLs as well as the existing nonempty base URL.
        network["BaseUrl"] = ""
        call("/System/Configuration/network", "POST", network)
        base = base.removesuffix("/fixture")
        restart_server()
        verify_renderer()
        print(
            "PASS: automatic embedded renderer, ordered assets, root/base URL, repeated restarts and disable/re-enable.",
            flush=True,
        )
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
            {
                "hash": rich["lyrics"]["hash"],
                "includeSupplied": True,
                "retry": True,
                "optionId": next(
                    o["id"]
                    for o in call_json("/LyricBridge/service-options")
                    if o["provider"] == "Kawazu" and o["capability"] == "pronunciation"
                ),
            },
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
        # The owned HTTP server also acts as a deterministic OpenAI-compatible audio/text endpoint.
        # Real Jellyfin FFmpeg prepares both library audio and the synthetic WAV upload.
        original_hash = rich["lyrics"]["hash"]
        setup = configuration["ServiceSetup"]
        for option in setup["Options"]:
            if option["Capability"] in ("transcription", "boundary-review"):
                option["Enabled"] = True
                option["Model"] = "fixture"
                connection = next(
                    c for c in setup["Connections"] if c["Id"] == option["ConnectionId"]
                )
                connection["Endpoint"] = (
                    f"http://{gateway}:{catalog.server_port}/mock/v1"
                )
                connection["ApiKey"] = "fixture-transcription-key"
        call(f"/Plugins/{PLUGIN}/Configuration", "POST", configuration)

        def completed(job):
            for _ in range(200):
                current = call_json("/LyricBridge/jobs/" + job["id"])
                if current["state"] == "complete":
                    return current
                assert current["state"] not in (
                    "failed",
                    "cancelled",
                    "settings_changed",
                ), current
                time.sleep(0.1)
            raise AssertionError("Mocked transcription/review job did not complete")

        service_options = call_json("/LyricBridge/service-options")
        assert "fixture-transcription-key" not in json.dumps(service_options)
        audio_option = next(
            o["id"]
            for o in service_options
            if o["capability"] == "transcription" and o["status"] == "Ready"
        )
        review_option = next(
            o["id"]
            for o in service_options
            if o["capability"] == "boundary-review" and o["status"] == "Ready"
        )
        source_job = completed(
            call_json(
                public_api + "/transcribe",
                "POST",
                {"source": "track", "optionId": audio_option},
            )
        )
        assert source_job["request"]["optionId"] == audio_option
        assert source_job["request"]["optionName"]

        assert "fixture-transcription-key" not in json.dumps(source_job)
        transcript_api = public_api + "/transcriptions/" + source_job["resultId"]
        transcript = call_json(transcript_api)
        assert transcript["transcript"]["text"] == "Hello world!"
        assert len(transcript["transcript"]["rawResponses"]) == 1
        choice = {
            "transcriptId": source_job["resultId"],
            "endTokenIds": ["t0", "t1"],
            "settings": {"characters": None, "seconds": 3, "keepShortReplies": True},
            "expectedSelection": transcript["selection"],
        }
        preview = call_json(transcript_api + "/preview", "POST", choice)
        assert len(preview["lines"]) == 2
        assert call_json(public_api + "/lyrics")["lyrics"]["hash"] == original_hash
        review_input = {**choice, "optionId": review_option}
        review_plan = call_json(transcript_api + "/review-plan", "POST", review_input)
        completed(
            call_json(
                transcript_api + "/review",
                "POST",
                {**review_input, "planIdentity": review_plan["identity"]},
            )
        )
        call(transcript_api + "/use", "POST", choice)
        native = call_json("/Audio/" + public_id + "/Lyrics")
        assert "".join(line["Text"] for line in native["Lyrics"]) == "Hello world!"
        assert native["Lyrics"][0]["Cues"][0]["End"] == 8_000_000
        assert native["Lyrics"][1]["Cues"][0]["Start"] == 7_000_000
        upload = call_json(
            public_api + "/transcription-upload?optionId=" + audio_option,
            "POST",
            (media / "public/track.wav").read_bytes(),
        )
        uploaded = completed(
            call_json(
                public_api + "/transcribe",
                "POST",
                {
                    "source": "upload",
                    "uploadId": upload["id"],
                    "optionId": audio_option,
                },
            )
        )
        assert uploaded["resultId"] != source_job["resultId"]
        call(public_api + "/originals/" + original_hash + "/select", "POST", {})
        print(
            "PASS: configured remote transcription, real FFmpeg, binary upload, AI boundary review, atomic use and native explicit karaoke ends.",
            flush=True,
        )
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
            ("/LyricBridge/admin/settings", "GET", None),
            (
                "/LyricBridge/admin/settings",
                "PUT",
                {"revision": "invalid", "configuration": {}},
            ),
            ("/LyricBridge/admin/requests?group=active", "GET", None),
            ("/LyricBridge/admin/runtime", "GET", None),
            ("/LyricBridge/admin/data/overview", "GET", None),
            ("/LyricBridge/admin/data/configuration", "GET", None),
            ("/LyricBridge/admin/data/records", "GET", None),
            ("/LyricBridge/admin/data/preview", "POST", {"action": "factory-reset"}),
            (
                "/LyricBridge/admin/data/execute",
                "POST",
                {"token": "invalid", "confirmed": True},
            ),
            ("/LyricBridge/admin/web-renderer", "GET", None),
            ("/LyricBridge/admin/web-renderer/repair", "POST", {}),
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
            "/LyricBridge/items/" + restricted_id + "/transcriptions",
        ):
            try:
                call(path)
                raise AssertionError("Restricted library lyrics were exposed")
            except urllib.error.HTTPError as error:
                assert error.code in (403, 404)
        listener_token = token
        try:
            call(transcript_api + "/use", "POST", choice)
            raise AssertionError("Ordinary user changed shared transcription selection")
        except urllib.error.HTTPError as error:
            assert error.code == 403
        try:
            call(public_api + "/transcribe", "POST", {"source": "track"})
            raise AssertionError("Disabled user transcription request accepted")
        except urllib.error.HTTPError as error:
            assert error.code == 403
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
        data_api = "/LyricBridge/admin/data"
        try:
            call(data_api + "/overview", anonymous=True)
            raise AssertionError("Anonymous Data API access accepted")
        except urllib.error.HTTPError as error:
            assert error.code == 401
        saved_records = call_json(
            data_api + "/records?category=originals&itemId=" + public_id
        )
        saved_target = next(
            record["target"]
            for record in saved_records["items"]
            if record["target"]["kind"] == "saved-original"
        )
        inspected_original = call_json(
            data_api + "/detail?" + urllib.parse.urlencode(saved_target)
        )
        assert inspected_original["readableText"]
        assert inspected_original["displayType"] == "Original lyrics"
        assert inspected_original["inspection"]["lines"]
        assert all(
            line.get("startSeconds") is None or line["startSeconds"] < 86400
            for line in inspected_original["inspection"]["lines"]
        )
        assert any(
            link["role"] == "source" and link["target"]["kind"] == "document"
            for link in inspected_original["inspection"]["relationships"]
        )
        listener_preferences = {
            "kind": "preferences",
            "id": listener["Id"].replace("-", "").lower(),
        }
        targeted = call_json(
            data_api + "/preview", "POST", {"targets": [listener_preferences]}
        )
        removed_preferences = call_json(
            data_api + "/execute",
            "POST",
            {"token": targeted["token"], "confirmed": True},
        )
        assert removed_preferences["complete"]
        assert removed_preferences["outcomes"][0]["status"] == "deleted"
        assert call_json("/LyricBridge/preferences") == admin_preferences
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
        data_api = "/LyricBridge/admin/data"
        overview = call_json(data_api + "/overview")
        assert overview["activeStoragePath"] == runtime["activeStoragePath"]
        assert call_json(data_api + "/accounts")["total"] >= 1
        assert isinstance(call_json(data_api + "/records")["items"], list)
        configuration["StoragePath"] = "/config/data/unused-pending-path"
        configuration["Sources"][0]["Credential"] = "fixture-factory-reset-secret"
        call(f"/Plugins/{PLUGIN}/Configuration", "POST", configuration)
        inspected = call_json(data_api + "/configuration")
        assert "fixture-factory-reset-secret" not in json.dumps(inspected)
        assert inspected["sources"][0]["credentialPresent"]
        preview = call_json(data_api + "/preview", "POST", {"action": "factory-reset"})
        assert preview["confirmation"] == "FACTORY RESET"
        result = call_json(
            data_api + "/execute",
            "POST",
            {
                "token": preview["token"],
                "confirmation": "FACTORY RESET",
                "confirmed": True,
            },
        )
        assert result["complete"], result
        assert call_json(data_api + "/records")["total"] == 0
        restored = call_json(f"/Plugins/{PLUGIN}/Configuration")
        assert restored["StoragePath"] in ("", overview["activeStoragePath"])
        assert all(not source["Credential"] for source in restored["Sources"])
        assert all(not c["ApiKey"] for c in restored["ServiceSetup"]["Connections"])
        assert not call_json("/LyricBridge/admin/runtime")["restartRequired"]
        restart_server()
        restarted = call_json(f"/Plugins/{PLUGIN}/Configuration")
        assert restarted["StoragePath"] == restored["StoragePath"]
        assert all(not source["Credential"] for source in restarted["Sources"])
        assert call_json(data_api + "/records")["total"] == 0
        # Restore disabled synthetic sources before the remaining uninstall checks.
        configuration = restarted
        for source in configuration["Sources"]:
            source["Enabled"] = False
        print(
            "PASS: administrator Data API, credential exclusion, factory reset, active-path retention and restart persistence.",
            flush=True,
        )
        # A rejected settings schema must leave Jellyfin, the admin page, assets,
        # and independent diagnostics reachable without rewriting the settings file.
        plugin_info = next(
            p
            for p in call_json("/Plugins")
            if p["Id"].lower().replace("-", "") == PLUGIN.replace("-", "")
        )
        settings_path = (
            "/config/plugins/configurations/" + plugin_info["ConfigurationFileName"]
        )
        saved_xml = docker("exec", CONTAINER, "cat", settings_path)
        invalid_xml = saved_xml.replace(
            "<SchemaVersion>1</SchemaVersion>", "<SchemaVersion>999</SchemaVersion>"
        )
        assert invalid_xml != saved_xml
        subprocess.run(
            [
                "docker",
                "exec",
                "-i",
                CONTAINER,
                "sh",
                "-c",
                'cat > "$1"',
                "sh",
                settings_path,
            ],
            input=invalid_xml,
            text=True,
            check=True,
        )
        restart_server()
        startup = call_json("/LyricBridge/admin/startup")
        assert startup["state"] == "blocked" and startup["phase"] == "settings", startup
        assert docker("exec", CONTAINER, "cat", settings_path) == invalid_xml
        assert call_json("/LyricBridge/admin/upgrades") == []
        try:
            call_json("/LyricBridge/service-options")
            raise AssertionError("Blocked plugin accepted normal work")
        except urllib.error.HTTPError as error:
            assert error.code == 503
        assert (
            "LyricBridgeConfig"
            in urllib.request.urlopen(
                urllib.request.Request(
                    base + "/web/configurationpage?name=lyricbridge",
                    headers={"Authorization": authorization + f', Token="{token}"'},
                )
            )
            .read()
            .decode()
        )
        subprocess.run(
            [
                "docker",
                "exec",
                "-i",
                CONTAINER,
                "sh",
                "-c",
                'cat > "$1"',
                "sh",
                settings_path,
            ],
            input=saved_xml,
            text=True,
            check=True,
        )
        restart_server()
        for _ in range(100):
            if call_json("/LyricBridge/admin/startup")["state"] == "ready":
                break
            time.sleep(0.1)
        assert call_json("/LyricBridge/admin/startup")["state"] == "ready"
        print(
            "PASS: rejected schema preserves settings; Jellyfin and admin diagnostics remain available.",
            flush=True,
        )
        configuration["EnableWebRenderer"] = False
        call(f"/Plugins/{PLUGIN}/Configuration", "POST", configuration)
        call("/LyricBridge/admin/web-renderer/repair", "POST", {})
        assert "<!-- LyricBridge managed assets -->" not in renderer_index()
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
        # A second owned fixture proves a truly read-only image still starts safely.
        docker("rm", "-f", "-v", CONTAINER)
        readonly_plugin = root / "readonly-plugin"
        with zipfile.ZipFile(archive) as plugin_archive:
            plugin_archive.extractall(readonly_plugin)
        token = None
        docker(
            "run",
            "-d",
            "--platform",
            IMAGES["platform"],
            "--name",
            CONTAINER,
            "--label",
            "lyricbridge.disposable-test=true",
            "--read-only",
            "-p",
            f"127.0.0.1:{port}:8096",
            "--tmpfs",
            "/config:rw,size=3g",
            "--tmpfs",
            "/cache:rw,size=3g",
            "--tmpfs",
            "/tmp:rw,size=128m",
            "-v",
            f"{readonly_plugin}:/fixture-plugin:ro",
            "--entrypoint",
            "/bin/sh",
            IMAGE,
            "-c",
            f"mkdir -p /config/plugins/LyricBridge_{HOST_VERSION}; cp -r /fixture-plugin/. /config/plugins/LyricBridge_{HOST_VERSION}/; "
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
        call("/Startup/User")
        call("/Startup/User", "POST", {"Name": "fixture-admin", "Password": password})
        call("/Startup/Complete", "POST", {})
        token = call_json(
            "/Users/AuthenticateByName",
            "POST",
            {"Username": "fixture-admin", "Pw": password},
        )["AccessToken"]
        credentials.append(token)
        readonly_status = call_json(
            "/LyricBridge/admin/web-renderer/repair", "POST", {}
        )
        assert readonly_status["enabled"] and readonly_status["mechanism"] == "none", (
            readonly_status
        )
        assert "permissions" in readonly_status["result"]
        assert "<!-- LyricBridge managed assets -->" not in renderer_index()
        assert isinstance(call_json("/LyricBridge/services"), list)
        print(
            "PASS: read-only official image keeps Jellyfin and backend available with actionable injection failure.",
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
