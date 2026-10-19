using System.Net;
using System.Text;
using System.Text.Json;
using LyricBridge;
using Xunit;

public sealed class ReviewPlanningTests : StorageFixture
{
    private static readonly GenerationProfile Profile = new("AI", "fixture", "model", "boundary-review", "", "ja", "", 0, 0, 3);
    private static Transcript Source(int count = 60)
    {
        var tokens = Enumerable.Range(0, count).Select(i => new TimedToken("t" + i, i % 10 == 9 ? "ね。" : "あ", "", i + i / 10, i + i / 10 + (i % 10 == 9 ? 2 : 1), i * 10_000_000L, i * 10_000_000L + 2_000_000)).ToList();
        return new(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid().ToString("N"), TranscriptBoundaries.CanonicalText(tokens), "", "ja", "word", tokens, [], Profile, [], DateTimeOffset.UtcNow);
    }
    private static BoundaryVersion Version(Transcript source) => TranscriptBoundaries.Version(source, "local", new(), source.Tokens.Where((_, i) => i % 10 == 9 || i == source.Tokens.Count - 1).Select(t => t.Id).ToList(), "test");
    [Theory]
    [InlineData("{\"data\":[{\"id\":\"fixture\",\"context_length\":64000,\"top_provider\":{\"context_length\":32000,\"max_completion_tokens\":4096}}]}", 32000)]
    [InlineData("{\"data\":[{\"id\":\"other\",\"context_length\":64000}]}", 0)]
    [InlineData("{\"data\":[{\"id\":\"fixture\",\"context_length\":\"invalid\"}]}", 0)]
    [InlineData("{\"data\":[{\"id\":\"fixture\"}]}", 0)]
    public async Task MetadataLookupMatchesExactlyAndTreatsOptionalLimitsSafely(string raw, int expected)
    {
        using var http = new HttpClient(new ResponseHandler(request =>
        {
            Assert.Equal("https://fixture.invalid/v1/models", request.RequestUri!.ToString()); Assert.Equal("Bearer", request.Headers.Authorization!.Scheme);
            return new(HttpStatusCode.OK) { Content = new StringContent(raw, Encoding.UTF8, "application/json") };
        }));
        using var provider = new TranscriptionProvider(http);
        var result = await provider.FetchModelLimits(new() { Endpoint = "https://fixture.invalid/v1", Model = "fixture", ApiKey = "synthetic" }, TestContext.Current.CancellationToken);
        Assert.Equal(expected, result?.ContextWindow ?? 0);
    }
    [Fact]
    public void IdenticalReviewKeepsDurableResultAfterHistoryRemovalWithoutDuplicatingBoundaries()
    {
        using var store = new Store(Root); var source = Source(10); var local = Version(source);
        store.Put("transcript", source.Id, source); store.Put("boundary-version", local.Id, local);
        var job = new Job { ItemId = source.ItemId, UserId = source.UserId, Hash = source.Id, TaskKind = "boundary-review", State = "running", Profile = Profile, Review = new(source.Id, local.Id, new()), Request = new() { OptionName = "Review fixture" } };
        store.Put("job", job.Id, job);
        Assert.True(store.CompleteTranscript(job, null, local with { Origin = "AI", Profile = Profile }));
        Assert.Single(store.BoundaryVersions(source.Id)); Assert.Equal("local", store.BoundaryVersions(source.Id)[0].Origin);
        var result = Assert.Single(store.ReviewResults(source.Id)); Assert.Equal(local.Id, result.VersionId); Assert.Equal("Review fixture", result.OptionName);
        store.RemoveFinishedJobs([job.Id]); Assert.Equal(result, Assert.Single(store.ReviewResults(source.Id)));
        store.DeleteTranscript(source.ItemId, source.Id, source.UserId, true); Assert.Empty(store.ReviewResults(source.Id));
    }
    [Fact]
    public void SnapshotReviewRestartsAfterItsSavedInputEntryWasDeleted()
    {
        var source = Source(10); var version = Version(source); string jobId;
        using (var store = new Store(Root))
        {
            store.Put("transcript", source.Id, source);
            var entry = store.SaveEntry(source, version, source.UserId, false);
            var job = new Job { ItemId = source.ItemId, UserId = source.UserId, Hash = source.Id, TaskKind = "boundary-review", State = "queued", Review = new(source.Id, version.Id, new(), Snapshot: version) };
            store.Put("job", job.Id, job); jobId = job.Id;
            store.DeleteEntry(source.ItemId, source.Id, entry.Id, source.UserId, false);
            Assert.Empty(store.BoundaryVersions(source.Id));
        }
        using (var store = new Store(Root))
        using (var provider = new TranscriptionProvider())
        {
            var task = new BoundaryReviewTask(_ => new() { Endpoint = "https://fixture.invalid/v1", Model = "fixture" }, store, provider, new LinguisticBoundaries());
            Assert.Equal(1, task.Plan(store.GetJob(jobId)!).RequestCount);
            Assert.Empty(store.SavedEntries(source.Id));
        }
    }
    private sealed class WaitingHandler : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, token);
            return new(HttpStatusCode.OK);
        }
    }
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ReviewTimeoutIdentifiesBatchWhileUserCancellationRemainsCancellation(bool cancel)
    {
        var source = Source(10); var version = Version(source);
        using var http = new HttpClient(new WaitingHandler()); using var provider = new TranscriptionProvider(http);
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        if (cancel) stop.CancelAfter(TimeSpan.FromMilliseconds(50));
        var request = provider.ReviewBatch(source, version, new() { Endpoint = "https://fixture.invalid/v1", Model = "fixture", TimeoutSeconds = 5 }, new(0, 10, 0, 10, 0, false), 1, 3, "safe-reference", stop.Token);
        if (cancel) await Assert.ThrowsAnyAsync<OperationCanceledException>(() => request);
        else
        {
            var error = await Assert.ThrowsAsync<ServiceFailure>(() => request);
            Assert.Equal("service_timeout", error.Code); Assert.Contains("batch 2 of 3", error.Message); Assert.Contains("5 seconds", error.Message);
        }
    }
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ReviewRetryReusesValidatedCheckpointAndCommitsOnlyAfterAllBatches(bool changeConfiguration)
    {
        var source = Source(240); var version = Version(source); var store = new Store(Path.Combine(Root, "review"));
        using var ownedStore = store;
        store.Put("transcript", source.Id, source); store.Put("boundary-version", version.Id, version);
        var config = new ServiceConfig { Endpoint = "https://fixture.invalid/v1", Model = "fixture", ModelContextWindow = 8192 };
        var calls = 0; var fail = true;
        using var http = new HttpClient(new TranscriptionTests.AsyncHandler(async request =>
        {
            calls++;
            if (fail && calls == 2) return new(HttpStatusCode.ServiceUnavailable);
            using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
            using var input = JsonDocument.Parse(body.RootElement.GetProperty("messages")[1].GetProperty("content").GetString()!);
            return new(HttpStatusCode.OK) { Content = new StringContent(Codec.Serialize(new { choices = new[] { new { message = new { content = Codec.Serialize(new { endTokenIds = new[] { input.RootElement.GetProperty("requiredFinalEndTokenId").GetString() } }) } } } })) };
        }));
        using var provider = new TranscriptionProvider(http); var strategy = new LinguisticBoundaries();
        var task = new BoundaryReviewTask(_ => config, store, provider, strategy);
        var job = new Job { TaskKind = "boundary-review", State = "running", ItemId = source.ItemId, UserId = source.UserId, Hash = source.Id, Review = new(source.Id, version.Id, new(), Snapshot: version) };
        job.Profile = task.Profile(job); store.Put("job", job.Id, job);
        await Assert.ThrowsAsync<ServiceFailure>(() => task.Execute(job, new Progress<int>(), TestContext.Current.CancellationToken));
        Assert.Single(store.ReviewCheckpoints(job.Id)); Assert.Single(store.BoundaryVersions(source.Id));
        var completed = store.ReviewCheckpoints(job.Id)[0]; fail = false;
        // A fresh repository and handler must recover the same checkpoint after restart.
        using var resumed = new Store(store.ActiveStoragePath);
        var resumedTask = new BoundaryReviewTask(_ => config, resumed, provider, strategy);
        job = resumed.GetJob(job.Id)!;
        if (changeConfiguration) { config.Model = "different-model"; job.Profile = resumedTask.Profile(job); resumed.SaveJob(job); }
        await resumedTask.Execute(job, new Progress<int>(), TestContext.Current.CancellationToken);
        Assert.Equal(job.ReviewPlan!.RequestCount + (changeConfiguration ? 2 : 1), calls); Assert.Equal("complete", resumed.GetJob(job.Id)!.State);
        if (changeConfiguration) Assert.NotEqual(completed.Identity, job.ReviewPlan.Identity);
        else Assert.Equal(completed.Identity, job.ReviewPlan.Identity);
        Assert.Empty(resumed.ReviewCheckpoints(job.Id)); resumedTask.Release(job);
    }
}
