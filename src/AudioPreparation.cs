using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.MediaEncoding;

namespace LyricBridge;

public sealed record AudioUpload(string Id, Guid ItemId, Guid UserId, long Bytes, DateTimeOffset Created);
/// <summary>Host-owned audio preparation; only authenticated item IDs and owned upload IDs resolve to paths.</summary>
public sealed class AudioPreparation(Store store, Func<ILibraryManager> libraryFactory, Func<IMediaEncoder> encoderFactory) : IAudioPreparation
{
    private readonly object uploadGate = new();
    private string Root => Path.Combine(store.ActiveStoragePath, "audio-staging");
    private string DirectoryFor(string id)
    {
        if (!Guid.TryParseExact(id, "N", out _)) throw new WorkflowException(400, "invalid_audio_id", "Choose a valid audio upload.");
        return Path.Combine(Root, id);
    }
    public async Task<AudioUpload> Upload(Guid item, Guid user, Stream stream, long limit, CancellationToken token)
    {
        Cleanup();
        var id = Guid.NewGuid().ToString("N"); var dir = DirectoryFor(id);
        lock (uploadGate)
        {
            Directory.CreateDirectory(Root);
            var reserved = Directory.EnumerateFiles(Root, "upload.json", SearchOption.AllDirectories)
                .Select(path => Codec.Deserialize<AudioUpload>(File.ReadAllText(path))).Count(upload => upload?.UserId == user);
            if (reserved >= 3) throw new WorkflowException(409, "audio_staging_limit", "Three audio uploads are already staged for this account. Finish or cancel their requests before uploading another.");
            Directory.CreateDirectory(dir);
            File.WriteAllText(Path.Combine(dir, "upload.json"), Codec.Serialize(new AudioUpload(id, item, user, 0, DateTimeOffset.UtcNow)));
        }
        try
        {
            await using var output = new FileStream(Path.Combine(dir, "input"), FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, true);
            var buffer = new byte[81920]; long bytes = 0; int count;
            while ((count = await stream.ReadAsync(buffer, token)) != 0)
            {
                bytes += count;
                if (bytes > limit) throw new WorkflowException(413, "audio_input_too_large", "The upload exceeds the administrator's input size limit.");
                await output.WriteAsync(buffer.AsMemory(0, count), token);
            }
            if (bytes == 0) throw new WorkflowException(400, "empty_audio", "Choose a nonempty audio file.");
            var result = new AudioUpload(id, item, user, bytes, DateTimeOffset.UtcNow);
            token.ThrowIfCancellationRequested();
            lock (uploadGate) File.WriteAllText(Path.Combine(dir, "upload.json"), Codec.Serialize(result));
            return result;
        }
        catch { Directory.Delete(dir, true); throw; }
    }
    public IReadOnlyList<AudioUpload> Uploads(Guid item, Guid user)
    {
        lock (uploadGate)
        {
            if (!Directory.Exists(Root)) return [];
            var active = store.ActiveJobs().Select(j => j.Audio?.UploadId).ToHashSet();
            return Directory.EnumerateFiles(Root, "upload.json", SearchOption.AllDirectories)
                .Select(path => Codec.Deserialize<AudioUpload>(File.ReadAllText(path))!)
                .Where(upload => upload.ItemId == item && upload.UserId == user && upload.Bytes > 0 && !active.Contains(upload.Id)).ToList();
        }
    }
    public void DeleteUpload(string id, Guid item, Guid user)
    {
        lock (uploadGate)
        {
            CheckUpload(id, item, user);
            if (store.ActiveJobs().Any(job => job.Audio?.UploadId == id)) throw new WorkflowException(409, "upload_in_use", "Cancel the audio request before discarding its input.");
            Directory.Delete(DirectoryFor(id), true);
        }
    }
    public void CheckUpload(string id, Guid item, Guid user)
    {
        var path = Path.Combine(DirectoryFor(id), "upload.json");
        var upload = File.Exists(path) ? Codec.Deserialize<AudioUpload>(File.ReadAllText(path)) : null;
        if (upload is null || upload.UserId != user || upload.ItemId != item) throw new WorkflowException(404, "audio_upload_missing", "Upload the audio again; this upload is unavailable to the current account and track.");
    }
    public async Task<PreparedAudio> Prepare(Job job, TranscriptionConfig settings, IProgress<int> progress, CancellationToken token)
    {
        Cleanup();
        var dir = DirectoryFor(job.Id); Directory.CreateDirectory(dir);
        string source;
        if (job.Audio!.Source == "upload") { CheckUpload(job.Audio.UploadId!, job.ItemId, job.UserId); source = Path.Combine(DirectoryFor(job.Audio.UploadId!), "input"); }
        else
        {
            var item = job.UserId == Guid.Empty ? libraryFactory().GetItemById<Audio>(job.ItemId) : libraryFactory().GetItemById<Audio>(job.ItemId, job.UserId);
            if (item is null || !Path.IsPathFullyQualified(item.Path) || !File.Exists(item.Path)) throw new ServiceFailure("audio_unavailable", "The accessible Jellyfin track has no readable local audio file.");
            source = item.Path;
        }
        var fingerprint = Codec.Hash(Codec.Serialize(new { source, size = new FileInfo(source).Length, modified = File.GetLastWriteTimeUtc(source), settings.UploadFormat }));
        if (new FileInfo(source).Length > settings.MaxInputMb * 1_000_000L) throw new ServiceFailure("audio_input_too_large", "The source audio exceeds the configured input size limit.");
        var output = Path.Combine(dir, "prepared." + settings.UploadFormat);
        var metadata = Path.Combine(dir, "prepared.json");
        if (File.Exists(output) && File.Exists(metadata))
        {
            var cached = Codec.Deserialize<PreparedManifest>(await File.ReadAllTextAsync(metadata, token));
            if (cached?.Fingerprint == fingerprint) return new(output, cached.DurationTicks);
        }
        var duration = 0L;
        var outputLimit = Math.Min(2_000_000_000L, Math.Max(64_000_000L, settings.MaxInputMb * 4_000_000L));
        await Run(["-nostdin", "-hide_banner", "-y", "-i", source, "-map", "0:a:0", "-vn", "-ar", "16000", "-ac", "1", "-map_metadata", "-1", .. CodecArguments(settings.UploadFormat), "-fs", outputLimit.ToString(CultureInfo.InvariantCulture), "-progress", "pipe:1", output], settings.TimeoutSeconds, token,
            line => { if (line.StartsWith("out_time_us=", StringComparison.Ordinal) && long.TryParse(line.AsSpan(12), out var micros)) duration = Math.Max(duration, micros * 10); job.Stage = "Preparing audio · " + TimeSpan.FromTicks(duration).ToString(@"hh\:mm\:ss", CultureInfo.InvariantCulture); progress.Report(5); });
        if (!File.Exists(output) || new FileInfo(output).Length == 0 || duration <= 0) throw new ServiceFailure("invalid_audio", "FFmpeg found no usable audio. Choose another recording.");
        if (new FileInfo(output).Length >= outputLimit - 65536) throw new ServiceFailure("prepared_audio_too_large", "Prepared audio reached the staging limit. Choose a shorter recording; incomplete audio was not sent for transcription.");
        await File.WriteAllTextAsync(metadata, Codec.Serialize(new PreparedManifest(fingerprint, duration)), token); return new(output, duration);
    }
    public async Task<List<PreparedAudio>> PlanChunks(Job job, PreparedAudio audio, TranscriptionConfig settings, CancellationToken token)
    {
        var bytes = new FileInfo(audio.Path).Length;
        var count = Math.Max(2, (int)Math.Ceiling(bytes / (settings.MaxUploadMb * 1_000_000d * .7)));
        count = Math.Max(count, job.Audio!.ChunkCount);
        if (count > 512) throw new ServiceFailure("too_many_chunks", "This recording would require more than 512 chunks. Use a larger upload limit or a shorter recording.");
        var silences = new List<long>();
        await Run(["-nostdin", "-hide_banner", "-i", audio.Path, "-af", "silencedetect=noise=-35dB:d=0.25", "-f", "null", "-"], settings.TimeoutSeconds, token, stderr: line =>
        {
            var match = Regex.Match(line, @"silence_end: ([\d.]+)", RegexOptions.CultureInvariant);
            if (match.Success && double.TryParse(match.Groups[1].Value, CultureInfo.InvariantCulture, out var seconds)) silences.Add((long)(seconds * TimeSpan.TicksPerSecond));
        });
        var cuts = new List<long> { 0 };
        for (var i = 1; i < count; i++)
        {
            var nominal = audio.DurationTicks * i / count;
            var nearest = silences.Where(t => Math.Abs(t - nominal) < Math.Min(TimeSpan.TicksPerSecond * 5, audio.DurationTicks / count / 4)).OrderBy(t => Math.Abs(t - nominal)).FirstOrDefault();
            cuts.Add(nearest > cuts[^1] ? nearest : nominal);
        }
        cuts.Add(audio.DurationTicks); var results = new List<PreparedAudio>();
        for (var i = 0; i < count; i++)
        {
            var path = Path.Combine(DirectoryFor(job.Id), "chunk-" + i + "." + settings.UploadFormat);
            var length = cuts[i + 1] - cuts[i];
            await Run(["-nostdin", "-hide_banner", "-y", "-i", audio.Path, "-ss", Seconds(cuts[i]), "-t", Seconds(length), "-map", "0:a:0", "-ar", "16000", "-ac", "1", "-map_metadata", "-1", .. CodecArguments(settings.UploadFormat), path], settings.TimeoutSeconds, token);
            results.Add(new(path, length, cuts[i]));
        }
        return results;
    }
    private sealed record PreparedManifest(string Fingerprint, long DurationTicks);
    private static string Seconds(long ticks) => (ticks / (decimal)TimeSpan.TicksPerSecond).ToString("0.#######", CultureInfo.InvariantCulture);
    private static string[] CodecArguments(string format) => format switch { "flac" => ["-sample_fmt", "s16", "-c:a", "flac", "-f", "flac"], "opus" => ["-c:a", "libopus", "-b:a", "24k", "-f", "ogg"], _ => ["-c:a", "pcm_s16le", "-f", "wav"] };
    private async Task Run(string[] arguments, int seconds, CancellationToken token, Action<string>? stdout = null, Action<string>? stderr = null)
    {
        var encoder = encoderFactory();
        if (string.IsNullOrWhiteSpace(encoder.EncoderPath) || !File.Exists(encoder.EncoderPath)) throw new ServiceFailure("ffmpeg_unavailable", "Configure Jellyfin's FFmpeg before transcribing audio.");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token); deadline.CancelAfter(TimeSpan.FromSeconds(seconds));
        using var process = new Process { StartInfo = new(encoder.EncoderPath) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true } };
        foreach (var arg in arguments) process.StartInfo.ArgumentList.Add(arg);
        process.Start();
        using var stop = deadline.Token.Register(() => { try { if (!process.HasExited) process.Kill(true); } catch (InvalidOperationException) { } });
        static async Task Drain(StreamReader reader, Action<string>? line, CancellationToken cancellation) { while (await reader.ReadLineAsync(cancellation) is { } value) line?.Invoke(value); }
        try
        {
            await Task.WhenAll(Drain(process.StandardOutput, stdout, deadline.Token), Drain(process.StandardError, stderr, deadline.Token), process.WaitForExitAsync(deadline.Token));
            if (process.ExitCode != 0) throw new ServiceFailure("audio_preparation_failed", "Jellyfin's FFmpeg could not prepare this audio. Check format support and file access.");
        }
        catch (OperationCanceledException) when (!token.IsCancellationRequested) { throw new ServiceFailure("audio_preparation_timeout", "Audio preparation timed out. Increase the service timeout or choose a shorter recording."); }
        finally { if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(CancellationToken.None); } }
    }
    public void Release(Job job)
    {
        var own = DirectoryFor(job.Id);
        if (Directory.Exists(own)) Directory.Delete(own, true);
        if (job.Audio is not { Source: "upload", UploadId: { } uploadId } || store.AudioUploadInUse(uploadId, job.Id)) return;
        var upload = DirectoryFor(uploadId);
        if (!Directory.Exists(upload)) return;
        CheckUpload(uploadId, job.ItemId, job.UserId);
        Directory.Delete(upload, true);
    }
    public void Clear() { if (Directory.Exists(Root)) Directory.Delete(Root, true); }
    public void Cleanup()
    {
        if (!Directory.Exists(Root)) return;
        var active = store.ActiveJobs().SelectMany(j => new[] { j.Id, j.Audio?.UploadId }).Where(id => id != null).ToHashSet();
        foreach (var dir in Directory.EnumerateDirectories(Root))
            if (!active.Contains(Path.GetFileName(dir)) && Directory.GetLastWriteTimeUtc(dir) < DateTime.UtcNow.AddDays(-7)) { Directory.Delete(dir, true); store.DiscardChunks(Path.GetFileName(dir)); }
    }
}
