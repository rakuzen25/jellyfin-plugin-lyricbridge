using System.Reflection;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
namespace LyricBridge;

public sealed class Configuration : BasePluginConfiguration
{
    private ServiceSetup? serviceSetup;
    public ServiceSetup ServiceSetup { get => serviceSetup ?? LyricBridge.ServiceSetup.Migrate(Services, Transcription); set => serviceSetup = value; }
    public TranscriptionConfig Transcription { get; set; } = new();
    public bool EnableWebRenderer { get; set; } = true;
    public string StoragePath { get; set; } = "";
    public SourceConfig[] Sources { get; set; } = new[] { "QQ", "NetEase", "Kugou", "Soda", "Musixmatch", "Spotify", "AppleMusic", "LRCLIB" }.Select(n => new SourceConfig { Name = n }).ToArray();
    public int MinimumMatch { get; set; } = 70;
    public bool ScheduledRetrieval
    {
        get; set;
    }
    public bool AutoGeneratePronunciation { get; set; } = true;
    public bool AllowUserRequests
    {
        get; set;
    }
    public bool AutoApproveUserRequests
    {
        get; set;
    }
    public int UserRequestDailyQuota { get; set; } = 5;
    public int UserRequestActiveCap { get; set; } = 3;
    public Preferences Defaults { get; set; } = new();
    public ServiceConfig[] Services { get; set; } = new[] { "Google", "DeepL", "AI", "LibreTranslate" }.Select(n => new ServiceConfig { Name = n }).ToArray();
}
