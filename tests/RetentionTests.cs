using LyricBridge;
using Microsoft.Data.Sqlite;
using Xunit;

public sealed class RetentionTests
{
    [Fact]
    public void CleanupRemovesOnlyUnusedTemporaryContent()
    {
        var root = Path.Combine(Path.GetTempPath(), "lyricbridge-retention-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new Store(root); var now = DateTimeOffset.UtcNow;
            Verification Preview(string id)
            {
                var lyrics = new RichLyrics { Source = "fixture", ProviderId = id, Lines = [new() { Id = "line", Text = id }] }; lyrics.Hash = Codec.ContentHash(lyrics);
                var verification = new Verification(new("fixture", id, id, "artist", "", null, 100), lyrics, new(id));
                store.CachePreview(verification, now.AddDays(-2)); return verification;
            }
            var unused = Preview("unused"); var saved = Preview("saved"); var job = Preview("job"); var donor = Preview("donor");
            var timing = Preview("timing"); var offered = Preview("offered"); var active = Preview("active");
            var expiredHandle = store.CacheCandidate(unused.Candidate, now.AddDays(-2));
            var activeHandle = store.CacheCandidate(active.Candidate, now.AddDays(-2));
            Assert.NotNull(store.GetCandidate(activeHandle));
            var selected = Guid.NewGuid(); store.Save(selected, saved.Lyrics!); store.Delete("selected", selected.ToString("N"));
            store.Put("job", "history", new Job { Hash = job.Lyrics!.Hash, State = "complete" });
            store.Put("variant", "saved-variant", new Variant("saved-variant", saved.Lyrics!.Hash, "translation", "en", "fixture", "", new(), Origin: new("fixture", "donor", donor.Lyrics!.Hash)));
            store.Put("timing-correction", "item", new TimingCorrection(timing.Lyrics!.Hash, "fingerprint", 1));
            store.Put("better", "item", new ImprovementOffer(saved.Lyrics.Hash, offered.Lyrics!, offered.Candidate, "fixture", "fixture"));
            Assert.NotNull(store.GetPreview("fixture:active"));
            Assert.True(store.ExpireTransientData(now) > 0);
            Assert.Null(store.GetCandidate(expiredHandle));
            Assert.NotNull(store.GetCandidate(activeHandle));
            Assert.Null(store.Get<RichLyrics>("document", unused.Lyrics!.Hash));
            Assert.Null(store.Get<RawLyrics>("raw", unused.Lyrics.Hash));
            foreach (var protectedPreview in new[] { saved, job, donor, timing, offered, active })
                Assert.NotNull(store.Get<RichLyrics>("document", protectedPreview.Lyrics!.Hash));
            Assert.NotNull(store.GetJob("history"));
            // A repeated preview must not demote content that was explicitly saved.
            store.Delete("variant", "saved-variant"); store.CachePreview(saved, now.AddDays(-2));
            store.ExpireTransientData(now); Assert.NotNull(store.Get<RichLyrics>("document", saved.Lyrics.Hash));
            Assert.True(store.BeginReset()); store.ResetManagedLibrary(); store.EndReset();
            Assert.Empty(store.All<Job>("job"));
        }
        finally { SqliteConnection.ClearAllPools(); if (Directory.Exists(root)) Directory.Delete(root, true); }
    }
}
