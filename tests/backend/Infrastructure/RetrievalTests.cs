using Xunit;
using LyricBridge;
using Lyricify.Lyrics.Models;
using Microsoft.Extensions.Logging;
public sealed class RetrievalTests : StorageFixture
{
    [Fact]
    public async Task RetrievalDeduplicatesAndPreservesSelections()
    {
        var root = Root;
        var track = new TrackMultiArtistMetadata { Title = "fixture", Artists = ["artist"] };
        var line = new FakeSource("QQ", "[00:01.00]hi");
        var word = new FakeSource("NetEase", "[1000,1000](1000,500,0)h(1500,500,0)i");
        var logger = new TestLogger();
        var retrieval = new Retrieval(Own(new Store(Path.Combine(root, "retrieval"))), ProviderRegistry.WithSources(line, word), logger);
        var item = Guid.NewGuid();
        var tasks = Enumerable.Range(0, 8).Select(_ => retrieval.Get(item, track, false, TestContext.Current.CancellationToken)).ToArray();
        var results = await Task.WhenAll(tasks);
        Assert.True(results.All(r => r?.WordTimed == true) && line.Searches == 1 && word.Searches == 1, "prefer word timing and deduplicate concurrent retrieval");
        var manual = await retrieval.Select(item, new("QQ", "42", "fixture", "artist", "album", 10000, 100), TestContext.Current.CancellationToken);
        Assert.True((await retrieval.Get(item, track, false, TestContext.Current.CancellationToken))?.Manual == true, "preserve manual selection");
        Assert.True((await retrieval.Get(item, track, true, TestContext.Current.CancellationToken))?.WordTimed == true, "explicit timing upgrade");
        using (var cancel = new CancellationTokenSource(5))
        {
            try
            {
                await retrieval.Get(Guid.NewGuid(), track, false, cancel.Token);
                throw new Exception("Cancellation ignored");
            }
            catch (OperationCanceledException) { }
        }
        var missing = new FakeSource("LRCLIB", null) { Missing = true };
        var noMatch = new Retrieval(Own(new Store(Path.Combine(root, "missing"))), ProviderRegistry.WithSources(missing), logger);
        var absent = Guid.NewGuid();
        await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => noMatch.Get(absent, track, false, TestContext.Current.CancellationToken)));
        Assert.True(missing.Searches == 1, "deduplicate negative results");
        var failing = new FakeSource("QQ", null) { Failure = true };
        var failed = new Retrieval(Own(new Store(Path.Combine(root, "failed"))), ProviderRegistry.WithSources(failing), logger);
        await failed.Get(Guid.NewGuid(), track, false, TestContext.Current.CancellationToken);
        await failed.Get(Guid.NewGuid(), track, false, TestContext.Current.CancellationToken);
        Assert.True(failing.Searches == 1 && !logger.Messages.Any(s => s.Contains("SECRET")), "provider failure backoff and secret redaction");
    }
}
public sealed class FakeSource(string name, string? lyrics) : ILyricSource
{
    public string Name => name; public int Searches; public bool Missing, Failure;
    public async Task<List<Candidate>> Search(TrackMultiArtistMetadata track, CancellationToken token)
    {
        Interlocked.Increment(ref Searches);
        await Task.Delay(30, token);
        if (Failure)
            throw new Exception("SECRET API credential");
        return Missing ? [] : [new(Name, "42", "fixture", "artist", "album", 10000, 100)];
    }
    public Task<RawLyrics?> Fetch(Candidate candidate, CancellationToken token) => Task.FromResult(lyrics == null ? null : new RawLyrics(lyrics));
}
public sealed class TestLogger : ILogger<Retrieval>
{
    public List<string> Messages = []; public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null; public bool IsEnabled(LogLevel level) => true;
    public void Log<TState>(LogLevel level, EventId id, TState state, Exception? exception, Func<TState, Exception?, string> formatter) => Messages.Add(formatter(state, exception));
}
