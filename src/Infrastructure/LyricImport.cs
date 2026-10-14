using System.Collections.Concurrent;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using Lyricify.Lyrics.Helpers;
using Lyricify.Lyrics.Models;
using Newtonsoft.Json.Linq;

namespace LyricBridge;

/// <summary>Upload-only decoding and validation. Provider normalization remains permissive.</summary>
public static partial class LyricImport
{
    public const int MaxBytes = 1_000_000;
    private static readonly UTF8Encoding Utf8 = new(false, true);
    private static readonly HashSet<string> StructuredExtensions = new(StringComparer.OrdinalIgnoreCase) { ".lrc", ".elrc", ".qrc", ".krc", ".yrc", ".ttml", ".xml", ".json", ".lys", ".lyl" };
    private static readonly ConcurrentDictionary<string, Regex> Patterns = new();
    private static readonly JsonLoadSettings StrictJson = new() { DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error };
    private static Regex Pattern(string pattern) => Patterns.GetOrAdd(pattern, value => new(value, RegexOptions.CultureInvariant | RegexOptions.NonBacktracking, TimeSpan.FromSeconds(1)));
    private static readonly Regex Metadata = Pattern(@"^\[(?<name>[A-Za-z][\w-]*):(?<value>[^\]]*)\]$");
    private static readonly Regex Clock = Pattern(@"^(?<m>\d+):(?<s>\d{1,2})(?:[.:](?<f>\d{1,3}))?$");
    private static readonly Regex LrcHead = Pattern(@"^(?<tags>(?:\[\d+:[^\]]*\])+)(?<text>.*)$");
    private static readonly Regex MillisecondHead = Pattern(@"^\[(?<start>\d+),(?<second>\d+)\](?<text>.*)$");
    private static readonly Regex SyllableHead = Pattern(@"^\[\d+\](?<text>.*)$");
    private static readonly Regex QrcWord = Pattern(@"\((?<start>-?\d+),(?<duration>\d+)\)");
    private static readonly Regex YrcWord = Pattern(@"\((?<start>-?\d+),(?<duration>\d+),\d+\)");
    private static readonly Regex KrcWord = Pattern(@"<(?<start>-?\d+),(?<duration>\d+),\d+>");

    public static ImportedLyrics Parse(ImportLyricsInput input, Candidate candidate, CancellationToken token = default)
    {
        token.ThrowIfCancellationRequested();
        if (input.ExistingLocal) throw Error("invalid_import", "Use Jellyfin lyrics through the existing-local action.");
        if (input.FileBytes != null && input.Text != null) throw Error("invalid_import", "Supply file bytes or text, not both.");
        var choice = input.Format?.ToLowerInvariant() ?? "";
        if (!FormatChoices.ContainsKey(choice)) throw Error("invalid_import_format", "Choose a supported lyric format.");
        var checks = new ImportChecks();
        byte[] bytes;
        try
        {
            if (input.FileBytes != null)
            {
                if (input.FileBytes.Length > (MaxBytes + 2) / 3 * 4) throw Error("import_too_large", "Choose a lyric file up to 1 MB.");
                bytes = Convert.FromBase64String(input.FileBytes);
            }
            else
            {
                if (input.Text == null || Utf8.GetByteCount(input.Text) > MaxBytes) throw Error("invalid_import", "Choose a lyric file up to 1 MB.");
                bytes = Utf8.GetBytes(input.Text);
            }
        }
        catch (FormatException) { throw Error("invalid_import", "The uploaded file bytes are not valid Base64."); }
        catch (EncoderFallbackException) { throw Error("invalid_import_encoding", "The text contains invalid Unicode characters."); }
        if (bytes.Length == 0) throw Error("empty_import", "This file contains no sung lyric lines.");
        if (bytes.Length > MaxBytes) throw Error("import_too_large", "Choose a lyric file up to 1 MB.");
        var fileName = Path.GetFileName((input.FileName ?? "lyrics.txt").Replace('\\', '/'));
        if (fileName.Length > 255) throw Error("invalid_import", "The lyric filename is too long.");
        var encoding = "UTF-8";
        string text;
        try
        {
            if (bytes.AsSpan().StartsWith("krc1"u8))
                text = Lyricify.Lyrics.Decrypter.Krc.Decrypter.DecryptLyrics(bytes, MaxBytes);
            else if (bytes.AsSpan().StartsWith(QrcDesktopContainer.Header))
                text = Lyricify.Lyrics.Decrypter.Qrc.Decrypter.DecryptLyrics(QrcDesktopContainer.Unwrap(bytes), MaxBytes);
            else
            {
                try { text = DecodeText(bytes, input.Encoding, out encoding); }
                catch (DecoderFallbackException)
                {
                    if (bytes.Length % 8 != 0) throw;
                    try { text = Lyricify.Lyrics.Decrypter.Qrc.Decrypter.DecryptLyrics(bytes, MaxBytes); encoding = "UTF-8"; }
                    catch (Exception ex) when (!Path.GetExtension(fileName).Equals(".qrc", StringComparison.OrdinalIgnoreCase) && ex is InvalidDataException or ICSharpCode.SharpZipLib.SharpZipBaseException) { throw new DecoderFallbackException("The file is not valid in the selected encoding.", ex); }
                }
                var compact = text.Trim();
                if (compact.Length >= 16 && compact.Length % 16 == 0 && compact.All(Uri.IsHexDigit))
                {
                    try { text = Lyricify.Lyrics.Decrypter.Qrc.Decrypter.DecryptLyrics(Convert.FromHexString(compact), MaxBytes); encoding = "UTF-8"; }
                    catch (Exception ex) when ((choice == "txt" || !StructuredExtensions.Contains(Path.GetExtension(fileName))) && ex is InvalidDataException or ICSharpCode.SharpZipLib.SharpZipBaseException or DecoderFallbackException) { /* A plain TXT lyric can consist of hexadecimal characters. */ }
                }
                else if (TryKrcBase64(compact, out var container))
                { text = Lyricify.Lyrics.Decrypter.Krc.Decrypter.DecryptLyrics(container, MaxBytes); encoding = "UTF-8"; }
            }
        }
        catch (WorkflowException) { throw; }
        catch (DecoderFallbackException) { throw Error("invalid_import_encoding", "This file is not valid in the selected encoding. Choose its text encoding or a supported lyric file."); }
        catch (Exception ex) when (ex is InvalidDataException or FormatException or ArgumentException or ICSharpCode.SharpZipLib.SharpZipBaseException)
        { throw Error("invalid_import_container", "The encrypted lyric file is corrupt, unsupported, or exceeds the 1 MB decoded limit."); }
        text = text.TrimStart('\uFEFF').Replace("\r\n", "\n").Replace('\r', '\n');
        if (Utf8.GetByteCount(text) > MaxBytes) throw Error("import_too_large", "Decoded lyric text must be up to 1 MB.");
        if (text.StartsWith("%PDF-", StringComparison.Ordinal) || text.StartsWith("%!PS", StringComparison.Ordinal)) throw Error("invalid_import_container", "This is a document file, not a supported lyric file.");
        if (text.Any(c => char.IsControl(c) && c is not '\n' and not '\t')) throw Error("invalid_import_encoding", "This file contains binary or invalid text characters.");
        try
        {
            var parsed = ParseText(text, fileName, candidate, token, checks, choice);
            ValidateDocument(parsed.Lyrics, checks, token);
            checks.ThrowIfErrors();
            parsed.Lyrics.Lines = parsed.Lyrics.Lines.OrderBy(l => l.Start ?? long.MaxValue).ToList();
            for (int i = 0; i < parsed.Lyrics.Lines.Count; i++)
            { parsed.Lyrics.Lines[i].Id = "l" + i; if (parsed.Lyrics.Lines[i].Background is { } bg) bg.Id = "l" + i + "-bg"; }
            if (parsed.Lyrics.Language == "ja" || parsed.Lyrics.Lines.Any(l => l.Language == "ja"))
                foreach (var line in LyricRows.All(parsed.Lyrics)) if (line.Language == "zh") line.Language = "ja";
            foreach (var line in LyricRows.All(parsed.Lyrics)) if (line.Language == "und" && parsed.Lyrics.Language != "und") line.Language = parsed.Lyrics.Language;
            parsed.Lyrics.Language = parsed.Lyrics.Lines.GroupBy(l => l.Language).OrderByDescending(g => g.Count()).Select(g => g.Key).FirstOrDefault() ?? "und";
            parsed.Lyrics.Hash = Codec.ContentHash(parsed.Lyrics);
            parsed.Lyrics.Manual = true;
            var provenance = Codec.Serialize(new { fileName, fileBytes = Convert.ToBase64String(bytes), encoding, format = parsed.Format, formatChoice = choice });
            var raw = parsed.Raw with { RawResponse = provenance };
            var lines = LyricRows.All(parsed.Lyrics).Where(l => !string.IsNullOrWhiteSpace(l.Text)).ToList();
            return new(parsed.Lyrics, raw, fileName, parsed.Format, encoding, lines.Any(l => l.Cues.Count > 0) ? "word" : lines.Any(l => l.Start != null) ? "line" : "plain", lines.Count, checks.Warnings);
        }
        catch (WorkflowException error) when (error.Issues == null)
        { throw new WorkflowException(error.Status, error.Code, error.Message, error.Retryable) { Issues = [new(error.Code, error.Message, fileName)], IssueCount = 1 }; }
        catch (WorkflowException) { throw; }
        catch (XmlException error)
        { throw new WorkflowException(422, "invalid_import_format", $"XML line {error.LineNumber}: malformed XML.") { Issues = [new("invalid_import_format", "Malformed XML.", $"XML line {error.LineNumber}")], IssueCount = 1 }; }
        catch (Newtonsoft.Json.JsonReaderException error)
        { throw new WorkflowException(422, "invalid_import_format", $"JSON line {error.LineNumber}: malformed JSON at {error.Path}.") { Issues = [new("invalid_import_format", "Malformed JSON.", error.Path)], IssueCount = 1 }; }
        catch (Exception ex) when (ex is FormatException or OverflowException or ArgumentException or XmlException or Newtonsoft.Json.JsonException or RegexMatchTimeoutException or IndexOutOfRangeException or InvalidDataException or InvalidOperationException or NullReferenceException or ICSharpCode.SharpZipLib.SharpZipBaseException)
        { throw Error("invalid_import_format", "This file has malformed lyric syntax or invalid timing values."); }
    }

    private static bool TryKrcBase64(string text, out byte[] bytes)
    {
        bytes = [];
        if (!text.StartsWith("a3Jj", StringComparison.Ordinal)) return false;
        try { bytes = Convert.FromBase64String(text); return bytes.AsSpan().StartsWith("krc1"u8); }
        catch (FormatException) { return false; }
    }
    private static string DecodeText(byte[] bytes, string choice, out string name)
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        Encoding encoding;
        int skip = 0;
        if (choice == "auto")
        {
            if (bytes.AsSpan().StartsWith(new byte[] { 0xff, 0xfe, 0x00, 0x00 })) { encoding = new UTF32Encoding(false, true, true); skip = 4; }
            else if (bytes.AsSpan().StartsWith(new byte[] { 0x00, 0x00, 0xfe, 0xff })) { encoding = new UTF32Encoding(true, true, true); skip = 4; }
            else if (bytes.AsSpan().StartsWith(new byte[] { 0xff, 0xfe })) { encoding = new UnicodeEncoding(false, true, true); skip = 2; }
            else if (bytes.AsSpan().StartsWith(new byte[] { 0xfe, 0xff })) { encoding = new UnicodeEncoding(true, true, true); skip = 2; }
            else { encoding = Utf8; if (bytes.AsSpan().StartsWith(new byte[] { 0xef, 0xbb, 0xbf })) skip = 3; }
        }
        else
        {
            var code = choice switch { "utf-8" => 65001, "utf-16le" => 1200, "utf-16be" => 1201, "gb18030" => 54936, "big5" => 950, "shift-jis" => 932, "euc-kr" => 51949, "windows-1252" => 1252, _ => throw Error("invalid_import_encoding", "Choose a supported text encoding.") };
            encoding = Encoding.GetEncoding(code, EncoderFallback.ExceptionFallback, DecoderFallback.ExceptionFallback);
        }
        name = encoding.WebName;
        return encoding.GetString(bytes, skip, bytes.Length - skip).TrimStart('\uFEFF');
    }

    private sealed record Parsed(RichLyrics Lyrics, RawLyrics Raw, string Format);
    private static Parsed ParseText(string text, string fileName, Candidate candidate, CancellationToken token, ImportChecks checks, string choice = "auto", int depth = 0, string prefix = "")
    {
        if (depth > 4) throw Error("invalid_import_format", "Lyric wrappers are nested too deeply.");
        token.ThrowIfCancellationRequested();
        XDocument? ttml = null;
        if (string.IsNullOrWhiteSpace(text)) throw Error("empty_import", "This file contains no sung lyric lines.");
        var type = choice == "auto" ? TypeHelper.GetLyricsTypes(text) : FormatChoices[choice];
        if (choice == "txt") return PlainText(text, candidate);
        if (text.TrimStart().StartsWith('<'))
        {
            using var reader = XmlReader.Create(new StringReader(text), new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = MaxBytes });
            var xml = XDocument.Load(reader, LoadOptions.SetLineInfo | LoadOptions.PreserveWhitespace);
            if (type == LyricsRawTypes.QrcFull)
            {
                var nodes = xml.Descendants().Where(n => n.Name.LocalName.Equals("Lyric_1", StringComparison.OrdinalIgnoreCase)).ToList();
                if (nodes.Count != 1) throw Error("invalid_import_format", "QRC XML must contain one original Lyric_1 entry.");
                var inner = nodes[0].Attributes().FirstOrDefault(a => a.Name.LocalName.Equals("LyricContent", StringComparison.OrdinalIgnoreCase))?.Value;
                if (string.IsNullOrWhiteSpace(inner)) throw Error("empty_import", "QRC XML contains no original lyrics.");
                var result = ParseText(inner.Replace("\r", "\n"), "lyrics.qrc", candidate, token, checks, "auto", depth + 1, prefix + "QRC XML / ");
                return result with { Format = "QRC XML" };
            }
            if (type != LyricsRawTypes.Ttml || xml.Root?.Name != Ttml + "tt") throw Error("invalid_import_format", "This XML is not a supported lyric format.");
            ValidateTtml(xml, checks, prefix);
            ttml = xml;
        }
        if (text.TrimStart().StartsWith('{') && type is not LyricsRawTypes.Yrc)
            return ParseJson(text, candidate, token, type, depth, checks, prefix);
        if (type == LyricsRawTypes.Unknown)
        {
            if (StructuredExtensions.Contains(Path.GetExtension(fileName)) || Pattern(@"(?m)^\s*\[(?:\d|[A-Za-z][\w-]*:)").IsMatch(text))
                throw Error("invalid_import_format", "This file contains malformed or unrecognized structured lyrics.");
            return PlainText(text, candidate);
        }
        var enhanced = type == LyricsRawTypes.Lrc && (choice == "elrc" || Pattern(@"<\d+:[^>]*>").IsMatch(text));
        RichLyrics document;
        if (type == LyricsRawTypes.Ttml) document = ParseTtmlDocument(ttml!, candidate, checks, prefix, token);
        else
        {
            ValidateLines(text, type, token, checks, prefix);
            document = ParseNative(text, type, candidate, checks, prefix, token);
        }
        if (type == LyricsRawTypes.Krc)
        {
            var canonical = string.Join('\n', text.Split('\n').Select(raw =>
            {
                var meta = Metadata.Match(raw.Trim());
                return meta.Success && meta.Groups["name"].Value.Equals("language", StringComparison.OrdinalIgnoreCase) ? "[language:" + meta.Groups["value"].Value + "]" : raw;
            }));
            var content = Lyricify.Lyrics.Parsers.KrcTranslationParser.GetTranslationRawFromKrc(canonical)?.Content;
            foreach (var item in content ?? [])
            {
                if (item.Type is 0 or 1 && (item.LyricContent == null || item.LyricContent.Count != document.Lines.Count || item.LyricContent.Any(row => row == null)))
                    checks.AddError("invalid_import_format", "KRC auxiliary rows do not match the originals.", prefix + "[language] / type " + item.Type);
                if (item.Type == 1 && item.LyricContent?.Count == document.Lines.Count)
                    for (int i = 0; i < item.LyricContent.Count; i++) document.Lines[i].Translations["zh"] = string.Join(" ", item.LyricContent[i] ?? []);
            }
            checks.ThrowIfErrors();
            var pronunciation = content?.FirstOrDefault(c => c.Type == 0)?.LyricContent;
            if (pronunciation != null)
            {
                if (pronunciation.Count != document.Lines.Count) throw Error("invalid_import_format", "KRC pronunciation rows do not match the original lyrics.");
                for (int i = 0; i < pronunciation.Count; i++)
                {
                    var words = pronunciation[i] ?? throw Error("invalid_import_format", "KRC pronunciation has a missing row.");
                    var slots = checks.WordSlots[document.Lines[i]];
                    if (words.Count != slots.Count || words.Any(w => w == null) || words.Where((w, slot) => !slots[slot]).Any(w => !string.IsNullOrWhiteSpace(w)))
                    { checks.AddError("invalid_import_format", "KRC pronunciation word entries do not match their original text/timing markers.", prefix + "[language].content[type=0].lyricContent[" + i + "]"); continue; }
                    document.Lines[i].Pronunciation = string.Join(" ", words.Where((w, slot) => slots[slot]));
                }
            }
        }
        checks.ThrowIfErrors();
        return new(document, new(text), enhanced ? "ELRC" : type.GetDisplayName());
    }

    private static void ValidateLines(string text, LyricsRawTypes type, CancellationToken token, ImportChecks checks, string prefix)
    {
        var number = 0;
        var hasSungText = false;
        foreach (var raw in text.Split('\n'))
        {
            token.ThrowIfCancellationRequested(); number++;
            var line = raw.Trim(); if (line.Length == 0) continue;
            try
            {
                var meta = Metadata.Match(line);
                if (meta.Success)
                {
                    if (meta.Groups["name"].Value.Equals("offset", StringComparison.OrdinalIgnoreCase) && !int.TryParse(meta.Groups["value"].Value, out _)) Fail(number, "invalid offset metadata");
                    if (type == LyricsRawTypes.Krc && meta.Groups["name"].Value.Equals("language", StringComparison.OrdinalIgnoreCase))
                    {
                        var payload = JToken.Parse(Utf8.GetString(Convert.FromBase64String(meta.Groups["value"].Value)), StrictJson);
                        if (payload["content"] is not JArray entries || entries.Any(entry => entry is not JObject || entry["type"]?.Type != JTokenType.Integer || entry["type"]!.Value<int>() is not (0 or 1) || entry["lyricContent"] is not JArray rows || rows.Any(row => row is not JArray fields || fields.Any(f => f.Type != JTokenType.String))))
                            Fail(number, "KRC language metadata contains malformed or unsupported auxiliary rows");
                    }
                    continue;
                }
                if (type == LyricsRawTypes.Yrc && line.StartsWith('{'))
                {
                    var credit = JObject.Parse(line, StrictJson);
                    if (credit["t"]?.Type != JTokenType.Integer || credit["c"] is not JArray) Fail(number, "invalid YRC credit entry");
                    continue;
                }
                if (type == LyricsRawTypes.Lrc)
                {
                    var match = LrcHead.Match(line); if (!match.Success) Fail(number, "expected a complete LRC timestamp");
                    foreach (Match tag in Pattern(@"\[([^\]]+)\]").Matches(match.Groups["tags"].Value)) _ = ClockMs(tag.Groups[1].Value, number);
                    foreach (Match tag in Pattern(@"<([^>]+)>").Matches(match.Groups["text"].Value))
                        if (tag.Groups[1].Value.Length > 0 && char.IsDigit(tag.Groups[1].Value[0])) _ = ClockMs(tag.Groups[1].Value, number);
                    if (Pattern(@"<\d+:[^>]*$").IsMatch(match.Groups["text"].Value)) Fail(number, "incomplete enhanced LRC timestamp");
                    hasSungText |= !string.IsNullOrWhiteSpace(Pattern(@"<\d+:[^>]*>").Replace(match.Groups["text"].Value, ""));
                    continue;
                }
                var header = type == LyricsRawTypes.LyricifySyllable ? SyllableHead.Match(line) : MillisecondHead.Match(line);
                if (!header.Success) Fail(number, "invalid lyric line header");
                if (type != LyricsRawTypes.LyricifySyllable)
                {
                    var start = Integer(header.Groups["start"].Value, number); var second = Integer(header.Groups["second"].Value, number);
                    if (type == LyricsRawTypes.LyricifyLines && second < start) Fail(number, "line end precedes its start");
                    else if (type != LyricsRawTypes.LyricifyLines && (long)start + second > int.MaxValue) Fail(number, "line timing exceeds the supported range");
                }
                var body = header.Groups["text"].Value;
                if (type == LyricsRawTypes.LyricifyLines) { hasSungText |= !string.IsNullOrWhiteSpace(body); continue; }
                if (body.Length == 0) continue;
                var word = type == LyricsRawTypes.Krc ? KrcWord : type == LyricsRawTypes.Yrc ? YrcWord : QrcWord;
                var matches = word.Matches(body); if (matches.Count == 0) Fail(number, "expected word timing entries");
                if ((type == LyricsRawTypes.Krc || type == LyricsRawTypes.Yrc) && matches[0].Index != 0) Fail(number, "word timing must precede its text");
                if ((type == LyricsRawTypes.Qrc || type == LyricsRawTypes.LyricifySyllable) && matches[^1].Index + matches[^1].Length != body.Length) Fail(number, "text is missing its word timing");
                var remainder = word.Replace(body, "");
                hasSungText |= !string.IsNullOrWhiteSpace(remainder);
                if ((type == LyricsRawTypes.Krc ? Pattern(@"<-?\d+,") : Pattern(@"\(-?\d+,")).IsMatch(remainder)) Fail(number, "malformed word timing entry");
                foreach (Match timing in matches)
                {
                    var start = Integer(timing.Groups["start"].Value, number); var duration = Integer(timing.Groups["duration"].Value, number);
                    if (type != LyricsRawTypes.Krc && start < 0) Fail(number, "word start must not be negative");
                    if (duration < 0 || (long)start + duration > int.MaxValue) Fail(number, "invalid word duration");
                    if (type is LyricsRawTypes.Qrc or LyricsRawTypes.Yrc or LyricsRawTypes.Krc)
                    {
                        var lineStart = Integer(header.Groups["start"].Value, number);
                        var absolute = type == LyricsRawTypes.Krc ? (long)lineStart + start : start;
                        // Overlapping vocals can start before their line header or finish after it.
                        // Preserve those cues, but do not allow relative KRC timing to overflow.
                        if (absolute < 0 || absolute + duration > int.MaxValue) Fail(number, "word timing exceeds the supported range");
                    }
                }
            }
            catch (WorkflowException error) { checks.AddError(error.Code, error.Message, prefix + "Line " + number); }
            catch (Exception error) when (error is FormatException or Newtonsoft.Json.JsonException or DecoderFallbackException or ArgumentException or InvalidOperationException)
            { checks.AddError("invalid_import_format", "Malformed metadata or credit entry.", prefix + "Line " + number); }
        }
        checks.ThrowIfErrors();
        if (!hasSungText) throw Error("empty_import", "This file contains no sung lyric lines.");
    }
    private static int Integer(string text, int line)
    { if (!int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)) Fail(line, "timing exceeds the supported range"); return value; }
    private static int ClockMs(string text, int line)
    {
        var match = Clock.Match(text); if (!match.Success) { Fail(line, "invalid timestamp"); }
        var minutes = Integer(match.Groups["m"].Value, line); var seconds = Integer(match.Groups["s"].Value, line);
        if (seconds >= 60) Fail(line, "timestamp seconds must be below 60");
        var fraction = match.Groups["f"].Value; var milliseconds = fraction.Length == 0 ? 0 : Integer(fraction.PadRight(3, '0'), line);
        var value = ((long)minutes * 60 + seconds) * 1000 + milliseconds;
        if (value > int.MaxValue) Fail(line, "timestamp exceeds the supported range");
        return (int)value;
    }
    private static void ValidateTtml(XDocument document, ImportChecks checks, string prefix)
    {
        foreach (var node in document.Descendants())
        {
            try
            {
                ValidateTtmlProfile(node);
                double? start = null, end = null, duration = null;
                foreach (var attribute in node.Attributes().Where(a => a.Name.LocalName is "begin" or "end" or "dur"))
                {
                    var text = attribute.Value.Trim().ToLowerInvariant();
                    var valid = Pattern(@"^(?:\d+:)?\d+:\d{1,2}(?:[.:]\d+)?$|^(?:\d+(?:\.\d+)?|\.\d+)(?:ms|s|m|h)?$").IsMatch(text);
                    if (!valid && (text.EndsWith('f') || text.EndsWith('t') || text.Count(c => c == ':') == 3)) throw Error("unsupported_import_timing", "Frame/tick TTML expressions are not supported; use absolute seconds or clock timestamps.");
                    if (!valid) throw Error("invalid_import_format", $"TTML line {((IXmlLineInfo)node).LineNumber}: invalid {attribute.Name.LocalName} time.");
                    var value = TtmlMilliseconds(text);
                    if (value > int.MaxValue || !double.IsFinite(value)) throw Error("invalid_import_format", "TTML timing exceeds the supported range.");
                    attribute.Value = (value / 1000d).ToString("0.#######", CultureInfo.InvariantCulture) + "s";
                    if (attribute.Name.LocalName == "begin") start = value;
                    if (attribute.Name.LocalName == "end") end = value;
                    if (attribute.Name.LocalName == "dur") duration = value;
                }
                if ((start.HasValue || node.Name.Namespace == Ttml && node.Name.LocalName is "body" or "div") && duration.HasValue && !end.HasValue)
                {
                    end = (start ?? 0) + duration;
                    if (end > int.MaxValue) throw Error("invalid_import_timing", "TTML timing exceeds the supported range.");
                    node.SetAttributeValue("end", (end.Value / 1000d).ToString("0.#######", CultureInfo.InvariantCulture) + "s");
                }
                if (start.HasValue && end < start) throw Error("invalid_import_format", $"TTML line {((IXmlLineInfo)node).LineNumber}: end precedes begin.");
            }
            catch (WorkflowException error) { checks.AddError(error.Code, error.Message, prefix + "TTML line " + ((IXmlLineInfo)node).LineNumber + ", column " + ((IXmlLineInfo)node).LinePosition); }
        }
        checks.ThrowIfErrors();
    }
    private static double TtmlMilliseconds(string value)
    {
        if (value.Contains(':'))
        {
            var parts = value.Split(':'); double total = 0;
            if (double.Parse(parts[^1], CultureInfo.InvariantCulture) >= 60 || parts.Length == 3 && double.Parse(parts[1], CultureInfo.InvariantCulture) >= 60)
                throw Error("invalid_import_timing", "TTML clock minutes/seconds must be below 60.");
            foreach (var part in parts) total = total * 60 + double.Parse(part, CultureInfo.InvariantCulture);
            return total * 1000;
        }
        var numeric = Pattern(@"^(?:\d+(?:\.\d+)?|\.\d+)").Match(value).Value; var unit = value[numeric.Length..];
        return double.Parse(numeric, CultureInfo.InvariantCulture) * (unit switch { "ms" => 1, "m" => 60_000, "h" => 3_600_000, _ => 1000 });
    }
    private static Parsed ParseJson(string text, Candidate candidate, CancellationToken token, LyricsRawTypes type, int depth, ImportChecks checks, string prefix)
    {
        var json = JObject.Parse(text, StrictJson);
        if (json["content"]?.Type == JTokenType.String && (json["fmt"]?.Value<string>() == "krc" || json["content"]!.Value<string>()!.StartsWith("a3Jj", StringComparison.Ordinal)))
        {
            var decoded = Lyricify.Lyrics.Decrypter.Krc.Decrypter.DecryptLyrics(Convert.FromBase64String(json["content"]!.Value<string>()!), MaxBytes);
            return ParseText(decoded, "lyrics.krc", candidate, token, checks, "auto", depth + 1, prefix + "KRC JSON / ") with { Format = "KRC JSON" };
        }
        if (type == LyricsRawTypes.YrcFull)
        {
            var original = JsonLyric(json, "yrc") ?? "";
            var result = ParseText(original, "lyrics.yrc", candidate, token, checks, "auto", depth + 1, prefix + "yrc.lyric / ");
            var translationKey = !string.IsNullOrWhiteSpace(JsonLyric(json, "ytlrc")) ? "ytlrc" : "tlyric";
            var translation = JsonLyric(json, translationKey);
            var pronunciation = JsonLyric(json, "yromalrc");
            if (!string.IsNullOrWhiteSpace(translation)) AlignImportedAuxiliary(result.Lyrics, ParseText(translation, "lyrics.lrc", candidate, token, checks, "auto", depth + 1, prefix + translationKey + ".lyric / ").Lyrics, false, checks);
            if (!string.IsNullOrWhiteSpace(pronunciation)) AlignImportedAuxiliary(result.Lyrics, ParseText(pronunciation, "lyrics.lrc", candidate, token, checks, "auto", depth + 1, prefix + "yromalrc.lyric / ").Lyrics, true, checks);
            checks.ThrowIfErrors();
            return result with { Raw = result.Raw with { Translation = translation, Pronunciation = pronunciation }, Format = "YRC JSON" };
        }
        if (type == LyricsRawTypes.AppleJson)
        {
            var ttml = json.Descendants().OfType<JProperty>().Where(p => (p.Name == "ttml" || p.Name == "ttmlLocalizations") && p.Value.Type == JTokenType.String).OrderByDescending(p => p.Name == "ttmlLocalizations").Select(p => p.Value.Value<string>()).FirstOrDefault();
            if (string.IsNullOrWhiteSpace(ttml)) throw Error("invalid_import_format", "Apple Music JSON contains no supported TTML lyrics.");
            return ParseText(ttml, "lyrics.ttml", candidate, token, checks, "auto", depth + 1, prefix + "Apple TTML / ") with { Format = "Apple Music JSON" };
        }
        if (type == LyricsRawTypes.Spotify)
        {
            var lyrics = json["lyrics"]!; var synced = lyrics["syncType"]?.Value<string>() != "UNSYNCED";
            if (lyrics["syncType"]?.Value<string>() is not ("UNSYNCED" or "LINE_SYNCED" or "SYLLABLE_SYNCED")) throw Error("invalid_import_format", "Spotify JSON has an unknown timing type.");
            var rows = (JArray)lyrics["lines"]!;
            for (int i = 0; i < rows.Count; i++)
            {
                token.ThrowIfCancellationRequested();
                try
                {
                    if (rows[i]["words"]?.Type != JTokenType.String) Fail(i + 1, "Spotify lyric entry has no text");
                    if (synced && (!int.TryParse(rows[i]["startTimeMs"]?.Value<string>(), out var start) || start < 0)) Fail(i + 1, "invalid Spotify start time");
                    if (synced && rows[i]["syllables"] is JArray syllables)
                    {
                        int chars = 0;
                        foreach (var syllable in syllables)
                        {
                            if (!int.TryParse(syllable["numChars"]?.Value<string>(), out var count) || count <= 0 ||
                                !int.TryParse(syllable["startTimeMs"]?.Value<string>(), out var wordStart) || wordStart < 0 ||
                                !int.TryParse(syllable["endTimeMs"]?.Value<string>(), out var wordEnd) || wordEnd < wordStart) Fail(i + 1, "invalid Spotify word timing");
                            chars = checked(chars + count);
                        }
                        if (syllables.Count > 0 && chars != rows[i]["words"]!.Value<string>()!.Length) Fail(i + 1, "Spotify word lengths do not match lyric text");
                    }
                    var endText = rows[i]["endTimeMs"]?.Value<string>();
                    if (synced && !string.IsNullOrEmpty(endText) && (!int.TryParse(endText, out var end) || end < 0 || end != 0 && end < int.Parse(rows[i]["startTimeMs"]!.Value<string>()!, CultureInfo.InvariantCulture))) Fail(i + 1, "invalid Spotify end time");
                }
                catch (WorkflowException error) { checks.AddError(error.Code, error.Message, prefix + "lyrics.lines[" + i + "]"); }
                catch (Exception error) when (error is ArgumentException or InvalidOperationException or OverflowException)
                { checks.AddError("invalid_import_format", "Malformed Spotify lyric fields.", prefix + "lyrics.lines[" + i + "]"); }
            }
            checks.ThrowIfErrors();
        }
        else if (type == LyricsRawTypes.Musixmatch)
        {
            Parsed? subtitle = null; RichLyrics? rich = null;
            var calls = json["message"]?["body"]?["macro_calls"];
            var subtitleMessage = calls?["track.subtitles.get"]?["message"];
            var subtitleEntry = subtitleMessage?["body"]?["subtitle_list"]?.FirstOrDefault()?["subtitle"] as JObject;
            var richMessage = calls?["track.richsync.get"]?["message"];
            var richEntry = richMessage?["body"]?["richsync"] as JObject;
            foreach (var property in json.Descendants().OfType<JProperty>().Where(p => p.Name == "subtitle_body"))
            {
                var result = ParseText(property.Value.Value<string>() ?? "", "lyrics.lrc", candidate, token, checks, "auto", depth + 1, prefix + property.Path + " / ");
                if (property == subtitleEntry?.Property("subtitle_body") && subtitleMessage?["header"]?["status_code"]?.Value<int>() == 200) subtitle = result;
            }
            foreach (var property in json.Descendants().OfType<JProperty>().Where(p => p.Name == "richsync_body"))
            {
                var result = ParseRichsync(JArray.Parse(property.Value.Value<string>() ?? "", StrictJson), candidate, checks, prefix + property.Path, token);
                if (property == richEntry?.Property("richsync_body") && richMessage?["header"]?["status_code"]?.Value<int>() == 200) rich = result;
            }
            checks.ThrowIfErrors();
            if (rich != null) { rich.Language = richEntry?["richsync_language"]?.Value<string>() ?? richEntry?["richssync_language"]?.Value<string>() ?? "und"; return new(rich, new(text), type.GetDisplayName()); }
            if (subtitle != null) return subtitle with { Raw = new(text), Format = type.GetDisplayName() };
        }
        else throw Error("invalid_import_format", "This JSON is not a supported lyric format.");
        var data = ParseHelper.ParseLyrics(text, type) ?? throw Error("invalid_import_format", "This JSON contains no parsable lyrics.");
        var document = Normalization.Parse(new(text), candidate, data);
        if (type == LyricsRawTypes.Spotify)
        {
            var rows = (JArray)json["lyrics"]!["lines"]!;
            if (rows.Count != document.Lines.Count) throw Error("invalid_import_format", "Spotify lyric rows could not be parsed completely.");
            for (int i = 0; i < rows.Count; i++)
            {
                var line = document.Lines[i]; checks.Register(line, prefix + "lyrics.lines[" + i + "]");
                if (line.Text != rows[i]["words"]!.Value<string>()) checks.AddError("invalid_import_format", "Spotify lyric text was not preserved completely.", checks.Location(line));
            }
            checks.ThrowIfErrors();
        }
        return new(document, new(text), type.GetDisplayName());
    }
    private static void ValidateDocument(RichLyrics lyrics, ImportChecks checks, CancellationToken token)
    {
        if (!LyricRows.All(lyrics).Any(l => !string.IsNullOrWhiteSpace(l.Text))) throw Error("empty_import", "This file contains no sung lyric lines.");
        foreach (var line in LyricRows.All(lyrics))
        {
            token.ThrowIfCancellationRequested();
            var location = checks.Location(line);
            try
            {
                foreach (var value in line.Translations.Values.Concat(new[] { line.Text, line.Pronunciation ?? "" }))
                {
                    _ = Utf8.GetByteCount(value);
                    if (value.Any(c => char.IsControl(c) && c is not '\n' and not '\t')) throw Error("invalid_import_encoding", "A lyric or auxiliary entry contains invalid text characters.");
                }
                if (line.Start.HasValue && line.End < line.Start) throw Error("invalid_import_timing", "A lyric line ends before it starts.");
                foreach (var cue in line.Cues)
                {
                    if (cue.Position < 0 || cue.EndPosition <= cue.Position || cue.EndPosition > line.Text.Length || cue.End < cue.Start || SplitsSurrogate(line.Text, cue.Position) || SplitsSurrogate(line.Text, cue.EndPosition))
                        throw Error("invalid_import_timing", "A lyric word has invalid timing or text boundaries.");
                }
                if (line.Cues.Count > 0)
                {
                    var oldStart = line.Start; var oldEnd = line.End;
                    var start = line.Cues.Min(c => c.Start);
                    var end = line.Cues.Max(c => c.End ?? c.Start);
                    line.Start = Math.Min(line.Start ?? start, start);
                    if (line.End.HasValue || line.Cues.All(c => c.End.HasValue)) line.End = Math.Max(line.End ?? end, end);
                    if (oldStart.HasValue && oldStart != line.Start || oldEnd.HasValue && oldEnd != line.End)
                        checks.Warn("line_bounds_expanded", "Line boundaries expanded to preserve supplied word timings.", location);
                }
                if (line.Start < 0 || line.Cues.Any(c => c.Start < 0 || c.End < 0)) checks.Warn("negative_effective_time", "The offset places lyric timing before playback time zero; signed timings were preserved.", location);
            }
            catch (WorkflowException error) { checks.AddError(error.Code, error.Message, location); }
            catch (EncoderFallbackException) { checks.AddError("invalid_import_encoding", "A lyric or auxiliary entry contains invalid Unicode.", location); }
        }
    }
    private static bool SplitsSurrogate(string text, int position) => position > 0 && position < text.Length && char.IsHighSurrogate(text[position - 1]) && char.IsLowSurrogate(text[position]);
    private static void Fail(int line, string reason) => throw Error("invalid_import_format", $"Line {line}: {reason}.");
    private static WorkflowException Error(string code, string message) => new(code == "import_too_large" ? 400 : 422, code, message);
}
