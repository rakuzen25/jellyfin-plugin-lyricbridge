# How lyric selection balances matching and timing

Lyric search must identify the right recording before comparing how well its words are timed.
This explains unexpected recommendations and improvement offers. For actions, see [playback choices](../how-to/playback.md).

## Recording identity comes first

A live performance, remix, or acoustic recording can have excellent timing for the wrong audio.
Duration and recording qualifiers therefore constrain automatic selection before fuzzy metadata scores decide between candidates.
Missing or unfamiliar metadata leaves uncertainty; it is not proof that two recordings are equivalent.

Match categories describe comparisons, not confidence percentages.
Administrators can deliberately choose a conflicting result after previewing it, but lowering an automatic score threshold does not remove recording-compatibility checks.
Exact scoring and ordering live in [ranking policy](../../src/Core/Retrieval/LyricRanking.cs).

## Timing quality is separate from text availability

Word timing can improve karaoke only when cues describe genuine original words.
A whole-line cue or auxiliary translation does not establish word coverage.
Supplied translation and pronunciation can improve completeness, while generated auxiliary text does not retroactively improve the source's rank.

Provider priority resolves otherwise comparable choices rather than establishing that the preferred provider always has the best recording.
Assessment explains a candidate without modifying its lyric content or timing.

## Discovery preserves a stable selection

Automatic discovery balances finding a useful result with waiting for slow providers.
Manual search can expose uncertain candidates that automatic discovery would avoid.
An empty search, provider error, and positive instrumental classification are different outcomes.

An improvement offer compares against the currently selected content and explains its first meaningful improvement.
It does not silently replace a manual selection. A later selection change can make an old offer stale.
Preview before applying an offer, especially when a completeness gain trades one kind of auxiliary coverage for another.

Manual removal suspends automatic matching so repeated discovery does not undo an administrator's decision.
Use an explicit search, import, or selection to resume. [Configure sources](../how-to/configure.md#enable-sources) when a provider is unavailable rather than changing ranking to compensate for access failures.
