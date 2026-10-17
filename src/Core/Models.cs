using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
namespace LyricBridge;

public sealed record Cue(int Position, int EndPosition, long Start, long? End);
public sealed class LyricLine
{
    public string Id { get; set; } = "";
    public string Text { get; set; } = "";
    public long? Start { get; set; }
    public long? End { get; set; }
    public string Language { get; set; } = "und";
    public string Alignment { get; set; } = "Unspecified";
    public List<Cue> Cues { get; set; } = [];
    public Dictionary<string, string> Translations { get; set; } = [];
    public string? Pronunciation { get; set; }
    public LyricLine? Background { get; set; }
}
public sealed class RichLyrics
{
    public string Hash { get; set; } = "";
    public string Source { get; set; } = "";
    public string ProviderId { get; set; } = "";
    public string Title { get; set; } = "";
    public string Artist { get; set; } = "";
    public string Language { get; set; } = "und";
    public List<LyricLine> Lines { get; set; } = [];
    public bool WordTimed => Lines.Any(l => l.Cues.Count > 0);
    public bool Manual { get; set; }
}
public sealed record Candidate(string Source, string Id, string Title, string Artist, string Album, int? DurationMs, int Score, string? SecondaryId = null, bool? WordTiming = null, string[]? TranslationLanguages = null, bool? HasPronunciation = null, string Verification = "pending", string[]? Artists = null, string[]? AlbumArtists = null, MatchAssessment? Assessment = null);
public sealed record RawLyrics(string Original, string? Translation = null, string? Pronunciation = null, string RawResponse = "", string Type = "auto", string? Language = null, Dictionary<string, string>? AdditionalTranslations = null, bool Instrumental = false, string? InstrumentalReason = null);
public sealed class Preferences
{
    public string TranslationLanguage { get; set; } = "zh-Hans";
    public string SourceLanguage { get; set; } = "auto";
    public bool ShowTranslation { get; set; } = true;
    public bool ShowPronunciation { get; set; } = true;
    public bool JapaneseRomaji { get; set; } = true;
    public string OriginalChineseScript { get; set; } = "Simplified";
    public string RomanizationSystem { get; set; } = "Hepburn";
    public string RowOrder { get; set; } = "pronunciation-first";
    public int OriginalSize { get; set; } = 40;
    public int PronunciationSize { get; set; } = 24;
    public int TranslationSize { get; set; } = 24;
    public int RowSpacing { get; set; } = 6;
}
public sealed record SongLanguagePreferences(string? SourceLanguage = null, string? TranslationLanguage = null)
{
    public Preferences Apply(Preferences account)
    {
        var effective = Codec.Deserialize<Preferences>(Codec.Serialize(account))!;
        effective.SourceLanguage = SourceLanguage ?? account.SourceLanguage;
        effective.TranslationLanguage = TranslationLanguage ?? account.TranslationLanguage;
        return effective;
    }
}
public sealed class GenerationRequest
{
    public string? OptionId { get; set; }
    public string? OptionName { get; set; }
    [System.Text.Json.Serialization.JsonIgnore]
    public bool ServiceSpecified { get; private set; }
    private string service = "Google";
    [System.Text.Json.Serialization.JsonIgnore]
    public string? LogCorrelationId { get; set; }
    public Dictionary<string, string> SkippedRows { get; set; } = new();
    public bool ForceNew { get; set; }
    public int? TimeoutSeconds { get; set; }
    public string? ReasoningEffort { get; set; }
    public int? ContextBefore { get; set; }
    public int? ContextAfter { get; set; }
    public string Kind { get; set; } = "translation";
    public string Language { get; set; } = "zh-Hans";
    public string Service { get => service; set { service = value; ServiceSpecified = true; } }
    public string SourceLanguage { get; set; } = "auto";
}
public sealed record GenerationProfile(string Service, string EndpointIdentity, string Model, string Kind, string Language, string SourceLanguage, string ReasoningEffort, int ContextBefore, int ContextAfter, int PromptRevision);

public sealed class Job
{
    public string TaskKind { get; set; } = "language";
    public string Title { get; set; } = "";
    public string Artist { get; set; } = "";
    public AudioRequest? Audio { get; set; }
    public BoundaryReviewRequest? Review { get; set; }
    public ReviewPlan? ReviewPlan { get; set; }
    public string? ResultId { get; set; }
    public string Stage { get; set; } = "";
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public Guid UserId { get; set; }
    public Guid ItemId { get; set; }
    public string Hash { get; set; } = "";
    public string VariantKey { get; set; } = "";
    public long DeletionRevision { get; set; }
    public bool OutputDeleted { get; set; }
    public DateTimeOffset? OutputDeletedAt { get; set; }
    public string? CacheKey { get; set; }
    public GenerationProfile? Profile { get; set; }
    public GenerationRequest Request { get; set; } = new();
    public string State { get; set; } = "pending";
    public string? Error { get; set; }
    public SafeError? Failure { get; set; }
    public int Progress { get; set; }
    public DateTimeOffset? TerminalAt { get; set; }
    [System.Text.Json.Serialization.JsonConverter(typeof(UtcTimestampConverter))]
    public DateTime Created { get; set; } = DateTime.UtcNow;
}
public sealed record Variant(string Key, string Hash, string Kind, string Language, string Service, string Model, Dictionary<string, string> Text, int ContextBefore = 0, int ContextAfter = 0, string ReasoningEffort = "", int PromptVersion = 0, string? CacheKey = null, DateTime? CreatedAt = null, SuppliedOrigin? Origin = null, Dictionary<string, string>? SkippedRows = null, GenerationProfile? Profile = null, string OriginType = "generated", string? OptionName = null);
public static class Codec
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { PropertyNameCaseInsensitive = true };
    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Json);
    public static T? Deserialize<T>(string text) => JsonSerializer.Deserialize<T>(text, Json);
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    public static string ContentHash(RichLyrics lyrics) => Hash(Serialize(new { lyrics.Source, lyrics.ProviderId, lyrics.Lines }));
}

public sealed record AuxiliarySelectionInput(string Hash, string Kind, string Key);
public sealed record AuxiliarySelection(string Key);

public sealed record TimingCorrection(string Hash, string Fingerprint, double Seconds);

public sealed record SuppliedOrigin(string Source, string ProviderId, string? DonorHash = null);
public sealed record MixedOrigin(string DonorHash, Dictionary<string, string>? Mapping = null);

public static class JobLifecycle
{
    public static bool Terminal(string state) => state is "complete" or "failed" or "cancelled" or "rejected" or "settings_changed";
}
