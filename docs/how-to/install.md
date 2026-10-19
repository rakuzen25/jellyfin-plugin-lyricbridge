# Install and operate LyricBridge

Install LyricBridge through Jellyfin's plugin catalog, then verify playback before enabling scheduled retrieval.
See the [project introduction](../../README.md) for supported hosts and features.

## Install from the catalog

Use Jellyfin's administrator dashboard to install the plugin:

1. In **Dashboard → Plugins → Repositories**, add `https://raw.githubusercontent.com/rakuzen25/jellyfin-plugin-manifest/main/manifest.json`.
2. Install **LyricBridge** and restart Jellyfin.
3. In **Dashboard → Plugins → LyricBridge → General**, confirm the active storage path and web renderer status.
4. Play a known track in Jellyfin Web and open its lyrics view.
5. After confirming retrieval works, enable scheduled retrieval if needed and configure **LyricBridge: retrieve missing lyrics** in **Scheduled Tasks**.

The plugin includes its dependencies, pronunciation dictionaries, and web renderer. Native clients use Jellyfin's standard lyrics rather than the web renderer.

## Back up or relocate storage

Keep the complete plugin storage directory with your Jellyfin configuration backups. It contains saved lyrics, preferences, requests, and transcripts.
Back up the plugin settings XML and the upgrade directory shown in **Upgrade history and backups** as well; a custom lyric storage path can place these outside that directory.
Use a writable filesystem that supports SQLite locking. Media-library mounts can stay read-only.

For Docker, bind a host directory to a container path before entering that path in **Lyric storage directory**. Entering a host path alone does not create a mount.
To relocate existing data:

1. Stop Jellyfin.
2. Copy the complete active storage directory, including any SQLite WAL files.
3. Update the configured storage path or Docker mount.
4. Restart Jellyfin and confirm the active path in **General**.

A path change requires restart. Until then, data actions affect the active directory; factory reset retains that active location.
If startup rejects an unsupported storage schema, preserve the old directory and configure empty replacement storage. Do not overwrite the rejected database.

Jellyfin's **Save lyrics into media folders** setting controls its standard lyric files. LyricBridge's rich lyrics always use separate plugin storage.

## Inspect startup and upgrades

Open **Dashboard → Plugins → LyricBridge** to inspect startup status and **Upgrade history and backups**.
A blocked startup pauses LyricBridge work while Jellyfin remains available. The page shows the failed phase, affected path, and diagnostic ID for the server logs.
Correct the reported problem, then restart Jellyfin.

This testing baseline requires fresh settings and storage. Preserve existing testing files before choosing fresh state; this release supplies no upgrade steps.
To start fresh, stop Jellyfin and move the reported settings XML and complete plugin storage directories to a separate backup location, then restart. Removing settings selects the default storage location; preserve custom storage separately.
Future releases can upgrade one explicitly supported predecessor automatically before plugin work starts.
Successful upgrades show a notice until an administrator selects **Acknowledge upgrade**.

Automatic backups retain their original schema. The history shows source and target plugin versions, backup locations, sizes, and expiry dates.
Backups expire 30 days after creation; cleanup runs at startup and daily. Once verification succeeds, use **Review backup deletion** and confirm **Delete backup** to reclaim space earlier.
Acknowledgement retains the backup until deletion or expiry. Keep independent backups if you need a longer recovery window.

## Downgrade and restore an upgrade backup

Use this procedure when an upgrade causes problems and its automatic backup is still available.
Restore the recorded source release and matching state together; the installed release may not understand the backup's schema.
Settings backups can contain credentials. Keep all copies private.

1. Open **Upgrade history and backups** and record the source plugin version, affected domain, original file path, backup path, and expiry date for each upgrade involved.
2. Download the recorded source release's plugin archive and matching web archive from the project's releases. Suspend any automated plugin replacement until recovery is verified.
3. Stop Jellyfin and confirm the process has exited.
4. Copy the failing plugin settings file, complete storage directory (including SQLite sidecars and staged audio), and upgrade backup directory to a separate recovery location. Copy the automatic backups there before their expiry.
5. Move the installed LyricBridge plugin directory outside Jellyfin's plugin discovery directory. Install the source release's plugin archive in its place; retain its matching manifest and dependencies.
6. Copy each settings backup to its recorded original settings-file path. Restore only the domains covered by the selected upgrade records.
7. Move the stopped database's `index.sqlite-wal` and `index.sqlite-shm` sidecars to the recovery location, if present. Copy the database backup to its recorded original database path. The automatic SQLite backup already includes committed WAL data; don't attach sidecars from the failing database.
8. Restore the original file ownership and access permissions. Reinstall matching web assets into separately hosted clients; server-managed integration reconciles its assets on startup.
9. Start Jellyfin and reload browser clients. Inspect startup status and logs, then verify settings, saved lyrics, playback, and the transcription or generation workflows you use.

Restoring a backup discards changes made to that domain after the backup. Keep the failing-state copy until recovery is verified.
If a required backup has expired or been deleted, use an independent backup or fresh plugin state.

## Repair web integration

If the enhanced lyrics view does not load, inspect **General** for the web root, integration mechanism, and latest result:

1. Save **Enable web renderer** as enabled.
2. Select **Repair web renderer**.
3. Reload the browser and check the status again.

Automatic integration needs either a writable Jellyfin web root or a compatible File Transformation plugin.
File Transformation is optional; installed compatibility must be verified against your server version. Its [catalog](https://www.iamparadox.dev/jellyfin/plugins/manifest.json) is maintained separately.
A read-only web root without compatible transformation requires a separately hosted web client.

Direct integration preserves unrelated injections and keeps an original index backup. Repair or restart can reinstall managed tags after a web upgrade.
Integration failure leaves backend/native lyrics available.

## Install into a separate web client

For an independently hosted Jellyfin Web client, download and extract the matching web archive, then back up its web root.
From the source checkout, run:

```sh
python3 -m scripts.installation.web_assets --web-root WEB_ROOT --assets WEB_ASSETS
```

Replace `WEB_ROOT` with the installed client's directory and `WEB_ASSETS` with the extracted web archive directory.
The command reports installation; reload that client and confirm enhanced lyrics load. Reinstall after upgrades that replace the web files.

## Disable or uninstall

Before removing or disabling the plugin, save **Enable web renderer** as off and reload browser clients.
Then uninstall or disable it through Jellyfin and restart. An inactive plugin cannot remove its tags afterward.

For a separate client or leftover managed tags, run from the source checkout:

```sh
python3 -m scripts.installation.web_assets --web-root WEB_ROOT --uninstall
```

Replace `WEB_ROOT` with the client directory being cleaned. The command removes managed tags and assets while retaining the backup and unrelated changes.
Keep plugin storage unless you intend to delete saved data.

## Next steps

Continue with [source and service configuration](configure.md), [playback choices](playback.md), or [stored-data management](manage-data.md).
