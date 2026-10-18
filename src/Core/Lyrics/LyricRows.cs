namespace LyricBridge;

public static class LyricRows
{
    public static IEnumerable<LyricLine> All(RichLyrics lyrics) =>
        lyrics.Lines.SelectMany(line => line.Background is null ? new[] { line } : new[] { line, line.Background });

    public static void ValidateGenerated(IEnumerable<string> expected, Dictionary<string, string> received)
    {
        if (!expected.Order().SequenceEqual(received.Keys.Order()))
            throw new InvalidDataException("Generated line identities did not match the source.");
    }
}
