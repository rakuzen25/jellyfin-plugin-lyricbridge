# Transcribe audio and review line breaks

Create timed lyrics from a recording, review phrase boundaries, and save the result for playback.
First [configure a transcription service](configure.md) under **Services → Transcription**.
Jellyfin's FFmpeg prepares audio; the selected remote service performs recognition.

## Submit a recording

Use a model that supports timestamped audio transcription. Configure its API root, supported upload format, and endpoint upload limit.
LyricBridge appends `/audio/transcriptions` to the root. Do not infer transcription support from a successful translation connection test.

1. Open **Lyrics settings → Versions → Original lyrics → Transcribe audio**.
2. Choose a transcription service.
3. Use the current Jellyfin track, or upload the same recording starting at time zero.
4. Review the proposed submission and send it.

Normal request permissions, approvals, and quotas apply. **Use staged audio** resumes an available staged upload; **Discard staged audio** removes it.

If prepared audio exceeds the endpoint limit, **Transcribe in chunks** shows a proposed split before retry.
Chunked recognition remains one request. Inspect seams for recognition errors.

If the service rejects word timestamps, the explicit **Use segment timing only** fallback reduces editing precision.
Untimed output cannot become karaoke.

Closing the panel cancels unfinished uploads and view reads. Admitted jobs continue; returning to the track restores their monitoring.
**Dismiss** hides a notice without cancelling work. A monitoring error calls for **Retry status check**, not a new transcription.

## Create and edit a draft

Open **Review line breaks** on a saved transcription. For a new transcript, select **Generate automatic line breaks** to create an unsaved draft.
Automatic targets guide phrasing rather than imposing hard limits.

Split, merge, and preview phrases to check the result. Edits preserve recognized text and timed tokens; they cannot correct recognition or split an untimed segment internally.
Use undo/redo while editing. **Reset edits** restores the captured baseline.

**Save line breaks** retains the draft without changing playback. Saving keeps undo history.
**Use reviewed lyrics** saves and selects an original atomically and requires administrator permission.
If the selection changed elsewhere, review the refreshed baseline before trying again; the draft remains intact.

When leaving unsaved work, choose **Save and continue**, **Discard**, or **Keep editing**.
Failed saves preserve edits. Closing review stops previews and view requests while admitted jobs continue.

## Request AI boundary review

For remote boundary advice, configure an option under **Services → Line-break review**, then explicitly choose it in the editor.
The request captures the current input; it does not replace your working draft.

Check the planned request count before submission. Large transcripts may require sequential batches.
Model-limit detection uses metadata from the configured endpoint; if unavailable, review the budget rather than assuming it matches your model.

After a context-limit rejection, correct the budget before an explicit retry.
Compatible retries reuse completed batches; changed inputs or service settings need a new plan.

A completed proposal offers **Review result** and appears among saved line breaks.
Open it explicitly to compare with newer manual edits. AI boundary advice cannot change transcript text or timing.

## Reopen or remove results

Saved results remain available independently of notices and request history.
**Manage saved line breaks** lets you remove individual entries without replacing an open draft or its undo history.
Deleting the last entry is allowed; reopening then requires explicit draft generation.

Before deleting a transcription, delete saved originals that depend on it.
Transcript deletion removes its review entries and cancels associated work; it does not cascade into originals.
Read blocking relationships beside disabled actions. Temporary audio is not a durable recording backup; keep your own source audio.

## Next steps

[Choose the resulting playback version](playback.md) or [manage retained results and requests](manage-data.md).
