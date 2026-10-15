# Architecture and contracts

LyricBridge separates domain policy, infrastructure, and Jellyfin integration so
provider and storage details stay outside the domain. This page describes ownership
and compatibility constraints for contributors; see [development setup](DEVELOPMENT.md)
for build commands.

## Backend boundaries

Each project owns a distinct boundary:

| Project                      | Owns                                                                                          | Dependency constraints                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `LyricBridge.Core`           | Models, composition, ranking, generation identity, repository contracts, preference workflows | No Jellyfin, SQLite, HTTP adapters, or helper references                                                      |
| `LyricBridge.Infrastructure` | Repositories, discovery, providers, language services, workers                                | Receives host configuration through factories/snapshots; no request-time global credential/transport mutation |
| `LyricBridge`                | Registration, configuration, authenticated controllers, library access, tasks, native lyrics  | Host singleton access stays here; controllers delegate to explicit services                                   |
| Vendored Lyricify helper     | Provider/format adapters and field comparisons                                                | Separately maintained dependency; preserve [upstream provenance](../vendor/UPSTREAM.md)                       |

Repository contracts live in `src/Core/Repositories.cs`. Services accept narrow
interfaces such as `IGenerationRepository` and `IPreferenceRepository`; controllers
do not access generic storage keys. Multi-record completion and selection are transactional.
Shared .NET policy lives in `Directory.Build.props`; vendor source retains its own
framework/version.

Jellyfin constructs the plugin after service registration, so configuration access
captures the host owner lazily. Services read that owner's current configuration,
including replacements, and detach events from the same owner on disposal.
Workers stop before storage clears only its own SQLite connection pool.

## Frontend ownership

Editable source and static assets live in `frontend/`; `pnpm build` recreates
`dist/web/` for packaging and browser fixtures. The two public TypeScript entrypoints
only initialize their installations. Strict checking includes checked indexed access;
`frontend/check-boundaries.mjs` rejects unchecked JavaScript, checking suppressions,
broad `any`, and changed public asset filenames. Esbuild bundles the checked source.

The bridge owns transport interception and passes payload/lifecycle state to the
renderer. Installation disposal restores transport and releases listeners, observers,
and UI work. Administrator controls use native Jellyfin markup; playback controls use
scoped glass styles. Shared feedback behavior has separate presentation adapters; see
[feedback integration](FEEDBACK.md).

`frontend/renderer/runtime.ts` coordinates host/route/media state, accepted records,
and one scheduler. Auto-follow owns scrolling/suspension; controls own timing and seek
interactions. Artwork resolution owns identity, candidates, and request generations;
its surface owns WebGL and fallback layers. Word models, lyric/instrumental views,
pronunciation, song preferences, and playback coordination have explicit dependencies
and limited state views. Diagnostics expose snapshots without mutation.

Temporary work stays with its owner. Searches capture authentication and own admission,
polling, and release. Generation monitors use the track abort signal. Previews retain
their baseline and newest deferred response until cancel/apply. Image loads and
cooperative yields settle on disposal; generation/view checks reject stale decoration.
Accepted preference writes finish using captured account/song identities even after
playback cancellation. Shared resource ownership lives in `frontend/shared/lifecycle.ts`.

## Storage and deletion

Schema 5 initializes only empty stores; unsupported schemas fail before writes, without
migration. [Storage operations](DEPLOYMENT.md#configure-and-back-up-storage) explain
backup and replacement.

Saved originals associate songs with content hashes. Supplied/generated variants and
account auxiliary choices retain the original identity; shared timing is scoped to
song/content. Generation cache identity also includes language, service, model, and
generation settings.

Original deletion resolves dependencies, selection, job history, and persistent
song/original/content fences in one SQLite write transaction. Previously admitted work
cannot save after a matching fence, even if identical content is re-imported.
Cancellation follows commit outside the write gate; deleted job history does not pin
removed content. Shared documents remain while another live reference requires them.

Minute maintenance removes expired misses while live misses retain the full ten-minute
provider suppression window. Persistent temporary-data cleanup runs daily.

## Supported interfaces

The supported host is Jellyfin 12.2 / .NET 10 on Linux x64. Native serializer casing,
provider formats, Unicode shaping, and WebGL/artwork recovery are regression contracts.
[Import formats](IMPORT.md) and [ranking policy](RANKING.md) have dedicated references.

Per-user song language overrides use authenticated GET/PUT/DELETE
`LyricBridge/items/{id}/language-preferences`. Rich responses include
`accountPreferences`, `songOverrides`, and effective `preferences`; null overrides inherit
account defaults. These preferences persist across original-version changes.

Browser fixtures intercept external requests. Installed-server tests own disposable
accounts, media, and storage; they accept no arbitrary server URL or live credentials.
See [validation groups and boundaries](CI.md) and [performance methodology](PERFORMANCE.md).
