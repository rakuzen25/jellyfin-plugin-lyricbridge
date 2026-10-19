import argparse
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from scripts.common.process import ROOT
from scripts.common.release_metadata import load_identity

parser = argparse.ArgumentParser(
    description="Check web installation using candidate ZIP assets or an explicit build directory."
)
parser.add_argument(
    "--assets",
    type=Path,
    help="Test these frontend assets instead of the candidate web ZIP",
)
args = parser.parse_args()

with tempfile.TemporaryDirectory(prefix="lyricbridge-web-") as directory:
    root = Path(directory)
    assets = args.assets
    if assets is None:
        assets = root / "candidate-assets"
        archive = ROOT / "dist" / f"lyricbridge-web-{load_identity().version}.zip"
        with zipfile.ZipFile(archive) as candidate:
            candidate.extractall(assets)
    index = root / "index.html"
    original = '<html><head><script src="main.js"></script></head><body></body></html>'
    index.write_text(original)
    command = [
        sys.executable,
        "-m",
        "scripts.installation.web_assets",
        "--web-root",
        str(root),
        "--assets",
        str(assets),
    ]
    subprocess.run(command, check=True)
    installed = index.read_text()
    for asset in assets.iterdir():
        if asset.suffix in {".js", ".css"}:
            assert (
                root / "lyricbridge" / asset.name
            ).read_bytes() == asset.read_bytes()
    subprocess.run(command, check=True)
    assert index.read_text() == installed
    assert installed.index("lyricbridge.js") < installed.index(
        "jellyfin-lyric-motion.js"
    )
    assert 'src="/lyricbridge' not in installed
    index.write_text(installed.replace("<body>", "<body>another extension"))
    subprocess.run(command + ["--uninstall"], check=True)
    assert index.read_text() == original.replace("<body>", "<body>another extension")
    assert (root / "index.html.lyricbridge-backup").read_text() == original
    assert not (root / "lyricbridge").exists()
    automatic = '<html><head><!-- LyricBridge managed assets --><script defer src="../LyricBridge/assets/lyricbridge.js?v=0123456789abcdef"></script><!-- /LyricBridge managed assets -->\n</head><body>unrelated</body></html>'
    index.write_text(automatic)
    subprocess.run(command + ["--uninstall"], check=True)
    assert index.read_text() == "<html><head></head><body>unrelated</body></html>"
    assert (root / "index.html.lyricbridge-backup").read_text() == original
print(
    "PASS: idempotent web install, relative URLs, script order, backup and scoped uninstall."
)

with tempfile.TemporaryDirectory(prefix="lyricbridge-asset-version-") as directory:
    root = Path(directory)
    assets = root / "assets"
    assets.mkdir()
    web = root / "web"
    web.mkdir()
    (web / "index.html").write_text('<head><script src="unrelated.js"></script></head>')
    for name in (
        "lyricbridge.js",
        "lyricbridge.css",
        "jellyfin-lyric-motion.js",
        "jellyfin-lyric-motion.css",
    ):
        (assets / name).write_text(name)
    command = [
        sys.executable,
        "-m",
        "scripts.installation.web_assets",
        "--web-root",
        str(web),
        "--assets",
        str(assets),
    ]
    subprocess.run(command, check=True)
    first = (web / "index.html").read_text()
    subprocess.run(command, check=True)
    assert (web / "index.html").read_text() == first
    (assets / "lyricbridge.js").write_text("changed")
    subprocess.run(command, check=True)
    second = (web / "index.html").read_text()
    for content in (first, second):
        versions = re.findall(r"\?v=([0-9a-f]{16})", content)
        assert len(versions) == 4 and len(set(versions)) == 1
        assert '<script src="unrelated.js"></script>' in content
    assert first != second
print(
    "PASS: current installer is idempotent and versions all assets when content changes."
)
