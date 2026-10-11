# Changelog

## 0.1.0

Initial release candidate for Jellyfin 12.2 / .NET 10 on Linux x64. Install into empty LyricBridge storage; no preview data migration is provided. The plugin GUID remains unchanged.

- Provider discovery, ranked manual search, transactional selection/upgrade/revert, lyric imports and native Jellyfin integration.
- Saved multilingual versions, partial pronunciation, explicit generation profiles, approval/quota enforcement and immutable running-job settings.
- Per-account and per-song preferences, timing corrections, retained job history and reference-safe temporary cleanup.
- Strict TypeScript bridge and renderer modules, owned asynchronous work and standalone supported pronunciation behavior.
- OpenccNetLib conversion with preserved originals/Unicode timing and complete dependency notices/corresponding source.
- Reproducible plugin, web and editable-source packages; independent plugin releases and safe shared-catalog merging.
- Pinned validation tooling and isolated backend/browser/official-image installation coverage.

Historical preview aliases and browser-preference migrations are removed. ARM64 and live credential-dependent provider behavior remain unverified. Release acceptance belongs to the exact artifact hashes and checks in `dist/validation.json`.
