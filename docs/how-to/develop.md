# Develop and test locally

Run commands from the repository root. Read the [architecture rationale](../explanation/architecture.md) before changing ownership boundaries.

## Prepare the toolchain

Install the versions pinned by [.python-version](../../.python-version), [.node-version](../../.node-version), [package.json](../../package.json), and [global.json](../../global.json), plus Docker. Then run:

```sh
pnpm bootstrap
```

Bootstrap verifies installed tools, restores frozen workspace dependencies, prepares `.venv` with the check dependencies, extracts verified references from the pinned official Jellyfin image, and restores locked backend dependencies. It does not install system tools.
`LYRICBRIDGE_PYTHON`, `LYRICBRIDGE_DOTNET`, and `LYRICBRIDGE_PNPM` select alternate executable locations; `LYRICBRIDGE_REFERENCE_DIR` selects the references used by clean builds.

## Run an interactive sandbox

```sh
pnpm dev
```

Keep the command running and open [local Jellyfin](http://localhost:18096/web/). Finish setup and add `/media` as a music library. Place sample media and sidecar lyrics in `.build/local-jellyfin/media/`.
Accounts, credentials, settings, and plugin data remain under ignored `.build/local-jellyfin/`. Use test accounts and configure external services only when you intend real provider calls.

Frontend edits rebuild and reload the browser without restarting Jellyfin. Backend edits compile before restarting the server. Failed builds leave the last working version available; fix the error and save again. A failed replacement startup restores the previous plugin.
Browser reloads can interrupt playback and unsaved forms.

Press `r` to rebuild/restart, `o` to open the browser, or `h` for help. Ctrl+C stops the session and its container while retaining data. Only one session can own a checkout. The public port stays fixed; use `pnpm dev --port 18097` if 18096 is occupied. `--open` opens the browser after startup.

Dev prepares missing official references and restores locked backend dependencies. If workspace dependencies are missing, run `pnpm install --frozen-lockfile` first.

For symlinks outside the sample directory, pass `--media-mount /absolute/host/path` for each target directory. These mounts are read-only, use the same path inside Docker, and persist across sessions. `--clear-media-mounts` clears remembered extra mounts.

For a fresh server, stop the session and remove only `.build/local-jellyfin/`. This removes test accounts, credentials, plugin data, and sample media. Never substitute production storage.

## Build and validate

Edit maintained source rather than generated `dist/web/` assets. `pnpm build frontend` builds production web assets; `pnpm build backend` publishes a staged plugin using those assets. `pnpm build` creates clean distributable archives, manifests, and checksums.

Use `pnpm check`, `pnpm format`, and `pnpm test` for the whole project. Add `frontend`, `backend`, or `tooling` to target one boundary; `pnpm check docs` checks documentation links. See [validation](validate.md) for acceptance checks.

## Upgrade dependencies deliberately

Restore explicitly with frozen/locked dependencies; checks must not install implicitly.
Keep browser packages, lockfiles, and the pinned acceptance image together. Review visual changes before updating screenshot baselines.

Age gates reduce immediate exposure to new packages; do not bypass them to make an update pass.
The executable update policy lives in [Renovate configuration](../../renovate.json) and [workspace policy](../../pnpm-workspace.yaml).

Require the aggregate `validate` check and up-to-date branches on `main`; conditional jobs cannot serve as unconditional branch requirements.
Review compiler, runtime, provider, and converter updates for behavior changes even when restoration succeeds.

## Next steps

[Validate a change](validate.md), [integrate feedback](feedback.md), or [prepare a release](release.md).
