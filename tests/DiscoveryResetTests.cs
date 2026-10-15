using LyricBridge;
using Lyricify.Lyrics.Models;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

public sealed class DiscoveryResetTests
{
    [Fact]
    public async Task ResetDrainsDiscoveryAndSearchAndRejectsNewAdmissions()
    {
        var directory = Path.Combine(Path.GetTempPath(), "lyricbridge-discovery-reset-" + Guid.NewGuid().ToString("N"));
        var provider = new BarrierSource();
        var store = new Store(directory); using var registry = ProviderRegistry.WithSources(provider);
        var retrieval = new Retrieval(store, registry, NullLogger<Retrieval>.Instance);
        using var discovery = new Discovery(store, registry, retrieval);
        var track = new TrackMultiArtistMetadata { Title = "fixture", Artists = ["artist"] };
        var item = Guid.NewGuid(); var user = Guid.NewGuid();
        try
        {
            discovery.Start(item, track);
            discovery.Search(user, item, track, null);
            await provider.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5), Xunit.TestContext.Current.CancellationToken);
            Assert.True(store.BeginReset());
            var draining = discovery.StopAll();
            Assert.Equal("reset_in_progress", Assert.Throws<WorkflowException>(() => discovery.Start(item, track)).Code);
            Assert.Equal("reset_in_progress", Assert.Throws<WorkflowException>(() => discovery.Search(user, item, track, null)).Code);
            provider.Release.TrySetResult(); await draining.WaitAsync(TimeSpan.FromSeconds(5), Xunit.TestContext.Current.CancellationToken);
            store.ResetManagedLibrary(); store.EndReset();
            Assert.Empty(store.All<RichLyrics>("selected"));
            Assert.Empty(store.All<RichLyrics>("document"));
            Assert.Empty(store.All<object>("preview"));
            // Old import/selection requests must fail explicitly after the reset.
            using var stale = store.Operation(store.Epoch - 1);
            Assert.Throws<WorkflowException>(() => store.ApplySelection(item, new(new() { Lines = [new() { Id = "line", Text = "late import" }] }, null)));
            Assert.Null(store.Selection(item).Lyrics);
        }
        finally
        {
            provider.Release.TrySetResult(); await discovery.StopAll(); store.EndReset();
            TestHost.ClearDatabasePools(directory);
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }
    private sealed class BarrierSource : ILyricSource
    {
        public string Name => "fixture";
        public readonly TaskCompletionSource Entered = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public readonly TaskCompletionSource Release = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async Task<List<Candidate>> Search(TrackMultiArtistMetadata track, CancellationToken token)
        {
            Entered.TrySetResult(); await Release.Task;
            // Models a provider that returns a late result despite cancellation.
            return [new(Name, "candidate", track.Title ?? "fixture", "artist", "", null, 100)];
        }
        public Task<RawLyrics?> Fetch(Candidate candidate, CancellationToken token) => Task.FromResult<RawLyrics?>(new("[00:01.00]fixture"));
    }
}
