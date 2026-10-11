namespace LyricBridge;

public sealed partial class Store : ILyricQueryRepository
{
    public string ActiveStoragePath => Path.GetDirectoryName(new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder(connectionString.Value).DataSource)!;
    public MatchRejection? Rejection(Guid item) => Get<MatchRejection>("rejected-match", item.ToString("N"));
    public InstrumentalEvidence? Instrumental(Guid item) => Get<InstrumentalEvidence>("instrumental", item.ToString("N"));
    public void RecordInstrumental(Guid item, InstrumentalEvidence evidence) => Put("instrumental", item.ToString("N"), evidence);
    public void SaveDocument(RichLyrics lyrics) => Put("document", lyrics.Hash, lyrics);
    public IReadOnlyList<Variant> Versions(string hash) => Variants(hash);
    public AuxiliarySelection? AuxiliaryChoice(Guid user, string hash, string kind, string language) => Get<AuxiliarySelection>("auxiliary-choice", user.ToString("N") + ":" + hash + ":" + kind + ":" + language);
    public TimingCorrection? Timing(Guid item, string hash) => Get<TimingCorrection>("timing-correction", item.ToString("N") + ":" + hash);
    public VersionSnapshot? PreviousSelection(Guid item) => Get<VersionSnapshot>("previous", item.ToString("N"));
}
