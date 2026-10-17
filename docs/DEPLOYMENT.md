# Install and operate LyricBridge

Use this guide to install, maintain, and remove LyricBridge on Jellyfin 12.2 / .NET 10
on Linux x64. ARM64 is experimental and unverified. Release acceptance applies to the
exact artifacts verified by the release workflow.

## Install from the catalog

Install the plugin using Jellyfin's administrator dashboard:

1. In **Dashboard → Plugins → Repositories**, add
   `https://raw.githubusercontent.com/rakuzen25/jellyfin-plugin-manifest/main/manifest.json`.
2. Install **LyricBridge** from the catalog and restart Jellyfin.
3. Check **Dashboard → Plugins → LyricBridge → General** for the active storage path
   and web renderer status.
4. Play a sample track and open its lyrics view before enabling scheduled retrieval.

The plugin ZIP includes dependencies, pronunciation dictionaries, notices, and the
embedded web renderer. No custom server image is required. Scheduled retrieval starts
disabled; after sample validation, enable it and configure or run
**LyricBridge: retrieve missing lyrics** in **Scheduled Tasks**.

## Configure and back up storage

LyricBridge stores retrieved and generated content in a `LyricBridge` directory inside
Jellyfin's data directory by default. **Lyric storage directory** accepts another
writable absolute path and requires a server restart. Keep media-library mounts
read-only and use a filesystem that supports SQLite locking.

For Docker, bind a host directory such as `/srv/jellyfin-lyrics` to `/lyrics`, then
set the plugin path to `/lyrics`. The directory must be writable by Jellyfin's
container user. Entering an unmounted host path does not create a bind mount.

The directory contains a SQLite index with original provider responses, rich lyric
documents, selections, language versions, preferences, generation requests, and retained
transcripts/boundary versions. Temporary audio staging lives alongside the index.
Back up the complete directory alongside Jellyfin's configuration. To relocate it:

1. Stop Jellyfin.
2. Copy the complete directory, including SQLite WAL files if present.
3. Change the configured path or Docker mount.
4. Restart Jellyfin and confirm the active path in administrator settings.

Storage schema 5 is supported. Unsupported schemas are rejected without changes or
migration. Back up the existing directory outside the replacement location and
configure new empty storage; do not overwrite the old database.

Jellyfin's standard lyric downloader controls its own save location. Disable
**Save lyrics into media folders** in the music library settings to use Jellyfin's
internal metadata directory for standard LRC files. LyricBridge's rich retrieval and
generation always use separate plugin storage.

## Repair the automatic web renderer

**Enable web renderer** defaults to on. LyricBridge serves embedded JS/CSS and injects
ordered, content-versioned tags into Jellyfin-hosted Web, preserving base URLs.
File Transformation is preferred when its registration interface is available;
otherwise Jellyfin's configured web root must be writable by the server process.

In **Dashboard → Plugins → LyricBridge → General**, inspect the web root, mechanism,
and latest result. Save **Enable web renderer**, select **Repair web renderer**,
then reload browser clients. Injection failure leaves backend/native lyrics available
and does not stop Jellyfin startup.

File Transformation is an optional, separately installed plugin. Its
[catalog](https://www.iamparadox.dev/jellyfin/plugins/manifest.json) must provide a build
compatible with your server. Installed File Transformation integration on Jellyfin
12.2 remains unverified; contract fixtures do not establish installed compatibility.
A read-only web root requires compatible File Transformation or a separately hosted
web installation.

Direct injection backs up `index.html` once and replaces only the LyricBridge marker
block, preserving unrelated injections and permissions. It recognizes the manual
installer block. Repair or restart reinstalls tags after a web upgrade or container
recreation when the web root is writable. The backup is retained rather than restored
over unrelated changes.

## Install a separately hosted web renderer

For an independently hosted Jellyfin Web client, extract the web ZIP and back up the
chosen web root. From the source checkout, run with permission to update that root:

```sh
python3 scripts/web-assets.py --web-root /path/to/jellyfin-web --assets /path/to/web-assets
```

Replace `/path/to/jellyfin-web` with the installed web root and `/path/to/web-assets`
with the extracted web ZIP directory. The installer copies assets, saves the original
index, and inserts relative, content-versioned URLs. Reinstall after web upgrades that
replace these files. Native apps do not use this renderer.

## Disable or uninstall

Before disabling or removing the plugin, save **Enable web renderer = off**, confirm
the status, and reload browsers. Then disable or uninstall through Jellyfin's plugin
controls and restart. A disabled plugin cannot clean up tags after restart.

To remove a separate installation or leftover marked tags, run against that web root:

```sh
python3 scripts/web-assets.py --web-root /path/to/jellyfin-web --uninstall
```

Replace `/path/to/jellyfin-web` with the web root being cleaned. Uninstall removes only
managed tags/assets, retaining the index backup and unrelated edits. Preserve plugin
storage unless you explicitly intend to reset saved data.

## Next steps

- [Configure sources and languages](SETUP.md) and learn version/reset behavior.
- [Develop locally](DEVELOPMENT.md) or [validate built packages](CI.md) in disposable fixtures.
- [Prepare a release](RELEASING.md) and publish verified assets to the shared catalog.
