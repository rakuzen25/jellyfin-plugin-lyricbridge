using System.Text.Json;

// The documented reflection wire contract, not a shipped provider dependency.
namespace Jellyfin.Plugin.FileTransformation;

public sealed class RegistrationPayload
{
    public string Json { get; private init; } = "";
    public static RegistrationPayload Parse(string value)
    {
        using var document = JsonDocument.Parse(value);
        return new() { Json = value };
    }
}
public static class PluginInterface
{
    public static string? LastRegistration { get; private set; }
    public static void RegisterTransformation(RegistrationPayload payload) => LastRegistration = payload.Json;
}
