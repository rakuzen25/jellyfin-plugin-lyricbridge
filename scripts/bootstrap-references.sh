#!/bin/sh
set -eu
repo=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
reference_dir=${1:-"$repo/.build/jellyfin"}
image='jellyfin/jellyfin@sha256:357724bf0ae27a672c7cbaa899db2d9abeb13dbd8657ccce750258a4c059d037'
platform=${LYRICBRIDGE_PLATFORM:-linux/amd64}
staging=$(mktemp -d)
container=''
cleanup() {
    if [ -n "$container" ]; then docker rm "$container" >/dev/null; fi
    rm -rf "$staging"
}
trap cleanup EXIT INT TERM
container=$(docker create --platform "$platform" "$image")
docker cp "$container:/jellyfin/." "$staging/"
python3 - "$staging" <<'PY'
import json,sys
from pathlib import Path
root=Path(sys.argv[1])
deps=json.loads((root/'jellyfin.deps.json').read_text())
assert all(key+'/12.2.0' in deps['libraries'] for key in ('Jellyfin.Common','Jellyfin.Controller','Jellyfin.Model')), 'Expected Jellyfin 12.2 reference assemblies'
runtime=json.loads((root/'jellyfin.runtimeconfig.json').read_text())
assert runtime['runtimeOptions']['tfm']=='net10.0', 'Expected .NET 10 runtime'
PY
mkdir -p "$reference_dir"
cp "$staging"/*.dll "$reference_dir/"
if [ -f "$staging/libe_sqlite3.so" ]; then cp "$staging/libe_sqlite3.so" "$reference_dir/"; fi
printf '%s\n' "$image" >"$reference_dir/image.txt"
printf 'Jellyfin references: %s\n' "$reference_dir"
