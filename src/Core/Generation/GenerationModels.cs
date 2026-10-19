using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
namespace LyricBridge;

public sealed class GenerationRequest
{
    public string? OptionId { get; set; }
    public string? OptionName { get; set; }
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
    public string Service { get; set; } = "";
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

public static class JobLifecycle
{
    public static bool Terminal(string state) => state is "complete" or "failed" or "cancelled" or "rejected" or "settings_changed";
}
