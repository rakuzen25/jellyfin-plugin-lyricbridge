# Lyric matching and ranking

This reference defines recording eligibility, ordering, and improvement offers for discovery,
scheduled/native retrieval, and manual search. All paths use `MatchingSession`.
For provider configuration and selection actions, see [source setup](SETUP.md).

## Recording eligibility

Before fuzzy comparisons, recording qualifiers are extracted from parentheses/brackets, a `-` suffix, or a recognizable album label. Studio/standard, live, acoustic, named remix, instrumental/karaoke, sped-up, slowed, and edit editions are distinguished. Ordinary title words such as “Live Forever” are not edition tags. Featured-artist clauses and remaster/reissue labels are neutral. Explicitly different remix names conflict; an unnamed remix is uncertain about its name. An untagged track is standard unless its album identifies an edition.

Positive known durations must differ by no more than `max(10 seconds, 5% of the library duration)`.
A plausible title and artist overlap are required when those fields are available.
Missing artists remain uncertain; unrecognized aliases require manual selection.

## Metadata score

Lyricify's field comparisons return categorical points of 0, 2, 4, 5, 6, or 7. The weighted sum is:

`title + artists + duration + 0.4 × album + 0.2 × albumArtists`

Missing optional album, album-artist, and duration fields leave the denominator; the result is scaled to a complete-field maximum of 25.2. Title and artist weights remain in the denominator, as in the helper. Each comparison also supplies its explanation, without repeating the comparison.

Duration differences up to and including two seconds receive the same Perfect duration
score; exact differences remain visible.

| Normalized sum | Score |
| -------------- | ----- |
| >21            | 100   |
| >19            | 99    |
| >17            | 95    |
| >15            | 90    |
| >11            | 70    |
| >8             | 30    |
| >3             | 10    |
| Otherwise      | -1    |

These scores are categories, not confidence percentages. Strong is ≥90, Possible is ≥70, and Low is below 70. The configurable automatic minimum defaults to 70; compatibility gates still apply if that minimum is lowered.

## Timing and final order

Only nonblank original lead lines count toward word coverage. Translation, pronunciation and background rows do not inflate it. Cue text positions must lie on Unicode grapheme boundaries, positions/time must be ordered, and known cue ends must be valid. Whole-line cues alone are not word timing. Assessment does not modify rendering data.

| Category             | Rule                                            |
| -------------------- | ----------------------------------------------- |
| Mostly word-timed    | Genuine cues on at least 80% of lead lines      |
| Partially word-timed | Genuine cues on some lead lines, below 80%      |
| Line-timed           | Valid line timing without genuine word coverage |
| Plain                | No usable timing                                |

Eligibility sorts first, followed by match tier, timing category, word coverage,
metadata score, supplied auxiliary completeness, configured provider order, then source/ID.
Comparators inspect precomputed fields; generated auxiliary rows do not affect ranking.

Supplied auxiliary completeness sums the percentages of nonblank original lead lines
with supplied translation and pronunciation (0–200). Multiple translation languages
and background rows do not inflate coverage. The value is computed on parsed provider
documents before generated variants are applied.

## Retrieval limits and offers

At most three provider pipelines run concurrently, retaining per-provider throttling/backoff. A provider tries at most three distinct title/artist/album expansion queries, broadening only when earlier queries produced no usable result. IDs are deduplicated before assessment. Automatic discovery verifies at most three eligible candidates per provider within a 20-second overall deadline including waits. Unavailable/malformed lyrics do not stop fallback; provider-wide failures do.

The first usable result opens a two-second comparison window, bounded by the overall
deadline. All providers finishing closes it early. The best collected result is committed.
Later discovery keeps the displayed selection stable while offering verified eligible
improvements against its baseline.

The first improving quality factor determines the offer reason; a worse earlier factor
prevents an offer:

| Factor                                          | Offer reason             |
| ----------------------------------------------- | ------------------------ |
| Recording eligibility or match tier             | `recording-match`        |
| Timing category                                 | `timing`                 |
| Word-timing coverage                            | `timing-coverage`        |
| Metadata score                                  | `match-score`            |
| Supplied translation/pronunciation completeness | `auxiliary-completeness` |

Provider order and source/ID break ties without creating offers. An auxiliary offer
can trade lower translation coverage for greater combined completeness; its explanation
shows both translation and pronunciation coverage.

Offers explain their comparison and bind to the current content hash. Applying is
administrator-only; changed selections reject stale offers. Preview cancellation,
dismissal, and saved-version selection remain available. Existing selections/local
files stay immediate; administrators can deliberately select conflicting candidates.
Instrumental evidence remains distinct from empty searches and failures.

## Manual search and performance

Manual search has a 15-second deadline and verifies up to eight candidates per provider, retaining conflicts and low matches with warnings. Results append without moving the highlighted candidate. The best verified eligible result is Recommended. “Sort by best match” explicitly moves existing nodes; unchanged polling rebuilds no result rows. Expandable details use server-computed field explanations.

Query metadata is normalized once. Operation-scoped normalization caches are capped at 2,048 values each. Candidate assessments and in-flight verification are deduplicated within that operation; fetched response parsing/coverage is reused for preview and saving. No new global ranking cache is introduced. Assessments are stored separately from lyric documents and content hashing, preserving generated variants and timing corrections.

See [playback performance validation](PERFORMANCE.md) for rendering measurements and
[source setup](SETUP.md) for provider configuration and manual selection.
