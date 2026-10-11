using System.Collections.Concurrent;
using System.Threading.Channels;
using Kawazu;
using Microsoft.Extensions.Hosting;
namespace LyricBridge;

public sealed class LocalPronunciation(Store store) : BackgroundService
{
    private readonly Func<string, RomajiSystem, Task<string>>? conversion;
    public LocalPronunciation(Store store, Func<string, RomajiSystem, Task<string>> conversion) : this(store) => this.conversion = conversion;
    private readonly Channel<(string Key, RichLyrics Lyrics, Preferences Preferences, bool IncludeSupplied, long Epoch)> queue = Channel.CreateBounded<(string, RichLyrics, Preferences, bool, long)>(new BoundedChannelOptions(32) { FullMode = BoundedChannelFullMode.Wait, SingleReader = true });
    private readonly ConcurrentDictionary<string, LocalState> states = new();
    public static string Key(RichLyrics lyrics, Preferences p, bool includeSupplied = false)
    {
        var key = Codec.Hash(Codec.Serialize(new { lyrics.Hash, p.SourceLanguage, p.RomanizationSystem, Converter = "Kawazu-1.1.4", Dictionary = "IpaDic-0.10.0", Kind = "local-romaji" }));
        return includeSupplied ? Codec.Hash(Codec.Serialize(new { Base = key, Scope = "all-japanese-rows" })) : key;
    }
    public LocalState Ensure(RichLyrics lyrics, Preferences p, bool includeSupplied = false)
    {
        var admittedEpoch = store.Epoch;
        if (store.IsResetting) return new("unavailable"); var key = Key(lyrics, p, includeSupplied); if (store.Get<Variant>("variant", key) != null) return new("complete");
        if ((!includeSupplied && (!p.ShowPronunciation || !p.JapaneseRomaji)) || !Lines(lyrics).Any(l => (includeSupplied || string.IsNullOrWhiteSpace(l.Pronunciation)) && (p.SourceLanguage == "ja" || (p.SourceLanguage == "auto" && l.Language == "ja")))) return new("unavailable");
        if (states.TryGetValue(key, out var old)) return old;
        if (states.TryAdd(key, new("queued")) && !queue.Writer.TryWrite((key, lyrics, Codec.Deserialize<Preferences>(Codec.Serialize(p))!, includeSupplied, admittedEpoch))) states.TryRemove(key, out _);
        return states.GetValueOrDefault(key) ?? new("busy", "Local pronunciation queue is busy; retry shortly.");
    }
    public LocalState Status(RichLyrics lyrics, Preferences p, bool includeSupplied = false)
    {
        var key = Key(lyrics, p, includeSupplied);
        return store.Get<Variant>("variant", key) != null ? new("complete") : states.GetValueOrDefault(key) ?? new("unavailable");
    }
    public static IEnumerable<LyricLine> Lines(RichLyrics lyrics) => lyrics.Lines.SelectMany(l => l.Background == null ? new[] { l } : new[] { l, l.Background });
    public async Task StopAll()
    {
        while (queue.Reader.TryRead(out var pending)) states.TryRemove(pending.Key, out _);
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
            if (work.Epoch != store.Epoch || store.IsResetting) { states.TryRemove(work.Key, out _); continue; }
            activeHash = work.Lyrics.Hash;
            try
            {
                states[work.Key] = new("running");
                if (conversion is null) converter ??= new KawazuConverter(Path.Combine(Path.GetDirectoryName(typeof(LocalPronunciation).Assembly.Location)!, "KawazuDictionary"));
                var system = Enum.Parse<RomajiSystem>(work.Preferences.RomanizationSystem);
                var text = new Dictionary<string, string>();
                foreach (var line in Lines(work.Lyrics))
                {
                    token.ThrowIfCancellationRequested();
                    if ((!work.IncludeSupplied && !string.IsNullOrWhiteSpace(line.Pronunciation)) || (work.Preferences.SourceLanguage != "ja" && !(work.Preferences.SourceLanguage == "auto" && line.Language == "ja"))) continue;
                    text[line.Id] = conversion is not null ? await conversion(line.Text, system) : await converter!.Convert(line.Text, To.Romaji, Mode.Spaced, system);
                }
                store.SaveLocalVariant(new Variant(work.Key, work.Lyrics.Hash, "pronunciation", "ja", "Kawazu", "1.1.4/" + work.Preferences.RomanizationSystem, text, CreatedAt: DateTime.UtcNow, OriginType: "local", Profile: new("Kawazu", Codec.Hash("local:Kawazu-1.1.4/IpaDic-0.10.0"), "1.1.4/" + work.Preferences.RomanizationSystem, "pronunciation", "ja", work.Preferences.SourceLanguage, work.IncludeSupplied ? "all-japanese-rows" : "fill-missing", 0, 0, 1)), work.Epoch); states.TryRemove(work.Key, out _);
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
            catch { if (work.Epoch == store.Epoch && !store.IsResetting) states[work.Key] = new("failed", "Local romaji could not be prepared. Retry or choose another pronunciation service."); }
            finally { activeHash = null; }
        }
    }
}
