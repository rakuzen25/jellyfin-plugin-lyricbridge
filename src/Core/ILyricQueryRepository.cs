namespace LyricBridge;

public interface ILyricQueryRepository
{
    IReadOnlyList<SavedOriginal> SavedOriginals(Guid item);
    bool DiscoverySuppressed(Guid item);
    string ActiveStoragePath { get; }
    MatchRejection? Rejection(Guid item);
    InstrumentalEvidence? Instrumental(Guid item);
    void RecordInstrumental(Guid item, InstrumentalEvidence evidence);
    void SaveDocument(RichLyrics lyrics);
    StoreAdmission Admit(Guid? item = null);
    void SaveAutomaticOriginal(Guid item, RichLyrics lyrics, StoreAdmission admission);
    IReadOnlyList<Variant> Versions(string hash);
    AuxiliarySelection? AuxiliaryChoice(Guid user, string hash, string kind, string language);
    TimingCorrection? Timing(Guid item, string hash);
}
