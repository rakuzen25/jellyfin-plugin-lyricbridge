"""Install/remove the optional renderer in an explicitly selected Jellyfin web root."""

import argparse
import hashlib
import re
import shutil
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--web-root", required=True, type=Path)
parser.add_argument(
    "--assets",
    type=Path,
    default=Path(__file__).resolve().parents[2] / "dist" / "web",
)
parser.add_argument("--uninstall", action="store_true")
args = parser.parse_args()
root = args.web_root.resolve()
index = root / "index.html"
if not index.is_file():
    parser.error("The selected web root must contain index.html.")
files = (
    "lyricbridge.css",
    "jellyfin-lyric-motion.css",
    "lyricbridge.js",
    "jellyfin-lyric-motion.js",
)
start = "<!-- LyricBridge managed assets -->"
end = "<!-- /LyricBridge managed assets -->"
text = index.read_text()
clean = re.sub(
    re.escape(start) + r".*?" + re.escape(end) + r"\n?", "", text, flags=re.DOTALL
)
backup = root / "index.html.lyricbridge-backup"
if args.uninstall:
    if clean != text:
        index.write_text(clean)
    # Remove only files installed by this tool, never the entire web root.
    managed = root / "lyricbridge" / ".managed-by-lyricbridge"
    if managed.is_file():
        for name in files:
            (managed.parent / name).unlink(missing_ok=True)
        managed.unlink()
        if not any(managed.parent.iterdir()):
            managed.parent.rmdir()
    print("Removed LyricBridge asset tags; the index backup was retained.")
else:
    if not all((args.assets / name).is_file() for name in files):
        parser.error("Assets directory is missing a required JS/CSS file.")
    if "</head>" not in clean:
        parser.error("index.html has no closing head tag.")
    if not backup.exists():
        shutil.copy2(index, backup)
    dest = root / "lyricbridge"
    dest.mkdir(exist_ok=True)
    version = hashlib.sha256(
        b"".join((args.assets / name).read_bytes() for name in files)
    ).hexdigest()[:16]
    for name in files:
        shutil.copy2(args.assets / name, dest / name)
    (dest / ".managed-by-lyricbridge").write_text("managed-by-lyricbridge\n")
    tags = [start]
    for name in files:
        # Relative paths retain Jellyfin's configured base URL and /web prefix.
        url = "lyricbridge/" + name + "?v=" + version
        tags.append(
            f'<link rel="stylesheet" href="{url}">'
            if name.endswith(".css")
            else f'<script defer src="{url}"></script>'
        )
    tags.append(end)
    index.write_text(clean.replace("</head>", "\n".join(tags) + "\n</head>", 1))
    print("Installed LyricBridge assets; restart/refresh Jellyfin Web as appropriate.")
