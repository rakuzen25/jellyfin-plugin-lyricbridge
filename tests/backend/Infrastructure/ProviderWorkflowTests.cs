using Xunit;
using System.Net;
using LyricBridge;
public sealed class ProviderWorkflowTests : LanguageFixture
{
    [Fact]
    public void ProviderAdmissionAndGenerationQuotas()
    {
        var root = Root;
        Assert.True(new ProviderRegistry().Sources.Select(s => s.Name).SequenceEqual(new[] { "QQ", "NetEase", "Kugou", "Soda", "Musixmatch", "LRCLIB" }), "credential-dependent sources skipped");
        var store = Own(new Store(Path.Combine(root, "queue")));
        var languages = Own(new LanguageServices(() => Services));
        var generation = Own(new Generation(Policy, store, languages));
        var rejectedItem = Guid.NewGuid();
        store.Put("rejected-match", rejectedItem.ToString("N"), new MatchRejection());
        var rejectionRegistry = new ProviderRegistry();
        var discovery = Own(new Discovery(store, rejectionRegistry, new Retrieval(store, rejectionRegistry, Microsoft.Extensions.Logging.Abstractions.NullLogger<Retrieval>.Instance)));
        Assert.True(discovery.Start(rejectedItem, new()
        {
            Title = "fixture",
            Artists = ["fixture"]
        }, retry: true).State == "rejected", "retry preserves administrator rejection");
        var lyrics = new RichLyrics { Hash = "content", Lines = [new() { Id = "l0", Text = "hello" }] };
        var user = Guid.NewGuid();
        var item = Guid.NewGuid();
        Reject(() => generation.Request(user, item, lyrics, new(), false), "user requests default disabled");
        var admin = generation.Request(user, item, lyrics, new(), true);
        Assert.True(admin.State == "queued", "administrator immediate approval");
        generation.Action(admin.Id, "cancel", user, true);
        AllowUserRequests = true;
        var first = generation.Request(user, item, lyrics, new() { Language = "ar" }, false);
        Assert.True(first.State == "pending", "user approval pending");
        Assert.True(generation.Request(user, item, lyrics, new() { Language = "ar" }, false).Id == first.Id, "duplicate requests deduplicated");
        Reject(() => generation.Action(first.Id, "approve", user, false), "users cannot approve");
        generation.Action(first.Id, "approve", user, true);
        Assert.True(generation.Jobs().First(j => j.Id == first.Id).State == "queued", "admin approval");
        generation.Request(user, item, lyrics, new() { Language = "ja" }, false);
        generation.Request(user, item, lyrics, new() { Language = "de" }, false);
        Reject(() => generation.Request(user, item, lyrics, new() { Language = "fr" }, false), "active request cap");
        foreach (var job in generation.Jobs())
            if (job.State is "pending" or "queued")
                generation.Action(job.Id, "cancel", user, true);
        generation.Request(user, item, lyrics, new() { Language = "es" }, false);
        Reject(() => generation.Request(user, item, lyrics, new() { Language = "ru" }, false), "rolling daily quota");
        var key = languages.Key(lyrics, new());
        store.Put("variant", key, new Variant(key, lyrics.Hash, "translation", "zh-Hans", "Google", "", new() { { "l0", "你好" } }, CacheKey: key));
        Assert.True(generation.Request(user, item, lyrics, new(), false).State == "cached", "cached generation bypasses quota");
        var changed = new RichLyrics { Hash = "different", Lines = lyrics.Lines };
        Assert.True(languages.Key(changed, new()) != key, "content invalidates variant key");
    }

    [Fact]
    public void ChineseDisplayConversionPreservesOriginalAndCuePositions()
    {
        var translated = Display.Apply(new()
        {
            Lines = [new() { Text = "声音", Language = "zh", Translations = new() { { "zh", "声音" } } }]
        }, new()
        {
            TranslationLanguage = "zh-Hant",
            OriginalChineseScript = "Simplified"
        });
        Assert.True(translated.Lines[0].Text == "声音" && translated.Lines[0].Translations["zh"] == "聲音", "translation language controls script independently of original text");
        translated = Display.Apply(translated, new()
        {
            TranslationLanguage = "zh-Hans",
            OriginalChineseScript = "Traditional"
        });
        Assert.True(translated.Lines[0].Text == "聲音" && translated.Lines[0].Translations["zh"] == "声音", "Simplified translation does not affect Traditional original");
        var display = Display.Apply(new()
        {
            Lines = [new() { Text = "声音", Language = "zh", Cues = [new(0, 1, 0, 1)] }]
        }, new() { OriginalChineseScript = "Traditional" });
        Assert.True(display.Lines[0].Text == "聲音" && display.Lines[0].Cues[0].Position == 0, "Chinese conversion preserves cue positions");
        Assert.True(Normalization.Timestamp(TimeSpan.FromMinutes(75).Ticks) == "75:00.000", "long song timestamps");
    }

    [Fact]
    public void ProviderFormatsProduceLyrics()
    {
        var formats = new Dictionary<string, string>{
          {"QQ","[1000,1000]h(1000,500)i(1500,500)"},
          {"NetEase","[1000,1000](1000,500,0)h(1500,500,0)i"},
          {"Kugou","[1000,1000]<0,500,0>h<500,500,0>i"},
          {"Spotify","{\"lyrics\":{\"syncType\":\"LINE_SYNCED\",\"lines\":[{\"startTimeMs\":\"1000\",\"endTimeMs\":\"2000\",\"words\":\"hi\",\"syllables\":[]}]}}"},
          {"AppleMusic","<tt xmlns=\"http://www.w3.org/ns/ttml\"><body><div><p begin=\"00:00:01.000\" end=\"00:00:02.000\"><span begin=\"00:00:01.000\" end=\"00:00:01.500\">h</span><span begin=\"00:00:01.500\" end=\"00:00:02.000\">i</span></p></div></body></tt>"},
          {"Musixmatch","{\"message\":{\"body\":{\"macro_calls\":{\"track.subtitles.get\":{\"message\":{\"header\":{\"status_code\":200},\"body\":{\"subtitle_list\":[{\"subtitle\":{\"subtitle_body\":\"[00:01.00]hi\"}}]}}}}}}}"}
        };
        foreach (var pair in formats)
            Assert.True(Normalization.Parse(new(pair.Value), new(pair.Key, "42", "fixture", "artist", "album", 10000, 100)).Lines.Count > 0, pair.Key + " lyric format");
    }

    [Fact]
    public async Task ProviderResponsesRetainAuxiliaryAndInstrumentalData()
    {
        var handler = new FixtureHandler();
        var client = new HttpClient(handler);
        foreach (var name in new[] { "QQ", "NetEase", "Soda", "LRCLIB" })
        {
            var source = new HelperSource(new()
            {
                Name = name
            }, client);
            handler.Source = name;
            var raw = await source.Fetch(new(name, "42", "fixture", "artist", "album", 10000, 100), TestContext.Current.CancellationToken);
            Assert.True(raw != null && Normalization.Parse(raw, new(name, "42", "fixture", "artist", "album", 10000, 100)).Lines.Count > 0, name + " response fixture");
            handler.Instrumental = true;
            if (name is "NetEase" or "LRCLIB")
                Assert.True((await source.Fetch(new(name, "42", "fixture", "artist", "album", 10000, 100), TestContext.Current.CancellationToken))?.Instrumental == true, name + " instrumental fixture");
            handler.Instrumental = false;
        }
    }
    static void Reject(Action action, string name)
    {
        try
        {
            action();
        }
        catch (UnauthorizedAccessException) { return; }
        catch (InvalidOperationException) { return; }
        throw new Exception("Failed: " + name);
    }
}
public sealed class FixtureHandler : HttpMessageHandler
{
    public string Source = ""; public bool Instrumental;
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var lyric = "[00:01.00]fixture";
        var content = Source switch
        {
            "QQ" => "<root><content><![CDATA[" + lyric + "]]></content><contentts><![CDATA[[00:01.00]翻译]]></contentts><contentroma><![CDATA[[00:01.00]fixture pronunciation]]></contentroma></root>",
            "NetEase" => Codec.Serialize(new { nolyric = Instrumental, lrc = new { lyric }, tlyric = new { lyric = "[00:01.00]翻译" }, romalrc = new { lyric = "[00:01.00]fixture pronunciation" } }),
            "Soda" => Codec.Serialize(new { lyric = new { content = lyric, lang = "en", lang_translations = new { ar = new { content = "[00:01.00]مرحبا" } }, translations = new { cn = "[00:01.00]翻译" } } }),
            _ => Codec.Serialize(new { id = 42, instrumental = Instrumental, syncedLyrics = lyric, plainLyrics = "fixture" })
        };
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(content) });
    }
}
