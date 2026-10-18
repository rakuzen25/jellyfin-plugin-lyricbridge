# Develop and test locally

Prepare a contributor environment and use a disposable Jellyfin sandbox for interactive testing.
Run commands from the repository root. Read the [architecture rationale](../explanation/architecture.md) before changing ownership boundaries.

## Prepare the toolchain

Install the versions pinned by [.python-version](../../.python-version), [.node-version](../../.node-version), [package.json](../../package.json), and [global.json](../../global.json).
Docker is required for official reference extraction, browser acceptance, and the sandbox.
With the pinned Python available as `python3`, run:

```sh
python3 -m venv .venv
.venv/bin/python -m scripts.checks.check_pip && .venv/bin/python -m pip install --uploaded-prior-to=P1D -r requirements-check.txt
node scripts/checks/check-toolchain.mjs
pnpm install --frozen-lockfile
scripts/dev/bootstrap-references.sh
```

Each command must complete successfully before continuing. Bootstrap extracts official compile references without starting Jellyfin.
Recreate the virtual environment after a Python upgrade. `LYRICBRIDGE_PYTHON`, `LYRICBRIDGE_DOTNET`, and `JellyfinReferenceDir` support alternate local executable/reference locations.

Edit maintained source, then build and [run relevant checks](validate.md). Do not edit generated `dist/web/` assets.
Use `pnpm format`, `pnpm format:python`, or `pnpm format:dotnet` to apply formatting before review.

## Run an interactive sandbox

After setup, build and start the owned local server:

```sh
python3 -m scripts.dev.local_jellyfin rebuild
```

Open [local Jellyfin](http://localhost:18096/web/), finish setup, and add `/media` as a music library.
Place sample media and sidecar lyrics in `.build/local-jellyfin/media/`; the container mounts them read-only.
Configuration, credentials, and plugin data remain under ignored `.build/local-jellyfin/`.
Use test accounts and leave paid or credentialed services unconfigured unless you intend external calls.

After edits, run `rebuild` again and reload the browser. A failed build leaves the existing server intact; a successful rebuild preserves its data.

Use `start` only when an existing package matches the checkout.
For symlinks outside the sample directory, repeat `--media-mount` with each target's original absolute host path. Mounts remain read-only and persist across rebuilds.

Inspect or stop the sandbox with:

```sh
python3 -m scripts.dev.local_jellyfin status
python3 -m scripts.dev.local_jellyfin logs
python3 -m scripts.dev.local_jellyfin stop
```

`stop` retains test data. For a fresh server, stop it and remove only its `.build/local-jellyfin/` directory before rebuilding.
That removes test accounts, credentials, plugin data, and sample media. Never substitute production storage.

## Upgrade dependencies deliberately

Restore explicitly with frozen/locked dependencies; checks must not install implicitly.
Keep browser packages, lockfiles, and the pinned acceptance image together. Review visual changes before updating screenshot baselines.

Age gates reduce immediate exposure to new packages; do not bypass them to make an update pass.
The executable update policy lives in [Renovate configuration](../../renovate.json) and [workspace policy](../../pnpm-workspace.yaml).

Require the aggregate `validate` check and up-to-date branches on `main`; conditional jobs cannot serve as unconditional branch requirements.
Review compiler, runtime, provider, and converter updates for behavior changes even when restoration succeeds.

## Next steps

[Validate a change](validate.md), [integrate feedback](feedback.md), or [prepare a release](release.md).
