using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LyricBridge;

/// <summary>Fixed-width UTC timestamps preserve chronological SQLite text ordering.</summary>
public sealed class UtcTimestampConverter : JsonConverter<DateTime>
{
    public override DateTime Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options) => reader.GetDateTime().ToUniversalTime();

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options) =>
        writer.WriteStringValue(Format(value));

    public static string Format(DateTime value) =>
        (value.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(value, DateTimeKind.Utc) : value.ToUniversalTime())
        .ToString("O", CultureInfo.InvariantCulture);
}
