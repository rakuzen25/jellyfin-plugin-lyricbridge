# Upstream components

- Lyricify-Lyrics-Helper: <https://github.com/WXRIW/Lyricify-Lyrics-Helper>, revision `e875781e2e889d97c3c518fe388decd14805a56f`. Apache 2.0 notice: `LYRICIFY-LICENSE`.
- LyricMotion 3.3: <https://github.com/ThisIsTeddyBear/Jellyfin-LyricMotion>. Source revision `81aba587140563461fe18f85a43cd73ebb7a74e1`; notice: `LYRICMOTION-LICENSE`.

Local helper changes retain QQ provider romanization and route Soda, Spotify, and Musixmatch traffic through the plugin's shared cancellable HTTP transport. LyricMotion changes add auxiliary-row decoration hooks, exclude auxiliary rows from its DOM ownership checks, and hide its alternate romanization mode when LyricBridge supplies rows. Timing and karaoke motion remain upstream behavior.

- Kawazu 1.1.4: <https://github.com/Watertrans/Kawazu>, MIT (`KAWAZU-LICENSE`).
- LibNMeCab 0.10.1: <https://github.com/komutan/NMeCab/tree/v0.10.1>. LGPL 2.1-or-later or GPL 2.0-or-later; dynamically linked. License and corresponding source: `LIBNMECAB-LICENSE`, `LIBNMECAB-SOURCE.tar.gz`. Consult the source archive for its authoritative revision.
- IpaDicBin 0.10.0 dictionary: distributed with Kawazu; dictionary COPYING/AUTHORS remain beside the data files and COPYING is packaged as `IPADIC-COPYING`.

Additional LyricMotion changes retain its renderer and add persistent user-controlled following/Sync, coalesced geometry refreshes, and auxiliary-row ownership checks.

Matching-specific helper changes expose prepared name normalization, accept already normalized fields, skip Chinese conversion for ASCII-only names, and calculate each fuzzy similarity once before selecting its bucket. Field comparisons and score buckets are preserved. Recording/timing eligibility and ranking live in LyricBridge rather than the helper.

Provider API instances now own credentials and Spotify/Apple token caches. The plugin injects its owned HTTP client into each instance; searchers accept those instances. The unused global proxy mutation helper was removed. Transport failures and cancellation propagate to sanitized plugin diagnostics. The renderer consumes bridge lifecycle events instead of installing another transport interceptor. Editable renderer source and MPL notices are shipped in the source archive.

Renderer third-party attribution and the Dynamic Background/Kawarp MIT notices
are copied from the pinned LyricMotion revision above: `THIRD_PARTY_NOTICES.md`,
`licenses/DYNAMIC-BACKGROUND-MIT.txt` and `licenses/KAWARP-MIT.txt`. Their local
copies are `LYRICMOTION-THIRD-PARTY-NOTICES.md`, `DYNAMIC-BACKGROUND-LICENSE` and
`KAWARP-LICENSE`; all are shipped with plugin and web artifacts. This preserves
the notices associated with the actual renderer source rather than substituting
licenses from a newer dependency revision.

- OpenccNetLib 1.7.0: <https://github.com/laisuk/OpenccNet>, source commit `01f23ccd4feda86e7607cc1dd92ba93a44252e61` from the published package metadata. MIT code notice: `OPENCC-LICENSE`; the package's dictionary LICENSE is preserved byte-for-byte as `OPENCC-DATA-LICENSE`. The corresponding pinned `OpenccNetLib/THIRD_PARTY_NOTICES.md` is `OPENCC-THIRD-PARTY-NOTICES.md`, including OpenCC contributor attribution and compiled-pack licensing. The pinned source tree has no separate dictionary NOTICE or CHANGES file. LyricBridge uses the unmodified shipped converter and embedded dictionary resources.

- Desktop QRC uploads: QMC1 envelope-mask adaptation from <https://github.com/Presburger/qmc-decoder/blob/master/src/seed.hpp> (MIT, `QMC-LICENSE`). The shared Lyricify decoder handles the enclosed QRC payload. Local KRC/QRC helper overloads accept bytes, bound decompressed output, validate container lengths and preserve non-BOM first characters.
