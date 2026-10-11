using LyricBridge;

// Fixtures own process-wide SQLite pools and the Jellyfin plugin singleton.
[assembly: Xunit.CollectionBehavior(DisableTestParallelization = true)]
public static class TestConfiguration
{
    public static GenerationPolicy Policy()
    {
        var c = Plugin.Instance.Configuration;
        return new(c.AllowUserRequests, c.AutoApproveUserRequests, c.UserRequestDailyQuota, c.UserRequestActiveCap);
    }
}
