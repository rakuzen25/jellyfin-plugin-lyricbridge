using System.Text.Json;
using System.Text.Json.Nodes;

namespace LyricBridge;

public sealed record DataContentLine(string Text, double? StartSeconds = null, double? EndSeconds = null);
public sealed record DataDisplayField(string Label, string Value, string? Format = null);
public sealed record DataRelationship(string Role, DataTarget Target, string Label, bool Missing);
public sealed record DataInspection(IReadOnlyList<DataContentLine> Lines, IReadOnlyList<DataDisplayField> Fields,
    IReadOnlyList<DataDisplayField> Metadata, IReadOnlyList<DataRelationship> Relationships, string? Restriction, bool CanCancel);

public sealed partial class DataManagementService
{
    private DataInspection Inspect(ManagedRecord record, Index index, string? blocker)
    {
        var records = index.Records.ToDictionary(r => r.Key, StringComparer.Ordinal);
        ManagedRecord? Find(string kind, string? id) => id == null ? null : records.GetValueOrDefault(kind + ":" + id);
        string Safe(string text) => Clean(JsonValue.Create(text))?.GetValue<string>() ?? "";
        var links = new Dictionary<string, DataRelationship>(StringComparer.Ordinal);
        void Link(string role, string kind, string? id, bool optional = false)
        {
            if (string.IsNullOrEmpty(id) || kind == record.Kind && id == record.Id) return;
            var related = Find(kind, id);
            if (optional && related == null) return;
            var name = related?.Text("title") ?? related?.Text("optionName");
            var label = ManagedDataKinds.Label(kind) + (string.IsNullOrWhiteSpace(name) ? "" : " · " + Safe(name));
            links.TryAdd(role + ":" + kind + ":" + id, new(role, new(kind, id), label, related == null));
        }
        switch (record.Kind)
        {
            case "saved-original":
                Link("source", "document", record.Text("hash")); Link("source", "raw", record.Text("hash"), true);
                Link("source", "transcript-original", record.Id, true); break;
            case "document":
            case "raw":
                foreach (var owner in index.Records.Where(r => r.Kind == "saved-original" && r.Text("hash") == record.Id)) Link("owner", owner.Kind, owner.Id);
                foreach (var owner in index.Records.Where(r => r.Kind == "variant" && r.Text("hash") == record.Id)) Link("used-by", owner.Kind, owner.Id);
                break;
            case "variant":
                Link("source", "document", record.Text("hash")); Link("reference", "mixed-origin", record.Id, true);
                foreach (var choice in index.Records.Where(r => r.Kind == "auxiliary-choice" && r.Text("key") == record.Id)) Link("used-by", choice.Kind, choice.Id);
                break;
            case "mixed-origin": Link("owner", "variant", record.Id); Link("source", "document", record.Text("donorHash")); break;
            case "boundary-version":
            case "saved-boundary-entry":
            case "boundary-review-result":
                Link("owner", "transcript", record.Text("transcriptId"));
                if (record.Kind != "boundary-version") Link("source", "boundary-version", record.Text("versionId"));
                if (record.Kind == "boundary-review-result") Link("reference", "job", record.Id);
                if (record.Kind == "saved-boundary-entry" && record.Id.StartsWith("review:", StringComparison.Ordinal)) Link("reference", "job", record.Id[7..], true);
                if (record.Kind == "boundary-version")
                    foreach (var dependent in index.Records.Where(r => r.Kind is "saved-boundary-entry" or "boundary-review-result" or "transcript-original" && r.Text("versionId") == record.Id)) Link("used-by", dependent.Kind, dependent.Id);
                break;
            case "transcript":
                foreach (var child in index.Records.Where(r => r.Kind is "boundary-version" or "saved-boundary-entry" or "boundary-review-result" or "transcript-original" && r.Text("transcriptId") == record.Id)) Link("used-by", child.Kind, child.Id);
                break;
            case "transcript-original":
                Link("owner", "saved-original", record.Id); Link("source", "transcript", record.Text("transcriptId"));
                Link("source", "boundary-version", record.Text("versionId")); Link("source", "saved-boundary-entry", record.Text("entryId")); break;
            case "review-checkpoint": case "transcript-chunk": Link("owner", "job", record.Text("jobId")); break;
            case "selected":
                Link("source", "document", record.Text("hash"));
                if (record.ItemId is { } selectedItem && record.Text("hash") is { } selectedHash) Link("source", "saved-original", selectedItem.ToString("N") + ":" + selectedHash, true);
                break;
            case "selection-assessment":
            case "timing-correction":
                Link("source", "document", record.Text("hash")); break;
            case "auxiliary-choice": Link("source", "variant", record.Text("key")); break;
            case "job":
                var job = Codec.Deserialize<Job>(record.Payload.GetRawText())!;
                Link("source", "document", job.Hash.Length > 0 ? job.Hash : null);
                if (job.Review != null) { Link("source", "transcript", job.Review.TranscriptId); Link("source", "boundary-version", job.Review.VersionId); }
                if (job.Audio?.UploadId != null) Link("source", "audio-staging", job.Audio.UploadId, true);
                if (job.ResultId != null && job.TaskKind is "transcription" or "boundary-review") Link("output", "transcript", job.ResultId);
                if (job.TaskKind == "boundary-review") { Link("output", "boundary-review-result", job.Id, true); Link("output", "saved-boundary-entry", "review:" + job.Id, true); }
                if (job.VariantKey.Length > 0) Link("output", "variant", job.VariantKey, true);
                break;
        }
        var capability = Capability(record, index);
        foreach (var dependency in capability.Dependencies) Link("blocker", dependency.Kind, dependency.Id);
        var lines = ContentLines(record, Find);
        var fields = new List<DataDisplayField>(); var metadata = new List<DataDisplayField>();
        void Field(string key, string label, string? format = null, JsonElement? source = null, bool meta = false)
        {
            var json = source ?? record.Payload;
            if (json.ValueKind != JsonValueKind.Object || !json.TryGetProperty(key, out var value) || value.ValueKind is JsonValueKind.Null or JsonValueKind.Object or JsonValueKind.Array) return;
            var text = value.ValueKind == JsonValueKind.String ? value.GetString()! : value.ValueKind is JsonValueKind.True or JsonValueKind.False ? value.GetBoolean() ? "Yes" : "No" : value.GetRawText();
            if (string.IsNullOrWhiteSpace(text) || text == "und") return;
            (meta ? metadata : fields).Add(new(label, Safe(text), format));
        }
        if (record.Kind is "preferences" or "song-preferences")
        {
            foreach (var (key, label) in new[] { ("sourceLanguage", "Original language"), ("translationLanguage", "Translation language"), ("originalChineseScript", "Chinese script"), ("romanizationSystem", "Romanization"), ("rowOrder", "Row order"), ("originalSize", "Original size"), ("pronunciationSize", "Pronunciation size"), ("translationSize", "Translation size"), ("rowSpacing", "Row spacing"), ("showTranslation", "Show translation"), ("showPronunciation", "Show pronunciation"), ("japaneseRomaji", "Japanese romaji") }) Field(key, label);
        }
        else if (record.Kind == "job")
        {
            Field("state", "Status", "label"); Field("stage", "Stage"); Field("progress", "Progress", "percent"); Field("terminalAt", "Finished", "date"); Field("outputDeleted", "Output removed"); Field("error", "Outcome");
            if (record.Payload.TryGetProperty("request", out var request)) { Field("kind", "Operation", "label", request); Field("language", "Language", source: request); Field("optionName", "Service option", source: request); }
        }
        else if (record.Kind == "transcript")
        {
            Field("language", "Language"); Field("timing", "Timing", "label");
            if (record.Payload.TryGetProperty("tokens", out var tokens) && tokens.ValueKind == JsonValueKind.Array) fields.Add(new("Words", tokens.GetArrayLength().ToString(System.Globalization.CultureInfo.InvariantCulture)));
        }
        else if (record.Kind is "instrumental" or "instrumental-evidence" or "rejected-match" or "discovery-suppressed" or "selection-assessment" or "preview-assessment")
        { Field("instrumental", "Instrumental"); Field("reason", "Reason"); Field("state", "Status", "label"); Field("confidence", "Confidence"); }
        else if (record.Kind is "auxiliary-choice" or "pronunciation-choice")
        { Field("includeSupplied", "Include provider pronunciation"); Field("enabled", "Enabled"); }
        else if (record.Kind == "timing-correction") Field("seconds", "Timing adjustment", "seconds");
        else if (record.Kind is "candidate" or "preview" or "better") { Field("artist", "Artist"); Field("album", "Album"); Field("score", "Match score"); }
        else if (record.Kind == "audio-staging") Field("bytes", "Staged audio size", "bytes");
        if (record.Kind is "variant" or "document" or "selected" or "raw") { Field("language", "Language"); Field("kind", "Version type", "label"); }
        Field("optionName", "Service option", meta: true);
        if (record.Payload.TryGetProperty("profile", out var profile) && profile.ValueKind == JsonValueKind.Object)
        { Field("service", "Provider", source: profile, meta: true); Field("model", "Model", source: profile, meta: true); }
        else { Field("service", "Provider", meta: true); Field("model", "Model", meta: true); }
        if (record.Payload.ValueKind is JsonValueKind.True or JsonValueKind.False)
            fields.Add(new(record.Kind == "discovery-suppressed" ? "Automatic retrieval suppressed" : "Enabled", record.Payload.GetBoolean() ? "Yes" : "No"));
        if (record.Kind == "selection-assessment" && record.Payload.TryGetProperty("candidate", out var candidate))
        { Field("title", "Matched title", source: candidate); Field("artist", "Matched artist", source: candidate); Field("score", "Match score", source: candidate); }
        // Source and saved date are already in the header; do not repeat them below.
        var restriction = blocker;
        if (blocker?.StartsWith("Managed by its owning", StringComparison.Ordinal) == true)
        {
            var owners = links.Values.Where(l => l.Role == "owner").ToList();
            restriction = owners.Count == 0 ? "This internal record has no independent deletion action. Use an existing reset workflow if cleanup is needed."
                : owners.All(l => l.Missing) ? "The owning record is missing. This record cannot be deleted independently; use an existing reset workflow if cleanup is needed."
                : "This record is managed through its owner and cannot be deleted independently. Inspect the owner to see its supported actions.";
        }
        return new(lines.Select(line => line with { Text = Safe(line.Text) }).ToList(), fields, metadata.DistinctBy(f => (f.Label, f.Value)).ToList(),
            links.Values.OrderBy(l => l.Role, StringComparer.Ordinal).ThenBy(l => l.Label, StringComparer.Ordinal).ToList(), restriction,
            record.Kind == "job" && !JobLifecycle.Terminal(record.Text("state") ?? ""));
    }

    private static IReadOnlyList<DataContentLine> ContentLines(ManagedRecord record, Func<string, string?, ManagedRecord?> find)
    {
        T? Read<T>(string kind, string? id) where T : class => find(kind, id) is { } stored ? Codec.Deserialize<T>(stored.Payload.GetRawText()) : null;
        RichLyrics? lyrics = record.Kind switch
        {
            "saved-original" or "variant" => Read<RichLyrics>("document", record.Text("hash")),
            "document" or "selected" => Codec.Deserialize<RichLyrics>(record.Payload.GetRawText()),
            _ => null
        };
        if (record.Kind == "variant")
        {
            var variant = Codec.Deserialize<Variant>(record.Payload.GetRawText())!;
            if (lyrics == null) return variant.Text.Values.Select(text => new DataContentLine(text)).ToList();
            return lyrics.Lines.Where(line => variant.Text.ContainsKey(line.Id)).Select(line => new DataContentLine(variant.Text[line.Id], Seconds(line.Start), Seconds(line.End))).ToList();
        }
        if (record.Kind is "boundary-version" or "saved-boundary-entry" or "boundary-review-result")
        {
            var version = record.Kind == "boundary-version" ? Codec.Deserialize<BoundaryVersion>(record.Payload.GetRawText()) : Read<BoundaryVersion>("boundary-version", record.Text("versionId"));
            var transcript = version == null ? null : Read<Transcript>("transcript", version.TranscriptId);
            if (transcript != null && version != null) lyrics = TranscriptBoundaries.Compose(transcript, version.EndTokenIds, transcript.Title, transcript.Artist);
        }
        if (lyrics != null) return lyrics.Lines.Select(line => new DataContentLine(line.Text, Seconds(line.Start), Seconds(line.End))).ToList();
        if (record.Kind == "transcript")
        {
            var transcript = Codec.Deserialize<Transcript>(record.Payload.GetRawText())!;
            var offset = 0; var result = new List<DataContentLine>();
            foreach (var line in transcript.Text.Split('\n'))
            {
                var tokens = transcript.Tokens.Where(t => t.Position >= offset && t.Position < offset + line.Length).ToList();
                result.Add(new(line.TrimEnd('\r'), tokens.Count == 0 ? null : Seconds(tokens[0].Start), tokens.Count == 0 ? null : Seconds(tokens[^1].End)));
                offset += line.Length + 1;
            }
            return result;
        }
        if (record.Kind == "raw" && record.Text("original") is { } original) return original.Split('\n').Select(text => new DataContentLine(text)).ToList();
        return [];
    }
    private static double? Seconds(long? ticks) => ticks.HasValue ? ticks.Value / (double)TimeSpan.TicksPerSecond : null;
}
