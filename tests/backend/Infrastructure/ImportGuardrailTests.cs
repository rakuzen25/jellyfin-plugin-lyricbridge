using System.Text.Json;
using LyricBridge;
using Xunit;

public sealed class ImportGuardrailTests
{
    private static ImportedLyrics Parse(string text, string name = "lyrics.lrc", string format = "auto") => LyricImport.Parse(new(text, FileName: name, Format: format), new("Imported", "local", "Fixture", "Artist", "", null, 100), TestContext.Current.CancellationToken);
    private static string Ttml(string content, string attrs = "") => "<tt xmlns=\"http://www.w3.org/ns/ttml\" " + attrs + "><body>" + content + "</body></tt>";
    [Fact]
    public void EnhancedRowsAreBoundToTheirOwnTextBeforeStableSorting()
    {
        var result = Parse("[00:03.00]<00:03.00>three\n[00:01.00]<00:01.00>one\n[00:01.00]plain\n[00:02.00][00:04.00]<00:02.00>repeat<00:02.50>");
        Assert.Equal(new[] { "one", "plain", "repeat", "three", "repeat" }, result.Lyrics.Lines.Select(l => l.Text));
        Assert.Equal(new long?[] { 10_000_000, 10_000_000, 20_000_000, 30_000_000, 40_000_000 }, result.Lyrics.Lines.Select(l => l.Start));
        Assert.Equal(45_000_000, result.Lyrics.Lines[4].Cues[0].End);
        Assert.Equal(45_000_000, result.Lyrics.Lines[4].End);
        Assert.Empty(result.Lyrics.Lines[1].Cues);
    }
    [Theory]
    [InlineData("[offset:-2000]\n[00:01.00]<00:01.00>hello", "lyrics.elrc", 30_000_000L)]
    [InlineData("[offset:2000]\n[00:01.00]<00:01.00>hello", "lyrics.elrc", -10_000_000L)]
    [InlineData("[offset:-2000]\n[1000,1000]<0,1000,0>hello", "lyrics.krc", 30_000_000L)]
    [InlineData("[offset:-2000]\n[1000,1000]hello(1000,1000)", "lyrics.qrc", 30_000_000L)]
    public void SignedOffsetsApplyExactlyOnce(string text, string name, long expected)
    {
        var result = Parse(text, name); var line = Assert.Single(result.Lyrics.Lines);
        Assert.Equal(expected, line.Start); Assert.Equal(expected, Assert.Single(line.Cues).Start);
        if (expected < 0) Assert.Contains(result.Warnings, w => w.Code == "negative_effective_time");
    }
    [Fact]
    public void EffectiveOffsetOverflowIsRejectedWithItsSourceRow()
    {
        var error = Assert.Throws<WorkflowException>(() => Parse("[offset:-2147483648]\n[00:01.00]hello"));
        Assert.Contains("Line 2", error.Message); Assert.NotEmpty(error.Issues!);
    }
    [Fact]
    public void EmptyTerminalMarkersKeepMeaningfulEndBoundaries()
    {
        var result = Parse("[1000,1000](1000,1000,0)hello(2500,0,0)", "lyrics.yrc");
        var line = Assert.Single(result.Lyrics.Lines);
        Assert.Equal("hello", line.Text); Assert.Single(line.Cues); Assert.Equal(25_000_000, line.End);
        Assert.Throws<WorkflowException>(() => Parse("[1000,1000](1000,1000,0)", "lyrics.yrc"));
    }
    [Theory]
    [InlineData("<heart>\nhello")]
    [InlineData("{hello}\nworld")]
    [InlineData("[Voice: Alice]\nhello")]
    public void ExplicitTextPreservesLiteralStructuredLookingContent(string text)
    {
        var result = Parse(text, "lyrics.xml", "txt");
        Assert.Equal(text.Split('\n'), result.Lyrics.Lines.Select(l => l.Text));
        Assert.Equal("txt", JsonDocument.Parse(result.Raw.RawResponse).RootElement.GetProperty("formatChoice").GetString());
    }
    [Theory]
    [InlineData("hello", "qrc")]
    [InlineData("[1000,1000]<0,1000,0>hello", "yrc")]
    [InlineData("[00:01.00]hello", "unknown")]
    [InlineData("<html>hello</html>", "ttml")]
    public void ExplicitFormatsNeverFallBackToAnotherInterpretation(string text, string format) => Assert.Throws<WorkflowException>(() => Parse(text, "lyrics.txt", format));
    [Fact]
    public void TtmlPreservesLeadingInterstitialAndTrailingUntimedText()
    {
        var result = Parse(Ttml("<p begin=\"1s\" end=\"4s\">hello <span begin=\"2s\" end=\"3s\">world</span> goodbye</p>"), "lyrics.ttml");
        var line = Assert.Single(result.Lyrics.Lines); var cue = Assert.Single(line.Cues);
        Assert.Equal("hello world goodbye", line.Text); Assert.Equal(6, cue.Position); Assert.Equal(11, cue.EndPosition);
        Assert.Equal(20_000_000, cue.Start); Assert.Equal(30_000_000, cue.End);
        Assert.Contains(result.Warnings, w => w.Code == "untimed_text_preserved");
    }
    [Fact]
    public void TtmlMissingEndsUseExplicitBoundariesOtherwiseStayOpen()
    {
        var bounded = Parse(Ttml("<p begin=\"1s\" end=\"3s\"><span begin=\"2s\">hello</span></p>"), "lyrics.ttml");
        Assert.Equal(30_000_000, Assert.Single(Assert.Single(bounded.Lyrics.Lines).Cues).End);
        var open = Parse(Ttml("<p begin=\"1s\"><span begin=\"2s\">hello</span></p>"), "lyrics.ttml");
        Assert.Null(Assert.Single(Assert.Single(open.Lyrics.Lines).Cues).End);
        Assert.Contains(open.Warnings, w => w.Code == "unresolved_timing");
        var duration = Parse(Ttml("<p begin=\"1s\"><span begin=\"2s\" dur=\"500ms\">hello</span></p>"), "lyrics.ttml");
        Assert.Equal(25_000_000, Assert.Single(Assert.Single(duration.Lyrics.Lines).Cues).End);
    }
    [Theory]
    [InlineData("<p>hello</p>", "")]
    [InlineData("<div begin=\"1s\"><p begin=\"2s\">hello</p></div>", "")]
    [InlineData("<div timeContainer=\"seq\"><p begin=\"1s\">hello</p></div>", "")]
    [InlineData("<p begin=\"30f\">hello</p>", "")]
    [InlineData("<p begin=\"1s\">hello</p>", "xmlns:ttp=\"http://www.w3.org/ns/ttml#parameter\" ttp:timeBase=\"smpte\"")]
    public void UnsupportedTtmlTimingIsRejectedWithAnXmlLocation(string content, string attrs)
    {
        var error = Assert.Throws<WorkflowException>(() => Parse(Ttml(content, attrs), "lyrics.ttml"));
        Assert.Contains("TTML line", error.Message);
    }
    [Fact]
    public void TtmlBackgroundTextAndTranslationStayWithTheirOriginal()
    {
        var text = "<tt xmlns=\"http://www.w3.org/ns/ttml\" xmlns:ttm=\"http://www.w3.org/ns/ttml#metadata\" xmlns:i=\"http://music.apple.com/lyric-ttml-internal\"><head><metadata><i:translation type=\"subtitle\" xml:lang=\"zh\"><i:text for=\"L1\">你好</i:text></i:translation></metadata></head><body><p begin=\"1s\" end=\"3s\" i:key=\"L1\"><span begin=\"1s\" end=\"2s\">hello</span><span ttm:role=\"x-bg\">(back <span begin=\"2s\" end=\"3s\">vocal</span>)</span></p></body></tt>";
        var line = Assert.Single(Parse(text, "lyrics.ttml").Lyrics.Lines);
        Assert.Equal("hello", line.Text); Assert.Equal("(back vocal)", line.Background!.Text); Assert.Equal("你好", line.Translations["zh"]);
    }
    [Fact]
    public void UnmatchedAndAmbiguousSuppliedRowsRejectTheWholeImport()
    {
        foreach (var original in new[] { "[1000,1000](1000,1000,0)hello", "[1000,1000](1000,1000,0)hello\n[1000,1000](1000,1000,0)other" })
        {
            var translation = original.Contains('\n') ? "[00:01.00]translated" : "[00:04.00]translated";
            var input = JsonSerializer.Serialize(new { yrc = new { lyric = original }, ytlrc = new { lyric = translation } });
            var error = Assert.Throws<WorkflowException>(() => Parse(input, "lyrics.json"));
            Assert.Contains("ytlrc.lyric", error.Message); Assert.Contains("Line 1", error.Message);
        }
    }
    [Fact]
    public void ErrorDetailsAreBoundedWithoutAcceptingPartialRows()
    {
        var error = Assert.Throws<WorkflowException>(() => Parse("[00:01.00]valid\n" + string.Join('\n', Enumerable.Repeat("[xx:00]broken", 30))));
        Assert.Equal(30, error.IssueCount); Assert.Equal(20, error.Issues!.Count); Assert.Contains("Line 2", error.Message);
    }
    [Fact]
    public void RepeatedTimestampExpansionRemainsAllowedAndObservable()
    {
        var text = string.Concat(Enumerable.Repeat("[00:01.00]", 200)) + new string('x', 2000);
        var result = Parse(text);
        Assert.Equal(4000, text.Length); Assert.Equal(200, result.LineCount);
        Assert.Equal(400000, result.Lyrics.Lines.Sum(l => l.Text.Length));
    }

    [Fact]
    public void DecreasingEnhancedStartsPreserveBothWordsWithoutInventingNegativeDuration()
    {
        var result = Parse("[00:01.00]<00:01.50>first<00:01.00>second");
        var line = Assert.Single(result.Lyrics.Lines);
        Assert.Equal("firstsecond", line.Text);
        Assert.Equal(new long[] { 15_000_000, 10_000_000 }, line.Cues.Select(c => c.Start));
        Assert.Null(line.Cues[0].End);
        Assert.Contains(result.Warnings, w => w.Code == "unresolved_timing");
    }
    [Fact]
    public void WordFormatDelimitersDoNotRejectLiteralNumbersInOtherBrackets()
    {
        Assert.Equal("(123, hello)", Assert.Single(Parse("[1000,1000]<0,1000,0>(123, hello)", "lyrics.krc").Lyrics.Lines).Text);
        Assert.Equal("<123, hello>", Assert.Single(Parse("[1000,1000]<123, hello>(1000,1000)", "lyrics.qrc").Lyrics.Lines).Text);
    }
    [Fact]
    public void KrcPronunciationCanIncludeAnExplicitEmptyTerminalMarker()
    {
        var language = JsonSerializer.Serialize(new { content = new[] { new { type = 0, language = 0, lyricContent = new[] { new[] { "reading", "" } } } } });
        var text = "[LANGUAGE:" + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(language)) + "]\n[1000,1000]<0,1000,0>hello<1500,0,0>";
        var line = Assert.Single(Parse(text, "lyrics.krc").Lyrics.Lines);
        Assert.Equal("hello", line.Text); Assert.Equal("reading", line.Pronunciation); Assert.Single(line.Cues);
        Assert.Equal(25_000_000, line.End);
    }
    [Fact]
    public void UntimedWhitespaceBetweenTtmlWordsIsNotAnImportWarning()
    {
        var result = Parse(Ttml("<p begin=\"1s\" end=\"3s\"><span begin=\"1s\" end=\"2s\">hello</span> <span begin=\"2s\" end=\"3s\">world</span></p>"), "lyrics.ttml");
        Assert.Equal("hello world", Assert.Single(result.Lyrics.Lines).Text);
        Assert.DoesNotContain(result.Warnings, w => w.Code == "untimed_text_preserved");
    }
    [Fact]
    public void AbsoluteBodyDurationCanSupplyAnExplicitSpanEnd()
    {
        var result = Parse("<tt xmlns=\"http://www.w3.org/ns/ttml\"><body dur=\"3s\"><p begin=\"1s\"><span begin=\"2s\">hello</span></p></body></tt>", "lyrics.ttml");
        Assert.Equal(30_000_000, Assert.Single(Assert.Single(result.Lyrics.Lines).Cues).End);
    }
    [Fact]
    public void LyricifyImplicitBackgroundAndJapaneseLanguageRemainAvailable()
    {
        var result = Parse("[lang:ja]\n[0]日本語(1000,1000)\n[0](back)(1500,500)", "lyrics.lys");
        Assert.Equal("(back)", Assert.Single(result.Lyrics.Lines).Background!.Text);
        Assert.Equal("ja", result.Lyrics.Language);
    }
    [Fact]
    public void RichsyncPreservesOverlappingStartsAndReportsItsJsonLocations()
    {
        var body = "[{\"ts\":1,\"te\":2,\"x\":\"abc\",\"l\":[{\"c\":\"a\",\"o\":0},{\"c\":\"b\",\"o\":-0.48},{\"c\":\"c\",\"o\":1.001}]}]";
        var json = JsonSerializer.Serialize(new { message = new { body = new { macro_calls = new Dictionary<string, object> { ["track.richsync.get"] = new { message = new { header = new { status_code = 200 }, body = new { richsync = new { richsync_body = body } } } } } } } });
        var result = Parse(json, "lyrics.json"); var line = Assert.Single(result.Lyrics.Lines);
        Assert.Equal("abc", line.Text); Assert.Equal(new long[] { 10_000_000, 5_200_000, 20_010_000 }, line.Cues.Select(c => c.Start));
        Assert.Null(line.Cues[0].End); Assert.Null(line.Cues[2].End);
        Assert.Contains(result.Warnings, w => w.Code == "line_bounds_expanded" && w.Location!.Contains("richsync_body[0]"));
    }

    [Fact]
    public void ExplicitLrcInterpretationDoesNotDependOnAutomaticDetectionHints()
    {
        var result = Parse("[00:01.00]literal [type:LyricifyLines]", "lyrics.txt", "lrc");
        Assert.Equal("literal [type:LyricifyLines]", Assert.Single(result.Lyrics.Lines).Text);
    }

    [Fact]
    public void DuplicateJsonFieldsCannotSilentlyReplaceOriginalLyrics()
    {
        var error = Assert.Throws<WorkflowException>(() => Parse("{\"lyrics\":{\"syncType\":\"LINE_SYNCED\",\"lines\":[{\"startTimeMs\":\"1000\",\"words\":\"original\",\"words\":\"replacement\"}]}}", "lyrics.json"));
        Assert.Contains("JSON line", error.Message);
        Assert.NotEmpty(error.Issues!);
    }
    [Fact]
    public void UnusedFrameDeclarationsDoNotRejectAbsoluteSecondBasedLyrics()
    {
        var result = Parse(Ttml("<p begin=\"1s\" end=\"2s\">hello</p>", "xmlns:ttp=\"http://www.w3.org/ns/ttml#parameter\" ttp:frameRate=\"30\""), "lyrics.ttml");
        Assert.Equal(10_000_000, Assert.Single(result.Lyrics.Lines).Start);
    }

    [Fact]
    public void EmptyPreferredAuxiliaryUsesTheProvidedLegacyRowsWithTheirRealPath()
    {
        var json = JsonSerializer.Serialize(new { yrc = new { lyric = "[1000,1000](1000,1000,0)hello" }, ytlrc = new { lyric = "" }, tlyric = new { lyric = "[00:01.00]translated" } });
        Assert.Equal("translated", Assert.Single(Parse(json, "lyrics.json").Lyrics.Lines).Translations["zh"]);
        var error = Assert.Throws<WorkflowException>(() => Parse(json.Replace("[00:01.00]translated", "[00:04.00]translated"), "lyrics.json"));
        Assert.Contains("tlyric.lyric", error.Message);
    }
}
