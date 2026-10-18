using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
namespace LyricBridge;

public static class Codec
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { PropertyNameCaseInsensitive = true };
    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Json);
    public static T? Deserialize<T>(string text) => JsonSerializer.Deserialize<T>(text, Json);
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    public static string ContentHash(RichLyrics lyrics) => Hash(Serialize(new { lyrics.Source, lyrics.ProviderId, lyrics.Lines }));
}
