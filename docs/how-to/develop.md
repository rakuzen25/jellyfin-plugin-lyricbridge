# Develop and test locally

Run commands from the repository root. Read the [architecture rationale](../explanation/architecture.md) before changing ownership boundaries.

## Prepare the toolchain

Install the versions pinned by [.python-version](../../.python-version), [.node-version](../../.node-version), [package.json](../../package.json), and [global.json](../../global.json), plus Docker. Then run:

```sh
pnpm bootstrap
```

Bootstrap verifies installed tools, restores frozen workspace dependencies, prepares `.venv` with the check dependencies, extracts verified references from the pinned official Jellyfin image, and restores locked backend dependencies. It does not install system tools. Tooling checks run the pinned actionlint image through Docker; the first run needs access to pull that image.
`JELLYFIN_PLUGIN_PYTHON`, `JELLYFIN_PLUGIN_DOTNET`, and `JELLYFIN_PLUGIN_PNPM` select alternate executable locations; `JELLYFIN_PLUGIN_REFERENCE_DIR` selects the references used by clean builds.

## Consume the shared foundation

`plugin.toml` declares plugin identity, capabilities, architecture policy, validation groups and shipped inventory. `version.txt` remains authoritative for the plugin version; native toolchain pins and dependency locks retain their existing authority.

`toolkit.lock.json` selects a GitHub toolkit release and archive SHA-256. The standard-library `./plugin` launcher verifies it before activating an ignored cache. Existing pnpm commands delegate to this launcher. Development checkouts download the published release into the ignored `.build/toolkit/` cache. Source distributions include the exact archive at `build-support/toolkit.tar.gz` for offline rebuilding.

Reusable workflow SHAs and the versioned shared Renovate preset must match the toolkit archive's recorded source/version. Toolkit updates arrive as one manually merged Renovate PR; CI rejects partial updates. Common implementation and extension contracts live in the [toolkit repository](https://github.com/rakuzen25/jellyfin-plugin-toolkit).

## Run an interactive sandbox

```sh
pnpm dev
```

Keep the command running and open [local Jellyfin](http://localhost:18096/web/). Finish setup and add `/media` as a music library. Place sample media and sidecar lyrics in `.build/local-jellyfin/media/`.
Accounts, credentials, settings, and plugin data remain under ignored `.build/local-jellyfin/`. Use test accounts and configure external services only when you intend real provider calls.

Frontend edits rebuild and reload the browser without restarting Jellyfin. Backend edits compile before restarting the server. Failed builds leave the last working version available; fix the error and save again. A failed replacement startup restores the previous plugin.
Browser reloads can interrupt playback and unsaved forms.

Press `r` to rebuild/restart once, `p` to pause or resume automatic updates, `o` to open the browser, or `h` for help. Ctrl+C stops the session and its container while retaining data. Only one session can own a checkout. The public port stays fixed; use `pnpm dev --port 18097` if 18096 is occupied. `--open` opens the browser after startup.

For a stable preview while editing, start with `pnpm dev --no-watch` or press `p` in a running session. The initial build always runs. Pausing lets any active build and restart finish before reporting “Preview stable”; subsequent edits are tracked without updating the preview. Press `r` for a full rebuild/restart while staying paused. Resuming catches up once with changed frontend/backend parts; if nothing changed since the last successful build, it does no work. Edits arriving during a build remain pending, and failed builds retain their changes for retry. Pause state lasts only for the current session. Non-terminal sessions can use `--no-watch` without interactive controls.

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
