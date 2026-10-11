namespace LyricBridge;

public sealed partial class Store : IPreferenceRepository
{
    public Preferences? AccountPreferences(Guid user) => Get<Preferences>("preferences", user.ToString("N"));
    public void SaveAccountPreferences(Guid user, Preferences preferences) => Put("preferences", user.ToString("N"), preferences);
    public SongLanguagePreferences SongPreferences(Guid user, Guid item) => Get<SongLanguagePreferences>("song-preferences", SongKey(user, item)) ?? new();
    public void SaveSongPreferences(Guid user, Guid item, SongLanguagePreferences? preferences)
    {
        if (preferences is null) Delete("song-preferences", SongKey(user, item));
        else Put("song-preferences", SongKey(user, item), preferences);
    }
    private static string SongKey(Guid user, Guid item) => user.ToString("N") + ":" + item.ToString("N");
}
