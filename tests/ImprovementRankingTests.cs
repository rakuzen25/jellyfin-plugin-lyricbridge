using LyricBridge;
using Xunit;
using Microsoft.Data.Sqlite;
using Lyricify.Lyrics.Models;
using Microsoft.Extensions.Logging.Abstractions;

public sealed class ImprovementRankingTests
{
    private static Candidate Candidate(string source = "Kugou", int score = 100, double translation = 90, double pronunciation = 0) =>
        new(source, source, "しゃぼんだま", "artist", "album", 200000, score, Verification: "verified",
            Assessment: new(score, 2, true, [], [], "standard", "standard", 700, 0,
                new("mostly-word-timed", 3, 100, 10, 10, 14), Auxiliary: new(translation, pronunciation)));

    [Fact]
    public void QqAuxiliaryCoverageQualifiesWithoutChangingMatchOrTiming()
    {
        var baseline = Candidate(); var qq = Candidate("QQ", translation: 100, pronunciation: 100);
        Assert.True(LyricRanking.CompareQuality(qq, baseline) < 0);
        Assert.Equal("auxiliary-completeness", LyricRanking.Improvement(qq, baseline));
        var description = LyricRanking.ImprovementDescription(qq, baseline, "auxiliary-completeness");
        Assert.Contains("90% → 100%", description); Assert.Contains("0% → 100%", description);
        var tradeoff = Candidate("QQ", translation: 80, pronunciation: 100);
        Assert.Equal("auxiliary-completeness", LyricRanking.Improvement(tradeoff, baseline));
        Assert.Contains("90% → 80%", LyricRanking.ImprovementDescription(tradeoff, baseline, "auxiliary-completeness"));
    }

    [Fact]
    public void TieBreakersUnverifiedAndWorseEarlierFactorsNeverOffer()
    {
        var baseline = Candidate(); var tie = Candidate("AAA");
        Assert.True(LyricRanking.Compare(tie, baseline) < 0);
        Assert.Null(LyricRanking.Improvement(tie, baseline));
        Assert.Null(LyricRanking.Improvement(Candidate("QQ", translation: 100, pronunciation: 100) with { Verification = "pending" }, baseline));
        Assert.Null(LyricRanking.Improvement(Candidate("QQ", score: 99, translation: 100, pronunciation: 100), baseline));
        var worse = Candidate("QQ") with { Assessment = baseline.Assessment! with { Eligible = false, Score = 200 } };
        Assert.Null(LyricRanking.Improvement(worse, baseline));
        var score = Candidate("QQ", score: 101);
        Assert.Equal("match-score", LyricRanking.Improvement(score, baseline));
        var covered = baseline with { Assessment = baseline.Assessment! with { Timing = baseline.Assessment.Timing! with { Coverage = 90 } } };
        Assert.Equal("timing-coverage", LyricRanking.Improvement(baseline, covered));
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task ManualSearchPublishesOnlyAfterVerificationAndAgainstItsBaseline(bool changeSelection, bool cancel)
    {
        var directory = Path.Combine(Path.GetTempPath(), "lyricbridge-search-offer-" + Guid.NewGuid().ToString("N"));
        var source = new ControlledSource();
        try
        {
            var store = new Store(directory); var item = Guid.NewGuid(); var user = Guid.NewGuid();
            var track = new TrackMultiArtistMetadata { Title = "fixture", Artists = ["artist"] };
            var original = new RichLyrics { Source = "Kugou", ProviderId = "Kugou", Lines = [new() { Id = "line", Text = "original" }] };
            var assessed = new MatchingSession(track).Assess(new("Kugou", "Kugou", "fixture", "artist", "", null, 100));
            store.ApplySelection(item, new(original, null, Assessment: new(Codec.ContentHash(original), assessed)));
            using var registry = ProviderRegistry.WithSources(source);
            using var discovery = new Discovery(store, registry, new Retrieval(store, registry, NullLogger<Retrieval>.Instance));
            var search = discovery.Search(user, item, track, null);
            await source.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
            var pending = discovery.SearchStatus(search.Id, user)!;
            Assert.Equal("searching", pending.State); Assert.Null(pending.Recommended); Assert.Null(pending.Improvement);
            if (changeSelection) store.ApplySelection(item, new(new() { Lines = [new() { Text = "new selection" }] }, null));
            if (cancel) Assert.True(discovery.CancelSearch(search.Id, user));
            source.Release.TrySetResult();
            SearchSession final = pending;
            for (var attempt = 0; attempt < 500; attempt++)
            {
                final = discovery.SearchStatus(search.Id, user)!;
                if (final.State != "searching") break;
                await Task.Delay(10, TestContext.Current.CancellationToken);
            }
            Assert.NotEqual("searching", final.State);
            if (changeSelection || cancel) { Assert.Null(final.Improvement); Assert.Null(store.Improvement(item)); }
            else { Assert.NotNull(final.Improvement); Assert.Equal("QQ:new", final.Recommended); Assert.Equal("timing", final.Improvement.Reason); Assert.NotNull(store.Improvement(item)); }
            Assert.Equal(changeSelection ? "new selection" : "original", store.Selection(item).Lyrics!.Lines[0].Text);
            await discovery.StopAll();
        }
        finally { source.Release.TrySetResult(); SqliteConnection.ClearAllPools(); if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
    private sealed class ControlledSource : ILyricSource
    {
        public string Name => "QQ";
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Task<List<Candidate>> Search(TrackMultiArtistMetadata track, CancellationToken token) => Task.FromResult<List<Candidate>>([new("QQ", "new", "fixture", "artist", "", null, 100)]);
        public async Task<RawLyrics?> Fetch(Candidate candidate, CancellationToken token)
        { Entered.TrySetResult(); await Release.Task.WaitAsync(token); return new("[00:01.00]better lyrics"); }
    }

    [Fact]
    public void OfferPublicationProtectsSelectionAndKeepsTheBestOffer()
    {
        var directory = Path.Combine(Path.GetTempPath(), "lyricbridge-offers-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new Store(directory); var item = Guid.NewGuid();
            var original = new RichLyrics { Source = "Kugou", ProviderId = "Kugou", Lines = [new() { Id = "line", Text = "original" }] };
            store.ApplySelection(item, new(original, null, Assessment: new(Codec.ContentHash(original), Candidate())));
            var expected = store.Selection(item);
            var better = new RichLyrics { Source = "QQ", ProviderId = "QQ", Lines = [new() { Id = "line", Text = "better", Pronunciation = "reading" }] };
            better.Hash = Codec.ContentHash(better);
            var ranked = Candidate("QQ") with { Assessment = Candidate().Assessment! with { Score = 101 } };
            var proposal = new ImprovementOffer(expected.Lyrics!.Hash, better, ranked, "match-score", "fixture");
            var identical = Codec.Deserialize<RichLyrics>(Codec.Serialize(original))!;
            identical.Source = "QQ"; identical.ProviderId = "QQ"; identical.Hash = Codec.ContentHash(identical);
            Assert.Null(store.TryOffer(item, expected, proposal with { Lyrics = identical }));
            Assert.NotNull(store.TryOffer(item, expected, proposal));
            var worse = proposal with { Candidate = ranked with { Assessment = ranked.Assessment! with { Score = 100 } } };
            Assert.Equal(Codec.Serialize(proposal.Candidate), Codec.Serialize(store.TryOffer(item, expected, worse)?.Candidate));
            Assert.Equal(expected.Lyrics.Hash, store.Selection(item).Lyrics!.Hash);
            store.ApplySelection(item, new(new() { Lines = [new() { Text = "new selection" }] }, null));
            Assert.Null(store.TryOffer(item, expected, proposal));
            Assert.Null(store.Improvement(item));
            Assert.Equal("new selection", store.Selection(item).Lyrics!.Lines[0].Text);
        }
        finally { SqliteConnection.ClearAllPools(); if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
}
