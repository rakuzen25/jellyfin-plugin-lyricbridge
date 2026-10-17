# Configure sources, languages, and saved versions

After [installation](DEPLOYMENT.md), open **Dashboard → Plugins → LyricBridge**.
Save configuration before testing services. Playback choices live under
**Lyrics settings → Song / Versions / Display**.

## Configure administrator settings

The tabs group configuration and data management by task:

| Tab              | Settings                                                                      |
| ---------------- | ----------------------------------------------------------------------------- |
| General          | Writable storage, scheduled retrieval, web renderer               |
| Sources          | Provider order, credentials, advanced matching                                 |
| Services         | Remote transcription, AI boundary review, Kawazu, translation and pronunciation |
| Display defaults | Defaults for accounts without saved preferences                                |
| Requests         | User permissions, approvals, quotas, request history                           |
| Data             | Storage overview, saved content, accounts, configuration inspection, cleanup and resets |

**Save settings** applies configuration edits across tabs. Switching tabs preserves
edits; failed saves retain values. Tab markers identify unfinished changes. Inline
**Apply** updates the draft; **Cancel** discards that editor's changes. The save footer
is hidden in Data, where actions apply independently. Failed initial loads offer **Retry**.
If settings change elsewhere, saving stops for comparison. Rebase non-conflicting edits,
choose draft or latest for conflicts, then explicitly save again.

Credential editors show whether a value is configured without displaying the saved
value. **Replace credential** and **Clear credential** stage changes; unchanged values
are retained. Connection tests are disabled until relevant drafts are applied and saved.
Connection tests use saved settings and synthetic text; they do not generate library
lyrics. Results stay beside the service. Ready indicates required fields are present, separately from successful live access.

Existing settings migrate to named connections and capability options without
changing models, audio limits, or enablement. Previously inherited AI review becomes
an option sharing the AI connection. Renaming options or connections preserves jobs
and caches; effective setting changes require the existing explicit retry flow.
Saved results remain available after an option is removed.

## Configure lyric sources

Default order is QQ Music, NetEase, Kugou, Soda Music, Musixmatch, Spotify, Apple Music,
then LRCLIB. Reorder or disable providers in **Sources**.

QQ Music, NetEase, Kugou, Soda Music, and LRCLIB need no credentials.
Musixmatch can obtain a token automatically; optionally supply a valid `usertoken`
from your own client, rather than a developer API key.

For Spotify:

1. Sign into [Spotify Web](https://open.spotify.com).
2. In browser Developer Tools, open **Application/Storage → Cookies → open.spotify.com**.
3. Copy only the `sp_dc` value into **Credential**, enable Spotify, and save.

For Apple Music:

1. Sign into [Apple Music Web](https://music.apple.com).
2. In Developer Tools → **Network**, inspect an authenticated Apple Music API request.
3. Copy its `media-user-token` header value into **Credential**, enable Apple Music,
   and save. If no such header is available, leave the source disabled.

Spotify OAuth/developer credentials and Apple developer tokens are not accepted.
These sources are skipped when unconfigured; required credentials unlock their enable
controls. Keep session tokens private and replace expired credentials.
Account/region restrictions and provider API changes can affect availability.

To check retrieval, play a known track and open
**Lyrics settings → Versions → Search versions**. Filter to the configured source and
preview a result. No match alone does not establish a configuration failure.
Only administrators can save original selections, apply offers, reject matches, or
mark instrumentals. Provider IDs are under **Advanced**; QQ overrides use numeric
song IDs, while search candidates also retain song MIDs for line-lyrics fallback.

Musixmatch verification challenges report `provider_verification_required` and back
off for five minutes. Other providers remain available. Wait for the retry time,
review the optional token, or disable that source. A supplied token does not guarantee
removal of a challenge; do not automate verification bypass.

## Configure translation and pronunciation

**Services** groups setup by **Transcription**, **Translation**, **Pronunciation**, and
**Line-break review**. Expand a capability to add named options. **Connections** stores
shared endpoints and credentials; each option chooses its connection, model, timeout,
and task-specific settings. Multiple options can use one connection.

Badges sit beside names and use **Ready**, **Needs setup**, or **Disabled**. Ready means
configuration is complete, not that a live connection test succeeded. Counts, provider
types and local processing appear in secondary text. Google and Japanese romaji are
built in and do not require connections. Local phrase breaking is always available.

Use **Apply** to stage an editor's changes or **Cancel** to discard them. Finish the
editor before selecting **Save settings**. Connection edits affect all referencing
options; remove those options before deleting a connection or changing its type.
Incomplete setup can be saved, but cannot receive requests.

Connection types and required fields:

| Service        | Endpoint                                                  | Required configuration                             |
| -------------- | --------------------------------------------------------- | -------------------------------------------------- |
| Google         | Built in                                                  | None; unofficial web endpoints may be rate-limited |
| DeepL API Free | Blank or `https://api-free.deepl.com/v2/translate`        | DeepL API key                                      |
| DeepL API Pro  | `https://api.deepl.com/v2/translate`                      | DeepL API key                                      |
| AI compatible  | API root, for example `https://your-provider.example/v1`  | Exact model ID; API key if required                |
| LibreTranslate | Server base URL, for example `http://libretranslate:5000` | Installed language models; API key if required     |

DeepL requires an API account; a translator subscription alone does not provide API
access. See [DeepL authentication](https://developers.deepl.com/docs/getting-started/auth).
For [LibreTranslate](https://docs.libretranslate.com/), install the needed language
models and configure [API keys](https://docs.libretranslate.com/guides/manage_api_keys/)
as required by your instance. DeepL and LibreTranslate provide translation only.
Google pronunciation is limited to its supported scripts; AI capabilities depend on
the chosen model.

The AI adapter appends `/chat/completions` to its base URL; LibreTranslate appends
`/translate`. Omit these suffixes from those fields. Paste API keys without `Bearer`.
AI models must support JSON-object output and return every lyric line ID in order;
invalid mappings are rejected.

Local endpoints must be reachable from Jellyfin's container. `localhost` refers to
that container. On a shared Docker network, use the service name and port,
such as `http://libretranslate:5000`.

After configuring a service:

1. Select **Save settings**.
2. Open a saved translation or pronunciation option and select **Test connection**.
3. If it fails, inspect the local diagnostic, correct settings, save, and retry.

Tests use synthetic translation or Japanese pronunciation text. A successful test
does not verify every language or capability. Save connection and option changes
before testing. Transcription and AI review use their normal request workflows.

In **Versions**, explicitly choose a service for each translation or pronunciation
request, even when only one option is available. No service is preselected or remembered.
External services receive song text. User requests and automatic approval default
to off; default limits are five new jobs per rolling 24 hours and three active
requests. Cache hits consume no new request. Administrators manage approval,
rejection, cancellation, and retry under **Requests**.

### Choose AI settings and translation context

AI **Thinking level** defaults to **Provider default**, which omits
`reasoning_effort`. Explicit None, Minimal, Low, Medium, High, and Extra high send the
matching value and omit temperature. Use a level supported by your endpoint/model.
Language-service HTTP timeouts range from 5–600 seconds. New options default to
120 seconds, including AI line-break review and transcription; migrated options preserve their timeout. Higher thinking levels may
need longer timeouts. Transcription supports up to 3,600 seconds.

For Google, DeepL, and LibreTranslate, **Advanced generation settings** provides independent **Context lines before/after** values from 0–10, both defaulting
to zero. Start with a small window. DeepL uses its
[context parameter](https://developers.deepl.com/api-reference/translate/request-translation);
Google/LibreTranslate use markers and reject missing/duplicated markers rather than
attach neighboring text. This heuristic does not guarantee better translations.
AI already receives whole-song indexed input; context windows do not apply to
AI or pronunciation.

Jobs snapshot submitted settings. New jobs/retries use the latest saved settings;
cache identity includes model, thinking level, context, and prompt version.
Existing outputs remain usable until replacements succeed. Generation validates line
identities; auxiliary rows inherit original line windows without invented word timing.

### Use local Japanese romaji

Bundled Kawazu prepares missing Japanese romaji, including background vocals, when
pronunciation is enabled. Originals display while it runs. Hepburn is the default;
Passport and Nippon are available. Supplied pronunciation takes priority.
Local work has no external approval or quota.

Administrators can disable **Services → Pronunciation → Automatically generate
missing pronunciation**. Automatic generation uses enabled local pronunciation
options for supported languages; currently only Japanese is supported. Remote
services require a manual request. Turning automatic generation off stops new
scheduling; saved rows and manual generation remain available, and queued work
may finish. Disabling the local option or pronunciation display also stops new
automatic local scheduling.

## Choose playback languages and display

**Song** opens by default and contains source/timing summaries and song language
overrides. **Versions** contains originals, imports, previews, and language versions.
**Display** contains account languages, visibility, order, typography, and layout.
Changes save immediately with retryable failure feedback.

Song overrides default to **Use account default**; explicit **Auto-detect** can override
an account original language. Overrides sync per Jellyfin user/song, survive version
changes, and do not trigger external generation. **Reset song language overrides**
restores inheritance.

Japanese romanization and Chinese original script are account-wide. Chinese translation
script follows the selected **Chinese (Simplified)** or **Chinese (Traditional)**
translation language. Mixed-language lyrics expose relevant controls; Auto-detect
groups possible options in a disclosure. Hidden preferences remain saved. Conversion
preserves original stored text and cue boundaries.

Manual scrolling suspends following. **Sync** recentres and resumes following without
seeking or changing timing. Seeking or changing tracks also resumes following.
For reduced rendering load, choose **Display → Text sizes and layout → Rendering
quality → Low power**. Artwork becomes stationary and glyph lift/glow stops, while
timed highlighting continues. Standard is the default; quality is saved in this
browser. See [performance limits](PERFORMANCE.md).

## Transcribe audio and review line breaks

Add and enable an option under **Services → Transcription**, using an AI-compatible
connection and a transcription model. Configure an API base
including `/v1`, model ID, and optional bearer key. LyricBridge appends
`/audio/transcriptions`. The initial example is `https://api.groq.com/openai/v1`,
`whisper-large-v3`, Opus in an Ogg container, and a 25 MB endpoint upload limit.
Opus is the default for new options; existing saved format choices are retained.
Choose WAV, FLAC, or Opus according to endpoint support; FLAC remains available
for lossless uploads. Jellyfin's configured FFmpeg prepares audio;
LyricBridge does not run local inference. Administrator password fields follow the
existing credential convention; playback/job responses and logs exclude keys.

Open **Lyrics settings → Versions → Original lyrics → Transcribe audio**, then choose
a transcription service. Use the
current local Jellyfin track or upload a copy of the same recording starting at time
zero. An audio language code is optional (`auto` detects it). Input uploads default
to 256 MB, with at most three staged uploads per account. Unfinished uploads can be
resumed with **Use staged audio** or removed with **Discard staged audio**. Prepared audio is bounded;
recordings exceeding the staging limit must be shortened. Normal request permissions,
approval and quotas apply even when the track has no selected lyrics.

When new transcription is unavailable, the dialog explains whether requests are
disabled, transcription is turned off, or service setup is incomplete. Saved
transcription results remain available for review.

If prepared audio exceeds the endpoint limit, **Transcribe in chunks** shows the
proposed chunk count before retry. A chunked recording is one request; administrators
see its count during approval. Chunk boundaries prefer pauses and never overlap.
Explicit retries retain the chosen option and reuse compatible completed chunks.
Choose another option by starting a new request. Review chunk seams for recognition
errors. When timestamp options are rejected, **Use segment timing only** offers an
explicit fallback; untimed responses cannot become karaoke.

Successful results remain until deleted. Raw responses, timed tokens and provider text
are retained separately. Karaoke uses timed-token text when it disagrees with full
provider text. Overlapping/decreasing token times remain intact. Temporary audio is
removed after success, rejection or cancellation; failed-job and unclaimed staging
expires after seven days. Cancelled uploads need uploading again for a new request.

**Review line breaks** opens the latest saved entry. New transcriptions have no saved
line breaks: **Generate automatic line breaks** creates an unsaved draft. Japanese uses the
bundled NMeCab/IpaDic dictionary; other languages use generic word, punctuation and
pause rules. Character/duration targets are soft. Split/merge, boundary playback,
undo/redo, reset and saved-version switching leave token text and timing intact.
Manual cuts may override grammatical advice but cannot split tokens or grapheme
clusters. Segment-only output cannot split inside an untimed segment. Transcript
correction and waveform editing are not part of this editor.

Manual changes and **Apply automatic line breaks** change only the draft.
**Save line breaks** retains its boundaries and preferences without changing playback;
**Use reviewed lyrics** saves and selects an original atomically. Saving keeps undo history.
**Reset edits** restores the captured baseline. Navigation offers Save and continue,
Discard, or Keep editing; failed saves preserve the draft. AI submission captures a
private input snapshot without adding that draft to the saved list.

**Manage saved line breaks** lists each entry's origin and service metadata with a
Delete action. Deleting an entry preserves other entries sharing its boundaries and
keeps the current draft and undo history. Deleting the last entry is allowed; reopening
then requires explicit generation. **Delete transcription** removes its entries and
associated reviews and cancels active requests. Owner/administrator permissions and
saved-original dependencies are shown beside disabled actions. Delete dependent originals
first; neither deletion action cascades into originals. Legacy active reviews also block
deletion of their input entry until finished or cancelled.

The review dialog separates **Automatic line breaks** (local targets and application)
from **AI review** (service selection and remote proposal). AI review uses the
character, duration, and short-reply targets from the automatic settings; requesting
it keeps the current edit in place until a result is explicitly opened. Closing the
dialog leaves admitted jobs running. **Dismiss** hides a job notice for the current
track session without cancelling its work. Reopening restores active jobs rather
than resurfacing historical failures.

**Services → Line-break review** configures optional AI review options. Each can reuse
a connection with its own model. Choose a service explicitly for each **AI review**
request. Advanced settings include **Model context window**, defaulting to 32,768
tokens when lookup fails or metadata is unavailable. **Detect model limits automatically**
is enabled by default for new/default options: choosing a connection and model fetches
optional metadata from that endpoint's `/models` response for the exact model ID.
Apply keeps the detected value; Cancel discards it. Turn detection off to enter a manual
limit; existing non-default budgets remain manual. **Fetch model limits** retries discovery.
No external model registry is used.

AI review prefers one whole-transcript request. A conservative input estimate, safety
margin, and response headroom determine whether natural-boundary batches are needed.
The dialog and approvals show the planned AI request count. Providers can make their
own routing attempts beyond this count. Requests run sequentially with a separate
HTTP timeout per batch; completion limits remain the provider's default.

Explicit retries reuse compatible validated batches; changed inputs or service settings
require a new plan. Failed review checkpoints expire seven days after the latest failure;
cancellation clears them. A proposal is saved only after every batch validates. Weak
batch seams are flagged for review. Context-limit rejection requires correcting the
budget before explicit retry; the plugin does not automatically retry or split again.

AI returns boundary IDs only; invalid proposals retain the current edit. Finished proposals offer **Review result** rather than replacing
newer manual work. Every successful review also appears in **Saved line breaks**, including
reviews with the same boundaries as an existing version. These result references survive
notification dismissal and request-history cleanup. The open list refreshes on completion
without replacing edits; reopening a saved transcription also loads completed results.
**Use reviewed lyrics** is administrator-only: it atomically saves
an immutable original and selects it for the shared track. Conflicts preserve edits
and offer a refreshed selection baseline. Translation/pronunciation then use normal
version selection and automatic-pronunciation settings.

Closing review stops previews and view-owned requests; admitted jobs continue and
restore on returning to the track. Delete a result after deleting any saved originals
that still need it. Deleting one original does not remove another version's transcript.

## Select and restore lyric versions

In **Versions**, expand a version to browse its actions; expansion does not change
playback. **Preview with playback** uses a persistent glass bar above playback
notifications. Its **Return** action (or Escape) restores the previous lyrics without
seeking, then reopens the source panel with its edits and scroll position intact. The same behavior applies to saved originals, translation/pronunciation,
imports, and transcription review. Save, Use, and Cancel stay in the source panel;
transcription's **Playback preview** is in its bottom action bar before Save and Use.
**Use** saves the applicable choice. Supplied rows remain attached to their
original and cannot be deleted independently.

**Saved originals** retains selected providers, upgrades, and imports; identical
imports reuse an entry. Jellyfin lyrics are retained automatically, with one latest
automatic copy per track. Explicitly choosing/importing that copy preserves it across
local lyric changes. Deleting an automatic copy can be followed by a new automatic
save while Jellyfin still supplies it. Manual selections take precedence.

Everyone with song access can preview saved originals. Administrators select originals
for the library or delete them after confirmation. Changing originals restores matching
language versions, personal auxiliary choices, and shared timing; generated rows are
never remapped between originals.

Translation/pronunciation versions show service, model, thinking level, and time where
available. **Use** saves an auxiliary choice for your account and original content;
translation choices are separate per target language. **Automatic** prefers supplied
rows and fills gaps from available versions, marking contributing versions
**In use · Automatic**. Choosing a supplied version uses only its rows.
**Provider supplied only** excludes generated rows. Hidden selected rows retain usage
badges. Generated text does not mark a lyric provider as its source.

**Generate** saves another version without discarding previous outputs or changing
your current explicit choice. User auxiliary choices do not change anyone else's
display or the administrator's original selection.

### Delete an original

Deleting removes that song's association and shared timing. The newest remaining
original replaces a deleted current original. If none remain, lyrics clear and
automatic discovery pauses until explicit retry, import, or selection.

Shared documents remain while other songs, selections, donors/compositions, improvement
offers, or unaffected active jobs need them. Affected jobs are cancelled; retained
history identifies deleted output and cannot retry it. Media/sidecar files remain intact.

### Correct matches or combine sources

Original actions live in **Versions**. **Remove lyrics** clears selection and suspends
automatic matching; it does not mark the track instrumental. Administrator
**Search again** clears rejection; ordinary users can search/preview without changing
it. Scheduled discovery skips rejected tracks.

**Use Jellyfin lyrics** selects the native version. **Import lyrics** validates an
uploaded file and retains it in plugin storage; see [supported formats](IMPORT.md).

Export the selected composition from **Versions → Export lyrics** as TXT, LRC, enhanced LRC, or lossless LyricBridge JSON. ZIP bundles can include current translation/pronunciation companions and a lossless copy. Administrators can import JSON or exported bundles; see [export and restore](IMPORT.md#export-and-restore).
For provider search, inspect **Match details** and **Recommended**, then preview before
saving. **Sort by best match** explicitly reorders results. Cached opening does not
rediscover providers; improvements are offered without replacing displayed selections.
See [ranking and offer rules](RANKING.md) for eligibility and limits.

Under pronunciation/translation, **Choose … from another source** searches for a donor.
Review mappings, adjust unmatched lines, and save with **Use mapped …**.
Suggestions use normalized text, sequence, and timing; ambiguous rows stay unmatched.
Duplicate/reordered mappings are rejected. Donor rows inherit current original timing,
retain donor provenance, and appear as a separate supplied auxiliary version.

Instrumental detection requires an explicit provider flag or exact single-line notice;
empty searches and errors do not qualify. Instrumentals have no fake sung rows,
auxiliary generation, or Sync button. Provider classifications expire after seven days;
**Search again** bypasses classification caches while respecting backoff.
Administrator marks persist until cleared. Actual lyrics take precedence over
conflicting provider classifications.

## Save shared timing

Browser timing adjustments are personal. In **Song → Shared timing**, administrators
can select **Save timing for everyone** to add their personal adjustment to the shared
correction and reset that personal adjustment to zero. **Reset shared timing** saves
zero without changing other browsers' personal adjustments.

Corrections belong to a track/original timeline fingerprint. Auxiliary changes retain
timing; switching originals loads that version's correction, including when restored.
Shared corrections affect web playback, leaving native-client lyric files unchanged.

## Manage stored data

Open **Data** to inspect storage usage and browse songs, accounts, saved configuration,
and maintenance categories. Missing Jellyfin songs/accounts remain available using
stored names and IDs. Category payload sizes describe JSON content; database, WAL,
and staged-audio sizes describe physical disk usage. Shared records are counted once
in overview totals. Inspection never retrieves or generates lyrics.

Inspect a record for readable lines with normalized timestamps, saved values, and
labeled ownership, source, and blocking relationships. IDs and sanitized payloads
are expandable under **Technical details**. Dependency inspection from a deletion
review is read-only; Back preserves its confirmation and original expiry. Requests
also provide **Inspect stored request** without leaving their list position. Delete individual records
or select records across pages, then use **Review selected**. Selections stay within
one song, account, or maintenance category; leaving that context clears them. Search
filters apply only through **Search** or Enter. Back restores the previous filters,
page, and position. A dedicated review shows exact targets and effects; results separate
deleted, skipped, and failed items. Failed targets remain selected for a fresh preview.
Confirmation applies to that snapshot; changed
content requires a new preview. Category clears require `DELETE`. Blocked items are
reported and skipped. Deleting shared language versions affects every listed owner;
automatic local pronunciation remains controlled through Display settings.

Song content cleanup removes its originals, transcripts/reviews, and removable
supporting results. Preferences, classifications, and finished history have separate
actions. Original deletion follows the lyrics window: the newest surviving original
becomes selected, or automatic retrieval is suppressed when none remains. Referenced
transcripts and reviews must be released by their owning originals first.

**Maintenance** offers expired-data cleanup, unused temporary-data cleanup, and separate
library and preference resets (`RESET`). Current automatic retention periods remain
unchanged. Active uploads, active-job inputs, and retry data are protected; history
removal preserves rolling request quota accounting.

**Factory reset plugin** requires `FACTORY RESET` and explicit disposal of unsaved
settings edits. It clears managed content, preferences, history, settings, and
credentials, but retains the active storage directory and cancels pending relocation.
Default provider settings can retrieve lyrics again. A partial failure identifies its
phase; refresh, inspect the remaining data, and preview a retry. Data actions execute
independently of **Save settings**. Media files, Jellyfin-managed lyrics, other plugins,
and previous storage locations remain untouched.

## Reset the managed lyric library

Back up [plugin storage](DEPLOYMENT.md#configure-and-back-up-storage) before this
irreversible operation. In **Data → Maintenance → Resets**, select
**Reset managed lyric library**, review its targets, type `RESET`, and confirm deletion.

Reset stops active discovery/generation and deletes audio staging, transcripts,
boundary versions, managed originals/raw lyrics,
language versions, preview caches, timing, selections, classifications, and request
history. Deleted SQLite pages are cleared and compacted. Plugin settings, credentials,
account/song preferences, music/sidecar files, Jellyfin storage, and other plugins'
data remain. Opening lyrics or enabled scheduled retrieval can refill storage.

## Request history retention

Translation, pronunciation, transcription, and AI review share one history policy.
Completed, failed, cancelled, rejected, and settings-changed requests are removed
30 days after their latest terminal transition. Pending, queued, and running requests
are retained. Cleanup runs at startup and daily; existing terminal history receives
a full retention window when first upgraded.

The **Requests** tab separates settings, active requests, and finished history, with
independent paging. Refresh preserves the current pages. Approve and Retry apply
immediately; Reject and Cancel require confirmation. History removal uses the same
snapshot review/results flow as Data.
Empty history hides cleanup actions. **Remove from history** removes one finished request; **Clear finished
history** confirms a snapshot of finished requests and skips any that have become active.
Removal ends retry availability and clears job-owned temporary data. Generated lyric
versions, selected originals, retained transcripts, and saved review proposals remain.
Notification **Dismiss** only hides a notice; it does not remove history or cancel work.
Removing history does not restore the rolling 24-hour request quota.

## Diagnose requests and feedback

Success confirmations expire after four seconds. Progress stays until completion;
errors persist until dismissed/resolved. Dismiss does not cancel work.
Pending approvals, classifications, and configuration availability persist.
Improvement dismissal and failed-job dismissal apply to the current viewing session.
Monitoring failures offer **Retry status check**; confirmed generation failures offer
**Retry generation**.

Use **Dashboard → Logs** or Jellyfin's configured log directory for retrieval,
connection-test, and generation diagnostics. Generation entries include job ID,
service, elapsed time, error code, and diagnostic ID; start entries include model and
thinking level. HTTP entries show destination host, phase, timeout/status, transport
category, and safe provider IDs, with waiting entries every ten seconds.

Non-streaming AI stays at 0% until its complete response is validated. Logs exclude
credentials, headers, full endpoint URLs, lyrics/prompts, and raw responses.
Match safe OpenRouter generation IDs in its [Activity dashboard](https://openrouter.ai/activity).
Model quality and source text still determine translation/readings despite valid format.

## Next steps

- [Review import formats](IMPORT.md) before importing structured or encrypted lyrics.
- [Understand matching](RANKING.md) when investigating recording conflicts or upgrade offers.
- [Maintain storage and web integration](DEPLOYMENT.md) for backups, repair, and uninstall.
