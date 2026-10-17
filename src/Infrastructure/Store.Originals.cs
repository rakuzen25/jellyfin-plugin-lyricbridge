using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace LyricBridge;

public sealed partial class Store
{
    public StoreAdmission Admit(Guid? item = null)
    {
        lock (writeGate)
        {
            if (admission.Value is { } inherited) return inherited with { ItemId = item ?? inherited.ItemId };
            return FreshAdmission(item);
        }
    }

    public StoreAdmission FreshAdmission(Guid? item = null)
    {
        lock (writeGate) { using var c = Open(); using var tx = c.BeginTransaction(); return new(Epoch, ReadRevision(c, tx), item); }
    }
    public bool IsAdmitted(StoreAdmission ticket, string hash)
    {
        lock (writeGate) { using var c = Open(); using var tx = c.BeginTransaction(); return ValidAdmission(c, tx, ticket, [hash]); }
    }
    private static long ReadRevision(SqliteConnection c, SqliteTransaction tx)
    {
        using var cmd = c.CreateCommand(); cmd.Transaction = tx;
        cmd.CommandText = "SELECT revision FROM deletion_clock WHERE id=1";
        return Convert.ToInt64(cmd.ExecuteScalar());
    }
    private static WorkflowException DeletedConflict() => new(409, "original_deleted", "The saved original was deleted. Reload before making changes.", true);
    private bool ValidAdmission(SqliteConnection c, SqliteTransaction tx, StoreAdmission ticket, IEnumerable<string>? hashes = null, bool songScope = true)
    {
        if (IsResetting || ticket.Epoch != Epoch) return false;
        var scopes = (hashes ?? []).Select(h => "hash:" + h).ToList();
        if (ticket.ItemId is { } item)
        {
            if (songScope) scopes.Add("song:" + item.ToString("N"));
            scopes.AddRange((hashes ?? []).Select(h => "original:" + item.ToString("N") + ":" + h));
        }
        foreach (var scope in scopes)
        {
            using var cmd = c.CreateCommand(); cmd.Transaction = tx;
            cmd.CommandText = "SELECT revision FROM deletion_revisions WHERE scope=$scope"; cmd.Parameters.AddWithValue("$scope", scope);
            if (cmd.ExecuteScalar() is long revision && revision > ticket.Revision) return false;
        }
        return true;
    }
    private void RequireAdmission(SqliteConnection c, SqliteTransaction tx, IEnumerable<string>? hashes = null)
    {
        if (IsResetting || operationEpoch.Value is long epoch && epoch != Epoch) throw new WorkflowException(409, "reset_in_progress", "The managed lyric library was reset. Reload before making changes.", true);
        if (admission.Value is { } ticket && !ValidAdmission(c, tx, ticket, hashes)) throw DeletedConflict();
    }
    private static IEnumerable<string> Hashes(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
            foreach (var property in value.EnumerateObject())
            {
                if (property.Name is "hash" or "donorHash" or "baselineHash" && property.Value.ValueKind == JsonValueKind.String && property.Value.GetString() is { Length: > 0 } hash) yield return hash;
                foreach (var nested in Hashes(property.Value)) yield return nested;
            }
        else if (value.ValueKind == JsonValueKind.Array)
            foreach (var child in value.EnumerateArray()) foreach (var hash in Hashes(child)) yield return hash;
    }
    private bool CanWrite<T>(SqliteConnection c, SqliteTransaction tx, string kind, string id, T? value)
    {
        if (kind is "preferences" or "song-preferences") return true;
        if (IsResetting || operationEpoch.Value is long epoch && epoch != Epoch) return false;
        if (admission.Value is { } ticket)
        {
            var hashes = value is null ? [] : Hashes(JsonSerializer.SerializeToElement(value, Codec.Json)).Distinct().ToList();
            if (kind == "auxiliary-choice" && id.Split(':') is { Length: >= 2 } parts) hashes.Add(parts[1]);
            if (!ValidAdmission(c, tx, ticket, hashes)) return false;
        }
        if (kind == "job" && value is Job job)
        {
            var existing = ReadRecord<Job>(c, tx, kind, id);
            if (existing?.OutputDeleted == true && !job.OutputDeleted) return false;
            if (!job.OutputDeleted && !ValidAdmission(c, tx, new(Epoch, job.DeletionRevision, job.ItemId), [job.Hash], songScope: job.TaskKind != "language")) return false;
        }
        return true;
    }

    private void SaveOriginal(SqliteConnection c, SqliteTransaction tx, Guid item, RichLyrics lyrics, SelectionAssessment? assessment)
    {
        var id = item.ToString("N") + ":" + lyrics.Hash;
        var existing = ReadRecord<SavedOriginal>(c, tx, "saved-original", id);
        WriteRecord(c, tx, "saved-original", id, existing is not null ? existing with { AutoSaved = false } : new(item, lyrics.Hash, lyrics.Source, lyrics.ProviderId, lyrics.Title, lyrics.Artist, lyrics.WordTimed, DateTimeOffset.UtcNow, assessment, ReadRevision(c, tx)));
    }
    public void SaveAutomaticOriginal(Guid item, RichLyrics lyrics, StoreAdmission ticket)
    {
        lock (writeGate)
        {
            using var c = Open(); using var tx = c.BeginTransaction();
            lyrics.Hash = Codec.ContentHash(lyrics);
            if (!ValidAdmission(c, tx, ticket, [lyrics.Hash])) return;
            RequireAdmission(c, tx, [lyrics.Hash]);
            var id = item.ToString("N") + ":" + lyrics.Hash;
            var existing = ReadRecord<SavedOriginal>(c, tx, "saved-original", id);
            // Automatic copies use transient retention; explicit copies remain permanently retained.
            WriteRecord(c, tx, "document", lyrics.Hash, ReadRecord<RichLyrics>(c, tx, "document", lyrics.Hash) ?? lyrics);
            TouchTransient(c, tx, "document", lyrics.Hash, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            WriteRecord(c, tx, "saved-original", id, existing ?? new(item, lyrics.Hash, lyrics.Source, lyrics.ProviderId, lyrics.Title, lyrics.Artist, lyrics.WordTimed, DateTimeOffset.UtcNow, null, ReadRevision(c, tx), true));
            var obsolete = new List<string>();
            using (var originals = c.CreateCommand())
            {
                originals.Transaction = tx;
                originals.CommandText = "SELECT id FROM records WHERE kind='saved-original' AND json_extract(payload,'$.itemId')=$item AND json_extract(payload,'$.autoSaved')=1 AND json_extract(payload,'$.hash')<>$hash";
                originals.Parameters.AddWithValue("$item", item.ToString()); originals.Parameters.AddWithValue("$hash", lyrics.Hash);
                using var reader = originals.ExecuteReader();
                while (reader.Read()) obsolete.Add(reader.GetString(0));
            }
            foreach (var key in obsolete) WriteRecord<object>(c, tx, "saved-original", key, null);
            tx.Commit();
        }
    }
    public IReadOnlyList<SavedOriginal> SavedOriginals(Guid item)
    {
        using var c = Open(); using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT payload FROM records WHERE kind='saved-original' AND json_extract(payload,'$.itemId')=$item ORDER BY json_extract(payload,'$.savedAt') DESC,id";
        cmd.Parameters.AddWithValue("$item", item.ToString());
        using var reader = cmd.ExecuteReader(); var result = new List<SavedOriginal>();
        while (reader.Read()) result.Add(Codec.Deserialize<SavedOriginal>(reader.GetString(0))!); return result;
    }
    public RichLyrics SavedDocument(Guid item, string hash)
    {
        using var c = Open(); using var tx = c.BeginTransaction();
        RequireAdmission(c, tx, [hash]);
        return ReadRecord<SavedOriginal>(c, tx, "saved-original", item.ToString("N") + ":" + hash) is not null
            && ReadRecord<RichLyrics>(c, tx, "document", hash) is { } doc ? doc
            : throw new WorkflowException(404, "original_unavailable", "This saved original is no longer available.");
    }
    public void SelectOriginal(Guid item, string hash)
    {
        lock (writeGate)
        {
            using var c = Open(); using var tx = c.BeginTransaction(); RequireAdmission(c, tx, [hash]);
            var id = item.ToString("N");
            var saved = ReadRecord<SavedOriginal>(c, tx, "saved-original", id + ":" + hash) ?? throw new WorkflowException(404, "original_unavailable", "This saved original is no longer available.");
            var doc = ReadRecord<RichLyrics>(c, tx, "document", hash) ?? throw new WorkflowException(409, "original_unavailable", "The saved original content is unavailable.");
            doc.Manual = true;
            WriteSelection(c, tx, id, new(doc, null, null, saved.Assessment), null); tx.Commit();
        }
    }
    public bool DiscoverySuppressed(Guid item) => Get<bool>("discovery-suppressed", item.ToString("N"));
    public void ResumeDiscovery(Guid item) => Delete("discovery-suppressed", item.ToString("N"));

    public OriginalDeletion DeleteOriginal(Guid item, string hash, long? expectedRevision = null)
    {
        lock (writeGate)
        {
            using var c = Open(); using var tx = c.BeginTransaction(); RequireAdmission(c, tx, [hash]);
            var id = item.ToString("N");
            var saved = ReadRecord<SavedOriginal>(c, tx, "saved-original", id + ":" + hash) ?? throw new WorkflowException(404, "original_unavailable", "This saved original is no longer available.");
            if (expectedRevision is { } expected && saved.Revision != expected) throw new WorkflowException(409, "original_changed", "This original was saved again. Reload it before confirming deletion.", true);
            var now = DateTimeOffset.UtcNow;
            var revision = ReadRevision(c, tx) + 1;
            using (var clock = c.CreateCommand()) { clock.Transaction = tx; clock.CommandText = "UPDATE deletion_clock SET revision=$revision WHERE id=1"; clock.Parameters.AddWithValue("$revision", revision); clock.ExecuteNonQuery(); }
            void Fence(string scope)
            {
                using var cmd = c.CreateCommand(); cmd.Transaction = tx;
                cmd.CommandText = "INSERT INTO deletion_revisions VALUES($scope,$revision) ON CONFLICT(scope) DO UPDATE SET revision=excluded.revision";
                cmd.Parameters.AddWithValue("$scope", scope); cmd.Parameters.AddWithValue("$revision", revision); cmd.ExecuteNonQuery();
            }
            Fence("song:" + id); Fence("original:" + id + ":" + hash);
            void Remove(string kind, string key) => WriteUnchecked<object>(c, tx, kind, key, null);
            Remove("saved-original", id + ":" + hash); Remove("timing-correction", id + ":" + hash); Remove("transcript-original", id + ":" + hash);
            if (ReadSelection(c, tx, id).Lyrics?.Hash == hash)
            {
                var surviving = ReadRecords(c, tx).Where(r => r.Kind == "saved-original").Select(r => Codec.Deserialize<SavedOriginal>(r.Payload)!)
                    .Where(o => o.ItemId == item).OrderByDescending(o => o.SavedAt).ThenBy(o => o.Hash, StringComparer.Ordinal);
                SavedOriginal? replacement = null; RichLyrics? lyrics = null;
                foreach (var candidate in surviving)
                {
                    lyrics = ReadRecord<RichLyrics>(c, tx, "document", candidate.Hash);
                    if (lyrics is not null) { replacement = candidate; break; }
                }
                if (lyrics is not null)
                {
                    lyrics.Manual = true;
                    WriteUnchecked(c, tx, "document", lyrics.Hash, lyrics);
                    WriteUnchecked(c, tx, "selected", id, lyrics);
                    WriteUnchecked(c, tx, "selection-assessment", id, replacement!.Assessment);
                    Remove("instrumental", id); Remove("rejected-match", id); Remove("discovery-suppressed", id);
                }
                else
                {
                    Remove("selected", id); Remove("selection-assessment", id);
                    WriteUnchecked(c, tx, "discovery-suppressed", id, true);
                }
                Remove("better", id);
            }
            var cancelled = new List<string>();
            var records = ReadRecords(c, tx);
            foreach (var record in records.Where(r => r.Kind == "job"))
            {
                var job = Codec.Deserialize<Job>(record.Payload)!;
                if (job.ItemId != item || job.Hash != hash || job.State is not ("pending" or "queued" or "running")) continue;
                job.State = "cancelled"; job.OutputDeleted = true; job.OutputDeletedAt = now; job.Error = "The saved original was deleted; this request was cancelled."; job.Failure = null;
                WriteUnchecked(c, tx, "job", job.Id, job); cancelled.Add(job.Id);
            }
            records = ReadRecords(c, tx);
            var variants = records.Where(r => r.Kind == "variant").Select(r => Codec.Deserialize<Variant>(r.Payload)!).ToList();
            // Candidate dependency closure. A surviving owner outside this closure is a root.
            var candidates = new HashSet<string>(StringComparer.Ordinal) { hash };
            bool changed;
            do
            {
                changed = false;
                foreach (var variant in variants.Where(v => candidates.Contains(v.Hash)))
                    if (variant.Origin?.DonorHash is { } donor) changed |= candidates.Add(donor);
            } while (changed);
            var protectedHashes = new HashSet<string>(StringComparer.Ordinal);
            foreach (var record in records)
            {
                if (record.Kind is "document" or "raw" or "preview" or "preview-assessment" or "auxiliary-choice" or "mixed-origin") continue;
                if (record.Kind == "variant") continue;
                if (record.Kind == "job")
                {
                    var job = Codec.Deserialize<Job>(record.Payload)!;
                    if (job.OutputDeleted || job.State is not ("pending" or "queued" or "running")) continue;
                }
                using var json = JsonDocument.Parse(record.Payload);
                foreach (var referenced in Hashes(json.RootElement)) protectedHashes.Add(referenced);
            }
            foreach (var variant in variants.Where(v => !candidates.Contains(v.Hash)))
                if (variant.Origin?.DonorHash is { } donor) protectedHashes.Add(donor);
            do
            {
                changed = false;
                foreach (var variant in variants.Where(v => protectedHashes.Contains(v.Hash)))
                    if (variant.Origin?.DonorHash is { } donor) changed |= protectedHashes.Add(donor);
            } while (changed);
            var deleted = candidates.Except(protectedHashes).ToHashSet(StringComparer.Ordinal);
            var deletedKeys = variants.Where(v => deleted.Contains(v.Hash)).Select(v => v.Key).ToHashSet(StringComparer.Ordinal);
            foreach (var removedHash in deleted)
            {
                Fence("hash:" + removedHash); Remove("document", removedHash); Remove("raw", removedHash);
                using var retention = c.CreateCommand(); retention.Transaction = tx; retention.CommandText = "DELETE FROM retained_documents WHERE hash=$hash"; retention.Parameters.AddWithValue("$hash", removedHash); retention.ExecuteNonQuery();
            }
            foreach (var record in records)
            {
                using var json = JsonDocument.Parse(record.Payload);
                var refs = Hashes(json.RootElement).ToList();
                if (record.Kind is "preview" or "preview-assessment" && refs.Any(deleted.Contains)) Remove(record.Kind, record.Id);
                if (record.Kind is "variant" or "mixed-origin" && deletedKeys.Contains(record.Id)) Remove(record.Kind, record.Id);
                if (record.Kind == "auxiliary-choice" && (deleted.Contains(record.Id.Split(':').ElementAtOrDefault(1) ?? "") || deletedKeys.Contains(Codec.Deserialize<AuxiliarySelection>(record.Payload)!.Key))) Remove(record.Kind, record.Id);
                if (record.Kind == "job")
                {
                    var job = Codec.Deserialize<Job>(record.Payload)!;
                    if (!deleted.Contains(job.Hash) && !deletedKeys.Contains(job.VariantKey)) continue;
                    job.OutputDeleted = true; job.OutputDeletedAt = now;
                    WriteUnchecked(c, tx, "job", record.Id, job);
                }
            }
            tx.Commit(); return new(!deleted.Contains(hash), cancelled, revision, deleted.Order(StringComparer.Ordinal).ToList());
        }
    }
    private static List<(string Kind, string Id, string Payload)> ReadRecords(SqliteConnection c, SqliteTransaction tx)
    {
        using var cmd = c.CreateCommand(); cmd.Transaction = tx; cmd.CommandText = "SELECT kind,id,payload FROM records";
        using var reader = cmd.ExecuteReader(); var records = new List<(string, string, string)>();
        while (reader.Read()) records.Add((reader.GetString(0), reader.GetString(1), reader.GetString(2))); return records;
    }
}
