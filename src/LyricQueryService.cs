using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Lyrics;
namespace LyricBridge;

public sealed class LyricQueryService(ILyricManager native, ILyricQueryRepository store, Retrieval retrieval, Discovery discovery, PreferenceService preferenceService, LocalPronunciation local, LanguageServices languages, Func<string[]> serviceNames, Func<bool> allowRequests)
{
    public async Task<LyricOutcome> Discover(Audio item, CancellationToken token, bool retry = false)
    {
        var lyrics = await Read(item, token);
        var track = JellyfinTrack.From(item);
        var outcome = discovery.Start(item.Id, track, retry, lyrics);
        if (lyrics is not null && !retry)
        {
            outcome.Lyrics = lyrics; outcome.Assessment = discovery.CurrentAssessment(item.Id, track, lyrics);
            outcome.State = outcome.Errors.Count > 0 ? "partial" : "ready";
            if (outcome.Total == 0) outcome.Complete = true;
        }
        return outcome;
    }
    public string ActiveStoragePath => store.ActiveStoragePath;
    public void SaveDocument(RichLyrics lyrics) => store.SaveDocument(lyrics);
    public async Task<RichLyrics?> Read(Audio audio, CancellationToken token)
    {
        if (store.DiscoverySuppressed(audio.Id) || store.Rejection(audio.Id) != null) return null;
        var mark = store.Instrumental(audio.Id); if (mark?.Manual == true) return null;
        var selected = retrieval.Selected(audio.Id); if (selected?.Manual == true) return selected;
        var found = await native.GetLyricsAsync(audio, token);
        if (found?.Lyrics is { Count: > 0 })
        {
            var doc = new RichLyrics { Source = "Local", Title = audio.Name, Artist = string.Join(", ", audio.Artists), Lines = found.Lyrics.Select((l, i) => new LyricLine { Id = $"l{i}", Text = l.Text, Start = l.Start, Language = Normalization.Detect(l.Text), Cues = l.Cues?.Select(c => new Cue(c.Position, c.EndPosition, c.Start, c.End)).ToList() ?? [] }).ToList() };
            if (doc.Lines.Count == 1 && Lyricify.Lyrics.Helpers.InstrumentalHelper.IsInstrumental(doc.Lines[0].Text)) { store.RecordInstrumental(audio.Id, new InstrumentalEvidence("Local", "", "Instrumental notice", Expires: DateTime.UtcNow.AddDays(7))); return null; }
            doc.Hash = Codec.ContentHash(doc); store.SaveDocument(doc); return doc;
        }
        return selected;
    }
    public LyricPayload Build(Audio item, Guid userId, bool administrator, LyricOutcome outcome, RichLyrics? original = null, bool readOnly = false)
    {
        var id = item.Id;
        var detectedLanguages = outcome.Lyrics?.Lines.SelectMany(line => line.Background == null ? new[] { line.Language } : new[] { line.Language, line.Background.Language }).Distinct().ToArray() ?? [];
        var accountPreferences = preferenceService.Account(userId); var songOverrides = preferenceService.Song(userId, id); var preferences = songOverrides.Apply(accountPreferences); List<Variant> variants = []; LocalState? pronunciation = null;
        if (outcome.Lyrics is { } lyrics)
        {
            lyrics.Hash = Codec.ContentHash(lyrics); if (!readOnly) store.SaveDocument(lyrics);
            var selectedPronunciation = store.AuxiliaryChoice(userId, lyrics.Hash, "pronunciation", "")?.Key ?? "auto";
            var fullLocalKey = LocalPronunciation.Key(lyrics, preferences, true);
            var explicitLocal = selectedPronunciation == fullLocalKey;
            pronunciation = selectedPronunciation == "auto" || explicitLocal ? readOnly ? local.Status(lyrics, preferences, explicitLocal) : local.Ensure(lyrics, preferences, explicitLocal) : new("unavailable");
            var localKey = LocalPronunciation.Key(lyrics, preferences, explicitLocal);
            var localKeys = new[] { LocalPronunciation.Key(lyrics, preferences), fullLocalKey };
            variants = store.Versions(lyrics.Hash).Where(v => (v.Service != "Kawazu" || localKeys.Contains(v.Key) || v.Key == selectedPronunciation)).Select(v => v.Kind == "translation" && v.Language.StartsWith("zh") ? v with { Text = v.Text.ToDictionary(k => k.Key, k => Display.Chinese(k.Value, Display.TranslationScript(preferences))) } : v).ToList();
            variants = variants.OrderByDescending(v => v.Service == "Kawazu" && v.Key == localKey).ThenByDescending(v => serviceNames().Contains(v.Service) && v.CacheKey == languages.Key(lyrics, new GenerationRequest { Kind = v.Kind, Language = v.Language, Service = v.Service, SourceLanguage = preferences.SourceLanguage })).ThenByDescending(v => v.CreatedAt ?? DateTime.MinValue).ToList();
            outcome.Lyrics = Display.Apply(lyrics, preferences);
        }
        var track = new TrackSummary(item.Name, string.Join(", ", item.Artists), item.Album, item.RunTimeTicks / 10000);
        var selectedHash = outcome.Lyrics?.Hash;
        var translationChoice = selectedHash == null ? null : store.AuxiliaryChoice(userId, selectedHash, "translation", preferences.TranslationLanguage);
        if (translationChoice == null && selectedHash != null && preferences.TranslationLanguage.StartsWith("zh")) translationChoice = store.AuxiliaryChoice(userId, selectedHash, "translation", preferences.TranslationLanguage == "zh-Hant" ? "zh-Hans" : "zh-Hant");
        var auxiliaryChoices = new AuxiliaryChoices(translationChoice?.Key ?? "auto", selectedHash == null ? "auto" : store.AuxiliaryChoice(userId, selectedHash, "pronunciation", "")?.Key ?? "auto");
        var timingFingerprint = outcome.Lyrics == null ? null : TimingService.Fingerprint(outcome.Lyrics);
        var timingCorrection = selectedHash == null ? null : store.Timing(id, selectedHash);
        if (timingCorrection?.Fingerprint != timingFingerprint) timingCorrection = null;
        var suggestedMapping = original == null || outcome.Lyrics == null ? null : LyricComposition.Suggest(original, outcome.Lyrics);
        return new(suggestedMapping, original == null ? null : Codec.ContentHash(original), timingFingerprint, timingCorrection, track, detectedLanguages, auxiliaryChoices, outcome.Lyrics, variants, preferences, accountPreferences, songOverrides, store.PreviousSelection(id), outcome.State, outcome.Complete, outcome.Finished, outcome.Total, outcome.Errors, outcome.Instrumental, outcome.Better, outcome.Assessment, outcome.Offer == null ? null : new ImprovementSummary(outcome.Offer.BaselineHash, outcome.Offer.Reason, outcome.Offer.Description, outcome.Offer.Candidate.Assessment), outcome.Metrics, pronunciation, administrator, administrator, !readOnly && (administrator || allowRequests()), store.SavedOriginals(id), administrator);
    }
}
