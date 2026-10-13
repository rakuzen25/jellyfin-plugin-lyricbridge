# Source and translation setup

Open Dashboard → Plugins → LyricBridge. Setup instructions are also shown beside each source/service. Changes take effect after **Save settings**. Connection tests use synthetic text; they do not generate lyrics for your library. Connection feedback stays beside the service, while loading/saving feedback applies to the whole settings page.

Sources that require missing credentials have disabled, unchecked enable controls. Enter the required credential to enable the control. Connection tests for translation services stay disabled until their required fields are filled. Save changes to that service before testing; unsaved changes elsewhere do not block its test. Configured status means required fields are present; a successful synthetic connection test is reported separately.

## Lyric sources

QQ Music, NetEase, Kugou, Soda Music, and LRCLIB need no credentials or endpoint configuration. Enable the sources you want, choose their order, and save. Musixmatch can obtain a token automatically; leave its credential blank unless you already have a valid Musixmatch `usertoken` from your own client. That optional token is not a Musixmatch developer API key.

For Spotify, sign into <https://open.spotify.com> in your browser. Open Developer Tools → Application (Storage in some browsers) → Cookies → open.spotify.com. Copy just the `sp_dc` value into Spotify’s Credential field, without `sp_dc=` or other cookies. Enable the source and save. A developer client ID or OAuth access token is not accepted by this adapter.

For Apple Music, sign into <https://music.apple.com> with your own account. In Developer Tools → Network, inspect an authenticated Apple Music API request. Copy its `media-user-token` request header value into the Credential field, enable AppleMusic, and save. This is different from an Apple developer token. If your account does not send such a header, leave the source disabled.

Session credentials can expire. Replace them if the source reports an authentication failure. Keep these values private. These adapters use the [Lyricify helper](https://github.com/WXRIW/Lyricify-Lyrics-Helper); account/region restrictions and changes to provider interfaces can affect availability. “Ready” on a source means configuration is present, not that live access has been verified.

To check retrieval, play a track, open Lyrics settings → Versions → Find versions, and filter to the source you configured. Search a known title/artist and preview the returned lyrics. No match does not by itself mean the source is misconfigured. A provider error gives details and retry availability. Applying a selection is administrator-only.

## Translation and pronunciation

| Service | Endpoint to enter | Credentials/model |
| --- | --- | --- |
| Google | Built in; no editable endpoint | No credentials |
| DeepL API Free | Blank, or `https://api-free.deepl.com/v2/translate` | DeepL API key |
| DeepL API Pro | `https://api.deepl.com/v2/translate` | DeepL API key |
| AI compatible | Your API base URL, e.g. `https://your-provider.example/v1` | Exact model ID; API key if required |
| LibreTranslate | Server base URL, e.g. `http://libretranslate:5000` | API key if the instance requires one |

Google translation works without setup. Local Kawazu Japanese romaji is bundled and automatic when pronunciation and Japanese romaji are enabled. Google pronunciation and AI generation are explicit alternatives; their availability depends on the service/language. Google web endpoints are unofficial and may be rate-limited.

For DeepL, create a **DeepL API** account, then copy a key from the account’s API Keys tab. A normal translator subscription alone does not configure API access. Enter the complete translation URL for a paid API account; the plugin’s blank default is the Free endpoint. See [DeepL authentication and endpoint documentation](https://developers.deepl.com/docs/getting-started/auth).

For an AI-compatible service, use its Chat Completions compatible API base URL. The plugin appends `/chat/completions`, so do not include that suffix in the field. Paste the API key without the `Bearer` prefix and enter the exact model ID. The model must support JSON-object output and return every lyric line ID in order. Incorrect mappings are rejected.

AI **Thinking level** defaults to **Provider default**, which omits `reasoning_effort`. Explicit None, Minimal, Low, Medium, High, or Extra high send the matching Chat Completions value and omit temperature. Select a level supported by your endpoint/model; unsupported settings produce a visible configuration error. HTTP timeout is configurable per service from 5–600 seconds (default 15). Higher thinking levels often need a longer timeout; running jobs retain their submitted timeout. New requests and Retry use the latest saved timeout. New jobs snapshot the chosen level, and cached variants are separated by level; existing working rows are preserved. See the [Chat Completions parameter reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

For LibreTranslate, [install your own server or use a hosted instance](https://docs.libretranslate.com/). The plugin appends `/translate` to the base URL; do not include that suffix. [API keys](https://docs.libretranslate.com/guides/manage_api_keys/) depend on the instance. Install the language models you need on the server.

Local service addresses must be reachable **from Jellyfin’s container**. `localhost` refers to that container, not your browser or a different container. On a shared Docker network, use the service’s container/network name, such as `http://libretranslate:5000`. Keep the scheme, port, and any API-root path specified by the service.

After entering values, **Save settings**, then **Test connection** for that service. A successful test confirms a synthetic English-to-Chinese request, not every language or pronunciation capability. A failure appears beside the service and stays in that tab; fix the configuration, save, and use Test connection again. DeepL and LibreTranslate provide translation only.

To use a service, play a track and open Lyrics settings → Versions. Choose a translation/pronunciation service and explicitly request generation. Song text is sent to that service. Existing supplied rows remain preferred. Ordinary-user external requests are disabled by default; administrators can configure approvals and quotas on the Requests tab.

## Translation context

Google, DeepL, and LibreTranslate each have **Translation context (optional)** controls under Language services → Advanced generation settings. Set **Lines before** and **Lines after** independently from 0 to 10, then save. Both default to 0. Try a small window, such as one line on either side, before increasing it. More context can help ambiguity but is not guaranteed to improve a lyric translation.

DeepL receives neighboring original text through its [dedicated context parameter](https://developers.deepl.com/api-reference/translate/request-translation), keeping the target text separate. Google and LibreTranslate receive a target surrounded by markers and nearby original lines. LyricBridge accepts only the text between exactly two surviving markers; missing/duplicated markers fail the generation rather than attach neighboring lyrics to a line. This is a heuristic, not a native Google/LibreTranslate context feature.

The AI adapter sends the entire song as indexed structured input, so it already has whole-song context. No context-window fields apply to AI or pronunciation. External text generation remains explicit. A job captures the configured window when submitted, and different windows use separate cache identities. Existing rows remain usable until a new result succeeds; new matching results take priority. Generated-row provenance shows its context window when nonzero.

## Diagnostics

Jellyfin’s Dashboard → Logs and the server’s configured log directory contain safe retrieval warnings, connection-test failures, and generation start/completion/failure entries. Generation failures include job ID, service, elapsed time, error code, and diagnostic ID. Model and thinking level appear on the start entry. The Requests tab shows the safe failure and diagnostic ID; old failures retain their original message and cannot acquire historical log entries. Credentials, endpoint URLs, lyric text, and raw provider responses are not included in these entries.

HTTP diagnostics show the destination host, sending/waiting/response phases, timeout, status, transport failure category, and safe provider request/generation IDs when supplied. A generation job ID is used as the HTTP log reference. Waiting entries appear every ten seconds; non-streaming AI remains at 0% until the complete response is received and validated. These logs do not include headers, keys, prompts, responses, or full URLs. OpenRouter generation IDs can be matched against its [Activity dashboard](https://openrouter.ai/activity).

AI translation and pronunciation use separate instructions. Translation output must contain only the target-language translation, while pronunciation output must contain only romanization. AI cache keys include a prompt version: changes to these instructions allow a fresh generation while earlier rows remain usable until a replacement succeeds. This format guidance does not guarantee correct readings or idiomatic translation; model quality and the source lyric text still matter.

## Saved language versions

Lyrics settings → Versions includes **Saved originals** as well as saved translation and pronunciation versions. Selected provider originals (including automatic selections), upgrades and imports are saved; provider previews stay temporary. Identical imports reuse the saved entry. Everyone with access to the song can preview a saved original without changing its selection or starting generation. Administrators can select it for the library or delete it after confirmation. Switching originals restores the matching translations, pronunciation, personal auxiliary choices and shared timing correction; generated rows are never remapped between originals.

Deleting a saved original removes that song’s association and its timing correction. A deleted current original is replaced by the newest remaining saved original. If no saved originals remain, current lyrics are cleared and automatic discovery pauses until an explicit retry, import or selection. Shared documents and their dependent versions remain when another song, selection, composition/donor, improvement offer or unaffected active job requires them. Affected jobs are cancelled transactionally; retained history identifies deleted output and cannot retry it. Media and external lyric files are never deleted.

This development version uses storage schema 5. Existing schema 4 and other unsupported databases are rejected without migration or changes. Use a new empty development storage directory; keep existing production storage untouched.

Saved translation and pronunciation versions are listed separately. Each lists its service, model, thinking level, and generation time when available. Choose Preview, then Use to save the selection for your account and this original lyric content. Translation choices are separate for each target language. Automatic prefers supplied rows; Provider supplied only excludes generated rows.

Generate creates a new saved version, retains earlier outputs and your current displayed choice, and is subject to the usual external-generation permissions, approval, and quotas. Version choices do not alter other users or the administrator’s original-lyric selection. Changing the original lyric version exposes only matching generated outputs; older outputs remain stored with their original content.

## Feedback lifetime

Success confirmations clear after four seconds; successful connection tests clear after four. Loading/progress stays until completion, while errors remain until dismissed or resolved. Pending approvals, instrumental/no-lyrics outcomes, configuration availability, and request history do not expire. Better timing offers can be dismissed for the current viewing session. Newer feedback replaces earlier feedback and cancels its timer; leaving the lyric/config view clears pending timers.

## Shared lyric timing

LyricMotion’s timing controls remain personal to the current browser. In Lyrics settings → Song → Shared timing, administrators can use **Save timing for everyone** to save the shared correction plus their current personal adjustment for that track and original lyric version. The personal adjustment is then reset to zero to avoid double application. **Reset shared timing** saves zero for that version without changing other browsers’ personal adjustments. Shared corrections live in plugin storage and are checked against the lyric timeline fingerprint. Changing pronunciation or translation retains timing; selecting another original version loads that version’s correction, and returning to the previous version restores its correction. These corrections affect LyricMotion web playback; native-client lyric files remain unchanged.

## Wrong matches, imports and combined sources

In **Lyrics settings → Versions**, administrators can choose **Remove lyrics** to clear the current selection and suspend automatic matching for that track. This is not an instrumental classification. **Search again** clears the shared rejection only for administrators; ordinary users may search and preview without changing it; scheduled discovery leaves rejected tracks alone. **Use Jellyfin lyrics** selects lyrics already available through Jellyfin; **Import lyrics** accepts a text lyric file up to 1 MB and stores it under the plugin’s writable storage, without touching the media mount. Manual imports remain available as saved original versions.

Under Pronunciation or Translation, **Choose … from another source** searches for a donor version. Review the original-to-donor mappings, adjust unmatched lines, and save with **Use mapped …**. Automatic suggestions use normalized original text, sequence, and timing to resolve repeated lines; ambiguous lines remain unmatched. Saves reject duplicate or reordered mappings. Unmatched rows stay absent. Donor rows keep the current original lyric version’s activation windows and word timing, and shared timing corrections remain attached to the unchanged original version. Donor documents and raw provider responses remain available in plugin storage; the resulting supplied rows appear as a separate saved auxiliary version.

### Reset managed lyric library

Administrators can open **General → Maintenance → Reset managed lyric library**. Type `RESET`, then select **Delete managed lyric library**. This deletes all LyricBridge-managed original/raw lyrics, saved and generated language versions, preview caches, timing corrections, selections, instrumental/rejected-match classifications, and generation request history. Active discovery/generation is stopped first. Deleted SQLite pages are cleared and compacted.

Plugin settings, credentials, and user display preferences are retained. Music and sidecar files in the source library, Jellyfin's own lyric storage, and other plugins' data are preserved. LyricBridge currently keeps its managed payloads inside its configured SQLite database, with no separate managed sidecar files. Opening lyrics again can retrieve a fresh version; scheduled retrieval can also refill the cache if enabled. This action is irreversible; take a storage backup first if you want to restore the saved versions later.

## Playback settings and song languages

Lyrics settings opens on **Song**. The desktop side panel and mobile bottom sheet leave playback controls accessible. **Song** contains current-source summaries, the existing timing control, and language overrides. **Display** contains account-wide visibility, languages, typography and layout. **Versions** contains original selection/import, saved pronunciation and translations, temporary previews, and generation under each corresponding section.

Song languages default to **Use account default** and display the inherited value. Original language also has explicit **Auto-detect**, which can override an account language. Overrides sync for your Jellyfin user and song, survive lyric-version changes, and do not trigger external generation. **Reset song language overrides** restores inheritance. Chinese original script and Japanese romanization remain account-wide. Managed lyric resets keep account preferences and song language overrides.

**Automatic** is a selection policy, separate from an individual saved version. Its description shows which service currently supplies the rows. Preview does not save a choice; **Use** saves an auxiliary choice for your account. Playback previews hide comparison panels and provide Return, Cancel and authorized Use actions. Cancel restores lyrics and the previous playback position. Original library selections and maintenance remain administrator-only.

Progress details stay with the affected operation. Success messages clear after four seconds. Failures offer Retry or Dismiss; dismissing a running notification does not cancel the job. Routine ready and cached-lookup notifications are suppressed.

## Administrator tabs

- **General:** writable storage, scheduled retrieval, and Advanced maintenance.
- **Sources:** provider order, setup, credentials, and advanced matching.
- **Language services:** local Kawazu, service capabilities, setup and synthetic tests.
- **Display defaults:** the same grouping as account Display preferences.
- **Requests:** permissions, conditional approval/quotas, and approval queue.

One persistent **Save settings** footer applies configuration edits. Switching tabs preserves edits. Failed saves retain values. Connection-test results remain beside their service.

## Matching and comparing recordings

The automatic minimum defaults to 70 in Sources → Advanced matching. Recording compatibility still applies: incompatible editions, absent title matches, artist disagreements and excessive duration differences cannot be selected automatically. Artist aliases are not yet resolved.

Find versions keeps all displayed candidates stable while checking their lyrics. Expand Match details for server-computed field results, recording/duration warnings and verified lead-line word coverage. Recommended identifies the best eligible verified recording. Sort by best match deliberately reorders the existing rows; it does not select or save anything. Administrators can preview and manually use a conflicting result when its warnings reflect metadata problems.

Cached lyrics do not search again whenever the view opens. Search again explicitly looks for improved recordings or timing. Offers only appear for a higher match tier, or a higher timing category within the same tier; small score/coverage differences do not cause repeated prompts. Preview before applying and select a saved original in Versions to restore it. See RANKING.md for all limits.

### Musixmatch verification failures

Musixmatch can challenge automatic token acquisition with CAPTCHA/verification, even while other requests from the server succeed. This is a provider verification failure, not evidence that a song has no lyrics. LyricBridge shows `provider_verification_required`, logs its diagnostic reference without tokens or response bodies, and backs off for five minutes. Other sources remain available. Retry after the indicated time, review the optional token setup, or disable Musixmatch in Sources if you prefer to avoid these failures. A supplied token is not guaranteed to remove a provider challenge. Do not repeatedly retry or attempt to automate verification bypass.

### Compact controls and help

In playback settings, expand a pronunciation or translation version to reveal Preview, Use and Delete. Expanding a row only browses it; it does not change playback or the saved choice. Generation stays under the relevant section. New versions appear without reopening the panel.

Setup instructions, advanced generation settings and diagnostic details are expandable. Routine instructions are omitted; sharing scope, external-service consent and destructive consequences remain visible. Dismiss hides a failed job across the notification and its Versions details for the current track session; Retry makes subsequent outcomes visible again.

Playback task groups use subtle inset surfaces for generation, maintenance, expanded versions and search previews. Advanced options remain within their task; opening a version still only browses it. Ordinary display settings remain lightweight, and administrator configuration retains native Jellyfin styling.

Search results identify sources supplying your selected original, pronunciation and translation separately. A source may carry multiple usage badges; selected auxiliary rows hidden in Display are labeled “selected · hidden”. Recommendations and preview selection are independent. Google/AI/Kawazu-generated text does not mark a lyric provider as its source. Mixed supplied rows retain explicit donor provenance.

Title matching ignores recognized featured-artist clauses, including those preceding a named remix qualifier. Recording/edition checks still reject different named remixes. Search uses Needs review for automatically excluded candidates rather than displaying a strong aggregate score as an endorsement; recording/title details remain available for manual review.

Administrator settings use five compact native Jellyfin tabs. Sources retain enabled order and inline credential setup; Language services show capabilities and configured status, with tests using saved settings. Display defaults apply to accounts without their own saved preferences. Storage-change instructions and destructive maintenance are disclosed beside their actions. Save settings remains visible, preserves edits after failure, and becomes available only after settings load successfully. Failed loads offer Retry.

Language services list their roles and language limitations: Kawazu provides local Japanese romaji; Google provides translation and pronunciation for the supported languages listed in its row; AI capabilities depend on the configured model; DeepL and LibreTranslate provide translation only, with provider/server language support. Display defaults use the same Original/Pronunciation/Translation controls as the playback Display tab. Chinese translation script is selected through Chinese (Simplified) or Chinese (Traditional); Chinese original text has its own script choice. Auto-detect keeps language-specific defaults in a disclosure, and selecting a language reveals its relevant controls without discarding hidden settings.

## Browser rendering quality

For reduced rendering load, open Lyrics settings → Display → Text sizes and layout and choose **Low power** under Rendering quality. Artwork becomes stationary and glyph lift/glow is disabled; timed highlighting remains. Standard remains the default. The selection is saved in this browser, not server configuration. See [performance validation](PERFORMANCE.md) for measurement limits.

### Song actions and restoration

Settings tabs are **Song → Versions → Display**. The original-lyrics section in
Versions owns search, import, Jellyfin selection, rejection and instrumental
classification. Shared changes remain administrator-only and classification changes
require confirmation. Search keeps provider track ID in an Advanced disclosure in the search form, which collapses into the query summary; it does not duplicate these actions.

The one-step Revert action and endpoint have been removed. Restore lyrics by choosing
a saved original; change rejected/instrumental classification explicitly. No undo
snapshots are created or returned by the current API. This change does not migrate or
delete existing databases. Deleting the current original selects the newest remaining
saved original, retaining that version's timing and auxiliary choices.
