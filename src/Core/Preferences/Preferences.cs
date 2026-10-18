using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
namespace LyricBridge;

public sealed class Preferences
{
    public string TranslationLanguage { get; set; } = "zh-Hans";
    public string SourceLanguage { get; set; } = "auto";
    public bool ShowTranslation { get; set; } = true;
    public bool ShowPronunciation { get; set; } = true;
    public bool JapaneseRomaji { get; set; } = true;
    public string OriginalChineseScript { get; set; } = "Simplified";
    public string RomanizationSystem { get; set; } = "Hepburn";
    public string RowOrder { get; set; } = "pronunciation-first";
    public int OriginalSize { get; set; } = 40;
    public int PronunciationSize { get; set; } = 24;
    public int TranslationSize { get; set; } = 24;
    public int RowSpacing { get; set; } = 6;
}

public sealed record SongLanguagePreferences(string? SourceLanguage = null, string? TranslationLanguage = null, string? OriginalChineseScript = null)
{
    public Preferences Apply(Preferences account)
    {
        var effective = Codec.Deserialize<Preferences>(Codec.Serialize(account))!;
        effective.SourceLanguage = SourceLanguage ?? account.SourceLanguage;
        effective.TranslationLanguage = TranslationLanguage ?? account.TranslationLanguage;
        effective.OriginalChineseScript = OriginalChineseScript ?? account.OriginalChineseScript;
        return effective;
    }
}
