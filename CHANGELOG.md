# Changelog

## [0.1.1](https://github.com/rakuzen25/jellyfin-plugin-lyricbridge/compare/v0.1.0...v0.1.1) (2026-10-11)


### Features

* add web UI injection and optimizations ([13bd4d4](https://github.com/rakuzen25/jellyfin-plugin-lyricbridge/commit/13bd4d44b4c5e3796f4c57dd379a52df452cf4d7))


### Bug Fixes

* fix version ([b74d1c6](https://github.com/rakuzen25/jellyfin-plugin-lyricbridge/commit/b74d1c6f3ac32b0acc5570393273b3ab84446ada))

## 0.1.0 (2026-10-11)


### Bug Fixes

* fix ci ([74b6344](https://github.com/rakuzen25/jellyfin-plugin-lyricbridge/commit/74b6344f15bfa9d7344ee78def86c12cafbe0a1e))


### Continuous Integration

* add release please ([8bbd0e0](https://github.com/rakuzen25/jellyfin-plugin-lyricbridge/commit/8bbd0e0baa3247c2cc3d424d9c1d7a9f9a525a9f))

## 0.1.0 (2026-10-11)

Initial release candidate for Jellyfin 12.2 / .NET 10 on Linux x64. Install into empty LyricBridge storage; no preview data migration is provided. The plugin GUID remains unchanged.

- Provider discovery, ranked manual search, transactional selection/upgrade/revert, lyric imports and native Jellyfin integration.
- Saved multilingual versions, partial pronunciation, explicit generation profiles, approval/quota enforcement and immutable running-job settings.
- Per-account and per-song preferences, timing corrections, retained job history and reference-safe temporary cleanup.
- Strict TypeScript bridge and renderer modules, owned asynchronous work and standalone supported pronunciation behavior.
- OpenccNetLib conversion with preserved originals/Unicode timing and complete dependency notices/corresponding source.
- Reproducible plugin, web and editable-source packages; independent plugin releases and safe shared-catalog merging.
- Pinned validation tooling and isolated backend/browser/official-image installation coverage.

Historical preview aliases and browser-preference migrations are removed. ARM64 and live credential-dependent provider behavior remain unverified. Release acceptance belongs to the exact artifact hashes and checks in `dist/validation.json`.
