using LyricBridge;
using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Logging;
public static class AiThinkingTests
{
    static void Check(bool ok, string name) { if (!ok) throw new Exception(name); }
    public static async Task Run(string root)
    {
        var config = Plugin.Instance.Configuration.Services.First(s => s.Name == "AI"); var old = (config.Endpoint, config.Model, config.ReasoningEffort, config.TimeoutSeconds, config.ApiKey);
        var httpLog = new CaptureLogger<LanguageServices>(); var handler = new Handler(); var services = new LanguageServices(() => Plugin.Instance.Configuration.Services, new HttpClient(handler), httpLog); var doc = new RichLyrics { Hash = "thinking-fixture", Lines = [new() { Id = "line", Text = "Hello", Language = "en" }] };
        try
        {
            config.Endpoint = "http://synthetic/v1"; config.Model = "fixture"; config.ReasoningEffort = ""; config.ApiKey = "synthetic-secret-never-log";
            var request = new GenerationRequest { Service = "AI" }; var defaultKey = services.Key(doc, request);
            await services.Generate(doc, request, new Progress<int>(), CancellationToken.None);
            Check(!handler.Body!.RootElement.TryGetProperty("reasoning_effort", out _) && handler.Body.RootElement.GetProperty("temperature").GetInt32() == 0, "default omits optional reasoning settings"); var prompt = handler.Body.RootElement.GetProperty("messages")[0].GetProperty("content").GetString()!; Check(prompt.Contains("ONLY its translation") && prompt.Contains("Do not add romaji") && !prompt.Contains("For pronunciation"), "translation prompt excludes pronunciation task"); var oldCache = Codec.Hash(Codec.Serialize(new { doc.Hash, request.Kind, request.Language, request.SourceLanguage, request.Service, config.Model, config.Endpoint, Version = 1 })); Check(oldCache != defaultKey, "corrected prompt gets fresh cache identity"); request.Kind = "pronunciation"; await services.Generate(doc, request, new Progress<int>(), CancellationToken.None); Check(handler.Body.RootElement.GetProperty("messages")[0].GetProperty("content").GetString()!.Contains("Do not translate"), "pronunciation prompt excludes translation task"); request.Kind = "translation"; Check(httpLog.Text.Contains("HTTP sending") && httpLog.Text.Contains("status 200") && httpLog.Text.Contains("gen-fixture"), "HTTP phases and provider ID logged"); Check(!httpLog.Text.Contains("Hello") && !httpLog.Text.Contains("/v1"), "HTTP logs exclude lyrics and path");
            config.ReasoningEffort = "high"; Check(defaultKey != services.Key(doc, request), "thinking level changes cache");
            var store = new Store(Path.Combine(root, "thinking")); var generation = new Generation(TestConfiguration.Policy, store, services); var job = generation.Request(Guid.NewGuid(), Guid.NewGuid(), doc, request, true);
            Check(job.Request.TimeoutSeconds == 15, "timeout snapshotted"); Check(job.Request.ReasoningEffort == "high", "admin level snapshotted on request"); config.ReasoningEffort = "low";
            foreach (var level in LanguageServices.ReasoningLevels.Where(s => s != ""))
            {
                request.ReasoningEffort = level; await services.Generate(doc, request, new Progress<int>(), CancellationToken.None);
                Check(handler.Body!.RootElement.GetProperty("reasoning_effort").GetString() == level && !handler.Body.RootElement.TryGetProperty("temperature", out _), "explicit level sent without temperature");
            }
            handler.DelayMilliseconds = 11000; request.TimeoutSeconds = 30; await services.Generate(doc, request, new Progress<int>(), CancellationToken.None); handler.DelayMilliseconds = 0; Check(httpLog.Text.Contains("HTTP waiting for response") && !httpLog.Text.Contains(config.ApiKey), "waiting phase and secret redaction");
            config.TimeoutSeconds = 5; var timeoutStore = new Store(Path.Combine(root, "thinking-timeout")); timeoutStore.Put("document", doc.Hash, doc); var log = new CaptureLogger<Generation>(); var timeoutService = new LanguageServices(() => Plugin.Instance.Configuration.Services, new HttpClient(new TimeoutHandler())); var worker = new Generation(TestConfiguration.Policy, timeoutStore, timeoutService, log); var timeoutJob = worker.Request(Guid.NewGuid(), Guid.NewGuid(), doc, new() { Service = "AI" }, true);
            await worker.StartAsync(CancellationToken.None); for (int attempt = 0; attempt < 70 && timeoutStore.Get<Job>("job", timeoutJob.Id)?.State != "failed"; attempt++) await Task.Delay(100);
            await worker.StopAsync(CancellationToken.None); var failed = timeoutStore.Get<Job>("job", timeoutJob.Id)!; Check(failed.State == "failed" && failed.Error!.Contains("5-second"), "timeout explains actual limit"); Check(log.Text.Contains(failed.Failure!.DiagnosticId!) && log.Text.Contains("service_timeout") && log.Text.Contains(timeoutJob.Id), "failure logged with matching diagnostic"); config.TimeoutSeconds = 30; var retried = worker.Action(timeoutJob.Id, "retry", timeoutJob.UserId, true); Check(retried.Request.TimeoutSeconds == 30, "retry adopts latest timeout"); Check(!log.Text.Contains(doc.Lines[0].Text) && !log.Text.Contains(config.Endpoint), "logs omit lyrics and endpoint");
            handler.Reject = true; try { await services.Generate(doc, request, new Progress<int>(), CancellationToken.None); throw new Exception("AI rejection ignored"); } catch (ServiceFailure e) { Check(e.Code == "ai_request_rejected" && !e.Message.Contains("sensitive"), "safe actionable rejection"); }
        }
        finally { (config.Endpoint, config.Model, config.ReasoningEffort, config.TimeoutSeconds, config.ApiKey) = old; handler.Body?.Dispose(); }
        Console.WriteLine("PASS: AI thinking payloads, obsolete cache identity rejection, level cache separation, request snapshot, safe unsupported-setting errors.");
    }
    sealed class TimeoutHandler : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) { await Task.Delay(Timeout.Infinite, token); throw new Exception("sensitive internal exception"); }
    }
    sealed class CaptureLogger<T> : ILogger<T>
    {
        public string Text = ""; public bool IsEnabled(LogLevel level) => true; public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public void Log<TState>(LogLevel level, EventId id, TState state, Exception? error, Func<TState, Exception?, string> format) => Text += format(state, error) + "\n";
    }
    sealed class Handler : HttpMessageHandler
    {
        public JsonDocument? Body; public bool Reject; public int DelayMilliseconds;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            if (DelayMilliseconds > 0) await Task.Delay(DelayMilliseconds, token); Body?.Dispose(); Body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(token));
            return new(Reject ? HttpStatusCode.BadRequest : HttpStatusCode.OK) { Content = new StringContent(Reject ? "sensitive provider response" : Codec.Serialize(new { id = "gen-fixture", choices = new[] { new { message = new { content = Codec.Serialize(new { lines = new[] { new { id = "line", text = "你好" } } }) } } } })) };
        }
    }
}
