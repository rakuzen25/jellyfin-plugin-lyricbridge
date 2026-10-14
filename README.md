# LyricBridge for Jellyfin

LyricBridge targets Jellyfin 12.2 / .NET 10 on Linux x64. Version 0.1.0 is published; automatic web-renderer injection is being prepared for 0.1.1. ARM64 remains experimental and unverified. Release readiness applies to the exact artifacts tested by the release workflow. See [operating instructions](DEPLOYMENT.md) and [changes](CHANGELOG.md). The initial 0.1.0 storage baseline rejects unsupported preview databases without migration or deletion. The 0.1.1 renderer changes preserve 0.1.0 storage.

Uploaded lyric files are validated on the server and shown in a read-only preview before Import. Optional playback preview returns to the previous lyrics and playback position when stopped or canceled. Uploads support native TXT/LRC/ELRC, LyricBridge text formats and supported JSON/XML wrappers, encrypted KRC, and cloud or desktop QQ Music QRC. Auto encoding accepts UTF-8 and BOM-marked Unicode; legacy text encodings can be selected explicitly. Both the uploaded file and decoded text are limited to 1 MB. Recoverable timing inconsistencies appear as preview warnings: overlapping word times stay unchanged, line boundaries expand where needed, and signed offsets can retain timing before playback zero. Incomplete parsing or unmatched supplied translation/pronunciation rows rejects the whole import with source locations. Format defaults to Auto; choose an explicit native format, or TXT to preserve literal markup as text. Encoding and format changes revalidate the original bytes. During the final save, Cancel/close/Escape wait for the result; read-only preview requests are aborted on closure. Saved imports retain original bytes, filename, encoding and format choice alongside decoded lyrics. Repeated timestamps remain supported; the file limit does not impose a separate cap on expanded lyric content.

## Storage and read-only music

LyricBridge stores all retrieved and generated content separately from media. The default is a `LyricBridge` directory inside Jellyfin’s data directory. Administrator settings show the actual active path. Set **Lyric storage directory** to use another writable absolute path; changing it requires a server restart. Keep media-library mounts read-only.

For a separate host directory, add a Docker bind mount such as `/srv/jellyfin-lyrics:/lyrics` and set the plugin path to `/lyrics`. The directory must be writable by Jellyfin's container user, as configured by your installation. Container paths and host paths are different; entering an unmounted host path does not create a host bind mount.

The directory contains a SQLite index including original provider responses, normalized rich lyric documents, item selections, generated variants, preferences, and generation requests. Variants are keyed by source content hash, language, service, model, and generation settings. Media paths are never used as write targets by LyricBridge.

To relocate an existing cache, stop Jellyfin, copy the complete directory (including SQLite WAL files if present), change the setting or mount, and restart. Back up this directory alongside Jellyfin's configuration. Do not point it at a read-only library or a filesystem that does not support SQLite locking.

Jellyfin's own standard lyric downloader controls its save location independently. Disable **Save lyrics into media folders** in the music library settings to use Jellyfin's internal metadata directory for standard LRC files. LyricBridge's rich retrieval and generation endpoints always use the separate plugin storage.

## Development

Use the pinned SDK in `global.json` and run `scripts/bootstrap-references.sh` before building `src/LyricBridge.csproj`. The bootstrap verifies references from the pinned official server image; `JellyfinReferenceDir` overrides their location for both builds and tests. The helper and upstream notices are in `vendor`; editable renderer source is in `frontend`.

JavaScript tooling uses the exact pnpm version pinned in `package.json` and the Node.js version in `.node-version`. From the repository root, run `pnpm install --frozen-lockfile`; the frontend and browser tests share one workspace lockfile. `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm test:browser` provide the maintained entrypoints. Packaging and CI use the same frozen workspace installation.

Run `dotnet test --project tests/StorageTests.csproj` for storage, approval/quota enforcement, multilingual normalization, provider formats, concurrent retrieval, cancellation, manual selections, and cache invalidation. `browser-tests` contains maintained isolated Playwright fixtures. Run `scripts/test-browser.sh` for desktop/mobile Chromium, Firefox and WebKit. `pnpm build` checks every application module before bundling; `pnpm test` runs workflow/lifecycle unit tests. See [test coverage](TEST_COVERAGE.md) and [risk-based CI/local commands](CI.md).

## Using lyrics

Play a music track in Jellyfin Web, then open its lyrics view. LyricBridge checks existing local lyrics first, then its selected version/cache, and then enabled sources. Existing files remain untouched. Provider-supplied rows take priority. Word timing is used only when it exists; line/plain lyrics remain supported.

Lyrics supplied by Jellyfin are automatically retained in LyricBridge's saved versions. Each track keeps its latest automatic copy; choosing **Use** or explicitly importing Jellyfin lyrics preserves that version when the local lyrics change. Manual selections take precedence and do not trigger an extra Jellyfin read. Deleting an automatic copy removes it from LyricBridge, but a later load can save it again while Jellyfin still supplies it.

Open **Lyrics settings** beside the timing control. **Song** shows source/timing, supplied or generated provenance, timing actions, and per-song language overrides. **Versions** contains version comparison, import and generation. **Display** controls account languages, row visibility, order, sizes and spacing. Changes apply immediately with Saving/Saved feedback and retryable save failures.

Translations and pronunciation included with the original appear in **Versions** under their source name, marked **Provider supplied** (or **Supplied** for local and imported lyrics). Automatic uses these rows first and fills gaps from available versions, marking every contributing version **In use · Automatic**. Choosing the supplied version displays only its rows. These rows remain part of the original and cannot be deleted separately.

Japanese settings appear for Japanese originals; Chinese original script remains independent; choose Chinese (Simplified) or Chinese (Traditional) as the translation language to control translated text and glyph forms. Mixed-language lyrics expose the relevant controls. Undetected Auto groups possible language options in an expandable section. Hidden preferences are retained. Conversion affects presentation and retains original stored text and cue boundaries.

Provider pronunciation takes priority. Missing Japanese romaji is prepared automatically and locally by Kawazu 1.1.4 with its bundled IPA dictionary, including background vocals. Hepburn is the default; Passport and Nippon are available. Originals display immediately while romaji is preparing. Disabling pronunciation stops new local scheduling. Administrators can also disable **Automatically generate missing Japanese pronunciation** under **Language services → Kawazu** (enabled by default); manual generation and saved pronunciation remain available, and already queued work may finish. Local work has no external approval or quota.

Manual scrolling stops automatic following. **Sync** recentres the active block and resumes following; it does not seek or change timing offset. Seeking or changing tracks also resumes following.

**Versions → Search versions** opens a progressive search and preview dialog. Edit title/artist, filter sources, and preview lyrics or temporary playback before saving. Cancel restores the previous version and playback position. Only administrators can save, apply upgrades, reject matches, or mark instrumentals; other users can preview. Provider IDs are under Advanced.

An administrator can search candidate versions, select a version, enter a provider track ID, or explicitly search again for better timing. Manual selections are retained until another explicit selection/upgrade. QQ overrides use numeric song IDs; a search candidate also retains its song MID for line-lyrics fallback.

## Providers and credentials

See [SETUP.md](SETUP.md) for source credentials, translation endpoint formats, container networking, connection tests, and per-song usage. The administrator settings page includes these instructions beside each service/source.

Default order: QQ Music, NetEase, Kugou, Soda Music, Musixmatch, Spotify, Apple Music, LRCLIB. Reorder/disable sources in Dashboard → Plugins → LyricBridge. Matching retains Lyricify's field scores with a default minimum of 70, adding edition, title/artist and duration compatibility gates. One engine serves every retrieval path. Discovery runs at most three provider pipelines concurrently within 20 seconds and compares results for up to two seconds after the first usable result. Cached/local entries do not rediscover on ordinary opening. Later higher-tier matches or higher timing categories become administrator-only Preview offers; displayed selections stay stable. Manual search verifies up to eight candidates per provider within 15 seconds, marks the best eligible result Recommended, and offers explicit sorting while preserving result rows. See [RANKING.md](RANKING.md) for exact rules and limits.

QQ, NetEase, Kugou, Soda, and LRCLIB need no configured account credential. Musixmatch can obtain its own token or use a supplied token. Spotify requires an `sp_dc` cookie; Apple Music requires a media-user token. These two are skipped when unconfigured. Account/region restrictions and undocumented provider APIs can cause failures. Sources are throttled and temporarily backed off after failures; unavailable results are cached briefly to avoid repeated requests.

External generation is always explicit. Google web translation is an unofficial web endpoint and may stop working or be rate-limited. Its romanization is available only for supported scripts and may omit results. DeepL requires an API key (default free API endpoint; supply the paid endpoint if applicable). An AI-compatible service needs a base URL ending at the API root, for example `https://host/v1`, a model, and an optional API key. LibreTranslate needs its server base URL and any required API key. Translation-only services do not provide pronunciation; Google or AI is offered for that task. External services receive the song text when you request generation.

Instrumental status requires an explicit provider flag or Lyricify's exact single-line notice detection. Empty searches and provider errors are different outcomes. Instrumentals display no fake sung rows, cannot generate auxiliary text, and have no Sync button. Provider classifications expire after seven days; Search again bypasses the classification cache while respecting provider backoff. Administrator marks persist until cleared. Actual lyrics win over conflicting provider classifications, which remain available for review.

The plugin processes the whole song, verifies line identities, and caches valid output. Auxiliary rows inherit the original line's window and have no invented word timings. Service/provenance is shown on row hover and generation status. Administrators can approve, reject, cancel, and retry jobs. User requests and automatic approval default to off; quotas default to five new jobs per rolling 24 hours and three active requests. Cache hits consume no new request.

## Installation and updates

Once published, add the maintainer's catalog URL in Dashboard → Plugins → Repositories, install LyricBridge from the catalog, and restart Jellyfin. The plugin ZIP contains the required dependencies, dictionaries and notices; no custom server image is required. Version 0.1.0 requires fresh LyricBridge storage. Back up existing storage and choose a new empty writable directory; no migration or automatic deletion is performed.

Starting with 0.1.1, the enhanced renderer loads automatically in Jellyfin-hosted Web after plugin installation and restart. Enable web renderer defaults to on: File Transformation is preferred when available, otherwise LyricBridge adds a marked block to a writable web index. Settings show status and offer Repair. A read-only web root requires File Transformation compatible with the server, or separate web installation. Independently hosted clients still use the web-assets ZIP and `scripts/web-assets.py`. See [operating instructions](DEPLOYMENT.md) for setup and scoped uninstall.

Build plugin, web and editable-source ZIPs with `scripts/package.sh`, after running `scripts/bootstrap-references.sh`. For acceptance, use `python3 scripts/clean-package.py` followed by `python3 tests/ReproducibleBuild.py` to compare two independent clean builds; see [CI.md](CI.md). Release-mode packaging requires HTTPS repository/download settings and `--release`. Disable or uninstall the plugin through Jellyfin's plugin controls and restart; remove web assets separately. Preserve the plugin storage unless you explicitly intend to reset managed data. Scheduled retrieval starts disabled; after sample validation, enable it and configure/run **LyricBridge: retrieve missing lyrics** in Scheduled Tasks.

## Licenses

Original plugin code and Lyricify-Lyrics-Helper are Apache 2.0. LyricMotion's modified sources remain MPL 2.0; editable TypeScript is under `frontend`, with generated JavaScript and styles under `web`. Kawazu is MIT; LibNMeCab is LGPL/GPL dual-licensed and dynamically linked, with corresponding source packaged. IPA dictionary notices are included. Notices and source revisions are listed in `vendor/UPSTREAM.md` and packaged in each archive’s notices and license files.

## UI and language preferences

Playback controls use Song / Display / Versions tabs in a non-modal glass panel; administration uses five native Jellyfin tabs. See [SETUP.md](SETUP.md) for source setup, saved-versus-temporary version choices and language inheritance. Per-user song overrides use authenticated GET/PUT/DELETE `LyricBridge/items/{id}/language-preferences`; rich responses include `accountPreferences`, `songOverrides`, and effective `preferences`. Null overrides inherit account defaults.

Implementation follows the [Jellyfin plugin template](https://github.com/jellyfin/jellyfin-plugin-template/blob/master/Jellyfin.Plugin.Template/Configuration/configPage.html), [WAI tab interactions](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) and [progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) for advanced configuration. Native theme controls are confined to administration; playback glass styles remain scoped to the bridge.

Python tooling requires Python 3.15 or newer; CI uses the exact version in `.python-version`. Set up with `python3.15 -m venv .venv` and `.venv/bin/python scripts/check-pip.py && .venv/bin/python -m pip install --uploaded-prior-to=P1D -r requirements-check.txt`, then run `pnpm check:python` (or `sh scripts/check-python.sh`). Recreate older virtual environments when upgrading. CI checks all maintained Python scripts and tests, including unannotated function bodies; no Docker or provider calls are made by static checks.

JavaScript/TypeScript quality checks use pinned workspace tools. `pnpm lint` runs ESLint recommended JavaScript and TypeScript rules on application code and maintained build/browser tooling; `pnpm lint:fix` applies safe automatic fixes. `pnpm format` applies Prettier with the repository's 150-column/four-space settings (two spaces for YAML), and `pnpm format:check` verifies them. Formatting excludes generated output, third-party source, static visual assets and the configuration HTML template. `pnpm knip` checks unused files, dependencies, exports and types using explicit application/test entrypoints; browser globals remain public through their typed adapters. `pnpm check` runs ESLint, Prettier, Knip, strict TypeScript, Ruff formatting/linting, Mypy and .NET whitespace formatting, and CI enforces the same gates. Run `pnpm test:tooling` for version guards and Renovate policy regressions. See [dependency migration and automerge setup](DEPENDENCY_UPGRADES.md).

TypeScript 7.0.2 supplies `tsc` through the `@typescript/native` npm alias for normal
typechecking, builds and CI. The `typescript` alias points to `@typescript/typescript6@6.0.2`,
preserving the JavaScript compiler API for ESLint and the boundary checker. Run
`pnpm typecheck:legacy` to check manually with `tsc6 --stableTypeOrdering`; routine CI
uses TypeScript 7 only. Both aliases are pinned in the root and frontend packages.
Editor use of TypeScript 7's language server is optional; follow the editor's LSP
instructions or use Microsoft's TypeScript 7 extension in VS Code. This setup follows
Microsoft's [side-by-side guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-60).

## Release automation

[Release setup and publication](RELEASING.md) explains the release-please PR workflow, verified draft assets and the separate shared Jellyfin catalog update.
