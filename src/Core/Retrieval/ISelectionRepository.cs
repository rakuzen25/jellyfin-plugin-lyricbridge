namespace LyricBridge;

public interface ISelectionRepository
{
    IReadOnlyList<SavedOriginal> SavedOriginals(Guid item);
    RichLyrics SavedDocument(Guid item, string hash);
    void SelectOriginal(Guid item, string hash);
    VersionSnapshot Selection(Guid item);
    ImprovementOffer? Improvement(Guid item);
    ImprovementOffer? TryOffer(Guid item, VersionSnapshot expected, ImprovementOffer offer, RawLyrics? raw = null, Candidate? assessedBaseline = null, RichLyrics? displayedBaseline = null);
    SelectionAssessment? PreviewAssessment(Candidate candidate);
    void ClearRejection(Guid item);
    string? ApplyUpgrade(Guid item, VersionSnapshot expected, string offerHash, string baselineHash);
    bool SaveTiming(Guid item, VersionSnapshot expected, TimingCorrection correction);
    void ApplySelection(Guid item, VersionSnapshot selection, RawLyrics? raw = null);
    void ApplyImport(Guid item, Guid user, ImportedLyrics imported, SongLanguagePreferences? preferences, string? translationLanguage = null);
}
