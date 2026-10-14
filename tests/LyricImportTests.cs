using System.IO.Compression;
using System.Text;
using LyricBridge;
using Lyricify.Lyrics.Decrypter.Qrc;
using Xunit;

public sealed class LyricImportTests
{
    private static readonly Candidate Candidate = new("Imported", "local", "Fixture", "Artist", "", null, 100);
    private static ImportedLyrics Text(string text, string name = "lyrics.txt") => LyricImport.Parse(new(text, FileName: name), Candidate, TestContext.Current.CancellationToken);
    private static ImportedLyrics Bytes(byte[] bytes, string name, string encoding = "auto") => LyricImport.Parse(new(FileName: name, FileBytes: Convert.ToBase64String(bytes), Encoding: encoding), Candidate, TestContext.Current.CancellationToken);
    [Theory]
    [InlineData("hello\nworld", "lyrics.txt", "TXT", "plain")]
    [InlineData("[ar:Artist]\n[offset:0]\n[00:01.00][00:02.00]hello", "lyrics.lrc", "LRC", "line")]
    [InlineData("[00:01.00]<00:01.00>hel<00:01.50>lo", "lyrics.elrc", "ELRC", "word")]
    [InlineData("[1000,1000]hel(1000,500)lo(1500,500)", "lyrics.qrc", "QRC", "word")]
    [InlineData("[1000,1000](1000,500,0)hel(1500,500,0)lo", "lyrics.yrc", "YRC", "word")]
    [InlineData("[1000,1000]<0,500,0>hel<500,500,0>lo", "lyrics.krc", "KRC", "word")]
    [InlineData("[type:LyricifyLines]\n[1000,2000]hello", "lyrics.lyl", "Lyricify Lines", "line")]
    [InlineData("[4]hel(1000,500)lo(1500,500)", "lyrics.lys", "Lyricify Syllable", "word")]
    [InlineData("<tt xmlns=\"http://www.w3.org/ns/ttml\"><body><div><p begin=\"1s\" end=\"2s\">hello</p></div></body></tt>", "lyrics.ttml", "TTML", "line")]
    public void ValidFormatsRetainTextAndTiming(string text, string name, string format, string timing)
    {
        var result = Text(text, name);
        Assert.Equal(format, result.Format); Assert.Equal(timing, result.Timing);
        Assert.Contains(result.Lyrics.Lines, l => l.Text == "hello");
        Assert.True(result.Lyrics.Manual); Assert.NotEmpty(result.Lyrics.Hash);
    }
    [Theory]
    [InlineData("[00:01.00]valid\n[00:xx]broken", "lyrics.lrc")]
    [InlineData("[00:01.00]valid\nbroken", "lyrics.lrc")]
    [InlineData("[00:99.00]broken", "lyrics.lrc")]
    [InlineData("[1000,1000]good(1000,500)\n[1000,1000]bad(1000,xx)", "lyrics.qrc")]
    [InlineData("[1000,1000](1000,500,0)good(1500,-2,0)bad", "lyrics.yrc")]
    [InlineData("[2000,1000]bad", "lyrics.lyl")]
    [InlineData("[00:01.00]<00:01.50>bad<00:01.00>", "lyrics.elrc")]
    [InlineData("{\"not\":\"lyrics\"}", "lyrics.json")]
    [InlineData("<html>not lyrics</html>", "lyrics.txt")]
    [InlineData("<tt xmlns=\"http://www.w3.org/ns/ttml\"><body><p begin=\"oops\">bad</p></body></tt>", "lyrics.ttml")]
    [InlineData("<tt xmlns=\"http://www.w3.org/ns/ttml\"><body><p begin=\"1s\">valid</p><p>unparsable</p></body></tt>", "lyrics.ttml")]
    [InlineData("{\"t\":0,\"c\":[{\"tx\":\"Writer\"}]}\n[0,100](0,100,0)", "lyrics.yrc")]
    [InlineData("[ar:Metadata only]", "lyrics.lrc")]
    [InlineData("", "lyrics.txt")]
    public void InvalidFilesAreRejected(string text, string name) => Assert.Throws<WorkflowException>(() => Text(text, name));
    [Theory]
    [InlineData("[1000,1000](1000,100,0)a(520,1180,0)b(1900,101,0)c", "lyrics.yrc")]
    [InlineData("[1000,1000]a(1000,100)b(520,1180)c(1900,101)", "lyrics.qrc")]
    [InlineData("[1000,1000]<0,100,0>a<-480,1180,0>b<900,101,0>c", "lyrics.krc")]
    public void OverlappingWordsPreserveTextOrderAndExpandLineBounds(string text, string name)
    {
        var line = Assert.Single(Text(text, name).Lyrics.Lines);
        Assert.Equal("abc", line.Text);
        Assert.Equal(520 * 10000L, line.Start);
        Assert.Equal(2001 * 10000L, line.End);
        Assert.Equal(new long[] { 1000 * 10000L, 520 * 10000L, 1900 * 10000L }, line.Cues.Select(c => c.Start));
        Assert.Equal(new long?[] { 1100 * 10000L, 1700 * 10000L, 2001 * 10000L }, line.Cues.Select(c => c.End));
    }
    [Theory]
    [InlineData("[1000,1000]<-1001,100,0>bad", "lyrics.krc")]
    [InlineData("[2147483640,7]<10,1,0>bad", "lyrics.krc")]
    [InlineData("[1000,1000](2147483647,1,0)bad", "lyrics.yrc")]
    public void OverlappingWordsStillRejectOutOfRangeTiming(string text, string name) => Assert.Throws<WorkflowException>(() => Text(text, name));
    [Fact]
    public void EnhancedCuesAndRepeatedTimestampsPreserveOriginalBoundaries()
    {
        var result = Text("[00:01.00][00:03.00]<00:01.00>日本<00:01.50>語", "lyrics.elrc");
        Assert.Equal(2, result.Lyrics.Lines.Count);
        Assert.Equal(30_000_000, result.Lyrics.Lines[1].Cues[0].Start);
        Assert.All(result.Lyrics.Lines, l => { Assert.Equal("日本語", l.Text); Assert.Equal(2, l.Cues.Count); Assert.Equal(2, l.Cues[0].EndPosition); });
    }
    [Fact]
    public void LiteralAngleBracketsInLrcArePreservedRatherThanTreatedAsTiming()
    {
        Assert.Equal("<heart>", Assert.Single(Text("[00:01.00]<heart>", "lyrics.lrc").Lyrics.Lines).Text);
        Assert.Equal("love <forever>", Assert.Single(Text("[00:01.00]<00:01.00>love <forever>", "lyrics.elrc").Lyrics.Lines).Text);
    }
    [Fact]
    public void UnicodeBomAndSelectableLegacyEncodingDoNotReplaceCharacters()
    {
        const string text = "[00:01.00]你好世界";
        foreach (var encoding in new Encoding[] { new UTF8Encoding(true), new UnicodeEncoding(false, true), new UnicodeEncoding(true, true), new UTF32Encoding(false, true), new UTF32Encoding(true, true) })
            Assert.Equal("你好世界", Assert.Single(Bytes([.. encoding.GetPreamble(), .. encoding.GetBytes(text)], "lyrics.lrc").Lyrics.Lines).Text);
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        var bytes = Encoding.GetEncoding(54936).GetBytes(text);
        Assert.Throws<WorkflowException>(() => Bytes(bytes, "lyrics.lrc"));
        Assert.Equal("你好世界", Assert.Single(Bytes(bytes, "lyrics.lrc", "gb18030").Lyrics.Lines).Text);
        Assert.Throws<WorkflowException>(() => Bytes([0xff, 0x81], "lyrics.txt"));
        Assert.Throws<WorkflowException>(() => Bytes([0, 1, 2, 3], "lyrics.txt"));
    }
    [Fact]
    public void PlainTextThatResemblesAnEncodingIsNotMistakenForACorruptContainer()
    {
        Assert.Equal("1234567890123456", Assert.Single(Text("1234567890123456").Lyrics.Lines).Text);
        Assert.Equal("a3Jjbroken", Assert.Single(Text("a3Jjbroken").Lyrics.Lines).Text);
        Assert.Throws<WorkflowException>(() => Text("%PDF-1.0\nnot lyrics", "document.pdf"));
    }
    [Theory]
    [InlineData(65001, "utf-8", "hello")]
    [InlineData(1200, "utf-16le", "你好")]
    [InlineData(1201, "utf-16be", "你好")]
    [InlineData(54936, "gb18030", "你好")]
    [InlineData(950, "big5", "你好")]
    [InlineData(932, "shift-jis", "日本語の歌")]
    [InlineData(51949, "euc-kr", "안녕")]
    [InlineData(1252, "windows-1252", "café")]
    public void EveryOfferedEncodingIsDecodedStrictly(int codePage, string choice, string lyric)
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        var bytes = Encoding.GetEncoding(codePage).GetBytes("[00:01.00]" + lyric);
        Assert.Equal(lyric, Assert.Single(Bytes(bytes, "lyrics.lrc", choice).Lyrics.Lines).Text);
    }
    [Fact]
    public void EmbeddedKrcAuxiliaryRowsAndLyricifyBackgroundVocalsSurviveImport()
    {
        var language = System.Text.Json.JsonSerializer.Serialize(new
        {
            version = 1,
            content = new[] {
            new { type = 0, language = 0, lyricContent = new[] { new[] { "hel", "lo" } } },
            new { type = 1, language = 0, lyricContent = new[] { new[] { "你好" } } }
        }
        });
        var krc = "[language:" + Convert.ToBase64String(Encoding.UTF8.GetBytes(language)) + "]\n[1000,1000]<0,500,0>hel<500,500,0>lo";
        var result = Text(krc, "lyrics.krc");
        var line = Assert.Single(result.Lyrics.Lines);
        Assert.Equal("hel lo", line.Pronunciation); Assert.Equal("你好", line.Translations["zh"]);
        var background = Text("[4]lead(1000,1000)\n[7](back)(1000,1000)", "lyrics.lys");
        Assert.Equal("(back)", Assert.Single(background.Lyrics.Lines).Background!.Text);
    }
    [Fact]
    public void SizeBoundariesAndAmbiguousRequestsAreRejectedBeforeParsing()
    {
        Assert.Equal(1, Text(new string('x', LyricImport.MaxBytes)).LineCount);
        Assert.Throws<WorkflowException>(() => Text(new string('x', LyricImport.MaxBytes + 1)));
        Assert.Throws<WorkflowException>(() => Bytes(new byte[LyricImport.MaxBytes + 1], "lyrics.txt"));
        Assert.Throws<WorkflowException>(() => LyricImport.Parse(new("text", FileBytes: "dGV4dA=="), Candidate, TestContext.Current.CancellationToken));
        Assert.Throws<WorkflowException>(() => LyricImport.Parse(new(FileBytes: "%%%"), Candidate, TestContext.Current.CancellationToken));
    }
    [Fact]
    public void EncryptedKrcPreservesFirstCharactersWithAndWithoutBomAndIsBounded()
    {
        const string text = "[1000,1000]<0,500,0>hel<500,500,0>lo";
        foreach (var bom in new[] { "", "\uFEFF" })
        {
            var bytes = Krc(bom + text);
            Assert.Equal(text, Lyricify.Lyrics.Decrypter.Krc.Decrypter.DecryptLyrics(bytes, LyricImport.MaxBytes));
            Assert.Equal("hello", Assert.Single(Bytes(bytes, "wrong.txt").Lyrics.Lines).Text);
        }
        Assert.Throws<WorkflowException>(() => Bytes("krc1broken"u8.ToArray(), "lyrics.krc"));
        Assert.Throws<WorkflowException>(() => Bytes(Krc(new string('x', LyricImport.MaxBytes + 1)), "lyrics.krc"));
    }
    [Fact]
    public void CloudAndDesktopQrcReuseTheDecoderAndPreserveContent()
    {
        const string text = "[1000,1000]hel(1000,500)lo(1500,500)";
        var cloud = CloudQrc(text);
        Assert.Equal(text, Decrypter.DecryptLyrics(cloud, LyricImport.MaxBytes));
        Assert.Equal("hello", Assert.Single(Text(Convert.ToHexString(cloud), "lyrics.qrc").Lyrics.Lines).Text);
        Assert.Equal("hello", Assert.Single(Bytes(cloud, "lyrics.qrc").Lyrics.Lines).Text);
        Assert.Equal("hello", Assert.Single(Bytes(cloud, "wrong.txt").Lyrics.Lines).Text);
        var desktop = DesktopQrc(cloud);
        Assert.Equal(Convert.FromHexString("9825B0ACE3028368E8FC6C"), desktop[..11]);
        Assert.Equal("hello", Assert.Single(Bytes(desktop, "lyrics.qrc").Lyrics.Lines).Text);
        Assert.Throws<WorkflowException>(() => Bytes(desktop[..13], "lyrics.qrc"));
        Assert.Throws<WorkflowException>(() => Bytes(CloudQrc(new string('x', LyricImport.MaxBytes + 1)), "lyrics.qrc"));
    }
    [Fact]
    public void DesktopQrcMaskWorksBeyondItsFirstPeriod()
    {
        var random = new Random(1741); var buffer = new byte[60_000]; random.NextBytes(buffer);
        var lyric = Convert.ToBase64String(buffer);
        var input = "[1000,1000]" + lyric + "(1000,1000)";
        var file = DesktopQrc(CloudQrc(input)); Assert.True(file.Length > 0x8000);
        Assert.Equal(lyric, Assert.Single(Bytes(file, "lyrics.qrc").Lyrics.Lines).Text);
    }
    [Fact]
    public void RecognizedWrappersKeepOriginalAndAuxiliaryLyrics()
    {
        var qrc = Text("<QrcInfos><Lyric_1 LyricContent=\"[1000,1000]hello(1000,1000)\"/></QrcInfos>", "lyrics.xml");
        Assert.Equal("QRC XML", qrc.Format); Assert.Equal("hello", Assert.Single(qrc.Lyrics.Lines).Text);
        var yrc = Text("{\"yrc\":{\"lyric\":\"[1000,1000](1000,1000,0)hello\"},\"ytlrc\":{\"lyric\":\"[00:01.00]你好\"},\"yromalrc\":{\"lyric\":\"[00:01.00]hello-reading\"}}", "lyrics.json");
        var line = Assert.Single(yrc.Lyrics.Lines); Assert.Equal("你好", line.Translations["zh"]); Assert.Equal("hello-reading", line.Pronunciation);
        var spotify = Text("{\"lyrics\":{\"syncType\":\"LINE_SYNCED\",\"lines\":[{\"startTimeMs\":\"1000\",\"endTimeMs\":\"2000\",\"words\":\"hello\",\"syllables\":[]}]}}", "lyrics.json");
        Assert.Equal("Spotify (JSON)", spotify.Format); Assert.Equal("hello", Assert.Single(spotify.Lyrics.Lines).Text);
        Assert.Throws<WorkflowException>(() => Text("{\"lyrics\":{\"syncType\":\"LINE_SYNCED\",\"lines\":[{\"words\":\"bad\",\"startTimeMs\":\"oops\"}]}}", "lyrics.json"));
    }
    [Fact]
    public void MillisecondTtmlUnitsAndAppleLocalizationsAreNotSilentlyUntimed()
    {
        var xml = "<tt xmlns=\"http://www.w3.org/ns/ttml\"><body><p begin=\"1000ms\" end=\"2000ms\">hello</p></body></tt>";
        var parsed = Text(xml, "lyrics.ttml");
        var duration = Text("<tt xmlns=\"http://www.w3.org/ns/ttml\"><body><p begin=\"1s\" dur=\"1s\">hello</p></body></tt>", "lyrics.ttml");
        Assert.Equal(20_000_000, Assert.Single(duration.Lyrics.Lines).End);
        Assert.Equal(10_000_000, Assert.Single(parsed.Lyrics.Lines).Start);
        var json = System.Text.Json.JsonSerializer.Serialize(new { data = new[] { new { type = "syllable-lyrics", attributes = new { ttmlLocalizations = xml } } } });
        Assert.Equal("hello", Assert.Single(Text(json, "lyrics.json").Lyrics.Lines).Text);
    }
    [Fact]
    public void ProviderMusixmatchAndKrcJsonWrappersAreSupported()
    {
        const string json = "{\"message\":{\"body\":{\"macro_calls\":{\"track.subtitles.get\":{\"message\":{\"header\":{\"status_code\":200},\"body\":{\"subtitle_list\":[{\"subtitle\":{\"subtitle_body\":\"[00:01.00]hello\"}}]}}}}}}}";
        Assert.Equal("hello", Assert.Single(Text(json, "lyrics.json").Lyrics.Lines).Text);
        var krc = System.Text.Json.JsonSerializer.Serialize(new { content = Convert.ToBase64String(Krc("[1000,1000]<0,1000,0>hello")) });
        Assert.Equal("KRC JSON", Text(krc, "lyrics.json").Format);
    }
    [Fact]
    public void NonFiniteProviderJsonTimingIsRejected()
    {
        var richsync = "[{\"ts\":NaN,\"te\":2,\"l\":[{\"c\":\"hello\",\"o\":0}]}]";
        var json = System.Text.Json.JsonSerializer.Serialize(new
        {
            message = new
            {
                body = new
                {
                    macro_calls = new Dictionary<string, object>
                    {
                        ["track.richsync.get"] = new { message = new { header = new { status_code = 200 }, body = new { richsync = new { richsync_body = richsync } } } }
                    }
                }
            }
        });
        Assert.Throws<WorkflowException>(() => Text(json, "lyrics.json"));
    }
    [Fact]
    public void OriginalBytesAndNameAreKeptWhileDecodedTextIsUsedForParsing()
    {
        var bytes = Krc("[1000,1000]<0,1000,0>hello"); var result = Bytes(bytes, "original.krc");
        var provenance = System.Text.Json.JsonDocument.Parse(result.Raw.RawResponse).RootElement;
        Assert.Equal("original.krc", provenance.GetProperty("fileName").GetString());
        Assert.Equal(bytes, Convert.FromBase64String(provenance.GetProperty("fileBytes").GetString()!));
        Assert.Equal("[1000,1000]<0,1000,0>hello", result.Raw.Original);
    }
    private static byte[] Zip(string text)
    {
        using var output = new MemoryStream();
        using (var zip = new ZLibStream(output, CompressionLevel.SmallestSize, true)) zip.Write(Encoding.UTF8.GetBytes(text));
        return output.ToArray();
    }
    private static byte[] Krc(string text)
    {
        var data = Zip(text); var key = Convert.FromHexString("404761775E3274475136312DCED26E69");
        for (int i = 0; i < data.Length; i++) data[i] ^= key[i % key.Length];
        return [.. "krc1"u8, .. data];
    }
    private static byte[] CloudQrc(string text)
    {
        var compressed = Zip(text); var padded = new byte[(compressed.Length + 7) / 8 * 8]; compressed.CopyTo(padded, 0);
        var schedule = Enumerable.Range(0, 3).Select(_ => Enumerable.Range(0, 16).Select(_ => new byte[6]).ToArray()).ToArray();
        DESHelper.TripleDESKeySetup(Encoding.ASCII.GetBytes("!@#)(*$%123ZXC!@!@#)(NHL"), schedule, DESHelper.ENCRYPT);
        var result = new byte[padded.Length];
        var input = new byte[8]; var output = new byte[8];
        for (int i = 0; i < padded.Length; i += 8) { Array.Copy(padded, i, input, 0, 8); DESHelper.TripleDESCrypt(input, output, schedule); output.CopyTo(result, i); }
        return result;
    }
    private static byte[] DesktopQrc(byte[] cloud)
    {
        // Independent format-vector mask, rather than using the production envelope adapter.
        var mask = Convert.FromHexString("C34AD6CA9067F752D8A166629F5B0900C35E95239F13117ED8923FBC90BB740EC347743D90AA3F51D8F411849FDE951DC3C609D59FFA66F9D8F0F7A090A1D6F3C3F3D6A190A0F7F0D8F966FA9FD509C6C31D95DE9F8411F4D8513FAA903D7447C30E74BB90BC3F92D87E11139F23955EC300095B9F6266A1D852F76790CAD64A");
        byte[] result = [.. "[offset:0]\n"u8, .. cloud];
        for (int i = 0; i < result.Length; i++) result[i] ^= mask[(i > 0x7fff ? i % 0x7fff : i) & 0x7f];
        return result;
    }
}
