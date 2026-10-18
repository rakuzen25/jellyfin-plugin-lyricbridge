# Upstream components

This record identifies pinned sources, notices, and local modifications.
[Distribution requirements](../docs/reference/distribution.md) describe the matching archives and
corresponding-source obligations.

## Lyricify helper

[Lyricify-Lyrics-Helper](https://github.com/WXRIW/Lyricify-Lyrics-Helper) revision
`e875781e2e889d97c3c518fe388decd14805a56f` uses Apache 2.0 (`LYRICIFY-LICENSE`).

Local modifications retain QQ romanization; route Soda, Spotify, and Musixmatch through
cancellable plugin transport; and give provider instances their own credentials and
Spotify/Apple token caches. Searchers accept those instances; global proxy mutation
is removed, and transport errors/cancellation reach sanitized plugin diagnostics.
Matching exposes prepared normalization, skips Chinese conversion for ASCII names,
and calculates each fuzzy similarity once while preserving field scores/buckets.
Recording eligibility and ranking belong to LyricBridge.
KRC/QRC overloads accept bytes, bound decompression, validate containers, and preserve
non-BOM first characters.

## LyricMotion renderer

[LyricMotion 3.3](https://github.com/ThisIsTeddyBear/Jellyfin-LyricMotion) revision
`81aba587140563461fe18f85a43cd73ebb7a74e1` supplies the MPL-2.0 renderer
(`LYRICMOTION-LICENSE`). Local modifications include typed ownership/lifecycle modules,
bridge events instead of another transport interceptor, auxiliary-row decoration/DOM
boundaries, pronunciation-mode suppression when bridge rows exist, following/Sync,
geometry coalescing, and rendering-quality controls. Editable source and MPL notices
ship in the source archive.

[Third-party attribution](LYRICMOTION-THIRD-PARTY-NOTICES.md) and
`DYNAMIC-BACKGROUND-LICENSE` / `KAWARP-LICENSE` come from that pinned revision's
`THIRD_PARTY_NOTICES.md`, `licenses/DYNAMIC-BACKGROUND-MIT.txt`, and
`licenses/KAWARP-MIT.txt`. Preserve these matching MIT notices in plugin/web archives.

## Pronunciation and dictionaries

[Kawazu 1.1.4](https://github.com/Cutano/Kawazu) uses MIT (`KAWAZU-LICENSE`).
[LibNMeCab 0.10.1](https://github.com/komutan/NMeCab/tree/v0.10.1) is dynamically linked
under LGPL-2.1-or-later; upstream also offers GPL-2.0-or-later. Notices/source are
`LIBNMECAB-LICENSE`, `LIBNMECAB-LGPL-LICENSE`, and `LIBNMECAB-SOURCE.tar.gz`;
the archive is authoritative for the source revision.

IpaDicBin 0.10.0 ships with Kawazu. Dictionary COPYING/AUTHORS remain beside data;
COPYING is also packaged as `IPADIC-COPYING`.

## OpenCC conversion

[OpenccNetLib 1.7.0](https://github.com/laisuk/OpenccNet) uses source commit
`01f23ccd4feda86e7607cc1dd92ba93a44252e61` from its published package metadata.
MIT code notice is `OPENCC-LICENSE`; the package dictionary LICENSE is preserved
byte-for-byte as `OPENCC-DATA-LICENSE` under Apache 2.0.

The pinned `OpenccNetLib/THIRD_PARTY_NOTICES.md` is
[OpenCC third-party notices](OPENCC-THIRD-PARTY-NOTICES.md), retaining contributor
attribution and compiled-pack licensing. The source has no separate dictionary
NOTICE/CHANGES file. LyricBridge uses the shipped converter/resources unmodified.

## Desktop QRC decoding

The QMC1 envelope-mask adaptation comes from
[qmc-decoder's seed.hpp](https://github.com/Presburger/qmc-decoder/blob/master/src/seed.hpp)
under MIT (`QMC-LICENSE`). The Lyricify decoder handles the enclosed QRC payload.
