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

The three projects are siblings under `src/`: `Core`, `Infrastructure`, and `Host`.
Features are grouped within those boundaries. Core owns lyrics/composition,
retrieval/ranking, preferences/timing, generation, transcription, and service
configuration. Infrastructure groups storage, retrieval/providers, formats, language
adapters, transcription, and maintenance. Host groups startup/configuration,
playback/library integration, transcription, administration, and web integration.
Assembly identities and .NET type names remain stable.

Repository contracts live beside their Core feature. Services accept narrow
interfaces such as `IGenerationRepository` and `IPreferenceRepository`; controllers
do not access generic storage keys. Storage partials stay together because completion,
selection, deletion, and reset share transaction and admission fences. The language
adapter project owns the Kawazu dictionary assets its consumers require.

Backend tests have independent Core, Infrastructure, and Host projects. Core tests
reference Core alone; storage and worker fixtures do not construct Jellyfin plugins.
Project-reference policy and forbidden host dependencies are checked automatically.
Shared .NET policy lives in `Directory.Build.props`; vendor source retains its own
framework/version.

Jellyfin constructs the plugin after service registration, so configuration access
captures the host owner lazily. Services read that owner's current configuration,
including replacements, and detach events from the same owner on disposal.
Workers stop before storage clears only its own SQLite connection pool.

Generation coordinates admission, approval, shared quotas, cancellation, configuration
identity and restart recovery for language, transcription and boundary-review handlers.
Typed audio/review requests and their outputs remain separate from auxiliary variants.
Core plans context-budgeted review requests with immutable ownership and natural seams.
Infrastructure executes sequential batches and checkpoints validated responses under a
plan/configuration identity; proposals publish only after full coverage validation.
Track-scoped planning previews and admission share the same deterministic planner.
Saved entries hold origin, preferences, and provenance separately from deduplicated immutable
boundary payloads. Explicit Save and atomic Save-and-Use retain drafts; local breaking and
transcription completion do not create entries. Each completed AI request creates its own
entry, independent of notifications and expiring job history. New review jobs capture their
input snapshot; legacy jobs continue resolving stored versions. Entry deletion revalidates
ownership, original dependencies, and legacy active-job references transactionally, fences
late saves, and collects boundary payloads only after their final dependency is removed.
Schema 5 initializes legacy entries once without recreating deleted results on restart.
The host resolves owned audio IDs/library access and supplies configured FFmpeg through
`IAudioPreparation`; infrastructure owns HTTP and linguistic analysis. Core composes
source-ordered timed tokens directly into rich lyrics, without the file importer's
chronological sorting. Timestamp fidelity is independent of grammatical boundary advice.

Service setup has a configuration version independent of managed storage schema 5.
Core models shared connections, capability options and readiness. Host configuration
normalizes legacy settings deterministically; infrastructure resolves stable option
IDs into existing adapters and immutable execution snapshots. Names and option IDs
are metadata, separate from output-affecting profile/cache identity. Legacy requests
resolve only when unambiguous; stored legacy jobs retain their migrated option identity.
Public catalogs expose safe option metadata, never endpoint credentials. Automatic
local Japanese pronunciation remains independent of explicit remote option selection.

## Frontend ownership

One playback-preview controller owns the reversible document baseline, deferred
retrieval responses, source-panel visibility, and focus restoration for all preview
callers. Callers provide typed requests rather than bar elements. The body-mounted
playback overlay has one geometry owner, using the lyric scrollport and visual viewport;
a dedicated preview slot remains above the independently scrolling notification list.


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

Frontend applications contain feature folders; their installation modules compose
owners, wire effects, publish supported APIs, and release resources. Bridge owners
separate track acceptance/polling, preferences, catalog actions, lyric presentation,
settings/dialog navigation, notifications, search, versions, and transcription.
Administrator settings transactions own drafts, server baselines, conflict choices,
and load/save revisions independently of source/service editors and their DOM.

Renderer owners separate lyric sessions and decoration, media clocks/hooks, frame
scheduling, host observation/recovery, appearance, pronunciation, and preferences.
Each owns its state and exposes commands and read-only views. Stable frozen accessor
facades avoid copying snapshots in the frame loop; render records and host handles
retain their presentation lifetimes. Diagnostics combine owner views into the
supported snapshots. There is one animation scheduler.

Temporary work stays with its owner. Searches capture authentication and own admission,
polling, and release. Generation monitors use the track abort signal. Previews retain
their baseline and newest deferred response until cancel/apply. Image loads and
cooperative yields settle on disposal; generation/view checks reject stale decoration.
Accepted preference writes finish using captured account/song identities even after
playback cancellation. Shared resource ownership lives in `frontend/shared/lifecycle.ts`.
Transcription's panel façade composes submission, result browsing, review, and job owners.
Its DOM-free review controller owns draft history, saved baselines, immutable snapshots,
and separate request/plan/metadata revisions; editor sections dispatch typed commands.
Panel closure cancels uploads and reads, while admitted-job monitors belong to the captured
track. Saved-entry refreshes preserve drafts and previews. Shared feedback and playback
notifications carry stable job identities. Status-check failures do not imply that remote work failed.

Cross-application payloads and public ports live in `frontend/contracts/`, independently
of controllers and installation. Ambient host declarations live in `frontend/platform/`;
shared primitives cannot import application implementations. Renderer installation
implements the explicit full API; bridge access uses a narrower optional capability port
supporting late installation and stock-TV bypass. The established `RendererApi` type
re-export remains available from the renderer runtime.

Feature-private implementations are consumed within their feature or by composition
roots. Cross-feature access uses explicit ports and the reusable operations/algorithms
listed by the boundary checker. Checks reject application imports from contracts/shared,
private cross-feature imports, and runtime dependency cycles.

Repository-level tests live under `tests/backend`, `tests/browser`, `tests/tooling`,
and `tests/installation`; frontend unit tests remain colocated with their owners.
Browser workflow, rendering, and performance groups use one manifest of relative spec
paths, checked against recursive discovery. Reviewed visual baselines live in the
browser workspace's `baselines` directory.

Tooling is grouped under `scripts/ci`, `build`, `release`, `dev`, `checks`, and `common`.
Python entrypoints run as packages from the repository root, with explicit root overrides
where validation targets a separate checkout. Release verification executes the complete
trusted tooling package independently of candidate code. Source inventories, fingerprints,
archives, and cumulative CI classification cover the same maintained roots.

## Storage and deletion

Finished request history expires after 30 days from its latest terminal transition.
Admission accounting is stored separately for the rolling quota window, so manual or
automatic history removal cannot restore quota. Removal revalidates terminal state in
one transaction, clears retry checkpoints, and preserves independently stored results.
Late updates require an existing job. Failed review checkpoints expire after seven
days; active work is exempt. Existing maintenance owns startup/daily cleanup.


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

Transcripts, raw provider responses and immutable boundary versions are explicitly
retained in schema 5 records. Committing a reviewed original checks its selection
baseline transactionally. Transcript deletion fences admitted work and refuses removal
while saved originals still depend on it. Audio staging/checkpoints have separate
cleanup lifetimes; successful output does not retain input audio.

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
