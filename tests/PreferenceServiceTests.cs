using LyricBridge;
using Xunit;

public sealed class PreferenceServiceTests
{
    [Fact]
    public void DefaultsAreCopiedAndInvalidWritesNeverReachRepository()
    {
        var repository = new Repository(); var defaults = new Preferences();
        var service = new PreferenceService(repository, () => defaults);
        var account = Guid.NewGuid(); var song = Guid.NewGuid();
        var returned = service.Account(account); returned.TranslationLanguage = "ar";
        Assert.Equal("zh-Hans", service.Account(account).TranslationLanguage);
        Assert.Throws<ArgumentException>(() => service.Save(account, new() { TranslationLanguage = "auto" }));
        Assert.Throws<ArgumentException>(() => service.SaveSong(account, song, new() { TranslationLanguage = "auto" }));
        Assert.Equal(0, repository.Writes);
        service.Save(account, new() { TranslationLanguage = "ar" });
        service.SaveSong(account, song, new() { SourceLanguage = "ja" });
        Assert.Equal("ar", service.Effective(account, song).TranslationLanguage);
        Assert.Equal("ja", service.Effective(account, song).SourceLanguage);
        Assert.Equal("auto", service.Effective(account, Guid.NewGuid()).SourceLanguage);
        Assert.Equal("zh-Hans", service.Account(Guid.NewGuid()).TranslationLanguage);
        service.SaveSong(account, song, null);
        Assert.Equal("auto", service.Effective(account, song).SourceLanguage);
    }
    private sealed class Repository : IPreferenceRepository
    {
        private readonly Dictionary<Guid, Preferences> accounts = [];
        private readonly Dictionary<(Guid, Guid), SongLanguagePreferences> songs = [];
        public int Writes;
        public Preferences? AccountPreferences(Guid user) => accounts.GetValueOrDefault(user);
        public void SaveAccountPreferences(Guid user, Preferences preferences) { Writes++; accounts[user] = preferences; }
        public SongLanguagePreferences SongPreferences(Guid user, Guid item) => songs.GetValueOrDefault((user, item)) ?? new();
        public void SaveSongPreferences(Guid user, Guid item, SongLanguagePreferences? preferences) { Writes++; if (preferences is null) songs.Remove((user, item)); else songs[(user, item)] = preferences; }
    }
}
