# LyricBridge 0.1.0 finding closure

The implementation targets Jellyfin 12.2 / .NET 10 on Linux x64. Source remediation is complete. The release verdict is attached to the exact artifact digests and executed acceptance gates in `dist/validation.json`; an older build or installation result is never attributed to different archives. Publication and installation of this candidate are excluded. The separately authorized live uninstall is recorded in local validation evidence.

## Findings and evidence

| Finding / affected behavior | Correction | Maintained verification |
| --- | --- | --- |
| Generation identity could change while waiting or running | Immutable non-secret profiles, atomic execution snapshots, waiting-job invalidation, explicit retry/reapproval and captured credentials | `GenerationProfileTests.cs`, provider-isolation tests; credential redaction/synthetic HTTP scenarios |
| Rejected-match state could be cleared by ordinary users | Administrator-only mutation and consistent library/actor checks | Disposable installed-plugin anonymous/user/admin, rejection and restricted-library checks |
| Explicit upgrades could overwrite a concurrent selection | Offer validation, expected baseline and replacement in one transaction; 409 preserves newer data | `SelectionRepositoryTests.cs`, `WorkflowConcurrencyTests.cs` |
| Composition/shared timing used stale displayed baselines | Typed services and transactional expected-selection comparisons | Workflow concurrency and composition scenarios |
| Synchronous candidate retrieval bypassed admission | Every HTTP manual search shares two/user and sixteen/global admission | `SearchAdmissionTests.cs`; installed-plugin API gate |
| Reset allowed admitted work to recreate managed records | Explicit reset epochs/worker coordination; refused writes fail instead of reporting success | Discovery/local-pronunciation/reset/workflow barrier regressions; read-only media and preference boundaries in installed gate |
| Configuration/import/provider mappings accepted malformed input | Validation and sanitized actionable errors; actual active storage path and restart-required relocation | Configuration, partial-pronunciation/import tests and typed admin/browser checks |
| Preference saves followed the wrong track/account or lost retry feedback | Captured identity, serialized/coalesced saves independent of track cancellation; explicit retry retained | `preferences.test.ts`, `preference-lifecycle.spec.cjs`, response-error identity regression |
| Mixed-language Google pronunciation failed complete documents | Eligible-row generation, per-row skip reasons, strict row identities and visible partial summaries | `PartialPronunciationTests.cs`; Unicode/timing and synthetic provider fixtures |
| Chinese converter was unsuitable for distribution | OpenccNetLib 1.7.0 adapter, immutable policies, originals/cue boundaries preserved | Backend conversion/normalization and Unicode scenarios; installed dictionary/native-lyrics gate |
| Cleanup raced reference creation | Transactional reference/content validation; cleanup never commits dangling references | Twelve controlled two-order cases in `RetentionConcurrencyTests.cs`, retention/history tests |
| Full-history job scans and unbounded temporary work | Indexed/paginated job queries, explicit worker wakeup, protected 24-hour transients and five-minute searches | Job repository/large-history, admission and retention scenarios |
| Controllers owned storage workflows | Typed query, selection, language-version and timing services; no generic storage keys at controller boundary | `ReleaseBoundaries.py`, backend workflows; Core has no Jellyfin/SQLite/provider implementation dependency |
| Root browser behavior escaped strict checking | Initialization-only TypeScript entrypoints; typed runtime/contracts; separate bridge panels and renderer subsystem modules | All maintained application sources pass strict/indexed checking; source-boundary gate rejects unchecked JS, suppressions, broad `any` and renamed public outputs |
| Stale search/generation/preview results changed a replacement session | Explicit session owners and captured track/account/preview identity | Session unit tests, workflow-lifecycle and preview/apply/cancel browser fixtures |
| Artwork and asynchronous decoration survived their owners | Owned image loads, track/view checks, cancellation and settling cooperative yields; one scheduler | Artwork/lifecycle/unit regressions; repeated route/installation tests, late images and zero-owner disposal |
| Standalone pronunciation lost its supported behavior or leaked requests | Retained native fallback/alignment; owned HTTP/retry work settles or aborts on track/disposal | `pronunciation-controller.test.ts`, payload/text-processing tests; external responses mocked |
| Strict conversion accidentally treated absent UI/gaps as invariants | Optional settings panels remain optional; normal playback accepts no instrumental gap | Retrieval-state, preview/playback and long-session tests assert zero caught animation errors |
| Obsolete preview compatibility remained | Removed preview preference/schema/key/origin migrations, invisible background marker and model-string origin inference; removed 51 retired diagnostics | Fresh-schema tests, current payload/provenance regression and `TEST_COVERAGE.md` |
| Visual and long-session behavior lacked current evidence | Preserved pre-extraction snapshots; bounded 60-second playback/artwork/navigation and ownership/CPU guards | Desktop/mobile Chromium; representative Firefox/WebKit behavior and visual checks. CDP-only soak metrics skip those two engines |
| Packages depended on local builds and incomplete notices | Pinned official references, locked restoration, clean packaging, paired editable source, complete converter/background/LGPL/dictionary attribution | Artifact inventory/hash/source checks, `LICENSE_REVIEW.md`, refreshed pnpm/NuGet advisory data |
| Release identity and shared-catalog updates could drift | Authoritative version/GUID/description metadata; local merge preserves other plugins, versions and unknown fields while rejecting conflicting artifacts | Four deterministic catalog cases, artifact metadata checks and installed-plugin version/GUID checks |
| Reproducibility/install results did not identify the final candidate | Two independent clean source builds must also match the candidate; final plugin/web/source/catalog hashes recorded | `ReproducibleBuild.py`, exact-artifact official x64 catalog/restart/disable/uninstall/base-URL harness |

## Compatibility inventory

| Removed or retained contract | Current consumers and fresh-install implications |
| --- | --- |
| Preview database schemas and historical key/origin inference | Unsupported databases are rejected without reinterpretation/deletion. Users retain backups and select fresh storage; no migration is performed |
| Old Chinese fields, pronunciation preference migrations and job-key fallbacks | Current APIs use account preferences, song overrides, effective preferences, explicit auxiliary choices and required generation profiles. Saved data/history retention follows the current schema |
| Invisible U+2063/U+2060 background sentinel | No current producer emits it. Native provider/bridge use `[ak:bg]`; the old sentinel remains plain original text and no longer changes role/cue identity |
| Model-name “Supplied” inference | Version labels and origins use explicit `originType`; provider/local/generated meanings are never inferred from display strings |
| `window.AppleKaraoke` alias | Removed. The renderer is exposed only through `window.JellyfinLyricMotion`; bridge integration uses its typed adapter. Lifecycle browser checks assert the alias is absent |
| Native camel/Pascal casing, current background/agent/section tags, provider escaping and narrow backing-vocal inference | Retained for reachable Jellyfin/provider transport behavior; Unicode/cue regressions cover the current path |
| Renderer timing fingerprints and preference keys | Fresh `lyricbridge.renderer.*` browser keys replace preview-era keys without importing them; timing corrections still require a matching current timeline fingerprint |
| Retired fixed-server/direct-database diagnostics | Removed after useful behavior moved into owned fixtures. Their historic outcomes are not counted as current passes |
| Obsolete reduced-motion `addListener`, parent-walk WebKit shim and optional FontFaceSet guards | Removed for maintained Chromium/Firefox/WebKit. Current event listeners are lifecycle-owned; late font readiness checks disposal before changing state |
| Missing `accountPreferences` response fallback | Removed. Current retrieval responses require account preferences, effective preferences and song overrides; malformed/preview-era payloads fail before replacing lyrics |
| Startup-copy wrapper and old query-rewriting test | Removed from repository tooling. The current scoped web installer owns content versioning and uninstall; its regression verifies both |
| Schema 4 guard, provider formats, Unicode shaping and current playback recovery | Retained current correctness behavior, not migration paths. Unsupported schemas fail without reinterpretation; stored lyric originals remain unchanged |

## Acceptance record and limits

`dist/validation.json` records source/bundle/artifact hashes, current backend/frontend/browser results, performance reports, advisory/license checks, reproducibility and final installed-plugin results. Logs live in `dist/evidence/`; `dist/SHA256SUMS` identifies the distributable archives and local catalog. The source archive contains this closure table, operating instructions and test inventory.

ARM64, physical-device/battery/thermal performance and credential-dependent provider connectivity remain unverified. ARM64 does not block x64 readiness. Tests use mocked providers and synthetic media; no publication, new-candidate deployment or paid-provider calls were performed. The live removal of the previous plugin and its managed data is separately authorized and recorded; media and Jellyfin core data are preserved. Public release-mode catalog URLs must be configured separately; the tested default catalog is local.
