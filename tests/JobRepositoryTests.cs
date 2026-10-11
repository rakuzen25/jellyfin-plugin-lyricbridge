using LyricBridge;
using Microsoft.Data.Sqlite;
using Xunit;

public sealed class JobRepositoryTests
{
    [Fact]
    public void LargeHistoryUsesBoundedQueriesAndCorrectAdmissions()
    {
        var directory = Path.Combine(Path.GetTempPath(), "lyricbridge-jobs-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new Store(directory);
            var user = Guid.NewGuid(); var other = Guid.NewGuid(); var now = DateTime.UtcNow;
            // Initialize the schema before bulk fixture insertion.
            store.JobHistory(user, 0, 1);
            using (var connection = new SqliteConnection("Data Source=" + Path.Combine(directory, "index.sqlite")))
            {
                connection.Open(); using var transaction = connection.BeginTransaction();
                using var command = connection.CreateCommand(); command.Transaction = transaction;
                command.CommandText = "INSERT INTO records(kind,id,payload) VALUES('job',$id,$payload)";
                var id = command.Parameters.Add("$id", SqliteType.Text); var payload = command.Parameters.Add("$payload", SqliteType.Text);
                for (var index = 0; index < 10000; index++)
                {
                    var job = new Job { Id = index.ToString("D5"), UserId = user, Created = now.AddDays(-2).AddSeconds(index), State = "complete" };
                    id.Value = job.Id; payload.Value = Codec.Serialize(job); command.ExecuteNonQuery();
                }
                transaction.Commit();
            }
            store.Put("job", "active", new Job { Id = "active", UserId = user, Created = now, State = "queued", CacheKey = "key" });
            store.Put("job", "other", new Job { Id = "other", UserId = other, Created = now, State = "running", CacheKey = "key" });
            var boundary = new DateTime(2026, 10, 10, 12, 0, 0, DateTimeKind.Utc);
            store.Put("job", "fraction-short", new Job { Id = "fraction-short", UserId = other, Created = boundary.AddMilliseconds(100), State = "complete" });
            store.Put("job", "fraction-long", new Job { Id = "fraction-long", UserId = other, Created = boundary.AddMilliseconds(110), State = "complete" });
            var fractions = store.JobHistory(other, 0, 10).Where(j => j.Id.StartsWith("fraction")).Select(j => j.Id);
            Assert.Equal(new[] { "fraction-long", "fraction-short" }, fractions);
            Assert.Single(store.ActiveJobs(user));
            Assert.Equal(1, store.CountAdmissions(user, now.AddHours(-24)));
            Assert.Equal(1, store.CountActiveJobs(user));
            Assert.Equal("active", store.FindActiveJob(user, "key")?.Id);
            var first = store.JobHistory(user, 0, 25); var second = store.JobHistory(user, 25, 25);
            Assert.Equal(25, first.Count); Assert.Equal(25, second.Count);
            Assert.Empty(first.Select(j => j.Id).Intersect(second.Select(j => j.Id)));
            Assert.All(first, j => Assert.Equal(user, j.UserId));
            Assert.Throws<ArgumentOutOfRangeException>(() => store.JobHistory(user, 0, 501));
            using (var connection = new SqliteConnection("Data Source=" + Path.Combine(directory, "index.sqlite")))
            {
                connection.Open(); using var command = connection.CreateCommand();
                command.CommandText = "EXPLAIN QUERY PLAN SELECT count(*) FROM records WHERE kind='job' AND json_extract(payload,'$.userId')=$user AND json_extract(payload,'$.created')>$since";
                command.Parameters.AddWithValue("$user", user.ToString()); command.Parameters.AddWithValue("$since", now.AddHours(-24).ToString("O"));
                using var reader = command.ExecuteReader(); var plan = ""; while (reader.Read()) plan += reader.GetString(3);
                Assert.Contains("jobs_user_created", plan);
            }
        }
        finally { SqliteConnection.ClearAllPools(); if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
}
