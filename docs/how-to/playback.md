# Choose lyrics and playback settings

In Jellyfin Web's lyrics view, open **Lyrics settings** to choose versions, languages, and display preferences.
Complete [installation](install.md) first. Administrators [configure providers and services](configure.md) separately.

## Set languages and display preferences

Use **Display** for account-wide languages, visibility, and layout. Use **Song** to override languages for the current track.
**Use account default** restores inheritance; an explicit **Auto-detect** choice can override a fixed account language.

Changes save immediately. If a write fails, use the local retry action.

Chinese original-script and Japanese romanization preferences apply across your account.
Chinese translation script follows the chosen translation language. Conversion preserves stored original text and timing.

For lower rendering load, choose **Display → Text sizes and layout → Rendering quality → Low power**.
This browser-local choice freezes artwork and removes glyph lift/glow while retaining timed highlighting.

Manual scrolling suspends following. Select **Sync** to resume without seeking or changing timing.

## Preview and select a version

In **Versions**, expand a saved original or search result to inspect its actions. Expansion alone does not change playback.

1. Select **Preview with playback**.
2. Listen and inspect the lyrics.
3. Select **Return**, or press Escape, to restore the previous lyrics and reopen the source panel.
4. Select **Use** in the source panel to save the choice.

Original selections affect the library and require administrator permission. Everyone with song access can preview them.
Manual selections stay in place until explicitly changed. See [lyric-selection behavior](../explanation/lyric-selection.md) when a result or improvement offer seems unexpected.

Translation and pronunciation choices belong to your account and the original content.
**Automatic** can combine supplied rows with available generated versions; choosing a specific supplied version uses only its rows.
**Generate** retains a new result without discarding older versions or changing an explicit choice.
Changing the original restores its own associated language choices and shared timing rather than remapping rows from another original.

## Correct a match or combine sources

For an incorrect original, preview another search result before selecting it.
**Remove lyrics** clears selection and suspends automatic matching; it does not mark the track instrumental.
An administrator can select **Search again** to resume discovery.

To use auxiliary text from a different source, select **Choose … from another source** under translation or pronunciation.
Review the proposed line mappings, resolve unmatched rows, and select **Use mapped …**.
Ambiguous mappings need manual review; donor text uses the current original's timing.

Use **Import lyrics** for a local file or **Export lyrics** to download the current composition.
See [import and export fidelity](../reference/import-formats.md) before choosing a format.

## Save timing for everyone

Personal timing adjustments stay in the browser. To make a correction shared, an administrator can use **Song → Shared timing → Save timing for everyone**.
This adds the personal adjustment to the shared correction and resets that personal adjustment.
**Reset shared timing** leaves other browsers' personal adjustments alone.

Shared corrections belong to the selected original timeline and affect web playback, not native-client lyric files.

## Next steps

[Create lyrics from audio](transcribe.md) or [delete saved versions and manage requests](manage-data.md).
