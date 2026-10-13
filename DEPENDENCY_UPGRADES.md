# Coordinated dependency migration

This change prepares development/build dependencies locally. It does not change the
plugin ABI, GUID, storage schema, version, production data or live deployment.

## Targets and policy

Node 26.11.1, pnpm 12.11.2, Python 3.15.0 and Ubuntu 26.04 runners; Playwright 1.64.0
with its official noble image digest; esbuild 0.28.2, typescript-eslint 8.71.2,
Mypy 2.4.0, Test SDK 18.10.1 and xUnit adapter 4.0.1. TypeScript stays at 5.9.3;
Renovate may propose versions below 7, with compiler minor/major changes reviewed.
.NET SDK and xUnit framework versions remain unchanged.

GitHub Actions remain SHA-pinned with release-line comments. Renovate can update
their digests and propose release upgrades. Major updates require manual review.

Routine patches/minors, pins and digests can automerge after required checks.
Package-manager/compiler/interpreter releases, runner OS changes, pre-1.0 esbuild
minor releases and provider/converter minor releases require manual review.
Playwright package/image patches and image digests are grouped and may automerge;
browser minors/majors remain manual. Mismatched browser versions fail before tests.
Backend test infrastructure and artifact actions each have their own group.

pnpm 12 uses `allowBuilds` (only esbuild approved), `strictDepBuilds: true` and
`pmOnFail: error`. Explicit frozen restoration replaces implicit pre-script installs.
The lockfile and exact-version release-age exclusions represent reviewed upgrades;
never add wildcard exclusions or authorize other dependency scripts to fix a failure.

## Local setup

Install Node from `.node-version`, pnpm from `package.json`, Python from `.python-version`
and .NET from `global.json`. Recreate a Python virtual environment made with an older
interpreter:

```sh
python3.15 -m venv .venv
.venv/bin/python -m pip install -r requirements-check.txt
node scripts/check-toolchain.mjs
pnpm install --frozen-lockfile
pnpm check
pnpm test:tooling
pnpm build && pnpm test
```

The browser script verifies the tagged image/digest and all required executables.
Keep the Playwright package, lockfile and image reference together in future upgrades.
Review screenshot changes caused by browser rasterization before updating baselines;
behavior/layout regressions must be fixed rather than blessed.

The two WebKit baselines were reviewed individually during the 1.64 migration:
glyph rasterization/font metrics and native audio/checkbox controls changed with
the engine. Lyric rows, timing, settings geometry and interaction checks remained
intact. Chromium desktop/mobile and Firefox baselines were retained. Screenshot
tolerances were not increased.

Actionlint 1.7.12 does not yet list Ubuntu 26.04 in its built-in catalog. The local
configuration registers only that approved runner label, retaining all other checks.

## GitHub settings after pushing

1. Repository **Settings → General → Pull Requests**: enable **Allow auto-merge** and
   retain squash merging.
2. **Settings → Rules → Rulesets**: create an active branch ruleset targeting `main`.
3. Require pull requests, the aggregate **validate** status check from GitHub Actions,
   and **Require branches to be up to date before merging**. Select the check after
   it appears on a successful run; do not select every conditionally skipped job.
4. Do not require human approval for routine updates. Renovate disables automerge on
   manual-review groups. Avoid bypass rules that allow the bot around validation.
5. Confirm a routine Renovate patch waits for current-base validation before merging.
   The current local implementation does not establish this GitHub-side evidence.

These settings have not been changed by this task. Auto-merge was disabled and main
had no branch protection/ruleset when inspected.

## Existing PR disposition after this change lands

| PRs | Action |
| --- | --- |
| #8, #13 | Cache v6 is incorporated; the v4 digest proposal is superseded. |
| #15–#18, #24, #25, #27 | Action upgrades are incorporated; do not merge stale diffs afterward. |
| #19, #20, #23, #26 | Test SDK, Mypy, adapter and pnpm migrations are incorporated. |
| #22 | Ubuntu 26.04 labels are incorporated; first hosted run still needs verification. |
| #12 | Grouped upgrades are incorporated with the matching browser image; let Renovate refresh or close superseded proposals. |
| #21 | TypeScript 7 is deferred; the `<7` rule prevents a replacement proposal. |
| #7 | Let Release Please refresh 0.1.2 from current main; do not manually edit release metadata. Merge only after current checks pass. |

PR state is a snapshot; refresh it before closing or merging anything. No PRs were
modified by this task. Publication and installation remain separate actions.

## Validation handoff

Local evidence must identify the exact candidate archives and hashes. Hosted Ubuntu
26.04, Renovate platform automerge and Release Please's actual execution remain
post-push checks. Verify release outputs, artifact attachment and upload-only reuse
on the next release workflow; a green PR does not exercise release creation.

Native ARM64, physical-device performance and live credentialed providers remain
unverified. All local provider fixtures remain mocked.
