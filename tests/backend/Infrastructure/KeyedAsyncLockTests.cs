using LyricBridge;
using Xunit;

public sealed class KeyedAsyncLockTests
{
    [Fact]
    public async Task SameKeySerializesWhileDifferentKeysProceedAndIdleKeysAreReleased()
    {
        var gate = new KeyedAsyncLock<string>();
        var first = await gate.Acquire("song-a", TestContext.Current.CancellationToken);
        var waiting = gate.Acquire("song-a", TestContext.Current.CancellationToken);
        Assert.False(waiting.IsCompleted);
        var other = await gate.Acquire("song-b", TestContext.Current.CancellationToken);
        Assert.Equal(2, gate.ActiveKeyCount);
        first.Dispose();
        first.Dispose();
        using (await waiting) Assert.Equal(2, gate.ActiveKeyCount);
        other.Dispose();
        Assert.Equal(0, gate.ActiveKeyCount);
    }

    [Fact]
    public async Task CancelledWaiterCannotRemoveOrReleaseAnotherOwnersGate()
    {
        var gate = new KeyedAsyncLock<string>();
        var first = await gate.Acquire("song", TestContext.Current.CancellationToken);
        using var cancellation = new CancellationTokenSource();
        var cancelled = gate.Acquire("song", cancellation.Token);
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => cancelled);
        var waiting = gate.Acquire("song", TestContext.Current.CancellationToken);
        Assert.False(waiting.IsCompleted);
        first.Dispose();
        (await waiting).Dispose();
        Assert.Equal(0, gate.ActiveKeyCount);
    }

    [Fact]
    public async Task ConcurrentReentryNeverCreatesTwoOwnersForTheSameKey()
    {
        var gate = new KeyedAsyncLock<int>();
        var owners = new int[4];
        await Task.WhenAll(Enumerable.Range(0, 100).Select(async index =>
        {
            var key = index % owners.Length;
            for (var iteration = 0; iteration < 10; iteration++)
            {
                using (await gate.Acquire(key, TestContext.Current.CancellationToken))
                {
                    Assert.Equal(1, Interlocked.Increment(ref owners[key]));
                    await Task.Yield();
                    Assert.Equal(0, Interlocked.Decrement(ref owners[key]));
                }
            }
        }));
        Assert.Equal(0, gate.ActiveKeyCount);
    }
}
