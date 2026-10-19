using System.Net;
using LyricBridge;
using Xunit;

public sealed class TranscriptionWorkflowTests : TestHost
{
    [Theory]
    [InlineData(false, false, true, true, "requests_disabled")]
    [InlineData(true, false, false, true, "transcription_disabled")]
    [InlineData(true, false, true, false, "service_not_configured")]
    [InlineData(false, true, true, true, null)]
    [InlineData(true, false, true, true, null)]
    public void CapabilitiesExplainAvailabilityWithoutExposingCredentials(bool administrator, bool allowRequests, bool enabled, bool configured, string? reason)
    {
        var plugin = Plugin;
        plugin.Configuration.AllowUserRequests = allowRequests;
        var setup = ServiceSetup.Defaults();
        var option = setup.Options.Single(o => o.Capability == "transcription"); option.Enabled = enabled; option.Model = "audio-model";
        var connection = setup.Connections.Single(c => c.Id == option.ConnectionId); connection.Endpoint = configured ? "https://audio.example/v1" : ""; connection.ApiKey = "private-test-key";
        plugin.Configuration.ServiceSetup = setup;
        var controller = new TranscriptionApi(null!, null!, null!, null!, null!, null!, new(() => plugin));
        var claims = administrator ? new[] { new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.Role, Jellyfin.Api.Constants.UserRoles.Administrator) } : [];
        controller.ControllerContext = new() { HttpContext = new Microsoft.AspNetCore.Http.DefaultHttpContext { User = new(new System.Security.Claims.ClaimsIdentity(claims, "fixture")) } };
        var result = Assert.IsType<Microsoft.AspNetCore.Mvc.JsonResult>(controller.Capabilities());
        var json = Codec.Serialize(result.Value);
        using var payload = System.Text.Json.JsonDocument.Parse(json);
        Assert.Equal(reason, payload.RootElement.GetProperty("unavailableReason").GetString());
        Assert.Equal(reason == null, payload.RootElement.GetProperty("canTranscribe").GetBoolean());
        Assert.DoesNotContain("private-test-key", json);
    }
    private sealed class Audio(string root) : IAudioPreparation
    {
        public bool Released { get; private set; }
        public int Chunks { get; set; } = 2;
        public Task<PreparedAudio> Prepare(Job job, TranscriptionConfig settings, IProgress<int> progress, CancellationToken token)
        {
            Directory.CreateDirectory(root); var path = Path.Combine(root, "fixture.flac"); File.WriteAllBytes(path, [1, 2, 3]); return Task.FromResult(new PreparedAudio(path, 40_000_000));
        }
        public Task<List<PreparedAudio>> PlanChunks(Job job, PreparedAudio source, TranscriptionConfig settings, CancellationToken token) => Task.FromResult(Enumerable.Range(0, Chunks).Select(i => source with { StartTicks = i * 20_000_000, DurationTicks = 20_000_000 }).ToList());
        public void Release(Job job) => Released = true;
    }
    private static async Task<Job> Until(Generation generation, string id, string state)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken); deadline.CancelAfter(TimeSpan.FromSeconds(10));
        while (true)
        {
            var job = generation.GetJob(id)!;
            if (job.State == state) return job;
            await Task.Delay(20, deadline.Token);
        }
    }
    private static Job Request() => new() { ItemId = Guid.NewGuid(), UserId = Guid.NewGuid(), Hash = Guid.NewGuid().ToString("N"), TaskKind = "transcription", Audio = new(), Request = new() { Kind = "transcription", Service = "Transcription" } };
    [Fact]
    public async Task ChunkRetryUsesCheckpointsAndOffsetsWithoutDuplicatingPaidCalls()
    {
        var token = TestContext.Current.CancellationToken;
        using var store = Own(new Store(Root)); using var languages = Own(new LanguageServices(ServiceFixtures.Catalog(() => [new() { Name = "Google" }])));
        var calls = 0;
        using var http = new HttpClient(new ResponseHandler(_ =>
        {
            calls++;
            if (calls is 1 or 3) return new(HttpStatusCode.RequestEntityTooLarge);
            return new(HttpStatusCode.OK) { Content = new StringContent("{\"language\":\"en\",\"text\":\"Hello\",\"words\":[{\"word\":\"Hello\",\"start\":0,\"end\":1}]}") };
        }));
        using var provider = Own(new TranscriptionProvider(http));
        var audio = new Audio(Root); var settings = new TranscriptionConfig { Enabled = true };
        var handler = new TranscriptionTask(_ => settings, store, audio, provider);
        using var generation = Own(new Generation(() => new(true, true, 5, 3), store, languages, handlers: [handler]));
        await generation.StartAsync(token);
        var request = generation.RequestRemote(Request(), true);
        var first = await Until(generation, request.Id, "failed");
        Assert.Equal("audio_too_large", first.Failure!.Code); Assert.Equal(1, calls);
        generation.RetryAudio(first.Id, new(AllowChunking: true), first.UserId, true);
        var partial = await Until(generation, first.Id, "failed");
        Assert.Equal(3, calls); Assert.Single(store.Chunks(first.Id));
        generation.Action(partial.Id, "retry", partial.UserId, true);
        var complete = await Until(generation, first.Id, "complete");
        Assert.Equal(4, calls); Assert.Equal(1, store.CountAdmissions(first.UserId, DateTime.UtcNow.AddDays(-1)));
        var transcript = store.Transcript(complete.ResultId!)!;
        Assert.Equal(new long[] { 0, 20_000_000 }, transcript.Tokens.Select(t => t.Start));
        Assert.Equal("Hello Hello", transcript.Text); Assert.Equal(2, transcript.RawResponses.Count);
        Assert.Contains(transcript.Warnings, w => w.Code == "chunk_seams");
        Assert.Empty(store.SavedOriginals(first.ItemId));
        await generation.StopAsync(token); Assert.True(audio.Released);
    }
    [Fact]
    public async Task ExplicitCancellationStopsHttpAndCannotPublishOutput()
    {
        var token = TestContext.Current.CancellationToken;
        using var store = Own(new Store(Root)); using var languages = Own(new LanguageServices(ServiceFixtures.Catalog(() => [new() { Name = "Google" }])));
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var stopped = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var http = new HttpClient(new Cancellable(entered, stopped)); using var provider = Own(new TranscriptionProvider(http));
        var audio = new Audio(Root); var handler = new TranscriptionTask(_ => new() { Enabled = true }, store, audio, provider);
        using var generation = Own(new Generation(() => new(true, true, 5, 3), store, languages, handlers: [handler]));
        await generation.StartAsync(token); var job = generation.RequestRemote(Request(), true);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5), token);
        generation.Action(job.Id, "cancel", job.UserId, false);
        await stopped.Task.WaitAsync(TimeSpan.FromSeconds(5), token);
        await generation.StopAsync(token);
        Assert.Equal("cancelled", generation.GetJob(job.Id)!.State); Assert.Null(store.Transcript(job.Hash)); Assert.True(audio.Released);
    }
    private sealed class Cancellable(TaskCompletionSource entered, TaskCompletionSource stopped) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            entered.SetResult();
            try { await Task.Delay(Timeout.Infinite, token); return new(HttpStatusCode.OK); }
            finally { stopped.TrySetResult(); }
        }
    }
    [Fact]
    public async Task ConfigurationReplacementRequiresExplicitRetryAndFreshApproval()
    {
        var token = TestContext.Current.CancellationToken;
        using var store = Own(new Store(Root)); using var languages = Own(new LanguageServices(ServiceFixtures.Catalog(() => [new() { Name = "Google" }])));
        using var provider = Own(new TranscriptionProvider(new HttpClient(new ResponseHandler(_ => new(HttpStatusCode.OK)))));
        var settings = new TranscriptionConfig { Enabled = true, Model = "first" };
        var handler = new TranscriptionTask(_ => settings, store, new Audio(Root), provider);
        using var generation = Own(new Generation(() => new(true, false, 5, 3), store, languages, handlers: [handler]));
        var input = Request(); var job = generation.RequestRemote(input, false); Assert.Equal("pending", job.State);
        settings = new() { Enabled = true, Model = "replacement" }; generation.ConfigurationChanged();
        Assert.Equal("settings_changed", generation.GetJob(job.Id)!.State);
        generation.Action(job.Id, "retry", job.UserId, false);
        Assert.Equal("replacement", generation.GetJob(job.Id)!.Profile!.Model); Assert.Equal("pending", generation.GetJob(job.Id)!.State);
        await generation.StopAsync(token);
    }
    [Fact]
    public void ResetAndOriginalDeletionFencesPreventRemotePublication()
    {
        using var store = Own(new Store(Root));
        var job = Request(); var ticket = store.Admit(job.ItemId); job.DeletionRevision = ticket.Revision; job.State = "running";
        Assert.True(store.PersistRequest(job, ticket.Epoch));
        Assert.True(store.BeginReset()); store.ResetManagedLibrary(); store.EndReset();
        var transcript = TranscriptionResponse.Parse("{\"segments\":[{\"text\":\"hi\",\"start\":0,\"end\":1}]}", job.ItemId, job.UserId, job.Hash, new("fixture", "fixture", "fixture", "transcription", "", "auto", "", 0, 0, 1));
        var version = TranscriptBoundaries.Version(transcript, "local", new(), ["t0"], "fixture");
        Assert.False(store.CompleteTranscript(job, transcript, version)); Assert.Null(store.Transcript(job.Hash));
    }
}
