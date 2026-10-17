# Validation and release execution

Use these checks after [toolchain setup](DEVELOPMENT.md#prepare-the-toolchain).
CI selects check groups conservatively; local commands below let you exercise the
same boundaries. `scripts/ci.py` is the entrypoint, with classification/fingerprints in
`ci_policy.py`, evidence authentication in `ci_evidence.py`, and scheduling in
`ci_planning.py`. These modules and `source_inventory.py` participate in policy hashes.

## Execution groups

The impact summary records classifications and selected, reused, or unneeded groups:

| Group       | Boundary                                                                       | Execution                                                                 |
| ----------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Metadata    | Renovate JSON, CODEOWNERS, issue/PR templates                                  | Syntax and targeted formatting; no application build                      |
| Frontend    | Maintained TS/tooling, lint, formatting, unused code, unit decisions           | Linux strict build produces browser assets once                           |
| Backend     | Domain workflows, SQLite transactions, provider formats, Jellyfin adaptation   | All discoverable backend tests with isolated storage and mocked providers |
| Tooling     | Architecture checks, CI/release policy, sandbox and installer logic            | Independent job                                                           |
| Workflow    | Preferences, search, imports, generation, stale responses, failed saves        | Desktop Chromium, two workers                                             |
| Rendering   | Playback, layout, native transport, previews, accessibility, artwork, disposal | Desktop/mobile Chromium, Firefox, WebKit                                  |
| Performance | Sustained playback, resource ownership, CPU/heap bounds                        | Separate desktop/mobile Chromium jobs, one worker each                    |
| Artifacts   | Archive/license inventory, advisories, reproducibility, installed integration  | Clean package, independent rebuild and installation; fresh advisories     |

`browser-tests/groups.json` classifies each spec exactly once.
`@workflow` cases run only in the workflow project; `@layout` cases also run in the
rendering matrix. The configuration rejects unclassified specs.
The maintained browser suite intercepts external requests and uses synthetic
accounts, responses, and audio; it requires no running server or paid service.
Installed-server checks own disposable accounts, read-only media, configuration,
workers, and storage, and accept no arbitrary server URL.

Backend tests use xUnit v3 with Microsoft Testing Platform on the pinned .NET 10 SDK.
Up to four collections run concurrently; static File Transformation callback tests
are nonparallel. Workers stop before stores clear only their own SQLite pools.
The gate rejects zero-test runs and retains console/TRX evidence.

## Coverage map

Keep tests at different boundaries when they protect different contracts:

| Contract                                                                                   | Primary maintained checks                                                                  |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Toolchain identity, image agreement, upgrade policy                                        | `pnpm test:tooling`, toolchain/browser guards                                              |
| Ranking, formats/imports, transcription/boundaries, shared generation quotas and deletion transactions | `tests/StorageTests.csproj` scenarios                                                      |
| Search/preview/generation ownership, account changes, failed writes                        | Frontend unit tests and workflow browser group                                             |
| Multilingual layout, timing/follow, settings, artwork races, teardown                      | Rendering browser group                                                                    |
| Five-minute playback, generation/navigation, resource/heap/CPU growth                      | `long-session.spec.cjs` in performance projects                                            |
| Authentication, libraries, native lyrics, injection, reset, restart, uninstall             | `tests/PackageInstallation.py` (including synthetic remote audio, FFmpeg and native cue ends) |
| Source classification, receipt trust, archive/source/notices, reproducibility              | `tests/CiPolicy.py`, `ReleaseAutomation.py`, `PackageArtifacts.py`, `ReproducibleBuild.py` |

Live credentialed providers, ARM64, and physical-device power/thermals need separate
evidence. [Performance validation](PERFORMANCE.md) distinguishes sustained acceptance
from exploratory comparisons and physical measurements. Test counts/results belong in
run artifacts.

## Selection and evidence

Every tracked file and changed path must match `scripts/ci_policy.py`, including
deletes and both sides of renames. Unknown paths fail early; add an explicit rule and
regression rather than a catch-all. Documentation-only changes skip application tests.
Automation metadata gets lightweight checks; runtime, shared browser, backend-contract,
and CI-policy changes select their affected groups conservatively. Release identity
is always checked, and releases always verify their own final artifacts.

Ordinary pushes cancel unfinished validation on the same branch and compare against
the newest trustworthy successful ancestor. PRs compare against their merge base.
Baseline fingerprint differences also require coverage. Missing history or trusted
baseline requires all groups, with matching completed successes eligible for reuse.
Explicit `full` validation executes everything without reuse.

Schema-3 receipts record commit/tree, workflow SHA/run/repository/attempt, policy/input
hashes, comparison/baseline identity, group results, reuse origins, and artifact hashes.
A successful full run establishes coverage; a successful cumulative push extends it.
Baseline/evidence searches inspect at most three pages of 100 runs.
Expired receipts, non-ancestor commits, unavailable APIs, and incomplete coverage cannot
establish a baseline.

Reuse must satisfy all of these conditions:

- Evidence comes from allowlisted same-repository main/release-please or tagged release
  workflows. Same-repository PR evidence qualifies only after GitHub confirms that exact
  PR head merged into main. Fork and unmerged PR evidence never qualifies.
- Inputs and policy match, and every required matrix job completed successfully.
  An authenticated completed group can qualify even when its parent run failed,
  cancelled, timed out, or is still running. A baseline still requires complete success.
- Receipt run attempts match; reuse chains resolve to original successful jobs with
  cycle/depth protection. Missing, malformed, unfinished, or expired evidence reruns.
  A newer matching failure blocks older green evidence.

Inputs include fixtures, build/test settings, locks, toolchain pins, and official
reference/browser identities. Only the numeric release version in `Directory.Build.props`
and matching own-project lockfile ranges are normalized for code-check reuse.
ABI/GUID/build settings and external dependency versions/hashes remain inputs.
Artifact/source fingerprints remain exact. Fresh artifact gates and advisories are
never reused as code evidence.

For attachment, the current automatic run must have a completed aggregate gate and
full receipt. Previous-run upload retries require completed validation and identical
downloaded bytes. See [release recovery](RELEASING.md#recover-a-failed-artifact-upload)
for the 24-hour limit and immutable receipt/assets.

## Scheduled safety

The daily sentinel compares meaningful inputs against successful full validation.
Matching inputs skip expensive checks; changed runtime/dependency/test/tooling inputs
without a full pass trigger one. Idle safety receipts carry forward the authenticated
full baseline without renewing artifact/advisory evidence. Missing evidence falls back
to full coverage, and manual safety runs always execute everything.

Safety and release attachment do not cancel on ordinary branch pushes.

## Builds, caches, and reports

CI uses Ubuntu 26.04 and exact repository toolchain pins. Every Python-invoking job
installs the Python pin; only tooling/install jobs restore checker dependencies.
Restore explicitly with frozen/locked dependencies under the
[upgrade policy](DEVELOPMENT.md#upgrade-dependencies).

Browser jobs consume one hash-verified `browser-assets` bundle. A clean disposable
source root assembles the candidate; a second independent root rebuilds from the source
archive and compares all five release artifacts. Compiled outputs are not shared.
Official reference caches verify recorded hashes and image digest/platform; mismatches
re-bootstrap. Dependency caches accelerate restoration without providing test evidence.

The official Playwright image is digest-pinned. Guards check package/image versions
before execution and browser executables inside the offline container.
Each `scripts/test-browser.sh` invocation owns a `browser-tests/results-run.*`
directory. Stress projects disable tracing because DOM snapshots perturb measurements.
Failures retain screenshots, browser reports, functional traces, incremental performance
JSON, backend TRX/logs, and separate install/reproducibility logs.
Bash pipefail prevents logging pipelines from hiding failures.

Screenshot baselines require visual review before intentional updates.
`browser-tests/visual-baseline-provenance.json` records the assets used for the committed
desktop/mobile Chromium, Firefox, and WebKit screenshots.

## Local commands

After [toolchain setup](DEVELOPMENT.md#prepare-the-toolchain), run the checks relevant to
your changes. `pnpm check` includes frontend checks, Ruff/Mypy, and .NET whitespace
formatting; `dotnet format whitespace` covers maintained C# without semantic fixes or
implicit restore. Backend commands use the Microsoft Testing Platform `--project` form.

```sh
pnpm check
pnpm test:tooling
pnpm build && pnpm test
python3 tests/CiPolicy.py
python3 tests/ReleaseBoundaries.py
python3 tests/ReleaseAutomation.py
python3 tests/LocalJellyfin.py

dotnet restore tests/StorageTests.csproj --locked-mode
TESTINGPLATFORM_TELEMETRY_OPTOUT=1 dotnet test --project tests/StorageTests.csproj --no-restore \
  --results-directory dist/evidence --report-xunit-trx --report-xunit-trx-filename backend.trx \
  --minimum-expected-tests 1
```

Choose one browser group, or run the complete suite:

```sh
CI_BROWSER_GROUP=workflow scripts/test-browser.sh --project workflow-chromium --workers=2
CI_BROWSER_GROUP=rendering scripts/test-browser.sh --workers=2
CI_BROWSER_GROUP=performance scripts/test-browser.sh --project stress-chromium --workers=1
CI_BROWSER_GROUP=performance scripts/test-browser.sh --project stress-mobile-chromium --workers=1
scripts/test-browser.sh --workers=1
```

For native browser debugging instead of the pinned Linux acceptance image:

```sh
pnpm --dir browser-tests exec playwright install --with-deps chromium firefox webkit
pnpm --dir browser-tests test
```

For package acceptance, the following commands build a clean candidate, inspect it,
rebuild independently, and install it into a disposable official server:

```sh
python3 scripts/clean-package.py
python3 tests/PackageArtifacts.py
python3 tests/ReproducibleBuild.py
python3 tests/PackageInstallation.py
```

Set [release URLs](RELEASING.md#build-local-release-artifacts) and pass `--release` to
`clean-package.py` for publishable artifacts. Standalone `scripts/package.sh` builds
without asserting a clean source root. Prepared-web mode rejects stale inputs/assets.
Older ZIPs are retained under `dist/previous-*` and do not supply current validation.

Run `python3 scripts/ci.py metadata-check` for automation metadata. It parses JSON,
formats/parses relevant YAML/Markdown with Prettier, and checks CODEOWNERS syntax/local
paths; it does not validate remote permissions or the complete Renovate schema.

## Next steps

- [Measure playback](PERFORMANCE.md) when rendering changes need performance evidence.
- [Publish verified assets](RELEASING.md) after release gates pass.
- Compare CI critical-path duration and runner minutes only for equivalent inputs,
  coverage, and hardware; separate queue/download time from execution.

Service setup coverage includes legacy migration, shared connections, option identity,
explicit playback choices, and configuration/job compatibility with mocked providers.
