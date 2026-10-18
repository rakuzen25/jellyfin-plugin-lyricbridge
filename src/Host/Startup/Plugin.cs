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

public sealed partial class Plugin : BasePlugin<Configuration>, IHasWebPages
{
    public static Plugin Instance { get; private set; } = null!;
    public event Action? ConfigurationUpdated;
    private readonly object configurationGate = new();
    private bool dataMaintenance;
    public void BeginDataMaintenance()
    {
        lock (configurationGate)
        {
            if (dataMaintenance) throw new WorkflowException(409, "reset_in_progress", "A data reset is already running.");
            dataMaintenance = true;
        }
    }
    public void EndDataMaintenance() { lock (configurationGate) dataMaintenance = false; }
    public void ResetDataConfiguration(string activePath)
    {
        lock (configurationGate)
        {
            if (!dataMaintenance) throw new InvalidOperationException("Factory reset requires exclusive maintenance.");
            var defaults = new Configuration { StoragePath = Path.GetFullPath(activePath) == Path.GetFullPath(DataDirectory) ? "" : activePath };
            base.UpdateConfiguration(defaults);
            settingsEpoch = Guid.NewGuid().ToString("N");
            ConfigurationUpdated?.Invoke();
        }
    }
    public string DataDirectory
    {
        get;
    }
    public Plugin(IApplicationPaths paths, IXmlSerializer serializer) : base(paths, serializer)
    {
        Instance = this;
        DataDirectory = Path.Combine(paths.DataPath, "LyricBridge");
        Directory.CreateDirectory(DataDirectory);
    }
    private static string Metadata(string key) => typeof(Plugin).Assembly.GetCustomAttributes<System.Reflection.AssemblyMetadataAttribute>().Single(a => a.Key == key).Value!;
    public override string Name => Metadata("LyricBridgeName");
    public override Guid Id => Guid.Parse(Metadata("LyricBridgeGuid"));
    public override void UpdateConfiguration(BasePluginConfiguration configuration)
    {
        lock (configurationGate)
        {
            if (dataMaintenance) throw new WorkflowException(409, "reset_in_progress", "Settings cannot be saved during a data reset.");
            var value = (Configuration)configuration;
            if (!string.IsNullOrWhiteSpace(value.StoragePath) && !Path.IsPathFullyQualified(value.StoragePath))
                throw new ArgumentException("Storage must be an absolute container path.");
            if (value.MinimumMatch is < -1 or > 100 || value.UserRequestDailyQuota is < 1 or > 1000 || value.UserRequestActiveCap is < 1 or > 100)
                throw new ArgumentException("Invalid score or generation limits.");
            if (value.Defaults == null || value.Sources == null || value.Services == null || value.Sources.Any(s => s is null) || value.Services.Any(s => s is null) || value.Sources.Select(s => s.Name).Distinct().Count() != value.Sources.Length || value.Services.Select(s => s.Name).Distinct().Count() != value.Services.Length)
                throw new ArgumentException("Invalid source configuration.");
            string[] sourceNames = ["QQ", "NetEase", "Kugou", "Soda", "Musixmatch", "Spotify", "AppleMusic", "LRCLIB"];
            string[] serviceNames = ["Google", "DeepL", "AI", "LibreTranslate"];
            if (value.Sources.Any(s => !sourceNames.Contains(s.Name)) || value.Services.Any(s => !serviceNames.Contains(s.Name)))
                throw new ArgumentException("Unknown source or language service.");
            if (value.Services.Any(s => s.ContextBefore is < 0 or > 10 || s.ContextAfter is < 0 or > 10))
                throw new ArgumentException("Context counts must be between 0 and 10.");
            if (value.Services.Any(s => !LanguageServices.ReasoningLevels.Contains(s.ReasoningEffort)))
                throw new ArgumentException("Invalid AI thinking level.");
            if (value.Services.Any(s => s.TimeoutSeconds is < 5 or > 600))
                throw new ArgumentException("Service HTTP timeouts must be between 5 and 600 seconds.");
            if (value.Services.Any(s => !string.IsNullOrWhiteSpace(s.Endpoint) && (!Uri.TryCreate(s.Endpoint, UriKind.Absolute, out var endpoint) || endpoint.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(endpoint.UserInfo) || !string.IsNullOrEmpty(endpoint.Fragment))))
                throw new ArgumentException("Service endpoints must be HTTP(S) URLs without embedded credentials or fragments.");
            if (value.Transcription is null || value.Transcription.Review is null) throw new ArgumentException("Invalid transcription configuration.");
            value.ServiceSetup.Validate(Configuration?.ServiceSetup);
            PreferenceService.Validate(value.Defaults);
            base.UpdateConfiguration(configuration);
            settingsEpoch = Guid.NewGuid().ToString("N");
            ConfigurationUpdated?.Invoke();
        }
    }
    public IEnumerable<PluginPageInfo> GetPages() => [new() { Name = "lyricbridge", EmbeddedResourcePath = "Jellyfin.Plugin.LyricBridge.Web.config.html" }];
}
