using LyricBridge;
using Microsoft.Data.Sqlite;
using Xunit;

public sealed class JobLifecycleTests : StorageFixture
{
    [Theory]
    [InlineData("language", "complete")]
    [InlineData("language", "failed")]
    [InlineData("transcription", "cancelled")]
    [InlineData("boundary-review", "rejected")]
    [InlineData("language", "settings_changed")]
    public void HistoryRemovalKeepsQuotaAndResultsAndRejectsLateWrites(string task, string state)
    {
        using var store = new Store(Root);
        var user = Guid.NewGuid(); var job = new Job { UserId = user, State = state, TaskKind = task, Hash = "source" };
        store.Put("job", job.Id, job); store.Put("variant", "result", new Variant("result", "source", "translation", "en", "AI", "fixture", new()));
        store.Put("review-checkpoint", job.Id + ":0", new ReviewCheckpoint(job.Id + ":0", job.Id, "source", 0, "identity", ["t0"], "{}"));
        Assert.Equal(1, store.CountAdmissions(user, DateTime.UtcNow.AddHours(-24)));
        Assert.Single(store.RemoveFinishedJobs([job.Id], user));
        Assert.Null(store.GetJob(job.Id)); Assert.NotNull(store.GetVariant("result")); Assert.Empty(store.ReviewCheckpoints(job.Id));
        Assert.Equal(1, store.CountAdmissions(user, DateTime.UtcNow.AddHours(-24)));
        job.State = "failed"; store.SaveJob(job); Assert.Null(store.GetJob(job.Id));
        Assert.False(store.PersistRequest(job, store.Epoch, requireExisting: true));
    }
    [Fact]
    public void CleanupUsesTerminalTimeAndNeverRemovesActiveOrOtherOwners()
    {
        using var store = new Store(Root); var now = DateTimeOffset.UtcNow; var user = Guid.NewGuid();
        var expired = new Job { UserId = user, State = "failed", Created = now.UtcDateTime.AddDays(-100), TerminalAt = now.AddDays(-31) };
        var recent = new Job { UserId = user, State = "complete", Created = now.UtcDateTime.AddDays(-100), TerminalAt = now.AddDays(-29) };
        var active = new Job { UserId = user, State = "running", Created = now.UtcDateTime.AddDays(-100) };
        foreach (var job in new[] { expired, recent, active }) store.Put("job", job.Id, job);
        Assert.Empty(store.RemoveFinishedJobs([expired.Id], Guid.NewGuid()));
        Assert.Equal(expired.Id, Assert.Single(store.ExpireJobHistory(now)).Id);
        Assert.NotNull(store.GetJob(recent.Id)); Assert.NotNull(store.GetJob(active.Id));
        active.State = "queued"; store.SaveJob(active); Assert.Empty(store.RemoveFinishedJobs([active.Id]));
        recent.State = "queued"; store.SaveJob(recent); Assert.Null(store.GetJob(recent.Id)!.TerminalAt);
        recent.State = "failed"; store.SaveJob(recent); Assert.True(store.GetJob(recent.Id)!.TerminalAt > now.AddMinutes(-1));
    }

    [Fact]
    public void ReviewCheckpointsExpireAfterFailureAndAreClearedBeforeLateRetry()
    {
        using var store = new Store(Root); var now = DateTimeOffset.UtcNow;
        var expired = new Job { State = "failed", TerminalAt = now.AddDays(-8) }; var active = new Job { State = "running" };
        foreach (var job in new[] { expired, active })
        {
            store.Put("job", job.Id, job); store.Put("review-checkpoint", job.Id, new ReviewCheckpoint(job.Id, job.Id, "source", 0, "identity", ["t0"], "{}"));
        }
        store.ExpireJobHistory(now); Assert.Empty(store.ReviewCheckpoints(expired.Id)); Assert.Single(store.ReviewCheckpoints(active.Id));
        store.Put("review-checkpoint", expired.Id, new ReviewCheckpoint(expired.Id, expired.Id, "source", 0, "identity", ["t0"], "{}"));
        expired.State = "queued"; store.SaveJob(expired); Assert.Empty(store.ReviewCheckpoints(expired.Id));
        Assert.Null(store.GetJob(expired.Id)!.TerminalAt);
    }
}
