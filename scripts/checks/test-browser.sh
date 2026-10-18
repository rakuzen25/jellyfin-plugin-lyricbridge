#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
# Pin browser binaries, fonts and system libraries as well as Playwright's locked package.
# renovate: datasource=docker depName=mcr.microsoft.com/playwright
image=mcr.microsoft.com/playwright:v1.64.1-noble@sha256:7852dc5a7d72f5fe458a597d690f6c42fbc8e9e26ddfa95f8e6ef552558d9bbf
node tests/browser/check-image.mjs
# A local concurrent invocation must not delete another run's reports/traces.
results_dir=$(mktemp -d "$PWD/tests/browser/results-run.XXXXXX")
CI_BROWSER_OUTPUT_DIR=${results_dir##*/}
export CI_BROWSER_OUTPUT_DIR
# Run the CLI installed by the host's frozen pnpm workspace. The offline image
# needs no package-manager bootstrap or network access.
exec docker run --rm --network none -e CI_BROWSER_GROUP -e CI_BROWSER_OUTPUT_DIR -v "$PWD:/work" -w /work/tests/browser "$image" \
    sh -c 'node check-image.mjs --inside && exec node node_modules/playwright/cli.js test "$@"' sh "$@"
