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
        // Normalize each donor once; long imports should not repeat Unicode work
        // for every original/donor pair. Preserve source order and ambiguity.
        var donorRows = LyricRows.All(donor)
            .Select((line, index) => (Line: line, Index: index))
            .ToLookup(row => TextKey(row.Line.Text));
        var result = new Dictionary<string, string>();
        var used = new HashSet<string>();
        var previous = -1;

        foreach (var line in LyricRows.All(original))
        {
            var key = TextKey(line.Text);
            if (key.Length == 0) continue;
            var matches = donorRows[key]
                .Where(row => row.Index > previous && !used.Contains(row.Line.Id))
                .ToList();
            if (matches.Count > 1 && line.Start is long start)
                matches = matches.Where(row => row.Line.Start is long donorStart && Math.Abs(donorStart - start) <= 5000000L).ToList();
            if (matches.Count != 1) continue;

            var match = matches[0];
            result[line.Id] = match.Line.Id;
            used.Add(match.Line.Id);
            previous = match.Index;
        }
        return result;
    }

    public static Dictionary<string, string> Mix(RichLyrics original, RichLyrics donor, MixInput input)
    {
        if (input.Mapping is null || input.Mapping.Any(pair => string.IsNullOrWhiteSpace(pair.Key) || string.IsNullOrWhiteSpace(pair.Value)))
            throw new ArgumentException("Choose valid original and donor line IDs.");

        var sourceRows = LyricRows.All(original).ToList();
        var originalRows = sourceRows.ToDictionary(line => line.Id);
        var donorRows = LyricRows.All(donor).ToList();
        var donorIndexes = new Dictionary<string, int>();
        for (var index = 0; index < donorRows.Count; index++)
            donorIndexes.TryAdd(donorRows[index].Id, index);
        var result = new Dictionary<string, string>();
        var used = new HashSet<string>();
        var previous = -1;
        string? languageFamily = null;

        foreach (var line in sourceRows)
        {
            if (!input.Mapping.TryGetValue(line.Id, out var id)) continue;
            if (!donorIndexes.TryGetValue(id, out var index) || index <= previous || !used.Add(id))
                throw new ArgumentException("Choose unique donor lines in song order.");
            previous = index;

            var donorLine = donorRows[index];
            var text = input.Kind == "pronunciation" ? donorLine.Pronunciation : donorLine.Translations.GetValueOrDefault(input.Language);
            if (text is null && input.Kind == "translation")
            {
                languageFamily ??= input.Language.Split('-')[0];
                var compatible = donorLine.Translations.Where(pair => pair.Key.Split('-')[0] == languageFamily).ToList();
                if (compatible.Count == 1) text = compatible[0].Value;
            }
            if (string.IsNullOrWhiteSpace(text))
                throw new ArgumentException("The donor line has no text for the selected language.");
            result[line.Id] = text;
        }
        if (input.Mapping.Keys.Any(id => !originalRows.ContainsKey(id)) || result.Count == 0)
            throw new ArgumentException("Map at least one valid lyric line.");
        return result;
    }
}
