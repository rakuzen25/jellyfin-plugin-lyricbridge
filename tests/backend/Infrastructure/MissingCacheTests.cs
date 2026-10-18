using LyricBridge;
using Lyricify.Lyrics.Models;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Logging;
using Xunit;

public sealed class MissingCacheTests
{
    [Fact]
    public async Task MissesSuppressRequestsUntilExactlyTenMinutesAndResetAllowsRetry()
    {
        var root = Path.Combine(Path.GetTempPath(), "lyricbridge-misses-" + Guid.NewGuid().ToString("N"));
        var clock = new ManualTimeProvider();
        var source = new FakeSource("QQ", null) { Missing = true };
        var retrieval = new Retrieval(new Store(root), ProviderRegistry.WithSources(source), NullLogger<Retrieval>.Instance, timeProvider: clock);
        var track = new TrackMultiArtistMetadata { Title = "fixture", Artists = ["artist"] };
        var item = Guid.NewGuid();
        try
        {
            await retrieval.Get(item, track, false, TestContext.Current.CancellationToken);
            clock.Advance(TimeSpan.FromMinutes(10) - TimeSpan.FromTicks(1));
            Assert.Equal(0, retrieval.ExpireMissingCache());
            await retrieval.Get(item, track, false, TestContext.Current.CancellationToken);
            Assert.Equal(1, source.Searches);
            clock.Advance(TimeSpan.FromTicks(1));
            Assert.Equal(1, retrieval.ExpireMissingCache());
            await retrieval.Get(item, track, false, TestContext.Current.CancellationToken);
            Assert.Equal(2, source.Searches);
            Assert.Equal(0, retrieval.ExpireMissingCache());
            retrieval.ClearMissingCache();
            await retrieval.Get(item, track, false, TestContext.Current.CancellationToken);
            Assert.Equal(3, source.Searches);
        }
        finally { StorageFixture.ClearDatabasePools(root); Directory.Delete(root, true); }
    }

    [Fact]
    public async Task RenewedMissesSurviveTheOldExpiryAndCancelledRequestsDoNotCache()
    {
        await using var host = new StorageFixture();
        var store = host.Own(new Store(Path.Combine(host.Root, "misses")));
        var clock = new ManualTimeProvider();
        var source = new FakeSource("QQ", null) { Missing = true };
        var retrieval = new Retrieval(store, ProviderRegistry.WithSources(source), NullLogger<Retrieval>.Instance, timeProvider: clock);
        var item = Guid.NewGuid();
        var track = new TrackMultiArtistMetadata { Title = "fixture", Artists = ["artist"] };
        await retrieval.Get(item, track, false, TestContext.Current.CancellationToken);
        clock.Advance(TimeSpan.FromMinutes(9));
        await retrieval.Get(item, track, true, TestContext.Current.CancellationToken);
        clock.Advance(TimeSpan.FromMinutes(1));
        Assert.Equal(0, retrieval.ExpireMissingCache());
        await retrieval.Get(item, track, false, TestContext.Current.CancellationToken);
        Assert.Equal(2, source.Searches);
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => retrieval.Get(Guid.NewGuid(), track, false, cancellation.Token));
        clock.Advance(TimeSpan.FromMinutes(9));
        Assert.Equal(1, retrieval.ExpireMissingCache());
    }

    [Fact]
    public async Task MaintenanceExpiresIdleMissesAndStopsWithoutAnotherTick()
    {
        var root = Path.Combine(Path.GetTempPath(), "lyricbridge-maintenance-" + Guid.NewGuid().ToString("N"));
        var clock = new ManualTimeProvider();
        var store = new Store(root);
        var source = new FakeSource("QQ", null) { Missing = true };
        var retrieval = new Retrieval(store, ProviderRegistry.WithSources(source), NullLogger<Retrieval>.Instance, timeProvider: clock);
        var logger = new MaintenanceLogger();
        using var maintenance = new TransientMaintenance(store, retrieval, logger, clock);
        try
        {
            await retrieval.Get(Guid.NewGuid(), new()
            {
                Title = "fixture",
                Artists = ["artist"]
            }, false, TestContext.Current.CancellationToken);
            await maintenance.StartAsync(TestContext.Current.CancellationToken);
            await clock.TimerCreated.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
            clock.Advance(TimeSpan.FromMinutes(10));
            await logger.Removed.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
            await maintenance.StopAsync(TestContext.Current.CancellationToken);
            Assert.Equal(0, retrieval.ExpireMissingCache());
            Assert.Equal(1, source.Searches);
        }
        finally { await maintenance.StopAsync(CancellationToken.None); StorageFixture.ClearDatabasePools(root); Directory.Delete(root, true); }
    }
}

public sealed class ManualTimeProvider : TimeProvider
{
    private readonly object gate = new();
    private DateTimeOffset now = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
    private readonly List<ManualTimer> timers = [];
    public TaskCompletionSource TimerCreated { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public override DateTimeOffset GetUtcNow()
    {
        lock (gate)
            return now;
    }
    public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
    {
        lock (gate)
        {
            var timer = new ManualTimer(this, callback, state);
            timer.Change(dueTime, period);
            timers.Add(timer);
            TimerCreated.TrySetResult();
            return timer;
        }
    }
    public void Advance(TimeSpan elapsed)
    {
        ManualTimer[] due;
        lock (gate)
        {
            now += elapsed;
            due = timers.Where(t => t.Next <= now).ToArray();
            foreach (var timer in due)
                timer.Next = timer.Period == Timeout.InfiniteTimeSpan ? DateTimeOffset.MaxValue : now + timer.Period;
        }
        foreach (var timer in due)
            timer.Fire();
    }
    private sealed class ManualTimer(ManualTimeProvider owner, TimerCallback callback, object? state) : ITimer
    {
        public DateTimeOffset Next = DateTimeOffset.MaxValue;
        public TimeSpan Period;
        private bool disposed;
        public bool Change(TimeSpan dueTime, TimeSpan period)
        {
            lock (owner.gate)
            {
                if (disposed)
                    return false;
                Next = dueTime == Timeout.InfiniteTimeSpan ? DateTimeOffset.MaxValue : owner.now + dueTime;
                Period = period;
                return true;
            }
        }
        public void Fire()
        {
            if (!disposed)
                callback(state);
        }
        public void Dispose()
        {
            lock (owner.gate)
            {
                disposed = true;
                owner.timers.Remove(this);
            }
        }
        public ValueTask DisposeAsync()
        {
            Dispose();
            return ValueTask.CompletedTask;
        }
    }
}

public sealed class MaintenanceLogger : ILogger<TransientMaintenance>
{
    public TaskCompletionSource Removed { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
    public bool IsEnabled(LogLevel level) => true;
    public void Log<TState>(LogLevel level, EventId id, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
    {
        if (level == LogLevel.Debug)
            Removed.TrySetResult();
    }
}
