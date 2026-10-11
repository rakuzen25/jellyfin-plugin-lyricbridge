import subprocess
import tempfile
from pathlib import Path

with tempfile.TemporaryDirectory(prefix="lyricbridge-web-") as directory:
    root = Path(directory)
    index = root / "index.html"
    original = '<html><head><script src="main.js"></script></head><body></body></html>'
    index.write_text(original)
    command = ["python3", "scripts/web-assets.py", "--web-root", str(root)]
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
