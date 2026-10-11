using static LyricBridge.LyricRanking;
using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using Lyricify.Lyrics.Helpers;
using Lyricify.Lyrics.Helpers.General;
using Lyricify.Lyrics.Models;
using Lyricify.Lyrics.Searchers.Helpers;
namespace LyricBridge;

public sealed class MatchingSession
{
    private sealed record Edition(string Key, string? RemixName = null);
    private static readonly Regex Groups = new(@"[\(\[（【]([^\)\]）】]*)[\)\]）】]", RegexOptions.NonBacktracking | RegexOptions.CultureInvariant);
    private static readonly Regex NeutralLabel = new(@"\b(?:\d{4}\s+)?(?:remaster(?:ed)?|reissue)(?:\s+\d{4})?\b", RegexOptions.NonBacktracking | RegexOptions.CultureInvariant);
    private static readonly Regex RemixLabel = new(@"\bremix\b", RegexOptions.NonBacktracking | RegexOptions.CultureInvariant);
    private static readonly Regex RemixWordsLabel = new(@"\b(remix|version|ver)\b", RegexOptions.NonBacktracking | RegexOptions.CultureInvariant);
    private static readonly Regex LiveLabel = new(@"^(live|live version|live at\b.*|live in\b.*|live from\b.*|.*\blive version)$", RegexOptions.NonBacktracking | RegexOptions.CultureInvariant);
    private static readonly Regex AcousticLabel = new(@"\bacoustic\b", RegexOptions.NonBacktracking | RegexOptions.CultureInvariant);
    private static readonly Regex InstrumentalLabel = new(@"\b(instrumental|karaoke)\b", RegexOptions.NonBacktracking | RegexOptions.CultureInvariant);
    private static readonly Regex SpedLabel = new(@"\b(sped[ -]?up|nightcore)\b", RegexOptions.NonBacktracking | RegexOptions.CultureInvariant);
    private static readonly Regex SlowedLabel = new(@"\b(slowed|slow version)\b", RegexOptions.NonBacktracking | RegexOptions.CultureInvariant);
    private static readonly Regex EditLabel = new(@"\b(radio edit|single edit|extended edit|extended mix|edit)\b", RegexOptions.NonBacktracking | RegexOptions.CultureInvariant);
    private readonly TrackMultiArtistMetadata track;
    private readonly string title, album;
    private readonly string[] artists, albumArtists;
    private readonly Edition recording;
    private readonly int minimum;
    private readonly ConcurrentDictionary<string, Lazy<Candidate>> assessed = new();
    private readonly ConcurrentDictionary<string, Lazy<string>> names = new();
    private readonly ConcurrentDictionary<string, Lazy<string>> artistNames = new();
    private readonly ConcurrentDictionary<string, Lazy<Task<Verification>>> verified = new();
    private sealed record Parsed(RichLyrics Lyrics, bool Instrumental, TimingAssessment Timing, AuxiliaryAssessment Auxiliary);
    private readonly ConcurrentDictionary<string, Lazy<Parsed>> parsed = new();
    public MatchingMetrics Metrics { get; } = new();
    public MatchingSession(TrackMultiArtistMetadata query, int minimum = 70)
    {
        track = new() { Title = query.Title, Artists = query.Artists.ToList(), Album = query.Album, AlbumArtists = query.AlbumArtists.ToList(), DurationMs = query.DurationMs };
        title = TitleName(query.Title); album = Name(query.Album); artists = ArtistNames(query.Artists); albumArtists = ArtistNames(query.AlbumArtists); recording = Recording(query.Title, query.Album); this.minimum = minimum;
    }
    private static readonly Regex FeaturedLabel = new(@"^(?:feat(?:uring)?\.?|ft\.?)\s+", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    private static readonly Regex FeaturedSuffix = new(@"(?: - | – | — )(?:feat(?:uring)?\.?|ft\.?)\s+[^\(\[（【]*", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    private static string WithoutFeatured(string? text) => FeaturedSuffix.Replace(Groups.Replace(text ?? "", m => FeaturedLabel.IsMatch(m.Groups[1].Value.Trim()) ? "" : m.Value), "").Trim();
    private string TitleName(string? text) => Name(WithoutFeatured(text));
    private static string Normalize(string? s) => string.IsNullOrWhiteSpace(s) ? "" : CompareHelper.NormalizeName(s);
    private string Name(string? text) { if (string.IsNullOrWhiteSpace(text)) return ""; if (names.Count >= 2048) return Normalize(text); return names.GetOrAdd(text, s => new Lazy<string>(() => Normalize(s))).Value; }
    private string[] ArtistNames(IEnumerable<string> values) => values.Where(v => !string.IsNullOrWhiteSpace(v)).Select(v => artistNames.Count >= 2048 ? Artist(v) : artistNames.GetOrAdd(v, s => new Lazy<string>(() => Artist(s))).Value).ToArray();
    private static string Artist(string value) { var s = value.Trim().ToLowerInvariant(); return s.All(c => c < 128) ? s : s.ToSC(true); }
    public static string[] Queries(TrackMultiArtistMetadata t)
    {
        var basic = WithoutFeatured(t.Title);
        return new[] { $"{t.Title} {t.Artist?.Replace(", ", " ")} {t.Album}", $"{basic} {t.Artist?.Replace(", ", " ")}", basic }.Select(s => s.Replace(" - ", " ").Trim()).Where(s => s.Length > 0).Distinct(StringComparer.Ordinal).ToArray();
    }
    private static Edition Recording(string? title, string? album)
    {
        static Edition? Label(string label)
        {
            var s = label.Trim().ToLowerInvariant(); if (FeaturedLabel.IsMatch(s)) return null;
            s = NeutralLabel.Replace(s, "").Trim(' ', '-'); if (s.Length == 0) return null;
            string? kind = null, name = null;
            if (RemixLabel.IsMatch(s)) { kind = "remix"; name = Normalize(RemixWordsLabel.Replace(s, "").Trim(' ', '.', '-')); }
            else if (s.Contains("リミックス")) { kind = "remix"; name = s.Replace("リミックス", "").Trim(); }
            else if (LiveLabel.IsMatch(s) || s is "ライブ" or "ライヴ" or "现场版") kind = "live";
            else if (AcousticLabel.IsMatch(s) || s.Contains("アコースティック")) kind = "acoustic";
            else if (InstrumentalLabel.IsMatch(s) || s is "伴奏" or "纯音乐") kind = "instrumental";
            else if (SpedLabel.IsMatch(s)) kind = "sped-up";
            else if (SlowedLabel.IsMatch(s)) kind = "slowed";
            else if (EditLabel.IsMatch(s)) kind = s.Contains("extended") ? "extended-edit" : "edit";
            else if (s is "studio" or "studio version" or "original version" or "original mix") kind = "standard";
            return kind == null ? null : new(kind, string.IsNullOrEmpty(name) ? null : name);
        }
        static Edition? Extract(string? text, bool isAlbum)
        {
            if (string.IsNullOrWhiteSpace(text)) return null;
            foreach (Match m in Groups.Matches(text)) if (Label(m.Groups[1].Value) is { } edition) return edition;
            foreach (var separator in new[] { " - ", " – ", " — " }) { var suffix = text.LastIndexOf(separator, StringComparison.Ordinal); if (suffix >= 0 && Label(text[(suffix + 3)..]) is { } e) return e; }
            if (isAlbum) return Label(text); return null;
        }
        return Extract(title, false) ?? Extract(album, true) ?? new Edition(string.IsNullOrWhiteSpace(title) ? "unknown" : "standard");
    }
    public Candidate Assess(Candidate candidate, int order = 0) => assessed.GetOrAdd(Key(candidate), _ => new Lazy<Candidate>(() => AssessOnce(candidate, order))).Value;
    private Candidate AssessOnce(Candidate c, int order)
    {
        Interlocked.Increment(ref Metrics.Assessments); var edition = Recording(c.Title, c.Album); var reasons = new List<string>(); var editionConflict = false; var durationConflict = false;
        if (recording.Key != "unknown" && edition.Key != "unknown" && (recording.Key != edition.Key || (recording.Key == "remix" && recording.RemixName != null && edition.RemixName != null && recording.RemixName != edition.RemixName))) { editionConflict = true; reasons.Add(recording.Key == "remix" && edition.Key == "remix" ? "Different named remix" : "Different recording edition: " + edition.Key); }
        long? delta = track.DurationMs is > 0 && c.DurationMs is > 0 ? Math.Abs((long)track.DurationMs.Value - c.DurationMs.Value) : null;
        if (delta > Math.Max(10000, (track.DurationMs ?? 0) * .05)) { durationConflict = true; reasons.Add("Duration differs by " + Math.Round(delta.Value / 1000d, 1) + " seconds"); }
        if (reasons.Count > 0) return c with { Score = -1, Assessment = new(-1, 0, false, reasons.ToArray(), [], recording.Key, edition.Key, delta, order, EditionConflict: editionConflict, DurationConflict: durationConflict) };
        var candidateArtists = ArtistNames(c.Artists ?? c.Artist.Split(", ")); var t = CompareHelper.CompareName(title, TitleName(c.Title), true); var a = CompareHelper.CompareArtist(artists, candidateArtists, true);
        var al = CompareHelper.CompareName(album, Name(c.Album), true); var aa = CompareHelper.CompareArtist(albumArtists, ArtistNames(c.AlbumArtists ?? []), true); var d = delta is <= 2000 ? CompareHelper.DurationMatchType.Perfect : CompareHelper.CompareDuration(track.DurationMs, c.DurationMs);
        var points = t.GetMatchScore() + a.GetMatchScore() + .4 * al.GetMatchScore() + .2 * aa.GetMatchScore() + d.GetMatchScore(); var available = 14d + (al == null ? 0 : 2.8) + (aa == null ? 0 : 1.4) + (d == null ? 0 : 7); var normalized = points * 25.2 / available;
        var score = normalized switch { > 21 => 100, > 19 => 99, > 17 => 95, > 15 => 90, > 11 => 70, > 8 => 30, > 3 => 10, _ => -1 };
        if (t == null || t.GetMatchScore() == 0) reasons.Add(t == null ? "Title unavailable" : "Title differs"); if (a != null && !artists.Intersect(candidateArtists, StringComparer.Ordinal).Any()) reasons.Add("Artist differs"); if (score < minimum) reasons.Add("Below minimum match score");
        static FieldMatch Field(string key, object? result, int points) => new(key, result?.ToString() ?? "Unavailable", result == null ? null : points);
        var fields = new[] { Field("title", t, t.GetMatchScore()), Field("artists", a, a.GetMatchScore()), Field("album", al, al.GetMatchScore()), Field("albumArtists", aa, aa.GetMatchScore()), Field("duration", d, d.GetMatchScore()) };
        return c with { Score = score, Assessment = new(score, score >= 90 ? 2 : score >= 70 ? 1 : 0, reasons.Count == 0, reasons.ToArray(), fields, recording.Key, edition.Key, delta, order, EditionConflict: editionConflict, DurationConflict: durationConflict) };
    }
    public async Task<Verification> Verify(Retrieval retrieval, ILyricSource source, Candidate candidate, CancellationToken token, Action<SafeError> error)
    {
        return await verified.GetOrAdd(Key(candidate), _ => new Lazy<Task<Verification>>(async () =>
        {
            Interlocked.Increment(ref Metrics.Verifications); var raw = await retrieval.Run(source, ct => source.Fetch(candidate, ct), token, error); if (raw == null) return new(candidate with { Verification = "unavailable", Assessment = candidate.Assessment! with { Revision = 2 } }, null, null);
            try
            {
                var parsedResult = parsed.GetOrAdd(Codec.Hash(Codec.Serialize(raw)), _ => new Lazy<Parsed>(() => { Interlocked.Increment(ref Metrics.ParsePasses); var data = ParseHelper.ParseLyrics(raw.Original); var doc = Normalization.Parse(raw, candidate, data); var analysis = Analyze(doc); return new(doc, raw.Instrumental || data.IsInstrumental(), analysis.Timing, analysis.Auxiliary); })).Value;
                var document = parsedResult.Lyrics; var instrumental = parsedResult.Instrumental;
                var lyrics = document; if (document.Source != candidate.Source || document.ProviderId != candidate.Id) { lyrics = new RichLyrics { Source = candidate.Source, ProviderId = candidate.Id, Title = candidate.Title, Artist = candidate.Artist, Language = document.Language, Lines = document.Lines }; lyrics.Hash = Codec.ContentHash(lyrics); }
                var timing = parsedResult.Timing; var c = candidate with { Verification = instrumental ? "instrumental" : lyrics.Lines.Count > 0 ? "verified" : "unavailable", WordTiming = timing.Rank >= 2, TranslationLanguages = lyrics.Lines.SelectMany(l => l.Translations.Keys).Distinct().ToArray(), HasPronunciation = lyrics.Lines.Any(l => !string.IsNullOrWhiteSpace(l.Pronunciation)), Assessment = candidate.Assessment! with { Timing = timing, Auxiliary = parsedResult.Auxiliary, Revision = 2 } };
                return new(c, lyrics.Lines.Count > 0 ? lyrics : null, raw, instrumental, raw.InstrumentalReason ?? "Provider instrumental notice");
            }
            catch { error(SafeError.Create("malformed_lyrics", source.Name + " returned malformed lyrics.", true)); return new(candidate with { Verification = "unavailable", Assessment = candidate.Assessment! with { Revision = 2 } }, null, raw); }
        })).Value;
    }
    public async Task RunProvider(Retrieval retrieval, ILyricSource source, int order, bool manual, CancellationToken token, Action<SafeError> error, Action<Candidate>? pending, Action<Verification> result)
    {
        var seen = new HashSet<string>(); var queries = source.SupportsQueryExpansion ? Queries(track) : [""]; int attempts = 0, bestTier = -1; bool usable = false;
        foreach (var query in queries)
        {
            Interlocked.Increment(ref Metrics.SearchCalls); var found = await retrieval.Run(source, ct => source.SearchQuery(track, query, ct), token, error); if (found == null) { if (retrieval.InBackoff(source.Name)) return; continue; }
            var candidates = found.Where(c => seen.Add(Key(c))).Select(c => Assess(c, order)).Where(c => manual || c.Assessment!.Eligible).ToList(); candidates.Sort(Compare);
            foreach (var c in candidates) { if (attempts >= (manual ? 8 : 3)) return; if (!manual && usable && c.Assessment!.Tier < bestTier) break; attempts++; pending?.Invoke(c); var v = await Verify(retrieval, source, c, token, error); result(v); if (v.Lyrics != null) { usable = true; bestTier = Math.Max(bestTier, c.Assessment!.Tier); } if (retrieval.InBackoff(source.Name)) return; }
            if (usable || attempts >= (manual ? 8 : 3)) return;
        }
    }
}
