using System.IO.Compression;
using System.Text;
using System.Text.Json;
namespace LyricBridge;

public static partial class LyricImport
{
    public static bool IsNativeFile(string? fileName, string? format) => format is "lyricbridge" or "bundle" ||
        (fileName?.EndsWith(".lyricbridge.json", StringComparison.OrdinalIgnoreCase) ?? false) ||
        (fileName?.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) ?? false);
    private static ImportedLyrics? TryExportImport(ImportLyricsInput input, Candidate candidate, CancellationToken token)
    {
        if (input.Format is not (null or "auto" or "lyricbridge" or "bundle")) return null;
        var native = IsNativeFile(input.FileName, input.Format);
        // Only native files get the larger byte allowance. Ordinary formats retain their existing limits.
        if (!native && input.Format is not (null or "auto")) return null;
        if (!native && input.FileBytes?.Length > (MaxBytes + 2) / 3 * 4) return null;
        byte[] bytes;
        try { bytes = input.FileBytes is not null ? Convert.FromBase64String(input.FileBytes) : Utf8.GetBytes(input.Text ?? ""); }
        catch (Exception e) when (e is FormatException or EncoderFallbackException) { if (!native) return null; throw Error("invalid_import", "Invalid lyric file bytes."); }
        if (bytes.Length > LyricExport.MaxNativeBytes) throw Error("import_too_large", "Native lyric files must fit within 64 MB.");
        var zip = bytes.AsSpan().StartsWith(new byte[] { 0x50, 0x4b, 0x03, 0x04 });
        if (zip && input.Format == "lyricbridge") throw Error("invalid_import_format", "Choose LyricBridge ZIP bundle for this file.");
        if (zip && (native || input.Format == "auto")) return ParseBundle(bytes, input.FileName ?? "lyrics.zip", candidate, token);
        string text;
        try { text = Utf8.GetString(bytes).TrimStart('\uFEFF'); }
        catch (DecoderFallbackException) { if (!native) return null; throw Error("invalid_import_encoding", "LyricBridge JSON must use UTF-8."); }
        if (!native && !text.TrimStart().StartsWith('{')) return null;
        try
        {
            using var json = JsonDocument.Parse(text);
            if (!native && (!json.RootElement.TryGetProperty("schema", out var schema) || schema.GetString() != LyricExport.Schema)) return null;
            if (input.Format == "bundle") throw Error("invalid_import_format", "Choose a LyricBridge ZIP bundle.");
            RejectDuplicateProperties(json.RootElement);
            var document = JsonSerializer.Deserialize<NativeLyricDocument>(text, new JsonSerializerOptions(Codec.Json) { RespectRequiredConstructorParameters = true }) ?? throw Error("invalid_import_format", "Missing lyric document.");
            ValidateNative(document, token);
            return NativeResult(document, input.FileName ?? "lyrics.lyricbridge.json", []);
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or ArgumentException or NullReferenceException or OverflowException)
        { if (!native) throw Error("invalid_import_format", "Malformed LyricBridge JSON."); throw Error("invalid_import_format", "Malformed or unsupported LyricBridge JSON."); }
    }
    private static void RejectDuplicateProperties(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var property in value.EnumerateObject()) { if (!names.Add(property.Name)) throw Error("invalid_import_format", "Duplicate JSON properties are not supported."); RejectDuplicateProperties(property.Value); }
        }
        else if (value.ValueKind == JsonValueKind.Array) foreach (var item in value.EnumerateArray()) RejectDuplicateProperties(item);
    }
    private static void ValidateNative(NativeLyricDocument document, CancellationToken token)
    {
        if (document.Schema != LyricExport.Schema || document.Version != 1 || document.TimingUnit != "100ns") throw Error("invalid_import_format", "Unsupported LyricBridge lyric schema, version, or timing unit.");
        var lyrics = document.Lyrics; var p = document.Playback;
        if (lyrics?.Lines is not { Count: > 0 } || lyrics.Source is null || lyrics.ProviderId is null || lyrics.Title is null || lyrics.Artist is null || !PreferenceService.LanguageTag(lyrics.Language) || document.Selected?.Translation is null || document.Selected.Pronunciation is null || p is null ||
            !PreferenceService.LanguageTag(p.SourceLanguage) || !PreferenceService.LanguageTag(p.TranslationLanguage) || p.TranslationLanguage == "auto" ||
            p.OriginalChineseScript is not ("Simplified" or "Traditional") || !double.IsFinite(p.TimingSeconds) || Math.Abs(p.TimingSeconds) > 15)
            throw Error("invalid_import_format", "Invalid lyric content or playback interpretation.");
        var ids = new HashSet<string>();
        foreach (var line in LyricRows.All(lyrics))
        {
            token.ThrowIfCancellationRequested();
            if (line is null || string.IsNullOrWhiteSpace(line.Id) || !ids.Add(line.Id) || line.Text is null || line.Cues is null || line.Translations is null ||
                line.Background?.Background is not null || !PreferenceService.LanguageTag(line.Language) || line.Alignment is null ||
                line.End is long end && line.Start is long start && end < start)
                throw Error("invalid_import_format", "Invalid row identity, language, background, or timing.");
            Utf8.GetByteCount(line.Text);
            bool Boundary(int position) => position >= 0 && position <= line.Text.Length && (position == line.Text.Length || !char.IsLowSurrogate(line.Text[position]));
            foreach (var cue in line.Cues)
                if (cue is null || !Boundary(cue.Position) || !Boundary(cue.EndPosition) || cue.EndPosition <= cue.Position || cue.End is long cueEnd && cueEnd < cue.Start)
                    throw Error("invalid_import_format", "Invalid word cue boundary or duration.");
            foreach (var pair in line.Translations) if (!PreferenceService.LanguageTag(pair.Key) || pair.Value is null) throw Error("invalid_import_format", "Invalid embedded translation.");
        }
        foreach (var map in new[] { document.Selected.Translation, document.Selected.Pronunciation })
            if (map.Any(pair => !ids.Contains(pair.Key) || pair.Value is null)) throw Error("invalid_import_format", "Auxiliary rows do not match original row identities.");
        lyrics.Hash = Codec.ContentHash(lyrics);
    }
    private static ImportedLyrics NativeResult(NativeLyricDocument document, string fileName, IReadOnlyList<ImportIssue> warnings)
    {
        document.Lyrics.Hash = Codec.ContentHash(document.Lyrics);
        var raw = new RawLyrics(LyricExport.NativeText(document), Type: "lyricbridge");
        return new(document.Lyrics, raw, fileName, "LyricBridge JSON", "UTF-8", LyricRows.All(document.Lyrics).Any(l => l.Cues.Count > 0) ? "word" : LyricRows.All(document.Lyrics).Any(l => l.Start != null) ? "line" : "plain", LyricRows.All(document.Lyrics).Count(), warnings, document);
    }
    private static ImportedLyrics ParseBundle(byte[] bytes, string fileName, Candidate candidate, CancellationToken token)
    {
        try
        {
            using var stream = new MemoryStream(bytes);
            using var zip = new ZipArchive(stream, ZipArchiveMode.Read);
            if (zip.Entries.Count is < 2 or > LyricExport.MaxEntries) throw Error("invalid_import_bundle", "A lyric bundle must contain 2–16 entries.");
            var entries = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase); long total = 0;
            foreach (var entry in zip.Entries)
            {
                token.ThrowIfCancellationRequested();
                if (string.IsNullOrWhiteSpace(entry.FullName) || entry.FullName.Contains('/') || entry.FullName.Contains('\\') || entry.FullName.Contains(':') || entry.FullName is "." or ".." || entry.FullName.Any(char.IsControl) || entries.ContainsKey(entry.FullName) || entry.FullName.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                    throw Error("invalid_import_bundle", "Bundle entries must have unique safe filenames and cannot be nested archives.");
                if (entry.Length < 0 || entry.Length > LyricExport.MaxNativeBytes || (total += entry.Length) > LyricExport.MaxNativeBytes) throw Error("import_too_large", "The bundle exceeds 64 MB decoded.");
                using var source = entry.Open(); using var decoded = new MemoryStream();
                var buffer = new byte[8192]; int count;
                while ((count = source.Read(buffer)) > 0)
                {
                    token.ThrowIfCancellationRequested();
                    if (decoded.Length + count > entry.Length) throw Error("invalid_import_bundle", "Invalid archive entry length.");
                    decoded.Write(buffer, 0, count);
                }
                if (decoded.Length != entry.Length) throw Error("invalid_import_bundle", "Incomplete archive entry.");
                entries.Add(entry.FullName, decoded.ToArray());
            }
            if (!entries.Remove("lyricbridge-manifest.json", out var manifestBytes)) throw Error("invalid_import_bundle", "Missing LyricBridge bundle manifest.");
            using var json = JsonDocument.Parse(manifestBytes); RejectDuplicateProperties(json.RootElement);
            var manifest = Codec.Deserialize<LyricBundle>(Utf8.GetString(manifestBytes));
            if (manifest is null || manifest.Schema != LyricExport.BundleSchema || manifest.Version != 1 || manifest.Files is null || manifest.Warnings is null || manifest.Files.Count != entries.Count ||
                manifest.Files.Select(f => f.FileName).Distinct(StringComparer.OrdinalIgnoreCase).Count() != entries.Count || manifest.Files.Any(f => !entries.ContainsKey(f.FileName) || f.RowIds is null || f.Role is not ("original" or "translation" or "pronunciation" or "lossless")) ||
                manifest.Files.Count(f => f.Role == "original") != 1 || manifest.Files.Count(f => f.Role == "lossless") > 1 || manifest.Files.Count(f => f.Role == "translation") > 1 || manifest.Files.Count(f => f.Role == "pronunciation") > 1)
                throw Error("invalid_import_bundle", "Invalid or inconsistent bundle manifest.");
            var manifestOriginalIds = manifest.Files.Single(f => f.Role == "original").RowIds.ToHashSet();
            if (manifest.Warnings.Any(w => w is null || string.IsNullOrWhiteSpace(w.Code) || string.IsNullOrWhiteSpace(w.Message)) ||
                manifest.Files.Where(f => f.Role is "translation" or "pronunciation").Any(f => f.RowIds.Any(id => !manifestOriginalIds.Contains(id)) || f.Role == "translation" && (!PreferenceService.LanguageTag(f.Language) || f.Language == "auto")))
                throw Error("invalid_import_bundle", "Invalid companion associations, language, or warnings.");
            foreach (var file in manifest.Files.Where(f => f.Role != "lossless")) ValidateBundleEntry(file, entries[file.FileName]);
            var lossless = manifest.Files.SingleOrDefault(f => f.Role == "lossless");
            if (lossless is not null)
            {
                if (lossless.Format != "lyricbridge") throw Error("invalid_import_bundle", "Invalid lossless entry format.");
                var result = TryExportImport(new(FileName: lossless.FileName, FileBytes: Convert.ToBase64String(entries[lossless.FileName]), Format: "lyricbridge"), candidate, token)!;
                var original = manifest.Files.Single(f => f.Role == "original");
                if (!original.RowIds.SequenceEqual(LyricRows.All(result.Lyrics).Select(l => l.Id))) throw Error("invalid_import_bundle", "Lossless and compatibility row identities disagree.");
                return result with { FileName = fileName, Warnings = manifest.Warnings };
            }
            var originalEntry = manifest.Files.Single(f => f.Role == "original");
            var originals = BundleRows(originalEntry, entries[originalEntry.FileName], candidate, token);
            var originalIds = originals.Select(l => l.Id).ToHashSet();
            foreach (var entry in manifest.Files.Where(f => f.Role is "translation" or "pronunciation"))
            {
                if (entry.Role == "translation" && (!PreferenceService.LanguageTag(entry.Language) || entry.Language == "auto")) throw Error("invalid_import_bundle", "Invalid companion language.");
                var companions = BundleRows(entry, entries[entry.FileName], candidate, token);
                foreach (var row in companions)
                {
                    if (!originalIds.Contains(row.Id)) throw Error("invalid_import_bundle", "Companion row has no matching original.");
                    var target = originals.Single(l => l.Id == row.Id);
                    if (entry.Role == "translation") target.Translations[entry.Language!] = row.Text; else target.Pronunciation = row.Text;
                }
            }
            var lyrics = new RichLyrics { Title = candidate.Title, Artist = candidate.Artist, Source = "Imported", Lines = originals, Manual = true };
            lyrics.Hash = Codec.ContentHash(lyrics);
            var warnings = manifest.Warnings.Concat(new[] { new ImportIssue("compatibility_bundle", "This bundle has no lossless copy; only the compatibility representation can be restored.") }).ToArray();
            return new(lyrics, new("", Type: "bundle"), fileName, "LyricBridge ZIP", "UTF-8", originals.Any(l => l.Cues.Count > 0) ? "word" : originals.Any(l => l.Start != null) ? "line" : "plain", originals.Count, warnings);
        }
        catch (Exception e) when (e is InvalidDataException or IOException or JsonException or DecoderFallbackException or ArgumentException or NotSupportedException or InvalidOperationException or NullReferenceException)
        { throw Error("invalid_import_bundle", "Malformed, encrypted, or unsupported LyricBridge bundle."); }
    }
    private static string CompatibilityText(byte[] bytes)
    {
        var text = Utf8.GetString(bytes);
        return text.StartsWith(LyricExport.LrcHeader, StringComparison.Ordinal) ? text[LyricExport.LrcHeader.Length..] : text;
    }
    private static Parsed ParseExportedLrc(string text, Candidate candidate, string choice, CancellationToken token)
    {
        var content = text[LyricExport.LrcHeader.Length..];
        var count = content.Split('\n').Length - (content.EndsWith('\n') ? 1 : 0);
        var format = choice == "elrc" || Pattern(@"<\d+:[^>]*>").IsMatch(content) ? "elrc" : "lrc";
        var entry = new BundleEntry("lyrics." + format, "original", format, null, Enumerable.Range(0, count).Select(i => "l" + i).ToArray());
        var lyrics = NewDocument(candidate); lyrics.Lines = BundleRows(entry, Utf8.GetBytes(content), candidate, token);
        return new(lyrics, new(text, Type: format), format == "elrc" ? "Enhanced LRC" : "LRC");
    }
    private static void ValidateBundleEntry(BundleEntry entry, byte[] bytes)
    {
        if (bytes.Length > MaxBytes || entry.Format is not ("txt" or "lrc" or "elrc") || entry.RowIds.Any(string.IsNullOrWhiteSpace) || entry.RowIds.Distinct().Count() != entry.RowIds.Length)
            throw Error("invalid_import_bundle", "Invalid compatibility entry or row associations.");
        var text = CompatibilityText(bytes);
        var count = text.Split('\n').Length - (text.EndsWith('\n') ? 1 : 0);
        if (count != entry.RowIds.Length) throw Error("invalid_import_bundle", "Bundle row associations do not match file contents.");
    }
    private static List<LyricLine> BundleRows(BundleEntry entry, byte[] bytes, Candidate candidate, CancellationToken token)
    {
        if (bytes.Length > MaxBytes || entry.Format is not ("txt" or "lrc" or "elrc") || entry.RowIds.Any(string.IsNullOrWhiteSpace) || entry.RowIds.Distinct().Count() != entry.RowIds.Length)
            throw Error("invalid_import_bundle", "Invalid compatibility entry or row associations.");
        var text = CompatibilityText(bytes);
        var lines = text.Split('\n').ToList();
        if (lines.Count > 0 && lines[^1] == "") lines.RemoveAt(lines.Count - 1);
        if (lines.Count != entry.RowIds.Length) throw Error("invalid_import_bundle", "Bundle row associations do not match the file contents.");
        var rows = new List<LyricLine>();
        for (var i = 0; i < lines.Count; i++)
        {
            token.ThrowIfCancellationRequested();
            var line = lines[i]; LyricLine row;
            if (entry.Format != "txt" && LrcHead.IsMatch(line))
            {
                var match = LrcHead.Match(line);
                if (match.Groups["text"].Value.Length == 0)
                {
                    var clock = match.Groups["tags"].Value.Trim('[', ']');
                    row = new() { Text = "", Start = checked((long)ClockMs(clock, i + 1) * 10000) };
                    row.Id = entry.RowIds[i]; rows.Add(row); continue;
                }
                var parsed = Parse(new(Text: line, FileName: "row." + entry.Format, Format: entry.Format), candidate, token);
                if (parsed.Lyrics.Lines.Count != 1) throw Error("invalid_import_bundle", "Each bundle row must represent one lyric row.");
                row = parsed.Lyrics.Lines[0];
            }
            else row = new() { Text = line };
            row.Id = entry.RowIds[i]; rows.Add(row);
        }
        if (rows.Count == 0) throw Error("empty_import", "The bundle has no original lyric rows.");
        return rows;
    }
}
