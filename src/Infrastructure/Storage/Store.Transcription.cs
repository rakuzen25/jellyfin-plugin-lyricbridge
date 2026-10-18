using Microsoft.Data.Sqlite;

namespace LyricBridge;

public sealed record TranscriptOriginal(Guid ItemId, string TranscriptId, string OutputHash, string VersionId, string? EntryId = null);
public sealed partial class Store : ITranscriptionRepository
{
    public Transcript? Transcript(string id) => Get<Transcript>("transcript", id);
    public List<BoundaryReviewResult> ReviewResults(string transcriptId) => TranscriptionRecords<BoundaryReviewResult>("boundary-review-result", "$.transcriptId", transcriptId);
    public List<BoundaryVersion> BoundaryVersions(string transcriptId) => TranscriptionRecords<BoundaryVersion>("boundary-version", "$.transcriptId", transcriptId);
    private List<T> TranscriptionRecords<T>(string kind, string property, string value)
    {
        using var c = Open(); using var command = c.CreateCommand();
        command.CommandText = "SELECT payload FROM records WHERE kind=$kind AND json_extract(payload,$property)=$value ORDER BY json_extract(payload,'$.created'),id";
        command.Parameters.AddWithValue("$kind", kind); command.Parameters.AddWithValue("$property", property); command.Parameters.AddWithValue("$value", value);
        using var reader = command.ExecuteReader(); var result = new List<T>();
        while (reader.Read()) result.Add(Codec.Deserialize<T>(reader.GetString(0))!); return result;
    }
    public IReadOnlyList<TranscriptSummary> Transcripts(Guid item, Guid user, bool admin)
    {
        using var c = Open(); using var command = c.CreateCommand();
        command.CommandText = """
            SELECT json_extract(t.payload,'$.id'),json_extract(t.payload,'$.userId'),json_extract(t.payload,'$.language'),
              json_extract(t.payload,'$.timing'),json_array_length(t.payload,'$.tokens'),json_extract(t.payload,'$.created'),
              EXISTS(SELECT 1 FROM records o WHERE o.kind='transcript-original' AND json_extract(o.payload,'$.transcriptId')=json_extract(t.payload,'$.id')) AS published,json_extract(t.payload,'$.optionName')
            FROM records t WHERE t.kind='transcript' AND json_extract(t.payload,'$.itemId')=$item
            AND ($admin=1 OR json_extract(t.payload,'$.userId')=$user OR EXISTS(SELECT 1 FROM records o WHERE o.kind='transcript-original' AND json_extract(o.payload,'$.transcriptId')=json_extract(t.payload,'$.id')))
            ORDER BY json_extract(t.payload,'$.created') DESC,t.id
            """;
        command.Parameters.AddWithValue("$item", item.ToString()); command.Parameters.AddWithValue("$user", user.ToString()); command.Parameters.AddWithValue("$admin", admin ? 1 : 0);
        using var reader = command.ExecuteReader(); var result = new List<TranscriptSummary>();
        while (reader.Read()) result.Add(new(reader.GetString(0), Guid.Parse(reader.GetString(1)), reader.GetString(2), reader.GetString(3), reader.GetInt32(4), DateTimeOffset.Parse(reader.GetString(5), System.Globalization.CultureInfo.InvariantCulture), reader.GetInt32(6) != 0, reader.IsDBNull(7) ? null : reader.GetString(7)));
        return result;
    }
    public string SelectionIdentity(Guid item) => Codec.Hash(Codec.Serialize(Selection(item)));
    private bool LiveRemoteJob(SqliteConnection c, SqliteTransaction tx, Job job)
    {
        var current = ReadRecord<Job>(c, tx, "job", job.Id);
        return !IsResetting && current?.State == "running" && !current.OutputDeleted && ValidAdmission(c, tx, new(Epoch, job.DeletionRevision, job.ItemId), [job.Hash]);
    }
    public bool CompleteTranscript(Job job, Transcript? transcript, BoundaryVersion? version)
    {
        lock (writeGate)
        {
            using var c = Open(); using var tx = c.BeginTransaction();
            if (!LiveRemoteJob(c, tx, job) || transcript == null && version == null) return false;
            var source = transcript ?? ReadRecord<Transcript>(c, tx, "transcript", version!.TranscriptId);
            if (source == null || version != null && source.Id != version.TranscriptId || source.ItemId != job.ItemId) return false;
            if (version != null) TranscriptBoundaries.Validate(source, version.EndTokenIds);
            if (transcript != null) WriteRecord(c, tx, "transcript", transcript.Id, transcript);
            if (version != null) WriteRecord(c, tx, "boundary-version", version.Id, ReadRecord<BoundaryVersion>(c, tx, "boundary-version", version.Id) ?? version);
            if (job.TaskKind == "boundary-review" && version != null)
            {
                WriteRecord(c, tx, "boundary-review-result", job.Id, new BoundaryReviewResult(job.Id, source.Id, version.Id, job.Profile, DateTimeOffset.UtcNow, job.Request.OptionName, version.SeamTokenIds, job.Review?.Settings ?? version.Settings));
                WriteRecord(c, tx, "saved-boundary-entry", "review:" + job.Id, new SavedBoundaryEntry("review:" + job.Id, source.Id, version.Id, "AI", job.Review?.Settings ?? version.Settings, DateTimeOffset.UtcNow, version.Algorithm, job.Profile, job.Request.OptionName, version.SeamTokenIds));
                using var checkpoints = c.CreateCommand(); checkpoints.Transaction = tx;
                checkpoints.CommandText = "DELETE FROM records WHERE kind='review-checkpoint' AND json_extract(payload,'$.jobId')=$id";
                checkpoints.Parameters.AddWithValue("$id", job.Id); checkpoints.ExecuteNonQuery();
            }
            job.ResultId = source.Id; job.State = "complete"; job.Stage = "Ready for review"; job.Progress = 100;
            WriteRecord(c, tx, "job", job.Id, job); tx.Commit(); return true;
        }
    }
    public RichLyrics CommitBoundary(Guid item, Transcript transcript, BoundaryVersion version, string expectedSelection, string? entryId = null)
    {
        var lyrics = TranscriptBoundaries.Compose(transcript, version.EndTokenIds, transcript.Title, transcript.Artist);
        lock (writeGate)
        {
            using var c = Open(); using var tx = c.BeginTransaction(); RequireAdmission(c, tx, [transcript.Id, lyrics.Hash]);
            var stored = ReadRecord<Transcript>(c, tx, "transcript", transcript.Id);
            if (stored is null || stored.ItemId != item || Codec.Serialize(stored.Tokens) != Codec.Serialize(transcript.Tokens)) throw DeletedConflict();
            if (Codec.Hash(Codec.Serialize(ReadSelection(c, tx, item.ToString("N")))) != expectedSelection)
                throw new WorkflowException(409, "lyric_version_changed", "The selected original changed. Refresh the selection baseline, then review before applying.", true);
            WriteRecord(c, tx, "boundary-version", version.Id, ReadRecord<BoundaryVersion>(c, tx, "boundary-version", version.Id) ?? version);
            var entry = SaveEntry(c, tx, transcript, version, entryId);
            WriteSelection(c, tx, item.ToString("N"), new(lyrics, null), new(transcript.Text, RawResponse: Codec.Serialize(new { transcriptId = transcript.Id, boundaryVersionId = version.Id, savedEntryId = entry.Id, entry.Origin, entry.Settings })));
            WriteRecord(c, tx, "transcript-original", item.ToString("N") + ":" + lyrics.Hash, new TranscriptOriginal(item, transcript.Id, lyrics.Hash, version.Id, entry.Id));
            tx.Commit(); return lyrics;
        }
    }
    public IReadOnlyList<string> DeleteTranscript(Guid item, string id, Guid user, bool admin)
    {
        lock (writeGate)
        {
            using var c = Open(); using var tx = c.BeginTransaction(); RequireAdmission(c, tx, [id]);
            var transcript = ReadRecord<Transcript>(c, tx, "transcript", id) ?? throw new WorkflowException(404, "transcript_unavailable", "This transcription is no longer available.");
            if (transcript.ItemId != item || !admin && transcript.UserId != user) throw new WorkflowException(403, "permission_denied", "You cannot delete this transcription.");
            var records = ReadRecords(c, tx);
            var deletion = Deletion(c, tx, transcript, null, user, admin);
            if (!deletion.Allowed) throw new WorkflowException(409, "transcript_in_use", deletion.Reason!);
            var revision = ReadRevision(c, tx) + 1;
            using (var clock = c.CreateCommand()) { clock.Transaction = tx; clock.CommandText = "UPDATE deletion_clock SET revision=$revision WHERE id=1; INSERT INTO deletion_revisions VALUES($scope,$revision) ON CONFLICT(scope) DO UPDATE SET revision=excluded.revision"; clock.Parameters.AddWithValue("$revision", revision); clock.Parameters.AddWithValue("$scope", "hash:" + id); clock.ExecuteNonQuery(); }
            WriteUnchecked<object>(c, tx, "transcript", id, null);
            var cancelled = new List<string>();
            foreach (var record in records)
            {
                if (record.Kind == "saved-boundary-entry" && Codec.Deserialize<SavedBoundaryEntry>(record.Payload)!.TranscriptId == id) WriteUnchecked<object>(c, tx, record.Kind, record.Id, null);
                if (record.Kind == "boundary-review-result" && Codec.Deserialize<BoundaryReviewResult>(record.Payload)!.TranscriptId == id) WriteUnchecked<object>(c, tx, record.Kind, record.Id, null);
                if (record.Kind == "boundary-version" && Codec.Deserialize<BoundaryVersion>(record.Payload)!.TranscriptId == id) WriteUnchecked<object>(c, tx, record.Kind, record.Id, null);
                if (record.Kind != "job") continue;
                var job = Codec.Deserialize<Job>(record.Payload)!;
                if (job.Hash != id && job.ResultId != id) continue;
                if (job.State is "pending" or "queued" or "running") job.State = "cancelled";
                cancelled.Add(job.Id);
                job.OutputDeleted = true; job.OutputDeletedAt = DateTimeOffset.UtcNow;
                WriteUnchecked(c, tx, "job", job.Id, job);
            }
            using var checkpoints = c.CreateCommand(); checkpoints.Transaction = tx;
            checkpoints.CommandText = "DELETE FROM records WHERE kind='review-checkpoint' AND json_extract(payload,'$.transcriptId')=$id";
            checkpoints.Parameters.AddWithValue("$id", id); checkpoints.ExecuteNonQuery();
            tx.Commit(); return cancelled;
        }
    }
    public List<ReviewCheckpoint> ReviewCheckpoints(string jobId) => TranscriptionRecords<ReviewCheckpoint>("review-checkpoint", "$.jobId", jobId).OrderBy(c => c.Index).ToList();
    public void SaveReviewCheckpoint(Job job, ReviewCheckpoint checkpoint)
    {
        lock (writeGate)
        {
            using var c = Open(); using var tx = c.BeginTransaction();
            if (!LiveRemoteJob(c, tx, job)) throw new OperationCanceledException();
            WriteRecord(c, tx, "review-checkpoint", checkpoint.Id, checkpoint); tx.Commit();
        }
    }
    public void DiscardReviewCheckpoints(string jobId)
    {
        lock (writeGate)
        {
            using var c = Open(); using var command = c.CreateCommand();
            command.CommandText = "DELETE FROM records WHERE kind='review-checkpoint' AND json_extract(payload,'$.jobId')=$job";
            command.Parameters.AddWithValue("$job", jobId); command.ExecuteNonQuery();
        }
    }
    public bool AudioUploadInUse(string id, string completedJob)
    {
        using var c = Open(); using var command = c.CreateCommand();
        command.CommandText = "SELECT EXISTS(SELECT 1 FROM records WHERE kind='job' AND id<>$job AND json_extract(payload,'$.audio.uploadId')=$upload AND (json_extract(payload,'$.state') IN ('pending','queued','running') OR (json_extract(payload,'$.state') IN ('failed','settings_changed') AND json_extract(payload,'$.created')>$since)))";
        command.Parameters.AddWithValue("$job", completedJob); command.Parameters.AddWithValue("$upload", id); command.Parameters.AddWithValue("$since", UtcTimestampConverter.Format(DateTime.UtcNow.AddDays(-7)));
        return Convert.ToInt32(command.ExecuteScalar()) != 0;
    }
    public void DiscardChunks(string jobId)
    {
        lock (writeGate)
        {
            using var c = Open(); using var command = c.CreateCommand();
            command.CommandText = "DELETE FROM records WHERE kind='transcript-chunk' AND json_extract(payload,'$.jobId')=$job";
            command.Parameters.AddWithValue("$job", jobId); command.ExecuteNonQuery();
        }
    }
    public List<TranscriptChunk> Chunks(string jobId) => TranscriptionRecords<TranscriptChunk>("transcript-chunk", "$.jobId", jobId).OrderBy(c => c.Index).ToList();
    public void SaveChunk(Job job, TranscriptChunk chunk)
    {
        lock (writeGate)
        {
            using var c = Open(); using var tx = c.BeginTransaction();
            if (!LiveRemoteJob(c, tx, job)) throw new OperationCanceledException();
            WriteRecord(c, tx, "transcript-chunk", chunk.Id, chunk); tx.Commit();
        }
    }
}
