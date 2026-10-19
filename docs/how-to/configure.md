# Configure lyric sources and services

After [installation](install.md), use **Dashboard → Plugins → LyricBridge** to configure retrieval, language services, and request permissions.
For personal choices during playback, see [playback settings](playback.md).

## Save configuration safely

Finish each inline editor with **Apply**, then select **Save settings** to persist the configuration.
A blocked-startup notice pauses settings changes; [resolve startup or restore a backup](install.md#inspect-startup-and-upgrades) first.
Changing tabs keeps pending edits. A failed save retains them.
If another administrator changed settings, compare the versions, resolve conflicts, and explicitly save again.

Credential fields show whether a value exists without exposing it. Use **Replace credential** or **Clear credential** to stage a change.
Connection tests use saved settings, so apply and save relevant edits first.
A **Ready** badge means required configuration is present; it does not establish live access.

## Enable sources

In **Sources**, enable providers and order them for your library. Start with sources that do not require credentials.
For credentialed sources:

- **Musixmatch** can obtain a token automatically. An optional credential is a client `usertoken`, not a developer API key.
- **Spotify** accepts the `sp_dc` session cookie from your own Spotify Web session, not OAuth/developer credentials.
- **Apple Music** accepts the `media-user-token` header from an authenticated web request, not an Apple developer token.

Keep session tokens private. If your browser session does not expose the required value, leave that source disabled.
Account, region, expiry, and provider changes can affect access.

To verify a source, play a known track, open **Lyrics settings → Versions → Search versions**, filter to that source, and preview a result.
An empty search alone does not establish a configuration failure.
If Musixmatch reports a verification challenge, wait for the displayed retry time, review the token, or disable the source. Do not automate challenge bypass.

## Connect translation and pronunciation services

Under **Services**, create a named connection, then add capability options that use it.
A connection holds the endpoint and credential; an option chooses the model and task settings.
Shared connection edits affect every referencing option. Remove those options before deleting the connection or changing its type.

Choose endpoints appropriate to the service:

| Service        | Endpoint guidance                                            |
| -------------- | ------------------------------------------------------------ |
| Google         | Built in; unofficial web access can be rate-limited          |
| DeepL          | Use the API Free or Pro endpoint matching your API account   |
| AI compatible  | Supply an API root; LyricBridge appends `/chat/completions`  |
| LibreTranslate | Supply the server base URL; LyricBridge appends `/translate` |

Paste keys without `Bearer`. DeepL requires [API access](https://developers.deepl.com/docs/getting-started/auth), separate from a translator subscription.
For [LibreTranslate](https://docs.libretranslate.com/), install the required language models and configure credentials for your instance.
Local service addresses must be reachable from Jellyfin's container; `localhost` refers to that container.

After saving, open the translation or pronunciation option and select **Test connection**.
Correct reported errors, save, and retry. Tests use synthetic text and do not validate every language or model capability.
Transcription and line-break review are tested through their normal workflows.

For AI options, choose a thinking level supported by the endpoint and model. Higher thinking levels can require a longer timeout.
For supported non-AI translation options, a small context window may improve continuity, but does not guarantee better translation.
Changing settings affects new jobs and retries; existing results remain available.

## Control requests and local processing

In **Requests**, decide whether users may submit external work and whether it needs approval.
Review quotas before enabling automatic approval. External language services receive lyric text; transcription services receive prepared audio.
Playback requires an explicit service choice for each remote request.

Bundled Japanese romaji needs no remote connection. Supplied pronunciation takes precedence.
Under **Services → Pronunciation**, disable automatic missing-pronunciation generation if you want only supplied or manually requested results.
Already queued work may finish, and saved versions remain usable.

## Next steps

[Choose playback languages](playback.md), [transcribe audio](transcribe.md), or [manage approvals and stored results](manage-data.md).
