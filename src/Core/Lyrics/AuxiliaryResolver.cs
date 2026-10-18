namespace LyricBridge;

public sealed record ResolvedAuxiliaryRow(string Text, string Key);
public sealed record ResolvedAuxiliary(Dictionary<string, ResolvedAuxiliaryRow> Translation, Dictionary<string, ResolvedAuxiliaryRow> Pronunciation, string TranslationLanguage, string SourceLanguage, string OriginalChineseScript, AuxiliaryChoices Choices);

/// <summary>One per-row selection policy for playback payloads and export snapshots.</summary>
public static class AuxiliaryResolver
{
    public static ResolvedAuxiliary Resolve(RichLyrics? lyrics, Preferences preferences, AuxiliaryChoices choices, IReadOnlyList<Variant> variants)
    {
        var result = new ResolvedAuxiliary(new(), new(), preferences.TranslationLanguage, preferences.SourceLanguage, preferences.OriginalChineseScript, choices);
        if (lyrics is null) return result;
        foreach (var line in LyricRows.All(lyrics))
            foreach (var kind in new[] { "translation", "pronunciation" })
            {
                var language = preferences.TranslationLanguage;
                var choice = kind == "translation" ? choices.Translation : choices.Pronunciation;
                var supplied = EmbeddedVersions.Text(line, kind, language);
                var map = kind == "translation" ? result.Translation : result.Pronunciation;
                if (choice == "provider" || choice == "auto" && EmbeddedVersions.HasText(supplied))
                {
                    if (EmbeddedVersions.HasText(supplied)) map[line.Id] = new(supplied!, "provider");
                    continue;
                }
                var matches = variants.Where(v => v.Kind == kind &&
                    (kind == "pronunciation" || v.Language == language || v.Language.Split('-')[0] == "zh" && language.Split('-')[0] == "zh") &&
                    v.Text.TryGetValue(line.Id, out var text) && EmbeddedVersions.HasText(text));
                var variant = choice != "auto" ? matches.FirstOrDefault(v => v.Key == choice)
                    : kind == "pronunciation" ? matches.FirstOrDefault(v => v.Service == "Kawazu") : matches.FirstOrDefault();
                if (variant is not null) map[line.Id] = new(variant.Text[line.Id], variant.Key);
            }
        return result;
    }
}
