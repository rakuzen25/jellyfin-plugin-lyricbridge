# Browser validation

From the repository root, run `pnpm install --frozen-lockfile`, then
`pnpm --dir browser-tests exec playwright install --with-deps chromium firefox webkit`
and `pnpm --dir browser-tests test`. The maintained `*.spec.cjs` suite intercepts every request and uses
synthetic accounts, responses and audio. It needs no running Jellyfin server,
credentials or paid service. Projects cover desktop/mobile Chromium, Firefox
and WebKit. Screenshots and traces belong in ignored `results/`.

The standalone preview-era diagnostics have been removed. Their retained
behavior is covered by maintained isolated fixtures; `TEST_COVERAGE.md` lists
the historical inventory and coverage mapping. No test may restore fixed-server
or direct-production-database execution.

Real-server validation lives in `tests/PackageInstallation.py`. That harness
creates and destroys its own official-image container, accounts, catalog and
read-only media fixtures; it accepts no arbitrary server URL.

For the reproducible Linux acceptance environment, run `pnpm install --frozen-lockfile`
and `scripts/test-browser.sh` from the repository root. The script pins the official
Playwright image by digest and disables external networking. CI uses this same image.
The committed visual baselines cover paused multilingual playback and Display settings
on all four projects; `visual-baseline-provenance.json` records the pre-extraction
asset hashes. Update those images only after reviewing an intentional visual change.

`long-session.spec.cjs` performs twelve track/artwork and hide/show transitions
with sixty seconds of actual playback on each Chromium viewport. It records CDP
script/layout work and renderer ownership counts, then verifies complete disposal.
Firefox/WebKit skip this CDP-specific measurement; their lifecycle and artwork
regressions remain in the regular cross-browser suite. Allow about two minutes
per long-session case. The before/after performance script supports `--long`
after its baseline/current local asset directory arguments.
