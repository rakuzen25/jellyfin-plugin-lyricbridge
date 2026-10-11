using Microsoft.Data.Sqlite;

namespace LyricBridge;

public sealed partial class Store
{
    public string CacheCandidate(Candidate candidate, DateTimeOffset? accessed = null)
    {
        var key = Codec.Hash(Codec.Serialize(candidate));
        lock (writeGate)
        {
            if (IsResetting || (operationEpoch.Value is long started && started != Epoch)) return key;
            using var connection = Open(); using var transaction = connection.BeginTransaction();
            WriteRecord(connection, transaction, "candidate", key, candidate);
            TouchTransient(connection, transaction, "candidate", key, (accessed ?? DateTimeOffset.UtcNow).ToUnixTimeMilliseconds());
            transaction.Commit(); return key;
        }
    }

    public Candidate? GetCandidate(string key)
    {
        lock (writeGate)
        {
            if (IsResetting) return null;
            using var connection = Open(); using var transaction = connection.BeginTransaction();
            var candidate = ReadRecord<Candidate>(connection, transaction, "candidate", key);
            if (candidate is null) return null;
            TouchTransient(connection, transaction, "candidate", key, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            transaction.Commit(); return candidate;
        }
    }

    private static void InitializeRetention(SqliteConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS retained_documents(hash TEXT PRIMARY KEY NOT NULL);
            CREATE TABLE IF NOT EXISTS transient_records(kind TEXT NOT NULL,id TEXT NOT NULL,last_used_ms INTEGER NOT NULL,PRIMARY KEY(kind,id));
            CREATE INDEX IF NOT EXISTS transient_expiry ON transient_records(last_used_ms);
            CREATE TABLE IF NOT EXISTS record_references(owner_kind TEXT NOT NULL,owner_id TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(owner_kind,owner_id,hash));
            CREATE INDEX IF NOT EXISTS referenced_hash ON record_references(hash);
            CREATE TRIGGER IF NOT EXISTS record_refs_insert AFTER INSERT ON records BEGIN
              INSERT OR IGNORE INTO record_references SELECT DISTINCT NEW.kind,NEW.id,value FROM json_tree(NEW.payload)
              WHERE key IN ('hash','donorHash','baselineHash') AND type='text' AND NEW.kind NOT IN ('document','raw','preview','preview-assessment');
            END;
            CREATE TRIGGER IF NOT EXISTS record_refs_update AFTER UPDATE ON records BEGIN
              DELETE FROM record_references WHERE owner_kind=OLD.kind AND owner_id=OLD.id;
              INSERT OR IGNORE INTO record_references SELECT DISTINCT NEW.kind,NEW.id,value FROM json_tree(NEW.payload)
              WHERE key IN ('hash','donorHash','baselineHash') AND type='text' AND NEW.kind NOT IN ('document','raw','preview','preview-assessment');
            END;
            CREATE TRIGGER IF NOT EXISTS record_refs_delete AFTER DELETE ON records BEGIN
              DELETE FROM record_references WHERE owner_kind=OLD.kind AND owner_id=OLD.id;
              DELETE FROM transient_records WHERE kind=OLD.kind AND id=OLD.id;
            END;
            """;
        command.ExecuteNonQuery();
    }

    public void CachePreview(Verification verification, DateTimeOffset? accessed = null)
    {
        if (verification.Lyrics is not { } lyrics) return;
        lock (writeGate)
        {
            if (IsResetting || (operationEpoch.Value is long started && started != Epoch)) return;
            using var connection = Open(); using var transaction = connection.BeginTransaction();
            var key = verification.Candidate.Source + ":" + verification.Candidate.Id;
            var timestamp = (accessed ?? DateTimeOffset.UtcNow).ToUnixTimeMilliseconds();
            void Cache<T>(string kind, string id, T value)
            {
                WriteRecord(connection, transaction, kind, id, value);
                TouchTransient(connection, transaction, kind, id, timestamp);
            }
            Cache("document", lyrics.Hash, lyrics);
            Cache("preview", key, lyrics);
            Cache("preview-assessment", key, new SelectionAssessment(lyrics.Hash, verification.Candidate));
            if (verification.Raw is { } raw) Cache("raw", lyrics.Hash, raw);
            transaction.Commit();
        }
    }

    public RichLyrics? GetPreview(string key)
    {
        lock (writeGate)
        {
            if (IsResetting) return null;
            using var connection = Open(); using var transaction = connection.BeginTransaction();
            var lyrics = ReadRecord<RichLyrics>(connection, transaction, "preview", key);
            if (lyrics is null) return null;
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            TouchTransient(connection, transaction, "preview", key, now);
            TouchTransient(connection, transaction, "preview-assessment", key, now);
            TouchTransient(connection, transaction, "document", lyrics.Hash, now);
            TouchTransient(connection, transaction, "raw", lyrics.Hash, now);
            transaction.Commit(); return lyrics;
        }
    }

    private static void TouchTransient(SqliteConnection connection, SqliteTransaction transaction, string kind, string id, long timestamp)
    {
        using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "INSERT INTO transient_records(kind,id,last_used_ms) SELECT $kind,$id,$time WHERE EXISTS(SELECT 1 FROM records WHERE kind=$kind AND id=$id) ON CONFLICT(kind,id) DO UPDATE SET last_used_ms=excluded.last_used_ms";
        command.Parameters.AddWithValue("$kind", kind); command.Parameters.AddWithValue("$id", id); command.Parameters.AddWithValue("$time", timestamp); command.ExecuteNonQuery();
    }

    private static void RetainDocument(SqliteConnection connection, SqliteTransaction transaction, string hash)
    {
        using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "INSERT OR IGNORE INTO retained_documents(hash) VALUES($hash)";
        command.Parameters.AddWithValue("$hash", hash); command.ExecuteNonQuery();
    }

    public int ExpireTransientData(DateTimeOffset? now = null)
    {
        lock (writeGate)
        {
            if (IsResetting) return 0;
            using var connection = Open(); using var transaction = connection.BeginTransaction();
            using var command = connection.CreateCommand(); command.Transaction = transaction;
            command.CommandText = """
                DELETE FROM records WHERE kind='candidate' AND id IN
                  (SELECT id FROM transient_records WHERE kind='candidate' AND last_used_ms<$cutoff);
                DELETE FROM records WHERE (kind,id) IN (
                  SELECT r.kind,r.id FROM transient_records t JOIN records r ON r.kind=t.kind AND r.id=t.id
                  WHERE t.last_used_ms<$cutoff AND r.kind IN ('preview','preview-assessment','document','raw')
                  AND NOT EXISTS (SELECT 1 FROM retained_documents saved WHERE saved.hash=CASE WHEN r.kind='raw' THEN r.id ELSE json_extract(r.payload,'$.hash') END)
                  AND NOT EXISTS (SELECT 1 FROM record_references refs WHERE refs.hash=CASE WHEN r.kind='raw' THEN r.id ELSE json_extract(r.payload,'$.hash') END)
                  AND NOT EXISTS (SELECT 1 FROM records p JOIN transient_records live ON live.kind=p.kind AND live.id=p.id
                    WHERE p.kind='preview' AND live.last_used_ms>=$cutoff
                    AND json_extract(p.payload,'$.hash')=CASE WHEN r.kind='raw' THEN r.id ELSE json_extract(r.payload,'$.hash') END)
                )
                """;
            command.Parameters.AddWithValue("$cutoff", (now ?? DateTimeOffset.UtcNow).AddHours(-24).ToUnixTimeMilliseconds());
            var removed = command.ExecuteNonQuery(); transaction.Commit(); return removed;
        }
    }
}
