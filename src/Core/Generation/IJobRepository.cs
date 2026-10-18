namespace LyricBridge;

public interface IJobRepository
{
    Job? GetJob(string id);
    IReadOnlyList<Job> JobHistory(Guid? user, int offset, int limit);
    IReadOnlyList<Job> ActiveJobs(Guid? user = null);
    Job? FindActiveJob(Guid user, string cacheKey);
    int CountAdmissions(Guid user, DateTime since);
    int CountActiveJobs(Guid user);
    IReadOnlyList<Job> RemoveFinishedJobs(IReadOnlyList<string> ids, Guid? user = null, DateTimeOffset? before = null);
}
