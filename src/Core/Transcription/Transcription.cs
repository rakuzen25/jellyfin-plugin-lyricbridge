using System.Globalization;
using System.Text;

namespace LyricBridge;

public sealed class TranscriptionConfig
{
    public string Endpoint { get; set; } = "https://api.groq.com/openai/v1";
    public string Model { get; set; } = "whisper-large-v3";
    public string ApiKey { get; set; } = "";
    public string UploadFormat { get; set; } = "opus";
    public int MaxUploadMb { get; set; } = 25;
    public int MaxInputMb { get; set; } = 256;
    public int TimeoutSeconds { get; set; } = 120;
    public bool Enabled { get; set; }
    public static void Validate(TranscriptionConfig c)
    {
        if (!Uri.TryCreate(c.Endpoint, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") || uri.UserInfo.Length != 0 || uri.Fragment.Length != 0 || uri.Query.Length != 0 ||
            string.IsNullOrWhiteSpace(c.Model) || c.Model.Length > 200 || c.UploadFormat is not ("wav" or "flac" or "opus") || c.MaxUploadMb is < 1 or > 1024 || c.MaxInputMb is < 1 or > 4096 || c.TimeoutSeconds is < 5 or > 3600)
            throw new ArgumentException("Invalid transcription endpoint, model, format or limits.");

    }
}
public sealed record TimedToken(string Id, string Text, string Separator, int Position, int EndPosition, long Start, long End);
public sealed record Transcript(Guid ItemId, Guid UserId, string Id, string Text, string ProviderText, string Language, string Timing, List<TimedToken> Tokens, List<string> RawResponses, GenerationProfile Profile, List<ImportIssue> Warnings, DateTimeOffset Created, string Title = "", string Artist = "", string? OptionName = null);
public sealed record BreakSettings(int? Characters = null, double Seconds = 3, bool KeepShortReplies = true)
{
    public void Validate()
    {
        if (Characters is < 4 or > 200 || !double.IsFinite(Seconds) || Seconds is < .5 or > 30)
            throw new WorkflowException(400, "invalid_break_settings", "Choose a character target from 4 to 200 and a duration from 0.5 to 30 seconds.");
    }
}
public sealed record BoundaryVersion(string Id, string TranscriptId, string Origin, string Algorithm, BreakSettings Settings, List<string> EndTokenIds, DateTimeOffset Created, GenerationProfile? Profile = null, string? OptionName = null, List<string>? SeamTokenIds = null);
public sealed record BoundaryAdvice(string AfterId, double Cost, string? Message = null, bool Allowed = true);
public interface IBoundaryStrategy
{
    string Version { get; }
    IReadOnlyList<BoundaryAdvice> Analyze(Transcript transcript, CancellationToken token);
}
public sealed record AudioRequest(string Source = "track", string? UploadId = null, string Language = "auto", bool SegmentOnly = false, bool AllowChunking = false, int ChunkCount = 1, string? OptionId = null);
public sealed record BoundaryReviewRequest(string TranscriptId, string VersionId, BreakSettings Settings, string? OptionId = null, string? PlanIdentity = null, BoundaryVersion? Snapshot = null);
public sealed record BoundaryInput(string TranscriptId, List<string> EndTokenIds, BreakSettings Settings, string? ExpectedSelection = null, string? OptionId = null, string? PlanIdentity = null, string? EntryId = null, string Origin = "manual");
public sealed record TranscriptSummary(string Id, Guid UserId, string Language, string Timing, int TokenCount, DateTimeOffset Created, bool Published, string? OptionName = null);
public sealed record BoundaryReviewResult(string Id, string TranscriptId, string VersionId, GenerationProfile? Profile, DateTimeOffset Created, string? OptionName = null, List<string>? SeamTokenIds = null, BreakSettings? Settings = null);
public sealed record DeletionCapability(bool Allowed, string? Reason, List<OriginalDependency> Originals, List<string> Requests);
public sealed record OriginalDependency(Guid ItemId, string OutputHash);
public sealed record SavedBoundaryEntry(string Id, string TranscriptId, string VersionId, string Origin, BreakSettings Settings, DateTimeOffset Created, string Algorithm, GenerationProfile? Profile = null, string? OptionName = null, List<string>? SeamTokenIds = null);
public sealed record SavedBoundaryView(SavedBoundaryEntry Entry, DeletionCapability Deletion);
public sealed record ReviewDocument(Transcript Transcript, List<BoundaryVersion> Versions, List<BoundaryAdvice> Boundaries, string Selection, bool CanUse, List<BoundaryReviewResult>? ReviewResults = null, List<SavedBoundaryView>? SavedEntries = null, DeletionCapability? Deletion = null, bool CanManage = false);
public sealed record PreparedAudio(string Path, long DurationTicks, long StartTicks = 0);
public interface IAudioPreparation
{
    Task StopUploads() => Task.CompletedTask;
    Task<PreparedAudio> Prepare(Job job, TranscriptionConfig settings, IProgress<int> progress, CancellationToken token);
    Task<List<PreparedAudio>> PlanChunks(Job job, PreparedAudio audio, TranscriptionConfig settings, CancellationToken token);
    void Release(Job job);
    void Cleanup() { }
    void Clear() { }
}
public interface IRemoteTaskHandler
{
    string Kind { get; }
    GenerationProfile Profile(Job job);
    ReviewPlan? Plan(Job job) => null;
    Task Execute(Job job, IProgress<int> progress, CancellationToken token);
    void Release(Job job);
}
public interface ITranscriptionRepository
{
    Transcript? Transcript(string id);
    IReadOnlyList<TranscriptSummary> Transcripts(Guid item, Guid user, bool admin);
    List<BoundaryVersion> BoundaryVersions(string transcriptId);
    List<BoundaryReviewResult> ReviewResults(string transcriptId);
    List<SavedBoundaryEntry> SavedEntries(string transcriptId);
    DeletionCapability Deletion(string transcriptId, string? entryId, Guid user, bool admin);
    SavedBoundaryEntry SaveEntry(Transcript transcript, BoundaryVersion version, Guid user, bool admin, string? selectedEntry = null);
    void DeleteEntry(Guid item, string transcriptId, string entryId, Guid user, bool admin);
    bool CompleteTranscript(Job job, Transcript? transcript, BoundaryVersion? version);
    RichLyrics CommitBoundary(Guid item, Transcript transcript, BoundaryVersion version, string expectedSelection, string? entryId = null);
    IReadOnlyList<string> DeleteTranscript(Guid item, string id, Guid user, bool admin);
    string SelectionIdentity(Guid item);
    List<TranscriptChunk> Chunks(string jobId);
    void SaveChunk(Job job, TranscriptChunk chunk);
    void DiscardChunks(string jobId);
    List<ReviewCheckpoint> ReviewCheckpoints(string jobId);
    void SaveReviewCheckpoint(Job job, ReviewCheckpoint checkpoint);
    void DiscardReviewCheckpoints(string jobId);
}
public sealed record TranscriptChunk(string Id, string JobId, int Index, long StartTicks, string RawResponse, string ProfileIdentity);

public static class TranscriptBoundaries
{
    public const string Algorithm = "phrase-dp/1";
    public static string CanonicalText(IEnumerable<TimedToken> tokens) => string.Concat(tokens.Select(t => t.Separator + t.Text));
    public static List<string> Allowed(Transcript transcript)
    {
        var elements = StringInfo.ParseCombiningCharacters(transcript.Text).Append(transcript.Text.Length).ToHashSet();
        return transcript.Tokens.Where(t => elements.Contains(t.EndPosition)).Select(t => t.Id).ToList();
    }
    public static void Validate(Transcript transcript, IReadOnlyList<string> ends)
    {
        if (transcript.Tokens.Count == 0 || CanonicalText(transcript.Tokens) != transcript.Text || transcript.Tokens.Select(t => t.Id).Distinct().Count() != transcript.Tokens.Count)
            throw new InvalidDataException("Invalid preserved transcript.");
        var allowed = Allowed(transcript).ToHashSet();
        var positions = transcript.Tokens.Select((token, index) => (token.Id, index)).ToDictionary(p => p.Id, p => p.index);
        var previous = -1;
        foreach (var id in ends)
        {
            var index = positions.GetValueOrDefault(id, -1);
            if (index <= previous || !allowed.Contains(id)) throw new WorkflowException(422, "invalid_boundaries", "Line breaks must contain valid token IDs once, in order, without splitting a grapheme.");
            previous = index;
        }
        if (ends.Count == 0 || previous != transcript.Tokens.Count - 1) throw new WorkflowException(422, "invalid_boundaries", "The final line must include the last transcript token.");
        var position = 0;
        foreach (var t in transcript.Tokens)
        {
            position += t.Separator.Length;
            if (t.Position != position || t.EndPosition != position + t.Text.Length || t.Start < 0 || t.End > 9_007_199_254_740_991L || t.End < t.Start || string.IsNullOrEmpty(t.Text)) throw new InvalidDataException("Invalid token offsets or timestamps.");
            _ = new UTF8Encoding(false, true).GetByteCount(t.Text);
            position = t.EndPosition;
        }
    }
    public static BoundaryVersion Version(Transcript transcript, string origin, BreakSettings settings, List<string> ends, string strategy, GenerationProfile? profile = null)
    {
        settings.Validate(); Validate(transcript, ends);
        return new(Codec.Hash(Codec.Serialize(new { transcript.Id, ends })), transcript.Id, origin, strategy, settings, ends, DateTimeOffset.UtcNow, profile);
    }
    public static RichLyrics Compose(Transcript transcript, IReadOnlyList<string> ends, string title = "", string artist = "")
    {
        Validate(transcript, ends);
        var result = new RichLyrics { Source = "Transcription", ProviderId = transcript.Id, Language = transcript.Language, Title = title, Artist = artist, Manual = true };
        var positions = transcript.Tokens.Select((token, index) => (token.Id, index)).ToDictionary(p => p.Id, p => p.index);
        var first = 0;
        foreach (var id in ends)
        {
            var last = positions[id];
            // Assign separators to their following token even at line starts: flattening remains lossless.
            var startPosition = transcript.Tokens[first].Position - transcript.Tokens[first].Separator.Length;
            var endPosition = transcript.Tokens[last].EndPosition;
            var group = transcript.Tokens.GetRange(first, last - first + 1);
            var line = new LyricLine { Id = "l" + result.Lines.Count, Text = transcript.Text[startPosition..endPosition], Language = transcript.Language, Start = group.Min(t => t.Start), End = group.Max(t => t.End) };
            if (transcript.Timing == "word") line.Cues = group.Select(t => new Cue(t.Position - startPosition, t.EndPosition - startPosition, t.Start, t.End)).ToList();
            result.Lines.Add(line); first = last + 1;
        }
        result.Hash = Codec.ContentHash(result); return result;
    }
    public static BoundaryVersion Optimize(Transcript transcript, BreakSettings settings, IReadOnlyList<BoundaryAdvice> advice, string strategy, CancellationToken cancellation = default)
    {
        settings.Validate();
        var tokens = transcript.Tokens;
        Validate(transcript, [tokens.Last().Id]);
        var allowed = Allowed(transcript).ToHashSet();
        var byId = advice.ToDictionary(a => a.AfterId);
        var n = tokens.Count;
        var cost = Enumerable.Repeat(double.PositiveInfinity, n + 1).ToArray();
        var next = new int[n]; cost[n] = 0;
        var target = settings.Characters ?? (transcript.Language.StartsWith("ja", StringComparison.Ordinal) ? 14 : 42);
        var elements = StringInfo.ParseCombiningCharacters(transcript.Text);
        var counts = new int[transcript.Text.Length + 1];
        foreach (var p in elements) counts[p + 1]++;
        for (var p = 1; p < counts.Length; p++) counts[p] += counts[p - 1];
        var cuts = tokens.Where((t, i) => allowed.Contains(t.Id) && (i == n - 1 || !byId.TryGetValue(t.Id, out var a) || a.Allowed)).Select(t => t.Id).ToHashSet();
        for (int i = n - 1; i >= 0; i--)
        {
            if (i > 0 && !cuts.Contains(tokens[i - 1].Id)) continue;
            cancellation.ThrowIfCancellationRequested();
            long earliest = long.MaxValue, latest = 0;
            for (int j = i; j < n; j++)
            {
                var t = tokens[j]; earliest = Math.Min(earliest, t.Start); latest = Math.Max(latest, t.End);
                if (!allowed.Contains(t.Id) || j < n - 1 && byId.TryGetValue(t.Id, out var blocked) && !blocked.Allowed) continue;
                var chars = counts[t.EndPosition] - counts[tokens[i].Position];
                var duration = (latest - earliest) / (double)TimeSpan.TicksPerSecond;
                var boundary = j == n - 1 ? 0 : byId.GetValueOrDefault(t.Id)?.Cost ?? 4;
                if (j < n - 1)
                {
                    var pause = (tokens[j + 1].Start - t.End) / (double)TimeSpan.TicksPerSecond;
                    boundary -= Math.Clamp(pause * 10, 0, 8);
                    if (settings.KeepShortReplies && t.Text.TrimEnd().LastOrDefault() is '?' or '!' or '？' or '！' or '。') boundary -= 8;
                }
                var candidate = 4 + boundary + Math.Pow(Math.Max(0, chars - target), 2) / target + Math.Pow(Math.Max(0, duration - settings.Seconds), 2) * 3 + cost[j + 1];
                if (candidate < cost[i]) { cost[i] = candidate; next[i] = j + 1; }
                // Once a legal successor exists, longer phrases have a strictly growing length penalty.
                if (chars > target * 4 && double.IsFinite(cost[i])) break;
            }
        }
        if (!double.IsFinite(cost[0])) return Version(transcript, "local", settings, [tokens[^1].Id], Algorithm + "/" + strategy);
        var ends = new List<string>();
        for (var i = 0; i < n; i = next[i]) ends.Add(tokens[next[i] - 1].Id);
        return Version(transcript, "local", settings, ends, Algorithm + "/" + strategy);
    }
}

public sealed record ReviewCheckpoint(string Id, string JobId, string TranscriptId, int Index, string Identity, List<string> EndTokenIds, string RawResponse);
