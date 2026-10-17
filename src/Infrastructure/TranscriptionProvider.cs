using Microsoft.Extensions.Logging;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using NMeCab;

namespace LyricBridge;

public static class TranscriptionResponse
{
    public static Transcript Parse(string raw, Guid item, Guid user, string id, GenerationProfile profile, bool segmentOnly = false, long offset = 0, string languageHint = "auto")
    {
        try
        {
            using var document = JsonDocument.Parse(raw);
            var root = document.RootElement;
            var providerText = root.TryGetProperty("text", out var text) && text.ValueKind == JsonValueKind.String ? text.GetString()! : "";
            var language = languageHint != "auto" ? languageHint : root.TryGetProperty("language", out var lang) ? lang.GetString() ?? "und" : "und";
            language = Language(language);
            var words = new List<JsonElement>();
            if (!segmentOnly && root.TryGetProperty("words", out var top) && top.ValueKind == JsonValueKind.Array) words.AddRange(top.EnumerateArray());
            var segments = root.TryGetProperty("segments", out var seg) && seg.ValueKind == JsonValueKind.Array ? seg.EnumerateArray().ToList() : [];
            if (!segmentOnly && words.Count == 0)
                foreach (var segment in segments)
                    if (segment.TryGetProperty("words", out var nested) && nested.ValueKind == JsonValueKind.Array) words.AddRange(nested.EnumerateArray());
            var timing = words.Count > 0 ? "word" : "segment";
            var entries = words.Count > 0 ? words : segments;
            if (entries.Count == 0) throw new ServiceFailure("timestamps_missing", "The endpoint returned no timed words or segments. Choose a model supporting verbose_json timestamps.");
            if (entries.Count > 100_000) throw new ServiceFailure("transcript_too_large", "The endpoint returned more than 100,000 tokens. Transcribe a shorter recording.");
            var texts = entries.Select(e => e.GetProperty(timing == "word" ? "word" : "text").GetString() ?? throw new InvalidDataException()).ToList();
            static string Compact(string s) => string.Concat(s.Where(c => !char.IsWhiteSpace(c)));
            if (language == "und") language = Normalization.Detect(string.Concat(texts));
            var matches = Compact(string.Concat(texts)) == Compact(providerText);
            var full = new StringBuilder(); var tokens = new List<TimedToken>(); var cursor = 0;
            foreach (var (entry, index) in entries.Select((entry, index) => (entry, index)))
            {
                var value = texts[index];
                if (value.Length == 0) throw new InvalidDataException();
                var separator = "";
                if (matches)
                {
                    if (!char.IsWhiteSpace(value[0]))
                    {
                        var start = cursor;
                        while (cursor < providerText.Length && char.IsWhiteSpace(providerText[cursor])) cursor++;
                        separator = providerText[start..cursor];
                    }
                    foreach (var character in value)
                    {
                        if (char.IsWhiteSpace(character))
                        {
                            while (cursor < providerText.Length && char.IsWhiteSpace(providerText[cursor])) cursor++;
                        }
                        else
                        {
                            while (cursor < providerText.Length && char.IsWhiteSpace(providerText[cursor])) cursor++;
                            cursor++;
                        }
                    }
                }
                else if (index > 0 && !char.IsWhiteSpace(value[0]) && !char.IsWhiteSpace(full[^1]) && !language.StartsWith("ja", StringComparison.Ordinal) && language is not ("zh" or "ko" or "th" or "lo" or "km") && char.IsLetterOrDigit(value[0]) && char.IsLetterOrDigit(full[^1])) separator = " ";
                full.Append(separator); var position = full.Length; full.Append(value);
                var startTime = Seconds(entry.GetProperty("start")); var endTime = Seconds(entry.GetProperty("end"));
                if (startTime < 0 || endTime < startTime) throw new InvalidDataException();
                tokens.Add(new("t" + index, value, separator, position, full.Length, checked(startTime + offset), checked(endTime + offset)));
            }
            var warnings = new List<ImportIssue>();
            if (!matches) warnings.Add(new("transcript_text_mismatch", "Timed-token text differs from the provider's full transcript. Karaoke retains the timed-token text.", "text"));
            if (timing == "segment") warnings.Add(new("segment_timing_only", "Only segment timing is available. Splits inside a segment and word karaoke are unavailable."));
            if (tokens.Zip(tokens.Skip(1)).Any(p => p.Second.Start < p.First.End)) warnings.Add(new("overlapping_token_times", "Overlapping or decreasing token times were preserved."));
            var result = new Transcript(item, user, id, full.ToString(), providerText, language, timing, tokens, [raw], profile, warnings, DateTimeOffset.UtcNow);
            TranscriptBoundaries.Validate(result, [tokens[^1].Id]); return result;
        }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException or FormatException or OverflowException or ArgumentException or InvalidDataException)
        { throw new ServiceFailure("invalid_transcription_response", "The endpoint returned malformed text or timestamps. Existing lyrics were retained; choose a compatible model or retry."); }
    }
    private static long Seconds(JsonElement element)
    {
        var seconds = element.GetDouble();
        if (!double.IsFinite(seconds) || seconds < 0 || seconds > TimeSpan.MaxValue.TotalSeconds / 2) throw new InvalidDataException();
        return checked((long)Math.Round(seconds * TimeSpan.TicksPerSecond, MidpointRounding.AwayFromZero));
    }
    private static string Language(string language)
    {
        var culture = CultureInfo.GetCultures(CultureTypes.NeutralCultures).FirstOrDefault(c => string.Equals(c.Name, language, StringComparison.OrdinalIgnoreCase) || string.Equals(c.EnglishName, language, StringComparison.OrdinalIgnoreCase));
        return culture?.Name is { Length: > 0 } name ? name : "und";
    }
}

public sealed class LinguisticBoundaries : IBoundaryStrategy
{
    public string Version => "unicode/1+NMeCab-0.10.1-IpaDic-0.10.0/1";
    public IReadOnlyList<BoundaryAdvice> Analyze(Transcript transcript, CancellationToken token)
    {
        var result = new Dictionary<string, BoundaryAdvice>();
        var source = transcript.Text;
        var japanese = transcript.Language.StartsWith("ja", StringComparison.Ordinal);
        var morphs = new Dictionary<int, (string Surface, string[] Features)>();
        if (japanese)
        {
            using var tagger = MeCabTagger.Create(Path.Combine(Path.GetDirectoryName(typeof(LinguisticBoundaries).Assembly.Location)!, "KawazuDictionary"));
            var cursor = 0;
            foreach (var node in tagger.Parse(source))
            {
                token.ThrowIfCancellationRequested();
                if (string.IsNullOrEmpty(node.Surface)) continue;
                var position = source.IndexOf(node.Surface, cursor, StringComparison.Ordinal);
                if (position < 0) throw new InvalidDataException("Japanese analysis did not align with transcript.");
                cursor = position + node.Surface.Length;
                morphs[cursor] = (node.Surface, node.Feature.Split(','));
            }
        }
        var orderedMorphs = morphs.OrderBy(pair => pair.Key).ToArray();
        var nextMorph = 0;
        for (var i = 0; i < transcript.Tokens.Count - 1; i++)
        {
            token.ThrowIfCancellationRequested();
            var left = transcript.Tokens[i]; var right = transcript.Tokens[i + 1];
            var end = left.Text.TrimEnd().LastOrDefault(); var start = right.Text.TrimStart().FirstOrDefault();
            double cost = 5; string? warning = null; var allowed = true;
            if (end is '.' or '?' or '!' or '。' or '？' or '！') cost = -7;
            else if (end is ',' or ';' or ':' or '、' or '，') cost = -2;
            if (start is '.' or ',' or '?' or '!' or '。' or '、' or '？' or '！' or ')' or '）' or 'ー') { cost += 24; warning = "This separates punctuation from its phrase."; }
            if (japanese)
            {
                if (!morphs.TryGetValue(left.EndPosition, out var m)) { allowed = false; warning = "This splits a Japanese word."; }
                else
                {
                    var f = m.Features;
                    if (f.Length > 1 && f[0] == "助詞" && f[1] == "終助詞") cost -= 11;
                    else if (f[0] is "助動詞" or "動詞" or "形容詞" && f.Length > 5 && f[5] == "基本形") cost -= 4;
                    if (f[0] == "動詞" && f.Length > 5 && f[5].Contains("連用", StringComparison.Ordinal)) { cost += 18; warning = "This may separate a verb from its continuation."; }
                    while (nextMorph < orderedMorphs.Length && orderedMorphs[nextMorph].Key <= left.EndPosition) nextMorph++;
                    var following = nextMorph < orderedMorphs.Length ? orderedMorphs[nextMorph].Value.Features : null;
                    if (following is { Length: > 1 } && (following[0] is "助動詞" or "助詞" || following[1] is "非自立" or "接尾"))
                    { cost += 22; warning = "This may detach a particle or auxiliary."; }
                }
            }
            else if (right.Separator.Length == 0 && !char.IsWhiteSpace(start) && char.IsLetterOrDigit(end) && char.IsLetterOrDigit(start) && transcript.Language is not ("zh" or "ko" or "th" or "lo" or "km"))
            { allowed = false; warning = "This may split a word."; }
            var a = left.Text.Trim().ToLowerInvariant(); var b = right.Text.Trim().ToLowerInvariant();
            if (transcript.Language == "en" && (new[] { "a", "an", "the", "to", "will", "would", "could", "should", "have", "has", "is", "are", "was", "were", "don't", "can't" }.Contains(a) || b is "n't" or "'s" or "'re" or "'ve"))
            { cost += 20; warning = "This may detach a word from its phrase."; }
            result[left.Id] = new(left.Id, cost, warning, allowed);
        }
        return result.Values.ToList();
    }
}

public sealed class TranscriptionProvider : IDisposable
{
    public const int BoundaryReviewPromptVersion = BoundaryReviewPlanning.PromptVersion;
    private readonly HttpClient client;
    private readonly Microsoft.Extensions.Logging.ILogger<TranscriptionProvider>? logger;
    private readonly bool owns;
    public TranscriptionProvider(HttpClient? client = null, Microsoft.Extensions.Logging.ILogger<TranscriptionProvider>? logger = null)
    {
        this.logger = logger;
        owns = client == null;
        this.client = client ?? new HttpClient(new HttpClientHandler { AllowAutoRedirect = false });
        this.client.Timeout = Timeout.InfiniteTimeSpan;
    }
    public void Dispose() { if (owns) client.Dispose(); }
    public async Task<string> Transcribe(PreparedAudio audio, TranscriptionConfig settings, AudioRequest input, CancellationToken cancellation)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, settings.Endpoint.TrimEnd('/') + "/audio/transcriptions");
        if (!string.IsNullOrWhiteSpace(settings.ApiKey)) request.Headers.Authorization = new("Bearer", settings.ApiKey);
        using var content = new MultipartFormDataContent();
        content.Add(new StringContent(settings.Model), "model"); content.Add(new StringContent("verbose_json"), "response_format");
        content.Add(new StringContent("0"), "temperature");
        if (input.Language != "auto") content.Add(new StringContent(input.Language), "language");
        if (!input.SegmentOnly) content.Add(new StringContent("word"), "timestamp_granularities[]");
        content.Add(new StringContent("segment"), "timestamp_granularities[]");
        await using var file = File.OpenRead(audio.Path);
        var body = new StreamContent(file); body.Headers.ContentType = new MediaTypeHeaderValue(settings.UploadFormat switch { "flac" => "audio/flac", "opus" => "audio/ogg", _ => "audio/wav" });
        content.Add(body, "file", "audio." + (settings.UploadFormat == "opus" ? "ogg" : settings.UploadFormat)); request.Content = content;
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation); deadline.CancelAfter(TimeSpan.FromSeconds(settings.TimeoutSeconds));
        try
        {
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            Check(response, "transcription", !input.SegmentOnly);
            return await ReadBounded(response, deadline.Token);
        }
        catch (OperationCanceledException) when (!cancellation.IsCancellationRequested) { throw new ServiceFailure("service_timeout", "Transcription timed out. Increase the service timeout or retry."); }
    }
    public async Task<ModelLimits?> FetchModelLimits(ServiceConfig settings, CancellationToken cancellation)
    {
        if (!ServiceSetup.EndpointValid(settings.Endpoint) || string.IsNullOrWhiteSpace(settings.Model)) throw new ArgumentException("Choose a valid connection and model.");
        using var request = new HttpRequestMessage(HttpMethod.Get, settings.Endpoint.TrimEnd('/') + "/models");
        if (!string.IsNullOrWhiteSpace(settings.ApiKey)) request.Headers.Authorization = new("Bearer", settings.ApiKey);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation); deadline.CancelAfter(TimeSpan.FromSeconds(30));
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token); Check(response, "model metadata", false);
        using var json = JsonDocument.Parse(await ReadBounded(response, deadline.Token));
        if (!json.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array) return null;
        var models = data.EnumerateArray().Where(m => m.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String && id.GetString() == settings.Model).ToList();
        if (models.Count != 1) return null;
        static int? Number(JsonElement obj, string key) => obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number) && number is > 0 and <= 10000000 ? number : null;
        var model = models[0]; var context = Number(model, "context_length"); int? completion = null;
        if (model.TryGetProperty("top_provider", out var top))
        {
            var providerContext = Number(top, "context_length");
            if (providerContext.HasValue) context = context.HasValue ? Math.Min(context.Value, providerContext.Value) : providerContext;
            completion = Number(top, "max_completion_tokens");
        }
        return context is >= 1024 ? new(context.Value, completion) : null;
    }
    public async Task<List<string>> Review(Transcript transcript, BoundaryVersion version, ServiceConfig settings, CancellationToken cancellation)
    {
        var plan = BoundaryReviewPlanning.Create(transcript, version, settings); var ends = new List<string>();
        for (var i = 0; i < plan.Batches.Count; i++) ends.AddRange((await ReviewBatch(transcript, version, settings, plan.Batches[i], i, plan.RequestCount, "untracked", cancellation)).EndTokenIds);
        TranscriptBoundaries.Validate(transcript, ends); return ends;
    }
    public async Task<(List<string> EndTokenIds, string RawResponse)> ReviewBatch(Transcript transcript, BoundaryVersion version, ServiceConfig settings, ReviewBatch batch, int index, int count, string correlation, CancellationToken cancellation)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, settings.Endpoint.TrimEnd('/') + "/chat/completions");
        if (!string.IsNullOrWhiteSpace(settings.ApiKey)) request.Headers.Authorization = new("Bearer", settings.ApiKey);
        request.Content = System.Net.Http.Json.JsonContent.Create(BoundaryReviewPlanning.Request(transcript, version, settings, batch), options: BoundaryReviewPlanning.WireJson);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation); deadline.CancelAfter(TimeSpan.FromSeconds(settings.TimeoutSeconds));
        var elapsed = System.Diagnostics.Stopwatch.StartNew();
        logger?.LogInformation("LyricBridge review batch started: job {JobId}; batch {Batch}/{Count}; timeout {Seconds}s", correlation, index + 1, count, settings.TimeoutSeconds);
        try
        {
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            logger?.LogInformation("LyricBridge review response: job {JobId}; batch {Batch}/{Count}; status {Status}; elapsed {ElapsedMs} ms; request {RequestId}; generation {GenerationId}", correlation, index + 1, count, (int)response.StatusCode, elapsed.ElapsedMilliseconds, SafeHeader(response, "x-request-id"), SafeHeader(response, "x-generation-id"));
            if ((int)response.StatusCode is 400 or 413 or 422) throw new ServiceFailure("review_request_rejected", "The review endpoint rejected the request or its context budget. Ask an administrator to check the model and reduce the context budget before retrying. Your current line breaks were retained.");
            Check(response, "boundary review", false);
            var raw = await ReadBounded(response, deadline.Token);
            using var envelope = JsonDocument.Parse(raw);
            if (envelope.RootElement.TryGetProperty("error", out _)) throw new ServiceFailure("service_unavailable", "The AI review provider reported an error. Check its configuration or retry. Your current line breaks were retained.");
            logger?.LogInformation("LyricBridge review parsed: job {JobId}; batch {Batch}/{Count}; generation {GenerationId}; elapsed {ElapsedMs} ms", correlation, index + 1, count, SafeId(envelope.RootElement.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String ? id.GetString() : null), elapsed.ElapsedMilliseconds);
            if (envelope.RootElement.GetProperty("choices")[0].TryGetProperty("finish_reason", out var finish) && finish.GetString() == "length") throw new ServiceFailure("boundary_response_truncated", "AI review stopped before completing its response. Try another review model. Your current line breaks were retained.");
            using var answer = JsonDocument.Parse(envelope.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString()!);
            if (answer.RootElement.EnumerateObject().Count() != 1) throw new InvalidDataException();
            var ids = answer.RootElement.GetProperty("endTokenIds").EnumerateArray().Select(e => e.GetString() ?? throw new InvalidDataException()).ToList();
            ValidateBatch(transcript, batch, ids);
            return (ids, raw);
        }
        catch (OperationCanceledException) when (!cancellation.IsCancellationRequested)
        {
            logger?.LogWarning("LyricBridge review timeout: job {JobId}; batch {Batch}/{Count}; timeout {Seconds}s; elapsed {ElapsedMs} ms", correlation, index + 1, count, settings.TimeoutSeconds, elapsed.ElapsedMilliseconds);
            throw new ServiceFailure("service_timeout", $"AI review batch {index + 1} of {count} timed out after {settings.TimeoutSeconds} seconds. Your current line breaks were retained. Retry can reuse compatible completed batches.");
        }
        catch (Exception e) when (e is JsonException or InvalidDataException or KeyNotFoundException or InvalidOperationException or ArgumentException)
        { throw new ServiceFailure("invalid_boundary_response", "AI review did not return the required line-break JSON format. Your current line breaks were retained."); }
    }
    public static void ValidateBatch(Transcript transcript, ReviewBatch batch, List<string> ids)
    {
        var legal = TranscriptBoundaries.Allowed(transcript).ToHashSet();
        var eligible = transcript.Tokens.GetRange(batch.First, batch.Last - batch.First).Where(t => legal.Contains(t.Id)).Select(t => t.Id).ToList();
        var positions = ids.Select(id => eligible.IndexOf(id)).ToList();
        if (positions.Any(i => i < 0)) throw new ServiceFailure("invalid_boundary_response", "AI review returned context-only or unknown boundary IDs. Your current line breaks were retained.");
        if (ids.Count == 0 || ids[^1] != eligible[^1]) throw new ServiceFailure("invalid_boundary_response", "AI review omitted the required final boundary for its batch. Your current line breaks were retained.");
        if (positions.Distinct().Count() != positions.Count || !positions.SequenceEqual(positions.Order())) throw new ServiceFailure("invalid_boundary_response", "AI review repeated or reordered boundary IDs. Your current line breaks were retained.");
    }
    private static string SafeId(string? value) => value != null && value.Length <= 160 && value.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_') ? value : "unavailable";
    private static string SafeHeader(HttpResponseMessage response, string name) => SafeId(response.Headers.TryGetValues(name, out var values) ? values.FirstOrDefault() : null);
    private static void Check(HttpResponseMessage response, string service, bool wordMode)
    {
        var code = (int)response.StatusCode;
        if (code is >= 200 and < 300) return;
        if (code == 413) throw new ServiceFailure("audio_too_large", "Prepared audio exceeds the endpoint's limit. Choose Transcribe in chunks.");
        if (code is 400 or 422 && wordMode) throw new ServiceFailure("timestamp_request_unsupported", "The endpoint rejected the model or timestamp options. Check its model, or explicitly retry with segment timing only.");
        if (code is 401 or 403) throw new ServiceFailure("service_credentials", "The endpoint rejected its credentials or account permissions. Ask an administrator to check its setup.");
        if (code == 429) throw new ServiceFailure("rate_limited", "The endpoint is rate limited. Retry after the indicated time.", response.Headers.RetryAfter?.Date ?? DateTimeOffset.UtcNow.Add(response.Headers.RetryAfter?.Delta ?? TimeSpan.FromMinutes(1)));
        if (code is >= 300 and < 400) throw new ServiceFailure("endpoint_redirect", "The endpoint redirected the request. Configure the final API base URL; audio and credentials were not forwarded.");
        throw new ServiceFailure("service_unavailable", "The " + service + " endpoint could not complete the request (HTTP " + code + "). Existing lyrics were retained.");
    }
    private static async Task<string> ReadBounded(HttpResponseMessage response, CancellationToken cancellation)
    {
        const int limit = 32_000_000;
        if (response.Content.Headers.ContentLength > limit) throw new ServiceFailure("response_too_large", "The provider response exceeded 32 MB.");
        await using var input = await response.Content.ReadAsStreamAsync(cancellation); using var output = new MemoryStream();
        var buffer = new byte[81920]; int count;
        while ((count = await input.ReadAsync(buffer, cancellation)) != 0) { if (output.Length + count > limit) throw new ServiceFailure("response_too_large", "The provider response exceeded 32 MB."); await output.WriteAsync(buffer.AsMemory(0, count), cancellation); }
        return new UTF8Encoding(false, true).GetString(output.ToArray());
    }
}
