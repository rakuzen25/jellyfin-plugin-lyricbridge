using Jellyfin.Api.Extensions;
using Jellyfin.Data.Enums;
using Lyricify.Lyrics.Models;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Lyrics;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Logging;
namespace LyricBridge;

public sealed class SafeExceptionFilter(ILogger<SafeExceptionFilter> logger) : IExceptionFilter
{
    public void OnException(ExceptionContext context)
    {
        if (context.Exception is OperationCanceledException && context.HttpContext.RequestAborted.IsCancellationRequested) return;
        if (context.Exception is WorkflowException workflow) { context.Result = new JsonResult(new { error = SafeError.Create(workflow.Code, workflow.Message, workflow.Retryable) with { Issues = workflow.Issues, IssueCount = workflow.IssueCount } }, Codec.Json) { StatusCode = workflow.Status }; context.ExceptionHandled = true; return; }
        var error = context.Exception switch { ServiceFailure f => SafeError.Create(f.Code, f.Message, true, f.RetryAt?.UtcDateTime), OperationCanceledException => SafeError.Create("service_timeout", "The connection test timed out after 15 seconds. Check the endpoint or try a lower AI thinking level.", true), HttpRequestException => SafeError.Create("service_unavailable", "The service could not be reached or rejected the request. Check its endpoint and setup, then retry.", true), InvalidDataException => SafeError.Create("invalid_line_mapping", "The service response did not contain the expected lyric-line mapping. Check model JSON support or retry.", true), ArgumentException => SafeError.Create("invalid_request", "Check the supplied settings and try again."), InvalidOperationException => SafeError.Create("action_unavailable", "This action is unavailable in the current state."), _ => SafeError.Create("request_failed", "The lyric action could not complete. Try again or check the plugin configuration.", true) };
        logger.LogWarning("LyricBridge action failed: {Code}; diagnostic {DiagnosticId}", error.Code, error.DiagnosticId);
        context.Result = new JsonResult(new { error }, Codec.Json) { StatusCode = error.Code == "search_limit" ? 429 : error.Code == "invalid_request" ? 400 : 503 }; context.ExceptionHandled = true;
    }
}
public sealed class StoreOperationFilter(Store store) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (context.ActionArguments.TryGetValue("id", out var id) && id is Guid item)
        {
            using var operation = store.Operation(store.Admit(item));
            await next();
        }
        else await next();
    }
}
[ApiController, Authorize, Route("LyricBridge"), TypeFilter(typeof(SafeExceptionFilter)), TypeFilter(typeof(StoreOperationFilter))]
public sealed class Api(SelectionService selection, LanguageVersionService versions, TimingService timing, LyricQueryService query, LibraryAccess access, PreferenceService preferences, ManagedLibraryMaintenance maintenance, Generation generation, LanguageServices languages, Discovery discovery, LocalPronunciation local, WebRendererIntegration renderer, Lazy<Plugin> plugin) : ControllerBase
{
    private IActionResult JsonData(object? value) => new JsonResult(value, Codec.Json);
    private IActionResult Error(int status, string code, string message, bool retryable = false) => new JsonResult(new { error = SafeError.Create(code, message, retryable) }, Codec.Json) { StatusCode = status };
    private bool Admin => LibraryAccess.IsAdministrator(User);
    private Guid UserId => User.GetUserId();
    private Audio? Item(Guid id) => access.FindAudio(id, User);
    private Preferences Prefs() => preferences.Account(UserId);
    private SongLanguagePreferences SongPrefs(Guid id) => preferences.Song(UserId, id);
    private Preferences EffectivePrefs(Guid id) => preferences.Effective(UserId, id);
    [HttpGet("items/{id:guid}/language-preferences")]
    public IActionResult SongPreferences(Guid id) => Item(id) == null ? NotFound() : JsonData(new { accountPreferences = Prefs(), songOverrides = SongPrefs(id), preferences = EffectivePrefs(id) });
    [HttpPut("items/{id:guid}/language-preferences")]
    public IActionResult SongPreferences(Guid id, SongLanguagePreferences input)
    {
        if (Item(id) == null) return NotFound();
        if ((input.SourceLanguage != null && !LanguageTag(input.SourceLanguage)) || (input.TranslationLanguage != null && (!LanguageTag(input.TranslationLanguage) || input.TranslationLanguage == "auto"))) return Error(400, "invalid_preferences", "Choose a valid original and translation language.");
        preferences.SaveSong(UserId, id, input);
        return SongPreferences(id);
    }
    [HttpDelete("items/{id:guid}/language-preferences")]
    public IActionResult ClearSongPreferences(Guid id) { if (Item(id) == null) return NotFound(); preferences.SaveSong(UserId, id, null); return SongPreferences(id); }
    private Task<RichLyrics?> Read(Audio audio, CancellationToken token) => query.Read(audio, token);
    private IActionResult Payload(Guid id, LyricOutcome outcome, RichLyrics? original = null, bool readOnly = false)
    {
        var item = Item(id);
        return item == null ? NotFound() : JsonData(query.Build(item, UserId, Admin, outcome, original, readOnly));
    }
    [HttpGet("items/{id:guid}/lyrics")]
    public async Task<IActionResult> Lyrics(Guid id, CancellationToken token) { var item = Item(id); return item == null ? NotFound() : Payload(id, await query.Discover(item, token)); }
    [HttpGet("items/{id:guid}/discovery")]
    public IActionResult DiscoveryStatus(Guid id) => Item(id) == null ? NotFound() : Payload(id, discovery.Status(id));
    [HttpPost("items/{id:guid}/retry")]
    public async Task<IActionResult> Retry(Guid id, CancellationToken token) { var item = Item(id); if (item != null && Admin) selection.ClearRejection(id); return item == null ? NotFound() : Payload(id, await query.Discover(item, token, true)); }
    [HttpGet("items/{id:guid}/candidates")]
    public async Task<IActionResult> Candidates(Guid id, CancellationToken token) { var item = Item(id); return item == null ? NotFound() : JsonData(await discovery.Candidates(UserId, id, JellyfinTrack.From(item), token)); }
    [HttpPost("items/{id:guid}/search")]
    public IActionResult Search(Guid id, SearchInput input) { var item = Item(id); if (item == null) return NotFound(); var track = JellyfinTrack.From(item); if (!string.IsNullOrWhiteSpace(input.Title)) track.Title = input.Title; if (input.Artist != null && input.Artist != string.Join(", ", track.Artists)) track.Artists = [input.Artist]; return JsonData(discovery.Search(UserId, id, track, input.Source)); }
    [HttpGet("search/{sessionId}")]
    public IActionResult SearchStatus(string sessionId) { var session = discovery.SearchStatus(sessionId, UserId); return session == null || Item(session.ItemId) == null ? NotFound() : JsonData(session); }
    [HttpDelete("search/{sessionId}")]
    public IActionResult CancelSearch(string sessionId) => discovery.CancelSearch(sessionId, UserId) ? NoContent() : NotFound();
    [HttpPost("items/{id:guid}/preview")]
    public async Task<IActionResult> Preview(Guid id, Candidate candidate, CancellationToken token)
    {
        var item = Item(id); if (item == null) return NotFound();
        var result = await selection.Preview(item, candidate, token); return Payload(id, result.Outcome, result.Original);
    }
    [HttpGet("items/{id:guid}/originals")]
    public IActionResult Originals(Guid id) => Item(id) == null ? NotFound() : JsonData(selection.Originals(id));
    [HttpGet("items/{id:guid}/originals/{hash}/preview")]
    public IActionResult OriginalPreview(Guid id, string hash)
    {
        if (Item(id) == null) return NotFound();
        return Payload(id, new() { State = "ready", Lyrics = selection.PreviewOriginal(id, hash), Complete = true }, readOnly: true);
    }
    [HttpPost("items/{id:guid}/originals/{hash}/select")]
    public IActionResult SelectOriginal(Guid id, string hash)
    {
        if (!Admin) return Error(403, "permission_denied", "An administrator must change the library lyric version.");
        if (Item(id) == null) return NotFound();
        selection.SelectOriginal(id, hash);
        return Payload(id, discovery.Status(id));
    }
    [HttpDelete("items/{id:guid}/originals/{hash}")]
    public IActionResult DeleteOriginal(Guid id, string hash, DeleteOriginalInput input)
    {
        if (!Admin) return Error(403, "permission_denied", "An administrator must delete saved originals.");
        if (Item(id) == null) return NotFound();
        if (!input.Confirmed || input.Revision is null) return Error(400, "confirmation_required", "Confirm deletion of this saved original and its dependent managed data.");
        var result = maintenance.DeleteOriginal(id, hash, input.Revision);
        return JsonData(new { result.SharedContentRetained, lyrics = query.Build(Item(id)!, UserId, Admin, discovery.Status(id), readOnly: true) });
    }
    [HttpPost("items/{id:guid}/select")]
    public async Task<IActionResult> Select(Guid id, Candidate candidate, CancellationToken token)
    {
        if (!Admin) return Error(403, "permission_denied", "An administrator must change the library lyric version.");
        var item = Item(id); return item == null ? NotFound() : JsonData(await selection.Select(item, candidate, token));
    }
    [HttpPost("items/{id:guid}/upgrade")]
    public async Task<IActionResult> Upgrade(Guid id, CancellationToken token, string? hash = null, string? baselineHash = null)
    {
        if (!Admin) return Error(403, "permission_denied", "An administrator must apply the upgrade.");
        var item = Item(id); return item == null ? NotFound() : JsonData(await selection.Upgrade(item, hash, baselineHash, token));
    }
    [HttpPost("items/{id:guid}/instrumental")]
    public IActionResult Mark(Guid id, InstrumentalInput input) { if (!Admin) return Error(403, "permission_denied", "An administrator must change the instrumental classification."); if (Item(id) == null) return NotFound(); selection.Mark(id, input.Clear); return NoContent(); }
    [HttpPost("admin/reset")]
    public async Task<IActionResult> ResetLibrary(ResetLibraryInput input)
    {
        if (!Admin) return Error(403, "permission_denied", "Only an administrator can reset the managed lyric library.");
        if (input.Confirmation != "RESET") return Error(400, "confirmation_required", "Type RESET to confirm deleting the managed lyric library.");
        var deleted = await maintenance.Reset();
        return deleted is null ? Error(409, "reset_in_progress", "A managed lyric reset is already running.") : JsonData(new { deleted });
    }
    [HttpPost("items/{id:guid}/reject-matches")]
    public IActionResult RejectMatches(Guid id) { if (!Admin) return Error(403, "permission_denied", "An administrator must reject library matches."); if (Item(id) == null) return NotFound(); selection.Reject(id); return NoContent(); }
    [HttpPost("items/{id:guid}/import/preview"), RequestSizeLimit(7_000_000)]
    public IActionResult ImportPreview(Guid id, ImportLyricsInput input, CancellationToken token)
    {
        if (!Admin) return Error(403, "permission_denied", "An administrator must import library lyrics.");
        var item = Item(id); if (item == null) return NotFound();
        var imported = selection.PreviewImport(item, input, token);
        var document = query.Build(item, UserId, Admin, new() { State = "ready", Lyrics = imported.Lyrics, Complete = true }, readOnly: true) with { CanSelect = false, CanDeleteVariants = false, CanDeleteOriginals = false };
        return JsonData(new ImportPreview(imported.FileName, imported.Format, imported.Encoding, imported.Timing, imported.LineCount, document, imported.Warnings));
    }
    [HttpPost("items/{id:guid}/import"), RequestSizeLimit(7_000_000)]
    public async Task<IActionResult> Import(Guid id, ImportLyricsInput input, CancellationToken token)
    {
        if (!Admin) return Error(403, "permission_denied", "An administrator must import library lyrics.");
        var item = Item(id); if (item == null) return NotFound(); await selection.Import(item, input, token); return NoContent();
    }
    [HttpPost("items/{id:guid}/mix")]
    public async Task<IActionResult> Mix(Guid id, MixInput input, CancellationToken token)
    {
        var item = Item(id);
        if (item == null) return NotFound();
        var expected = selection.Snapshot(id);
        var original = await Read(item, token);
        versions.Mix(UserId, id, expected, original, input, EffectivePrefs(id).TranslationLanguage);
        return NoContent();
    }
    [HttpPost("items/{id:guid}/pronunciation")]
    public async Task<IActionResult> Pronunciation(Guid id, PronunciationInput input, CancellationToken token)
    {
        var item = Item(id); if (item == null) return NotFound();
        var doc = await Read(item, token);
        if (doc == null || Codec.ContentHash(doc) != input.Hash) return Error(409, "lyric_version_changed", "Reload this song’s current lyrics before generating pronunciation.");
        var prefs = EffectivePrefs(id);
        if (input.Retry) local.Retry(doc, prefs, input.IncludeSupplied);
        var state = local.Ensure(doc, prefs, input.IncludeSupplied);
        if (state.State == "unavailable") return Error(400, "unsupported_language", "Local Kawazu pronunciation supports Japanese. Check the original language in Display settings.");
        if (state.State == "busy") return Error(429, "local_queue_busy", "Local pronunciation is busy. Try again shortly.", true);
        if (input.IncludeSupplied) versions.SelectPendingLocal(UserId, input.Hash, LocalPronunciation.Key(doc, prefs, true));
        return NoContent();
    }
    [HttpPost("items/{id:guid}/language-version")]
    public async Task<IActionResult> LanguageVersion(Guid id, AuxiliarySelectionInput input, CancellationToken token)
    {
        var item = Item(id); if (item == null) return NotFound(); var lyrics = await Read(item, token);
        versions.Select(UserId, lyrics, input, EffectivePrefs(id).TranslationLanguage);
        return NoContent();
    }
    [HttpDelete("items/{id:guid}/language-version")]
    public async Task<IActionResult> DeleteLanguageVersion(Guid id, AuxiliarySelectionInput input, CancellationToken token)
    {
        if (!Admin) return Error(403, "permission_denied", "An administrator must delete shared language versions.");
        var item = Item(id); if (item == null) return NotFound();
        versions.Delete(await Read(item, token), input);
        return NoContent();
    }
    [HttpPost("items/{id:guid}/timing")]
    public async Task<IActionResult> Timing(Guid id, TimingCorrection input, CancellationToken token)
    {
        if (!Admin) return Error(403, "permission_denied", "An administrator must save shared timing corrections.");
        var item = Item(id); if (item == null) return NotFound(); var expected = selection.Snapshot(id); var lyrics = await Read(item, token);
        return JsonData(timing.Save(id, expected, lyrics, input));
    }
    [HttpGet("preferences")]
    public IActionResult Preferences() => JsonData(Prefs());
    [HttpPut("preferences")]
    public IActionResult Preferences(Preferences input)
    {
        try { preferences.Save(UserId, input); return JsonData(input); }
        catch (ArgumentException error) { return Error(400, "invalid_preferences", error.Message); }
    }
    [HttpGet("admin/runtime")]
    public IActionResult Runtime()
    {
        if (!Admin) return Error(403, "permission_denied", "Only administrators can inspect storage configuration.");
        var configured = plugin.Value.Configuration.StoragePath;
        var target = Path.GetFullPath(string.IsNullOrWhiteSpace(configured) ? plugin.Value.DataDirectory : configured);
        return JsonData(new { activeStoragePath = query.ActiveStoragePath, configuredStoragePath = target, restartRequired = target != query.ActiveStoragePath });
    }
    [HttpGet("services")]
    public IActionResult Services() => JsonData(languages.Capabilities());
    [HttpGet("sources")]
    public IActionResult Sources() => JsonData(plugin.Value.Configuration.Sources.Select(s => new { name = s.Name, enabled = s.Enabled, requiresCredential = s.Name is "Spotify" or "AppleMusic", configured = !string.IsNullOrWhiteSpace(s.Credential) }));
    [HttpPost("services/{service}/test")]
    public async Task<IActionResult> TestService(string service, CancellationToken token) { if (!Admin) return Error(403, "permission_denied", "Only administrators can test service connections."); var doc = new RichLyrics { Lines = [new() { Id = "test", Text = "Good morning", Language = "en" }] }; await languages.Generate(doc, new() { Service = service, Kind = "translation", Language = "zh-Hans" }, new Progress<int>(), token); return JsonData(new { state = "ready", message = "Connection succeeded using synthetic text." }); }
    [HttpPost("items/{id:guid}/generate")]
    public async Task<IActionResult> Generate(Guid id, GenerationRequest request, CancellationToken token)
    {
        var item = Item(id); if (item == null) return NotFound(); var lyrics = await Read(item, token); if (lyrics == null) return Error(409, "no_sung_lyrics", "Load sung lyrics before requesting translation or pronunciation."); lyrics.Hash = Codec.ContentHash(lyrics); query.SaveDocument(lyrics); if (!LanguageTag(request.Language) || request.Kind is not ("translation" or "pronunciation")) return Error(400, "invalid_request", "Choose a valid language and generation kind."); request.SourceLanguage = EffectivePrefs(id).SourceLanguage;
        try { if (!languages.Available(languages.Config(request.Service))) return Error(409, "service_not_configured", "Ask an administrator to set up this service."); return JsonData(generation.Request(UserId, id, lyrics, request, Admin)); }
        catch (UnauthorizedAccessException) { return Error(403, "requests_disabled", "External generation requests are disabled for your account."); }
        catch (ArgumentException) { return Error(400, "unsupported_service", "Choose an available service."); }
        catch (InvalidOperationException e) { return Error(409, e.Message.StartsWith("Daily") ? "daily_quota" : "active_quota", e.Message, true); }
    }
    [HttpGet("jobs")]
    public IActionResult Jobs(int offset = 0, int limit = 100, bool active = false, Guid? itemId = null)
    {
        if (offset < 0 || limit is < 1 or > 500) return Error(400, "invalid_pagination", "Choose a nonnegative offset and a limit from 1 to 500.");
        if (itemId.HasValue && Item(itemId.Value) == null) return NotFound();
        var jobs = active ? generation.ActiveJobs(Admin ? null : UserId) : generation.Jobs(Admin ? null : UserId, offset, limit);
        return JsonData(jobs.Where(j => (!itemId.HasValue || j.ItemId == itemId.Value) && Item(j.ItemId) != null));
    }
    [HttpGet("jobs/{jobId}")]
    public IActionResult JobStatus(string jobId)
    {
        var job = generation.GetJob(jobId);
        return job == null || (!Admin && job.UserId != UserId) || Item(job.ItemId) == null ? NotFound() : JsonData(job);
    }
    [HttpPost("jobs/{id}/{operation}")]
    public IActionResult JobAction(string id, string operation) { var job = generation.GetJob(id); if (job == null || Item(job.ItemId) == null) return NotFound(); try { return JsonData(generation.Action(id, operation, UserId, Admin)); } catch (UnauthorizedAccessException) { return Error(403, "permission_denied", "You cannot perform this request action."); } catch (InvalidOperationException) { return Error(409, "action_unavailable", "This action is not available in the current request state."); } }
    [HttpGet("admin/web-renderer")]
    public IActionResult WebRenderer() => Admin ? JsonData(renderer.Status) : Forbid();
    [HttpPost("admin/web-renderer/repair")]
    public async Task<IActionResult> RepairWebRenderer(CancellationToken token) => Admin ? JsonData(await renderer.Repair(token)) : Forbid();
    [AllowAnonymous, HttpGet("assets/{name}")]
    public IActionResult Asset(string name) { if (name is not ("lyricbridge.js" or "lyricbridge.css" or "jellyfin-lyric-motion.js" or "jellyfin-lyric-motion.css")) return NotFound(); var stream = typeof(Plugin).Assembly.GetManifestResourceStream("Jellyfin.Plugin.LyricBridge.Web." + name); return stream == null ? NotFound() : File(stream, name.EndsWith(".js") ? "application/javascript" : name.EndsWith(".css") ? "text/css" : "text/html"); }
    private static bool LanguageTag(string value) => PreferenceService.LanguageTag(value);
}
public sealed record SearchInput(string? Title = null, string? Artist = null, string? Source = null);
public sealed record InstrumentalInput(bool Clear = false);
public sealed record PronunciationInput(string Hash, bool IncludeSupplied = true, bool Retry = false);

public sealed record ResetLibraryInput(string Confirmation);

public sealed record DeleteOriginalInput(bool Confirmed, long? Revision = null);
