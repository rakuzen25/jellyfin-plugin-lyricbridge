using Microsoft.Data.Sqlite;
namespace LyricBridge;

public sealed partial class Store : IJobRepository, IDisposable
{
    private readonly Lazy<string> connectionString;
    private readonly object connectionGate = new();
    private string? poolConnectionString;
    private bool disposed;
    private readonly object writeGate = new();
    private readonly AsyncLocal<long?> operationEpoch = new();
    private readonly AsyncLocal<StoreAdmission?> admission = new();
    public IDisposable Operation(long? admittedEpoch = null) => Operation((admission.Value ?? Admit()) with { Epoch = admittedEpoch ?? Epoch });
    public IDisposable Operation(StoreAdmission ticket)
    {
        var old = operationEpoch.Value;
        var previous = admission.Value;
        operationEpoch.Value = ticket.Epoch;
        admission.Value = ticket;
        return new Scope(() => { operationEpoch.Value = old; admission.Value = previous; });
    }
    private sealed class Scope(Action release) : IDisposable
    {
        public void Dispose() => release();
    }

    public Store(string directory) : this(() => directory) { }
    public Store(Func<string> directoryFactory)
    {
        connectionString = new Lazy<string>(() =>
        {
            var directory = directoryFactory();
            if (!Path.IsPathFullyQualified(directory))
                throw new ArgumentException("Lyric storage must be an absolute container path.", nameof(directory));
            Directory.CreateDirectory(directory);
            var result = new SqliteConnectionStringBuilder { DataSource = Path.Combine(directory, "index.sqlite"), DefaultTimeout = 10 }.ToString();
            poolConnectionString = result;
            using var c = new SqliteConnection(result);
            c.Open();
            using var cmd = c.CreateCommand();
            cmd.CommandText = "PRAGMA user_version";
            var schema = Convert.ToInt32(cmd.ExecuteScalar());
            cmd.CommandText = "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='records'";
            var existing = Convert.ToInt32(cmd.ExecuteScalar()) != 0;
            if (schema != 5 && (schema != 0 || existing))
                throw new InvalidDataException("Unsupported LyricBridge database schema. Stop Jellyfin, back up the LyricBridge storage directory, and configure a new empty storage directory. Existing data has not been changed.");
            cmd.CommandText = "PRAGMA journal_mode=WAL; PRAGMA user_version=5; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,id)); CREATE INDEX IF NOT EXISTS jobs_user_created ON records(json_extract(payload,'$.userId'),json_extract(payload,'$.created'),id) WHERE kind='job'; CREATE INDEX IF NOT EXISTS jobs_created ON records(json_extract(payload,'$.created'),id) WHERE kind='job'; CREATE INDEX IF NOT EXISTS jobs_user_state ON records(json_extract(payload,'$.userId'),json_extract(payload,'$.state'),json_extract(payload,'$.cacheKey')) WHERE kind='job'; CREATE INDEX IF NOT EXISTS jobs_state ON records(json_extract(payload,'$.state'),json_extract(payload,'$.created')) WHERE kind='job'; CREATE INDEX IF NOT EXISTS variants_hash ON records(json_extract(payload,'$.hash')) WHERE kind='variant';";
            cmd.ExecuteNonQuery();
            InitializeRetention(c);
            return result;
        });
    }
    private string ConnectionString
    {
        get
        {
            lock (connectionGate)
            {
                ObjectDisposedException.ThrowIf(disposed, this);
                return connectionString.Value;
            }
        }
    }
    private SqliteConnection Open()
    {
        lock (connectionGate)
        {
            var connection = new SqliteConnection(ConnectionString);
            try
            {
                connection.Open();
                return connection;
            }
            catch { connection.Dispose(); throw; }
        }
    }
    public void Dispose()
    {
        lock (connectionGate)
        {
            if (disposed)
                return;
            disposed = true;
            if (poolConnectionString != null)
            {
                using var connection = new SqliteConnection(poolConnectionString);
                SqliteConnection.ClearPool(connection);
            }
        }
    }
    public T? Get<T>(string kind, string id)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT payload FROM records WHERE kind=$k AND id=$i";
        cmd.Parameters.AddWithValue("$k", kind);
        cmd.Parameters.AddWithValue("$i", id);
        return cmd.ExecuteScalar() is string s ? Codec.Deserialize<T>(s) : default;
    }
    public void Put<T>(string kind, string id, T value)
    {
        lock (writeGate)
        {
            if (IsResetting || (operationEpoch.Value is long started && started != Epoch))
                return;
            using var c = Open();
            using var tx = c.BeginTransaction();
            if (!CanWrite(c, tx, kind, id, value))
                return;
            WriteUnchecked(c, tx, kind, id, value);
            tx.Commit();
        }
    }
    public List<T> All<T>(string kind)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT payload FROM records WHERE kind=$k";
        cmd.Parameters.AddWithValue("$k", kind);
        using var r = cmd.ExecuteReader();
        var result = new List<T>();
        while (r.Read())
            if (Codec.Deserialize<T>(r.GetString(0)) is T value)
                result.Add(value);
        return result;
    }
    public List<Variant> Variants(string hash)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT payload FROM records WHERE kind='variant' AND json_extract(payload,'$.hash')=$h";
        cmd.Parameters.AddWithValue("$h", hash);
        using var reader = cmd.ExecuteReader();
        var result = new List<Variant>();
        while (reader.Read())
            if (Codec.Deserialize<Variant>(reader.GetString(0)) is { } value)
                result.Add(value);
        return result;
    }
    public void Delete(string kind, string id)
    {
        lock (writeGate)
        {
            if (IsResetting || (operationEpoch.Value is long started && started != Epoch))
                return;
            using var c = Open();
            using var tx = c.BeginTransaction();
            if (admission.Value is { } ticket && !ValidAdmission(c, tx, ticket, ["record:" + kind + ":" + id], songScope: kind is not ("preferences" or "song-preferences")))
                throw DeletedConflict();
            if (kind is not ("preferences" or "song-preferences"))
                RequireAdmission(c, tx);
            using var cmd = c.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = "DELETE FROM records WHERE kind=$k AND id=$i";
            cmd.Parameters.AddWithValue("$k", kind);
            cmd.Parameters.AddWithValue("$i", id);
            cmd.ExecuteNonQuery();
            tx.Commit();
        }
    }
    public bool DeleteVariant(string key, string hash, string kind)
    {
        lock (writeGate)
        {
            if (IsResetting || (operationEpoch.Value is long started && started != Epoch))
                return false;
            using var c = Open();
            using var transaction = c.BeginTransaction();
            RequireAdmission(c, transaction, [hash]);
            using var delete = c.CreateCommand();
            delete.Transaction = transaction;
            delete.CommandText = "DELETE FROM records WHERE kind='variant' AND id=$k AND json_extract(payload,'$.hash')=$h AND json_extract(payload,'$.kind')=$t AND json_extract(payload,'$.service')!='Kawazu'";
            delete.Parameters.AddWithValue("$k", key);
            delete.Parameters.AddWithValue("$h", hash);
            delete.Parameters.AddWithValue("$t", kind);
            if (delete.ExecuteNonQuery() == 0)
                return false;
            using var choices = c.CreateCommand();
            choices.Transaction = transaction;
            choices.CommandText = "DELETE FROM records WHERE kind='auxiliary-choice' AND json_extract(payload,'$.key')=$k";
            choices.Parameters.AddWithValue("$k", key);
            choices.ExecuteNonQuery();
            using var origin = c.CreateCommand();
            origin.Transaction = transaction;
            origin.CommandText = "DELETE FROM records WHERE kind='mixed-origin' AND id=$k";
            origin.Parameters.AddWithValue("$k", key);
            origin.ExecuteNonQuery();
            FenceRecord(c, transaction, "variant", key);
            foreach (var job in ReadRecords(c, transaction).Where(r => r.Kind == "job").Select(r => Codec.Deserialize<Job>(r.Payload)!))
            {
                if (job.VariantKey != key) continue;
                job.OutputDeleted = true; job.OutputDeletedAt = DateTimeOffset.UtcNow;
                if (!JobLifecycle.Terminal(job.State)) job.State = "cancelled";
                WriteUnchecked(c, transaction, "job", job.Id, job);
            }
            transaction.Commit();
            return true;
        }
    }
    private int resetting;
    private long epoch;
    public bool IsResetting => Volatile.Read(ref resetting) != 0;
    public long Epoch => Interlocked.Read(ref epoch);
    public bool BeginReset()
    {
        lock (writeGate)
        {
            if (Interlocked.CompareExchange(ref resetting, 1, 0) != 0)
                return false;
            Interlocked.Increment(ref epoch);
            return true;
        }
    }
    public void EndReset() => Volatile.Write(ref resetting, 0);
    public int ResetManagedLibrary(bool factory = false)
    {
        lock (writeGate)
        {
            using var c = Open();
            using var tx = c.BeginTransaction();
            using var cmd = c.CreateCommand();
            cmd.Transaction = tx;
            // User display preferences and plugin XML configuration are intentionally preserved.
            cmd.CommandText = "PRAGMA secure_delete=ON; DELETE FROM retained_documents; DELETE FROM transient_records; DELETE FROM records WHERE kind NOT IN ('preferences','song-preferences')";
            var count = cmd.ExecuteNonQuery();
            if (factory)
            {
                cmd.CommandText = "DELETE FROM deletion_revisions; UPDATE deletion_clock SET revision=0 WHERE id=1";
                cmd.ExecuteNonQuery();
            }
            tx.Commit();
            // Clear deleted payloads from reusable pages and checkpoint the WAL.
            using var compact = c.CreateCommand();
            compact.CommandText = "PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);";
            compact.ExecuteNonQuery();
            return count;
        }
    }
    public void Save(Guid item, RichLyrics lyrics, RawLyrics? raw = null) => ApplySelection(item, new(lyrics, null), raw);
}
