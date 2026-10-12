using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
namespace LyricBridge;

public sealed class Generation(Func<GenerationPolicy> policy, IGenerationRepository store, LanguageServices services, ILogger<Generation>? logger = null) : BackgroundService
{
    private readonly object gate = new();
    private readonly System.Threading.Channels.Channel<bool> wakeup = System.Threading.Channels.Channel.CreateBounded<bool>(1);
    public void Wake() => wakeup.Writer.TryWrite(true);
    public void ConfigurationChanged()
    {
        lock (gate)
        {
            foreach (var job in store.ActiveJobs().Where(j => j.State is "pending" or "queued"))
            {
                if (ProfileMatches(job)) continue;
                job.State = "settings_changed";
                job.Error = "Generation settings changed. Retry to submit with current settings.";
                store.SaveJob(job);
            }
        }
        Wake();
    }

    private readonly Dictionary<string, CancellationTokenSource> running = new();
    private bool ProfileMatches(Job job)
    {
        try { return job.Profile == services.CurrentProfile(job.Request); }
        catch (ArgumentException) { return false; }
    }
    public IReadOnlyList<Job> ActiveJobs(Guid? user = null) => store.ActiveJobs(user);
    public IReadOnlyList<Job> Jobs(Guid? user = null, int offset = 0, int limit = 100) => store.JobHistory(user, offset, limit);
    public Job? GetJob(string id) => store.GetJob(id);
    public Variant? Cached(RichLyrics lyrics, GenerationRequest request) { var key = services.Key(lyrics, request); return store.Variants(lyrics.Hash).Where(v => v.CacheKey == key).OrderByDescending(v => v.CreatedAt ?? DateTime.MinValue).FirstOrDefault(); }
    public Job Request(Guid user, Guid item, RichLyrics lyrics, GenerationRequest request, bool admin)
    {
        lock (gate)
        {
            var ticket = store.Admit(item); var epoch = ticket.Epoch;
            if (!store.IsAdmitted(ticket, lyrics.Hash)) throw new WorkflowException(409, "original_deleted", "The original changed during admission. Reload before generating.", true);
            if (store.IsResetting) throw new WorkflowException(409, "reset_in_progress", "Managed lyric reset in progress.", true);
            if (request.Kind == "translation" && request.Service != "AI") { var service = services.Config(request.Service); request.ContextBefore = service.ContextBefore; request.ContextAfter = service.ContextAfter; }
            request.TimeoutSeconds = services.Config(request.Service).TimeoutSeconds;
            if (request.Service == "AI") request.ReasoningEffort = services.Config("AI").ReasoningEffort;
            request = Codec.Deserialize<GenerationRequest>(Codec.Serialize(request))!;
            var profile = services.Profile(request);
            var key = LanguageServices.Key(lyrics.Hash, profile);
            if (!request.ForceNew && Cached(lyrics, request) is { } cached) return new() { UserId = user, ItemId = item, Hash = lyrics.Hash, VariantKey = cached.Key, CacheKey = key, Profile = profile, Request = request, State = "cached", Progress = 100 };
            var config = policy();
            if (!admin && !config.AllowUserRequests) throw new UnauthorizedAccessException("User generation requests are disabled.");
            var existing = store.FindActiveJob(user, key); if (existing != null) return existing;
            if (!admin)
            {
                if (store.CountAdmissions(user, DateTime.UtcNow.AddHours(-24)) >= config.UserRequestDailyQuota) throw new InvalidOperationException("Daily generation quota reached.");
                if (store.CountActiveJobs(user) >= config.UserRequestActiveCap) throw new InvalidOperationException("Active generation limit reached.");
            }
            var job = new Job { DeletionRevision = ticket.Revision, UserId = user, ItemId = item, Hash = lyrics.Hash, VariantKey = key, Request = request, State = admin || config.AutoApproveUserRequests ? "queued" : "pending" };
            job.Profile = profile; job.CacheKey = key; job.VariantKey = key + ":" + job.Id;
            if (!store.PersistRequest(job, epoch, lyrics)) throw new WorkflowException(409, store.IsResetting || store.Epoch != epoch ? "reset_in_progress" : "original_deleted", "The lyric library changed during admission. Reload before submitting a new request.", true); Wake(); return job;
        }
    }
    public Job Action(string id, string action, Guid user, bool admin)
    {
        lock (gate)
        {
            var epoch = store.Epoch;
            var job = store.GetJob(id) ?? throw new KeyNotFoundException();
            if (job.OutputDeleted) throw new WorkflowException(409, "output_deleted", "This request’s output was deleted. Select an original and submit a new request.");
            if (!admin && (job.UserId != user || action is not ("cancel" or "retry"))) throw new UnauthorizedAccessException();
            if (job.State is "pending" or "queued" && !ProfileMatches(job)) { job.State = "settings_changed"; job.Error = "Generation settings changed. Retry to submit with current settings."; store.SaveJob(job); }
            if (action == "approve" && job.State == "settings_changed") return job;
            if (action == "approve" && job.State == "pending") job.State = "queued";
            else if (action == "reject" && job.State == "pending") job.State = "rejected";
            else if (action == "cancel" && job.State is "pending" or "queued" or "running") { job.State = "cancelled"; if (running.TryGetValue(id, out var c)) c.Cancel(); }
            else if (action == "retry" && job.State is "failed" or "settings_changed")
            {
                if (!admin && !policy().AllowUserRequests) throw new UnauthorizedAccessException();
                if (!admin && store.CountActiveJobs(user) >= policy().UserRequestActiveCap) throw new InvalidOperationException("Active generation limit reached.");
                if (job.Failure?.RetryAt > DateTime.UtcNow) throw new InvalidOperationException("Wait until the service retry time."); job.Profile = services.CurrentProfile(job.Request); job.CacheKey = LanguageServices.Key(job.Hash, job.Profile);
                job.Request.ReasoningEffort = job.Profile.ReasoningEffort; job.Request.ContextBefore = job.Profile.ContextBefore; job.Request.ContextAfter = job.Profile.ContextAfter;
                job.Request.TimeoutSeconds = services.Config(job.Request.Service).TimeoutSeconds; job.Error = null; job.Failure = null; job.Progress = 0; job.State = admin || policy().AutoApproveUserRequests ? "queued" : "pending";
            }
            else throw new InvalidOperationException("This action does not apply to the request state.");
            if (!store.PersistRequest(job, epoch, requireExisting: true)) throw new WorkflowException(409, store.GetJob(id)?.OutputDeleted == true ? "output_deleted" : "reset_in_progress", "The request changed. Reload the job history.", true); Wake(); return job;
        }
    }
    public void CancelDeleted(IReadOnlyList<string> ids)
    {
        lock (gate) foreach (var id in ids) if (running.TryGetValue(id, out var cancellation)) cancellation.Cancel();
        Wake();
    }
    public async Task StopAll()
    {
        lock (gate) { foreach (var job in store.ActiveJobs()) { job.State = "cancelled"; store.SaveJob(job); if (running.TryGetValue(job.Id, out var token)) token.Cancel(); } }
        while (true) { lock (gate) { if (running.Count == 0) return; } await Task.Delay(25); }
    }
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Recover interrupted jobs as retryable failures rather than silently charging another request.
        foreach (var old in store.ActiveJobs().Where(j => j.State == "running")) { old.State = "failed"; old.Error = "Server restarted during generation; retry available."; store.SaveJob(old); }
        while (!stoppingToken.IsCancellationRequested)
        {
            Job? job; ServiceConfig? execution = null; CancellationTokenSource? cancellation = null;
            lock (gate)
            {
                foreach (var waiting in store.ActiveJobs().Where(j => j.State is "pending" or "queued"))
                {
                    if (!ProfileMatches(waiting)) { waiting.State = "settings_changed"; waiting.Error = "Generation settings changed. Retry to submit with current settings."; store.SaveJob(waiting); }
                }
                job = store.IsResetting ? null : store.ActiveJobs().FirstOrDefault(j => j.State == "queued");
                if (job != null) { try { execution = services.Snapshot(job.Request.Service); } catch (ArgumentException) { execution = null; } if (execution == null || job.Profile != services.CurrentProfile(job.Request, execution)) { job.State = "settings_changed"; job.Error = "Generation settings changed. Retry to submit with current settings."; store.SaveJob(job); job = null; } }
                if (job != null) { job.State = "running"; store.SaveJob(job); cancellation = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken); running[job.Id] = cancellation; }
            }
            if (job == null)
            {
                using var interval = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                interval.CancelAfter(TimeSpan.FromSeconds(30));
                try { await wakeup.Reader.ReadAsync(interval.Token); } catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested) { }
                continue;
            }
            job.Request.LogCorrelationId = job.Id;
            var elapsed = System.Diagnostics.Stopwatch.StartNew();
            logger?.LogInformation("LyricBridge generation started: job {JobId}; service {Service}; model {Model}; thinking {Thinking}", job.Id, job.Request.Service, execution!.Model, string.IsNullOrEmpty(job.Request.ReasoningEffort) ? "provider default" : job.Request.ReasoningEffort);
            try
            {
                var lyrics = store.GetDocument(job.Hash) ?? throw new InvalidDataException();
                var existing = store.GetVariant(job.VariantKey);
                if (existing == null)
                {
                    var progress = new Progress<int>(value => { lock (gate) { if (job.State == "running" && store.GetJob(job.Id)?.State == "running") { job.Progress = value; store.SaveJob(job); } } });
                    job.Request.TimeoutSeconds ??= 15; job.Request.ReasoningEffort ??= ""; job.Request.ContextBefore ??= 0; job.Request.ContextAfter ??= 0;
                    var text = await services.Generate(lyrics, job.Request, progress, cancellation!.Token, execution);
                    cancellation.Token.ThrowIfCancellationRequested();
                    lock (gate) { if (job.State == "running" && store.GetJob(job.Id)?.State == "running" && !cancellation.IsCancellationRequested) store.CompleteGeneration(job, new Variant(job.VariantKey, job.Hash, job.Request.Kind, job.Request.Language, job.Request.Service, execution!.Model, text, job.Request.ContextBefore ?? 0, job.Request.ContextAfter ?? 0, job.Request.ReasoningEffort ?? "", job.Request.Service == "AI" ? LanguageServices.AiPromptVersion : 0, job.CacheKey, DateTime.UtcNow, SkippedRows: new(job.Request.SkippedRows), Profile: job.Profile)); }
                }
                lock (gate) { if (job.State == "running" && store.GetJob(job.Id)?.State == "running") { store.CompleteGeneration(job, null); } }
            }
            catch (OperationCanceledException) { lock (gate) { if (cancellation!.IsCancellationRequested) job.State = "cancelled"; else { job.State = "failed"; job.Failure = SafeError.Create("service_timeout", job.Request.Service + " timed out after its " + (job.Request.TimeoutSeconds ?? 15) + "-second HTTP limit. " + (job.Request.Service == "AI" ? "Increase the service timeout, try a lower thinking level, or check the endpoint. " : "") + "Your existing lyric rows were retained; retry is available.", true); job.Error = job.Failure.Message; } store.SaveJob(job); } }
            catch (Exception e) { lock (gate) { if (store.GetJob(job.Id)?.State == "cancelled") continue; job.State = "failed"; job.Failure = e switch { ServiceFailure f => SafeError.Create(f.Code, f.Message, true, f.RetryAt?.UtcDateTime), HttpRequestException => SafeError.Create("service_unavailable", "The service could not complete the request. Check its configuration or retry.", true), ArgumentException => SafeError.Create("invalid_generation_settings", "The generation settings are invalid. Check the selected service and language."), InvalidDataException => SafeError.Create("invalid_line_mapping", "The generated text did not match the lyric lines. Retry or choose another service.", true), _ => SafeError.Create("generation_failed", "Generation failed. Check service configuration and retry.", true) }; job.Error = job.Failure.Message; store.SaveJob(job); } }
            finally { if (job.State == "failed") logger?.LogWarning("LyricBridge generation failed: job {JobId}; service {Service}; elapsed {ElapsedMs} ms; code {Code}; diagnostic {DiagnosticId}", job.Id, job.Request.Service, elapsed.ElapsedMilliseconds, job.Failure?.Code ?? "generation_failed", job.Failure?.DiagnosticId); else logger?.LogInformation("LyricBridge generation {State}: job {JobId}; elapsed {ElapsedMs} ms", job.State, job.Id, elapsed.ElapsedMilliseconds); lock (gate) { running.Remove(job.Id); } cancellation?.Dispose(); }
        }
    }
}
