using LyricBridge;
using Microsoft.Data.Sqlite;
using Xunit;

public sealed class RetentionConcurrencyTests
{
    [Theory]
    [InlineData("selection", true)]
    [InlineData("selection", false)]
    [InlineData("variant", true)]
    [InlineData("variant", false)]
    [InlineData("donor", true)]
    [InlineData("donor", false)]
    [InlineData("timing", true)]
    [InlineData("timing", false)]
    [InlineData("history", true)]
    [InlineData("history", false)]
    public async Task CleanupAndReferenceCommitCannotLeaveDanglingDocuments(string operation, bool cleanupFirst)
    {
        var directory = Path.Combine(Path.GetTempPath(), "lyricbridge-retention-race-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new Store(directory);
            var now = DateTimeOffset.UtcNow;
            RichLyrics Preview(string id)
            {
                var lyrics = new RichLyrics { Source = "fixture", ProviderId = id, Lines = [new() { Id = "line", Text = id }] };
                lyrics.Hash = Codec.ContentHash(lyrics);
                store.CachePreview(new(new("fixture", id, id, "", "", null, 100), lyrics, null), now.AddDays(-2));
                return lyrics;
            }
            var original = Preview("original"); var donor = Preview("donor"); var unused = Preview("unused");
            var active = Preview("active"); Assert.NotNull(store.GetPreview("fixture:active"));
            var item = Guid.NewGuid();
            if (operation == "variant") store.Save(Guid.NewGuid(), donor);
            if (operation == "donor") store.Save(item, original);
            var expected = store.Selection(item);
            var variant = new Variant("saved", original.Hash, "pronunciation", "en", "fixture", "", new() { { "line", "text" } }, Origin: new("fixture", donor.ProviderId, donor.Hash), OriginType: "supplied");
            bool Reference()
            {
                switch (operation)
                {
                    case "selection": store.ApplySelection(item, new(original, null)); return true;
                    case "variant": case "donor": return store.SaveSuppliedVariant(variant, new(donor.Hash), "choice", item, expected);
                    case "timing": return store.SaveTiming(item, expected, new(original.Hash, "timeline", 1));
                    case "history": return store.PersistRequest(new() { Id = "history", Hash = original.Hash, State = "pending" }, store.Epoch, original);
                    default: throw new InvalidOperationException(operation);
                }
            }
            // Both actors are admitted with captured input before either commit. A barrier
            // chooses each legal serialization without relying on scheduler delays/sleeps.
            var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var firstDone = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var referenceTask = Task.Run(async () =>
            {
                ready.SetResult();
                if (cleanupFirst) await firstDone.Task;
                try { return Reference(); }
                finally { if (!cleanupFirst) firstDone.TrySetResult(); }
            });
            var cleanupTask = Task.Run(async () =>
            {
                await ready.Task;
                if (!cleanupFirst) await firstDone.Task;
                try { store.ExpireTransientData(now); }
                finally { if (cleanupFirst) firstDone.TrySetResult(); }
            }, Xunit.TestContext.Current.CancellationToken);
            await Task.WhenAll(referenceTask, cleanupTask).WaitAsync(TimeSpan.FromSeconds(15), Xunit.TestContext.Current.CancellationToken);
            if (await referenceTask)
            {
                Assert.NotNull(store.GetDocument(original.Hash));
                if (operation is "variant" or "donor") Assert.NotNull(store.GetDocument(donor.Hash));
            }
            else
            {
                Assert.Empty(store.All<Variant>("variant"));
                Assert.Empty(store.All<TimingCorrection>("timing-correction"));
            }
            Assert.Null(store.GetDocument(unused.Hash));
            Assert.NotNull(store.GetDocument(active.Hash));
            using var connection = new SqliteConnection("Data Source=" + Path.Combine(directory, "index.sqlite"));
            connection.Open(); using var command = connection.CreateCommand();
            command.CommandText = "SELECT count(*) FROM record_references r WHERE NOT EXISTS(SELECT 1 FROM records d WHERE d.kind='document' AND d.id=r.hash)";
            Assert.Equal(0L, (long)command.ExecuteScalar()!);
        }
        finally { TestHost.ClearDatabasePools(directory); if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
}
