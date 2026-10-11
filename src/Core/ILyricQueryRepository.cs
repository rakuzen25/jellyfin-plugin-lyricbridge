namespace LyricBridge;

public interface ILyricQueryRepository
{
    string ActiveStoragePath { get; }
    MatchRejection? Rejection(Guid item);
    InstrumentalEvidence? Instrumental(Guid item);
    void RecordInstrumental(Guid item, InstrumentalEvidence evidence);
    void SaveDocument(RichLyrics lyrics);
    IReadOnlyList<Variant> Versions(string hash);
    AuxiliarySelection? AuxiliaryChoice(Guid user, string hash, string kind, string language);
    TimingCorrection? Timing(Guid item, string hash);
    VersionSnapshot? PreviousSelection(Guid item);
}
