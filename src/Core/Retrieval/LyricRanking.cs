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
    private static (int Order, string? Reason) Quality(Candidate a, Candidate b)
    {
        var x = a.Assessment; var y = b.Assessment;
        int order = (y?.Eligible == true).CompareTo(x?.Eligible == true); if (order != 0) return (order, "recording-match");
        order = (y?.Tier ?? 0).CompareTo(x?.Tier ?? 0); if (order != 0) return (order, "recording-match");
        order = (y?.Timing?.Rank ?? -1).CompareTo(x?.Timing?.Rank ?? -1); if (order != 0) return (order, "timing");
        order = (y?.Timing?.Coverage ?? 0).CompareTo(x?.Timing?.Coverage ?? 0); if (order != 0) return (order, "timing-coverage");
        order = (y?.Score ?? b.Score).CompareTo(x?.Score ?? a.Score); if (order != 0) return (order, "match-score");
        order = (y?.Auxiliary?.Completeness ?? 0).CompareTo(x?.Auxiliary?.Completeness ?? 0); if (order != 0) return (order, "auxiliary-completeness");
        return (0, null);
    }
    public static int CompareQuality(Candidate a, Candidate b) => Quality(a, b).Order;
    public static int Compare(Candidate a, Candidate b)
    {
        var order = CompareQuality(a, b); if (order != 0) return order;
        order = (a.Assessment?.ProviderOrder ?? 0).CompareTo(b.Assessment?.ProviderOrder ?? 0);
        return order != 0 ? order : StringComparer.Ordinal.Compare(Key(a), Key(b));
    }
    public static string? Improvement(Candidate candidate, Candidate baseline)
    {
        if (candidate.Verification != "verified" || candidate.Assessment?.Eligible != true || baseline.Assessment == null) return null;
        var comparison = Quality(candidate, baseline);
        return comparison.Order < 0 ? comparison.Reason : null;
    }
    public static string ImprovementDescription(Candidate candidate, Candidate baseline, string reason)
    {
        var a = candidate.Assessment!; var b = baseline.Assessment!;
        static string Percent(double value) => value.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture) + "%";
        return reason switch
        {
            "recording-match" => $"Recording match: {(b.Eligible ? "eligible" : "ineligible")} tier {b.Tier} → eligible tier {a.Tier}.",
            "timing" => $"Timing: {b.Timing?.Category ?? "unverified"} → {a.Timing?.Category ?? "unverified"}.",
            "timing-coverage" => $"Word-timing coverage: {Percent(b.Timing?.Coverage ?? 0)} → {Percent(a.Timing?.Coverage ?? 0)}.",
            "match-score" => $"Match score: {b.Score} → {a.Score}.",
            "auxiliary-completeness" => $"Translation: {Percent(b.Auxiliary?.TranslationCoverage ?? 0)} → {Percent(a.Auxiliary?.TranslationCoverage ?? 0)}; pronunciation: {Percent(b.Auxiliary?.PronunciationCoverage ?? 0)} → {Percent(a.Auxiliary?.PronunciationCoverage ?? 0)}.",
            _ => throw new ArgumentException("Unknown improvement reason.", nameof(reason))
        };
    }
}
