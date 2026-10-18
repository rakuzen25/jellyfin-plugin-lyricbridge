using LyricBridge;

/// <summary>Explicit language-worker inputs, without Jellyfin configuration or a plugin.</summary>
public class LanguageFixture : StorageFixture
{
    protected ServiceConfig[] Services { get; } = new[] { "Google", "DeepL", "AI", "LibreTranslate" }.Select(name => new ServiceConfig { Name = name }).ToArray();
    protected bool AllowUserRequests { get; set; }
    public override GenerationPolicy Policy() => new(AllowUserRequests, false, 5, 3);
}
