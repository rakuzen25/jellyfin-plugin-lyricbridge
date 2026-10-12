# Interactive local Jellyfin testing

The local helper packages the current checkout and installs it into a pinned official Jellyfin Linux x64 container. No GitHub release, catalog publication or live Jellyfin installation is needed.

Install Docker, the SDK pinned in `global.json`, Node/pnpm pinned by the repository, and Python 3 as described in DEPLOYMENT.md. Run from the repository root:

```sh
python3 scripts/local-jellyfin.py start
```

Open **http://localhost:18096/web/**, finish Jellyfin setup and add `/media` as a music library. Copy sample songs and sidecar lyrics into `.build/local-jellyfin/media/`. That directory is mounted read-only in Jellyfin. All server configuration, plugin credentials and managed data stay in the ignored `.build/local-jellyfin/` directory. Use test accounts and leave credentialed providers unconfigured unless you intend to make external calls.

For symlinks pointing outside the test media folder, also mount each target directory at its original absolute host path:

```sh
python3 scripts/local-jellyfin.py start --no-build \
  --media-mount /mnt/gdrive-nu/Mora/Bubblin
```

This exposes that directory read-only inside the container, allowing `/media/Bubblin` to follow its host symlink. Repeat `--media-mount` for additional directories. The paths are remembered across rebuilds and stops. Supplying a new list replaces the saved list; `--clear-media-mounts` removes it. The source directory must exist and be accessible to Docker (including any FUSE mount permissions).

After editing source:

```sh
python3 scripts/local-jellyfin.py rebuild
```

This builds before stopping the old sandbox, replaces only its LyricBridge package, and recreates the container. Server configuration and plugin data persist. Reload your browser after rebuilding. For layout/playback tests, use a separate browser profile to keep test settings distinct from your regular server.

Additional commands:

```sh
python3 scripts/local-jellyfin.py status
python3 scripts/local-jellyfin.py logs
python3 scripts/local-jellyfin.py stop
```

`stop` removes the owned container, retaining test data. It does not affect other containers. Start on a different localhost-only port with `start --port 18097`; specify that port again on subsequent rebuilds. Use `start --no-build` or `rebuild --no-build` to install the current checkout's existing `dist/lyricbridge-VERSION.zip` without rebuilding.

The official writable image permits automatic web injection when supported by the current plugin build. Check **Dashboard → Plugins → LyricBridge → Web renderer** for its status. Native clients and independently hosted web clients are separate integration cases.

For a completely fresh sandbox, stop it first, then manually remove only `.build/local-jellyfin/` and start again. This deletes its test accounts, credentials, plugin database and sample media. Never point the helper at production storage; its storage locations are intentionally fixed.

For automated catalog/install/restart/reset/uninstall coverage against the built archives:

```sh
python3 tests/PackageInstallation.py
```

That test owns a different temporary server and deletes it afterward. ARM64 and physical-device performance are not verified by this Linux x64 helper.
