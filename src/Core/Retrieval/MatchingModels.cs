namespace LyricBridge;

public sealed record FieldMatch(string Field, string Result, int? Points);
public sealed record TimingAssessment(string Category, int Rank, double Coverage, int SungLines, int WordLines, int InvalidCues);
public sealed record AuxiliaryAssessment(double TranslationCoverage, double PronunciationCoverage)
{ public double Completeness => TranslationCoverage + PronunciationCoverage; }
public sealed record MatchAssessment(int Score, int Tier, bool Eligible, string[] Reasons, FieldMatch[] Fields, string Recording, string CandidateRecording, long? DurationDifferenceMs, int ProviderOrder, TimingAssessment? Timing = null, int Revision = 1, bool EditionConflict = false, bool DurationConflict = false, AuxiliaryAssessment? Auxiliary = null);
public sealed record SelectionAssessment(string Hash, Candidate Candidate);
public sealed record ImprovementOffer(string BaselineHash, RichLyrics Lyrics, Candidate Candidate, string Reason, string Description);
public sealed record Verification(Candidate Candidate, RichLyrics? Lyrics, RawLyrics? Raw, bool Instrumental = false, string? InstrumentalReason = null);
public sealed class MatchingMetrics { [System.Text.Json.Serialization.JsonInclude] public int SearchCalls; [System.Text.Json.Serialization.JsonInclude] public int Assessments; [System.Text.Json.Serialization.JsonInclude] public int ParsePasses; [System.Text.Json.Serialization.JsonInclude] public int Verifications; }

