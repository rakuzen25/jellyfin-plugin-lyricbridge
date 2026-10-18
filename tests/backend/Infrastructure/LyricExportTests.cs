using System.IO.Compression;
using System.Text;
using LyricBridge;
using Xunit;

public sealed class LyricExportTests
{
    private static readonly Candidate Candidate = new("Imported", "local", "Song", "Artist", "", null, 100);
    private static NativeLyricDocument Document() => new(LyricExport.Schema, 1, "100ns",
        new()
        {
            Source = "Fixture",
            Title = "Song",
            Artist = "Artist",
            Language = "ja",
            Lines = [
            new() { Id = "first", Text = "日😀本", Language = "ja", Alignment = "Left", Start = -1234567, End = 123456789,
                Cues = [new(0, 1, -1234567, 1000001), new(1, 3, 2345678, null), new(3, 4, 1234567, 123456789)],
                Translations = new() { ["zh-Hans"] = "日本" }, Pronunciation = "nihon",
                Background = new() { Id = "bg", Text = "背景", Language = "ja", Start = 0, End = 1000000 } },
            new() { Id = "untimed", Text = "終わり", Language = "ja", Translations = new() { ["en"] = "End" } }
        ]
        }, new(new() { ["first"] = "Selected translation", ["untimed"] = "End" }, new() { ["bg"] = "haikei" }),
        new("auto", "en", "Traditional", 0.125));
    private static ImportedLyrics Import(ExportArtifact artifact) => LyricImport.Parse(new(FileName: artifact.FileName, FileBytes: Convert.ToBase64String(artifact.Bytes)), Candidate, TestContext.Current.CancellationToken);
    [Fact]
    public void NativeRoundTripPreservesEveryCompositionField()
    {
        var doc = Document();
        var file = LyricExport.Create(doc, new("lyricbridge"));
        var imported = Import(file);
        Assert.NotNull(imported.Native);
        Assert.Equal(LyricExport.NativeText(doc), LyricExport.NativeText(imported.Native));
        Assert.Equal(new[] { "first", "untimed" }, imported.Lyrics.Lines.Select(l => l.Id));
        Assert.DoesNotContain("\"hash\"", Encoding.UTF8.GetString(file.Bytes));
        Assert.DoesNotContain("\"manual\"", Encoding.UTF8.GetString(file.Bytes));
    }
    [Theory]
    [InlineData("txt")]
    [InlineData("lrc")]
    [InlineData("elrc")]
    public void LosslessBundlesRestoreComplexLyricsRegardlessOfCompatibilityLosses(string format)
    {
        var doc = Document(); var file = LyricExport.Create(doc, new(format, "zip", true, true));
        using var zip = new ZipArchive(new MemoryStream(file.Bytes));
        Assert.Equal(5, zip.Entries.Count);
        Assert.NotEmpty(file.Preview.Warnings);
        Assert.Equal(LyricExport.NativeText(doc), LyricExport.NativeText(Import(file).Native!));
    }
    [Theory]
    [InlineData("txt")]
    [InlineData("lrc")]
    [InlineData("elrc")]
    public void CompatibilityOnlyBundlesImportCompanions(string format)
    {
        var doc = Document() with { Lyrics = new() { Title = "Plain", Lines = [new() { Id = "one", Text = "Hello", Start = 10000000 }, new() { Id = "two", Text = "World", Start = 20000000 }] }, Selected = new(new() { ["two"] = "Monde" }, new() { ["one"] = "helo" }) };
        var file = LyricExport.Create(doc, new(format, "zip", true, true, false));
        var imported = Import(file);
        Assert.Null(imported.Native);
        Assert.Equal("Monde", imported.Lyrics.Lines[1].Translations["en"]);
        Assert.Equal("helo", imported.Lyrics.Lines[0].Pronunciation);
        Assert.Contains(imported.Warnings, w => w.Code == "compatibility_bundle");
    }
    [Fact]
    public void CorrectedCompatibilityTimesAndWarningsAreExplicit()
    {
        var file = LyricExport.Create(Document(), new("elrc")); var text = Encoding.UTF8.GetString(file.Bytes);
        Assert.Contains("[00:00.002]", text);
        Assert.Contains("<00:00.360>", text);
        Assert.Contains(file.Preview.Warnings, w => w.Code == "timing_rounded");
        Assert.Contains(file.Preview.Warnings, w => w.Code == "cue_overlap");
        var negative = LyricExport.Create(Document() with { Playback = Document().Playback with { TimingSeconds = 0 } }, new("lrc"));
        Assert.Contains(negative.Preview.Warnings, w => w.Code == "negative_clamped");
        Assert.Contains(negative.Preview.Warnings, w => w.Code == "untimed_rows");
    }
    [Theory]
    [InlineData("lrc")]
    [InlineData("elrc")]
    public void StandaloneTimedExportsImportMixedTimedAndUntimedRows(string format)
    {
        var file = LyricExport.Create(Document(), new(format));
        var imported = Import(file);
        Assert.Equal(3, imported.Lyrics.Lines.Count);
        Assert.Contains(imported.Lyrics.Lines, l => l.Text == "終わり" && l.Start == null);
    }
    [Fact]
    public void PreviewFingerprintIncludesOptionsTextInterpretationAndSelectionIdentity()
    {
        var doc = Document(); var input = new ExportInput("lrc"); var first = LyricExport.Create(doc, input, "choice-a");
        var admitted = input with { Fingerprint = first.Preview.Fingerprint };
        Assert.Equal(first.Bytes, LyricExport.Create(doc, admitted, "choice-a").Bytes);
        Assert.Equal(409, Assert.Throws<WorkflowException>(() => LyricExport.Create(doc, admitted, "choice-b")).Status);
        Assert.Throws<WorkflowException>(() => LyricExport.Create(doc, admitted with { Format = "txt" }, "choice-a"));
        Assert.Throws<WorkflowException>(() => LyricExport.Create(doc with { Playback = doc.Playback with { TimingSeconds = 1 } }, admitted, "choice-a"));
    }
    [Fact]
    public void NativeImportRejectsUnknownVersionsDuplicatePropertiesAndInvalidUnicodeCues()
    {
        var doc = Document(); var text = LyricExport.NativeText(doc);
        Assert.Throws<WorkflowException>(() => LyricImport.Parse(new(Text: text.Replace("\"version\":1", "\"version\":2"), Format: "lyricbridge"), Candidate, TestContext.Current.CancellationToken));
        Assert.Throws<WorkflowException>(() => LyricImport.Parse(new(Text: text.Replace("\"version\":1", "\"version\":1,\"version\":1"), Format: "lyricbridge"), Candidate, TestContext.Current.CancellationToken));
        doc.Lyrics.Lines[0].Cues = [new(1, 2, 0, null)];
        Assert.Throws<WorkflowException>(() => LyricImport.Parse(new(Text: LyricExport.NativeText(doc), Format: "lyricbridge"), Candidate, TestContext.Current.CancellationToken));
        Assert.Throws<WorkflowException>(() => LyricImport.Parse(new(Text: "{}", Format: "lyricbridge"), Candidate, TestContext.Current.CancellationToken));
    }
    [Fact]
    public void NativeImportUsesLargerLimitWhileOrdinaryImportsKeepOneMegabyteLimit()
    {
        var doc = Document(); doc.Lyrics.Lines = [new() { Id = "large", Text = new string('x', 1_000_001) }];
        doc = doc with { Selected = new(new(), new()) };
        Assert.Single(Import(LyricExport.Create(doc, new("lyricbridge"))).Lyrics.Lines);
        Assert.Throws<WorkflowException>(() => LyricImport.Parse(new(Text: new string('x', 1_000_001), Format: "txt"), Candidate, TestContext.Current.CancellationToken));
        Assert.Throws<WorkflowException>(() => LyricExport.Create(doc, new("txt")));
    }
    [Fact]
    public void SmartPreferencesInheritMatchingAutoAndOnlyOverrideDifferences()
    {
        var doc = Document() with { Playback = Document().Playback with { SourceLanguage = "ja" } };
        Assert.Equal(new SongLanguagePreferences(), ExportPreferences.Restore(doc, new() { SourceLanguage = "auto", TranslationLanguage = "en" }));
        Assert.Equal("ja", ExportPreferences.Restore(doc, new() { SourceLanguage = "ko" }).SourceLanguage);
        Assert.Null(ExportPreferences.Restore(doc, new() { SourceLanguage = "ja-JP" }).SourceLanguage);
        Assert.Null(ExportPreferences.Restore(doc, new() { TranslationLanguage = "en-US" }).TranslationLanguage);
        doc.Lyrics.Lines = [new() { Id = "zh", Text = "中文", Language = "zh" }];
        doc = doc with { Playback = doc.Playback with { SourceLanguage = "auto" } };
        Assert.Equal("Traditional", ExportPreferences.Restore(doc, new()).OriginalChineseScript);
        Assert.Null(ExportPreferences.Restore(doc, new() { OriginalChineseScript = "Traditional" }).OriginalChineseScript);
    }
    [Theory]
    [InlineData("../lyrics.txt")]
    [InlineData("lyrics.zip")]
    [InlineData("folder/lyrics.txt")]
    public void BundleRejectsUnsafeOrNestedEntries(string name)
    {
        using var memory = new MemoryStream();
        using (var zip = new ZipArchive(memory, ZipArchiveMode.Create, true))
        {
            using (var writer = new StreamWriter(zip.CreateEntry(name).Open())) writer.Write("hi");
            using (var writer = new StreamWriter(zip.CreateEntry("lyricbridge-manifest.json").Open())) writer.Write("{}");
        }
        Assert.Throws<WorkflowException>(() => LyricImport.Parse(new(FileName: "unsafe.zip", FileBytes: Convert.ToBase64String(memory.ToArray())), Candidate, TestContext.Current.CancellationToken));
    }
}
