# Changelog

## [0.1.3](https://github.com/rakuzen25/jellyfin-plugin-lyricbridge/compare/v0.1.2...v0.1.3) (2026-10-14)


### Features

* add import validation and UI changes ([b0bd09e](https://github.com/rakuzen25/jellyfin-plugin-lyricbridge/commit/b0bd09ecc1f562fc64a748cf7e73c2a1ee8e9d7e))
* UI and ranking changes ([979ad16](https://github.com/rakuzen25/jellyfin-plugin-lyricbridge/commit/979ad162cf951ded78f3537c5e7087dddfb4d948))


### Bug Fixes

* **deps:** update routine dependency updates ([#28](https://github.com/rakuzen25/jellyfin-plugin-lyricbridge/issues/28)) ([35d15b9](https://github.com/rakuzen25/jellyfin-plugin-lyricbridge/commit/35d15b983fdd4a9cfc9625e727e9c5b1b23c941a))

## [0.1.2](https://github.com/rakuzen25/jellyfin-plugin-lyricbridge/compare/v0.1.1...v0.1.2) (2026-10-13)


### Features

* add save-original and optimizations ([6a732e2](https://github.com/rakuzen25/jellyfin-plugin-lyricbridge/commit/6a732e22aa8b4ff5897c6b735e803356935f50c9))


### Bug Fixes

* fix ci ([c9f72ff](https://github.com/rakuzen25/jellyfin-plugin-lyricbridge/commit/c9f72ff6f2ddb54ca6985647ea17e9b631244525))
* improve web renderer status ([e538b0a](https://github.com/rakuzen25/jellyfin-plugin-lyricbridge/commit/e538b0a34a1b916ff3e6d582dd1700759328f4dd))

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

* Provider discovery, ranked manual search, transactional selection/upgrade, lyric imports and native Jellyfin integration.
* Saved multilingual versions, partial pronunciation, explicit generation profiles, approval/quota enforcement and immutable running-job settings.
* Per-account and per-song preferences, timing corrections, retained job history and reference-safe temporary cleanup.
* Strict TypeScript bridge and renderer modules, owned asynchronous work and standalone supported pronunciation behavior.
* OpenccNetLib conversion with preserved originals/Unicode timing and complete dependency notices/corresponding source.
* Reproducible plugin, web and editable-source packages; independent plugin releases and safe shared-catalog merging.
* Pinned validation tooling and isolated backend/browser/official-image installation coverage.

Historical preview aliases and browser-preference migrations are removed. ARM64 and live credential-dependent provider behavior remain unverified. Release acceptance belongs to the exact artifact hashes and checks in `dist/validation.json`.
