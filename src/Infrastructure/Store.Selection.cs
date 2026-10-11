using Microsoft.Data.Sqlite;

namespace LyricBridge;

public sealed partial class Store : ISelectionRepository
{
    public ImprovementOffer? Improvement(Guid item) => Get<ImprovementOffer>("better", item.ToString("N"));
    public SelectionAssessment? PreviewAssessment(Candidate candidate) => Get<SelectionAssessment>("preview-assessment", LyricRanking.Key(candidate));
    public void ClearRejection(Guid item)
    {
        lock (writeGate)
        {
            if (IsResetting || (operationEpoch.Value is long started && started != Epoch))
                throw new WorkflowException(409, "reset_in_progress", "The managed lyric library was reset. Reload before making changes.", true);
            Delete("rejected-match", item.ToString("N"));
        }
    }
    public bool TrySaveAutomatic(Guid item, Verification verification, string? expectedHash = null)
    {
        lock (writeGate)
        {
            if (IsResetting || (operationEpoch.Value is long started && started != Epoch)) return false;
            using var connection = Open(); using var transaction = connection.BeginTransaction();
            var id = item.ToString("N"); var current = ReadSelection(connection, transaction, id);
            if ((expectedHash is null ? current.Lyrics is not null : current.Lyrics?.Hash != expectedHash) || current.Rejected is not null || current.Instrumental?.Manual == true) return false;
            var lyrics = verification.Lyrics ?? throw new ArgumentException("An automatic selection requires verified lyrics.");
            lyrics.Hash = Codec.ContentHash(lyrics);
            WriteSelection(connection, transaction, id, new(lyrics, null, null, new SelectionAssessment(lyrics.Hash, verification.Candidate)), verification.Raw);
            transaction.Commit(); return true;
        }
    }

    public string? ApplyUpgrade(Guid item, VersionSnapshot expected, string offerHash, string baselineHash)
    {
        lock (writeGate)
        {
            if (IsResetting || (operationEpoch.Value is long started && started != Epoch)) return "reset_in_progress";
            using var connection = Open();
            using var transaction = connection.BeginTransaction();
            var id = item.ToString("N");
            var current = ReadSelection(connection, transaction, id);
            if (Codec.Serialize(current) != Codec.Serialize(expected)) return "lyric_version_changed";
            var offer = ReadRecord<ImprovementOffer>(connection, transaction, "better", id);
            if (offer is null || offer.Lyrics.Hash != offerHash || offer.BaselineHash != baselineHash) return "upgrade_offer_changed";
            var lyrics = Codec.Deserialize<RichLyrics>(Codec.Serialize(offer.Lyrics))!;
            lyrics.Manual = true;
            WriteRecord(connection, transaction, "previous", id, current);
            WriteSelection(connection, transaction, id, new(lyrics, null, null, new SelectionAssessment(lyrics.Hash, offer.Candidate)), null);
            transaction.Commit();
            return null;
        }
    }

    public bool SaveTiming(Guid item, VersionSnapshot expected, TimingCorrection correction)
    {
        lock (writeGate)
        {
            if (IsResetting || (operationEpoch.Value is long started && started != Epoch)) return false;
            using var connection = Open();
            using var transaction = connection.BeginTransaction();
            var id = item.ToString("N");
            if (Codec.Serialize(ReadSelection(connection, transaction, id)) != Codec.Serialize(expected)) return false;
            // Native lyrics need not have a shared selection. Cleanup may have expired
            // their preview after the caller captured it; do not commit a dangling reference.
            if (ReadRecord<RichLyrics>(connection, transaction, "document", correction.Hash) is null) return false;
            WriteRecord(connection, transaction, "timing-correction", id + ":" + correction.Hash, correction);
            transaction.Commit();
            return true;
        }
    }

    public void MarkInstrumental(Guid item, bool clear)
    {
        lock (writeGate)
        {
            var selected = Selection(item);
            ApplySelection(item, clear ? selected with { Instrumental = null, Rejected = null } : new(null, new InstrumentalEvidence("Administrator", "", "Marked instrumental", true)));
        }
    }

    public VersionSnapshot Selection(Guid item)
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        return ReadSelection(connection, transaction, item.ToString("N"));
    }

    public void ApplySelection(Guid item, VersionSnapshot selection, RawLyrics? raw = null, bool remember = true)
    {
        lock (writeGate)
        {
            if (IsResetting || (operationEpoch.Value is long started && started != Epoch))
                throw new WorkflowException(409, "reset_in_progress", "The managed lyric library was reset. Reload before making changes.", true);
            using var connection = Open();
            using var transaction = connection.BeginTransaction();
            var id = item.ToString("N");
            if (remember) WriteRecord(connection, transaction, "previous", id, ReadSelection(connection, transaction, id));
            WriteSelection(connection, transaction, id, selection, raw);
            transaction.Commit();
        }
    }

    public void RevertSelection(Guid item)
    {
        lock (writeGate)
        {
            if (IsResetting || (operationEpoch.Value is long started && started != Epoch))
                throw new WorkflowException(409, "reset_in_progress", "The managed lyric library was reset. Reload before making changes.", true);
            using var connection = Open();
            using var transaction = connection.BeginTransaction();
            var id = item.ToString("N");
            var previous = ReadRecord<VersionSnapshot>(connection, transaction, "previous", id)
                ?? throw new InvalidOperationException("No previous selection.");
            WriteRecord(connection, transaction, "previous", id, ReadSelection(connection, transaction, id));
            WriteSelection(connection, transaction, id, previous, null);
            transaction.Commit();
        }
    }

    private static VersionSnapshot ReadSelection(SqliteConnection connection, SqliteTransaction transaction, string id) => new(
        ReadRecord<RichLyrics>(connection, transaction, "selected", id),
        ReadRecord<InstrumentalEvidence>(connection, transaction, "instrumental", id),
        ReadRecord<MatchRejection>(connection, transaction, "rejected-match", id),
        ReadRecord<SelectionAssessment>(connection, transaction, "selection-assessment", id));

    private static void WriteSelection(SqliteConnection connection, SqliteTransaction transaction, string id, VersionSnapshot selection, RawLyrics? raw)
    {
        if (selection.Lyrics is { } lyrics)
        {
            lyrics.Hash = Codec.ContentHash(lyrics);
            WriteRecord(connection, transaction, "document", lyrics.Hash, lyrics);
            RetainDocument(connection, transaction, lyrics.Hash);
            if (raw is not null) WriteRecord(connection, transaction, "raw", lyrics.Hash, raw);
        }
        WriteRecord(connection, transaction, "selected", id, selection.Lyrics);
        WriteRecord(connection, transaction, "instrumental", id, selection.Instrumental);
        WriteRecord(connection, transaction, "rejected-match", id, selection.Rejected);
        WriteRecord(connection, transaction, "selection-assessment", id, selection.Assessment);
        WriteRecord<object>(connection, transaction, "better", id, null);
    }

    private static T? ReadRecord<T>(SqliteConnection connection, SqliteTransaction transaction, string kind, string id)
    {
        using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "SELECT payload FROM records WHERE kind=$kind AND id=$id";
        command.Parameters.AddWithValue("$kind", kind); command.Parameters.AddWithValue("$id", id);
        return command.ExecuteScalar() is string value ? Codec.Deserialize<T>(value) : default;
    }

    private static void WriteRecord<T>(SqliteConnection connection, SqliteTransaction transaction, string kind, string id, T? value)
    {
        using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = value is null
            ? "DELETE FROM records WHERE kind=$kind AND id=$id"
            : "INSERT INTO records(kind,id,payload) VALUES($kind,$id,$payload) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload";
        command.Parameters.AddWithValue("$kind", kind); command.Parameters.AddWithValue("$id", id);
        if (value is not null) command.Parameters.AddWithValue("$payload", Codec.Serialize(value));
        command.ExecuteNonQuery();
    }
}
