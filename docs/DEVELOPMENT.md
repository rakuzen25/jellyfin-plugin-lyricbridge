# Development and dependency policy

Run commands from the repository root. Tool versions are authoritative in
`.node-version`, `.python-version`, `global.json`, workspace manifests and lockfiles.
Use the exact pinned SDK; recreate a virtual environment after a Python upgrade.

```sh
python3.15 -m venv .venv
.venv/bin/python scripts/check-pip.py && .venv/bin/python -m pip install --uploaded-prior-to=P1D -r requirements-check.txt
node scripts/check-toolchain.mjs
pnpm install --frozen-lockfile
pnpm check
pnpm test:tooling
pnpm build && pnpm test
```

`LYRICBRIDGE_PYTHON` and `LYRICBRIDGE_DOTNET` override local executable locations.
.NET tests use xUnit v3 and Microsoft Testing Platform. See [CI](CI.md) for backend,
browser, package and reproducibility commands, and [local Jellyfin testing](LOCAL_TESTING.md)
for disposable installed-plugin validation.

## Quality checks

`pnpm check` runs ESLint, Prettier, Knip, strict TypeScript with checked indexed access,
Ruff formatting/linting, Mypy and .NET whitespace formatting. `pnpm test:tooling`
checks version guards, dependency policy and compiler resolution. Application and
tooling sources are checked; generated output and upstream vendor sources are excluded.

`pnpm format`, `pnpm format:python` and `pnpm format:dotnet` apply formatting.
Prettier uses 150 columns and four spaces, with two spaces for YAML. The demo HTML
is excluded because browser fixtures hook its inline script. The administration
HTML, frontend CSS and workflow YAML are formatted normally.

TypeScript 7 supplies the normal `tsc` command through `@typescript/native`.
The `typescript` alias supplies the TypeScript 6 JavaScript API required by ESLint
and the source boundary checker. The workspace override pins its transitive compiler;
all maintained application sources use one strict config.
Esbuild bundles checked source into `dist/web/`.

## Upgrade policy

Renovate, pnpm and pip enforce a 24-hour minimum release age. Renovate adds a
30-minute companion-package buffer. pnpm uses strict 1440-minute enforcement;
reviewed exact-version exceptions must remain narrow. pip uses
`--uploaded-prior-to=P1D`; `scripts/check-pip.py` verifies support. Missing index
upload-time metadata fails installation. NuGet restoration uses locked mode,
with Renovate applying the age policy to updates.

Only esbuild may run dependency lifecycle scripts. Dependency installation is
explicit and frozen; checks must not restore implicitly. Keep the Playwright
package, lockfile and official image digest together. Review visual differences
before changing committed screenshot baselines or tolerances.

GitHub Actions are SHA-pinned. Routine checked patches, minors, pins and digests
may automerge under `renovate.json`. Compiler, interpreter, package manager,
runner OS, pre-1.0 esbuild minors and provider/converter minor upgrades require
review. Playwright package/image patches are grouped; browser minors/majors need
review. Backend test infrastructure and artifact actions have separate groups.

Enable repository auto-merge and require the aggregate `validate` check plus
up-to-date branches in the `main` ruleset. Avoid requiring each conditional job.
Manual-review dependency groups have automerge disabled; bot bypasses must not
skip validation. If bot branches stop receiving workflows after a platform update,
check event permissions and the pinned action interfaces before changing policy.
