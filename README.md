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
See [installation, storage, web repair, and uninstall](docs/how-to/install.md) for
read-only web roots, independently hosted clients, backups, and updates.

## Configure lyrics and languages

[Configure sources and services](docs/how-to/configure.md) as an administrator, then
[choose playback versions and languages](docs/how-to/playback.md) for your account.
External generation sends text or prepared audio to the chosen service; bundled
Japanese romaji runs locally.

[Transcribe audio and review line breaks](docs/how-to/transcribe.md),
[choose an import/export format](docs/reference/import-formats.md), or
[manage saved data and requests](docs/how-to/manage-data.md).
See [how lyric selection works](docs/explanation/lyric-selection.md) when investigating
recording conflicts or improvement offers.

## Develop and release

Start with [development setup](docs/how-to/develop.md), including the disposable local
Jellyfin sandbox. [Architecture](docs/explanation/architecture.md) explains ownership and contracts;
[Local validation](docs/how-to/validate.md) explains which checks to run.
Follow [release publication](docs/how-to/release.md) to build verified draft assets and
notify the shared catalog. Published changes are in the [changelog](CHANGELOG.md).

## Licenses

Original plugin code and the Lyricify helper use Apache 2.0. The LyricMotion-derived
renderer uses MPL 2.0. See [distribution licenses and source](docs/reference/distribution.md) for
dependency terms and corresponding-source requirements, and
[upstream components](vendor/UPSTREAM.md) for pinned revisions and local modifications.

Use `pnpm check` (or `uv run jpt check`) to verify formatting and linting across the frontend, C# backend, Python tooling, configuration and docs. Use `pnpm format` to apply formatting, or add a target such as `frontend`, `backend`, `tooling` or `docs`. uv synchronizes Python dependencies automatically; run `uv run jpt bootstrap` first to prepare Node, .NET and Jellyfin integrations. CI runs these same checks and requires the aggregate `validation / validate` result.
