using System.Text;
using System.Text.RegularExpressions;
using Lyricify.Lyrics.Models;
using Newtonsoft.Json.Linq;

namespace LyricBridge;

public static partial class LyricImport
{
    private static readonly Dictionary<string, LyricsRawTypes> FormatChoices = new(StringComparer.Ordinal)
    {
        ["auto"] = LyricsRawTypes.Unknown,
        ["txt"] = LyricsRawTypes.Unknown,
        ["lrc"] = LyricsRawTypes.Lrc,
        ["elrc"] = LyricsRawTypes.Lrc,
        ["qrc"] = LyricsRawTypes.Qrc,
        ["krc"] = LyricsRawTypes.Krc,
        ["yrc"] = LyricsRawTypes.Yrc,
        ["ttml"] = LyricsRawTypes.Ttml,
        ["lyl"] = LyricsRawTypes.LyricifyLines,
        ["lys"] = LyricsRawTypes.LyricifySyllable
    };
    private sealed class ImportChecks
    {
        private readonly List<ImportIssue> errors = [];
        private readonly Dictionary<LyricLine, string> locations = [];
        private int errorCount;
        private readonly HashSet<ImportIssue> warningSet = [];
        public List<ImportIssue> Warnings { get; } = [];
        public Dictionary<LyricLine, List<bool>> WordSlots { get; } = [];
        public void Register(LyricLine line, string location) => locations[line] = location;
        public string Location(LyricLine line) => locations.GetValueOrDefault(line, "Lyric " + line.Id);
        public void Warn(string code, string message, string? location = null)
        {
            var warning = new ImportIssue(code, message, location);
            if (warningSet.Add(warning)) Warnings.Add(warning);
        }
        public void AddError(string code, string message, string location)
        {
            errorCount++;
            if (errors.Count < 20) errors.Add(new(code, message, location));
        }
        public void ThrowIfErrors()
        {
            if (errorCount == 0) return;
            var first = errors[0];
            var message = first.Message.StartsWith("Line ", StringComparison.Ordinal) || first.Message.StartsWith("TTML line ", StringComparison.Ordinal)
                ? first.Location + ": " + first.Message[(first.Message.IndexOf(':') + 1)..].Trim()
                : first.Location + ": " + first.Message;
            if (errorCount > 1) message += $" ({errorCount} issues in total.)";
            throw new WorkflowException(422, first.Code, message) { Issues = errors, IssueCount = errorCount };
        }
    }
    private static string? JsonLyric(Newtonsoft.Json.Linq.JObject json, string key) => (json.GetValue(key, StringComparison.OrdinalIgnoreCase) as Newtonsoft.Json.Linq.JObject)?.GetValue("lyric", StringComparison.OrdinalIgnoreCase)?.Value<string>();
    private static RichLyrics NewDocument(Candidate candidate) => new() { Source = candidate.Source, ProviderId = candidate.Id, Title = candidate.Title, Artist = candidate.Artist };
    private static Parsed PlainText(string text, Candidate candidate)
    {
        var document = NewDocument(candidate);
        document.Lines = text.Split('\n').Where(l => !string.IsNullOrWhiteSpace(l)).Select((l, i) => new LyricLine { Id = $"l{i}", Text = l, Language = Normalization.Detect(l) }).ToList();
        return new(document, new(text), "TXT");
    }
    private static long OffsetTicks(long milliseconds, int offset, int row)
    {
        var effective = milliseconds - offset;
        if (effective < int.MinValue || effective > int.MaxValue) Fail(row, "effective timing exceeds the supported range after applying offset");
        return checked(effective * 10000L);
    }
    private static RichLyrics ParseNative(string text, LyricsRawTypes type, Candidate candidate, ImportChecks checks, string prefix, CancellationToken token)
    {
        var document = NewDocument(candidate);
        var rows = text.Split('\n');
        var syllableFlags = new Dictionary<LyricLine, int>();
        int offset = 0; bool offsetSeen = false; int metadataRow = 0;
        foreach (var raw in rows)
        {
            metadataRow++;
            var meta = Metadata.Match(raw.Trim());
            if (!meta.Success) continue;
            if (type != LyricsRawTypes.Krc && meta.Groups["name"].Value is "lang" or "language" && PreferenceService.LanguageTag(meta.Groups["value"].Value)) document.Language = meta.Groups["value"].Value;
            if (!meta.Groups["name"].Value.Equals("offset", StringComparison.OrdinalIgnoreCase)) continue;
            var next = int.Parse(meta.Groups["value"].Value, System.Globalization.CultureInfo.InvariantCulture);
            if (offsetSeen && next != offset) checks.AddError("invalid_import_format", "Conflicting offset metadata; choose one global offset.", prefix + "Line " + metadataRow);
            offset = next; offsetSeen = true;
        }
        checks.ThrowIfErrors();
        for (int number = 1; number <= rows.Length; number++)
        {
            token.ThrowIfCancellationRequested();
            var raw = rows[number - 1].Trim();
            if (raw.Length == 0 || Metadata.IsMatch(raw) || type == LyricsRawTypes.Yrc && raw.StartsWith('{')) continue;
            try
            {
                if (type == LyricsRawTypes.Lrc)
                {
                    var head = LrcHead.Match(raw);
                    var tags = Pattern(@"\[([^\]]+)\]").Matches(head.Groups["tags"].Value);
                    var body = head.Groups["text"].Value;
                    var markers = Pattern(@"<(\d+:[^>]+)>").Matches(body);
                    foreach (Match tag in tags)
                    {
                        var startMs = ClockMs(tag.Groups[1].Value, number);
                        var shift = (long)startMs - ClockMs(tags[0].Groups[1].Value, number);
                        var line = new LyricLine { Start = OffsetTicks(startMs, offset, number) };
                        var plain = new StringBuilder(); int position = 0;
                        for (int index = 0; index < markers.Count; index++)
                        {
                            var marker = markers[index];
                            plain.Append(body.AsSpan(position, marker.Index - position));
                            var wordStart = OffsetTicks(ClockMs(marker.Groups[1].Value, number) + shift, offset, number);
                            var textStart = marker.Index + marker.Length;
                            var textEnd = index + 1 < markers.Count ? markers[index + 1].Index : body.Length;
                            var wordText = body[textStart..textEnd];
                            if (wordText.Length > 0)
                            {
                                long? end = index + 1 < markers.Count ? OffsetTicks(ClockMs(markers[index + 1].Groups[1].Value, number) + shift, offset, number) : null;
                                if (end < wordStart && index + 1 < markers.Count)
                                {
                                    var nextTextStart = markers[index + 1].Index + markers[index + 1].Length;
                                    var nextTextEnd = index + 2 < markers.Count ? markers[index + 2].Index : body.Length;
                                    if (!string.IsNullOrWhiteSpace(body[nextTextStart..nextTextEnd]))
                                    {
                                        end = null;
                                        checks.Warn("unresolved_timing", "Overlapping enhanced-LRC starts have no explicit word duration; the word end remains open.", prefix + "Line " + number);
                                    }
                                }
                                line.Cues.Add(new(plain.Length, plain.Length + wordText.Length, wordStart, end));
                            }
                            else line.End = Math.Max(line.End ?? wordStart, wordStart);
                            position = textStart;
                        }
                        plain.Append(body.AsSpan(position));
                        line.Text = plain.ToString();
                        Add(line, number);
                    }
                    continue;
                }
                var header = type == LyricsRawTypes.LyricifySyllable ? SyllableHead.Match(raw) : MillisecondHead.Match(raw);
                var rowText = header.Groups["text"].Value;
                var result = new LyricLine();
                long lineStart = type == LyricsRawTypes.LyricifySyllable ? 0 : Integer(header.Groups["start"].Value, number);
                if (type != LyricsRawTypes.LyricifySyllable)
                {
                    result.Start = OffsetTicks(lineStart, offset, number);
                    var second = Integer(header.Groups["second"].Value, number);
                    result.End = OffsetTicks(type == LyricsRawTypes.LyricifyLines ? second : lineStart + second, offset, number);
                }
                if (type == LyricsRawTypes.LyricifyLines) result.Text = rowText;
                else
                {
                    var pattern = type == LyricsRawTypes.Krc ? KrcWord : type == LyricsRawTypes.Yrc ? YrcWord : QrcWord;
                    var markers = pattern.Matches(rowText);
                    var slots = new List<bool>();
                    if (type == LyricsRawTypes.Krc) checks.WordSlots[result] = slots;
                    var plain = new StringBuilder(); int position = 0;
                    for (int index = 0; index < markers.Count; index++)
                    {
                        var marker = markers[index];
                        var before = type is LyricsRawTypes.Qrc or LyricsRawTypes.LyricifySyllable;
                        var wordText = before ? rowText[position..marker.Index] : rowText[(marker.Index + marker.Length)..(index + 1 < markers.Count ? markers[index + 1].Index : rowText.Length)];
                        var startMs = (long)Integer(marker.Groups["start"].Value, number) + (type == LyricsRawTypes.Krc ? lineStart : 0);
                        var start = OffsetTicks(startMs, offset, number);
                        var end = OffsetTicks(startMs + Integer(marker.Groups["duration"].Value, number), offset, number);
                        slots.Add(wordText.Length > 0);
                        if (wordText.Length > 0) result.Cues.Add(new(plain.Length, plain.Length + wordText.Length, start, end));
                        else
                        {
                            if (result.End.HasValue && end > result.End) checks.Warn("line_bounds_expanded", "Line boundaries expanded to preserve an explicit empty timing marker.", prefix + "Line " + number);
                            result.End = Math.Max(result.End ?? end, end);
                        }
                        plain.Append(wordText); position = marker.Index + marker.Length;
                    }
                    result.Text = plain.ToString();
                }
                if (type == LyricsRawTypes.LyricifySyllable)
                {
                    var flags = Integer(raw[1..raw.IndexOf(']')], number);
                    syllableFlags[result] = flags;
                    result.Alignment = (flags % 3) switch { 1 => "Left", 2 => "Right", _ => "Unspecified" };
                    if (flags >= 6)
                    {
                        if (document.Lines.Count == 0 || document.Lines[^1].Background != null) Fail(number, "background vocal has no unique original line");
                        Add(result, number, background: true); continue;
                    }
                }
                Add(result, number);
            }
            catch (WorkflowException error) { checks.AddError(error.Code, error.Message, prefix + "Line " + number); }
        }
        if (type == LyricsRawTypes.LyricifySyllable)
            for (int index = 1; index < document.Lines.Count; index++)
            {
                var line = document.Lines[index];
                if (syllableFlags[line] >= 3 || !Bracketed(line) || document.Lines[index - 1].Background != null) continue;
                var previous = document.Lines[index - 1];
                var previousIsMain = syllableFlags[previous] >= 3 || !Bracketed(previous);
                var nextIsMain = index + 1 == document.Lines.Count || syllableFlags[document.Lines[index + 1]] >= 3 || !Bracketed(document.Lines[index + 1]);
                if (previousIsMain && nextIsMain) { previous.Background = line; document.Lines.RemoveAt(index--); }
            }
        checks.ThrowIfErrors();
        return document;
        static bool Bracketed(LyricLine line) => (line.Text.StartsWith('(') && line.Text.EndsWith(')')) || (line.Text.StartsWith('（') && line.Text.EndsWith('）'));
        void Add(LyricLine line, int row, bool background = false)
        {
            line.Id = "l" + row + (background ? "-bg" : "-" + document.Lines.Count);
            line.Language = Normalization.Detect(line.Text);
            checks.Register(line, prefix + "Line " + row);
            if (background) document.Lines[^1].Background = line; else document.Lines.Add(line);
        }
    }
    private static void AlignImportedAuxiliary(RichLyrics original, RichLyrics auxiliary, bool pronunciation, ImportChecks checks)
    {
        var used = new HashSet<LyricLine>();
        foreach (var row in auxiliary.Lines.Where(l => !string.IsNullOrWhiteSpace(l.Text)))
        {
            var matches = original.Lines.Where(l => l.Start.HasValue && row.Start.HasValue && Math.Abs(l.Start.Value - row.Start.Value) <= 5000000L).OrderBy(l => Math.Abs(l.Start!.Value - row.Start!.Value)).ToList();
            if (matches.Count == 0 || matches.Count > 1 && Math.Abs(matches[0].Start!.Value - row.Start!.Value) == Math.Abs(matches[1].Start!.Value - row.Start!.Value) || !used.Add(matches[0]))
            {
                checks.AddError("invalid_import_format", "Supplied auxiliary row has no unique matching original.", checks.Location(row)); continue;
            }
            if (pronunciation) matches[0].Pronunciation = row.Text; else matches[0].Translations["zh"] = row.Text;
        }
    }
    private static RichLyrics ParseRichsync(Newtonsoft.Json.Linq.JArray rows, Candidate candidate, ImportChecks checks, string path, CancellationToken token)
    {
        var document = NewDocument(candidate);
        for (int index = 0; index < rows.Count; index++)
        {
            token.ThrowIfCancellationRequested();
            var location = path + "[" + index + "]";
            try
            {
                var row = rows[index];
                if (row["ts"]?.Type is not (JTokenType.Integer or JTokenType.Float) || row["te"]?.Type is not (JTokenType.Integer or JTokenType.Float) || row["l"] is not JArray words || words.Any(w => w["c"]?.Type != JTokenType.String || w["o"]?.Type is not (JTokenType.Integer or JTokenType.Float)))
                    throw Error("invalid_import_format", "Malformed richsync line/word fields.");
                var start = row["ts"]!.Value<double>(); var end = row["te"]!.Value<double>();
                if (!double.IsFinite(start) || !double.IsFinite(end) || start < 0 || end < start || end * 1000 > int.MaxValue) throw Error("invalid_import_format", "Invalid richsync line times.");
                var line = new LyricLine { Id = "l" + index, Start = Ticks(start), End = Ticks(end) };
                var text = new StringBuilder();
                for (int word = 0; word < words.Count; word++)
                {
                    var offset = words[word]["o"]!.Value<double>();
                    if (!double.IsFinite(offset) || start + offset < 0 || (start + offset) * 1000 > int.MaxValue) throw Error("invalid_import_format", "Invalid richsync word start.");
                    var wordStart = Ticks(start + offset);
                    long? wordEnd = word + 1 < words.Count ? Ticks(start + words[word + 1]["o"]!.Value<double>()) : line.End;
                    if (wordEnd < wordStart)
                    {
                        wordEnd = null;
                        checks.Warn("unresolved_timing", "Overlapping richsync starts have no explicit word duration; the word end remains open.", location + ".l[" + word + "]");
                    }
                    var value = words[word]["c"]!.Value<string>()!;
                    if (value.Length > 0) line.Cues.Add(new(text.Length, text.Length + value.Length, wordStart, wordEnd));
                    else line.End = Math.Max(line.End!.Value, wordStart);
                    text.Append(value);
                }
                line.Text = text.ToString(); line.Language = Normalization.Detect(line.Text);
                if (row["x"]?.Type == JTokenType.String && row["x"]!.Value<string>() != line.Text) throw Error("invalid_import_format", "Richsync word entries do not preserve the supplied full line text.");
                document.Lines.Add(line); checks.Register(line, location);
            }
            catch (WorkflowException error) { checks.AddError(error.Code, error.Message, location); }
            catch (Exception error) when (error is ArgumentException or InvalidOperationException or OverflowException) { checks.AddError("invalid_import_format", "Malformed richsync lyric fields.", location); }
        }
        checks.ThrowIfErrors();
        return document;
        static long Ticks(double seconds)
        {
            if (!double.IsFinite(seconds) || seconds < 0 || seconds * 1000 > int.MaxValue) throw Error("invalid_import_format", "Richsync timing exceeds the supported range.");
            return checked((long)Math.Round(seconds * 10000000d, MidpointRounding.AwayFromZero));
        }
    }
}
