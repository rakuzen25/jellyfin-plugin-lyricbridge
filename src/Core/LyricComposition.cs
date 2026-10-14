using System.Text;
namespace LyricBridge;

public sealed record MatchRejection(string Reason = "No correct provider match");
public sealed record ImportLyricsInput(string? Text = null, bool ExistingLocal = false, string? FileName = null, string? FileBytes = null, string Encoding = "auto", string Format = "auto");
public sealed record ImportIssue(string Code, string Message, string? Location = null);
public sealed record ImportedLyrics(RichLyrics Lyrics, RawLyrics Raw, string FileName, string Format, string Encoding, string Timing, int LineCount, IReadOnlyList<ImportIssue> Warnings);
public sealed record ImportPreview(string FileName, string Format, string Encoding, string Timing, int LineCount, LyricPayload Document, IReadOnlyList<ImportIssue> Warnings);
public sealed record MixInput(string Hash, string DonorHash, string Kind, string Language, Dictionary<string, string> Mapping);
public static class LyricComposition
{
    public static string TextKey(string text) => string.Concat(text.Normalize(NormalizationForm.FormKC).Where(char.IsLetterOrDigit)).ToLowerInvariant();
    public static Dictionary<string, string> Suggest(RichLyrics original, RichLyrics donor)
    {
        var a = LyricRows.All(original).ToList(); var b = LyricRows.All(donor).ToList(); var result = new Dictionary<string, string>(); var used = new HashSet<string>(); int previous = -1;
        foreach (var line in a)
        {
            var matches = b.Select((l, i) => (l, i)).Where(x => x.i > previous && !used.Contains(x.l.Id) && TextKey(x.l.Text) == TextKey(line.Text) && TextKey(line.Text).Length > 0).ToList();
            if (matches.Count > 1 && line.Start != null) matches = matches.Where(x => x.l.Start != null && Math.Abs(x.l.Start.Value - line.Start.Value) <= 5000000L).ToList();
            if (matches.Count != 1) continue; result[line.Id] = matches[0].l.Id; used.Add(matches[0].l.Id); previous = matches[0].i;
        }
        return result;
    }
    public static Dictionary<string, string> Mix(RichLyrics original, RichLyrics donor, MixInput input)
    {
        if (input.Mapping is null || input.Mapping.Any(pair => string.IsNullOrWhiteSpace(pair.Key) || string.IsNullOrWhiteSpace(pair.Value)))
            throw new ArgumentException("Choose valid original and donor line IDs.");
        var a = LyricRows.All(original).ToDictionary(l => l.Id); var b = LyricRows.All(donor).ToList(); var result = new Dictionary<string, string>(); int previous = -1; var used = new HashSet<string>();
        foreach (var line in LyricRows.All(original)) { if (!input.Mapping.TryGetValue(line.Id, out var id)) continue; var index = b.FindIndex(l => l.Id == id); if (index < 0 || index <= previous || !used.Add(id)) throw new ArgumentException("Choose unique donor lines in song order."); previous = index; var text = input.Kind == "pronunciation" ? b[index].Pronunciation : b[index].Translations.GetValueOrDefault(input.Language); if (text == null && input.Kind == "translation") { var compatible = b[index].Translations.Where(v => v.Key.Split('-')[0] == input.Language.Split('-')[0]).ToList(); if (compatible.Count == 1) text = compatible[0].Value; } if (string.IsNullOrWhiteSpace(text)) throw new ArgumentException("The donor line has no text for the selected language."); result[line.Id] = text; }
        if (input.Mapping.Keys.Any(id => !a.ContainsKey(id)) || result.Count == 0) throw new ArgumentException("Map at least one valid lyric line."); return result;
    }
}
