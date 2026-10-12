# Maintained test coverage and historical diagnostics

All application tests use synthetic responses or an owned disposable Jellyfin installation. No historical fixed-server or direct-database diagnostic is an executable entrypoint.

| Behavior | Maintained checks |
| --- | --- |
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

The retired scripts listed below duplicated these workflows or relied on credentials, fixed paths, old selectors, direct SQLite edits, or live endpoints. Their useful behavior has been consolidated into the maintained checks above; historical assertions are not counted as current passes. Live-provider connectivity, physical-device performance and ARM64 remain explicitly unverified. The pinned screenshot baseline and its provenance remain unchanged.

## Execution groups and consolidation

See [CI.md](CI.md) for selection, scheduling, evidence reuse and local commands.
`browser-tests/groups.json` is the enforced file inventory. Workflow decisions run in
desktop Chromium; tagged banner/saved-version layout cases additionally runs across
viewports/engines. Rendering integration runs across all four supported projects;
performance runs on two isolated Chromium runners.

The original `ExistingScenarios()` catch-all is split into independently discoverable
persistence/alignment, provider/admission, improvement/pronunciation, ranking/retrieval,
reasoning/settings, generation-profile, version-history, song-preference, reset,
composition, context and partial-pronunciation tests. Each host-dependent scenario owns
a fresh configuration and temporary root; their legacy helper assertions remain intact.
No concurrency, retention, provider-format or permission assertion was discarded.

| Consolidation | Retained replacement and invariant |
| --- | --- |
| Single renderer disposal/reinstall test | Repeated renderer installation now checks nonzero live resources, double-dispose idempotence, zero resources/artwork, removed global and successful fresh installation on each cycle |
| Packaging URL fixtures formerly in architecture boundary script | Parameterized release-tooling test checks the same unsafe schemes, query/credential URLs and sanitized rejection; architecture checks remain separate |
| Fixed five-second stress poll/frame bounds | Actual measured elapsed intervals account for CDP/GC overhead while still rejecting duplicate polling and excess background draws |
| Candidate plus two comparison builds | Proven clean candidate plus one independent clean-source comparison, with identical archives/catalog/checksums |
| Workflow repetition in Firefox/WebKit/mobile | Chromium keeps state-machine/API behavior; layout-sensitive banner and other rendering/native/lifecycle cases remain cross-engine |

The five-minute `long-session.spec.cjs` remains the authoritative sustained fixture.
The before/after comparison command stays diagnostic and does not add another CI stress
run. Tests at domain, DOM and installed-server levels are retained when they prove
different invariants.

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

Saved-original regressions use isolated schema-5 stores. They cover actual repeated
imports, selection restoration without row remapping, current/previous deletion,
shared-song/composition/snapshot/offer/job references, both ordered completion
races, stale provider work, search cancellation, re-imported content, read-only
previews, administrator/confirmation enforcement and transaction rollback.
Artwork lifecycle fixtures use track identities distinct from demo startup so
cached startup artwork cannot bypass the tested image-admission barrier.

Settings UI regressions cover shared original/auxiliary typography and controls, single-row accordion toggling, stable header geometry, browsing/focus restoration, current-only originals, permission gates, inline and playback previews, and desktop/mobile wrapping. Playback visual baselines are retained.
