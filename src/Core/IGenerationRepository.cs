namespace LyricBridge;

/// <summary>Storage contract used by generation workers, independent of database or host types.</summary>
public interface IGenerationRepository : IJobRepository
{
    StoreAdmission Admit(Guid? item = null);
    bool IsAdmitted(StoreAdmission ticket, string hash);
    bool IsResetting { get; }
    long Epoch { get; }
    bool PersistRequest(Job job, long expectedEpoch, RichLyrics? lyrics = null, bool requireExisting = false);
    RichLyrics? GetDocument(string hash);
    Variant? GetVariant(string key);
    List<Variant> Variants(string hash);
    void SaveJob(Job job);
    bool CompleteGeneration(Job job, Variant? variant);
}
