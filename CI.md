# Validation and release execution

CI selects **check groups**, not individual backend methods. Selection is conservative;
unknown paths and missing diff history require the full suite. `scripts/ci.py` is the
single impact/evidence policy; `tests/CiPolicy.py` exercises its failure paths.

## What runs

| Group | Inputs and invariant | Execution |
| --- | --- | --- |
| Frontend | Maintained TS, checked tooling, lint/format/unused-code rules, unit decisions | One Linux job; strict build produces browser assets once |
| Backend | C# application, SQLite transactions, host adaptation and locked dependencies | All discoverable backend tests; isolated roots and mocked providers |
| Tooling | Python checks, architecture boundaries, release/catalog/local fixture logic | One independent job |
| Workflow | API state, preferences, search, generation, failed saves and stale responses | Desktop Chromium, two functional workers |
| Rendering | Playback, layout, native transport, artwork, preview, accessibility and disposal | Separate Chromium desktop/mobile, Firefox and WebKit jobs |
| Performance | Sustained playback, generation/navigation and resource/heap bounds | Separate desktop/mobile Chromium jobs, one worker each |
| Artifacts | Archive/license/source inventory, advisories, reproducibility and installed integration | Clean package, followed by parallel comparison/install jobs; advisories independent |

`browser-tests/groups.json` must classify every spec exactly once. Workflow test titles
use `@workflow`; the banner and saved-version typography cases uses `@layout` and also runs in
the rendering matrix. The configuration rejects unclassified files. Screenshot
baselines remain unchanged. Physical GPU/mobile power consumption is not tested here.

Documentation-only changes do not build/test the application. Release metadata always
gets identity validation; a release always builds and verifies its own artifacts.
Renderer/runtime/CSS and shared browser dependency changes require performance coverage.
Packaging-only changes do not independently trigger five-minute browser sessions.
Backend contracts also exercise browser consumers; shared CI policy and unknown paths
fall back to the full gate. The Actions impact summary records selected, reused and
unneeded groups.

## Evidence and retries

A `lyricbridge-validation-receipt` artifact records checked commit/tree, orchestrating
workflow SHA/run/repository, policy/input hashes, group results and final artifact hashes.
Fingerprint inputs include fixtures, test/build settings, locked dependencies, pinned
SDK/Node requirements, official reference/bootstrap and browser image identities.
Only the numeric release version in `Directory.Build.props` and matching own-project
lockfile ranges are normalized for code-check evidence. Identity validation still runs
on each candidate; ABI/GUID/build settings and external dependency versions/hashes remain
inputs. Artifact fingerprints and build receipts use the exact, unnormalized source.

Reuse accepts authenticated same-repository main/release-please or explicitly tagged
release runs from the allowlisted workflows. Same-repository PR code evidence becomes
eligible only after GitHub confirms that exact PR head merged into main; unmerged/fork
PRs cannot supply evidence. This avoids rerunning identical code after a reviewed merge. It never accepts fork evidence or a
package cache as a test result. The newest matching failure blocks older green reuse;
missing/expired/malformed evidence requires executing the checks. Explicit `full`
validation bypasses reuse. Fresh artifact gates and advisory checks are never reused.

An upload-only retry requires the exact tagged source and complete successful release
receipt with identical downloaded bytes. During an automatic attach, the parent run is
still in progress, so the completed aggregate gate and full receipt are both checked.
A previous-run retry additionally requires completed validation, even if a later attach
failed. Receipts older than 24 hours require fresh release validation/advisories.
Old candidates without receipts cannot use upload-only retries; validate them again.

## Scheduled safety

The daily lightweight sentinel compares meaningful group fingerprints against successful
**full** validation. If unchanged, it skips the expensive suite. Documentation/release
bookkeeping alone does not cause a full run. New runtime/dependency/test/tooling inputs
without a matching full pass trigger one full run. The shared main validation concurrency
prevents a scheduled run from duplicating active main validation. Idle safety receipts carry forward the authenticated full input baseline, so daily
no-op runs do not force a full run merely by pushing older evidence out of the search
window. This never renews artifact or advisory evidence. Manual safety runs
always execute the full suite. Missing evidence falls back conservatively.

## Builds and caches

Browser jobs consume one verified `browser-assets` bundle. The candidate is assembled in
a disposable clean source root using that bundle after checking its input and asset
hashes. A second independent clean root rebuilds from the editable-source archive and
compares all five release artifacts. No compiled outputs are shared between these roots.
Dependency caches are allowed, with frozen/locked restoration in every build.

Official references are cached by bootstrap policy (including image digest/platform) and
checked against their recorded hashes on every cache hit. Mismatches re-bootstrap.
NuGet, pnpm and pip caches accelerate restoration but provide no validation evidence.
Each local browser invocation owns a separate `browser-tests/results-run.*` directory
so concurrent runs cannot delete each other’s traces. Stress projects disable tracing
because DOM snapshots perturb the measured workload; failed screenshots and incremental
performance JSON remain available. Browser reports, functional failure
traces/screenshots, stress JSON and backend TRX/logs are uploaded
on failures. Explicit Bash pipefail prevents a logging pipeline from hiding test failures. Installation and reproducibility logs are retained separately.

## Local commands

```sh
pnpm check
pnpm build && pnpm test
python3 tests/CiPolicy.py
python3 tests/ReleaseBoundaries.py
python3 tests/Catalog.py
python3 tests/ReleaseAutomation.py
python3 tests/LocalJellyfin.py

dotnet restore tests/StorageTests.csproj --locked-mode
dotnet test tests/StorageTests.csproj --no-restore

CI_BROWSER_GROUP=workflow scripts/test-browser.sh --project workflow-chromium --workers=2
CI_BROWSER_GROUP=rendering scripts/test-browser.sh --workers=2
CI_BROWSER_GROUP=performance scripts/test-browser.sh --project stress-chromium --workers=1
CI_BROWSER_GROUP=performance scripts/test-browser.sh --project stress-mobile-chromium --workers=1

# Complete browser coverage, or a manual full validation in GitHub Actions:
scripts/test-browser.sh --workers=1

# Two clean package builds total; configure release URLs for --release:
python3 scripts/clean-package.py
python3 tests/PackageArtifacts.py
python3 tests/ReproducibleBuild.py
python3 tests/PackageInstallation.py
```

Standalone `scripts/package.sh` remains self-contained; it produces a package but does
not assert that its source root was clean. Use `clean-package.py` for reproducibility
acceptance. CI's prepared-web option refuses stale inputs/assets rather than silently
skipping frontend verification.

## Measuring improvement

The [last successful serial run](https://github.com/rakuzen25/jellyfin-plugin-lyricbridge/actions/runs/38133176042/job/114451861420)
executed its validation job in 10m25s (excluding its initial queue). Step timings:

| Step | Duration |
| --- | ---: |
| Official reference bootstrap | 27s |
| Backend restore + build/tests | 72s |
| Serial browser suite | 6m23s |
| Candidate packaging | 16s |
| Two additional reproducibility builds | 33s |
| Disposable installed-plugin validation | 60s |

This published-source run predates the current extended stress coverage, so it is not
a direct timing baseline for every local scenario. It does establish the serial cost
and three-build duplication. Local backend execution after splitting the scenarios was
49s for 78 passing tests. Future before/after Actions comparisons must use equivalent
inputs and coverage; do not infer speedups from changing the workload alone.

Compare Actions critical-path durations on comparable changes after this workflow is
pushed. Targets are a few minutes for ordinary checks and parallel five-minute sessions
for rendering changes, excluding queues/downloads. Do not claim measured CI speedups
until the new jobs have executed on GitHub. Runner minutes may rise while wall time falls.
