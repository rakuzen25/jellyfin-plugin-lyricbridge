# LyricBridge for Jellyfin

LyricBridge adds multilingual karaoke lyrics to Jellyfin Web, with provider search,
saved lyric versions, imports, translation, and pronunciation. It targets Jellyfin
12.2 / .NET 10 on Linux x64. ARM64 is experimental and unverified.

## Install and play

Install through Jellyfin's plugin catalog:

1. In **Dashboard → Plugins → Repositories**, add
   `https://raw.githubusercontent.com/rakuzen25/jellyfin-plugin-manifest/main/manifest.json`.
2. Install **LyricBridge** from the catalog and restart Jellyfin.
3. Play a music track in Jellyfin Web and open its lyrics view. The enhanced renderer
   loads automatically when web integration is available.
4. Open **Lyrics settings → Versions** to search, preview, or import lyrics.
   Administrators can save original selections; other users can preview them.

LyricBridge stores its data separately from music and never writes to media paths.
It preserves manual selections, uses available Jellyfin lyrics, and searches enabled
providers when needed.
See [installation, storage, web repair, and uninstall](docs/DEPLOYMENT.md) for
read-only web roots, independently hosted clients, backups, and updates.

## Configure lyrics and languages

Use [source and language setup](docs/SETUP.md) to configure credentials, generation,
saved versions, and account/song preferences. Missing Japanese romaji can be generated
locally with bundled Kawazu. External generation is explicit and sends song text to
the chosen service; user requests and automatic approval default to off.

The [import reference](docs/IMPORT.md) defines supported formats and validation.
The [matching reference](docs/RANKING.md) explains recording eligibility, ranking,
and improvement offers. Manual selections remain stable until explicitly changed.

## Develop and release

Start with [development setup](docs/DEVELOPMENT.md), including the disposable local
Jellyfin sandbox. [Architecture](docs/ARCHITECTURE.md) explains ownership and contracts;
[CI and local validation](docs/CI.md) lists maintained checks and evidence requirements.
Follow [release publication](docs/RELEASING.md) to build verified draft assets and
notify the shared catalog. Published changes are in the [changelog](CHANGELOG.md).

## Licenses

Original plugin code and the Lyricify helper use Apache 2.0. The LyricMotion-derived
renderer uses MPL 2.0. See [distribution licenses and source](docs/LICENSES.md) for
dependency terms and corresponding-source requirements, and
[upstream components](vendor/UPSTREAM.md) for pinned revisions and local modifications.
