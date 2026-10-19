using Xunit;
using LyricBridge;
using System.Net;
using System.Text.Json;

public sealed class GenerationProfileTests : LanguageFixture
{
    [Fact]
    public async Task QueuedAndRunningJobsKeepExecutionSnapshots()
    {
        var root = Root;
        var config = Services.First(s => s.Name == "AI");
        var original = (config.Endpoint, config.Model, config.ApiKey);
        try
        {
            config.Endpoint = "http://synthetic.invalid/endpoint-secret/v1";
            config.Model = "model-a";
            config.ApiKey = "credential-secret";
            var handler = new SnapshotHandler();
            var services = Own(new LanguageServices(ServiceFixtures.Catalog(() => Services), new HttpClient(handler)));
            var store = Own(new Store(Path.Combine(root, "generation-profile")));
            var doc = new RichLyrics { Hash = "profile-fixture", Lines = [new() { Id = "line", Text = "hello", Language = "en" }] };
            store.Put("document", doc.Hash, doc);
            var worker = Own(new Generation(Policy, store, services));
            var job = worker.Request(Guid.NewGuid(), Guid.NewGuid(), doc, new() { OptionId = "translation-AI", Service = "AI" }, true);
            var originalKey = job.CacheKey;
            Assert.True(!Codec.Serialize(job).Contains("secret"), "profile must not persist endpoint or credential secrets");
            config.Model = "model-b";
            await worker.StartAsync(TestContext.Current.CancellationToken);
            await Until(() => store.Get<Job>("job", job.Id)?.State == "settings_changed");
            Assert.True(handler.Calls == 0, "changed queued profile must not call service");
            var retry = worker.Action(job.Id, "retry", job.UserId, true);
            Assert.True(retry.Id == job.Id && retry.CacheKey != originalKey, "retry retains admission and changes identity");
            await handler.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
            config.Model = "model-c";
            config.ApiKey = "rotated-secret";
            handler.Release.SetResult();
            await Until(() => store.Get<Job>("job", job.Id)?.State == "complete");
            var variant = store.Get<Variant>("variant", job.VariantKey)!;
            Assert.True(handler.Model == "model-b" && variant.Model == "model-b", "running execution and provenance use captured model");
            Assert.True(variant.Profile == retry.Profile, "saved version retains generation profile");
            Assert.True(variant.CacheKey == retry.CacheKey, "result keeps dispatched identity");
            await worker.StopAsync(TestContext.Current.CancellationToken);
            var before = services.CurrentProfile(new() { OptionId = "translation-AI", Service = "AI" });
            config.ApiKey = "another-secret";
            Assert.True(before == services.CurrentProfile(new() { OptionId = "translation-AI", Service = "AI" }), "credential rotation preserves profile");
        }
        finally { (config.Endpoint, config.Model, config.ApiKey) = original; }
    }

    private static async Task Until(Func<bool> condition)
    {
        for (var i = 0; i < 100; i++)
        {
            if (condition())
                return;
            await Task.Delay(50, TestContext.Current.CancellationToken);
        }
        throw new TimeoutException("Generation state did not settle.");
    }
    private sealed class SnapshotHandler : HttpMessageHandler
    {
        public int Calls;
        public string? Model;
        public TaskCompletionSource Entered = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release = new(TaskCreationOptions.RunContinuationsAsynchronously);
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            Calls++;
            using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(token));
            Model = body.RootElement.GetProperty("model").GetString();
            Entered.SetResult();
            await Release.Task.WaitAsync(token);
            return new(HttpStatusCode.OK)
            {
                Content = new StringContent(Codec.Serialize(new
                {
                    choices = new[] { new { message = new { content = "{\"lines\":[{\"id\":\"line\",\"text\":\"translated\"}]}" } } }
                }))
            };
        }
    }
}
