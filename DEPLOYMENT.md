# Operating LyricBridge

LyricBridge targets Jellyfin 12.2 / .NET 10 on Linux x64. Release readiness belongs to the exact tested release artifacts and their workflow evidence, not to a build succeeding alone. ARM64 remains experimental and unverified; it does not block x64 acceptance. Publication and installation of this candidate are separate actions.

## Storage

0.1.0 requires fresh LyricBridge storage. Unsupported databases are
rejected without deletion or migration. Stop Jellyfin, back up the complete
LyricBridge storage directory, and select a new empty absolute storage directory
before testing this revision. Keep backups outside the new directory. Never
remove media or overwrite a production database to satisfy this requirement.

## Automated GitHub releases

See [RELEASING.md](RELEASING.md) for release-token setup, the first `0.1.0` release PR, draft artifact verification, publication and shared-catalog updates. Local build commands below remain available for development.

## Build and artifacts

Install the SDK selected by `global.json`, the Node.js version selected by `.node-version`, pnpm 10.33.4 (pinned in the root `package.json`), Python 3, and Docker. Both JavaScript projects share the root `pnpm-lock.yaml`; run the frozen install from the repository root. Run:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm check
scripts/bootstrap-references.sh
dotnet restore tests/StorageTests.csproj --locked-mode -m:1
dotnet test tests/StorageTests.csproj --no-restore -m:1
scripts/test-browser.sh
python3 tests/ReleaseBoundaries.py
python3 tests/Catalog.py
scripts/package.sh
python3 tests/PackageArtifacts.py
python3 tests/ReproducibleBuild.py
python3 tests/PackageInstallation.py
```

The bootstrap extracts compile references from a pinned official Jellyfin image;
it does not start a server. Override `JellyfinReferenceDir` through MSBuild for an
existing reference directory. Tests and the plugin use the same property.

`dist` contains plugin, separate web, and editable-source ZIPs, SHA-256 checksums,
and a catalog manifest. The default catalog points to a loopback test server.
For a release-mode artifact build, set `LYRICBRIDGE_REPOSITORY_URL` and
`LYRICBRIDGE_DOWNLOAD_BASE_URL` to the intended HTTPS locations and pass
`--release` to `scripts/package.sh`. This builds files; it does not publish them.

The package integration check requires Docker and creates its own official Linux
x64 server, synthetic accounts, local catalog and temporary storage. It never
accepts an existing server URL. It checks installation/restart, authentication,
account preference isolation, administrator restrictions, native lyrics, packaged
pronunciation dictionaries, restricted libraries, rejection preservation, reset
boundaries, read-only media, disable and uninstall. It also checks separate web
asset install/uninstall under a Jellyfin base URL. ARM64 remains experimental; no native test host is available.

## Automatic web renderer (0.1.1 and later)

Install the plugin and restart Jellyfin. **Enable web renderer** defaults to on.
The plugin serves its embedded JS/CSS and injects ordered, content-versioned tags
into the Jellyfin-hosted web client. Base URLs are preserved. File Transformation
is preferred when installed and its registration interface is available; otherwise
the configured Jellyfin web root must be writable by the server process.

Dashboard → Plugins → LyricBridge → General shows the actual web root, mechanism
and latest result. **Repair web renderer** retries registration and reconciles the
index using the saved settings. Save the enabled setting before repairing. Reload
browser clients after changes. Injection failure leaves backend/native lyrics
available and does not stop Jellyfin startup.

File Transformation is an optional separately installed plugin, not downloaded or
bundled by LyricBridge. Its catalog is
`https://www.iamparadox.dev/jellyfin/plugins/manifest.json`. Use only a build compatible
with your server. At implementation review, upstream lists targets through 12.1;
actual File Transformation integration on 12.2 remains unverified. Contract-fixture
coverage is not installed-plugin validation. Read-only Docker web roots cannot use
direct injection; do not change server permissions automatically to work around it.

Direct injection backs up `index.html` once and replaces only the LyricBridge marker
block, preserving other injections and file permissions. It recognizes the current
manual installer block. Repair/restart reinstalls the block if a web upgrade replaced
it. Changes inside a Docker container do not survive container recreation; startup
reapplies them when its web root is writable.

Before disabling/removing the plugin, save **Enable web renderer = off**, confirm the
status and reload. Disabling the plugin alone cannot run cleanup after restart;
remove leftover marked tags with the scoped uninstall command below if necessary.
The original index backup is retained, never restored over unrelated updates.
Already loaded browser sessions must reload to stop running the renderer.

Native apps are unaffected. Independently hosted Jellyfin Web clients require the
separate installation below. The 0.1.0 release also requires that separate setup.

## Separate web renderer

Back up the chosen Jellyfin web root. With appropriate filesystem permissions:

```sh
python3 scripts/web-assets.py --web-root /path/to/jellyfin-web --assets /path/to/web-assets
python3 scripts/web-assets.py --web-root /path/to/jellyfin-web --uninstall
```

Use the extracted web ZIP as the assets directory. The installer saves the
original index, inserts ordered, content-versioned asset tags, and uses relative
URLs for Jellyfin base-URL installations. Uninstall removes only its marked tags
and managed assets, retaining the index backup and unrelated index edits.
Jellyfin web upgrades can replace these assets; reinstall after an upgrade.

Disable the plugin through Jellyfin's plugin controls and restart before removing
its plugin directory. Remove the optional web renderer separately. Disabling or
uninstalling does not authorize deleting the LyricBridge data directory.

Frontend source is in `frontend`; the administrator page is generated from
`frontend/admin/config.html` and its typed controller. Edit sources there, then run the build;
`dist/web/lyricbridge.js` is a generated artifact. Typed modules are checked with
`tsc --noEmit` before esbuild runs. All maintained application code, including
the bridge and renderer entrypoints, is covered by strict TypeScript checking.

## Independent releases and the shared catalog

Each plugin has its own source repository, GUID and version. LyricBridge's authoritative identity and release information live in `Directory.Build.props`; the helper's upstream version is independent. Configure actual public URLs before preparing publishable artifacts:

```sh
LYRICBRIDGE_REPOSITORY_URL=https://github.com/OWNER/lyricbridge \
LYRICBRIDGE_DOWNLOAD_BASE_URL=https://github.com/OWNER/lyricbridge/releases/download/v0.1.0 \
  scripts/package.sh --release
```

Replace OWNER/repository paths with your real repository. The validation workflow uploads candidate artifacts; it does not publish a release or change the shared catalog. Upload all three archives, notices contained in them, and SHA256SUMS to the corresponding release. Consumers install using the shared catalog URL, not a source-code ZIP. Web enhancement remains a separate install.

Prepare the shared catalog update locally, preserving all other plugins and previous versions:

```sh
python3 scripts/catalog.py --catalog-input /path/to/shared-manifest.json \
  --entry dist/manifest.json --catalog-output /path/to/candidate-manifest.json
```

For a new catalog, create an input file containing `[]`. Review the candidate diff, confirm public downloads are reachable and match the checksums, then publish the catalog separately. An identical version is idempotent; a conflicting same-version release is rejected. Never overwrite unrelated entries with this repository's single-plugin manifest. Other plugin repositories use the same catalog format; releases remain independent.

## Fresh baseline after removing a preview installation

Stop Jellyfin before backing up or deleting LyricBridge data. Back up the complete plugin directory, its configuration XML and storage directory, including WAL/SHM files, outside active storage. Remove only identified LyricBridge paths. An image or startup script that copies the plugin on boot must be replaced first, or it will reinstall the old build. Remove the old optional web injection too. Restart twice and confirm the plugin, API and assets are absent before a fresh catalog installation. Keep the backup private; never restore it automatically into the new installation.

Browser preferences belong to each browser and cannot be erased by server cleanup. Before the new installation, remove only these LyricBridge keys using browser developer tools: localStorage `appleKaraokePerformanceMode`, `appleKaraokeSongPreferencesV2`, `appleKaraokePremiumAccent`, `appleKaraokeRecentAccents`, and any `lyricbridge.renderer.*` keys; sessionStorage `appleKaraokeAccentBag` and `lyricbridge.renderer.accentBag`. Do not clear Jellyfin authentication or unrelated site storage. The new renderer does not read or migrate preview keys.
