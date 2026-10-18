namespace LyricBridge;

public interface IPreferenceRepository
{
    Preferences? AccountPreferences(Guid user);
    void SaveAccountPreferences(Guid user, Preferences preferences);
    SongLanguagePreferences SongPreferences(Guid user, Guid item);
    void SaveSongPreferences(Guid user, Guid item, SongLanguagePreferences? preferences);
}
