using LyricBridge;
using Lyricify.Lyrics.Models;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

public sealed class SearchAdmissionTests
{
    [Fact]
    public async Task SynchronousAndSessionSearchesShareAdmissionAndReleaseOnCancellation()
    {
        var directory = Path.Combine(Path.GetTempPath(), "lyricbridge-search-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new Store(directory); using var registry = ProviderRegistry.WithSources(new WaitingSource());
            var retrieval = new Retrieval(store, registry, NullLogger<Retrieval>.Instance);
            using var discovery = new Discovery(store, registry, retrieval);
            var user = Guid.NewGuid(); var item = Guid.NewGuid(); var track = new TrackMultiArtistMetadata { Title = "fixture", Artists = ["artist"] };
            var first = discovery.Search(user, item, track, null);
            var second = discovery.Search(user, item, track, null);
            var error = await Assert.ThrowsAsync<ServiceFailure>(() => discovery.Candidates(user, item, track, CancellationToken.None));
            Assert.Equal("search_limit", error.Code);
            Assert.True(discovery.CancelSearch(first.Id, user)); Assert.True(discovery.CancelSearch(second.Id, user));
            await discovery.StopAll();
            using var cancellation = new CancellationTokenSource();
            var admitted = discovery.Candidates(user, item, track, cancellation.Token); cancellation.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => admitted);
            await discovery.StopAll();
            Assert.NotNull(discovery.Search(user, item, track, null));
            await discovery.StopAll();
        }
        finally { StorageFixture.ClearDatabasePools(directory); if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
    private sealed class WaitingSource : ILyricSource
    {
        public string Name => "fixture";
        public async Task<List<Candidate>> Search(TrackMultiArtistMetadata track, CancellationToken token)
        { await Task.Delay(Timeout.Infinite, token); return []; }
        public Task<RawLyrics?> Fetch(Candidate candidate, CancellationToken token) => Task.FromResult<RawLyrics?>(null);
    }
}
