# Configure sources, languages, and saved versions

After [installation](DEPLOYMENT.md), open **Dashboard → Plugins → LyricBridge**.
Save configuration before testing services. Playback choices live under
**Lyrics settings → Song / Versions / Display**.

## Configure administrator settings

The five tabs group configuration by task:

| Tab               | Settings                                                                |
| ----------------- | ----------------------------------------------------------------------- |
| General           | Writable storage, scheduled retrieval, web renderer, maintenance        |
| Sources           | Provider order, credentials, advanced matching                          |
| Language services | Kawazu, external service capabilities/setup, synthetic connection tests |
| Display defaults  | Defaults for accounts without saved preferences                         |
| Requests          | User permissions, approvals, quotas, request history                    |

**Save settings** applies configuration edits across tabs. Switching tabs preserves
edits; failed saves retain values. Failed initial loads offer **Retry**.
Connection tests use saved settings and synthetic text; they do not generate library
lyrics. Results stay beside the service. Configured/Ready status indicates required
fields are present, separately from successful live access.

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

Enter endpoints and required fields under **Language services**:

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
2. Select **Test connection** beside the service.
3. If it fails, inspect the local diagnostic, correct settings, save, and retry.

A successful test confirms synthetic English-to-Chinese translation, not every
language or pronunciation capability. Tests remain disabled until required fields
are present; unsaved changes to that service must be saved first.

In **Versions**, explicitly request generation under pronunciation or translation.
External services receive song text. User requests and automatic approval default
to off; default limits are five new jobs per rolling 24 hours and three active
requests. Cache hits consume no new request. Administrators manage approval,
rejection, cancellation, and retry under **Requests**.

### Choose AI settings and translation context

AI **Thinking level** defaults to **Provider default**, which omits
`reasoning_effort`. Explicit None, Minimal, Low, Medium, High, and Extra high send the
matching value and omit temperature. Use a level supported by your endpoint/model.
Service HTTP timeouts range from 5–600 seconds, defaulting to 15; higher thinking
levels may need longer timeouts.

For Google, DeepL, and LibreTranslate, **Advanced generation settings → Translation
context** provides independent **Lines before/after** values from 0–10, both defaulting
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

Administrators can disable **Language services → Kawazu → Automatically generate
missing Japanese pronunciation**. This stops new automatic scheduling; saved rows and
manual generation remain available, and queued work may finish.
Disabling pronunciation also stops new automatic local scheduling.

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

## Select and restore lyric versions

In **Versions**, expand a version to browse its actions; expansion does not change
playback. **Preview** is temporary; cancellation restores previous lyrics and playback
position. **Use** saves the applicable choice. Supplied rows remain attached to their
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

## Reset the managed lyric library

Back up [plugin storage](DEPLOYMENT.md#configure-and-back-up-storage) before this
irreversible operation. In **General → Maintenance → Reset managed lyric library**,
type `RESET`, then select **Delete managed lyric library**.

Reset stops active discovery/generation and deletes managed originals/raw lyrics,
language versions, preview caches, timing, selections, classifications, and request
history. Deleted SQLite pages are cleared and compacted. Plugin settings, credentials,
account/song preferences, music/sidecar files, Jellyfin storage, and other plugins'
data remain. Opening lyrics or enabled scheduled retrieval can refill storage.

## Diagnose requests and feedback

Success confirmations expire after four seconds. Progress stays until completion;
errors persist until dismissed/resolved. Dismiss does not cancel work.
Pending approvals, classifications, configuration availability, and history persist.
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
