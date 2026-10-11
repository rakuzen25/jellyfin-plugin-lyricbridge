using LyricBridge;
public static class SongPreferencesTests
{
    public static void Run(string root)
    {
        var account = new Preferences { SourceLanguage = "ja", TranslationLanguage = "zh-Hans", OriginalSize = 52 };
        var inherited = new SongLanguagePreferences().Apply(account);
        if (inherited.SourceLanguage != "ja" || inherited.TranslationLanguage != "zh-Hans") throw new Exception("inherit account languages");
        var explicitAuto = new SongLanguagePreferences("auto", "ar").Apply(account);
        if (explicitAuto.SourceLanguage != "auto" || explicitAuto.TranslationLanguage != "ar" || explicitAuto.OriginalSize != 52 || account.SourceLanguage != "ja") throw new Exception("explicit auto and immutable account preferences");
        var store = new Store(Path.Combine(root, "song-preferences")); store.Put("song-preferences", "a:item", new SongLanguagePreferences("auto", "ar"));
        if (new Store(Path.Combine(root, "song-preferences")).Get<SongLanguagePreferences>("song-preferences", "a:item")?.TranslationLanguage != "ar") throw new Exception("durable override");
        if (store.Get<SongLanguagePreferences>("song-preferences", "b:item") != null) throw new Exception("user isolation");
        Console.WriteLine("PASS: inherited song languages, explicit Auto, account immutability and durable user isolation.");
    }
}
