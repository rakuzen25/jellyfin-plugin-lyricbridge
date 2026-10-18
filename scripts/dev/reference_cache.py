"""Record/check the pinned official reference cache; mismatches require bootstrap."""

import hashlib
import json
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
reference = root / ".build/jellyfin"
image = re.search(
    r"image='([^']+)'", (root / "scripts/dev/bootstrap-references.sh").read_text()
)
assert image
expected = image[1]
files = {
    p.name: hashlib.sha256(p.read_bytes()).hexdigest()
    for p in sorted(reference.glob("*"))
    if p.suffix in {".dll", ".so"}
}
assert {
    "MediaBrowser.Common.dll",
    "MediaBrowser.Controller.dll",
    "MediaBrowser.Model.dll",
} <= files.keys(), "Incomplete references"
assert (reference / "image.txt").read_text().strip() == expected, (
    "Reference image changed"
)
current = {"image": expected, "platform": "linux/amd64", "files": files}
path = reference / "cache-integrity.json"
if sys.argv[1] == "record":
    path.write_text(json.dumps(current, indent=2) + "\n")
elif json.loads(path.read_text()) != current:
    raise SystemExit("Official reference cache integrity mismatch")
