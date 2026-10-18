using Microsoft.Data.Sqlite;

namespace LyricBridge;

public sealed partial class Store
{
    public List<SavedBoundaryEntry> SavedEntries(string transcriptId) => TranscriptionRecords<SavedBoundaryEntry>("saved-boundary-entry", "$.transcriptId", transcriptId);

    private static DeletionCapability Deletion(SqliteConnection c, SqliteTransaction tx, Transcript source, SavedBoundaryEntry? entry, Guid user, bool admin)
    {
        var records = ReadRecords(c, tx);
        var originals = records.Where(r => r.Kind == "transcript-original").Select(r => Codec.Deserialize<TranscriptOriginal>(r.Payload)!)
            .Where(o => o.TranscriptId == source.Id && (entry == null || o.VersionId == entry.VersionId)).Select(o => new OriginalDependency(o.ItemId, o.OutputHash)).ToList();
        var requests = entry == null ? [] : records.Where(r => r.Kind == "job").Select(r => Codec.Deserialize<Job>(r.Payload)!)
            .Where(j => j.State is "pending" or "queued" or "running" && j.Review is { Snapshot: null } review && review.TranscriptId == source.Id && review.VersionId == entry.VersionId).Select(j => j.Id).ToList();
        var reason = !admin && source.UserId != user ? "Only the owner or an administrator can delete this result."
            : originals.Count > 0 ? "Used by saved originals: " + string.Join(", ", originals.Select(o => o.ItemId + " / " + o.OutputHash)) + ". Delete those originals first."
            : requests.Count > 0 ? "Required by active legacy review requests: " + string.Join(", ", requests) + ". Finish or cancel them first." : null;
        return new(reason == null, reason, originals, requests);
    }
    public DeletionCapability Deletion(string transcriptId, string? entryId, Guid user, bool admin)
    {
        using var c = Open(); using var tx = c.BeginTransaction();
        var source = ReadRecord<Transcript>(c, tx, "transcript", transcriptId) ?? throw DeletedConflict();
        var entry = entryId == null ? null : ReadRecord<SavedBoundaryEntry>(c, tx, "saved-boundary-entry", entryId) ?? throw DeletedConflict();
        if (entry != null && entry.TranscriptId != transcriptId) throw DeletedConflict();
        return Deletion(c, tx, source, entry, user, admin);
    }
    private static WorkflowException EntryUnavailable() => new(409, "line_breaks_deleted", "These saved line breaks were deleted. Your draft is retained; refresh the saved list before saving again.", true);
    private void RequireEntryAdmission(SqliteConnection c, SqliteTransaction tx, string id)
    {
        RequireAdmission(c, tx);
        if (admission.Value is { } ticket && !ValidAdmission(c, tx, ticket, ["entry:" + id])) throw EntryUnavailable();
    }
    private static string EntryIdentity(Transcript source, BoundaryVersion version) => Codec.Hash(Codec.Serialize(new { transcriptId = source.Id, versionId = version.Id, version.Origin, version.Settings, version.Algorithm }));
    private SavedBoundaryEntry SaveEntry(SqliteConnection c, SqliteTransaction tx, Transcript source, BoundaryVersion version, string? selectedEntry)
    {
        var id = selectedEntry ?? EntryIdentity(source, version);
        RequireAdmission(c, tx, [source.Id]); RequireEntryAdmission(c, tx, id);
        var stored = ReadRecord<Transcript>(c, tx, "transcript", source.Id);
        if (stored == null || stored.ItemId != source.ItemId || Codec.Serialize(stored.Tokens) != Codec.Serialize(source.Tokens)) throw DeletedConflict();
        var existing = ReadRecord<SavedBoundaryEntry>(c, tx, "saved-boundary-entry", id);
        if (selectedEntry != null && (existing == null || existing.TranscriptId != source.Id)) throw EntryUnavailable();
        if (existing != null && existing.VersionId == version.Id && existing.Settings == version.Settings) return existing;
        id = EntryIdentity(source, version);
        RequireEntryAdmission(c, tx, id);
        existing = ReadRecord<SavedBoundaryEntry>(c, tx, "saved-boundary-entry", id);
        if (existing != null) return existing;
        var entry = new SavedBoundaryEntry(id, source.Id, version.Id, version.Origin, version.Settings, DateTimeOffset.UtcNow, version.Algorithm, version.Profile, version.OptionName, version.SeamTokenIds);
        WriteRecord(c, tx, "boundary-version", version.Id, ReadRecord<BoundaryVersion>(c, tx, "boundary-version", version.Id) ?? version);
        WriteRecord(c, tx, "saved-boundary-entry", id, entry); return entry;
    }
    public SavedBoundaryEntry SaveEntry(Transcript source, BoundaryVersion version, Guid user, bool admin, string? selectedEntry = null)
    {
        TranscriptBoundaries.Validate(source, version.EndTokenIds);
        lock (writeGate)
        {
            using var c = Open(); using var tx = c.BeginTransaction();
            var stored = ReadRecord<Transcript>(c, tx, "transcript", source.Id) ?? throw DeletedConflict();
            if (!admin && stored.UserId != user) throw new WorkflowException(403, "permission_denied", "Only the owner or an administrator can save line breaks.");
            var entry = SaveEntry(c, tx, source, version, selectedEntry); tx.Commit(); return entry;
        }
    }
    public void DeleteEntry(Guid item, string transcriptId, string entryId, Guid user, bool admin)
    {
        lock (writeGate)
        {
            using var c = Open(); using var tx = c.BeginTransaction(); RequireAdmission(c, tx, [transcriptId]); RequireEntryAdmission(c, tx, entryId);
            var source = ReadRecord<Transcript>(c, tx, "transcript", transcriptId) ?? throw DeletedConflict();
            var entry = ReadRecord<SavedBoundaryEntry>(c, tx, "saved-boundary-entry", entryId) ?? throw DeletedConflict();
            if (source.ItemId != item || entry.TranscriptId != source.Id) throw DeletedConflict();
            var capability = Deletion(c, tx, source, entry, user, admin);
            if (!capability.Allowed) throw new WorkflowException(!admin && source.UserId != user ? 403 : 409, "entry_in_use", capability.Reason!);
            var revision = ReadRevision(c, tx) + 1;
            using (var clock = c.CreateCommand())
            {
                clock.Transaction = tx; clock.CommandText = "UPDATE deletion_clock SET revision=$revision WHERE id=1; INSERT INTO deletion_revisions VALUES($scope,$revision) ON CONFLICT(scope) DO UPDATE SET revision=excluded.revision";
                clock.Parameters.AddWithValue("$revision", revision); clock.Parameters.AddWithValue("$scope", "hash:entry:" + entryId); clock.ExecuteNonQuery();
            }
            WriteUnchecked<object>(c, tx, "saved-boundary-entry", entryId, null);
            if (entryId.StartsWith("review:", StringComparison.Ordinal)) WriteUnchecked<object>(c, tx, "boundary-review-result", entryId[7..], null);
            var records = ReadRecords(c, tx);
            var needed = records.Any(r => r.Kind == "saved-boundary-entry" && Codec.Deserialize<SavedBoundaryEntry>(r.Payload)!.VersionId == entry.VersionId)
                || records.Any(r => r.Kind == "transcript-original" && Codec.Deserialize<TranscriptOriginal>(r.Payload)!.VersionId == entry.VersionId)
                || records.Any(r => r.Kind == "job" && Codec.Deserialize<Job>(r.Payload) is { State: "pending" or "queued" or "running", Review: { Snapshot: null } review } && review.VersionId == entry.VersionId);
            if (!needed) WriteUnchecked<object>(c, tx, "boundary-version", entry.VersionId, null);
            tx.Commit();
        }
    }
}
