using LyricBridge;
using Xunit;

public sealed class RegressionSuite
{
    [Fact]
    public void PluginResourcesExcludeDevelopmentDemo()
    {
        var resources = typeof(Plugin).Assembly.GetManifestResourceNames();
        Xunit.Assert.Contains(resources, name => name.EndsWith(".config.html", StringComparison.Ordinal));
        Xunit.Assert.DoesNotContain(resources, name => name.EndsWith(".demo.html", StringComparison.Ordinal)
            || name.EndsWith(".demo.wav", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(6)]
    public void UnsupportedPreviewStorageIsNotReinterpreted(int schema)
    {
        var root = Path.Combine(Path.GetTempPath(), "lyricbridge-schema-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            using (var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=" + Path.Combine(root, "index.sqlite")))
            {
                connection.Open(); using var command = connection.CreateCommand();
                command.CommandText = $"PRAGMA user_version={schema}; CREATE TABLE records(kind TEXT,id TEXT,payload TEXT); INSERT INTO records VALUES('preferences','fixture','{{}}');";
                command.ExecuteNonQuery();
            }
            var store = new Store(root);
            var error = Xunit.Assert.Throws<InvalidDataException>(() => store.All<Job>("job"));
            Xunit.Assert.Contains("back up", error.Message);
            using (var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=" + Path.Combine(root, "index.sqlite")))
            {
                connection.Open(); using var command = connection.CreateCommand(); command.CommandText = "SELECT count(*) FROM records";
                Xunit.Assert.Equal(1L, (long)command.ExecuteScalar()!);
                command.CommandText = "PRAGMA user_version"; Xunit.Assert.Equal((long)schema, (long)command.ExecuteScalar()!);
            }
        }
        finally { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); Directory.Delete(root, true); }
    }

    [Fact]
    public void PersistenceMultilingualAlignmentAndReadOnlyMedia()
    {
        var root = Path.Combine(Path.GetTempPath(), "lyricbridge-tests-" + Guid.NewGuid().ToString("N"));
        var storage = Path.Combine(root, "custom-storage");
        var media = Path.Combine(root, "readonly-library"); Directory.CreateDirectory(media);
        File.WriteAllText(Path.Combine(media, "track.flac"), "fixture");
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(media, UnixFileMode.UserRead | UnixFileMode.UserExecute);
        try
        {
            var store = new Store(storage); var item = Guid.NewGuid();
            var lyrics = Normalization.Parse(new("[00:01.00]原文\n[00:02.00]次の行", "[00:01.00]翻译\n[00:02.00]第二行", "[00:01.00]genbun\n[00:02.00]tsugi no gyou"), new("fixture", "42", "track", "artist", "album", 20000, 100));
            Assert(lyrics.Lines.Count == 2, "source parsing"); Assert(lyrics.Lines[0].Translations["zh"] == "翻译", "translation alignment"); Assert(lyrics.Lines[1].Pronunciation == "tsugi no gyou", "pronunciation alignment");
            store.Save(item, lyrics, new("original", "translation", "pronunciation", "raw provider response"));
            store.Put("preferences", "user", new Preferences());
            store.Put("variant", "generated", new Variant("generated", lyrics.Hash, "translation", "ar", "AI", "model", new() { { "l0", "مرحبا" }, { "l1", "العالم" } }));
            store.Put("job", "job", new Job { ItemId = item });
            var reopened = new Store(storage);
            Assert(reopened.Get<RichLyrics>("selected", item.ToString("N"))?.Hash == lyrics.Hash, "durable selected version");
            Assert(reopened.Get<RawLyrics>("raw", lyrics.Hash)?.RawResponse == "raw provider response", "raw response retention");
            Assert(reopened.Get<Variant>("variant", "generated")?.Text["l0"] == "مرحبا", "unicode generated text");
            Assert(Directory.GetFiles(media).Length == 1, "no sidecar writes"); Assert(File.Exists(Path.Combine(storage, "index.sqlite")), "custom path index");
            var malformed = false; try { Normalization.ValidateGenerated(["l0", "l1"], new() { { "l0", "text" } }); } catch (InvalidDataException) { malformed = true; }
            Assert(malformed, "reject missing generated lines");
            Console.WriteLine("PASS: custom storage, read-only library, SQLite persistence, original/raw/variant separation, multilingual alignment, invalid generation mappings.");
        }
        finally
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(media, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            Directory.Delete(root, true);
        }
    }
    // Each historical scenario now has an isolated root and an independently
    // discoverable result. Keep distinct invariants until replaced by finer tests.
    private static async Task InIsolatedRoot(Func<string, Task> scenario)
    {
        var root = Path.Combine(Path.GetTempPath(), "lyricbridge-scenario-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var paths = System.Reflection.DispatchProxy.Create<MediaBrowser.Common.Configuration.IApplicationPaths, Proxy>();
            ((Proxy)(object)paths).Root = root;
            var serializer = System.Reflection.DispatchProxy.Create<MediaBrowser.Model.Serialization.IXmlSerializer, Proxy>();
            new Plugin(paths, serializer).UpdateConfiguration(new Configuration());
            await scenario(root);
        }
        finally { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); Directory.Delete(root, true); }
    }

    [Fact]
    public Task ProviderRegistryAndGenerationAdmission() => InIsolatedRoot(CoreTests.Run);

    [Fact]
    public Task ImprovementRetrievalAndPronunciation() => InIsolatedRoot(ImprovementTests.Run);

    [Fact]
    public Task RankingAndConcurrentRetrieval() => InIsolatedRoot(RankingTests.Run);

    [Fact]
    public Task ReasoningAndExecutionSettings() => InIsolatedRoot(AiThinkingTests.Run);

    [Fact]
    public Task GenerationProfilesAndSettingsChanges() => InIsolatedRoot(GenerationProfileTests.Run);

    [Fact]
    public Task VariantHistoryAndSelection() => InIsolatedRoot(VariantHistoryTests.Run);

    [Fact]
    public Task SongPreferenceIsolation() => InIsolatedRoot(root => { SongPreferencesTests.Run(root); return Task.CompletedTask; });

    [Fact]
    public Task ManagedResetPreservesPreferencesAndRejectsStaleWrites() => InIsolatedRoot(root => { ResetTests.Run(root); return Task.CompletedTask; });

    [Fact]
    public void CompositionPreservesTimingAndRejectsAmbiguousMappings() => CompositionTests.Run();

    [Fact]
    public Task ProviderContextPropagation() => InIsolatedRoot(_ => ContextTests.Run());

    [Fact]
    public Task PartialPronunciationPreservesRowIdentity() => InIsolatedRoot(_ => PartialPronunciationTests.Run());

    static void Assert(bool condition, string name) { if (!condition) throw new Exception("Failed: " + name); }

}
