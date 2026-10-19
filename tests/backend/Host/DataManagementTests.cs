using System.Reflection;
using System.Text.Json;
using LyricBridge;
using MediaBrowser.Controller.Library;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Model.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

public class DataLookupProxy : DispatchProxy
{
    protected override object? Invoke(MethodInfo? method, object?[]? args) => null;
}

public sealed class DataManagementTests : TestHost
{
    private sealed class Audio : IAudioPreparation
    {
        public bool FailClear;
        public Task<PreparedAudio> Prepare(Job job, TranscriptionConfig settings, IProgress<int> progress, CancellationToken token) => throw new NotSupportedException();
        public Task<List<PreparedAudio>> PlanChunks(Job job, PreparedAudio audio, TranscriptionConfig settings, CancellationToken token) => throw new NotSupportedException();
        public void Release(Job job) { }
        public void Clear() { if (FailClear) throw new IOException("fixture"); }
    }
    private (DataManagementService Data, Store Store, Audio Audio) Create(Plugin? owner = null)
    {
        var store = Own(new Store(Path.Combine(Root, "custom")));
        var languages = Own(new LanguageServices(ServiceFixtures.Catalog(() => [])));
        var retrieval = new Retrieval(store, ProviderRegistry.WithSources(), NullLogger<Retrieval>.Instance);
        var discovery = Own(new Discovery(store, ProviderRegistry.WithSources(), retrieval));
        var local = Own(new LocalPronunciation(store)); var generation = Own(new Generation(() => new(true, true, 100, 10), store, languages));
        var audio = new Audio();
        return (new(store, new(store, discovery, generation, local, retrieval, audio), generation, discovery, local, retrieval, audio, new(() => owner ?? Plugin),
            DispatchProxy.Create<ILibraryManager, DataLookupProxy>(), DispatchProxy.Create<IUserManager, DataLookupProxy>()), store, audio);
    }
    private static RichLyrics Lyrics(string text) => new() { Source = "Imported", Title = text, Artist = "Fixture artist", Lines = [new() { Id = "l0", Text = text }] };
    private static DataTarget Original(Guid item, string hash) => new("saved-original", item.ToString("N") + ":" + hash);
    private static Task<DataResult> Confirm(DataManagementService data, DataPreview preview, Guid owner = default) => data.Execute(owner, new(preview.Token, preview.Confirmation, true));

    [Fact]
    public void InspectorCuratesPreferencesSharedContentRequestsAndUnknownRecords()
    {
        var (data, store, _) = Create(); var user = Guid.NewGuid();
        store.SaveAccountPreferences(user, new());
        var preferences = data.Detail(new("preferences", user.ToString("N")));
        Assert.Empty(preferences.Inspection!.Lines);
        Assert.Contains(preferences.Inspection.Fields, field => field.Label == "Translation language");
        var lyrics = Lyrics("Shared title"); store.Save(Guid.NewGuid(), lyrics); store.Save(Guid.NewGuid(), lyrics);
        var shared = data.Detail(new("document", lyrics.Hash));
        Assert.Equal(2, shared.Inspection!.Relationships.Count(link => link.Role == "owner"));
        Assert.False(shared.CanDelete);
        var job = new Job { State = "running" }; store.Put("job", job.Id, job);
        Assert.True(data.Detail(new("job", job.Id)).Inspection!.CanCancel);
        job.State = "failed"; job.Error = "Provider unavailable"; store.Put("job", job.Id, job);
        var failed = data.Detail(new("job", job.Id));
        Assert.False(failed.Inspection!.CanCancel);
        Assert.Contains(failed.Inspection.Fields, field => field.Label == "Outcome" && field.Value == job.Error);
        store.Put("future-kind", "internal-id", new { algorithm = "private implementation detail" });
        var unknown = data.Detail(new("future-kind", "internal-id"));
        Assert.Equal("Internal record", unknown.DisplayType);
        Assert.Empty(unknown.Inspection!.Lines); Assert.Empty(unknown.Inspection.Fields);
        Assert.False(unknown.CanDelete);
    }

    [Fact]
    public void InspectorReconstructsBoundaryLinesNormalizesTimingAndResolvesOwnersWithoutWrites()
    {
        var (data, store, _) = Create();
        var profile = new GenerationProfile("AI", "fixture", "fixture-model", "transcription", "en", "en", "", 0, 0, 1);
        var transcript = new Transcript(Guid.NewGuid(), Guid.NewGuid(), "inspection-transcript", "Hello world", "Hello world", "en", "word",
            [new("t0", "Hello", "", 0, 5, TimeSpan.TicksPerSecond * 2, TimeSpan.TicksPerSecond * 3),
             new("t1", "world", " ", 6, 11, TimeSpan.TicksPerSecond * 4, TimeSpan.TicksPerSecond * 5)], [], profile, [], DateTimeOffset.UtcNow);
        store.Put("transcript", transcript.Id, transcript);
        var version = new BoundaryVersion("inspection-version", transcript.Id, "automatic", "fixture", new(), ["t0", "t1"], DateTimeOffset.UtcNow);
        store.Put("boundary-version", version.Id, version);
        var before = Codec.Serialize(store.InspectData());
        var detail = data.Detail(new("boundary-version", version.Id));
        Assert.Equal("Line-break version", detail.DisplayType);
        Assert.Equal(new[] { "Hello", "world" }, detail.Inspection!.Lines.Select(line => line.Text.Trim()));
        Assert.Equal(2, detail.Inspection.Lines[0].StartSeconds);
        Assert.Contains(detail.Inspection.Relationships, link => link.Role == "owner" && link.Target.Id == transcript.Id && !link.Missing);
        var timed = data.Detail(new("transcript", transcript.Id));
        Assert.Equal(2, timed.Inspection!.Lines[0].StartSeconds);
        Assert.Equal(5, timed.Inspection.Lines[0].EndSeconds);
        Assert.Equal(before, Codec.Serialize(store.InspectData()));
        store.Put("boundary-version", "orphan-version", version with { Id = "orphan-version", TranscriptId = "missing" });
        var orphan = data.Detail(new("boundary-version", "orphan-version"));
        Assert.Contains(orphan.Inspection!.Relationships, link => link.Role == "owner" && link.Missing);
        Assert.Empty(orphan.Inspection.Lines);
        Assert.Equal("Internal record", ManagedDataKinds.Label("future-kind"));
    }

    [Fact]
    public void AllRoutesRequireAdministratorAuthorization()
    {
        var auth = typeof(DataManagementApi).GetCustomAttribute<AuthorizeAttribute>();
        Assert.Equal(Jellyfin.Api.Constants.UserRoles.Administrator, auth?.Roles);
        Assert.DoesNotContain(typeof(DataManagementApi).GetMethods(), m => m.GetCustomAttribute<AllowAnonymousAttribute>() != null);
    }
    [Fact]
    public void InspectionIsReadOnlyCountsSharedRecordsOnceAndFindsMissingSongsAndAccounts()
    {
        var (data, store, _) = Create(); var one = Guid.NewGuid(); var two = Guid.NewGuid(); var user = Guid.NewGuid();
        var lyrics = Lyrics("Stored title"); store.Save(one, lyrics, new("source text")); store.Save(two, lyrics);
        store.SaveAccountPreferences(user, new()); store.SaveSongPreferences(user, one, new("en", "ja"));
        var before = Codec.Serialize(store.InspectData());
        var songs = data.Entities(false, "Stored title", null, true, 0, 1);
        Assert.Equal(2, songs.Total); Assert.Single(songs.Items); Assert.True(songs.Items[0].Identity.Missing);
        Assert.Single(data.Entities(true, null, null, true, 0, 50).Items);
        var detail = data.Detail(new("document", lyrics.Hash)); Assert.Equal(2, detail.ItemIds.Count); Assert.False(detail.CanDelete);
        var overview = JsonSerializer.SerializeToElement(data.Overview());
        var originals = overview.GetProperty("categories").EnumerateArray().Single(c => c.GetProperty("name").GetString() == "originals");
        Assert.Equal(4, originals.GetProperty("count").GetInt32()); // two associations, one document, one raw response
        Assert.Equal(before, Codec.Serialize(store.InspectData()));
        Assert.Throws<WorkflowException>(() => data.Entities(false, null, null, false, -1, 50));
    }
    [Fact]
    public void ConfigurationAndRawDetailsExcludeCurrentAndNestedCredentials()
    {
        var (data, store, _) = Create();
        Plugin.Configuration.Sources[0].Credential = "source-secret-fixture";
        Plugin.Configuration.Sources[1].Credential = "raw-secret-fixture";
        Plugin.Configuration.ServiceSetup = new() { Connections = [new() { Id = "test", Name = "test", ApiKey = "connection-secret-fixture" }] };
        store.Put("raw", "fixture", new RawLyrics("raw-secret-fixture", RawResponse: "{\"authorization\":\"unknown-secret-fixture\",\"nested\":{\"api_key\":\"other-secret-fixture\"}}"));
        var config = Codec.Serialize(data.Configuration()); var raw = Codec.Serialize(data.Detail(new("raw", "fixture")));
        foreach (var secret in new[] { "source-secret-fixture", "raw-secret-fixture", "connection-secret-fixture", "unknown-secret-fixture", "other-secret-fixture" })
        { Assert.DoesNotContain(secret, config); Assert.DoesNotContain(secret, raw); }
        Assert.Contains("apiKeyPresent", config); Assert.Contains("authorizationPresent", raw);
        store.Put("raw", "opaque", new RawLyrics("hello", RawResponse: "Authorization: Bearer unknown-opaque-secret"));
        Assert.DoesNotContain("unknown-opaque-secret", Codec.Serialize(data.Detail(new("raw", "opaque"))));
        store.Put("raw", "url", new { original = "https://private-user:private-password@example.test/lyrics?token=private-query", rawResponses = new[] { "{\"accessToken\":\"private-access-token\"}" } });
        var redactedUrl = Codec.Serialize(data.Detail(new("raw", "url")));
        foreach (var secret in new[] { "private-user", "private-password", "private-query", "private-access-token" }) Assert.DoesNotContain(secret, redactedUrl);
    }
    [Fact]
    public async Task OriginalDeletionMatchesLyricsWindowAndRetainsSharedContent()
    {
        var (data, store, _) = Create(); var item = Guid.NewGuid(); var other = Guid.NewGuid();
        var first = Lyrics("first"); var second = Lyrics("second"); store.Save(item, first); store.Save(item, second); store.Save(other, second);
        var result = await Confirm(data, data.Preview(Guid.Empty, new(Targets: [Original(item, second.Hash)])));
        Assert.True(result.Complete); Assert.Equal(first.Hash, store.Selection(item).Lyrics!.Hash); Assert.NotNull(store.GetDocument(second.Hash));
        await Confirm(data, data.Preview(Guid.Empty, new(Targets: [Original(item, first.Hash)])));
        Assert.Null(store.Selection(item).Lyrics); Assert.True(store.DiscoverySuppressed(item));
        Assert.Equal(second.Hash, store.Selection(other).Lyrics!.Hash);
    }
    [Fact]
    public async Task ConfirmationBindsOwnerPhraseAndSnapshotAndIsSingleUse()
    {
        var (data, store, _) = Create(); var user = Guid.NewGuid(); var owner = Guid.NewGuid(); store.SaveAccountPreferences(user, new());
        var preview = data.Preview(owner, new("category", Category: "preferences"));
        Assert.Equal("DELETE", preview.Confirmation);
        Assert.Equal("confirmation_required", (await Assert.ThrowsAsync<WorkflowException>(() => data.Execute(owner, new(preview.Token, "wrong", true)))).Code);
        await Assert.ThrowsAsync<WorkflowException>(() => Confirm(data, preview));
        store.SaveAccountPreferences(user, new() { OriginalSize = 50 });
        Assert.Equal("data_changed", (await Assert.ThrowsAsync<WorkflowException>(() => Confirm(data, preview, owner))).Code);
        Assert.NotNull(store.AccountPreferences(user));
        preview = data.Preview(owner, new(Targets: [new("preferences", user.ToString("N"))]));
        await Confirm(data, preview, owner); Assert.Null(store.AccountPreferences(user));
        await Assert.ThrowsAsync<WorkflowException>(() => Confirm(data, preview, owner));
    }
    [Fact]
    public async Task CategorySnapshotDoesNotDeleteNewlyMatchingRecords()
    {
        var (data, store, _) = Create(); var one = Guid.NewGuid(); var two = Guid.NewGuid(); store.SaveAccountPreferences(one, new());
        var preview = data.Preview(Guid.Empty, new("category", Category: "preferences"));
        store.SaveAccountPreferences(two, new());
        await Confirm(data, preview);
        Assert.Null(store.AccountPreferences(one)); Assert.NotNull(store.AccountPreferences(two));
    }
    [Fact]
    public async Task AccountResetDoesNotAffectOtherAccountsOrSavedContent()
    {
        var (data, store, _) = Create(); var one = Guid.NewGuid(); var two = Guid.NewGuid(); var song = Guid.NewGuid(); var lyrics = Lyrics("shared"); store.Save(song, lyrics);
        foreach (var user in new[] { one, two }) { store.SaveAccountPreferences(user, new()); store.SaveSongPreferences(user, song, new("ja")); store.Put("auxiliary-choice", user.ToString("N") + ":" + lyrics.Hash + ":translation:en", new AuxiliarySelection("provider")); }
        await Confirm(data, data.Preview(Guid.Empty, new("preferences-reset", UserId: one)));
        Assert.Null(store.AccountPreferences(one)); Assert.NotNull(store.AccountPreferences(two)); Assert.NotNull(store.GetDocument(lyrics.Hash));
        Assert.Empty(data.Records(null, null, one, 0, 50).Items); Assert.NotEmpty(data.Records(null, null, two, 0, 50).Items);
    }
    [Fact]
    public async Task HistoryRemovalPreservesQuotaAndIndependentResultsAndSkipsActiveRequests()
    {
        var (data, store, _) = Create(); var user = Guid.NewGuid(); var song = Guid.NewGuid(); var lyrics = Lyrics("saved"); store.Save(song, lyrics);
        var finished = new Job { ItemId = song, UserId = user, State = "complete", Hash = lyrics.Hash };
        var active = new Job { ItemId = song, UserId = user, State = "pending", Hash = lyrics.Hash };
        store.Put("job", finished.Id, finished); store.Put("job", active.Id, active);
        var admissions = store.CountAdmissions(user, DateTime.UtcNow.AddDays(-1));
        var result = await Confirm(data, data.Preview(Guid.Empty, new("category", Category: "history")));
        Assert.Contains(result.Outcomes, r => r.Target.Id == finished.Id && r.Status == "deleted");
        Assert.Contains(result.Outcomes, r => r.Target.Id == active.Id && r.Status == "skipped");
        Assert.NotNull(store.GetJob(active.Id)); Assert.NotNull(store.GetDocument(lyrics.Hash)); Assert.Equal(admissions, store.CountAdmissions(user, DateTime.UtcNow.AddDays(-1)));
    }
    [Fact]
    public async Task SharedVersionRemovalClearsChoicesAndFencesLateGeneration()
    {
        var (data, store, _) = Create(); var song = Guid.NewGuid(); var other = Guid.NewGuid(); var lyrics = Lyrics("shared"); store.Save(song, lyrics); store.Save(other, lyrics);
        var profile = new GenerationProfile("AI", "endpoint", "model", "translation", "en", "ja", "", 0, 0, 1);
        var variant = new Variant("version", lyrics.Hash, "translation", "en", "AI", "model", new() { ["l0"] = "text" }, Profile: profile);
        store.Put("variant", variant.Key, variant); store.Put("auxiliary-choice", Guid.NewGuid().ToString("N") + ":" + lyrics.Hash + ":translation:en", new AuxiliarySelection(variant.Key));
        var job = new Job { ItemId = song, Hash = lyrics.Hash, State = "running", Profile = profile, VariantKey = variant.Key }; store.Put("job", job.Id, job);
        var preview = data.Preview(Guid.Empty, new(Targets: [new("variant", variant.Key)])); Assert.Equal(2, preview.Items.Single().ItemIds.Count);
        await Confirm(data, preview);
        Assert.Empty(store.All<AuxiliarySelection>("auxiliary-choice")); Assert.Null(store.GetVariant(variant.Key));
        Assert.False(store.CompleteGeneration(job, variant)); Assert.True(store.GetJob(job.Id)!.OutputDeleted);
        using var stale = store.Operation(new StoreAdmission(store.Epoch, 0, song)); store.Put("variant", variant.Key, variant); Assert.Null(store.GetVariant(variant.Key));
    }
    [Fact]
    public async Task TranscriptDependenciesAreExplainedAndSongContentDeletionUsesDependencyOrder()
    {
        var (data, store, _) = Create(); var item = Guid.NewGuid(); var user = Guid.NewGuid();
        var profile = new GenerationProfile("AI", "endpoint", "model", "transcription", "", "en", "", 0, 0, 1);
        var transcript = new Transcript(item, user, "transcript", "Hello", "Hello", "en", "word", [new("t0", "Hello", "", 0, 5, 0, 100)], [], profile, [], DateTimeOffset.UtcNow);
        store.Put("transcript", transcript.Id, transcript);
        var version = TranscriptBoundaries.Version(transcript, "local", new(), ["t0"], "fixture");
        store.CommitBoundary(item, transcript, version, store.SelectionIdentity(item));
        var detail = data.Detail(new("transcript", transcript.Id)); Assert.False(detail.CanDelete); Assert.Single(detail.Dependencies);
        var blocked = await Confirm(data, data.Preview(Guid.Empty, new(Targets: [new("transcript", transcript.Id)]))); Assert.Equal("skipped", blocked.Outcomes.Single().Status);
        var result = await Confirm(data, data.Preview(Guid.Empty, new("song-content", ItemId: item)));
        Assert.True(result.Complete); Assert.Null(store.Transcript(transcript.Id)); Assert.Empty(store.SavedOriginals(item));
    }
    [Fact]
    public async Task LibraryResetPreservesPreferencesAndFactoryResetClearsCredentialsButKeepsActivePath()
    {
        var (data, store, _) = Create(); var item = Guid.NewGuid(); var user = Guid.NewGuid();
        Plugin.Configuration.StoragePath = Path.Combine(Root, "pending-relocation"); Plugin.Configuration.Sources[0].Credential = "keep-for-library";
        store.Save(item, Lyrics("saved")); store.SaveAccountPreferences(user, new()); store.SaveSongPreferences(user, item, new("ja"));
        await Confirm(data, data.Preview(Guid.Empty, new("library-reset")));
        Assert.Empty(store.SavedOriginals(item)); Assert.NotNull(store.AccountPreferences(user)); Assert.Equal("keep-for-library", Plugin.Configuration.Sources[0].Credential);
        store.DeleteManagedRecord("preferences", user.ToString("N")); store.SaveAccountPreferences(user, new());
        Assert.NotEqual(0, ((Dictionary<string, long>)store.InspectBookkeeping())["deletion_revisions"]);
        var old = store.Admit(item);
        await Confirm(data, data.Preview(Guid.Empty, new("factory-reset")));
        Assert.Empty(store.InspectData()); Assert.Equal(store.ActiveStoragePath, Plugin.Configuration.StoragePath);
        Assert.Equal(0, ((Dictionary<string, long>)store.InspectBookkeeping())["deletion_revisions"]);
        Assert.All(Plugin.Configuration.Sources, source => Assert.Empty(source.Credential));
        using var stale = store.Operation(old); store.SaveAccountPreferences(user, new()); Assert.Null(store.AccountPreferences(user));
        using var restarted = new Store(store.ActiveStoragePath); Assert.Empty(restarted.InspectData());
    }
    [Fact]
    public async Task PartialResetReportsItsPhaseAndCanBeRetried()
    {
        var (data, store, audio) = Create(); var item = Guid.NewGuid(); store.Save(item, Lyrics("retained")); audio.FailClear = true;
        var result = await Confirm(data, data.Preview(Guid.Empty, new("factory-reset")));
        Assert.False(result.Complete); Assert.Equal("audio staging", result.Phase); Assert.False(store.IsResetting); Assert.NotEmpty(store.SavedOriginals(item));
        Plugin.UpdateConfiguration(new Configuration());
        audio.FailClear = false; Assert.True((await Confirm(data, data.Preview(Guid.Empty, new("factory-reset")))).Complete); Assert.Empty(store.InspectData());
    }
    [Fact]
    public async Task ConfigurationPersistenceFailureDoesNotReportACompletedFactoryReset()
    {
        var owner = TestHost.CreatePlugin(Path.Combine(Root, "settings"));
        var (data, store, _) = Create(owner); var song = Guid.NewGuid(); store.Save(song, Lyrics("saved"));
        File.Delete(owner.ConfigurationFilePath); Directory.CreateDirectory(owner.ConfigurationFilePath);
        var result = await Confirm(data, data.Preview(Guid.Empty, new("factory-reset")));
        Assert.False(result.Complete); Assert.Equal("configuration", result.Phase); Assert.Single(store.SavedOriginals(song)); Assert.False(store.IsResetting);
        Directory.Delete(owner.ConfigurationFilePath);
        Assert.True((await Confirm(data, data.Preview(Guid.Empty, new("factory-reset")))).Complete);
    }
    [Fact]
    public void MaintenanceRejectsConfigurationChangesAndDatabaseWrites()
    {
        var (_, store, _) = Create(); var user = Guid.NewGuid();
        Plugin.BeginDataMaintenance();
        try { Assert.Equal("reset_in_progress", Assert.Throws<WorkflowException>(() => Plugin.UpdateConfiguration(new Configuration())).Code); }
        finally { Plugin.EndDataMaintenance(); }
        Assert.True(store.BeginReset());
        try
        {
            Assert.Throws<WorkflowException>(() => store.WithDataWriteLock(() => true));
            store.SaveAccountPreferences(user, new()); Assert.Null(store.AccountPreferences(user));
        }
        finally { store.EndReset(); }
    }
    [Fact]
    public async Task ProgressUpdatesDoNotInvalidateDeletionButJobStateChangesDo()
    {
        var (data, store, _) = Create(); var song = Guid.NewGuid(); var lyrics = Lyrics("saved"); store.Save(song, lyrics);
        var job = new Job { ItemId = song, Hash = lyrics.Hash, State = "running" }; store.Put("job", job.Id, job);
        var preview = data.Preview(Guid.Empty, new(Targets: [Original(song, lyrics.Hash)]));
        job.Progress = 50; job.Stage = "Progress changed"; store.SaveJob(job);
        Assert.True((await Confirm(data, preview)).Complete); Assert.Empty(store.SavedOriginals(song));
        store.Save(song, lyrics); job = new Job { ItemId = song, Hash = lyrics.Hash, State = "running", DeletionRevision = store.FreshAdmission(song).Revision }; store.Put("job", job.Id, job);
        preview = data.Preview(Guid.Empty, new(Targets: [Original(song, lyrics.Hash)]));
        job.State = "complete"; store.SaveJob(job);
        Assert.Equal("data_changed", (await Assert.ThrowsAsync<WorkflowException>(() => Confirm(data, preview))).Code);
    }
    [Fact]
    public async Task SongContentCleanupCannotDeleteAnotherSongsSharedOriginal()
    {
        var (data, store, _) = Create(); var item = Guid.NewGuid(); var other = Guid.NewGuid(); var lyrics = Lyrics("shared");
        store.Save(item, lyrics); store.Save(other, lyrics);
        var preview = data.Preview(Guid.Empty, new("song-content", ItemId: item));
        Assert.DoesNotContain(preview.Items, r => r.Target == Original(other, lyrics.Hash));
        await Confirm(data, preview);
        Assert.Empty(store.SavedOriginals(item)); Assert.Single(store.SavedOriginals(other)); Assert.NotNull(store.GetDocument(lyrics.Hash));
    }
    [Fact]
    public async Task CleanupOnlyRemovesExpiredQuotaEntries()
    {
        var (data, store, _) = Create(); var user = Guid.NewGuid();
        store.Put("job-admission", "old", new { userId = user, created = DateTime.UtcNow.AddDays(-2) });
        store.Put("job-admission", "recent", new { userId = user, created = DateTime.UtcNow });
        await Confirm(data, data.Preview(Guid.Empty, new("expired")));
        Assert.Null(store.Get<object>("job-admission", "old")); Assert.NotNull(store.Get<object>("job-admission", "recent"));
        Assert.False(data.Detail(new("job-admission", "recent")).CanDelete);
    }
    [Fact]
    public async Task TemporaryCleanupProtectsRetainedDocumentsAndNeverWritesMediaPaths()
    {
        var (data, store, _) = Create(); var item = Guid.NewGuid(); var lyrics = Lyrics("retained"); store.Save(item, lyrics);
        store.CacheCandidate(new("QQ", "id", "candidate", "artist", "album", null, 80), DateTimeOffset.UtcNow.AddDays(-2));
        var media = Path.Combine(Root, "media.lrc"); File.WriteAllText(media, "keep");
        var result = await Confirm(data, data.Preview(Guid.Empty, new("expired")));
        Assert.True(result.Complete); Assert.Empty(store.All<Candidate>("candidate")); Assert.NotNull(store.GetDocument(lyrics.Hash)); Assert.Equal("keep", File.ReadAllText(media));
    }
}
