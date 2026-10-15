# Maintained test coverage

Application tests use synthetic responses or an owned disposable Jellyfin installation.

| Behavior | Maintained checks |
| --- | --- |
| Exact Node/pnpm identity, browser package/image agreement, Renovate automerge exceptions and image extraction | `pnpm test:tooling`, pre-restore toolchain guard and browser executable guard |
| Authentication, libraries, native lyrics, admin/user isolation, reset, base URL, restart and uninstall | `tests/PackageInstallation.py`, backend reset/admission/workflow regressions |
| Provider precedence, ranking, retrieval/cancellation, generation identity/snapshots/partial output, selections and transactional retention | Discoverable scenario groups in `tests/StorageTests.csproj` |
| Saved originals, auxiliary restoration, shared/donor references, deletion rollback, stale admission/confirmation and generation/local completion races | `SavedOriginalTests.cs`, `SavedOriginalApiTests.cs`, `saved-originals.spec.cjs` |
| Preferences across navigation/accounts, failed writes and retry | `preferences.test.ts`, `preference-lifecycle.spec.cjs` |
| Search admission/release, generation approval/settings changes/retry, stale previews/selections | `search-session.test.ts`, `generation-state.test.ts`, `preview-session.test.ts`, `workflow-lifecycle.spec.cjs` |
| Supplied/mixed/generated source attribution and hidden selections | `source-usage.test.ts`; search badges remain in the typed search panel |
| Standalone pronunciation parsing/native fallback and UTF-16 alignment | `pronunciation-controller.test.ts`, `payload.test.ts`, `text-processing.test.ts`; provider transport remains mocked |
| Multilingual/background rows, seek/follow/timing, settings and mobile controls | `playback.spec.cjs`, `version-preview.spec.cjs`, `visual-parity.spec.cjs` |
| Missing/instrumental/partial/failed retrieval recovery | `retrieval-states.spec.cjs` and installed-plugin native/import tests |
| Artwork races/fallback/hidden view, teardown/reinstallation and bounded ownership | `artwork-lifecycle.spec.cjs`, `renderer-lifecycle.spec.cjs`, lifecycle/artwork-loader unit tests |
| Five-minute playback with active artwork/generation/navigation, frame intervals, script/style/layout/heap and owner counts | `long-session.spec.cjs`, `compare-playback-performance.cjs` |
| Original-node retention, auxiliary refreshes, browser-local quality persistence, frozen artwork and paused/hidden frame shutdown | `render-quality.spec.cjs`, `payload.test.ts`, retained visual baselines |
| Automatic injection, permission failures, backup/cleanup, registration contracts, root/base URLs and renderer settings | `WebRendererTests.cs`, `WebInstallation.py`, `PackageInstallation.py`, `injected-renderer.spec.cjs`, `admin-configuration.spec.cjs` |
| Configuration/storage-path validation and history pagination | `admin-configuration.spec.cjs`, backend configuration/repository tests |

## Execution and evidence

See [CI](CI.md) for selection, scheduling, evidence reuse and local commands.
`browser-tests/groups.json` enforces one execution group per spec. Workflow decisions
run in desktop Chromium; layout-sensitive cases also run across desktop/mobile
Chromium, Firefox and WebKit. Chromium performance projects run the sustained
playback/ownership fixtures. Their WebGL/CDP metrics intentionally skip other engines.

Backend tests use xUnit v3 and Microsoft Testing Platform. Host-dependent cases own
fresh plugin configuration and temporary storage. Up to four collections run in parallel;
workers stop before their stores release only their own SQLite pools. Tests that activate
the static File Transformation callback use a nonparallel collection. Composition and keyed-lock
cases report matching, ordering, cancellation and resource-release invariants independently.

`tests/CiPolicy.py` covers source classification, deleted/renamed inputs, metadata-only
selection, runtime fingerprints, scheduling, receipt authentication and artifact proof.
`tests/PackageArtifacts.py` checks archive inputs, notices and checksums;
`tests/ReproducibleBuild.py` compares two independent clean builds;
`tests/PackageInstallation.py` validates the exact plugin in disposable official images.

Keep domain, DOM and installed-server tests when they protect different boundaries.
Use the long-session fixture for sustained ownership and polling behavior; the local
before/after performance comparison is diagnostic. CI retains failed-test traces,
screenshots, performance JSON, backend TRX and logs. Current counts/results belong to
those outputs rather than this guide. Physical-device thermals, live-provider access
and ARM64 require separate evidence.
