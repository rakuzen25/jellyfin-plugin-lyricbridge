#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Pin browser binaries, fonts and system libraries as well as Playwright's locked package.
# renovate: datasource=docker depName=mcr.microsoft.com/playwright
image=mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f
node browser-tests/check-image.mjs
# A local concurrent invocation must not delete another run's reports/traces.
results_dir=$(mktemp -d "$PWD/browser-tests/results-run.XXXXXX")
CI_BROWSER_OUTPUT_DIR=${results_dir##*/}
export CI_BROWSER_OUTPUT_DIR
# Run the CLI installed by the host's frozen pnpm workspace. The offline image
# needs no package-manager bootstrap or network access.
exec docker run --rm --network none -e CI_BROWSER_GROUP -e CI_BROWSER_OUTPUT_DIR -v "$PWD:/work" -w /work/browser-tests "$image" \
    sh -c 'node check-image.mjs --inside && exec node node_modules/playwright/cli.js test "$@"' sh "$@"
