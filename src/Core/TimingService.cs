namespace LyricBridge;

public sealed class TimingService(ISelectionRepository repository)
{
    public static string Fingerprint(RichLyrics lyrics) => Codec.Hash(Codec.Serialize(lyrics.Lines.SelectMany(line => line.Background is { } background ? new[] { line, background } : new[] { line }).Select(line => new { line.Id, line.Start, line.End, line.Cues })));
    public TimingCorrection Save(Guid item, VersionSnapshot expected, RichLyrics? current, TimingCorrection input)
    {
        if (current is null || Codec.ContentHash(current) != input.Hash) throw new WorkflowException(409, "lyric_version_changed", "Reload the current lyric version.", true);
        if (!double.IsFinite(input.Seconds) || Math.Abs(input.Seconds) > 15) throw new WorkflowException(400, "invalid_timing", "Choose a correction between −15 and +15 seconds.");
        if (Fingerprint(current) != input.Fingerprint) throw new WorkflowException(409, "lyric_timing_changed", "Reload the current lyric timeline.", true);
        if (!repository.SaveTiming(item, expected, input)) throw new WorkflowException(409, "lyric_version_changed", "The lyric state changed. Reload before saving timing.", true);
        return input;
    }
}
