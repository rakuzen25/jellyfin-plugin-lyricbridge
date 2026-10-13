#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
dotnet_executable=${LYRICBRIDGE_DOTNET:-dotnet}
case "${1:-}" in
    "") options=(--verify-no-changes) ;;
    --fix) options=() ;;
    *) echo "Usage: bash scripts/format-dotnet.sh [--fix]" >&2; exit 2 ;;
esac
# Syntax-only formatting needs neither reference assemblies nor package restoration.
# Keep vendored and generated code outside the maintained formatting boundary.
files=()
while IFS= read -r -d '' file; do files+=("$PWD/$file"); done < <(
    find src tests -type d \( -name bin -o -name obj \) -prune -o -type f -name '*.cs' -print0
)
if [ "${#files[@]}" -eq 0 ]; then echo "No maintained C# files found" >&2; exit 1; fi
"$dotnet_executable" format whitespace . --folder "${options[@]}" --include "${files[@]}"
