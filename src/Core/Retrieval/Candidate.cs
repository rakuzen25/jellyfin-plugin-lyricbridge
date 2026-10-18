using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
namespace LyricBridge;

public sealed record Candidate(string Source, string Id, string Title, string Artist, string Album, int? DurationMs, int Score, string? SecondaryId = null, bool? WordTiming = null, string[]? TranslationLanguages = null, bool? HasPronunciation = null, string Verification = "pending", string[]? Artists = null, string[]? AlbumArtists = null, MatchAssessment? Assessment = null);

public sealed record RawLyrics(string Original, string? Translation = null, string? Pronunciation = null, string RawResponse = "", string Type = "auto", string? Language = null, Dictionary<string, string>? AdditionalTranslations = null, bool Instrumental = false, string? InstrumentalReason = null);
