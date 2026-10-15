# Validation and release execution

CI selects **check groups**, not individual backend methods. Selection is conservative;
unknown paths fail the impact job before expensive checks, while missing diff history
requires full coverage. `scripts/ci.py` is the
single impact/evidence policy; `tests/CiPolicy.py` exercises its failure paths.

## What runs

| Group | Inputs and invariant | Execution |
| --- | --- | --- |
| Metadata | Renovate JSON, CODEOWNERS, issue/PR templates | Independent syntax and targeted formatting checks; no frontend bundle |
| Frontend | Maintained TS, checked tooling, lint/format/unused-code rules, unit decisions | One Linux job; strict build produces browser assets once |
| Backend | C# application, SQLite transactions, host adaptation and locked dependencies | All discoverable backend tests; isolated roots and mocked providers |
| Tooling | Python checks, architecture boundaries, release/local fixture logic | One independent job |
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
Backend contracts also exercise browser consumers; shared CI policy
requires the full gate. The Actions impact summary records classifications, selected, reused and
unneeded groups.

## File classification

Every maintained tracked file and changed path must match a rule in `scripts/ci_policy.py`.
New files under established source/test directories inherit that directory's conservative
coverage. Unknown root files or unknown GitHub configuration fail quickly with their
paths; add an explicit rule and regression before validation can pass. Deletes and both
sides of renames are checked too. Do not use a catch-all rule to silence the failure.

The same classification owns selection and fingerprints. Automation metadata does not
invalidate runtime evidence or trigger packaging; a scheduled metadata-only change runs
the lightweight metadata group without browser stress. Workflows, shared Actions and
selection policy retain broad coverage. Editable source archives include repository
metadata and always use exact current contents when release artifacts are built.

Run `python3 scripts/ci.py metadata-check` with the pinned pnpm/Node environment for
local checks. JSON is parsed, YAML/Markdown are parsed/formatted by Prettier, and
CODEOWNERS patterns/owners receive basic syntax and tracked-local-path checks. This
does not claim complete Renovate schema or remote owner-permission validation.

## Evidence and retries

Ordinary pushes cancel unfinished validation on the same branch. Their comparison
starts at the newest trustworthy successful ancestor, not the previous push, so
cancelled or failed commits remain covered. PRs compare against their merge base.
Code-group fingerprint differences from the baseline also require those groups.
Missing history or baseline evidence requires all groups, with reuse of matching
completed successes allowed. Explicit full validation still executes everything.

Schema-3 receipts include metadata checks and record comparison mode, baseline commit/run and coverage identity,
fallback reasons, and reused group origins. A successful full run establishes coverage;
a successful cumulative push extends it. Older narrow receipts cannot establish a
baseline. Baseline and evidence searches examine at most three pages of 100 runs.
Expired receipts, non-ancestor commits and unavailable APIs cannot establish coverage.
Group reuse does not depend on the parent run's outcome. Passed groups from cancelled,
failed, timed-out or still-running workflows qualify only with an authenticated receipt,
matching inputs/policy and completed successful jobs for every required matrix member.
Receipts record the run attempt; prior-attempt evidence cannot attest a retry. Reuse
chains resolve to the original successful jobs with cycle/depth protection. Missing
receipts, unfinished groups and newer matching failures require rerunning the checks.
Successful complete coverage is still required for a baseline, and all release artifact
gates must still pass before upload. Scheduled full-baseline reuse remains success-only.
Older receipts cannot attest the new metadata group. Changing this selection policy
requires broad validation once; subsequent metadata-only changes receive narrow checks.

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
without a matching full pass trigger one full run. Scheduled safety runs have an
independent concurrency group and are not cancelled by ordinary branch pushes.
Release attachment also remains non-cancelling. Idle safety receipts carry forward the authenticated full input baseline, so daily
no-op runs do not force a full run merely by pushing older evidence out of the search
window. This never renews artifact or advisory evidence. Manual safety runs
always execute the full suite. Missing evidence falls back conservatively.

## Builds and caches

CI uses Ubuntu 26.04, the exact Node/Python pins and pnpm version declared by
`package.json`. Every Python-invoking job installs `.python-version` before execution;
only tooling/install jobs restore Python checker dependencies. Release upload tooling
uses the executing revision's Python pin. Python 3.15 is the supported local minimum.

`node scripts/check-toolchain.mjs` verifies Node/pnpm before dependency restoration.
pnpm's automatic pre-script installation is disabled: restoration remains explicit
and frozen. Only esbuild may run dependency lifecycle scripts. Reviewed, exact-version
release-age exclusions do not authorize other versions.

Browser execution first checks the declared/installed Playwright version against the
tagged, digest-pinned noble image, then verifies browser executables inside the offline
container. Package/image updates belong to one Renovate group; paired patches may
automerge after current-base validation, while minor/major updates need review.

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

`pnpm check` includes Ruff formatting/linting, Mypy and .NET whitespace formatting,
in addition to the frontend checks. Python formatting is enforced in the tooling
job; .NET formatting is enforced in the backend job and its log is retained.
The .NET gate uses `dotnet format whitespace` with `.editorconfig`, covering maintained
`src/` and `tests/` C# files while excluding vendor and build output. It does not apply
semantic analyzer fixes or require reference assemblies/package restoration.
Use the pinned SDK from `global.json`; `LYRICBRIDGE_DOTNET` and `LYRICBRIDGE_PYTHON`
can override executable locations for local checks.

```sh
pnpm check
pnpm check:python
pnpm check:dotnet
# Apply formatting before checking again:
pnpm format:python
pnpm format:dotnet
pnpm build && pnpm test
python3 tests/CiPolicy.py
python3 tests/ReleaseBoundaries.py
python3 tests/ReleaseAutomation.py
python3 tests/LocalJellyfin.py

dotnet restore tests/StorageTests.csproj --locked-mode
TESTINGPLATFORM_TELEMETRY_OPTOUT=1 dotnet test --project tests/StorageTests.csproj --no-restore \
  --results-directory dist/evidence --report-xunit-trx --report-xunit-trx-filename backend.trx \
  --minimum-expected-tests 1

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
Clean candidate builds preserve older ZIPs under `dist/previous-*`, so only current
archives participate in fingerprints and uploads. Prior archives do not supply validation.

The CLI delegates local classification and fingerprints to `scripts/ci_policy.py`,
authenticated evidence and reuse checks to `scripts/ci_evidence.py`, and scheduling
and aggregation to `scripts/ci_planning.py`. All four modules participate in policy
fingerprints, so changes invalidate affected evidence.

## Measuring CI cost

Compare Actions critical-path durations using equivalent source inputs, coverage and
hardware. Separate queues/downloads from execution; compare wall time and runner
minutes separately. Long playback sessions test sustained ownership and remain risk-selected.
Cache hits accelerate restoration without attesting validation. Keep current timing and
artifact results in workflow evidence rather than carrying dated measurements in this guide.

Backend tests use xUnit v3 and Microsoft Testing Platform on the pinned .NET 10 SDK.
VSTest and older SDK test runners are unsupported. Tests run with up to four parallel collections. Each fixture owns its configuration,
workers and database pools; only the process-wide File Transformation callback tests
use a nonparallel collection. CI retains TRX and console evidence even on failure
and rejects runs that execute no tests.

Prettier checks maintained TypeScript, JavaScript tooling, JSON, YAML, frontend CSS
and administrator HTML. Generated output and vendored sources are excluded; the
demo HTML fixture is excluded because browser tests use exact inline-script hooks.

Catalog reconciliation, maintenance and merge tests run in [jellyfin-plugin-manifest](https://github.com/rakuzen25/jellyfin-plugin-manifest). LyricBridge retains release-manifest validation, receipt/attestation checks and publication notification.
