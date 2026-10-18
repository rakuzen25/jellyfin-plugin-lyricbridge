# Import and export fidelity

Choose a format based on what must survive transfer: readable text, karaoke timing, or the complete selected composition.
Import is administrator-only; export is available to anyone with access to the song.
Use **Lyrics settings → Versions** for both actions after [installation](../how-to/install.md).

## Compatibility formats

Supported interpretation choices cover plain text, LRC/enhanced LRC, QRC, KRC, YRC, TTML, LYL, and LYS.
Auto detection also recognizes supported wrappers and encrypted containers.
An explicit format validates that grammar rather than silently falling back to another format. Use Auto for structured wrappers.

TXT preserves literal text. Timed formats preserve supplied ordering and offsets, including overlaps and signed effective times.
An unresolved end is not an invented duration. Invalid or ambiguous auxiliary mappings reject the import instead of attaching text to the wrong line.

TTML support is a lyric profile rather than a complete timing engine.
It supports word/line timing, backgrounds, and recognized auxiliary attribution; container-relative timing and frame/tick expressions have limitations.
See the [TTML interpreter](../../src/Infrastructure/Formats/LyricImport.Ttml.cs) for exact supported constructs.
Preview identifies unsupported structures and source locations before saving.

## Lossless composition and bundles

LyricBridge JSON preserves the selected composition, including rich rows, precise timing, auxiliary choices, and saved playback interpretation.
It excludes unselected versions, request history, credentials, and retained provider bytes.
Import recalculates storage identities: fidelity is semantic rather than byte-for-byte identity.

Exported ZIP bundles identify their files and associations with a manifest.
Keep **Include lossless copy** enabled when you need reliable restoration; without it, only the compatibility representation can return.
Arbitrary ZIP files are not supported.

TXT and LRC-family exports can include auxiliary companions, but cannot express every rich lyric feature.
The export preview reports losses. Exports use saved shared timing and resolved script/language choices, excluding temporary browser timing adjustments.

## Preview and restore

Changing format or encoding invalidates an old preview. Warnings explain recoverable losses; errors block import.
Final import validates again and retains provenance for ordinary files.

File and bundle limits are enforced by the [import implementation](../../src/Infrastructure/Formats/LyricImport.cs) and [native-format handling](../../src/Infrastructure/Formats/LyricImport.Native.cs).
Do not treat a successful preview as permission to submit different bytes.

Lossless confirmation restores the composition and importing user's applicable song choices atomically.
Equivalent account settings continue to inherit; differing choices become song overrides.
Other users keep their own language preferences.
For selection and preview actions, see [playback settings](../how-to/playback.md).
