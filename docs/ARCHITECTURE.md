# Dependency boundaries

`LyricBridge.Core` owns models, composition, ranking policy, generation identity,
repository contracts and preference workflows. It must not reference Jellyfin,
SQLite, HTTP provider adapters or the helper dependency.

`LyricBridge.Infrastructure` implements repositories, retrieval/discovery, provider
adapters, language services and workers. Host configuration arrives through injected
factories/snapshots; request paths must not mutate helper global credentials or HTTP
transport. Generation receives `IGenerationRepository`, and preferences receive
`IPreferenceRepository`. Multi-record completion/selection operations are transactional.

`LyricBridge` is the Jellyfin boundary: registration, configuration, authenticated
controllers, library-access policy, scheduled tasks and native lyric integration.
Singleton access is confined here. Controllers delegate selection/import/upgrade, lyric payload assembly, language
versions and timing to explicit services; they do not access generic storage keys.

`vendor/Lyricify.Lyrics.Helper` remains a separately maintained adapter dependency.
Keep its upstream/license record current when changing it.

Frontend source lives in `frontend`; `dist/web` contains generated entrypoints and styles.
The bridge owns transport interception and passes lyric/lifecycle state to the
renderer. Preference saving uses captured account/song identities independently of
playback cancellation. Administrator HTML remains native Jellyfin markup with a
bundled typed controller. Renderer geometry, karaoke animation, Unicode shaping,
timeline bounds, playback clock, scrolling, WebGL engine and lifecycle each have
typed module boundaries. Bridge controls, auxiliary row rendering and selection are also typed. Search
sessions own admission, polling and release using captured authentication; their
late results cannot update a replacement panel. Generation monitors belong to a
track abort signal. Preview sessions own their baseline and newest deferred response,
and discard both on apply. Renderer host discovery, payload preparation and artwork
loading have typed boundaries; artwork cancellation settles pending promises and
releases image listeners/timers.
The two public entrypoints are initialization-only TypeScript adapters. All maintained application code is covered by strict checking and checked indexed access; `frontend/check-boundaries.mjs` rejects unchecked JavaScript, checking suppressions, broad `any` and changed public asset filenames. Bundling remains a separate esbuild step.

Renderer runtime coordinates host/route/media state and one scheduler. Auto-follow owns scrolling and suspension; controls own toolbar and timing/seek interactions. Artwork resolution owns identity, candidates and request generations, while its rendering surface owns WebGL, fallback layers and visual deduplication. Diagnostics read snapshots from these owners without exposing mutation through shared state. Artwork, pronunciation, song preferences, controls, lyric view and playback coordination use explicit typed dependencies and limited state views; they do not copy or receive an unrestricted runtime state contract. Mutable temporary work stays with its owner: image loads, pronunciation requests/retry waits, decoration batches, preview baselines, searches and generation monitors. Shared track identity and prepared records remain coordinated by the runtime. Cooperative yields settle on disposal; generation and view checks reject a resumed stale decoration batch.

Bridge account/track identities remain explicit captured contexts. Display, version and search panels have typed modules; asynchronous search/preview/generation decisions use their session owners. The installation owns transport interception, global listeners, observers and rendering callbacks. Disposal restores transport and releases UI work while accepted preference writes finish using their captured identity.

All maintained browser fixtures intercept external requests. Real-server tests
must own disposable accounts, media and storage; use the package installation
harness rather than accepting arbitrary server URLs. Never use live provider
credentials in the default suite.

Frontend source and maintained static assets live in `frontend/` (static files in `frontend/assets/`). `pnpm build` recreates `dist/web/` with browser-ready bundles, the configuration page, static assets and notices. Packaging and browser fixtures consume that generated directory; it is not editable source.

Saved originals are song/content-hash associations. Generated/supplied variants and
account auxiliary choices retain their original content identities; shared timing
remains song/content scoped. Original deletion resolves the dependency closure in
one SQLite write transaction, updates selection and job history, and advances
persistent song/original/content deletion fences. Work admitted before a matching
fence cannot save output after deletion, including after identical content is
explicitly re-imported. Cancellation is dispatched after commit without holding
the store write gate. Deleted job history no longer pins removed content.
Storage schema 5 is initialized only for empty stores; unsupported schemas are
rejected before initialization, with no migration.

## Renderer ownership

`renderer/runtime.ts` coordinates the host, route, accepted payload and scheduler.
`word-model.ts` prepares cue segments and word motion; `instrumental-view.ts` owns
instrumental DOM and media-time fill. `diagnostics.ts` produces read-only inspection
snapshots without owning playback. `settings.ts` supplies fixed animation/artwork
policy directly to its consumers. `state.ts` defines and initializes installation
state. `shared/lifecycle.ts` owns resources for both bridge and renderer.

Repository interfaces are grouped in `Core/Repositories.cs`; each service still
accepts its narrow contract. Shared maintained .NET policy is in
`Directory.Build.props`; vendored source retains its upstream framework/version.

## Supported contracts

The supported target is Jellyfin 12.2 / .NET 10 on Linux x64 with storage schema 5.
Unsupported stores fail before writes and require a backup plus fresh storage.
Current native serializer casing, provider formats, Unicode shaping and WebGL/artwork
recovery are active input/platform contracts. They remain covered by regression tests.
Browser diagnostics remain available for owned-resource and performance checks.

Plugin registration defers capturing the host plugin until first configuration access because
Jellyfin constructs it after registration. Services retain that owner and read
its current configuration, including configuration replacements. Event subscriptions
detach from the same owner on disposal. Storage retains pooled connections during its
lifetime and clears only its own pool on disposal, after dependent workers stop.
Expired missing-lyric entries are removed by minute maintenance passes; live misses
retain their full ten-minute provider suppression window. Persistent temporary-data
cleanup remains daily.
