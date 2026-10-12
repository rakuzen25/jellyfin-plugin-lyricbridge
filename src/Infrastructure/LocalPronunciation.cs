using System.Collections.Concurrent;
using System.Threading.Channels;
using Kawazu;
using Microsoft.Extensions.Hosting;
namespace LyricBridge;

public sealed class LocalPronunciation(Store store) : BackgroundService
{
    private readonly Func<string, RomajiSystem, Task<string>>? conversion;
    public LocalPronunciation(Store store, Func<string, RomajiSystem, Task<string>> conversion) : this(store) => this.conversion = conversion;
    private sealed class LocalWork(string hash, StoreAdmission admission)
    {
        public string Hash { get; } = hash;
        public StoreAdmission Admission { get; } = admission;
        public LocalState State = new("queued");
    }
    private readonly Channel<(string Key, RichLyrics Lyrics, Preferences Preferences, bool IncludeSupplied, LocalWork Work)> queue = Channel.CreateBounded<(string, RichLyrics, Preferences, bool, LocalWork)>(new BoundedChannelOptions(32) { FullMode = BoundedChannelFullMode.Wait, SingleReader = true });
    private readonly ConcurrentDictionary<string, LocalWork> states = new();
    public static string Key(RichLyrics lyrics, Preferences p, bool includeSupplied = false)
    {
        var key = Codec.Hash(Codec.Serialize(new { lyrics.Hash, p.SourceLanguage, p.RomanizationSystem, Converter = "Kawazu-1.1.4", Dictionary = "IpaDic-0.10.0", Kind = "local-romaji" }));
        return includeSupplied ? Codec.Hash(Codec.Serialize(new { Base = key, Scope = "all-japanese-rows" })) : key;
    }
    public LocalState Ensure(RichLyrics lyrics, Preferences p, bool includeSupplied = false)
    {
        var ticket = store.Admit();
        if (!store.IsAdmitted(ticket, lyrics.Hash)) return new("unavailable"); var key = Key(lyrics, p, includeSupplied); if (store.Get<Variant>("variant", key) != null) return new("complete");
        if ((!includeSupplied && (!p.ShowPronunciation || !p.JapaneseRomaji)) || !Lines(lyrics).Any(l => (includeSupplied || string.IsNullOrWhiteSpace(l.Pronunciation)) && (p.SourceLanguage == "ja" || (p.SourceLanguage == "auto" && l.Language == "ja")))) return new("unavailable");
        using var operation = store.Operation(ticket);
        store.SaveDocument(lyrics);
        if (states.TryGetValue(key, out var old)) return Volatile.Read(ref old.State);
        var work = new LocalWork(lyrics.Hash, ticket);
        if (states.TryAdd(key, work))
        {
            if (queue.Writer.TryWrite((key, lyrics, Codec.Deserialize<Preferences>(Codec.Serialize(p))!, includeSupplied, work))) return new("queued");
            states.TryRemove(new KeyValuePair<string, LocalWork>(key, work));
        }
        return states.TryGetValue(key, out var admitted) ? Volatile.Read(ref admitted.State) : new("busy", "Local pronunciation queue is busy; retry shortly.");
    }
    public LocalState Status(RichLyrics lyrics, Preferences p, bool includeSupplied = false)
    {
        var key = Key(lyrics, p, includeSupplied);
        return store.Get<Variant>("variant", key) != null ? new("complete") : states.TryGetValue(key, out var work) ? Volatile.Read(ref work.State) : new("unavailable");
    }
    public static IEnumerable<LyricLine> Lines(RichLyrics lyrics) => lyrics.Lines.SelectMany(l => l.Background == null ? new[] { l } : new[] { l, l.Background });
    public void InvalidateDeleted(string hash)
    {
        // A retained shared document can still serve another song. Persisted fences
        // reject queued/in-flight output only when its content was actually deleted.
        if (store.GetDocument(hash) is not null) return;
        foreach (var pair in states.Where(p => p.Value.Hash == hash)) states.TryRemove(pair);
    }
    public async Task StopAll()
    {
        while (queue.Reader.TryRead(out var pending)) states.TryRemove(new KeyValuePair<string, LocalWork>(pending.Key, pending.Work));
        while (activeHash != null) await Task.Delay(25);
        states.Clear();
    }
    private volatile string? activeHash;
    public void Retry(RichLyrics lyrics, Preferences p, bool includeSupplied = false) => states.TryRemove(Key(lyrics, p, includeSupplied), out _);
    protected override async Task ExecuteAsync(CancellationToken token)
    {
        KawazuConverter? converter = null;
        await foreach (var work in queue.Reader.ReadAllAsync(token))
        {
            if (!store.IsAdmitted(work.Work.Admission, work.Lyrics.Hash) || !states.TryGetValue(work.Key, out var admitted) || !ReferenceEquals(admitted, work.Work)) { states.TryRemove(new KeyValuePair<string, LocalWork>(work.Key, work.Work)); continue; }
            using var operation = store.Operation(work.Work.Admission);
            activeHash = work.Lyrics.Hash;
            try
            {
                Volatile.Write(ref work.Work.State, new("running"));
                if (conversion is null) converter ??= new KawazuConverter(Path.Combine(Path.GetDirectoryName(typeof(LocalPronunciation).Assembly.Location)!, "KawazuDictionary"));
                var system = Enum.Parse<RomajiSystem>(work.Preferences.RomanizationSystem);
                var text = new Dictionary<string, string>();
                foreach (var line in Lines(work.Lyrics))
                {
                    token.ThrowIfCancellationRequested();
                    if (!store.IsAdmitted(work.Work.Admission, work.Lyrics.Hash)) break;
                    if ((!work.IncludeSupplied && !string.IsNullOrWhiteSpace(line.Pronunciation)) || (work.Preferences.SourceLanguage != "ja" && !(work.Preferences.SourceLanguage == "auto" && line.Language == "ja"))) continue;
                    text[line.Id] = conversion is not null ? await conversion(line.Text, system) : await converter!.Convert(line.Text, To.Romaji, Mode.Spaced, system);
                }
                store.SaveLocalVariant(new Variant(work.Key, work.Lyrics.Hash, "pronunciation", "ja", "Kawazu", "1.1.4/" + work.Preferences.RomanizationSystem, text, CreatedAt: DateTime.UtcNow, OriginType: "local", Profile: new("Kawazu", Codec.Hash("local:Kawazu-1.1.4/IpaDic-0.10.0"), "1.1.4/" + work.Preferences.RomanizationSystem, "pronunciation", "ja", work.Preferences.SourceLanguage, work.IncludeSupplied ? "all-japanese-rows" : "fill-missing", 0, 0, 1)), work.Work.Admission.Epoch); states.TryRemove(new KeyValuePair<string, LocalWork>(work.Key, work.Work));
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
            catch { if (store.IsAdmitted(work.Work.Admission, work.Lyrics.Hash)) Volatile.Write(ref work.Work.State, new("failed", "Local romaji could not be prepared. Retry or choose another pronunciation service.")); }
            finally { activeHash = null; }
        }
    }
}
