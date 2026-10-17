namespace LyricBridge;

public sealed record LocalState(string State, string? Error = null);
public sealed record TrackSummary(string Title, string Artist, string Album, long? DurationMs);
public sealed record AuxiliaryChoices(string Translation, string Pronunciation);
public sealed record ImprovementSummary(string BaselineHash, string Reason, string Description, MatchAssessment? Assessment);
public sealed record LyricPayload(
    Dictionary<string, string>? SuggestedMapping, string? SuggestedOriginHash,
    string? TimingFingerprint, TimingCorrection? TimingCorrection, TrackSummary? Track,
    string[] DetectedLanguages, AuxiliaryChoices AuxiliaryChoices, RichLyrics? Lyrics,
    List<Variant> Variants, Preferences Preferences, Preferences AccountPreferences,
    SongLanguagePreferences SongOverrides,
    string State, bool Complete, int Finished, int Total, List<SafeError> Errors,
    List<InstrumentalEvidence> Instrumental, RichLyrics? Better, MatchAssessment? MatchAssessment,
    ImprovementSummary? Improvement, MatchingMetrics? MatchingMetrics, LocalState? Pronunciation,
    bool CanSelect, bool CanDeleteVariants, bool CanGenerate, IReadOnlyList<SavedOriginal> SavedOriginals, bool CanDeleteOriginals, ResolvedAuxiliary? ResolvedAuxiliary = null);
