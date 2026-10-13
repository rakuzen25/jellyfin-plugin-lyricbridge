#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
dotnet_executable=${LYRICBRIDGE_DOTNET:-dotnet}
run_dotnet() {
    if [ -n "${LYRICBRIDGE_REFERENCE_ARG:-}" ]; then
        "$dotnet_executable" "$@" "$LYRICBRIDGE_REFERENCE_ARG"
    else
        "$dotnet_executable" "$@"
    fi
}
node scripts/check-toolchain.mjs
"${LYRICBRIDGE_PNPM:-pnpm}" install --frozen-lockfile
if [ "${LYRICBRIDGE_PREPARED_WEB:-false}" = true ]; then
    python3 scripts/ci.py web-verify
else
    "${LYRICBRIDGE_PNPM:-pnpm}" --dir frontend run build
fi
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT INT TERM
run_dotnet restore src/LyricBridge.csproj --locked-mode --nologo -m:1 -p:NuGetAuditMode=all -p:WarningsAsErrors=NU1900
run_dotnet publish src/LyricBridge.csproj --no-restore -c Release -o "$staging/plugin" --nologo -m:1 -p:UseSharedCompilation=false
python3 scripts/package-artifacts.py "$staging" "$@"
