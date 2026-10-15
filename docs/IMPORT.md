# Lyric file imports

Imports are administrator-only. Preview is read-only; final Import repeats validation with the same original bytes, encoding and format choice before changing selection. Both uploaded bytes and decoded UTF-8 text are limited to 1,000,000 bytes. There are no additional parsed-line, cue or expanded-text limits: repeated LRC timestamps can produce substantially more displayed content than the input size. Text previews load 100 rows at a time.

## Interpretation and preservation

Auto recognizes the maintained native formats, JSON/XML wrappers and supported encrypted KRC/QRC containers. Explicit choices are `txt`, `lrc`, `elrc`, `qrc`, `krc`, `yrc`, `ttml`, `lyl` and `lys`; the default request value is `auto`. Safe encrypted-container decoding precedes interpretation. TXT retains decoded markup literally. Other explicit choices validate their native grammar without relying on automatic detection hints or falling back to another format. Use Auto for structured wrappers.

Word cues remain in textual order even when their starts decrease or vocals overlap. Line envelopes expand to contain supplied cues. Signed offset metadata applies once: effective milliseconds equal source milliseconds minus offset milliseconds. Negative effective times remain signed. Conflicting offsets, out-of-range arithmetic, invalid durations and invalid Unicode boundaries fail. Empty terminal markers can supply meaningful boundaries without becoming empty word cues. Metadata remains in the retained source; informational YRC credit records are not treated as sung rows.

Incomplete original/background text or ambiguous/unmatched supplied auxiliary rows rejects the entire import. Empty auxiliary text is allowed when explicitly present; unsupported/malformed auxiliary structures are rejected. KRC retains its existing Chinese translation classification. Meaningful words outside TTML timed spans stay readable without invented cue timestamps. Where a format supplies starts without durations, overlapping starts do not imply a negative duration: unresolved ends stay open with a warning.

## Supported TTML lyric profile

The importer supports the TTML namespace `http://www.w3.org/ns/ttml`, paragraphs and formatting/word spans, explicit line breaks, main/background (`ttm:role="x-bg"`) vocals, agent alignment and the existing Apple/iTunes subtitle/replacement metadata. Original words are retained; replacement text is included as auxiliary text instead of replacing the original. Auxiliary text must name a unique original and a supported language/type.

Timing uses absolute paragraph/leaf-span timestamps, seconds/clock expressions, and millisecond/minute/hour units. Explicit `begin` plus `dur` supplies an end. A zero-origin body/div duration can provide an enclosing end boundary. A missing word end uses an applicable explicit enclosing boundary when it does not precede the word; otherwise the end stays open. Declaration of frame/tick parameters alone does not change supported second-based expressions, but frame/tick expressions are unsupported.

Nonzero container begins, sequential containers, alternate time bases, inherited paragraph starts, nested timed spans, and other unresolved container-relative semantics are rejected with locations. This is a documented lyric profile, not a complete TTML timing engine. Untimed text is preserved; unsupported inline elements or nested background attribution inside a timed word span fail instead of being flattened into the wrong vocal.

## Preview feedback and lifetime

Warnings contain `code`, `message`, and an optional `location`; they do not participate in content hashes. Preview returns a `warnings` array. Expanded envelopes, negative effective times, preserved untimed fragments and unresolved ends are reported through the existing glass feedback component. Diagnostics identify native rows, XML lines/columns or JSON paths. Rejections return at most 20 detailed `issues` and the complete `issueCount`.

Changing encoding or format invalidates the old preview and aborts its request. Closing a preview disposes its request; late results cannot replace a newer draft or another song/account. Final Import blocks Cancel, close and Escape until its result is known. Failures retain the dialog with local feedback; success closes it and refreshes the applicable song. Navigation still disposes the view and rejects late UI updates.

Original file bytes, filename, selected encoding and format interpretation are retained in existing raw provenance.

## Validation

Backend coverage is in `LyricImportTests`, `ImportGuardrailTests` and `ImportWorkflowTests`. Browser import workflow/layout coverage is in `browser-tests/import-lyrics.spec.cjs`. The expansion fixture intentionally accepts 200 repeated timestamps plus 2,000 ASCII text characters: 4,000 input bytes produce 400,000 lyric text characters. It records permitted expansion rather than enforcing a new size or duration threshold.

