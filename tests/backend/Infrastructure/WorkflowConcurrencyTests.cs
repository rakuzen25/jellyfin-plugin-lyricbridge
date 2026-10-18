using LyricBridge;
using Microsoft.Data.Sqlite;
using Xunit;

public sealed class WorkflowConcurrencyTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "lyricbridge-workflow-" + Guid.NewGuid().ToString("N"));
    [Fact]
    public void MalformedCompositionMappingCannotCreateAVariant()
    {
        var store = new Store(directory); var item = Guid.NewGuid();
        var original = new RichLyrics { Lines = [new() { Id = "original", Text = "Hello" }] };
        store.ApplySelection(item, new(original, null)); original = store.Selection(item).Lyrics!;
        var donor = new RichLyrics { Hash = "donor", Lines = [new() { Id = "donor-line", Text = "Hello", Pronunciation = "hello" }] };
        store.SaveDocument(donor);
        var service = new LanguageVersionService(store);
        foreach (var mapping in new Dictionary<string, string>?[] { null, new() { ["original"] = null! }, new() { ["original"] = "" }, new() { ["unknown"] = "donor-line" } })
        {
            var error = Assert.Throws<WorkflowException>(() => service.Mix(Guid.NewGuid(), item, store.Selection(item), original, new(original.Hash, donor.Hash, "pronunciation", "en", mapping!), "en"));
            Assert.Equal(400, error.Status); Assert.Equal("invalid_alignment", error.Code);
        }
        Assert.Empty(store.All<Variant>("variant")); Assert.Equal(original.Hash, store.Selection(item).Lyrics!.Hash);
    }
    [Fact]
    public async Task ConcurrentAdmissionsRespectCapsAndRestartPreservesHistory()
    {
        var store = new Store(directory); var user = Guid.NewGuid();
        var settings = new ServiceConfig { Name = "AI", Endpoint = "http://fixture.invalid/v1", Model = "fixture" };
        var language = new LanguageServices(() => [settings]);
        using var worker = new Generation(() => new(true, false, 5, 3), store, language);
        var results = await Task.WhenAll(Enumerable.Range(0, 40).Select(index => Task.Run(() =>
        {
            try { return worker.Request(user, Guid.NewGuid(), new() { Hash = "doc" + index, Lines = [new() { Id = "line", Text = "hello", Language = "en" }] }, new() { Service = "AI" }, false); }
            catch (InvalidOperationException) { return null; }
        })));
        Assert.Equal(3, results.Count(result => result is not null)); Assert.Equal(3, store.CountActiveJobs(user));
        var interrupted = results.First(result => result is not null)!; interrupted.State = "running"; store.SaveJob(interrupted);
        await worker.StartAsync(CancellationToken.None);
        for (var count = 0; count < 100 && store.GetJob(interrupted.Id)?.State != "failed"; count++) await Task.Delay(10, Xunit.TestContext.Current.CancellationToken);
        Assert.Equal("failed", store.GetJob(interrupted.Id)!.State);
        Assert.Equal(3, store.CountAdmissions(user, DateTime.UtcNow.AddDays(-1)));
        await worker.StopAsync(CancellationToken.None);
    }
    [Fact]
    public void CompletionRollsBackVariantAndHistoryTogether()
    {
        var store = new Store(directory);
        var profile = new GenerationProfile("AI", "endpoint-id", "model", "translation", "en", "auto", "", 0, 0, 1);
        var job = new Job { State = "running", Hash = "document", Profile = profile }; store.Put("job", job.Id, job);
        var variant = new Variant("version", job.Hash, "translation", "en", "AI", "model", new() { ["line"] = "text" }, Profile: profile);
        using (var connection = new SqliteConnection("Data Source=" + Path.Combine(directory, "index.sqlite")))
        {
            connection.Open(); using var command = connection.CreateCommand();
            command.CommandText = "CREATE TRIGGER fail_completion BEFORE UPDATE ON records WHEN NEW.kind='job' AND json_extract(NEW.payload,'$.state')='complete' BEGIN SELECT RAISE(ABORT,'synthetic'); END;";
            command.ExecuteNonQuery();
        }
        Assert.Throws<SqliteException>(() => store.CompleteGeneration(job, variant));
        Assert.Null(store.GetVariant(variant.Key)); Assert.Equal("running", store.GetJob(job.Id)!.State);
    }
    [Fact]
    public void BackgroundSelectionCannotOverwriteAnAdministratorDecision()
    {
        var store = new Store(directory); var item = Guid.NewGuid();
        var document = new RichLyrics { Lines = [new() { Id = "line", Text = "automatic" }] };
        var verification = new Verification(new("fixture", "id", "title", "artist", "", null, 100), document, new("automatic"));
        store.ApplySelection(item, new(null, null, new MatchRejection()));
        Assert.False(store.TrySaveAutomatic(item, verification)); Assert.NotNull(store.Selection(item).Rejected);
        store.ApplySelection(item, new(new() { Lines = [new() { Id = "line", Text = "manual" }], Manual = true }, null));
        Assert.False(store.TrySaveAutomatic(item, verification)); Assert.Equal("manual", store.Selection(item).Lyrics!.Lines[0].Text);
    }
    [Fact]
    public void StaleUpgradeAndTimingCannotOverwriteNewSelection()
    {
        var store = new Store(directory); var item = Guid.NewGuid();
        RichLyrics Document(string text) => new() { Lines = [new() { Id = "line", Text = text }], Manual = true };
        var first = Document("first"); store.ApplySelection(item, new(first, null));
        var expected = store.Selection(item); var better = Document("better"); better.Hash = Codec.ContentHash(better);
        var offer = new ImprovementOffer(first.Hash, better, new("fixture", "id", "title", "artist", "", null, 100), "timing", "Better timing");
        store.Put("better", item.ToString("N"), offer);
        store.ApplySelection(item, new(Document("newer"), null));
        Assert.Equal("lyric_version_changed", store.ApplyUpgrade(item, expected, better.Hash, first.Hash));
        Assert.False(store.SaveTiming(item, expected, new(first.Hash, "timeline", 1)));
        Assert.Equal("newer", store.Selection(item).Lyrics!.Lines[0].Text);
        Assert.Null(store.Get<TimingCorrection>("timing-correction", item.ToString("N") + ":" + first.Hash));
    }
    [Fact]
    public void UpgradeAtomicallyReplacesSelectionAndConsumesOffer()
    {
        var store = new Store(directory); var item = Guid.NewGuid();
        var first = new RichLyrics { Lines = [new() { Id = "line", Text = "first" }] }; store.ApplySelection(item, new(first, null));
        var expected = store.Selection(item);
        var better = new RichLyrics { Lines = [new() { Id = "line", Text = "better" }] }; better.Hash = Codec.ContentHash(better);
        store.Put("better", item.ToString("N"), new ImprovementOffer(first.Hash, better, new("fixture", "id", "title", "artist", "", null, 100), "timing", "Better timing"));
        Assert.Null(store.ApplyUpgrade(item, expected, better.Hash, first.Hash));
        Assert.True(store.Selection(item).Lyrics!.Manual);
        Assert.Equal("better", store.Selection(item).Lyrics!.Lines[0].Text);
        Assert.Null(store.Get<ImprovementOffer>("better", item.ToString("N")));
        Assert.Contains(store.SavedOriginals(item), original => original.Hash == first.Hash);
        store.SelectOriginal(item, first.Hash); Assert.Equal("first", store.Selection(item).Lyrics!.Lines[0].Text);
    }
    [Fact]
    public void ResetRejectsStaleJobAdmissionAndCompletionWithoutRecreatingHistory()
    {
        var store = new Store(directory); var epoch = store.Epoch;
        var lyrics = new RichLyrics { Hash = "fixture", Lines = [new() { Id = "line", Text = "hello" }] };
        var job = new Job { Hash = lyrics.Hash, State = "queued" };
        Assert.True(store.PersistRequest(job, epoch, lyrics));
        Assert.True(store.BeginReset()); store.ResetManagedLibrary(); store.EndReset();
        Assert.False(store.PersistRequest(job, epoch, lyrics));
        Assert.False(store.PersistRequest(job, store.Epoch, requireExisting: true));
        Assert.False(store.CompleteGeneration(job, null));
        Assert.Null(store.GetJob(job.Id)); Assert.Null(store.GetDocument(lyrics.Hash));
    }
    public void Dispose() { StorageFixture.ClearDatabasePools(directory); if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
