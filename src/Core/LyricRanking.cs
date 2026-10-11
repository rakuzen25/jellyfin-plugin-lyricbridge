namespace LyricBridge;

public static class LyricRanking
{
    public static string Key(Candidate c) => c.Source + ":" + c.Id;
    public static TimingAssessment Timing(RichLyrics lyrics) => Analyze(lyrics).Timing;
    public static MatchAssessment WithDocument(MatchAssessment assessment, RichLyrics lyrics)
    { var analysis = Analyze(lyrics); return assessment with { Timing = analysis.Timing, Auxiliary = analysis.Auxiliary, Revision = 2 }; }
    public static (TimingAssessment Timing, AuxiliaryAssessment Auxiliary) Analyze(RichLyrics lyrics)
    {
        int sung = 0, word = 0, invalid = 0, lined = 0, translated = 0, pronounced = 0; long previousLine = -1;

        foreach (var line in lyrics.Lines)
        {
            if (string.IsNullOrWhiteSpace(line.Text)) continue; sung++; if (line.Translations.Values.Any(v => !string.IsNullOrWhiteSpace(v))) translated++; if (!string.IsNullOrWhiteSpace(line.Pronunciation)) pronounced++; if (line.Start is >= 0 && line.Start >= previousLine) { lined++; previousLine = line.Start.Value; } else if (line.Start != null) { invalid++; continue; }
            var boundaries = new HashSet<int>(System.Globalization.StringInfo.ParseCombiningCharacters(line.Text)) { line.Text.Length };
            int lastPosition = -1; long lastStart = -1, lastEnd = -1; int valid = 0; bool internalBoundary = false, distinct = false;
            foreach (var cue in line.Cues)
            {
                if (cue.Position < lastPosition || cue.Start < lastStart || cue.Start < lastEnd || cue.Start < 0 || (line.Start != null && cue.Start < line.Start) || (line.End > line.Start && cue.End > line.End) || cue.End <= cue.Start || cue.Position >= cue.EndPosition || !boundaries.Contains(cue.Position) || !boundaries.Contains(cue.EndPosition)) { invalid++; continue; }
                if (valid > 0 && cue.Start > lastStart) distinct = true; internalBoundary |= cue.Position > 0 || cue.EndPosition < line.Text.Length; lastPosition = cue.EndPosition; lastStart = cue.Start; lastEnd = cue.End ?? cue.Start; valid++;
            }
            if (valid >= 2 && internalBoundary && distinct) word++;
        }
        var coverage = sung == 0 ? 0 : 100d * word / sung; var rank = word > 0 ? (coverage >= 80 ? 3 : 2) : lined > 0 ? 1 : 0; return (new(rank switch { 3 => "mostly-word-timed", 2 => "partially-word-timed", 1 => "line-timed", _ => "plain" }, rank, coverage, sung, word, invalid), new(sung == 0 ? 0 : 100d * translated / sung, sung == 0 ? 0 : 100d * pronounced / sung));
    }
    public static int Compare(Candidate a, Candidate b)
    {
        var x = a.Assessment!; var y = b.Assessment!; int v = y.Eligible.CompareTo(x.Eligible); if (v != 0) return v; v = y.Tier.CompareTo(x.Tier); if (v != 0) return v; v = (y.Timing?.Rank ?? -1).CompareTo(x.Timing?.Rank ?? -1); if (v != 0) return v; v = (y.Timing?.Coverage ?? 0).CompareTo(x.Timing?.Coverage ?? 0); if (v != 0) return v; v = y.Score.CompareTo(x.Score); if (v != 0) return v; v = (y.Auxiliary?.Completeness ?? 0).CompareTo(x.Auxiliary?.Completeness ?? 0); if (v != 0) return v; v = x.ProviderOrder.CompareTo(y.ProviderOrder); return v != 0 ? v : StringComparer.Ordinal.Compare(Key(a), Key(b));
    }
    public static string? Improvement(Candidate candidate, Candidate baseline)
    { var a = candidate.Assessment; var b = baseline.Assessment; if (a?.Eligible != true || b == null) return null; if (!b.Eligible || a.Tier > b.Tier) return "recording-match"; if (a.Tier == b.Tier && (a.Timing?.Rank ?? -1) > (b.Timing?.Rank ?? -1)) return "timing"; return null; }
    public static string ImprovementDescription(Candidate candidate, Candidate baseline, string reason)
    {
        static string Tier(int tier) => tier == 2 ? "Strong" : tier == 1 ? "Possible" : "Low";
        static string TimingName(TimingAssessment? timing) => timing?.Category.Replace('-', ' ') ?? "unverified timing";
        return reason == "recording-match" ? Tier(candidate.Assessment!.Tier) + " metadata match improves on the current " + Tier(baseline.Assessment!.Tier) + " match." : TimingName(candidate.Assessment!.Timing) + " improves on the current " + TimingName(baseline.Assessment!.Timing) + " within the same match tier.";
    }
}
