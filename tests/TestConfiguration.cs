using LyricBridge;

// Fixtures own process-wide SQLite pools and the Jellyfin plugin singleton.
[assembly: Xunit.v3.Parallelization(Mode = Xunit.Sdk.ParallelMode.None)]
public static class TestConfiguration
{
    public static GenerationPolicy Policy()
    {
        var c = Plugin.Instance.Configuration;
        return new(c.AllowUserRequests, c.AutoApproveUserRequests, c.UserRequestDailyQuota, c.UserRequestActiveCap);
    }
}
