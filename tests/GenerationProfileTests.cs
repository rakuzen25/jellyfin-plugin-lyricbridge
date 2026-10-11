using LyricBridge;
using System.Net;
using System.Text.Json;

public static class GenerationProfileTests
{
    public static async Task Run(string root)
    {
        var config = Plugin.Instance.Configuration.Services.First(s => s.Name == "AI");
        var original = (config.Endpoint, config.Model, config.ApiKey);
        try
        {
            config.Endpoint = "http://synthetic.invalid/v1?secret=endpoint-secret";
            config.Model = "model-a";
            config.ApiKey = "credential-secret";
            var handler = new SnapshotHandler();
            var services = new LanguageServices(() => Plugin.Instance.Configuration.Services, new HttpClient(handler));
            var store = new Store(Path.Combine(root, "generation-profile"));
            var doc = new RichLyrics { Hash = "profile-fixture", Lines = [new() { Id = "line", Text = "hello", Language = "en" }] };
            store.Put("document", doc.Hash, doc);
            using var worker = new Generation(TestConfiguration.Policy, store, services);
            var job = worker.Request(Guid.NewGuid(), Guid.NewGuid(), doc, new() { Service = "AI" }, true);
            var originalKey = job.CacheKey;
            Check(!Codec.Serialize(job).Contains("secret"), "profile must not persist endpoint or credential secrets");
            config.Model = "model-b";
            await worker.StartAsync(CancellationToken.None);
            await Until(() => store.Get<Job>("job", job.Id)?.State == "settings_changed");
            Check(handler.Calls == 0, "changed queued profile must not call service");
            var retry = worker.Action(job.Id, "retry", job.UserId, true);
            Check(retry.Id == job.Id && retry.CacheKey != originalKey, "retry retains admission and changes identity");
            await handler.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            config.Model = "model-c";
            config.ApiKey = "rotated-secret";
            handler.Release.SetResult();
            await Until(() => store.Get<Job>("job", job.Id)?.State == "complete");
            var variant = store.Get<Variant>("variant", job.VariantKey)!;
            Check(handler.Model == "model-b" && variant.Model == "model-b", "running execution and provenance use captured model");
            Check(variant.Profile == retry.Profile, "saved version retains generation profile");
            Check(variant.CacheKey == retry.CacheKey, "result keeps dispatched identity");
            await worker.StopAsync(CancellationToken.None);
            var before = services.CurrentProfile(new() { Service = "AI" });
            config.ApiKey = "another-secret";
            Check(before == services.CurrentProfile(new() { Service = "AI" }), "credential rotation preserves profile");
        }
        finally { (config.Endpoint, config.Model, config.ApiKey) = original; }
        Console.WriteLine("PASS: queued configuration invalidation, retry identity, running snapshot, provenance and credential redaction.");
    }

    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static async Task Until(Func<bool> condition)
    {
        for (var i = 0; i < 100; i++) { if (condition()) return; await Task.Delay(50); }
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
            return new(HttpStatusCode.OK) { Content = new StringContent(Codec.Serialize(new { choices = new[] { new { message = new { content = "{\"lines\":[{\"id\":\"line\",\"text\":\"translated\"}]}" } } } })) };
        }
    }
}
