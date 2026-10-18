using Lyricify.Lyrics.Helpers;
using Lyricify.Lyrics.Models;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
namespace LyricBridge;

public static class Normalization
{
    public static RichLyrics Parse(RawLyrics raw, Candidate candidate) => Parse(raw, candidate, ParseHelper.ParseLyrics(raw.Original));
    public static RichLyrics Parse(RawLyrics raw, Candidate candidate, LyricsData? data)
    {
        if (raw.Instrumental || data.IsInstrumental()) return new RichLyrics { Source = candidate.Source, ProviderId = candidate.Id };
        var result = new RichLyrics { Source = candidate.Source, ProviderId = candidate.Id, Title = candidate.Title, Artist = candidate.Artist };
        if (data?.Lines is { Count: > 0 }) result.Lines = data.Lines.Select((l, i) => Line(l, $"l{i}")).ToList();
        else if (!string.IsNullOrWhiteSpace(raw.Original) && !raw.Original.TrimStart().StartsWith('{') && !raw.Original.TrimStart().StartsWith('<'))
            result.Lines = raw.Original.Split('\n').Where(s => !string.IsNullOrWhiteSpace(s) && !s.TrimStart().StartsWith('[')).Select((s, i) => new LyricLine { Id = $"l{i}", Text = s.Trim(), Language = Detect(s) }).ToList();
        AlignAuxiliary(result.Lines, raw.Translation, false); AlignAuxiliary(result.Lines, raw.Pronunciation, true);
        if (raw.AdditionalTranslations != null) foreach (var pair in raw.AdditionalTranslations) AlignAuxiliary(result.Lines, pair.Value, false, pair.Key);
        var metadataLanguage = raw.Language ?? data?.TrackMetadata?.Language?.FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(metadataLanguage)) foreach (var line in result.Lines) if (line.Language == "und" || (metadataLanguage == "ja" && line.Language == "zh")) line.Language = metadataLanguage;
        if (result.Lines.Any(l => l.Language == "ja")) foreach (var line in result.Lines) if (line.Language == "zh" && string.IsNullOrWhiteSpace(metadataLanguage)) line.Language = "ja";
        if (candidate.Source == "Kugou" && raw.Original.Contains("[language:"))
        {
            try
            {
                var pronunciation = Lyricify.Lyrics.Parsers.KrcTranslationParser.GetTranslationRawFromKrc(raw.Original)?.Content?.FirstOrDefault(c => c.Type == 0)?.LyricContent;
                if (pronunciation?.Count == result.Lines.Count) for (int i = 0; i < result.Lines.Count; i++) if (pronunciation[i]?.Count == result.Lines[i].Cues.Count) result.Lines[i].Pronunciation = string.Join(" ", pronunciation[i]!);
            }
            catch {/* Malformed auxiliary metadata cannot shift original lines. */}
        }
        result.Language = result.Lines.GroupBy(l => l.Language).OrderByDescending(g => g.Count()).Select(g => g.Key).FirstOrDefault() ?? "und";
        result.Hash = Codec.ContentHash(result); return result;
    }
    public static LyricLine Line(ILineInfo l, string id)
    {
        var line = new LyricLine { Id = id, Text = l.Text, Start = l.StartTime * 10000L, End = l.EndTime * 10000L, Language = Detect(l.Text), Alignment = l.LyricsAlignment.ToString() };
        if (l is SyllableLineInfo s) { int pos = 0; foreach (var w in s.Syllables) { line.Cues.Add(new Cue(pos, pos + w.Text.Length, w.StartTime * 10000L, w.EndTime * 10000L)); pos += w.Text.Length; } }
        if (l is IFullLineInfo f) { line.Translations = new(f.Translations); line.Pronunciation = f.Pronunciation; }
        if (l.SubLine != null) line.Background = Line(l.SubLine, id + "-bg"); return line;
    }
    public static string Detect(string text)
    {
        if (Regex.IsMatch(text, "[\\u3040-\\u30ff]")) return "ja";
        if (Regex.IsMatch(text, "[\\uac00-\\ud7af]")) return "ko";
        if (Regex.IsMatch(text, "[\\u4e00-\\u9fff]")) return "zh";
        if (Regex.IsMatch(text, "[\\u0600-\\u06ff]")) return "ar";
        if (Regex.IsMatch(text, "[\\u0400-\\u04ff]")) return "ru";
        return "und";
    }
    public static void AlignAuxiliary(List<LyricLine> lines, string? raw, bool pronunciation, string language = "zh")
    {
        if (string.IsNullOrWhiteSpace(raw)) return; var aux = ParseHelper.ParseLyrics(raw)?.Lines;
        if (aux is null) return;
        foreach (var l in lines)
        {
            if (l.Start == null) continue;
            var match = aux.Where(a => a.StartTime != null && Math.Abs(a.StartTime.Value * 10000L - l.Start.Value) <= 5000000L).OrderBy(a => Math.Abs(a.StartTime!.Value * 10000L - l.Start.Value)).ToList();
            if (match.Count == 0) continue;
            // Equal-distance alternatives are ambiguous; never shift subsequent lines to compensate.
            if (match.Count > 1 && Math.Abs(match[0].StartTime!.Value * 10000L - l.Start.Value) == Math.Abs(match[1].StartTime!.Value * 10000L - l.Start.Value)) continue;
            var nearest = match[0]; var competing = lines.Where(other => other.Start != null && Math.Abs(nearest.StartTime!.Value * 10000L - other.Start.Value) <= Math.Abs(nearest.StartTime!.Value * 10000L - l.Start.Value)).ToList();
            if (competing.Count != 1) continue;
            if (pronunciation) l.Pronunciation = nearest.Text; else l.Translations[language] = nearest.Text;
        }
    }
    public static string Timestamp(long ticks)
    { var time = TimeSpan.FromTicks(Math.Max(0, ticks)); return $"{(int)time.TotalMinutes:00}:{time.Seconds:00}.{time.Milliseconds:000}"; }
    public static string Export(RichLyrics data)
    {
        var sb = new StringBuilder(); foreach (var line in data.Lines)
        {
            if (line.Start == null) { sb.AppendLine(line.Text); continue; }
            sb.Append('[').Append(Timestamp(line.Start.Value)).Append(']');
            if (line.Cues.Count == 0) sb.Append(line.Text);
            else { int pos = 0; foreach (var cue in line.Cues) { if (cue.Position < pos || cue.EndPosition > line.Text.Length) continue; sb.Append(line.Text[pos..cue.Position]); sb.Append('<').Append(Timestamp(cue.Start)).Append('>').Append(line.Text[cue.Position..cue.EndPosition]); pos = cue.EndPosition; } sb.Append(line.Text[pos..]); if (line.Cues.LastOrDefault()?.End is long end) sb.Append('<').Append(Timestamp(end)).Append('>'); }
            sb.AppendLine();
        }
        return sb.ToString();
    }
    public static void ValidateGenerated(IEnumerable<string> expected, Dictionary<string, string> received)
        => LyricRows.ValidateGenerated(expected, received);
}
