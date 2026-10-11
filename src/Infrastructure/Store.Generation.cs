namespace LyricBridge;

public sealed partial class Store : IGenerationRepository
{
    public RichLyrics? GetDocument(string hash) => Get<RichLyrics>("document", hash);
    public Variant? GetVariant(string key) => Get<Variant>("variant", key);
    public void SaveJob(Job job) => Put("job", job.Id, job);

    public bool PersistRequest(Job job, long expectedEpoch, RichLyrics? lyrics = null, bool requireExisting = false)
    {
        lock (writeGate)
        {
            if (IsResetting || Epoch != expectedEpoch || (operationEpoch.Value is long started && started != Epoch)) return false;
            using var connection = Open(); using var transaction = connection.BeginTransaction();
            if (requireExisting && ReadRecord<Job>(connection, transaction, "job", job.Id) is null) return false;
            if (lyrics is not null) WriteRecord(connection, transaction, "document", lyrics.Hash, lyrics);
            WriteRecord(connection, transaction, "job", job.Id, job); transaction.Commit(); return true;
        }
    }

    public bool CompleteGeneration(Job job, Variant? variant)
    {
        if (variant is not null && (variant.Profile is null || variant.Profile != job.Profile || variant.Hash != job.Hash))
            throw new ArgumentException("Generated variant provenance must match its admitted job.");
        lock (writeGate)
        {
            if (IsResetting || (operationEpoch.Value is long started && started != Epoch)) return false;
            using var connection = Open();
            using var transaction = connection.BeginTransaction();
            var current = ReadRecord<Job>(connection, transaction, "job", job.Id);
            if (current?.State != "running") return false;
            if (variant is not null) WriteRecord(connection, transaction, "variant", variant.Key, variant);
            var completed = Codec.Deserialize<Job>(Codec.Serialize(job))!;
            completed.State = "complete";
            completed.Progress = 100;
            WriteRecord(connection, transaction, "job", job.Id, completed);
            transaction.Commit();
            job.State = completed.State;
            job.Progress = completed.Progress;
            return true;
        }
    }
}
