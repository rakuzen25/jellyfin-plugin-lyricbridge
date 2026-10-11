#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Pin browser binaries, fonts and system libraries as well as Playwright's locked package.
image=mcr.microsoft.com/playwright@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d
# Run the CLI installed by the host's frozen pnpm workspace. The offline image
# needs no package-manager bootstrap or network access.
exec docker run --rm --network none -v "$PWD:/work" -w /work/browser-tests "$image" node node_modules/playwright/cli.js test "$@"
