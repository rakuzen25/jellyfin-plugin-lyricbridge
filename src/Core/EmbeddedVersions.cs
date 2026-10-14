namespace LyricBridge;

public static class EmbeddedVersions
{
    public static bool HasText(string? text) => text?.Any(c => !char.IsWhiteSpace(c) && c is not ('\u200B' or '\u200C' or '\u200D' or '\u200E' or '\u200F' or '\u2060' or '\u2066' or '\u2067' or '\u2068' or '\u2069' or '\uFEFF')) == true;
    public static string? Text(LyricLine line, string kind, string language)
    {
        if (kind == "pronunciation") return HasText(line.Pronunciation) ? line.Pronunciation : null;
        if (line.Translations.TryGetValue(language, out var exact) && HasText(exact)) return exact;
        var primary = language.Split('-')[0];
        return line.Translations.FirstOrDefault(pair => pair.Key.Split('-')[0] == primary && HasText(pair.Value)).Value;
    }
    public static bool Available(RichLyrics? lyrics, string kind, string language) => lyrics?.Lines.Any(line => Text(line, kind, language) is not null || line.Background is { } background && Text(background, kind, language) is not null) == true;
    public static string Choice(RichLyrics? lyrics, string kind, string language, string? selected) => selected == "provider" && !Available(lyrics, kind, language) ? "auto" : selected ?? "auto";
}
