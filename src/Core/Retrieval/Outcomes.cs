using System.Text.Json.Serialization;
namespace LyricBridge;

public sealed record InstrumentalEvidence(string Source, string ProviderId, string Reason, bool Manual = false, DateTime? Expires = null);
public sealed class LyricOutcome
{
    public string State { get; set; } = "searching";
    public RichLyrics? Lyrics { get; set; }
    public RichLyrics? Better { get; set; }
    public MatchAssessment? Assessment { get; set; }
    public ImprovementOffer? Offer { get; set; }
    public MatchingMetrics? Metrics { get; set; }
    public List<InstrumentalEvidence> Instrumental { get; set; } = [];
    public List<SafeError> Errors { get; set; } = [];
    public int Finished { get; set; }
    public int Total { get; set; }
    public bool Complete { get; set; }
}
public sealed class SearchSession
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public Guid UserId { get; set; }
    public Guid ItemId { get; set; }
    public string State { get; set; } = "searching";
    public int Finished { get; set; }
    public int Total { get; set; }
    public List<Candidate> Candidates { get; set; } = [];
    public string? Recommended { get; set; }
    public SearchImprovement? Improvement { get; set; }
    [JsonIgnore] public VersionSnapshot? Baseline { get; set; }
    public MatchingMetrics? Metrics { get; set; }
    public List<SafeError> Errors { get; set; } = [];
    [JsonIgnore] public CancellationTokenSource Cancellation { get; } = new();
    [JsonIgnore] public StoreAdmission? Admission { get; set; }
    [JsonIgnore] public Task Work { get; set; } = Task.CompletedTask;
    [JsonIgnore] public DateTime Created { get; } = DateTime.UtcNow;
}
public sealed record VersionSnapshot(RichLyrics? Lyrics, InstrumentalEvidence? Instrumental, MatchRejection? Rejected = null, SelectionAssessment? Assessment = null);


public sealed record SearchImprovement(string Key, string Hash, string BaselineHash, string Reason, string Description);
