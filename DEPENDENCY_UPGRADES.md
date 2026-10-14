# Coordinated dependency migration

This change prepares development/build dependencies locally. It does not change the
plugin ABI, GUID, storage schema, version, production data or live deployment.

## Targets and policy

Node 26.11.1, pnpm 12.11.2, Python 3.15.0 and Ubuntu 26.04 runners; Playwright 1.64.0
with its official noble image digest; esbuild 0.28.2, typescript-eslint 8.71.2,
Mypy 2.4.0 and xUnit v3 4.0.2 using Microsoft Testing Platform exclusively.
TypeScript 7.0.2 handles typechecking alongside the TypeScript 6.0.2 compatibility API.
Renovate keeps the native compiler on stable 7.x and the compatibility API on stable 6.x;
compiler minor/major changes require review, while checked patches may automerge.
.NET SDK remains at 10.0.401. VSTest and xUnit 2 are no longer supported.

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

## Minimum release age

Renovate, pnpm and pip share a 24-hour minimum release age. Renovate waits before
creating update branches and adds a 30-minute buffer for companion packages
published later. Sources without release timestamps remain updateable through
Renovate. NuGet updates use this Renovate gate; restores still use locked mode
without a custom age check.

pnpm explicitly enforces 1440 minutes in strict mode, including transitive
resolution. Existing reviewed exact-version exclusions remain exceptions; they
must not be broadened. pip installs use `--uploaded-prior-to=P1D` for the same
24-hour cutoff. pip 26.2 or newer is required for relative cutoffs and Python 3.15
support; `scripts/check-pip.py` fails with upgrade instructions on older versions.
The pip cutoff requires index upload-time metadata (provided by PyPI); missing
metadata causes installation to fail. Local files and VCS installs are outside
pip's index age filter. The tooling policy tests guard these settings against drift.

## Local setup

Install Node from `.node-version`, pnpm from `package.json`, Python from `.python-version`
and .NET from `global.json`. Recreate a Python virtual environment made with an older
interpreter:

```sh
python3.15 -m venv .venv
.venv/bin/python scripts/check-pip.py && .venv/bin/python -m pip install --uploaded-prior-to=P1D -r requirements-check.txt
node scripts/check-toolchain.mjs
pnpm install --frozen-lockfile
pnpm check
pnpm test:tooling
pnpm build && pnpm test
```

## TypeScript compilers

Both root and frontend development dependencies follow Microsoft's
[side-by-side setup](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-60)
with exact pins:

```json
{
    "@typescript/native": "npm:typescript@7.0.2",
    "typescript": "npm:@typescript/typescript6@6.0.2"
}
```

The compatibility wrapper has a floating `@typescript/old` dependency; the workspace
override pins that internal compiler to 6.0.2 as well. Renovate keeps this override
on stable 6.x with the same compiler review policy.

The native package supplies `tsc`, so `pnpm typecheck`, `pnpm build` and routine CI
check with TypeScript 7. Imports from `typescript` supply the TypeScript 6 JavaScript
compiler API used by ESLint and the boundary checker. `tsc6` remains available through
`pnpm typecheck:legacy` for manual compatibility diagnosis with stable type ordering;
it is not an additional routine CI gate. Both compilers use the existing strict
frontend configuration. Esbuild continues to generate the web bundles.

Editor use of TypeScript 7's language server is optional. Consult the editor's
TypeScript 7/LSP setup instructions; VS Code offers Microsoft's TypeScript 7 extension.
Installing the dependency aliases does not change editor settings.

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
| #21 | Native TypeScript 7 and the TypeScript 6 compatibility API are incorporated; let Renovate refresh or close the superseded direct-upgrade proposal. |
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
