using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;

namespace LyricBridge;

public sealed record DataTarget(string Kind, string Id);
public sealed record DataSelection(string Action = "delete", IReadOnlyList<DataTarget>? Targets = null, string? Category = null, Guid? ItemId = null, Guid? UserId = null);
public sealed record DataExecution(string Token, string Confirmation = "", bool Confirmed = false);
public sealed record DataIdentity(Guid Id, string Name, bool Missing);
public sealed record DataPage<T>(IReadOnlyList<T> Items, int Total, int Offset, int Limit);
public sealed record DataEntity(DataIdentity Identity, string Artist, int Records, long PayloadBytes);
public sealed record DataRecordView(DataTarget Target, string Category, string Title, IReadOnlyList<Guid> ItemIds, IReadOnlyList<Guid> UserIds, long PayloadBytes, bool CanDelete, string? Blocker, IReadOnlyList<DataTarget> Dependencies, JsonNode? Data, string? ReadableText = null, string? Source = null, string? StoredAt = null, IReadOnlyList<DataIdentity>? Songs = null, IReadOnlyList<DataIdentity>? Accounts = null, string? DisplayType = null, DataInspection? Inspection = null);
public sealed record DataPreview(string Token, string Confirmation, IReadOnlyList<DataRecordView> Items, string[] Effects, DateTimeOffset Expires);
public sealed record DataOutcome(DataTarget Target, string Status, string? Message = null);
public sealed record DataResult(IReadOnlyList<DataOutcome> Outcomes, bool Complete, string? Phase = null);

/// <summary>Administrator-only inspection and snapshot-confirmed domain operations.</summary>
public sealed partial class DataManagementService(Store store, ManagedLibraryMaintenance maintenance, Generation generation, Discovery discovery,
    LocalPronunciation local, Retrieval retrieval, IAudioPreparation audio, Lazy<Plugin> plugin, ILibraryManager library, IUserManager users)
{
    private sealed record Ticket(Guid Owner, DataSelection Selection, string Confirmation, DateTimeOffset Expires, IReadOnlyList<DataTarget> Targets, string Stamp);
    private readonly Dictionary<string, Ticket> tickets = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim executing = new(1, 1);
    private static readonly HashSet<string> SecretFields = new(StringComparer.OrdinalIgnoreCase) { "apiKey", "api_key", "credential", "credentials", "authorization", "cookie", "token", "access_token", "refresh_token", "password", "secret", "sp_dc", "usertoken", "media-user-token", "x-api-key", "accessToken", "refreshToken", "clientSecret", "client_secret", "bearerToken" };

    private static string Value(JsonElement element, string key) => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";
    private static IEnumerable<string> Hashes(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
            foreach (var property in value.EnumerateObject())
            {
                if (property.Name is "hash" or "donorHash" or "baselineHash" or "outputHash" && property.Value.ValueKind == JsonValueKind.String) yield return property.Value.GetString()!;
                foreach (var hash in Hashes(property.Value)) yield return hash;
            }
        else if (value.ValueKind == JsonValueKind.Array)
            foreach (var child in value.EnumerateArray()) foreach (var hash in Hashes(child)) yield return hash;
    }
    private static string[] RecordHashes(ManagedRecord record) => Hashes(record.Payload).Concat(record.Kind is "document" or "raw" ? [record.Id] : record.Kind == "auxiliary-choice" ? [record.Id.Split(':').ElementAtOrDefault(1) ?? ""] : []).Where(h => h.Length > 0).Distinct().ToArray();

    private sealed class Index
    {
        public IReadOnlyList<ManagedRecord> Records { get; }
        public Dictionary<string, HashSet<Guid>> Songs { get; } = new(StringComparer.Ordinal);
        public Dictionary<string, HashSet<Guid>> Accounts { get; } = new(StringComparer.Ordinal);
        public Index(IReadOnlyList<ManagedRecord> records)
        {
            Records = records;
            var hashes = new Dictionary<string, HashSet<Guid>>(StringComparer.Ordinal);
            var related = records.ToDictionary(r => r.Key, StringComparer.Ordinal);
            foreach (var record in records)
            {
                Songs[record.Key] = record.ItemId is { } item ? [item] : [];
                Accounts[record.Key] = record.UserId is { } user ? [user] : [];
                if (record.ItemId is { } song)
                    foreach (var hash in RecordHashes(record))
                    {
                        if (!hashes.TryGetValue(hash, out var owners)) hashes[hash] = owners = [];
                        owners.Add(song);
                    }
            }
            // Propagate through transcript, request, content, and variant relationships.
            for (var pass = 0; pass < 4; pass++)
                foreach (var record in records)
                {
                    if (record.ItemId == null)
                        foreach (var hash in RecordHashes(record)) if (hashes.TryGetValue(hash, out var owners)) Songs[record.Key].UnionWith(owners);
                    foreach (var (kind, id) in new[] { ("transcript", record.Text("transcriptId")), ("job", record.Text("jobId")), ("variant", record.Kind == "mixed-origin" ? record.Id : record.Text("key")), ("boundary-version", record.Text("versionId")) })
                        if (id != null && related.TryGetValue(kind + ":" + id, out var parent))
                        {
                            if (record.ItemId == null) Songs[record.Key].UnionWith(Songs[parent.Key]);
                            Accounts[record.Key].UnionWith(Accounts[parent.Key]);
                        }
                }
        }
    }
    private Index Read() => new(store.InspectData().Concat(StagingRecords()).ToList());
    private DataIdentity Song(Guid id, Index index)
    {
        var item = library.GetItemById<Audio>(id);
        var name = item?.Name ?? index.Records.Where(r => index.Songs[r.Key].Contains(id)).Select(r => r.Text("title")).FirstOrDefault(t => !string.IsNullOrEmpty(t)) ?? id.ToString("N");
        return new(id, name, item == null);
    }
    private DataIdentity Account(Guid id)
    {
        var user = users.GetUserById(id);
        return new(id, user?.Username ?? id.ToString("N"), user == null);
    }
    private static void PageBounds(int offset, int limit)
    {
        if (offset < 0 || limit is < 1 or > 200) throw new WorkflowException(400, "invalid_pagination", "Choose a nonnegative offset and a page size from 1 to 200.");
    }
    public DataPage<DataEntity> Entities(bool accounts, string? search, string? category, bool missing, int offset, int limit)
    {
        PageBounds(offset, limit); var index = Read(); var groups = accounts ? index.Accounts : index.Songs;
        var items = groups.Values.SelectMany(ids => ids).Distinct().Select(id =>
        {
            var records = index.Records.Where(r => groups[r.Key].Contains(id) && (category == null || ManagedDataKinds.Category(r.Kind) == category)).ToList();
            var identity = accounts ? Account(id) : Song(id, index);
            return new DataEntity(identity, records.Select(r => r.Text("artist")).FirstOrDefault(t => t != null) ?? "", records.Count, records.Sum(Size));
        }).Where(e => e.Records > 0 && (!missing || e.Identity.Missing) && (string.IsNullOrEmpty(search) || (e.Identity.Name + " " + e.Artist + " " + e.Identity.Id).Contains(search, StringComparison.OrdinalIgnoreCase)))
            .OrderBy(e => e.Identity.Name, StringComparer.OrdinalIgnoreCase).ThenBy(e => e.Identity.Id).ToList();
        return new(items.Skip(offset).Take(limit).ToList(), items.Count, offset, limit);
    }
    private static long Size(ManagedRecord record) => Encoding.UTF8.GetByteCount(record.Payload.GetRawText());
    private static long FileBytes(string path) => File.Exists(path) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) == 0 ? new FileInfo(path).Length : 0;
    public object Overview()
    {
        var index = Read(); var active = store.ActiveStoragePath;
        var configured = string.IsNullOrWhiteSpace(plugin.Value.Configuration.StoragePath) ? plugin.Value.DataDirectory : plugin.Value.Configuration.StoragePath;
        return new
        {
            activeStoragePath = active,
            configuredStoragePath = configured,
            restartRequired = Path.GetFullPath(configured) != Path.GetFullPath(active),
            databaseBytes = FileBytes(Path.Combine(active, "index.sqlite")),
            walBytes = FileBytes(Path.Combine(active, "index.sqlite-wal")),
            audioBytes = Staging().Sum(r => r.Bytes),
            categories = index.Records.GroupBy(r => r.Kind == "audio-staging" ? "audio" : ManagedDataKinds.Category(r.Kind)).OrderBy(g => g.Key).Select(g => new { name = g.Key, count = g.Count(), payloadBytes = g.Sum(Size) }).ToList(),
            bookkeeping = store.InspectBookkeeping(),
            retention = "Temporary previews: 24 hours since use. Finished requests: 30 days. Failed review checkpoints and unused audio: 7 days. Cleanup runs at startup and daily. Missing-lyric entries expire after 10 minutes."
        };
    }
    public object Configuration()
    {
        var config = JsonSerializer.SerializeToNode(plugin.Value.Configuration, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
        return Clean(config)!;
    }
    private string[] Secrets()
    {
        var config = plugin.Value.Configuration;
        return config.Sources.Select(s => s.Credential).Concat(config.Services.Select(s => s.ApiKey))
            .Concat(config.ServiceSetup.Connections.Select(c => c.ApiKey)).Concat([config.Transcription.ApiKey, config.Transcription.Review.ApiKey])
            .Where(s => !string.IsNullOrEmpty(s)).Distinct().ToArray();
    }
    private JsonNode? Clean(JsonNode? node)
    {
        var secrets = Secrets();
        JsonNode? Scrub(JsonNode? value)
        {
            if (value is JsonObject obj)
            {
                var result = new JsonObject();
                foreach (var (key, child) in obj)
                {
                    if (SecretFields.Contains(key)) { result[key + "Present"] = child is JsonValue v && v.TryGetValue<string>(out var secret) && !string.IsNullOrEmpty(secret); continue; }
                    if (key.Equals("rawResponses", StringComparison.OrdinalIgnoreCase) && child is JsonArray responses)
                    {
                        result[key] = new JsonArray(responses.Select(response =>
                        {
                            try { return Scrub(JsonNode.Parse(response?.GetValue<string>() ?? "")); }
                            catch (JsonException) { return JsonValue.Create("Opaque provider response omitted."); }
                        }).ToArray());
                        continue;
                    }
                    if (key.Equals("rawResponse", StringComparison.OrdinalIgnoreCase) && child is JsonValue raw && raw.TryGetValue<string>(out var response))
                    {
                        try { result[key] = Scrub(JsonNode.Parse(response)); }
                        catch (JsonException) { result[key] = "Opaque response omitted; normalized lyric text is shown separately."; }
                        continue;
                    }
                    result[key] = Scrub(child);
                }
                return result;
            }
            if (value is JsonArray array) return new JsonArray(array.Select(Scrub).ToArray());
            if (value is JsonValue text && text.TryGetValue<string>(out var content))
            {
                foreach (var secret in secrets) content = content.Replace(secret, "[redacted]", StringComparison.Ordinal);
                if (Uri.TryCreate(content, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https") content = new UriBuilder(uri) { UserName = "", Password = "", Query = "", Fragment = "" }.Uri.GetLeftPart(UriPartial.Path);
                return JsonValue.Create(content);
            }
            return value?.DeepClone();
        }
        return Scrub(node);
    }
    private (string? Reason, IReadOnlyList<DataTarget> Dependencies) Capability(ManagedRecord record, Index index)
    {
        if (record.Kind == "saved-original") return (null, []);
        if (record.Kind == "variant") return record.Text("service") == "Kawazu" ? ("Automatic local pronunciation: disable it in Display settings instead.", []) : (null, []);
        if (record.Kind is "transcript" or "saved-boundary-entry")
        {
            if (record.Kind == "saved-boundary-entry" && store.Transcript(record.Text("transcriptId") ?? "") == null)
                return ("The owning transcript is missing. Use the managed-library reset to remove orphaned review bookkeeping.", []);
            var transcript = record.Kind == "transcript" ? record.Id : record.Text("transcriptId")!;
            var capability = store.Deletion(transcript, record.Kind == "transcript" ? null : record.Id, Guid.Empty, true);
            return (capability.Reason, capability.Originals.Select(o => new DataTarget("saved-original", o.ItemId.ToString("N") + ":" + o.OutputHash))
                .Concat(capability.Requests.Select(id => new DataTarget("job", id))).ToList());
        }
        if (record.Kind == "job-admission") return DateTimeOffset.TryParse(record.Text("created"), out var admitted) && admitted <= DateTimeOffset.UtcNow.AddDays(-1)
            ? (null, []) : ("Rolling 24-hour quota accounting is retained until its window expires.", []);
        if (record.Kind == "job") return JobLifecycle.Terminal(record.Text("state") ?? "") ? (null, []) : ("Cancel or finish this request in Requests before removing its history.", []);
        if (record.Kind == "audio-staging") return AudioCapability(record.Id);
        if (record.Kind is "document" or "raw" && store.IsDocumentRetained(record.Id))
            return ("Referenced or explicitly retained content. Delete its owning saved originals or versions first.", index.Records.Where(r => r.Kind is "saved-original" or "variant" && RecordHashes(r).Contains(record.Id)).Select(r => new DataTarget(r.Kind, r.Id)).ToList());
        if (record.Kind is "review-checkpoint" or "transcript-chunk")
        {
            var job = store.GetJob(record.Text("jobId") ?? "");
            if (job != null && (!JobLifecycle.Terminal(job.State) || job.State is "failed" or "settings_changed" && (job.TerminalAt == null || job.TerminalAt > DateTimeOffset.UtcNow.AddDays(-7))))
                return ("Required by active work or the seven-day retry window. Remove finished request history first.", [new("job", job.Id)]);
        }
        return ManagedDataKinds.DirectlyDeletable(record.Kind) ? (null, []) : ("Managed by its owning record or reset workflow; inspect the related records below.", []);
    }
    private string? Readable(ManagedRecord record)
    {
        RichLyrics? lyrics = null;
        if (record.Kind == "saved-original") lyrics = store.GetDocument(record.Text("hash") ?? "");
        else if (record.Kind is "selected" or "document") lyrics = Codec.Deserialize<RichLyrics>(record.Payload.GetRawText());
        else if (record.Kind == "variant")
        {
            var variant = Codec.Deserialize<Variant>(record.Payload.GetRawText())!;
            var document = store.GetDocument(variant.Hash);
            return string.Join("\n", document != null ? document.Lines.Where(l => variant.Text.ContainsKey(l.Id)).Select(l => variant.Text[l.Id]) : variant.Text.Values);
        }
        else if (record.Kind is "saved-boundary-entry" or "boundary-version")
        {
            var version = record.Kind == "boundary-version" ? Codec.Deserialize<BoundaryVersion>(record.Payload.GetRawText()) : store.Get<BoundaryVersion>("boundary-version", record.Text("versionId") ?? "");
            var transcript = version == null ? null : store.Transcript(version.TranscriptId);
            if (version != null && transcript != null) lyrics = TranscriptBoundaries.Compose(transcript, version.EndTokenIds, transcript.Title, transcript.Artist);
        }
        return lyrics == null ? record.Text("text") ?? record.Text("original") : string.Join("\n", lyrics.Lines.Select(l => l.Text));
    }
    private DataRecordView View(ManagedRecord record, Index index, bool details, bool reset = false)
    {
        (string? Reason, IReadOnlyList<DataTarget> Dependencies) capability = reset ? (null, []) : Capability(record, index);
        var title = record.Text("title") ?? record.Text("optionName") ?? record.Text("language");
        if (title == null && record.Kind == "saved-original") title = index.Records.FirstOrDefault(r => r.Kind == "document" && r.Id == record.Text("hash"))?.Text("title");
        string? SafeSummary(string? text) => text == null ? null : Clean(JsonValue.Create(text))?.GetValue<string>();
        var date = record.Text("savedAt") ?? record.Text("createdAt") ?? record.Text("created") ?? record.Text("modified");
        return new(new(record.Kind, record.Id), (record.Kind == "audio-staging" ? "audio" : ManagedDataKinds.Category(record.Kind)), SafeSummary(title) ?? ManagedDataKinds.Label(record.Kind),
            index.Songs.GetValueOrDefault(record.Key, []).Order().ToList(), index.Accounts.GetValueOrDefault(record.Key, []).Concat(record.Kind == "variant" ? index.Records.Where(r => r.Kind == "auxiliary-choice" && r.Text("key") == record.Id).Select(r => r.UserId).OfType<Guid>() : []).Distinct().Order().ToList(), Size(record), capability.Reason == null, capability.Reason, capability.Dependencies,
            details ? Clean(JsonNode.Parse(record.Payload.GetRawText())) : null, details ? Clean(JsonValue.Create(Readable(record)))?.GetValue<string>() : null,
            SafeSummary(record.Text("source") ?? record.Text("provider")), DateTimeOffset.TryParse(date, out _) ? date : null,
            index.Songs.GetValueOrDefault(record.Key, []).Order().Select(id => Song(id, index)).ToList(),
            index.Accounts.GetValueOrDefault(record.Key, []).Order().Select(Account).ToList(), ManagedDataKinds.Label(record.Kind), details ? Inspect(record, index, capability.Reason) : null);
    }
    public DataPage<DataRecordView> Records(string? category, Guid? itemId, Guid? userId, int offset, int limit)
    {
        PageBounds(offset, limit); var index = Read();
        var records = index.Records.Where(r => (category == null || (r.Kind == "audio-staging" ? category == "audio" : ManagedDataKinds.Category(r.Kind) == category))
            && (itemId == null || index.Songs.GetValueOrDefault(r.Key, r.ItemId is { } item ? [item] : []).Contains(itemId.Value))
            && (userId == null || index.Accounts.GetValueOrDefault(r.Key, r.UserId is { } user ? [user] : []).Contains(userId.Value))).OrderBy(r => r.Key, StringComparer.Ordinal).ToList();
        return new(records.Skip(offset).Take(limit).Select(r => View(r, index, false)).ToList(), records.Count, offset, limit);
    }
    public object CancelRequest(string id)
    {
        var job = store.GetJob(id) ?? throw new WorkflowException(404, "job_missing", "This request is no longer stored.");
        if (JobLifecycle.Terminal(job.State)) throw new WorkflowException(409, "job_finished", "This request has already finished.");
        return generation.Action(id, "cancel", Guid.Empty, true);
    }
    public DataRecordView Detail(DataTarget target)
    {
        var index = Read(); var record = index.Records.FirstOrDefault(r => r.Kind == target.Kind && r.Id == target.Id)
            ?? throw new WorkflowException(404, "data_missing", "This stored record is no longer available.");
        return View(record, index, true);
    }

    private sealed record Stage(string Id, long Bytes, DateTime Modified, string Stamp, Guid? ItemId, Guid? UserId);
    private IReadOnlyList<Stage> Staging()
    {
        var root = Path.Combine(store.ActiveStoragePath, "audio-staging");
        if (!Directory.Exists(root) || (File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0) return [];
        var result = new List<Stage>();
        foreach (var dir in Directory.EnumerateDirectories(root).Order(StringComparer.Ordinal))
        {
            var id = Path.GetFileName(dir);
            if (!Guid.TryParseExact(id, "N", out _) || (File.GetAttributes(dir) & FileAttributes.ReparsePoint) != 0) continue;
            var files = Directory.EnumerateFiles(dir).Where(p => AudioPreparation.OwnsStagingFile(Path.GetFileName(p)) && (File.GetAttributes(p) & FileAttributes.ReparsePoint) == 0).Select(p => new FileInfo(p)).ToList();
            if (files.Count == 0) continue;
            var manifest = files.FirstOrDefault(f => f.Name == "upload.json"); AudioUpload? upload = null;
            if (manifest != null)
            {
                try { upload = Codec.Deserialize<AudioUpload>(File.ReadAllText(manifest.FullName)); }
                catch (Exception e) when (e is IOException or JsonException) { }
            }
            var job = store.GetJob(id);
            result.Add(new(id, files.Sum(f => f.Length), Directory.GetLastWriteTimeUtc(dir), Codec.Hash(string.Join("|", files.OrderBy(f => f.Name).Select(f => f.Name + ":" + f.Length + ":" + f.LastWriteTimeUtc.Ticks))), upload?.ItemId ?? job?.ItemId, upload?.UserId ?? job?.UserId));
        }
        return result;
    }
    private IEnumerable<ManagedRecord> StagingRecords() => Staging().Select(s => new ManagedRecord("audio-staging", s.Id, JsonSerializer.SerializeToElement(new { s.ItemId, s.UserId, s.Bytes, s.Modified, s.Stamp }, Codec.Json)));
    private (string? Reason, IReadOnlyList<DataTarget> Dependencies) AudioCapability(string id)
    {
        if (audio is AudioPreparation preparation && preparation.IsUploading(id)) return ("This audio upload is still in progress.", []);
        var jobs = store.InspectData().Where(r => r.Kind == "job").Select(r => Codec.Deserialize<Job>(r.Payload.GetRawText())!).Where(j => j.Id == id || j.Audio?.UploadId == id).ToList();
        var protectedJobs = jobs.Where(j => !JobLifecycle.Terminal(j.State) || j.State is "failed" or "settings_changed" && (j.TerminalAt == null || j.TerminalAt > DateTimeOffset.UtcNow.AddDays(-7))).ToList();
        return protectedJobs.Count > 0 ? ("Required by active work or the seven-day retry window.", protectedJobs.Select(j => new DataTarget("job", j.Id)).ToList()) : (null, []);
    }
    private string Stamp(Index index, IReadOnlyList<DataTarget> targets, bool all)
    {
        var keys = targets.Select(t => t.Kind + ":" + t.Id).ToHashSet(StringComparer.Ordinal);
        var selected = index.Records.Where(r => keys.Contains(r.Key)).ToList();
        var songs = selected.SelectMany(r => index.Songs[r.Key]).ToHashSet();
        var hashes = selected.SelectMany(RecordHashes).ToHashSet(StringComparer.Ordinal);
        var records = index.Records.Where(r => all || keys.Contains(r.Key) || index.Songs[r.Key].Overlaps(songs) || RecordHashes(r).Any(hashes.Contains));
        static string Fingerprint(ManagedRecord record)
        {
            if (record.Kind != "job") return record.Payload.GetRawText();
            var job = JsonNode.Parse(record.Payload.GetRawText())!.AsObject();
            job.Remove("progress"); job.Remove("stage");
            return job.ToJsonString();
        }
        return Codec.Hash(string.Join("\n", records.Select(r => r.Key + ":" + Fingerprint(r))) + "\n" + Codec.Serialize(Staging()) + (all ? Codec.Serialize(plugin.Value.Configuration) : ""));
    }
    private static bool IsReset(string action) => action is "library-reset" or "preferences-reset" or "factory-reset";
    public DataPreview Preview(Guid owner, DataSelection selection)
    {
        if (selection.Action is not ("delete" or "category" or "song-content" or "expired" or "unused" or "library-reset" or "preferences-reset" or "factory-reset")) throw new WorkflowException(400, "invalid_action", "Choose a supported data action.");
        if (selection.Targets?.Count > 10000) throw new WorkflowException(400, "too_many_targets", "Choose at most 10,000 records per action.");
        var index = Read(); var records = index.Records.ToList();
        var temporary = store.TemporaryKeys(selection.Action == "expired");
        IEnumerable<ManagedRecord> candidates = selection.Action switch
        {
            "delete" => records.Where(r => selection.Targets?.Contains(new(r.Kind, r.Id)) == true),
            "category" => !string.IsNullOrEmpty(selection.Category) ? records.Where(r => (r.Kind == "audio-staging" ? "audio" : ManagedDataKinds.Category(r.Kind)) == selection.Category) : throw new WorkflowException(400, "category_required", "Choose a data category."),
            "song-content" => selection.ItemId != null ? records.Where(r => (r.ItemId == selection.ItemId || index.Songs.GetValueOrDefault(r.Key, []).Contains(selection.ItemId.Value)) && r.Kind is "saved-original" or "transcript" or "saved-boundary-entry" or "audio-staging" or "preview" or "preview-assessment" or "better") : throw new WorkflowException(400, "song_required", "Choose a song."),
            "preferences-reset" => records.Where(r => r.Kind is "preferences" or "song-preferences" or "auxiliary-choice" or "pronunciation-choice" && (selection.UserId == null || r.UserId == selection.UserId)),
            "library-reset" => records.Where(r => r.Kind is not ("preferences" or "song-preferences")),
            "factory-reset" => records,
            "unused" => records.Where(r => temporary.Contains(r.Key) || r.Kind == "audio-staging"),
            "expired" => records.Where(r => r.Kind == "job-admission" && DateTimeOffset.TryParse(r.Text("created"), out var created) && created <= DateTimeOffset.UtcNow.AddDays(-1)
                || r.Kind is "review-checkpoint" or "transcript-chunk" && Capability(r, index).Reason == null
                || temporary.Contains(r.Key) || r.Kind == "job" && DateTimeOffset.TryParse(r.Text("terminalAt"), out var terminal) && terminal <= DateTimeOffset.UtcNow.AddDays(-30) || r.Kind == "audio-staging" && DateTimeOffset.TryParse(r.Text("modified"), out var modified) && modified <= DateTimeOffset.UtcNow.AddDays(-7)),
            _ => []
        };
        var chosen = candidates.DistinctBy(r => r.Key).ToList();
        if (chosen.Count > 10000 && !IsReset(selection.Action)) throw new WorkflowException(400, "too_many_targets", "Narrow this action to at most 10,000 records.");
        if (selection.Action == "delete" && (selection.Targets == null || selection.Targets.Count == 0 || chosen.Count != selection.Targets.Distinct().Count()))
            throw new WorkflowException(409, "data_missing", "Some selected records are no longer stored. Refresh before previewing deletion.", true);
        var targets = chosen.Select(r => new DataTarget(r.Kind, r.Id)).ToList();
        var confirmation = selection.Action == "factory-reset" ? "FACTORY RESET" : IsReset(selection.Action) ? "RESET" : selection.Action == "category" ? "DELETE" : "";
        var effects = new List<string> { "Only the previewed records are targeted. Changed records require a new preview. Blocked records are skipped." };
        if (chosen.Any(r => r.Kind == "saved-original")) effects.Add("Deleting a selected original selects its newest surviving version. Deleting the last original suppresses automatic retrieval. Shared content is retained while required.");
        if (chosen.Any(r => r.Kind == "variant")) effects.Add("Deleting a shared language version removes it for every listed song/account and clears choices that select it.");
        if (chosen.Any(r => r.Kind == "job")) effects.Add("Removing finished history ends retry availability and does not restore request quota. Independently saved results remain.");
        if (IsReset(selection.Action)) effects.Add(selection.Action == "factory-reset" ? "Clears all plugin data, settings and credentials. Keeps the active storage directory. Default provider settings can retrieve lyrics again." : selection.Action == "library-reset" ? "Stops work and clears the managed library. Settings, credentials and account/song preferences remain. Automatic retrieval can refill storage." : "Resets the previewed account/song preferences and auxiliary choices to inherited defaults.");
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)); var expires = DateTimeOffset.UtcNow.AddMinutes(10);
        lock (tickets)
        {
            foreach (var key in tickets.Where(t => t.Value.Expires <= DateTimeOffset.UtcNow).Select(t => t.Key).ToList()) tickets.Remove(key);
            if (tickets.Count >= 64) throw new WorkflowException(429, "preview_limit", "Too many pending deletion previews. Retry after they expire.");
            tickets[token] = new(owner, selection, confirmation, expires, targets, Stamp(index, targets, IsReset(selection.Action)));
        }
        return new(token, confirmation, chosen.Select(r => View(r, index, false, selection.Action is "factory-reset" or "library-reset")).ToList(), effects.ToArray(), expires);
    }

    public async Task<DataResult> Execute(Guid owner, DataExecution input)
    {
        Ticket ticket;
        lock (tickets)
        {
            if (!tickets.TryGetValue(input.Token, out ticket!) || ticket.Owner != owner || ticket.Expires <= DateTimeOffset.UtcNow) throw new WorkflowException(409, "preview_expired", "Preview this action again before confirming.", true);
            if (!input.Confirmed || input.Confirmation != ticket.Confirmation) throw new WorkflowException(400, "confirmation_required", "Confirm the preview and enter its confirmation phrase.");
        }
        if (!await executing.WaitAsync(0)) throw new WorkflowException(409, "maintenance_busy", "Another data action is running. Try again when it finishes.", true);
        var notifications = new List<Action>();
        try
        {
            lock (tickets) { if (!tickets.Remove(input.Token)) throw new WorkflowException(409, "preview_expired", "This confirmation has already been used."); }
            if (ticket.Selection.Action is "factory-reset" or "library-reset") return await Reset(ticket);
            var outcomes = store.WithDataWriteLock(() =>
            {
                var index = Read();
                if (Stamp(index, ticket.Targets, IsReset(ticket.Selection.Action)) != ticket.Stamp) throw new WorkflowException(409, "data_changed", "Stored data or dependencies changed. Preview the action again.", true);
                var result = new List<DataOutcome>();
                foreach (var target in ticket.Targets.OrderBy(t => t.Kind == "saved-original" ? 0 : t.Kind == "job" ? 1 : t.Kind == "transcript" ? 2 : 3))
                {
                    var current = Read(); var record = current.Records.FirstOrDefault(r => r.Kind == target.Kind && r.Id == target.Id);
                    if (record == null) { result.Add(new(target, "skipped", "Already removed by a preceding deletion.")); continue; }
                    var capability = Capability(record, current);
                    if (capability.Reason != null) { result.Add(new(target, "skipped", capability.Reason)); continue; }
                    try { Delete(record, notifications); result.Add(new(target, "deleted")); }
                    catch (WorkflowException error) { result.Add(new(target, "skipped", error.Message)); }
                    catch (Exception error) when (error is not OutOfMemoryException) { result.Add(new(target, "failed", "Deletion or filesystem cleanup failed. Refresh to inspect remaining data and preview a retry.")); }
                }
                return result;
            });
            foreach (var notify in notifications)
                try { notify(); }
                catch (Exception error) when (error is not OutOfMemoryException)
                { outcomes.Add(new(new("cleanup", "post-deletion"), "failed", "Records were deleted, but worker or audio cleanup failed. Refresh and retry cleanup.")); }
            retrieval.ClearMissingCache();
            return new(outcomes, outcomes.All(o => o.Status != "failed"));
        }
        finally { executing.Release(); }
    }
    private void Delete(ManagedRecord record, List<Action> notifications)
    {
        using var operation = store.Operation(store.FreshAdmission(record.ItemId));
        switch (record.Kind)
        {
            case "saved-original":
                var original = Codec.Deserialize<SavedOriginal>(record.Payload.GetRawText())!;
                var removed = store.DeleteOriginal(original.ItemId, original.Hash, original.Revision);
                notifications.Add(() => maintenance.NotifyOriginalDeletion(original.ItemId, removed)); break;
            case "variant":
                var variant = Codec.Deserialize<Variant>(record.Payload.GetRawText())!;
                if (!store.DeleteVariant(variant.Key, variant.Hash, variant.Kind)) throw new WorkflowException(409, "data_changed", "This version changed. Refresh and retry.");
                notifications.Add(() => generation.CancelDeleted(store.InspectData().Where(r => r.Kind == "job" && r.Text("variantKey") == variant.Key && r.Payload.TryGetProperty("outputDeleted", out var deleted) && deleted.ValueKind == JsonValueKind.True).Select(r => r.Id).ToList())); break;
            case "transcript":
                var cancelled = store.DeleteTranscript(record.ItemId!.Value, record.Id, Guid.Empty, true);
                notifications.Add(() => generation.CancelDeleted(cancelled)); break;
            case "saved-boundary-entry":
                var transcript = store.Transcript(record.Text("transcriptId")!)!;
                store.DeleteEntry(transcript.ItemId, transcript.Id, record.Id, Guid.Empty, true); break;
            case "job-admission":
                if (!store.DeleteExpiredAdmission(record.Id)) throw new WorkflowException(409, "accounting_active", "This quota entry is still active.");
                break;
            case "job":
                var jobs = store.RemoveFinishedJobs([record.Id]);
                foreach (var job in jobs.Where(j => j.TaskKind != "language")) notifications.Add(() => audio.Release(job)); break;
            case "audio-staging":
                if (audio is not AudioPreparation preparation) throw new WorkflowException(409, "audio_unavailable", "Audio staging maintenance is unavailable.");
                preparation.DeleteUnused(record.Id); break;
            default:
                store.DeleteManagedRecord(record.Kind, record.Id);
                if (record.ItemId is { } item) notifications.Add(() => discovery.InvalidateDeleted(item, store.FreshAdmission(item).Revision));
                break;
        }
    }
    private async Task<DataResult> Reset(Ticket ticket)
    {
        var outcomes = new List<DataOutcome>(); var phase = "admission"; var begun = false;
        plugin.Value.BeginDataMaintenance();
        try
        {
            store.WithDataWriteLock(() =>
            {
                if (Stamp(Read(), ticket.Targets, true) != ticket.Stamp) throw new WorkflowException(409, "data_changed", "Stored data or configuration changed. Preview the reset again.", true);
                begun = store.BeginReset(); return begun;
            });
            phase = "stopping work";
            await discovery.StopAll(); await generation.StopAll(); await local.StopAll();
            store.CancelResetJobs();
            phase = "audio staging"; await audio.StopUploads(); audio.Clear();
            if (ticket.Selection.Action == "factory-reset")
            {
                phase = "configuration"; plugin.Value.ResetDataConfiguration(store.ActiveStoragePath);
                phase = "preferences"; store.ResetAllPreferences();
            }
            phase = "managed library"; store.ResetManagedLibrary(factory: ticket.Selection.Action == "factory-reset"); retrieval.ClearMissingCache();
            outcomes.AddRange(ticket.Targets.Select(t => new DataOutcome(t, "deleted")));
            return new(outcomes, true);
        }
        catch (WorkflowException) when (!begun) { throw; }
        catch (Exception error) when (error is not OutOfMemoryException)
        {
            return new([new(new("reset", ticket.Selection.Action), "failed", "Reset stopped during " + phase + ". Earlier phases may have completed. Refresh to inspect the remaining data and retry the reset.")], false, phase);
        }
        finally { if (begun) store.EndReset(); plugin.Value.EndDataMaintenance(); }
    }
}
