using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
namespace LyricBridge;

/// <summary>Pure serialization of an admitted lyric composition; never retrieves or generates content.</summary>
public static class LyricExport
{
    public const int MaxNativeBytes = 64_000_000;
    public const int MaxEntries = 16;
    public const string LrcHeader = "[re:LyricBridge]\n";
    public const string Schema = "lyricbridge.lyrics";
    public const string BundleSchema = "lyricbridge.bundle";
    private static readonly UTF8Encoding Utf8 = new(false, true);
    public static NativeLyricDocument Capture(RichLyrics original, LyricPayload payload)
    {
        var resolved = payload.ResolvedAuxiliary ?? AuxiliaryResolver.Resolve(payload.Lyrics, payload.Preferences, payload.AuxiliaryChoices, payload.Variants);
        var selected = new ExportAuxiliary(resolved.Translation.ToDictionary(p => p.Key, p => p.Value.Text), resolved.Pronunciation.ToDictionary(p => p.Key, p => p.Value.Text));
        var p = payload.Preferences;
        var copy = Codec.Deserialize<RichLyrics>(Codec.Serialize(original))!;
        copy.Hash = ""; copy.Manual = false;
        return new(Schema, 1, "100ns", copy, selected, new(p.SourceLanguage, p.TranslationLanguage, p.OriginalChineseScript, payload.TimingCorrection?.Seconds ?? 0));
    }
    public static string NativeText(NativeLyricDocument document)
    {
        var node = JsonSerializer.SerializeToNode(document, Codec.Json)!;
        var lyrics = node["lyrics"]!.AsObject();
        lyrics.Remove("hash"); lyrics.Remove("manual"); lyrics.Remove("wordTimed");
        return node.ToJsonString(Codec.Json) + "\n";
    }
    public static ExportArtifact Create(NativeLyricDocument document, ExportInput input, string selectionIdentity = "", string? fileBaseName = null, string rowOrder = "pronunciation-first")
    {
        if (input.Format is not ("txt" or "lrc" or "elrc" or "lyricbridge") || input.Layout is not ("original" or "interleaved" or "zip") ||
            input.Layout == "interleaved" && input.Format != "txt" || input.Format == "lyricbridge" && input.Layout != "original")
            throw new WorkflowException(400, "invalid_export", "Choose a supported export format and file layout.");
        var fingerprint = Codec.Hash(NativeText(document) + Codec.Serialize(input with { Fingerprint = null }) + selectionIdentity + rowOrder);
        if (input.Fingerprint is not null && input.Fingerprint != fingerprint)
            throw new WorkflowException(409, "export_changed", "The lyric composition changed. Preview the export again.", true);
        var name = SafeName(fileBaseName ?? document.Lyrics.Artist + " - " + document.Lyrics.Title);
        var warnings = new List<ImportIssue>();
        var files = new List<(BundleEntry Entry, string Text)>();
        void Add(string fileName, string role, string format, string? language, string[] ids, string text)
        {
            if (format is "lrc" or "elrc") text = LrcHeader + text;
            var bytes = Utf8.GetByteCount(text);
            if (bytes > (format == "lyricbridge" ? MaxNativeBytes : LyricImport.MaxBytes))
                throw new WorkflowException(422, "export_too_large", "This file exceeds its import limit. Choose lossless JSON or a smaller composition.");
            files.Add((new(fileName, role, format, language, ids), text));
        }
        if (input.Format == "lyricbridge") Add(name + ".lyricbridge.json", "lossless", "lyricbridge", null, [], NativeText(document));
        else
        {
            var prefs = new Preferences { SourceLanguage = document.Playback.SourceLanguage, TranslationLanguage = document.Playback.TranslationLanguage, OriginalChineseScript = document.Playback.OriginalChineseScript };
            var displayed = Display.Apply(document.Lyrics, prefs);
            var rows = LyricRows.All(displayed).ToList();
            var background = displayed.Lines.Where(l => l.Background != null).Select(l => l.Background!.Id).ToHashSet();
            var seen = new HashSet<string>();
            void Warn(string code, string message) { if (seen.Add(code)) warnings.Add(new(code, message)); }
            var timed = input.Format != "txt";
            if (!timed && rows.Any(l => l.Start != null || l.Cues.Count > 0)) Warn("timing_discarded", "TXT discards all timing. Use LyricBridge JSON for lossless restoration.");
            if (rows.Any(l => l.End != null || l.Cues.Any(c => c.End != null))) Warn("ends_discarded", "Explicit line and cue ends are not preserved.");
            if (background.Count > 0) Warn("background_flattened", "Background vocals become separate labeled rows; vocal relationships are lost.");
            if (input.Format == "lrc" && rows.Any(l => l.Cues.Count > 0)) Warn("word_timing_discarded", "LRC retains line starts only; word timing is discarded.");
            if (timed && rows.Any(l => l.Start == null)) Warn("untimed_rows", "Untimed rows remain plain text; some lyric players may ignore them.");
            var previousEnd = long.MinValue;
            foreach (var row in rows)
            {
                if (row.Start is long start && start < previousEnd) Warn("overlap", "Overlapping vocals may not be played faithfully by LRC players.");
                if (row.End is long end) previousEnd = Math.Max(previousEnd, end);
            }
            long Shift(long value) => checked(value + (long)Math.Round(document.Playback.TimingSeconds * 10_000_000, MidpointRounding.AwayFromZero));
            string Stamp(long value, bool word = false)
            {
                try { value = Shift(value); }
                catch (OverflowException) { throw new WorkflowException(422, "export_timing_range", "This timeline exceeds the LRC range. Choose lossless JSON."); }
                if (value < 0) { Warn("negative_clamped", "Negative compatibility timestamps are clamped to zero."); value = 0; }
                if (value % 10_000 != 0) Warn("timing_rounded", "Compatibility timestamps are rounded to milliseconds.");
                var ms = (long)Math.Round(value / 10000m, MidpointRounding.AwayFromZero);
                if (ms > int.MaxValue) throw new WorkflowException(422, "export_timing_range", "This timeline exceeds the LRC import range. Choose lossless JSON.");
                var clock = string.Create(CultureInfo.InvariantCulture, $"{ms / 60000:00}:{ms / 1000 % 60:00}.{ms % 1000:000}");
                return word ? "<" + clock + ">" : "[" + clock + "]";
            }
            string Clean(string text)
            {
                if (text.Contains('\n') || text.Contains('\r')) Warn("embedded_breaks", "Embedded line breaks are flattened in compatibility files.");
                if (text.Contains('[') || text.Contains('<')) Warn("literal_markup", "Literal timestamp-like text may be interpreted as markup by lyric players.");
                return text.Replace('\r', ' ').Replace('\n', ' ');
            }
            string Row(LyricLine line, string text, bool original)
            {
                var label = background.Contains(line.Id) ? "(background) " : "";
                var prefix = timed && line.Start is long start ? Stamp(start) : "";
                if (original && input.Format == "elrc" && line.Cues.Count > 0)
                {
                    var sb = new StringBuilder(); var cursor = 0; long? last = null;
                    foreach (var cue in line.Cues)
                    {
                        if (cue.Position < cursor || cue.EndPosition > text.Length || cue.Position < 0 || cue.EndPosition <= cue.Position)
                        { Warn("unsupported_cues", "Overlapping or invalid text cue ranges were simplified without inventing timing."); continue; }
                        if (last is long previous && cue.Start < previous) Warn("cue_overlap", "Decreasing word starts are retained; player support varies.");
                        if (cue.Position > cursor) Warn("untimed_fragments", "Text outside word cues is retained without invented word timestamps.");
                        sb.Append(Clean(text[cursor..cue.Position])).Append(Stamp(cue.Start, true)).Append(Clean(text[cue.Position..cue.EndPosition]));
                        cursor = cue.EndPosition; last = cue.Start;
                    }
                    if (cursor < text.Length) Warn("untimed_fragments", "Text outside word cues is retained without invented word timestamps.");
                    return prefix + label + sb + Clean(text[cursor..]);
                }
                return prefix + label + Clean(text);
            }
            var originalText = new List<string>();
            foreach (var line in rows)
            {
                originalText.Add(Row(line, line.Text, true));
                if (input.Layout == "interleaved")
                {
                    var order = rowOrder == "translation-first" ? new[] { "translation", "pronunciation" } : new[] { "pronunciation", "translation" };
                    foreach (var kind in order)
                    {
                        var map = kind == "translation" ? document.Selected.Translation : document.Selected.Pronunciation;
                        if ((kind == "translation" ? input.Translation : input.Pronunciation) && map.TryGetValue(line.Id, out var text)) originalText.Add(Row(line, text, false));
                    }
                }
            }
            Add(name + "." + input.Format, "original", input.Format, displayed.Language, rows.Select(l => l.Id).ToArray(), string.Join('\n', originalText) + "\n");
            if (input.Layout == "zip")
            {
                foreach (var kind in new[] { "translation", "pronunciation" })
                {
                    if (!(kind == "translation" ? input.Translation : input.Pronunciation)) continue;
                    var map = kind == "translation" ? document.Selected.Translation : document.Selected.Pronunciation;
                    var selected = rows.Where(l => map.ContainsKey(l.Id)).ToList();
                    if (selected.Count == 0) continue;
                    var format = timed ? "lrc" : "txt";
                    var language = kind == "translation" ? document.Playback.TranslationLanguage : null;
                    Add(name + "." + kind + (language == null ? "" : "." + SafeName(language)) + "." + format, kind, format, language,
                        selected.Select(l => l.Id).ToArray(), string.Join('\n', selected.Select(l => Row(l, map[l.Id], false))) + "\n");
                }
                if (input.LosslessCopy) Add(name + ".lyricbridge.json", "lossless", "lyricbridge", null, [], NativeText(document));
            }
        }
        byte[] output; string fileName; string contentType;
        if (input.Layout == "zip")
        {
            var manifest = Codec.Serialize(new LyricBundle(BundleSchema, 1, files.Select(f => f.Entry).ToArray(), warnings));
            if (files.Sum(f => (long)Utf8.GetByteCount(f.Text)) + Utf8.GetByteCount(manifest) > MaxNativeBytes)
                throw new WorkflowException(422, "export_too_large", "The export bundle exceeds the 64 MB decoded limit.");
            using var stream = new MemoryStream();
            using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, true))
            {
                foreach (var file in files) Write(zip, file.Entry.FileName, file.Text);
                Write(zip, "lyricbridge-manifest.json", manifest);
            }
            output = stream.ToArray(); fileName = name + ".zip"; contentType = "application/zip";
        }
        else { output = Utf8.GetBytes(files[0].Text); fileName = files[0].Entry.FileName; contentType = input.Format == "lyricbridge" ? "application/json" : "text/plain; charset=utf-8"; }
        if (output.Length > MaxNativeBytes) throw new WorkflowException(422, "export_too_large", "The export exceeds the 64 MB limit.");
        var previews = files.Select(f => new ExportFilePreview(f.Entry.FileName, f.Text[..Math.Min(f.Text.Length, 8000)], Utf8.GetByteCount(f.Text))).ToArray();
        return new(fileName, contentType, output, new(fileName, fingerprint, previews, warnings, document.Selected.Translation.Count > 0, document.Selected.Pronunciation.Count > 0));
    }
    private static void Write(ZipArchive zip, string name, string text)
    {
        using var writer = new StreamWriter(zip.CreateEntry(name).Open(), Utf8); writer.Write(text);
    }
    public static string SafeName(string name)
    {
        var result = string.Concat(name.Select(c => char.IsControl(c) || "<>:\"/\\|?*".Contains(c) ? '_' : c)).Trim(' ', '.');
        if (result.Length > 100) result = result[..100];
        if (result.Length > 0 && char.IsHighSurrogate(result[^1])) result = result[..^1];
        return string.IsNullOrWhiteSpace(result) || result == "-" ? "lyrics" : result;
    }
}
