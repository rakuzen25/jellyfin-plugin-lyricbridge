namespace LyricBridge;

public sealed class SourceConfig
{
    public string Name { get; set; } = "";
    public bool Enabled { get; set; } = true;
    public string Credential { get; set; } = "";
    public static SourceConfig[] Defaults() => new[] { "QQ", "NetEase", "Kugou", "Soda", "Musixmatch", "Spotify", "AppleMusic", "LRCLIB" }.Select(n => new SourceConfig { Name = n }).ToArray();
}
