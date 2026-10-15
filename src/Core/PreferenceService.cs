using System.Text.RegularExpressions;

namespace LyricBridge;

public sealed class PreferenceService(IPreferenceRepository repository, Func<Preferences> defaults)
{
    public Preferences Account(Guid user) => repository.AccountPreferences(user) ?? Codec.Deserialize<Preferences>(Codec.Serialize(defaults()))!;
    public SongLanguagePreferences Song(Guid user, Guid item) => repository.SongPreferences(user, item);
    public Preferences Effective(Guid user, Guid item) => Song(user, item).Apply(Account(user));
    public void Save(Guid user, Preferences preferences)
    {
        Validate(preferences);
        repository.SaveAccountPreferences(user, preferences);
    }
    public void SaveSong(Guid user, Guid item, SongLanguagePreferences? preferences)
    {
        if (preferences is not null &&
            ((preferences.SourceLanguage is not null && !LanguageTag(preferences.SourceLanguage)) ||
             (preferences.TranslationLanguage is not null && (!LanguageTag(preferences.TranslationLanguage) || preferences.TranslationLanguage == "auto"))))
            throw new ArgumentException("Choose a valid original and translation language.");
        repository.SaveSongPreferences(user, item, preferences);
    }
    public static void Validate(Preferences preferences)
    {
        if (preferences.OriginalSize is < 12 or > 100 || preferences.PronunciationSize is < 10 or > 80 ||
            preferences.TranslationSize is < 10 or > 80 || preferences.RowSpacing is < 0 or > 50 ||
            preferences.OriginalChineseScript is not ("Simplified" or "Traditional") ||
            preferences.RomanizationSystem is not ("Hepburn" or "Passport" or "Nippon") ||
            preferences.RowOrder is not ("pronunciation-first" or "translation-first") ||
            !LanguageTag(preferences.TranslationLanguage) || preferences.TranslationLanguage == "auto" || !LanguageTag(preferences.SourceLanguage))
            throw new ArgumentException("Check language choices and row sizes.");
    }
    public static bool LanguageTag(string? value) => !string.IsNullOrWhiteSpace(value) && value.Length <= 35 &&
        Regex.IsMatch(value, "^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$", RegexOptions.NonBacktracking | RegexOptions.CultureInvariant);
}
