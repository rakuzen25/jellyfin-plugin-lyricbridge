# Shipped dependency and source review

This review covers the exact locked packages used by the 0.1.0 candidate. `dependency-inventory.json` inside the plugin ZIP names every shipped assembly/dictionary file, its version, digest and notices. Artifact validation rejects unidentified binaries and missing material. The final hashes and executed gates belong to `dist/validation.json`.

| Shipped component | Terms and corresponding material |
| --- | --- |
| LyricBridge plugin/Core/Infrastructure | Apache-2.0 project LICENSE/NOTICE and editable project sources |
| Modified Lyricify helper | Apache-2.0 license, pinned revision/change record and complete vendored editable source |
| LyricMotion-derived renderer, including extracted modules/CSS | MPL-2.0 notices retained in derived files and built renderer; complete matching TypeScript/CSS/build inputs supplied in the paired editable-source ZIP |
| Dynamic Background / Kawarp adaptations | Pinned upstream MIT copyright/license texts and LyricMotion third-party attribution accompany plugin and web archives |
| Kawazu 1.1.4 | MIT copyright/license text |
| LibNMeCab 0.10.1 and IpaDicBin 0.10.0 assembly | Distributed using LGPL-2.1-or-later; dynamic library linking, LGPL terms and complete corresponding upstream source/build archive supplied. NOTICE permits replacement/modification and reverse engineering for debugging those changes |
| IPA dictionary files | Original COPYING/AUTHORS remain beside installed data; copying conditions also appear in plugin notices |
| OpenccNetLib 1.7.0 and embedded OpenCC dictionaries | MIT code license plus Apache-2.0 data license and actual third-party attribution from package source commit `01f23ccd4feda86e7607cc1dd92ba93a44252e61`. The dictionary license matches the NuGet package bytes. The pinned source contains no additional dictionary NOTICE/CHANGES file |
| Newtonsoft.Json 13.0.3, SharpZipLib 1.4.2, ZstdSharp.Port 0.8.8 | Copyright and MIT license texts supplied |
| .NET runtime-owned components | Host/framework assemblies are excluded from plugin payloads. Applicable runtime license/third-party notices are retained; no Jellyfin-generated web application is redistributed |

The plugin ZIP includes the LibNMeCab source archive. The editable-source ZIP includes that archive, all vendor notices, maintained renderer sources, dependency lockfiles, pinned-toolchain configuration and build/install scripts. The web ZIP includes MPL and background attribution plus NOTICE naming the paired source archive. Corresponding source availability is satisfied by distributing these archives together; public publication remains a separate action.

Browser/build/test tools are restored from lockfiles and are not included as `node_modules` in any archive. The pnpm workspace audit covers both locked toolchains; NuGet restoration refreshes direct and transitive advisories and treats unavailable advisory data as a gate failure. Final advisory results are retained with the exact candidate evidence.
