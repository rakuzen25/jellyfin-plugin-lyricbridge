# Maintained test coverage and historical diagnostics

All application tests use synthetic responses or an owned disposable Jellyfin installation. No historical fixed-server or direct-database diagnostic is an executable entrypoint.

| Behavior | Maintained checks |
| --- | --- |
| Authentication, libraries, native lyrics, admin/user isolation, reset, base URL, restart and uninstall | `tests/PackageInstallation.py`, backend reset/admission/workflow regressions |
| Provider precedence, ranking, retrieval/cancellation, generation identity/snapshots/partial output, selections and transactional retention | Discoverable scenario groups in `tests/StorageTests.csproj` |
| Preferences across navigation/accounts, failed writes and retry | `preferences.test.ts`, `preference-lifecycle.spec.cjs` |
| Search admission/release, generation approval/settings changes/retry, stale previews/selections | `search-session.test.ts`, `generation-state.test.ts`, `preview-session.test.ts`, `workflow-lifecycle.spec.cjs` |
| Supplied/mixed/generated source attribution and hidden selections | `source-usage.test.ts`; search badges remain in the typed search panel |
| Standalone pronunciation parsing/native fallback and UTF-16 alignment | `pronunciation-controller.test.ts`, `payload.test.ts`, `text-processing.test.ts`; provider transport remains mocked |
| Multilingual/background rows, seek/follow/timing, settings and mobile controls | `playback.spec.cjs`, `version-preview.spec.cjs`, `visual-parity.spec.cjs` |
| Missing/instrumental/partial/failed retrieval recovery | `retrieval-states.spec.cjs` and installed-plugin native/import tests |
| Artwork races/fallback/hidden view, teardown/reinstallation and bounded ownership | `artwork-lifecycle.spec.cjs`, `renderer-lifecycle.spec.cjs`, lifecycle/artwork-loader unit tests |
| Sustained playback with artwork/navigation, CPU/layout work and owner counts | `long-session.spec.cjs`, `compare-playback-performance.cjs --long` |
| Automatic injection, permission failures, backup/cleanup, registration contracts, root/base URLs and renderer settings | `WebRendererTests.cs`, `WebInstallation.py`, `PackageInstallation.py`, `injected-renderer.spec.cjs`, `admin-configuration.spec.cjs` |
| Configuration/storage-path validation and history pagination | `admin-configuration.spec.cjs`, backend configuration/repository tests |

The retired scripts listed below duplicated these workflows or relied on credentials, fixed paths, old selectors, direct SQLite edits, or live endpoints. Their useful behavior has been consolidated into the maintained checks above; historical assertions are not counted as current passes. Live-provider connectivity, physical-device performance and ARM64 remain explicitly unverified. The pinned screenshot baseline and its provenance remain unchanged.

## Removed preview scripts

- `background-entry.cjs`
- `comparison.cjs`
- `composition-api.cjs`
- `composition-ui.cjs`
- `config-redesign.cjs`
- `configuration.cjs`
- `connection-errors.cjs`
- `context-live.cjs`
- `efficiency.cjs`
- `explicit-kawazu.cjs`
- `gap-follow.cjs`
- `generation-ui.cjs`
- `google-synthetic.cjs`
- `integration.cjs`
- `jellyfin-web.cjs`
- `karaoke-rows.cjs`
- `language-auto.cjs`
- `language-choice-api.cjs`
- `language-versions.cjs`
- `listener-diagnosis.cjs`
- `loading-languages.cjs`
- `local-fonts.cjs`
- `local-precedence.cjs`
- `local-version-ui.cjs`
- `mixed-rows.cjs`
- `mobile-overflow.cjs`
- `notice-lifetime.cjs`
- `outcomes.cjs`
- `performance.cjs`
- `playback-layout.cjs`
- `ranking.cjs`
- `renderer.cjs`
- `reset-api.cjs`
- `reset-ui.cjs`
- `resources-alone.cjs`
- `resources.cjs`
- `responsiveness.cjs`
- `row-languages.cjs`
- `scroll-follow.cjs`
- `settings.cjs`
- `setup.cjs`
- `shared-timing-api.cjs`
- `song-preferences-api.cjs`
- `source-usage.cjs`
- `stable-controls.cjs`
- `states.cjs`
- `task-surfaces.cjs`
- `transition-profile.cjs`
- `ui-feedback.cjs`
- `ui-redesign.cjs`
- `upgrade-api.cjs`

Generation UI regressions cover whole-phrase Japanese cues, Details expansion/focus after asynchronous control creation, and active-job restoration across real route changes. Sustained playback runs with a synthetic running job and records heap usage, script/layout time, lifecycle counts and polling rate. These controlled browser measurements do not claim physical-device fan or GPU validation.
