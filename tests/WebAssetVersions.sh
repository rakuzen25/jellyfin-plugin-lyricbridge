#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
python3 - <<'PY'
from pathlib import Path
import subprocess, tempfile, re
with tempfile.TemporaryDirectory(prefix='lyricbridge-asset-version-') as directory:
    root=Path(directory); assets=root/'assets'; assets.mkdir(); web=root/'web'; web.mkdir()
    (web/'index.html').write_text('<head><script src="unrelated.js"></script></head>')
    for name in ('lyricbridge.js','lyricbridge.css','jellyfin-lyric-motion.js','jellyfin-lyric-motion.css'):
        (assets/name).write_text(name)
    command=['python3','scripts/web-assets.py','--web-root',str(web),'--assets',str(assets)]
    subprocess.run(command,check=True); first=(web/'index.html').read_text()
    subprocess.run(command,check=True); assert (web/'index.html').read_text()==first
    (assets/'lyricbridge.js').write_text('changed')
    subprocess.run(command,check=True); second=(web/'index.html').read_text()
    for content in (first,second):
        versions=re.findall(r'\?v=([0-9a-f]{16})',content)
        assert len(versions)==4 and len(set(versions))==1
        assert '<script src="unrelated.js"></script>' in content
    assert first!=second
print('PASS: current installer is idempotent and versions all assets when content changes.')
PY
