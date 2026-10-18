namespace LyricBridge;

public sealed record ExportInput(string Format = "lrc", string Layout = "original", bool Translation = false, bool Pronunciation = false, bool LosslessCopy = true, string? Fingerprint = null);
public sealed record ExportPlayback(string SourceLanguage, string TranslationLanguage, string OriginalChineseScript, double TimingSeconds);
public sealed record ExportAuxiliary(Dictionary<string, string> Translation, Dictionary<string, string> Pronunciation);
public sealed record NativeLyricDocument(string Schema, int Version, string TimingUnit, RichLyrics Lyrics, ExportAuxiliary Selected, ExportPlayback Playback);
public sealed record ExportFilePreview(string FileName, string Text, int Bytes);
public sealed record ExportPreview(string FileName, string Fingerprint, IReadOnlyList<ExportFilePreview> Files, IReadOnlyList<ImportIssue> Warnings, bool HasTranslation, bool HasPronunciation);
public sealed record ExportArtifact(string FileName, string ContentType, byte[] Bytes, ExportPreview Preview);
public sealed record BundleEntry(string FileName, string Role, string Format, string? Language, string[] RowIds);
public sealed record LyricBundle(string Schema, int Version, IReadOnlyList<BundleEntry> Files, IReadOnlyList<ImportIssue> Warnings);

public static class ExportPreferences
{
    public static SongLanguagePreferences Restore(NativeLyricDocument document, Preferences account)
    {
        var p = document.Playback;
        static string Identity(string tag, bool translation = false)
        {
            var parts = tag.Split('-'); var primary = parts[0].ToLowerInvariant();
            if (primary == "zh")
                return translation ? "zh-" + (tag.StartsWith("zh-Hant", StringComparison.OrdinalIgnoreCase) || tag.Equals("zh-TW", StringComparison.OrdinalIgnoreCase) || tag.Equals("zh-HK", StringComparison.OrdinalIgnoreCase) ? "Hant" : "Hans") : "zh";
            var script = parts.Skip(1).FirstOrDefault(part => part.Length == 4);
            return primary + (script is null ? "" : "-" + script.ToLowerInvariant());
        }
        var detected = LyricRows.All(document.Lyrics).Select(l => Identity(l.Language)).Distinct().ToArray();
        var sameSource = Identity(account.SourceLanguage) == Identity(p.SourceLanguage) ||
            account.SourceLanguage == "auto" && detected.Length == 1 && detected[0] == Identity(p.SourceLanguage) ||
            p.SourceLanguage == "auto" && detected.Length == 1 && detected[0] == Identity(account.SourceLanguage);
        var usesChinese = LyricRows.All(document.Lyrics).Any(l => (p.SourceLanguage == "auto" ? l.Language : p.SourceLanguage).StartsWith("zh", StringComparison.OrdinalIgnoreCase));
        return new(sameSource ? null : p.SourceLanguage,
            Identity(account.TranslationLanguage, true) == Identity(p.TranslationLanguage, true) ? null : p.TranslationLanguage,
            !usesChinese || account.OriginalChineseScript == p.OriginalChineseScript ? null : p.OriginalChineseScript);
    }
}
