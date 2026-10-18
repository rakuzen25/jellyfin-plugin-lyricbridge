using Microsoft.Data.Sqlite;

namespace LyricBridge;

public sealed partial class Store
{
    private const string ActiveStates = "('pending','queued','running')";

    private static void PrepareJobWrite(SqliteConnection connection, SqliteTransaction transaction, string id, Job job)
    {
        var previous = ReadRecord<Job>(connection, transaction, "job", id);
        var now = DateTimeOffset.UtcNow;
        if (!JobLifecycle.Terminal(job.State)) job.TerminalAt = null;
        else if (previous?.State == job.State) job.TerminalAt = previous.TerminalAt ?? now;
        else job.TerminalAt = previous == null ? job.TerminalAt ?? now : now;
        if (previous?.TerminalAt <= DateTimeOffset.UtcNow.AddDays(-7) && !JobLifecycle.Terminal(job.State))
        {
            using var expired = connection.CreateCommand(); expired.Transaction = transaction;
            expired.CommandText = "DELETE FROM records WHERE kind='review-checkpoint' AND json_extract(payload,'$.jobId')=$id";
            expired.Parameters.AddWithValue("$id", id); expired.ExecuteNonQuery();
        }
        if (job.Created > DateTime.UtcNow.AddHours(-24))
        {
            using var admission = connection.CreateCommand(); admission.Transaction = transaction;
            admission.CommandText = "INSERT OR IGNORE INTO records(kind,id,payload) VALUES('job-admission',$id,$payload)";
            admission.Parameters.AddWithValue("$id", id); admission.Parameters.AddWithValue("$payload", Codec.Serialize(new { job.UserId, created = UtcTimestampConverter.Format(job.Created) })); admission.ExecuteNonQuery();
        }
    }

    public Job? GetJob(string id) => Get<Job>("job", id);

    public IReadOnlyList<Job> JobHistory(Guid? user, int offset, int limit)
    {
        if (offset < 0 || limit is < 1 or > 500) throw new ArgumentOutOfRangeException(nameof(limit));
        return QueryJobs(
            (user.HasValue ? " AND json_extract(payload,'$.userId')=$user" : "") +
            " ORDER BY json_extract(payload,'$.created') DESC,id DESC LIMIT $limit OFFSET $offset",
            ("$user", user?.ToString()), ("$limit", limit), ("$offset", offset));
    }

    public IReadOnlyList<Job> ActiveJobs(Guid? user = null) => QueryJobs(
        " AND json_extract(payload,'$.state') IN " + ActiveStates +
        (user.HasValue ? " AND json_extract(payload,'$.userId')=$user" : "") +
        " ORDER BY json_extract(payload,'$.created'),id", ("$user", user?.ToString()));

    public Job? FindActiveJob(Guid user, string cacheKey) => QueryJobs(
        " AND json_extract(payload,'$.userId')=$user AND json_extract(payload,'$.state') IN " + ActiveStates +
        " AND json_extract(payload,'$.cacheKey')=$cache LIMIT 1",
        ("$user", user.ToString()), ("$cache", cacheKey)).FirstOrDefault();

    public int CountAdmissions(Guid user, DateTime since)
    {
        using var c = Open(); using var command = c.CreateCommand();
        command.CommandText = "SELECT count(*) FROM records WHERE kind='job-admission' AND json_extract(payload,'$.userId')=$user AND json_extract(payload,'$.created')>$since";
        command.Parameters.AddWithValue("$user", user.ToString()); command.Parameters.AddWithValue("$since", UtcTimestampConverter.Format(since));
        return Convert.ToInt32(command.ExecuteScalar());
    }

    public int CountActiveJobs(Guid user) => CountJobs(
        " AND json_extract(payload,'$.state') IN " + ActiveStates, user);

    public IReadOnlyList<Job> RemoveFinishedJobs(IReadOnlyList<string> ids, Guid? user = null, DateTimeOffset? before = null)
    {
        lock (writeGate)
        {
            if (IsResetting) return [];
            using var c = Open(); using var tx = c.BeginTransaction(); var removed = new List<Job>();
            foreach (var id in ids.Distinct())
            {
                var job = ReadRecord<Job>(c, tx, "job", id);
                if (job == null || !JobLifecycle.Terminal(job.State) || user.HasValue && job.UserId != user || before.HasValue && (job.TerminalAt == null || job.TerminalAt > before)) continue;
                // Preserve quota accounting even when removing legacy history immediately.
                using var ledger = c.CreateCommand(); ledger.Transaction = tx;
                ledger.CommandText = "INSERT OR IGNORE INTO records SELECT 'job-admission',id,json_object('userId',json_extract(payload,'$.userId'),'created',json_extract(payload,'$.created')) FROM records WHERE kind='job' AND id=$id AND json_extract(payload,'$.created')>$since";
                ledger.Parameters.AddWithValue("$id", id); ledger.Parameters.AddWithValue("$since", UtcTimestampConverter.Format(DateTime.UtcNow.AddHours(-24))); ledger.ExecuteNonQuery();
                WriteUnchecked<object>(c, tx, "job", id, null);
                using var chunks = c.CreateCommand(); chunks.Transaction = tx;
                chunks.CommandText = "DELETE FROM records WHERE kind IN ('review-checkpoint','transcript-chunk') AND json_extract(payload,'$.jobId')=$id";
                chunks.Parameters.AddWithValue("$id", id); chunks.ExecuteNonQuery(); removed.Add(job);
            }
            tx.Commit(); return removed;
        }
    }
    public IReadOnlyList<Job> ExpireJobHistory(DateTimeOffset now)
    {
        var jobs = QueryJobs(" AND json_extract(payload,'$.terminalAt') IS NOT NULL AND julianday(json_extract(payload,'$.terminalAt'))<=julianday($before)", ("$before", now.AddDays(-30).ToString("O"))).Select(j => j.Id).ToList();
        var removed = RemoveFinishedJobs(jobs, before: now.AddDays(-30));
        lock (writeGate)
        {
            if (IsResetting) return removed;
            using var c = Open(); using var command = c.CreateCommand();
            command.CommandText = "DELETE FROM records WHERE kind='job-admission' AND json_extract(payload,'$.created')<=$quota; DELETE FROM records WHERE kind='review-checkpoint' AND NOT EXISTS (SELECT 1 FROM records j WHERE j.kind='job' AND j.id=json_extract(records.payload,'$.jobId') AND (json_extract(j.payload,'$.state') IN ('pending','queued','running') OR (json_extract(j.payload,'$.state') IN ('failed','settings_changed') AND julianday(json_extract(j.payload,'$.terminalAt'))>julianday($retry))))";
            command.Parameters.AddWithValue("$quota", UtcTimestampConverter.Format(now.UtcDateTime.AddHours(-24))); command.Parameters.AddWithValue("$retry", now.AddDays(-7).ToString("O")); command.ExecuteNonQuery();
        }
        return removed;
    }

    private int CountJobs(string predicate, Guid user, params (string Name, object? Value)[] parameters)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT count(*) FROM records WHERE kind='job' AND json_extract(payload,'$.userId')=$user" + predicate;
        command.Parameters.AddWithValue("$user", user.ToString());
        Bind(command, parameters);
        return Convert.ToInt32(command.ExecuteScalar());
    }

    private List<Job> QueryJobs(string predicate, params (string Name, object? Value)[] parameters)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT payload FROM records WHERE kind='job'" + predicate;
        Bind(command, parameters);
        using var reader = command.ExecuteReader();
        var jobs = new List<Job>();
        while (reader.Read()) jobs.Add(Codec.Deserialize<Job>(reader.GetString(0))!);
        return jobs;
    }

    private static void Bind(SqliteCommand command, IEnumerable<(string Name, object? Value)> parameters)
    {
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value ?? DBNull.Value);
    }
}
