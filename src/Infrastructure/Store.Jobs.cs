using Microsoft.Data.Sqlite;

namespace LyricBridge;

public sealed partial class Store
{
    private const string ActiveStates = "('pending','queued','running')";

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

    public int CountAdmissions(Guid user, DateTime since) => CountJobs(
        " AND json_extract(payload,'$.created')>$since", user,
        ("$since", UtcTimestampConverter.Format(since)));

    public int CountActiveJobs(Guid user) => CountJobs(
        " AND json_extract(payload,'$.state') IN " + ActiveStates, user);

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
