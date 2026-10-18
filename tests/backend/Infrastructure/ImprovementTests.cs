using Xunit;
using LyricBridge;
using Lyricify.Lyrics.Models;
using Microsoft.Extensions.Logging.Abstractions;
public sealed class ImprovementTests : StorageFixture
{
    [Fact]
    public async Task ProgressiveRetrievalAndLocalPronunciation()
    {
        var root = Root;
        Assert.True(Normalization.Parse(new("[00:00.00]纯音乐，请欣赏"), new("QQ", "1", "title", "artist", "", 100, 100)).Lines.Count == 0, "instrumental notice is not sung text");
        var prefs = Codec.Deserialize<Preferences>("{\"chineseScript\":\"Traditional\"}")!;
        Assert.True(prefs.OriginalChineseScript == "Simplified" && prefs.RomanizationSystem == "Hepburn", "unrecognized preview fields do not override fresh defaults");
        var doc = new RichLyrics { Hash = "fixture-local", Lines = [new() { Id = "ja", Language = "ja", Text = "おはようございます" }, new() { Id = "supplied", Language = "ja", Text = "朝", Pronunciation = "asa" }, new() { Id = "en", Language = "en", Text = "Hello" }] };
        var store = Own(new Store(Path.Combine(root, "local")));
        var local = Own(new LocalPronunciation(store));
        await local.StartAsync(TestContext.Current.CancellationToken);
        Assert.True(local.Ensure(doc, new()).State == "queued", "local queue without user approval");
        Variant? variant = null;
        for (int i = 0; i < 100 && variant == null; i++)
        {
            await Task.Delay(100, TestContext.Current.CancellationToken);
            variant = store.Get<Variant>("variant", LocalPronunciation.Key(doc, new()));
            if (local.Ensure(doc, new()).State == "failed")
                throw new Exception("Kawazu dictionary failed");
        }
        Assert.True(variant?.Text["ja"].Contains("ohayou", StringComparison.OrdinalIgnoreCase) == true, "actual Kawazu romanization");
        Assert.True(!variant!.Text.ContainsKey("supplied") && !variant.Text.ContainsKey("en"), "preserve supplied and non-Japanese rows");
        var explicitPrefs = new Preferences { ShowPronunciation = false, JapaneseRomaji = false };
        Assert.True(local.Ensure(doc, explicitPrefs, true).State == "queued", "explicit local generation works with display rows hidden");
        Variant? full = null;
        for (int i = 0; i < 100 && full == null; i++)
        {
            await Task.Delay(100, TestContext.Current.CancellationToken);
            full = store.Get<Variant>("variant", LocalPronunciation.Key(doc, explicitPrefs, true));
        }
        Assert.True(full?.Text.GetValueOrDefault("supplied")?.Trim().Equals("asa", StringComparison.OrdinalIgnoreCase) == true, "explicit Kawazu version includes provider-supplied rows");
        Assert.True(!full!.Text.ContainsKey("en"), "explicit local generation retains non-Japanese rows separately");
        Assert.True(full.Key != variant.Key && store.Get<Variant>("variant", variant.Key) != null, "automatic cache remains compatible and separate");
        Assert.True(local.Ensure(doc, explicitPrefs, true).State == "complete", "explicit local cache reused");
        var allSupplied = new RichLyrics { Hash = "supplied-only", Lines = [new() { Id = "a", Language = "ja", Text = "朝", Pronunciation = "provider romaji" }] };
        Assert.True(local.Ensure(allSupplied, new()).State == "unavailable", "no automatic generation when provider supplies all pronunciation");
        Assert.True(local.Ensure(allSupplied, new(), true).State == "queued", "manual conversion works when every row already has pronunciation");
        for (int i = 0; i < 100 && store.Get<Variant>("variant", LocalPronunciation.Key(allSupplied, new(), true)) == null; i++)
            await Task.Delay(100, TestContext.Current.CancellationToken);
        Assert.True(store.Get<Variant>("variant", LocalPronunciation.Key(allSupplied, new(), true))?.Text["a"]?.Trim().Equals("asa", StringComparison.OrdinalIgnoreCase) == true, "supplied-only manual version persisted");
        await local.StopAsync(TestContext.Current.CancellationToken);
        Assert.Equal(2, store.Variants("fixture-local").Count);
    }

    [Fact]
    public async Task DiscoveryOffersUpgradesWithoutReplacingSelectedLyrics()
    {
        var root = Root;
        var store = Own(new Store(Path.Combine(root, "discovery")));
        var line = new OutcomeSource("QQ", new("[00:01.00]hello"), 20);
        var word = new OutcomeSource("NetEase", new("[1000,1000](1000,500,0)hel(1500,500,0)lo"), 3200);
        var registry = ProviderRegistry.WithSources(line, word);
        var retrieval = new Retrieval(store, registry, NullLogger<Retrieval>.Instance);
        var discovery = Own(new Discovery(store, registry, retrieval));
        var item = Guid.NewGuid();
        var track = new TrackMultiArtistMetadata { Title = "title", Artists = ["artist"] };
        discovery.Start(item, track);
        await Task.Delay(2750, TestContext.Current.CancellationToken);
        var early = discovery.Status(item);
        Assert.True(early.Lyrics != null && !early.Complete, "first lyrics visible before all providers finish");
        for (int i = 0; i < 40 && !discovery.Status(item).Complete; i++)
            await Task.Delay(100, TestContext.Current.CancellationToken);
        var complete = discovery.Status(item);
        Assert.True(complete.Better?.WordTimed == true && !complete.Lyrics!.WordTimed, "better timing is offered without replacement");
        discovery.Mark(item, false);
        Assert.True(discovery.Start(item, track, true).State == "instrumental", "manual instrumental persists across retries");
        store.SelectOriginal(item, complete.Lyrics!.Hash);
        Assert.True(retrieval.Selected(item) != null, "saved version restores lyric selection");
        foreach (var manual in new[] { false, true })
        {
            var cachedItem = Guid.NewGuid();
            var cached = Normalization.Parse(new("[00:01.00]cached lyric"), new("Local", "cached", "title", "artist", "", 1000, 100));
            cached.Manual = manual;
            store.Save(cachedItem, cached);
            var originalHash = cached.Hash;
            var check = Own(new Discovery(store, registry, retrieval));
            var immediate = check.Start(cachedItem, track, displayed: cached);
            Assert.True(immediate.Lyrics?.Hash == originalHash && immediate.Complete, "cached/manual lyrics served without routine rediscovery");
            check.Start(cachedItem, track, true, displayed: cached);
            for (int i = 0; i < 50 && !check.Status(cachedItem).Complete; i++)
                await Task.Delay(100, TestContext.Current.CancellationToken);
            Assert.True(check.Status(cachedItem).Better?.WordTimed == true && retrieval.Selected(cachedItem)?.Hash == originalHash, "cached/manual upgrade offered without replacement");
        }
        var localOnlyItem = Guid.NewGuid();
        var localOnly = Normalization.Parse(new("[00:01.00]local file"), new("Local", "file", "title", "artist", "", 1000, 100));
        var localCheck = Own(new Discovery(store, registry, retrieval));
        {
            localCheck.Start(localOnlyItem, track, true, displayed: localOnly);
            for (int i = 0; i < 40 && !localCheck.Status(localOnlyItem).Complete; i++)
                await Task.Delay(100, TestContext.Current.CancellationToken);
            Assert.True(localCheck.Status(localOnlyItem).Better?.WordTimed == true && retrieval.Selected(localOnlyItem) == null, "local lyric file upgrade offered without creating selection");
        }
    }

    [Fact]
    public async Task DiscoveryDistinguishesInstrumentalEmptyConflictingAndTimedOutResults()
    {
        var store = Own(new Store(Path.Combine(Root, "outcomes")));
        var track = new TrackMultiArtistMetadata { Title = "title", Artists = ["artist"] };
        var line = new OutcomeSource("QQ", new("[00:01.00]hello"), 20);
        var instrumental = new OutcomeSource("LRCLIB", new("", Instrumental: true, InstrumentalReason: "fixture flag"), 1);
        var registry2 = ProviderRegistry.WithSources(instrumental);
        var classification = Own(new Discovery(store, registry2, new Retrieval(store, registry2, NullLogger<Retrieval>.Instance)));
        var instrumentalItem = Guid.NewGuid();
        classification.Start(instrumentalItem, track);
        for (int i = 0; i < 40 && !classification.Status(instrumentalItem).Complete; i++)
            await Task.Delay(100, TestContext.Current.CancellationToken);
        Assert.True(classification.Status(instrumentalItem).State == "instrumental", "provider instrumental classification");
        Assert.True(store.Get<InstrumentalEvidence>("instrumental", instrumentalItem.ToString("N"))?.Expires > DateTime.UtcNow.AddDays(6), "instrumental seven-day cache");
        var emptyItem = Guid.NewGuid();
        var emptySource = new OutcomeSource("QQ", new(""), 1);
        var emptyRegistry = ProviderRegistry.WithSources(emptySource);
        var emptyDiscovery = Own(new Discovery(store, emptyRegistry, new Retrieval(store, emptyRegistry, NullLogger<Retrieval>.Instance)));
        emptyDiscovery.Start(emptyItem, track);
        for (int i = 0; i < 40 && !emptyDiscovery.Status(emptyItem).Complete; i++)
            await Task.Delay(100, TestContext.Current.CancellationToken);
        Assert.True(emptyDiscovery.Status(emptyItem).State == "missing", "empty lyrics are not instrumental");
        var disputedItem = Guid.NewGuid();
        var disputedRegistry = ProviderRegistry.WithSources(instrumental, line);
        var disputed = Own(new Discovery(store, disputedRegistry, new Retrieval(store, disputedRegistry, NullLogger<Retrieval>.Instance)));
        disputed.Start(disputedItem, track);
        for (int i = 0; i < 40 && !disputed.Status(disputedItem).Complete; i++)
            await Task.Delay(100, TestContext.Current.CancellationToken);
        Assert.True(disputed.Status(disputedItem).Lyrics != null && disputed.Status(disputedItem).Instrumental.Count == 1, "real lyrics win while conflicting evidence remains visible");
        Assert.True(store.Get<List<InstrumentalEvidence>>("instrumental-evidence", disputedItem.ToString("N"))?.Count == 1, "conflicting evidence persists separately from lyrics");
        var delayedRegistry = ProviderRegistry.WithSources(new OutcomeSource("QQ", new("[00:01.00]hello"), 30000));
        var deadline = Own(new Discovery(store, delayedRegistry, new Retrieval(store, delayedRegistry, NullLogger<Retrieval>.Instance), discoveryTimeout: TimeSpan.FromMilliseconds(100)));
        var deadlineItem = Guid.NewGuid();
        deadline.Start(deadlineItem, track);
        for (int i = 0; i < 100 && !deadline.Status(deadlineItem).Complete; i++)
            await Task.Delay(100, TestContext.Current.CancellationToken);
        Assert.True(deadline.Status(deadlineItem).State == "failed" && deadline.Status(deadlineItem).Errors.Any(error => error.Code == "discovery_timeout"), "overall discovery deadline, distinct from empty searches");
    }
}
public sealed class OutcomeSource(string name, RawLyrics raw, int delay) : ILyricSource
{
    public string Name => name; public async Task<List<Candidate>> Search(TrackMultiArtistMetadata track, CancellationToken token)
    {
        await Task.Delay(delay, token);
        return [new(name, "1", "title", "artist", "", 1000, 100)];
    }
    public Task<RawLyrics?> Fetch(Candidate candidate, CancellationToken token) => Task.FromResult<RawLyrics?>(raw);
}
