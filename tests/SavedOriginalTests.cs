using LyricBridge;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

public sealed class SavedOriginalTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "lyricbridge-originals-" + Guid.NewGuid().ToString("N"));
    private static RichLyrics Lyrics(string text) => new() { Source = "Imported", ProviderId = "local", Manual = true, Lines = [new() { Id = "line", Text = text, Language = "ja" }] };
    private static readonly GenerationProfile Profile = new("AI", "fixture", "model", "translation", "en", "auto", "", 0, 0, 1);
    private static Variant Output(Job job) => new(job.VariantKey, job.Hash, "translation", "en", "AI", "model", new() { ["line"] = "generated" }, Profile: Profile);
    private static Job Running(Store store, Guid item, RichLyrics doc)
    {
        var job = new Job { ItemId = item, Hash = doc.Hash, State = "running", Profile = Profile, VariantKey = Guid.NewGuid().ToString("N"), DeletionRevision = store.Admit(item).Revision };
        Assert.True(store.PersistRequest(job, store.Epoch, doc)); return job;
    }
    [Fact]
    public void ImportsPersistDistinctOriginalsAndSwitchingRestoresTheirOwnState()
    {
        var store = new Store(directory); var item = Guid.NewGuid(); var user = Guid.NewGuid();
        var first = Lyrics("first"); var second = Lyrics("second");
        store.ApplySelection(item, new(first, null), new("first external file"));
        var languages = new LanguageVersionService(store);
        var translation = new Variant("translation-first", first.Hash, "translation", "en", "fixture", "", new() { ["line"] = "first translation" });
        var pronunciation = new Variant("pronunciation-first", first.Hash, "pronunciation", "ja", "fixture", "", new() { ["line"] = "first pronunciation" });
        store.Put("variant", translation.Key, translation); store.Put("variant", pronunciation.Key, pronunciation);
        languages.Select(user, first, new(first.Hash, "translation", translation.Key), "en");
        languages.Select(user, first, new(first.Hash, "pronunciation", pronunciation.Key), "en");
        Assert.True(store.SaveTiming(item, store.Selection(item), new(first.Hash, "timeline", 1.25)));
        store.ApplySelection(item, new(second, null), new("second external file"));
        store.ApplySelection(item, new(second, null));
        Assert.Equal(2, store.SavedOriginals(item).Count);
        Assert.Empty(store.Variants(second.Hash)); Assert.Null(store.AuxiliaryChoice(user, second.Hash, "translation", "en")); Assert.Null(store.Timing(item, second.Hash));
        store = new Store(directory);
        store.SelectOriginal(item, first.Hash);
        Assert.Equal(first.Hash, store.Selection(item).Lyrics!.Hash);
        Assert.Equal(translation.Key, store.AuxiliaryChoice(user, first.Hash, "translation", "en")!.Key);
        Assert.Equal(pronunciation.Key, store.AuxiliaryChoice(user, first.Hash, "pronunciation", "")!.Key);
        Assert.Equal(1.25, store.Timing(item, first.Hash)!.Seconds);
        Assert.Equal("first external file", store.Get<RawLyrics>("raw", first.Hash)!.Original);
        store.SelectOriginal(item, second.Hash); Assert.Equal(second.Hash, store.Selection(item).Lyrics!.Hash);
        store.SelectOriginal(item, first.Hash); Assert.Equal(2, store.Variants(first.Hash).Count);
    }
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void OriginalDeletionClearsReferencesAndPreservesOtherOriginal(bool current)
    {
        var store = new Store(directory); var item = Guid.NewGuid(); var first = Lyrics("first"); var second = Lyrics("second");
        store.ApplySelection(item, new(first, null)); store.ApplySelection(item, new(second, null));
        var target = current ? second : first;
        Assert.False(store.DeleteOriginal(item, target.Hash).SharedContentRetained);
        Assert.Null(store.GetDocument(target.Hash)); Assert.Single(store.SavedOriginals(item));
        if (current)
        {
            Assert.Equal(first.Hash, store.Selection(item).Lyrics!.Hash); Assert.False(store.DiscoverySuppressed(item));
        }
        else { Assert.Equal(second.Hash, store.Selection(item).Lyrics!.Hash); }
        Assert.Throws<WorkflowException>(() => store.SelectOriginal(item, target.Hash));
        Assert.Throws<WorkflowException>(() => store.DeleteOriginal(item, target.Hash));
        AssertNoDanglingReferences();
    }
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void CurrentDeletionRestoresNewestRemainingOriginalWithItsAuxiliaryState(bool deleteNewest)
    {
        var store = new Store(directory); var item = Guid.NewGuid(); var user = Guid.NewGuid();
        var older = Lyrics("older"); var recent = Lyrics("recent"); var deleting = Lyrics("deleting");
        store.ApplySelection(item, new(older, null)); store.ApplySelection(item, new(recent, null)); store.ApplySelection(item, new(deleting, null));
        foreach (var saved in store.SavedOriginals(item)) store.Put("saved-original", item.ToString("N") + ":" + saved.Hash,
            saved with { SavedAt = DateTimeOffset.UnixEpoch.AddDays(saved.Hash == recent.Hash ? 2 : 1) });
        var replacement = deleteNewest ? older : recent;
        var variant = new Variant("restored", replacement.Hash, "translation", "en", "fixture", "", new() { ["line"] = "saved text" });
        store.Put("variant", variant.Key, variant);
        new LanguageVersionService(store).Select(user, replacement, new(replacement.Hash, "translation", variant.Key), "en");
        store.SelectOriginal(item, replacement.Hash);
        Assert.True(store.SaveTiming(item, store.Selection(item), new(replacement.Hash, "timeline", 1.5)));
        store.SelectOriginal(item, deleting.Hash);
        if (deleteNewest) store.DeleteOriginal(item, recent.Hash);
        store.DeleteOriginal(item, deleting.Hash);
        Assert.Equal(replacement.Hash, store.Selection(item).Lyrics!.Hash);
        Assert.False(store.DiscoverySuppressed(item)); Assert.Equal(1.5, store.Timing(item, replacement.Hash)!.Seconds);
        Assert.Equal(variant.Key, store.AuxiliaryChoice(user, replacement.Hash, "translation", "en")!.Key);
        Assert.Single(store.Variants(replacement.Hash)); AssertNoDanglingReferences();
    }
    [Fact]
    public void DeletingRepeatedlySelectedOriginalRemovesItsChoicesButKeepsExternalFiles()
    {
        var store = new Store(directory); var song = Guid.NewGuid(); var user = Guid.NewGuid(); var original = Lyrics("original");
        var media = Path.Combine(directory, "external.flac"); var lyricFile = Path.Combine(directory, "external.lrc");
        store.ApplySelection(song, new(original, null), new("raw original"));
        store.ApplySelection(song, new(original, null));
        File.WriteAllText(media, "media sentinel"); File.WriteAllText(lyricFile, "lyric sentinel");
        var variant = new Variant("saved-translation", original.Hash, "translation", "en", "fixture", "", new() { ["line"] = "translation" });
        store.Put("variant", variant.Key, variant);
        new LanguageVersionService(store).Select(user, original, new(original.Hash, "translation", variant.Key), "en");
        Assert.True(store.SaveTiming(song, store.Selection(song), new(original.Hash, "timeline", 2)));
        store.DeleteOriginal(song, original.Hash);
        Assert.Null(store.Selection(song).Lyrics); Assert.Null(store.Timing(song, original.Hash));
        Assert.Null(store.Get<RawLyrics>("raw", original.Hash)); Assert.Empty(store.Variants(original.Hash)); Assert.Empty(store.All<AuxiliarySelection>("auxiliary-choice"));
        Assert.Equal("media sentinel", File.ReadAllText(media)); Assert.Equal("lyric sentinel", File.ReadAllText(lyricFile)); AssertNoDanglingReferences();
    }
    [Fact]
    public void DeletingLastOriginalReportsPausedSearchAcrossRestartUntilRetry()
    {
        var store = new Store(directory); var song = Guid.NewGuid(); var original = Lyrics("deleted");
        store.ApplySelection(song, new(original, null)); store.DeleteOriginal(song, original.Hash);
        store = new Store(directory);
        var providers = ProviderRegistry.WithSources();
        var retrieval = new Retrieval(store, providers, NullLogger<Retrieval>.Instance);
        using var discovery = new Discovery(store, providers, retrieval);
        var track = new Lyricify.Lyrics.Models.TrackMultiArtistMetadata { Title = "fixture", Artists = ["fixture"] };
        Assert.Equal("cleared", discovery.Start(song, track).State);
        Assert.Equal("cleared", discovery.Status(song).State);
        discovery.Start(song, track, true);
        Assert.False(store.DiscoverySuppressed(song));
        Assert.NotEqual("cleared", discovery.Status(song).State);
    }
    [Fact]
    public void SharedSongAndCompositionReferencesPreserveContentUntilLastOwnerIsRemoved()
    {
        var store = new Store(directory); var song = Guid.NewGuid(); var other = Guid.NewGuid(); var donorSong = Guid.NewGuid();
        var original = Lyrics("original"); var donor = Lyrics("donor");
        store.ApplySelection(song, new(original, null)); store.ApplySelection(other, new(original, null)); store.ApplySelection(donorSong, new(donor, null));
        var composed = new Variant("composition", original.Hash, "pronunciation", "ja", "fixture", "", new() { ["line"] = "donor text" }, Origin: new("fixture", "donor", donor.Hash), OriginType: "supplied");
        Assert.True(store.SaveSuppliedVariant(composed, new(donor.Hash), "choice", song, store.Selection(song)));
        var unaffected = Running(store, other, original);
        Assert.True(store.DeleteOriginal(song, original.Hash).SharedContentRetained);
        Assert.NotNull(store.GetVariant(composed.Key)); Assert.Equal(original.Hash, store.Selection(other).Lyrics!.Hash);
        Assert.True(store.CompleteGeneration(unaffected, Output(unaffected)));
        Assert.True(store.DeleteOriginal(donorSong, donor.Hash).SharedContentRetained);
        Assert.NotNull(store.GetDocument(donor.Hash)); Assert.NotNull(store.GetVariant(composed.Key));
        Assert.False(store.DeleteOriginal(other, original.Hash).SharedContentRetained);
        Assert.Null(store.GetDocument(original.Hash)); Assert.Null(store.GetDocument(donor.Hash)); Assert.Null(store.GetVariant(composed.Key));
        Assert.True(store.GetJob(unaffected.Id)!.OutputDeleted); AssertNoDanglingReferences();
    }
    [Theory]
    [InlineData("offer")]
    [InlineData("job")]
    public void ExternalSnapshotsOffersAndBackgroundWorkProtectSharedContent(string owner)
    {
        var store = new Store(directory); var song = Guid.NewGuid(); var other = Guid.NewGuid(); var original = Lyrics("original");
        store.ApplySelection(song, new(original, null));
        if (owner == "offer") store.Put("better", other.ToString("N"), new ImprovementOffer(original.Hash, original, new("fixture", "id", "title", "artist", "", null, 100), "fixture", "fixture"));
        Job? job = owner == "job" ? Running(store, other, original) : null;
        Assert.True(store.DeleteOriginal(song, original.Hash).SharedContentRetained); Assert.NotNull(store.GetDocument(original.Hash));
        if (job is not null) Assert.True(store.CompleteGeneration(job, Output(job)));
        AssertNoDanglingReferences();
    }
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task DeletionAndCompletionHaveDeterministicTransactionalOrdering(bool completeFirst)
    {
        var store = new Store(directory); var song = Guid.NewGuid(); var original = Lyrics("original"); store.ApplySelection(song, new(original, null));
        var job = Running(store, song, original); var variant = Output(job);
        var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var committed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var completion = Task.Run(async () =>
        {
            ready.SetResult(); if (!completeFirst) await committed.Task;
            try { return store.CompleteGeneration(job, variant); } finally { if (completeFirst) committed.TrySetResult(); }
        });
        var deletion = Task.Run(async () =>
        {
            await ready.Task; if (completeFirst) await committed.Task;
            try { return store.DeleteOriginal(song, original.Hash); } finally { if (!completeFirst) committed.TrySetResult(); }
        });
        await Task.WhenAll(completion, deletion).WaitAsync(TimeSpan.FromSeconds(10), Xunit.TestContext.Current.CancellationToken);
        Assert.Equal(completeFirst, await completion); Assert.Null(store.GetVariant(variant.Key)); Assert.Null(store.GetDocument(original.Hash));
        var history = store.GetJob(job.Id)!;
        Assert.True(history.OutputDeleted); Assert.NotNull(history.OutputDeletedAt); Assert.Equal(completeFirst ? "complete" : "cancelled", history.State);
        job.State = "failed"; job.Error = "late failure"; job.Progress = 25; store.SaveJob(job);
        Assert.Equal(history.State, store.GetJob(job.Id)!.State); Assert.True(store.GetJob(job.Id)!.OutputDeleted);
        Assert.False(store.PersistRequest(job, store.Epoch, original, true)); AssertNoDanglingReferences();
        store = new Store(directory); Assert.True(store.GetJob(job.Id)!.OutputDeleted);
        using var worker = new Generation(() => new(true, true, 5, 3), store, new LanguageServices(() => []));
        Assert.Equal("output_deleted", Assert.Throws<WorkflowException>(() => worker.Action(job.Id, "retry", job.UserId, true)).Code);
    }
    [Fact]
    public void OldAdmissionsCannotRecreateOutputEvenAfterFreshImportOfIdenticalContent()
    {
        var store = new Store(directory); var song = Guid.NewGuid(); var original = Lyrics("original"); store.ApplySelection(song, new(original, null));
        var admitted = store.Admit(song); var sharedTicket = store.Admit(); var job = new Job { ItemId = song, Hash = original.Hash, State = "pending", DeletionRevision = admitted.Revision };
        store.DeleteOriginal(song, original.Hash);
        using (store.Operation(admitted))
        {
            store.SaveDocument(original); Assert.Null(store.GetDocument(original.Hash));
            Assert.False(store.PersistRequest(job, admitted.Epoch, original));
            Assert.Equal("original_deleted", Assert.Throws<WorkflowException>(() => store.ApplySelection(song, new(original, null))).Code);
        }
        store.ApplySelection(song, new(original, null)); Assert.False(store.DiscoverySuppressed(song));
        Assert.Equal("original_changed", Assert.Throws<WorkflowException>(() => store.DeleteOriginal(song, original.Hash, admitted.Revision)).Code);
        Assert.Single(store.SavedOriginals(song));
        store = new Store(directory); // Deletion fences survive a reopened store.
        using (store.Operation(sharedTicket))
        {
            Assert.False(store.SaveLocalVariant(new("old-local", original.Hash, "pronunciation", "ja", "Kawazu", "fixture", new()), sharedTicket.Epoch));
            store.Put("variant", "old-variant", new Variant("old-variant", original.Hash, "translation", "en", "fixture", "", new()));
            Assert.Null(store.GetVariant("old-variant"));
        }
        var fresh = Running(store, song, original); Assert.True(store.CompleteGeneration(fresh, Output(fresh))); AssertNoDanglingReferences();
    }
    [Fact]
    public void DeletionRollbackIncludesSelectionsJobsAndAdmissionFences()
    {
        var store = new Store(directory); var item = Guid.NewGuid(); var original = Lyrics("original"); store.ApplySelection(item, new(original, null));
        var ticket = store.Admit(item); var job = Running(store, item, original);
        using (var c = new SqliteConnection("Data Source=" + Path.Combine(directory, "index.sqlite")))
        {
            c.Open(); using var command = c.CreateCommand(); command.CommandText = "CREATE TRIGGER fail_delete BEFORE DELETE ON records WHEN OLD.kind='document' BEGIN SELECT RAISE(ABORT,'fixture'); END;"; command.ExecuteNonQuery();
        }
        Assert.Throws<SqliteException>(() => store.DeleteOriginal(item, original.Hash));
        Assert.Equal(original.Hash, store.Selection(item).Lyrics!.Hash); Assert.Single(store.SavedOriginals(item)); Assert.False(store.DiscoverySuppressed(item));
        Assert.Equal("running", store.GetJob(job.Id)!.State); Assert.Equal(ticket.Revision, store.Admit(item).Revision);
        Assert.True(store.CompleteGeneration(job, Output(job))); AssertNoDanglingReferences();
    }
    [Fact]
    public async Task LocalConversionAdmittedBeforeDeletionCannotRecreateItsOutput()
    {
        var store = new Store(directory); var item = Guid.NewGuid(); var original = Lyrics("日本語"); store.ApplySelection(item, new(original, null));
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously); var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var worker = new LocalPronunciation(store, async (_, _) => { entered.TrySetResult(); await release.Task; return "nihongo"; });
        try
        {
            await worker.StartAsync(Xunit.TestContext.Current.CancellationToken); Assert.Equal("queued", worker.Ensure(original, new()).State);
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(5), Xunit.TestContext.Current.CancellationToken); store.DeleteOriginal(item, original.Hash); worker.InvalidateDeleted(original.Hash);
            release.SetResult(); await worker.StopAll().WaitAsync(TimeSpan.FromSeconds(5), Xunit.TestContext.Current.CancellationToken);
            Assert.Null(store.GetDocument(original.Hash)); Assert.Empty(store.Variants(original.Hash));
        }
        finally { release.TrySetResult(); await worker.StopAsync(CancellationToken.None); }
    }
    [Fact]
    public void DeletingAnOlderOriginalPreservesTheCurrentOriginalAndItsActiveJob()
    {
        var store = new Store(directory); var song = Guid.NewGuid(); var older = Lyrics("older"); var current = Lyrics("current");
        store.ApplySelection(song, new(older, null)); store.ApplySelection(song, new(current, null));
        var unaffected = Running(store, song, current);
        store.DeleteOriginal(song, older.Hash);
        Assert.False(store.DiscoverySuppressed(song)); Assert.Equal(current.Hash, store.Selection(song).Lyrics!.Hash);
        Assert.True(store.CompleteGeneration(unaffected, Output(unaffected))); AssertNoDanglingReferences();
    }
    [Fact]
    public async Task ProviderSelectionAdmittedBeforeDeletionCannotRestoreTheOriginal()
    {
        var store = new Store(directory); var song = Guid.NewGuid(); var original = Lyrics("original"); store.ApplySelection(song, new(original, null));
        var provider = new OriginalBarrierSource(); using var registry = ProviderRegistry.WithSources(provider);
        var retrieval = new Retrieval(store, registry, NullLogger<Retrieval>.Instance);
        var selecting = retrieval.Select(song, new("fixture", "provider", "title", "artist", "", null, 100), Xunit.TestContext.Current.CancellationToken);
        await provider.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5), Xunit.TestContext.Current.CancellationToken);
        store.DeleteOriginal(song, original.Hash); provider.Release.SetResult();
        Assert.Equal("original_deleted", (await Assert.ThrowsAsync<WorkflowException>(() => selecting)).Code);
        Assert.Empty(store.SavedOriginals(song)); Assert.Null(store.Selection(song).Lyrics); Assert.Empty(store.All<RichLyrics>("document"));
    }
    [Fact]
    public async Task DeletionCancelsOldSearchAndDoesNotCancelAFreshSearch()
    {
        var store = new Store(directory); var song = Guid.NewGuid(); var original = Lyrics("original"); store.ApplySelection(song, new(original, null));
        var provider = new OriginalBarrierSource(); using var registry = ProviderRegistry.WithSources(provider);
        var retrieval = new Retrieval(store, registry, NullLogger<Retrieval>.Instance); using var discovery = new Discovery(store, registry, retrieval);
        var track = new Lyricify.Lyrics.Models.TrackMultiArtistMetadata { Title = "title", Artists = ["artist"] };
        var user = Guid.NewGuid(); var old = discovery.Search(user, song, track, null);
        // Search is blocked in Fetch, after its provider candidate has been admitted.
        await provider.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5), Xunit.TestContext.Current.CancellationToken); var result = store.DeleteOriginal(song, original.Hash);
        var fresh = discovery.Search(Guid.NewGuid(), song, track, null);
        discovery.InvalidateDeleted(song, result.Revision); provider.Release.TrySetResult();
        await provider.FreshEntered.Task.WaitAsync(TimeSpan.FromSeconds(5), Xunit.TestContext.Current.CancellationToken);
        Assert.True(provider.OldToken.IsCancellationRequested); Assert.False(provider.FreshToken.IsCancellationRequested);
        await discovery.StopAll();
        Assert.Null(store.Selection(song).Lyrics); Assert.True(store.DiscoverySuppressed(song));
        Assert.NotEqual(old.Id, fresh.Id);
    }
    private sealed class OriginalBarrierSource : ILyricSource
    {
        public string Name => "fixture";
        public readonly TaskCompletionSource Entered = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public readonly TaskCompletionSource Release = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public readonly TaskCompletionSource FreshEntered = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public CancellationToken OldToken, FreshToken;
        private int fetches;
        public Task<List<Candidate>> Search(Lyricify.Lyrics.Models.TrackMultiArtistMetadata track, CancellationToken token) => Task.FromResult(new List<Candidate> { new(Name, "provider", "title", "artist", "", null, 100) });
        public async Task<RawLyrics?> Fetch(Candidate candidate, CancellationToken token)
        {
            if (Interlocked.Increment(ref fetches) == 1) { OldToken = token; Entered.TrySetResult(); }
            else { FreshToken = token; FreshEntered.TrySetResult(); }
            await Release.Task; return new("[00:01.00]provider lyrics");
        }
    }
    private void AssertNoDanglingReferences()
    {
        using var c = new SqliteConnection("Data Source=" + Path.Combine(directory, "index.sqlite")); c.Open(); using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM record_references r WHERE NOT EXISTS(SELECT 1 FROM records d WHERE d.kind='document' AND d.id=r.hash)";
        Assert.Equal(0L, (long)cmd.ExecuteScalar()!);
    }
    public void Dispose() { TestHost.ClearDatabasePools(directory); if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
