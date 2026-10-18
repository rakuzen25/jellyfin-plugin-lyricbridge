# Manage saved data and requests

Use **Dashboard → Plugins → LyricBridge → Data** to inspect and remove plugin-owned records.
Before bulk deletion or resets, [back up plugin storage](install.md#back-up-or-relocate-storage).
Data actions execute independently of **Save settings**.

## Inspect before deleting

Browse songs, accounts, or maintenance categories, then inspect ownership and blocking relationships.
Payload sizes describe stored content; database and staged-audio sizes describe disk usage. Shared records are counted once.
Inspection does not retrieve or generate lyrics.

For individual or bulk removal:

1. Select records within one song, account, or maintenance category.
2. Select **Review selected**.
3. Check the exact targets, dependencies, and effects.
4. Confirm that snapshot, entering the displayed confirmation text where required.
5. Inspect deleted, skipped, and failed results before retrying failures.

Changed content requires a fresh preview. Blocked dependencies are skipped rather than silently cascaded.
Leaving a selection's context clears it; Back preserves the previous filters and position.

## Understand deletion consequences

Deleting an original removes that song's association and shared timing. If it was selected, the newest remaining original replaces it.
If none remain, lyrics clear and automatic matching pauses until explicit retry, import, or selection.
Jellyfin-supplied lyrics can be retained again while Jellyfin still provides them.

Shared content remains while another owner needs it. Dependent transcripts and reviews must be released by their originals first.
Removing a shared language version affects its listed owners. History removal alone does not remove saved lyrics or transcripts.

Music, sidecar files, Jellyfin-managed lyrics, and other plugins' data remain outside these operations.

## Manage approvals and finished history

In **Requests**, review pending work and use the available approval, rejection, cancellation, or retry actions.
Use **Inspect stored request** to investigate retained details without changing work.
**Dismiss** on a playback notice only hides that notice; it does not cancel a request or remove history.

Finished history expires automatically; active work is retained.
Removing finished history ends its retry availability and clears job-owned temporary data, while preserving independently saved results.
It does not restore rolling request quota. Treat request history as an operational record rather than quota accounting.

## Choose a reset

Select the narrowest operation that meets your goal:

| Operation                   | Use when                                                   | Preserves                                                  |
| --------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| Temporary-data cleanup      | You need to remove unused staging and caches               | Active inputs and protected retry data                     |
| Managed lyric library reset | You want to discard retained lyrics and processing results | Plugin settings, credentials, and account/song preferences |
| Preference reset            | You want to clear the selected preferences                 | Lyric content and unrelated settings                       |
| Factory reset               | You want default plugin settings and empty managed data    | Active storage location and data outside that location     |

Library reset stops active work. Enabled retrieval can refill storage afterward.

Factory reset also clears credentials and cancels pending relocation. Resolve unsaved settings edits before proceeding.
If reset partially fails, inspect its reported phase and remaining data before previewing a retry.
Previous storage locations are not cleaned automatically.

## Diagnose a request

Start with the local error and its diagnostic ID. Monitoring failures need a status check; confirmed job failures can offer a generation retry.
Non-streaming AI may show no progress until a complete response validates.

In **Dashboard → Logs**, correlate the job and diagnostic IDs with service, phase, timeout, or status details.
Logs exclude credentials and lyric prompts. Share only relevant diagnostics, not configuration secrets or raw provider responses.

## Next steps

[Configure request permissions](configure.md#control-requests-and-local-processing) or [restore lyrics through import](../reference/import-formats.md).
