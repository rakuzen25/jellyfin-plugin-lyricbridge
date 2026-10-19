namespace LyricBridge;

public sealed class TranscriptionTask(Func<Job, TranscriptionConfig> resolve, ITranscriptionRepository store, IAudioPreparation audio, TranscriptionProvider provider) : IRemoteTaskHandler
{
    public string Kind => "transcription";
    private static TranscriptionConfig Snapshot(TranscriptionConfig c) => Codec.Deserialize<TranscriptionConfig>(Codec.Serialize(c))!;
    public GenerationProfile Profile(Job job) => EffectiveProfile(resolve(job), job);
    private GenerationProfile EffectiveProfile(TranscriptionConfig c, Job job)
    {
        TranscriptionConfig.Validate(c);
        if (!c.Enabled) throw new WorkflowException(409, "service_not_configured", "Ask an administrator to enable the transcription service.");
        return new("Transcription", Codec.Hash(Codec.Serialize(new { c.Endpoint, c.UploadFormat, c.MaxUploadMb, c.MaxInputMb, c.TimeoutSeconds })), c.Model, Kind, "", job.Audio!.Language, "", 0, 0, 1);
    }
    public void Release(Job job) { if (job.OutputDeleted || job.State is "complete" or "cancelled" or "rejected") { audio.Release(job); store.DiscardChunks(job.Id); } }
    public async Task Execute(Job job, IProgress<int> progress, CancellationToken token)
    {
        var settings = Snapshot(resolve(job));
        if (EffectiveProfile(settings, job) != job.Profile) throw new ServiceFailure("settings_changed", "Transcription settings changed. Retry using current settings.");
        job.Stage = "Preparing audio";
        var prepared = await audio.Prepare(job, settings, progress, token);
        var limit = settings.MaxUploadMb * 1_000_000L - 65536;
        var chunks = new List<PreparedAudio> { prepared };
        if (new FileInfo(prepared.Path).Length > limit || job.Audio!.AllowChunking)
        {
            chunks = await audio.PlanChunks(job, prepared, settings, token);
            job.Audio = job.Audio! with { ChunkCount = chunks.Count };
            if (!job.Audio.AllowChunking) throw new ServiceFailure("audio_too_large", "Prepared audio exceeds the upload limit. Choose Transcribe in chunks (" + chunks.Count + " chunks).");
        }
        await using var preparedStream = File.OpenRead(prepared.Path);
        var audioIdentity = Convert.ToHexString(await System.Security.Cryptography.SHA256.HashDataAsync(preparedStream, token));
        var identity = Codec.Hash(Codec.Serialize(new { job.Profile, audioIdentity, job.Audio!.SegmentOnly, chunks = chunks.Select(c => new { c.StartTicks, c.DurationTicks }) }));
        var checkpoints = store.Chunks(job.Id).Where(c => c.ProfileIdentity == identity).ToDictionary(c => c.Index);
        var results = new List<Transcript>();
        for (var i = 0; i < chunks.Count; i++)
        {
            token.ThrowIfCancellationRequested(); job.Stage = "Transcribing chunk " + (i + 1) + " of " + chunks.Count; progress.Report(10 + i * 80 / chunks.Count);
            if (new FileInfo(chunks[i].Path).Length > limit) throw new ServiceFailure("audio_too_large", "An audio chunk still exceeds the configured upload limit. Lower the upload limit to create smaller chunks.");
            var raw = checkpoints.GetValueOrDefault(i)?.RawResponse ?? await provider.Transcribe(chunks[i], settings, job.Audio!, token);
            var parsed = TranscriptionResponse.Parse(raw, job.ItemId, job.UserId, job.Hash, job.Profile!, job.Audio!.SegmentOnly, chunks[i].StartTicks, job.Audio.Language);
            store.SaveChunk(job, new(job.Id + ":" + i, job.Id, i, chunks[i].StartTicks, raw, identity)); results.Add(parsed);
        }
        var combined = Combine(results, job);
        job.Stage = "Preserving transcript"; progress.Report(95);
        token.ThrowIfCancellationRequested();
        if (!store.CompleteTranscript(job, combined, null)) throw new OperationCanceledException();
    }
    private static Transcript Combine(List<Transcript> results, Job job)
    {
        var tokens = new List<TimedToken>(); var text = new System.Text.StringBuilder();
        foreach (var part in results)
            foreach (var t in part.Tokens)
            {
                var separator = t.Separator;
                if (tokens.Count > 0 && t == part.Tokens[0] && separator.Length == 0 && part.Language is not ("ja" or "zh" or "ko" or "th" or "lo" or "km") && !char.IsWhiteSpace(text[^1]) && !char.IsWhiteSpace(t.Text[0])) separator = " ";
                text.Append(separator); var start = text.Length; text.Append(t.Text);
                tokens.Add(t with { Id = "t" + tokens.Count, Separator = separator, Position = start, EndPosition = text.Length });
            }
        var warnings = results.SelectMany(t => t.Warnings).Distinct().ToList();
        if (results.Count > 1) warnings.Add(new("chunk_seams", "Transcribed in " + results.Count + " non-overlapping chunks. Review wording and timing around chunk seams."));
        var timing = results.All(t => t.Timing == "word") ? "word" : "segment";
        if (results.Select(t => t.Timing).Distinct().Count() > 1) throw new ServiceFailure("mixed_chunk_timing", "Chunks returned inconsistent word/segment timing. Retry with segment timing only for an honest consistent timeline.");
        return new(job.ItemId, job.UserId, job.Hash, text.ToString(), string.Join("\n", results.Select(t => t.ProviderText)), results[0].Language, timing, tokens, results.SelectMany(t => t.RawResponses).ToList(), job.Profile!, warnings, DateTimeOffset.UtcNow, job.Title, job.Artist, job.Request.OptionName);
    }
}
public sealed class BoundaryReviewTask(Func<Job, ServiceConfig> resolve, ITranscriptionRepository store, TranscriptionProvider provider, IBoundaryStrategy strategy) : IRemoteTaskHandler
{
    public string Kind => "boundary-review";
    public GenerationProfile Profile(Job job) => EffectiveProfile(resolve(job));
    private GenerationProfile EffectiveProfile(ServiceConfig c)
    {
        if (!Uri.TryCreate(c.Endpoint, UriKind.Absolute, out _) || string.IsNullOrWhiteSpace(c.Model)) throw new WorkflowException(409, "service_not_configured", "Ask an administrator to configure an AI boundary-review model.");
        return new("AI", Codec.Hash(Codec.Serialize(new { c.Endpoint, c.TimeoutSeconds, c.ModelContextWindow, c.ModelCompletionLimit })), c.Model, Kind, "", "auto", c.ReasoningEffort, 0, 0, TranscriptionProvider.BoundaryReviewPromptVersion);
    }
    public ReviewPlan Plan(Job job)
    {
        var settings = resolve(job);
        var transcript = store.Transcript(job.Review!.TranscriptId) ?? throw new WorkflowException(409, "transcript_unavailable", "This transcription was deleted.");
        var version = job.Review.Snapshot ?? throw new WorkflowException(409, "version_unavailable", "Reopen a saved boundary version.");
        version = version with { Settings = job.Review.Settings };
        var natural = TranscriptBoundaries.Optimize(transcript, version.Settings, strategy.Analyze(transcript, CancellationToken.None), strategy.Version);
        return BoundaryReviewPlanning.Create(transcript, version, settings, natural.EndTokenIds);
    }
    public void Release(Job job) { if (job.OutputDeleted || job.State is "complete" or "cancelled" or "rejected") store.DiscardReviewCheckpoints(job.Id); }
    public async Task Execute(Job job, IProgress<int> progress, CancellationToken token)
    {
        var settings = Codec.Deserialize<ServiceConfig>(Codec.Serialize(resolve(job)))!;
        if (EffectiveProfile(settings) != job.Profile) throw new ServiceFailure("settings_changed", "Review settings changed. Retry using current settings.");
        var transcript = store.Transcript(job.Review!.TranscriptId) ?? throw new WorkflowException(409, "transcript_unavailable", "This transcription was deleted.");
        var version = job.Review.Snapshot ?? throw new WorkflowException(409, "version_unavailable", "Reopen a saved boundary version.");
        job.Stage = "Reviewing line breaks"; progress.Report(10);
        version = version with { Settings = job.Review.Settings };
        var natural = TranscriptBoundaries.Optimize(transcript, version.Settings, strategy.Analyze(transcript, token), strategy.Version, token);
        var plan = BoundaryReviewPlanning.Create(transcript, version, settings, natural.EndTokenIds);
        if (job.Review!.PlanIdentity is { } expected && expected != plan.Identity) throw new ServiceFailure("settings_changed", "The AI review plan changed. Refresh the request count and retry using current settings.");
        job.ReviewPlan = plan;
        var checkpoints = store.ReviewCheckpoints(job.Id).Where(c => c.Identity == plan.Identity).ToDictionary(c => c.Index);
        var ends = new List<string>();
        for (var i = 0; i < plan.RequestCount; i++)
        {
            token.ThrowIfCancellationRequested();
            job.Stage = $"Reviewing batch {i + 1} of {plan.RequestCount}" + (checkpoints.ContainsKey(i) ? " · reusing completed batch" : ""); progress.Report(i * 90 / plan.RequestCount + 5);
            if (checkpoints.TryGetValue(i, out var checkpoint)) { TranscriptionProvider.ValidateBatch(transcript, plan.Batches[i], checkpoint.EndTokenIds); ends.AddRange(checkpoint.EndTokenIds); continue; }
            var response = await provider.ReviewBatch(transcript, version, settings, plan.Batches[i], i, plan.RequestCount, job.Id, token);
            store.SaveReviewCheckpoint(job, new(job.Id + ":" + i, job.Id, transcript.Id, i, plan.Identity, response.EndTokenIds, response.RawResponse));
            ends.AddRange(response.EndTokenIds);
        }
        TranscriptBoundaries.Validate(transcript, ends);
        var result = TranscriptBoundaries.Version(transcript, "AI", job.Review.Settings, ends, "boundary-review/1+" + strategy.Version, job.Profile) with { OptionName = job.Request.OptionName, SeamTokenIds = plan.Batches.Where(b => b.WeakSeam).Select(b => transcript.Tokens[b.Last - 1].Id).ToList() };
        token.ThrowIfCancellationRequested(); if (!store.CompleteTranscript(job, null, result)) throw new OperationCanceledException();
    }
}
