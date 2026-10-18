namespace LyricBridge;

public sealed record TranslationContext(string Before, string After, bool Enabled)
{
    public const string Marker = "🔤";
    public string Neighbors => string.Join("\n", new[] { Before, After }.Where(s => !string.IsNullOrWhiteSpace(s)));
    public string Mark(string target)
    {
        if (!Enabled) return target;
        if (target.Contains(Marker) || Before.Contains(Marker) || After.Contains(Marker)) throw new InvalidDataException("Context marker occurs in the source text.");
        return string.Join("\n", new[] { Before, Marker, target, Marker, After }.Where(s => !string.IsNullOrEmpty(s)));
    }
    public static TranslationContext Window(IReadOnlyList<LyricLine> lines, int index, int before, int after)
    {
        if (before is < 0 or > 10 || after is < 0 or > 10) throw new ArgumentOutOfRangeException(nameof(before));
        return new(string.Join("\n", lines.Skip(Math.Max(0, index - before)).Take(Math.Min(index, before)).Select(l => l.Text)), string.Join("\n", lines.Skip(index + 1).Take(after).Select(l => l.Text)), before > 0 || after > 0);
    }
    public static string Extract(string translated, bool marked)
    {
        if (!marked) return translated;
        var parts = translated.Split(Marker, StringSplitOptions.None);
        if (parts.Length != 3 || string.IsNullOrWhiteSpace(parts[1])) throw new InvalidDataException("Translation did not preserve the target-line markers.");
        return parts[1].Trim();
    }
}
