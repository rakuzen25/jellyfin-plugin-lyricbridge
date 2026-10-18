import subprocess
import tempfile
from pathlib import Path

with tempfile.TemporaryDirectory(prefix="lyricbridge-web-") as directory:
    root = Path(directory)
    index = root / "index.html"
    original = '<html><head><script src="main.js"></script></head><body></body></html>'
    index.write_text(original)
    command = [
        "python3",
        "-m",
        "scripts.installation.web_assets",
        "--web-root",
        str(root),
    ]
    subprocess.run(command, check=True)
    installed = index.read_text()
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

import re

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
        "python3",
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
