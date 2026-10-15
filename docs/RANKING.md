# Lyric matching and ranking

Discovery, scheduled/native retrieval, explicit Search again, and manual search use `MatchingSession`. Existing selections and local files stay immediate; administrators can deliberately select a conflicting result.

## Recording eligibility

Before fuzzy comparisons, recording qualifiers are extracted from parentheses/brackets, a ` - ` suffix, or a recognizable album label. Studio/standard, live, acoustic, named remix, instrumental/karaoke, sped-up, slowed, and edit editions are distinguished. Ordinary title words such as “Live Forever” are not edition tags. Featured-artist clauses and remaster/reissue labels are neutral. Explicitly different remix names conflict; an unnamed remix is uncertain about its name. An untagged track is standard unless its album identifies an edition.

Positive known durations must differ by no more than `max(10 seconds, 5% of the library duration)`. A plausible title and artist overlap are required when those fields are available. Missing artists remain uncertain; unrecognized aliases require manual selection. No artist-alias database is added.

## Metadata score

Lyricify's field comparisons return categorical points of 0, 2, 4, 5, 6, or 7. The weighted sum is:

`title + artists + duration + 0.4 × album + 0.2 × albumArtists`

Missing optional album, album-artist, and duration fields leave the denominator; the result is scaled to a complete-field maximum of 25.2. Title and artist weights remain in the denominator, as in the helper. Each comparison also supplies its explanation, without repeating the comparison.

| Normalized sum | Score |
| --- | --- |
| >21 | 100 |
| >19 | 99 |
| >17 | 95 |
| >15 | 90 |
| >11 | 70 |
| >8 | 30 |
| >3 | 10 |
| Otherwise | -1 |

These scores are categories, not confidence percentages. Strong is ≥90, Possible is ≥70, and Low is below 70. The configurable automatic minimum defaults to 70; compatibility gates still apply if that minimum is lowered.

## Timing and final order

Only nonblank original lead lines count toward word coverage. Translation, pronunciation and background rows do not inflate it. Cue text positions must lie on Unicode grapheme boundaries, positions/time must be ordered, and known cue ends must be valid. Whole-line cues alone are not word timing. Assessment does not modify rendering data.

| Category | Rule |
| --- | --- |
| Mostly word-timed | Genuine cues on at least 80% of lead lines |
| Partially word-timed | Genuine cues on some lead lines, below 80% |
| Line-timed | Valid line timing without genuine word coverage |
| Plain | No usable timing |

Eligible candidates sort by match tier, timing category, word coverage, metadata score, supplied auxiliary completeness, configured provider order, then source/ID. Comparators inspect only precomputed fields. Generated auxiliary rows do not affect ranking.

## Retrieval limits and offers

At most three provider pipelines run concurrently, retaining per-provider throttling/backoff. A provider tries at most three distinct title/artist/album expansion queries, broadening only when earlier queries produced no usable result. IDs are deduplicated before assessment. Automatic discovery verifies at most three eligible candidates per provider within a 20-second overall deadline including waits. Unavailable/malformed lyrics do not stop fallback; provider-wide failures do.

The first usable result opens a two-second comparison window, bounded by the overall deadline. All providers finishing closes it early. The best result collected then is committed. Later discovery keeps the displayed selection stable and offers only a higher match tier or a higher timing category within the same tier. Coverage, score and provider preference alone do not create an offer.

Offers identify a better recording match or better timing, explain the comparison, and are tied to the current content hash. Applying is administrator-only; preview cancellation, dismissal and saved-version selection remain available. Changed selections reject stale offers. Instrumental evidence remains distinct from empty searches and failures.

## Manual search and performance

Manual search has a 15-second deadline and verifies up to eight candidates per provider, retaining conflicts and low matches with warnings. Results append without moving the highlighted candidate. The best verified eligible result is Recommended. “Sort by best match” explicitly moves existing nodes; unchanged polling rebuilds no result rows. Expandable details use server-computed field explanations.

Query metadata is normalized once. Operation-scoped normalization caches are capped at 2,048 values each. Candidate assessments and in-flight verification are deduplicated within that operation; fetched response parsing/coverage is reused for preview and saving. No new global ranking cache is introduced. Assessments are stored separately from lyric documents and content hashing, preserving generated variants and timing corrections.

See `PERFORMANCE.md` for measured results and `SETUP.md` for provider setup. Artist aliases await the separate Jellyfin-wide alias plugin.

Supplied auxiliary completeness breaks ties after metadata score and before provider order. It is the sum of percentages of nonblank original lead lines with nonblank supplied translation and pronunciation (0–200); multiple translation languages and background rows do not inflate coverage. It is computed with timing assessment on the parsed provider document, before generated variants are applied. Generated rows do not influence ranking. Duration differences of up to and including two seconds receive the same Perfect duration score; exact differences remain visible. These tie-break changes do not create upgrade offers or replace saved lyrics.
