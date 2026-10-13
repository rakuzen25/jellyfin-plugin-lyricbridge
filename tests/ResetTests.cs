using LyricBridge;
public static class ResetTests
{
    public static void Run(string root)
    {
        var directory = Path.Combine(root, "reset"); var store = new Store(directory);
        store.Put("preferences", "viewer", new Preferences { TranslationLanguage = "ar" });
        store.Put("song-preferences", "viewer:item", new SongLanguagePreferences("auto", "ja"));
        foreach (var kind in new[] { "selected", "document", "raw", "variant", "job", "instrumental", "instrumental-evidence", "rejected-match", "better", "preview", "candidate", "mixed-origin", "timing-correction", "auxiliary-choice", "pronunciation-choice" }) store.Put(kind, "fixture", new { data = "DELETE-ME" });
        using var staleOperation = store.Operation();
        var epoch = store.Epoch; if (!store.BeginReset() || store.BeginReset()) throw new Exception("exclusive reset");
        if (store.Epoch == epoch) throw new Exception("reset invalidates work epoch");
        store.Put("variant", "late", new { data = "late write" });
        var count = store.ResetManagedLibrary(); store.EndReset();
        if (count != 15 || store.Get<Preferences>("preferences", "viewer")?.TranslationLanguage != "ar" || store.All<object>("variant").Count != 0) throw new Exception("reset managed records with preferences retained");
        if (store.Get<SongLanguagePreferences>("song-preferences", "viewer:item")?.TranslationLanguage != "ja") throw new Exception("song preferences survive reset");
        var bytes = File.ReadAllBytes(Path.Combine(directory, "index.sqlite")); if (System.Text.Encoding.UTF8.GetString(bytes).Contains("DELETE-ME")) throw new Exception("deleted lyric payload remained in database pages");
        store.Put("selected", "stale", new { data = "old request" }); if (store.Get<object>("selected", "stale") != null) throw new Exception("old request restored reset data");
        using var newOperation = store.Operation();
        store.Put("selected", "new", new { data = "new lyrics" }); if (store.Get<object>("selected", "new") == null) throw new Exception("retrieval usable after reset");
        Console.WriteLine("PASS: exclusive library reset, stale writes blocked, all managed kinds removed, user preferences retained and SQLite deleted pages purged.");
    }
}
