using Lyricify.Lyrics.Helpers.General;
namespace LyricBridge;

public static class Display
{
    public static string TranslationScript(Preferences p) => p.TranslationLanguage.StartsWith("zh-Hant", StringComparison.OrdinalIgnoreCase) || p.TranslationLanguage is "zh-TW" or "zh-HK" ? "Traditional" : "Simplified";
    public static string Chinese(string text, string script) => script == "Traditional" ? ChineseHelper.S2T(text) : ChineseHelper.T2S(text);
    public static RichLyrics Apply(RichLyrics original, Preferences preferences)
    {
        var copy = Codec.Deserialize<RichLyrics>(Codec.Serialize(original))!;
        foreach (var line in copy.Lines) Convert(line, preferences);
        return copy;
    }
    private static void Convert(LyricLine line, Preferences p)
    {
        if (p.SourceLanguage != "auto") line.Language = p.SourceLanguage;
        if (line.Language.StartsWith("zh"))
        {
            // Conversion is presentation only. Retain UTF-16 cue positions exactly.
            var converted = Chinese(line.Text, p.OriginalChineseScript);
            bool Boundary(int position) => position >= 0 && position <= converted.Length && (position == converted.Length || !char.IsLowSurrogate(converted[position]));
            if (line.Cues.Count == 0 || (converted.Length == line.Text.Length && line.Cues.All(c => Boundary(c.Position) && Boundary(c.EndPosition)))) line.Text = converted;
        }
        foreach (var key in line.Translations.Keys.ToList()) if (key.StartsWith("zh")) line.Translations[key] = Chinese(line.Translations[key], TranslationScript(p));
        if (line.Background != null) Convert(line.Background, p);
    }
}
