using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace LyricBridge;

public sealed record ManagedRecord(string Kind, string Id, JsonElement Payload)
{
    public string Key => Kind + ":" + Id;
    public string? Text(string name) => Payload.ValueKind == JsonValueKind.Object && Payload.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    public Guid? ItemId => Guid.TryParse(Text("itemId"), out var item) ? item
        : Kind is "selected" or "selection-assessment" or "instrumental" or "instrumental-evidence" or "rejected-match" or "better" or "discovery-suppressed" && Guid.TryParse(Id, out item) ? item
        : Kind is "timing-correction" && Guid.TryParse(Id.Split(':')[0], out item) ? item
        : Kind == "song-preferences" && Guid.TryParse(Id.Split(':').ElementAtOrDefault(1), out item) ? item : null;
    public Guid? UserId => Guid.TryParse(Text("userId"), out var user) ? user
        : Kind is "preferences" or "song-preferences" or "auxiliary-choice" or "pronunciation-choice" && Guid.TryParse(Id.Split(':')[0], out user) ? user : null;
}

/// <summary>One classification for inspection and allowlisted deletion. Unknown records remain visible.</summary>
public static class ManagedDataKinds
{
    public static string Category(string kind) => kind switch
    {
        "saved-original" or "document" or "raw" => "originals",
        "variant" or "mixed-origin" => "versions",
        "transcript" or "transcript-original" => "transcripts",
        "boundary-version" or "boundary-review-result" or "saved-boundary-entry" => "line-breaks",
        "selected" or "selection-assessment" => "selections",
        "timing-correction" => "timing",
        "instrumental" or "instrumental-evidence" or "rejected-match" or "discovery-suppressed" => "classifications",
        "preferences" or "song-preferences" => "preferences",
        "auxiliary-choice" or "pronunciation-choice" => "choices",
        "job" => "history",
        "candidate" or "preview" or "preview-assessment" or "better" or "review-checkpoint" or "transcript-chunk" => "temporary",
        _ => "bookkeeping"
    };
    public static string Label(string kind) => kind switch
    {
        "saved-original" => "Original lyrics",
        "document" => "Shared lyric content",
        "raw" => "Provider response",
        "variant" => "Language version",
        "mixed-origin" => "Version provenance",
        "transcript" => "Transcript",
        "transcript-original" => "Published transcript",
        "boundary-version" => "Line-break version",
        "boundary-review-result" => "Line-break review result",
        "saved-boundary-entry" => "Saved line-break review",
        "selected" => "Selected lyrics",
        "selection-assessment" => "Selection assessment",
        "timing-correction" => "Timing adjustment",
        "instrumental" => "Instrumental classification",
        "instrumental-evidence" => "Classification evidence",
        "rejected-match" => "Rejected match",
        "discovery-suppressed" => "Retrieval suppression",
        "preferences" => "Account preferences",
        "song-preferences" => "Song preferences",
        "auxiliary-choice" => "Language choice",
        "pronunciation-choice" => "Pronunciation choice",
        "job" => "Generation request",
        "job-admission" => "Quota accounting",
        "candidate" => "Search result",
        "preview" => "Temporary lyric preview",
        "preview-assessment" => "Preview assessment",
        "better" => "Improvement offer",
        "review-checkpoint" => "Review checkpoint",
        "transcript-chunk" => "Transcription chunk",
        "audio-staging" => "Staged audio",
        _ => "Internal record"
    };
    public static bool DirectlyDeletable(string kind) => kind is "preferences" or "song-preferences" or "auxiliary-choice" or "pronunciation-choice"
        or "timing-correction" or "instrumental" or "instrumental-evidence" or "rejected-match" or "discovery-suppressed"
        or "candidate" or "preview" or "preview-assessment" or "better" or "review-checkpoint" or "transcript-chunk" or "document" or "raw";
}

public sealed partial class Store
{
    public IReadOnlyList<ManagedRecord> InspectData()
    {
        using var c = Open(); using var tx = c.BeginTransaction();
        return ReadRecords(c, tx).Select(r => new ManagedRecord(r.Kind, r.Id, JsonSerializer.Deserialize<JsonElement>(r.Payload))).OrderBy(r => r.Key, StringComparer.Ordinal).ToList();
    }

    // Serializes confirmation revalidation with all database writers; callbacks must be synchronous.
    public T WithDataWriteLock<T>(Func<T> action)
    {
        lock (writeGate)
        {
            if (IsResetting) throw new WorkflowException(409, "reset_in_progress", "A data reset is running. Refresh when it finishes.", true);
            return action();
        }
    }

    private static long FenceRecord(SqliteConnection c, SqliteTransaction tx, string kind, string id)
    {
        using var cmd = c.CreateCommand(); cmd.Transaction = tx;
        cmd.CommandText = "UPDATE deletion_clock SET revision=revision+1 WHERE id=1; INSERT INTO deletion_revisions(scope,revision) SELECT $scope,revision FROM deletion_clock WHERE id=1 ON CONFLICT(scope) DO UPDATE SET revision=excluded.revision; SELECT revision FROM deletion_clock WHERE id=1";
        cmd.Parameters.AddWithValue("$scope", "hash:record:" + kind + ":" + id);
        return Convert.ToInt64(cmd.ExecuteScalar());
    }

    public bool DeleteManagedRecord(string kind, string id)
    {
        if (!ManagedDataKinds.DirectlyDeletable(kind)) throw new ArgumentException("This category requires its domain deletion workflow.");
        return WithDataWriteLock(() =>
        {
            using var c = Open(); using var tx = c.BeginTransaction();
            if (ReadRecord<JsonElement?>(c, tx, kind, id) == null) return false;
            if (kind is "document" or "raw")
            {
                using var references = c.CreateCommand(); references.Transaction = tx;
                references.CommandText = "SELECT EXISTS(SELECT 1 FROM retained_documents WHERE hash=$hash) OR EXISTS(SELECT 1 FROM record_references WHERE hash=$hash)";
                references.Parameters.AddWithValue("$hash", id);
                if (Convert.ToInt32(references.ExecuteScalar()) != 0) throw new WorkflowException(409, "data_in_use", "Delete the owning saved originals or versions first.");
            }
            FenceRecord(c, tx, kind, id);
            WriteUnchecked<object>(c, tx, kind, id, null);
            tx.Commit(); return true;
        });
    }

    public bool DeleteExpiredAdmission(string id)
    {
        return WithDataWriteLock(() =>
        {
            using var c = Open(); using var tx = c.BeginTransaction();
            using var cmd = c.CreateCommand(); cmd.Transaction = tx;
            cmd.CommandText = "DELETE FROM records WHERE kind='job-admission' AND id=$id AND json_extract(payload,'$.created')<=$cutoff";
            cmd.Parameters.AddWithValue("$id", id); cmd.Parameters.AddWithValue("$cutoff", UtcTimestampConverter.Format(DateTime.UtcNow.AddDays(-1)));
            var deleted = cmd.ExecuteNonQuery(); tx.Commit(); return deleted != 0;
        });
    }

    public bool IsDocumentRetained(string hash)
    {
        using var c = Open(); using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT EXISTS(SELECT 1 FROM retained_documents WHERE hash=$hash) OR EXISTS(SELECT 1 FROM record_references WHERE hash=$hash)";
        cmd.Parameters.AddWithValue("$hash", hash); return Convert.ToInt32(cmd.ExecuteScalar()) != 0;
    }

    public object InspectBookkeeping()
    {
        using var c = Open(); var tables = new Dictionary<string, long>();
        foreach (var table in new[] { "deletion_clock", "deletion_revisions", "retained_documents", "transient_records", "record_references" })
        {
            using var cmd = c.CreateCommand(); cmd.CommandText = "SELECT COUNT(*) FROM " + table;
            tables[table] = Convert.ToInt64(cmd.ExecuteScalar());
        }
        return tables;
    }

    public IReadOnlySet<string> TemporaryKeys(bool expiredOnly)
    {
        using var c = Open(); using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT kind,id FROM transient_records WHERE last_used_ms<$cutoff";
        cmd.Parameters.AddWithValue("$cutoff", expiredOnly ? DateTimeOffset.UtcNow.AddHours(-24).ToUnixTimeMilliseconds() : long.MaxValue);
        using var reader = cmd.ExecuteReader(); var keys = new HashSet<string>(StringComparer.Ordinal);
        while (reader.Read()) keys.Add(reader.GetString(0) + ":" + reader.GetString(1));
        return keys;
    }

    public void CancelResetJobs()
    {
        lock (writeGate)
        {
            if (!IsResetting) throw new InvalidOperationException("Request cancellation requires exclusive maintenance.");
            using var c = Open(); using var tx = c.BeginTransaction();
            foreach (var job in ReadRecords(c, tx).Where(r => r.Kind == "job").Select(r => Codec.Deserialize<Job>(r.Payload)!).Where(j => !JobLifecycle.Terminal(j.State)))
            {
                job.State = "cancelled"; job.OutputDeleted = true; job.OutputDeletedAt = DateTimeOffset.UtcNow;
                WriteUnchecked(c, tx, "job", job.Id, job);
            }
            tx.Commit();
        }
    }

    public void ResetAllPreferences()
    {
        // Used only by a reset coordinator after BeginReset has fenced incoming writers.
        lock (writeGate)
        {
            if (!IsResetting) throw new InvalidOperationException("Preference reset requires exclusive maintenance.");
            using var c = Open(); using var cmd = c.CreateCommand();
            cmd.CommandText = "PRAGMA secure_delete=ON; DELETE FROM records WHERE kind IN ('preferences','song-preferences','auxiliary-choice','pronunciation-choice');";
            cmd.ExecuteNonQuery();
        }
    }
}
