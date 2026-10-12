namespace LyricBridge;

public interface ISelectionRepository
{
    IReadOnlyList<SavedOriginal> SavedOriginals(Guid item);
    RichLyrics SavedDocument(Guid item, string hash);
    void SelectOriginal(Guid item, string hash);
    VersionSnapshot Selection(Guid item);
    ImprovementOffer? Improvement(Guid item);
    SelectionAssessment? PreviewAssessment(Candidate candidate);
    void ClearRejection(Guid item);
    string? ApplyUpgrade(Guid item, VersionSnapshot expected, string offerHash, string baselineHash);
    bool SaveTiming(Guid item, VersionSnapshot expected, TimingCorrection correction);
    void ApplySelection(Guid item, VersionSnapshot selection, RawLyrics? raw = null, bool remember = true);
    void RevertSelection(Guid item);
}
