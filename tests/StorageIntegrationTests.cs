using LyricBridge;
using Xunit;

public sealed class StorageIntegrationTests
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
                connection.Open();
                using var command = connection.CreateCommand();
                command.CommandText = $"PRAGMA user_version={schema}; CREATE TABLE records(kind TEXT,id TEXT,payload TEXT); INSERT INTO records VALUES('preferences','fixture','{{}}');";
                command.ExecuteNonQuery();
            }
            using var store = new Store(root);
            var error = Xunit.Assert.Throws<InvalidDataException>(() => store.All<Job>("job"));
            Xunit.Assert.Contains("back up", error.Message);
            using (var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=" + Path.Combine(root, "index.sqlite")))
            {
                connection.Open();
                using var command = connection.CreateCommand();
                command.CommandText = "SELECT count(*) FROM records";
                Xunit.Assert.Equal(1L, (long)command.ExecuteScalar()!);
                command.CommandText = "PRAGMA user_version";
                Xunit.Assert.Equal((long)schema, (long)command.ExecuteScalar()!);
            }
        }
        finally { TestHost.ClearDatabasePools(root); Directory.Delete(root, true); }
    }

    [Fact]
    public void PersistenceMultilingualAlignmentAndReadOnlyMedia()
    {
        var root = Path.Combine(Path.GetTempPath(), "lyricbridge-tests-" + Guid.NewGuid().ToString("N"));
        var storage = Path.Combine(root, "custom-storage");
        var media = Path.Combine(root, "readonly-library");
        Directory.CreateDirectory(media);
        File.WriteAllText(Path.Combine(media, "track.flac"), "fixture");
        if (!OperatingSystem.IsWindows())
            File.SetUnixFileMode(media, UnixFileMode.UserRead | UnixFileMode.UserExecute);
        try
        {
            using var store = new Store(storage);
            var item = Guid.NewGuid();
            var lyrics = Normalization.Parse(new("[00:01.00]原文\n[00:02.00]次の行", "[00:01.00]翻译\n[00:02.00]第二行", "[00:01.00]genbun\n[00:02.00]tsugi no gyou"), new("fixture", "42", "track", "artist", "album", 20000, 100));
            Assert(lyrics.Lines.Count == 2, "source parsing");
            Assert(lyrics.Lines[0].Translations["zh"] == "翻译", "translation alignment");
            Assert(lyrics.Lines[1].Pronunciation == "tsugi no gyou", "pronunciation alignment");
            store.Save(item, lyrics, new("original", "translation", "pronunciation", "raw provider response"));
            store.Put("preferences", "user", new Preferences());
            store.Put("variant", "generated", new Variant("generated", lyrics.Hash, "translation", "ar", "AI", "model", new() { { "l0", "مرحبا" }, { "l1", "العالم" } }));
            store.Put("job", "job", new Job { ItemId = item });
            using var reopened = new Store(storage);
            Assert(reopened.Get<RichLyrics>("selected", item.ToString("N"))?.Hash == lyrics.Hash, "durable selected version");
            Assert(reopened.Get<RawLyrics>("raw", lyrics.Hash)?.RawResponse == "raw provider response", "raw response retention");
            Assert(reopened.Get<Variant>("variant", "generated")?.Text["l0"] == "مرحبا", "unicode generated text");
            Assert(Directory.GetFiles(media).Length == 1, "no sidecar writes");
            Assert(File.Exists(Path.Combine(storage, "index.sqlite")), "custom path index");
            var malformed = false;
            try
            {
                Normalization.ValidateGenerated(["l0", "l1"], new() { { "l0", "text" } });
            }
            catch (InvalidDataException) { malformed = true; }
            Assert(malformed, "reject missing generated lines");
            Console.WriteLine("PASS: custom storage, read-only library, SQLite persistence, original/raw/variant separation, multilingual alignment, invalid generation mappings.");
        }
        finally
        {
            TestHost.ClearDatabasePools(root);
            if (!OperatingSystem.IsWindows())
                File.SetUnixFileMode(media, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            Directory.Delete(root, true);
        }
    }
    static void Assert(bool condition, string name)
    {
        Xunit.Assert.True(condition, name);
    }
}
