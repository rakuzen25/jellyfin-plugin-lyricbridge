#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
dotnet_executable=${LYRICBRIDGE_DOTNET:-dotnet}
case "${1:-}" in
    "") options=(--verify-no-changes) ;;
    --fix) options=() ;;
    *) echo "Usage: bash scripts/checks/format-dotnet.sh [--fix]" >&2; exit 2 ;;
esac
# Keep vendored and generated code outside the maintained formatting boundary.
files=()
while IFS= read -r -d '' file; do files+=("$PWD/$file"); done < <(
    find src tests -type d \( -name bin -o -name obj \) -prune -o -type f -name '*.cs' -print0
)
if [ "${#files[@]}" -eq 0 ]; then echo "No maintained C# files found" >&2; exit 1; fi
projects=()
while IFS= read -r -d '' project; do projects+=("$project"); done < <(
    find src tests -type d \( -name bin -o -name obj \) -prune -o -type f -name '*.csproj' -print0
)
if [ "${#projects[@]}" -eq 0 ]; then echo "No maintained C# projects found" >&2; exit 1; fi
for project in "${projects[@]}"; do
    "$dotnet_executable" restore "$project" --locked-mode -m:1 -p:NuGetAudit=false
    "$dotnet_executable" format "$project" --no-restore "${options[@]}" --include "${files[@]}"
done
