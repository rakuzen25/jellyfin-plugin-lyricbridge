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
python3 -m scripts.build.web_assets --web-root WEB_ROOT --assets WEB_ASSETS
```

Replace `WEB_ROOT` with the installed client's directory and `WEB_ASSETS` with the extracted web archive directory.
The command reports installation; reload that client and confirm enhanced lyrics load. Reinstall after upgrades that replace the web files.

## Disable or uninstall

Before removing or disabling the plugin, save **Enable web renderer** as off and reload browser clients.
Then uninstall or disable it through Jellyfin and restart. An inactive plugin cannot remove its tags afterward.

For a separate client or leftover managed tags, run from the source checkout:

```sh
python3 -m scripts.build.web_assets --web-root WEB_ROOT --uninstall
```

Replace `WEB_ROOT` with the client directory being cleaned. The command removes managed tags and assets while retaining the backup and unrelated changes.
Keep plugin storage unless you intend to delete saved data.

## Next steps

Continue with [source and service configuration](configure.md), [playback choices](playback.md), or [stored-data management](manage-data.md).
