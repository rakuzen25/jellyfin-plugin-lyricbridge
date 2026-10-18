using System.Globalization;
using Jellyfin.Api.Extensions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LyricBridge;

[ApiController, Authorize, Route("LyricBridge"), TypeFilter(typeof(SafeExceptionFilter)), TypeFilter(typeof(StoreOperationFilter))]
public sealed class TranscriptionApi(ITranscriptionRepository repository, IBoundaryStrategy strategy, AudioPreparation audio, Generation generation, LibraryAccess access, Discovery discovery, Lazy<Plugin> plugin) : ControllerBase
{
    private bool Admin => LibraryAccess.IsAdministrator(User);
    private Guid UserId => User.GetUserId();
    private ServiceCatalog Catalog => new(() => plugin.Value.Configuration.ServiceSetup);
    private TranscriptionConfig Settings(string? optionId) => Catalog.Transcription(new Job { Audio = new(OptionId: optionId) });
    private IActionResult Json(object value) => new JsonResult(value, Codec.Json);
    private void Item(Guid id) { if (access.FindAudio(id, User) is null) throw new WorkflowException(404, "item_unavailable", "This recording is unavailable."); }
    private void RequestAllowed()
    {
        if (!Admin && !plugin.Value.Configuration.AllowUserRequests) throw new WorkflowException(403, "requests_disabled", "External generation requests are disabled for your account.");
    }
    private Transcript Source(Guid item, string id)
    {
        Item(item);
        var source = repository.Transcript(id);
        if (source == null || source.ItemId != item || !repository.Transcripts(item, UserId, Admin).Any(t => t.Id == id)) throw new WorkflowException(404, "transcript_unavailable", "This transcription is unavailable to the current account.");
        return source;
    }
    private Job Admit(Job job)
    {
        try { return generation.RequestRemote(job, Admin); }
        catch (UnauthorizedAccessException) { throw new WorkflowException(403, "requests_disabled", "External requests are disabled."); }
        catch (InvalidOperationException e) { throw new WorkflowException(409, e.Message.StartsWith("Daily", StringComparison.Ordinal) ? "daily_quota" : "active_quota", e.Message, true); }
    }
    [HttpGet("transcription")]
    public IActionResult Capabilities()
    {
        var options = Catalog.Options().Where(o => o.Capability == "transcription").ToList();
        var ready = options.Where(o => o.Status == "Ready").ToList();
        var requestsAllowed = Admin || plugin.Value.Configuration.AllowUserRequests;
        var unavailableReason = !requestsAllowed ? "requests_disabled" : ready.Count > 0 ? null : options.Count > 0 && options.All(o => o.Status == "Disabled") ? "transcription_disabled" : "service_not_configured";
        return Json(new { unavailableReason, configured = ready.Count > 0, canTranscribe = ready.Count > 0 && (Admin || plugin.Value.Configuration.AllowUserRequests), maxInputMb = ready.Select(o => o.MaxInputMb).DefaultIfEmpty(256).Max(), maxUploadMb = ready.Select(o => o.MaxUploadMb).DefaultIfEmpty(25).Max(), canUse = Admin, options, reviewOptions = Catalog.Options().Where(o => o.Capability == "boundary-review") });
    }
    [HttpPost("items/{id:guid}/transcription-upload"), RequestSizeLimit(4_096_000_000L)]
    public async Task<IActionResult> Upload(Guid id, CancellationToken token, string? optionId = null)
    {
        Item(id); RequestAllowed();
        return Json(await audio.Upload(id, UserId, Request.Body, Settings(optionId).MaxInputMb * 1_000_000L, token));
    }
    [HttpGet("items/{id:guid}/transcription-uploads")]
    public IActionResult Uploads(Guid id) { Item(id); return Json(audio.Uploads(id, UserId)); }
    [HttpDelete("items/{id:guid}/transcription-uploads/{uploadId}")]
    public IActionResult DiscardUpload(Guid id, string uploadId) { Item(id); audio.DeleteUpload(uploadId, id, UserId); return NoContent(); }
    [HttpPost("items/{id:guid}/transcribe")]
    public IActionResult Transcribe(Guid id, AudioRequest input)
    {
        Item(id); RequestAllowed();
        _ = Settings(input.OptionId);
        if (input.Source is not ("track" or "upload") || input.Source == "track" && input.UploadId != null || input.Language != "auto" && !CultureInfo.GetCultures(CultureTypes.NeutralCultures).Any(c => c.Name == input.Language)) throw new WorkflowException(400, "invalid_audio_request", "Choose a valid audio source and language.");
        if (input.AllowChunking || input.ChunkCount != 1) throw new WorkflowException(400, "chunk_plan_required", "Request transcription first; choose chunking after reviewing its prepared chunk count.");
        if (input.Source == "upload") audio.CheckUpload(input.UploadId ?? "", id, UserId);
        var item = access.FindAudio(id, User)!;
        var job = new Job { ItemId = id, UserId = UserId, TaskKind = "transcription", Audio = input, Title = item.Name, Artist = string.Join(", ", item.Artists), Hash = Guid.NewGuid().ToString("N"), Request = new() { Kind = "transcription", Service = "Transcription", Language = input.Language } };
        return Json(Admit(job));
    }
    [HttpPost("items/{id:guid}/transcription-jobs/{jobId}/retry")]
    public IActionResult Retry(Guid id, string jobId, AudioRequest input)
    {
        Item(id); RequestAllowed(); var job = generation.GetJob(jobId);
        if (job == null || job.ItemId != id || job.UserId != UserId && !Admin) throw new WorkflowException(404, "job_unavailable", "This request is unavailable.");
        if (input.OptionId != null && input.OptionId != job.Audio?.OptionId) throw new WorkflowException(409, "service_choice_changed", "Choose a different service by starting a new request.");
        if (input.AllowChunking && job.Failure?.Code != "audio_too_large") throw new WorkflowException(409, "chunk_plan_required", "Chunking is offered after the endpoint's upload limit is reached.");
        if (input.SegmentOnly && job.Failure?.Code is not ("timestamp_request_unsupported" or "mixed_chunk_timing")) throw new WorkflowException(409, "fallback_unavailable", "Segment fallback is unavailable for this failure.");
        return Json(generation.RetryAudio(jobId, input, UserId, Admin));
    }
    [HttpGet("items/{id:guid}/transcriptions")]
    public IActionResult Results(Guid id) { Item(id); return Json(repository.Transcripts(id, UserId, Admin).Select(t => new { t.Id, t.UserId, t.Language, t.Timing, t.TokenCount, t.Created, t.Published, t.OptionName, savedEntryCount = repository.SavedEntries(t.Id).Count, deletion = repository.Deletion(t.Id, null, UserId, Admin) })); }
    [HttpGet("items/{id:guid}/transcriptions/{transcriptId}")]
    public IActionResult Read(Guid id, string transcriptId, CancellationToken token)
    {
        var source = Source(id, transcriptId);
        return Json(new ReviewDocument(source, repository.BoundaryVersions(source.Id), strategy.Analyze(source, token).ToList(), repository.SelectionIdentity(id), Admin, repository.ReviewResults(source.Id), repository.SavedEntries(source.Id).Select(e => new SavedBoundaryView(e, repository.Deletion(source.Id, e.Id, UserId, Admin))).ToList(), repository.Deletion(source.Id, null, UserId, Admin), Admin || source.UserId == UserId));
    }
    private BoundaryVersion ValidateInput(Transcript source, BoundaryInput input)
    {
        if (input.TranscriptId != source.Id) throw new WorkflowException(409, "transcript_changed", "Reopen this transcription before saving.");
        if (input.Origin == "local")
        {
            var computed = TranscriptBoundaries.Optimize(source, input.Settings, strategy.Analyze(source, HttpContext.RequestAborted), strategy.Version, HttpContext.RequestAborted);
            if (!computed.EndTokenIds.SequenceEqual(input.EndTokenIds)) throw new WorkflowException(400, "invalid_automatic_breaks", "Automatic line breaks must match the local optimizer.");
            return computed;
        }
        if (input.Origin != "manual") throw new WorkflowException(400, "invalid_origin", "Choose manual or automatic line breaks.");
        return TranscriptBoundaries.Version(source, "manual", input.Settings, input.EndTokenIds, TranscriptBoundaries.Algorithm + "/manual");
    }
    [HttpPost("items/{id:guid}/transcriptions/{transcriptId}/break")]
    public IActionResult Break(Guid id, string transcriptId, BreakSettings settings, CancellationToken token)
    {
        var source = Source(id, transcriptId);
        var version = TranscriptBoundaries.Optimize(source, settings, strategy.Analyze(source, token), strategy.Version, token);
        return Json(version);
    }
    [HttpPost("items/{id:guid}/transcriptions/{transcriptId}/preview")]
    public IActionResult Preview(Guid id, string transcriptId, BoundaryInput input)
    {
        var source = Source(id, transcriptId); var version = ValidateInput(source, input);
        return Json(TranscriptBoundaries.Compose(source, version.EndTokenIds, source.Title, source.Artist));
    }
    private ReviewPlan Plan(Transcript source, BoundaryVersion version, BoundaryInput input)
    {
        var settings = Catalog.Review(new Job { Review = new(source.Id, version.Id, input.Settings, input.OptionId) });
        var natural = TranscriptBoundaries.Optimize(source, version.Settings, strategy.Analyze(source, HttpContext.RequestAborted), strategy.Version, HttpContext.RequestAborted);
        return BoundaryReviewPlanning.Create(source, version, settings, natural.EndTokenIds);
    }
    [HttpPost("items/{id:guid}/transcriptions/{transcriptId}/review-plan")]
    public IActionResult ReviewPlan(Guid id, string transcriptId, BoundaryInput input)
    {
        RequestAllowed(); var source = Source(id, transcriptId); var version = ValidateInput(source, input);
        var plan = Plan(source, version, input);
        return Json(new { plan.Identity, plan.RequestCount, estimatedInputTokens = plan.Batches.Sum(b => b.EstimatedInputTokens) });
    }
    [HttpPost("items/{id:guid}/transcriptions/{transcriptId}/review")]
    public IActionResult Review(Guid id, string transcriptId, BoundaryInput input)
    {
        RequestAllowed(); var source = Source(id, transcriptId); var version = ValidateInput(source, input); var plan = Plan(source, version, input);
        if (input.PlanIdentity != plan.Identity) throw new WorkflowException(409, "review_plan_changed", "The review input or service settings changed. Refresh the AI request count before submitting.");
        return Json(Admit(new Job { ItemId = id, UserId = UserId, Hash = source.Id, TaskKind = "boundary-review", ReviewPlan = plan, Review = new(source.Id, version.Id, input.Settings, input.OptionId, plan.Identity, version), Request = new() { Kind = "boundary-review", Service = "AI", Language = source.Language } }));
    }
    [HttpPost("items/{id:guid}/transcriptions/{transcriptId}/save")]
    public IActionResult Save(Guid id, string transcriptId, BoundaryInput input)
    {
        var source = Source(id, transcriptId); var version = ValidateInput(source, input);
        return Json(repository.SaveEntry(source, version, UserId, Admin, input.EntryId));
    }
    [HttpDelete("items/{id:guid}/transcriptions/{transcriptId}/entries/{entryId}")]
    public IActionResult DeleteEntry(Guid id, string transcriptId, string entryId)
    {
        _ = Source(id, transcriptId); repository.DeleteEntry(id, transcriptId, entryId, UserId, Admin); return NoContent();
    }
    [HttpPost("items/{id:guid}/transcriptions/{transcriptId}/use")]
    public IActionResult Use(Guid id, string transcriptId, BoundaryInput input)
    {
        if (!Admin) throw new WorkflowException(403, "permission_denied", "An administrator must select shared original lyrics.");
        var source = Source(id, transcriptId); var version = ValidateInput(source, input);
        if (string.IsNullOrWhiteSpace(input.ExpectedSelection)) throw new WorkflowException(400, "selection_required", "Refresh the selection baseline before applying.");
        var lyrics = repository.CommitBoundary(id, source, version, input.ExpectedSelection, input.EntryId); discovery.Invalidate(id); return Json(lyrics);
    }
    [HttpDelete("items/{id:guid}/transcriptions/{transcriptId}")]
    public IActionResult Delete(Guid id, string transcriptId)
    {
        _ = Source(id, transcriptId); generation.CancelDeleted(repository.DeleteTranscript(id, transcriptId, UserId, Admin)); return NoContent();
    }
}
