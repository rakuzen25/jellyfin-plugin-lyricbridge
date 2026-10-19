using System.Xml.Linq;
using Microsoft.Extensions.Logging;
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
    private PluginStartupStatus startup = new("initializing", "settings");
    public PluginStartupStatus Startup => Volatile.Read(ref startup);
    public StateUpgrades Upgrades { get; }
    public string ActiveDirectory => string.IsNullOrWhiteSpace(Configuration.StoragePath) ? DataDirectory : Configuration.StoragePath;
    internal void SetStartup(PluginStartupStatus value) => Volatile.Write(ref startup, value);
    internal void BlockStartup(Exception error)
    {
        var diagnostic = Guid.NewGuid().ToString("N");
        SetStartup(Startup with { State = "blocked", Message = error.Message, DiagnosticId = diagnostic });
        startupLogger.LogError(error, "LyricBridge startup blocked during {Phase}; diagnostic {Diagnostic}; path {Path}. Preserve the affected files and use fresh state or a compatible plugin release.", Startup.Phase, diagnostic, Startup.Path);
    }
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
            CommitConfiguration(defaults);
            settingsEpoch = Guid.NewGuid().ToString("N");
            ConfigurationUpdated?.Invoke();
        }
    }
    public string DataDirectory
    {
        get;
    }
    private readonly ILogger<Plugin> startupLogger;
    public Plugin(IApplicationPaths paths, IXmlSerializer serializer, ILogger<Plugin>? logger = null) : base(paths, serializer)
    {
        startupLogger = logger ?? Microsoft.Extensions.Logging.Abstractions.NullLogger<Plugin>.Instance;
        Instance = this;
        DataDirectory = Path.Combine(paths.DataPath, "LyricBridge");
        Upgrades = new StateUpgrades(Path.Combine(DataDirectory, "state-upgrades"), Version.ToString());
        Configuration = new Configuration();
        SetStartup(new("initializing", "settings", Path: ConfigurationFilePath));
        try
        {
            Upgrades.Settings(ConfigurationFilePath, Configuration.CurrentSchema, document => ValidateConfiguration(ReadSettings(document)), () => SaveSettings(Configuration));
            Configuration = ReadSettings(XDocument.Load(ConfigurationFilePath));
        }
        catch (Exception error) { BlockStartup(error); }
    }
    private static string Metadata(string key) => typeof(Plugin).Assembly.GetCustomAttributes<System.Reflection.AssemblyMetadataAttribute>().Single(a => a.Key == key).Value!;
    public override string Name => Metadata("LyricBridgeName");
    public override Guid Id => Guid.Parse(Metadata("LyricBridgeGuid"));
    public override void UpdateConfiguration(BasePluginConfiguration configuration)
    {
        lock (configurationGate)
        {
            if (dataMaintenance) throw new WorkflowException(409, "reset_in_progress", "Settings cannot be saved during a data reset.");
            if (Startup.State != "ready") throw new InvalidOperationException("Plugin startup is not ready. Inspect startup status before saving settings.");
            var value = (Configuration)configuration;
            ValidateConfiguration(value);
            value.ServiceSetup.Validate(Configuration.ServiceSetup);
            CommitConfiguration(value);
            settingsEpoch = Guid.NewGuid().ToString("N");
            ConfigurationUpdated?.Invoke();
        }
    }
    private static Configuration ReadSettings(XDocument document)
    {
        var setup = document.Root?.Element("ServiceSetup");
        if (setup?.Element("Connections") == null || setup.Element("Options") == null)
            throw new InvalidDataException("Settings must contain the current connections and options model.");
        using var reader = document.CreateReader();
        return (Configuration)new System.Xml.Serialization.XmlSerializer(typeof(Configuration)).Deserialize(reader)!;
    }
    private static void ValidateConfiguration(Configuration value)
    {
            if (!string.IsNullOrWhiteSpace(value.StoragePath) && !Path.IsPathFullyQualified(value.StoragePath))
                throw new ArgumentException("Storage must be an absolute container path.");
            if (value.MinimumMatch is < -1 or > 100 || value.UserRequestDailyQuota is < 1 or > 1000 || value.UserRequestActiveCap is < 1 or > 100)
                throw new ArgumentException("Invalid score or generation limits.");
            if (value.SchemaVersion != Configuration.CurrentSchema || value.Defaults == null || value.Sources == null || value.Sources.Any(s => s is null) || value.Sources.Select(s => s.Name).Distinct().Count() != value.Sources.Length)
                throw new ArgumentException("Invalid source configuration or settings schema.");
            string[] sourceNames = ["QQ", "NetEase", "Kugou", "Soda", "Musixmatch", "Spotify", "AppleMusic", "LRCLIB"];
            if (value.Sources.Any(s => !sourceNames.Contains(s.Name))) throw new ArgumentException("Unknown source.");
            if (value.ServiceSetup == null) throw new ArgumentException("Invalid service configuration.");
            value.ServiceSetup.Validate();
            PreferenceService.Validate(value.Defaults);
    }
    private void SaveSettings(Configuration config) => StateUpgrades.AtomicWrite(ConfigurationFilePath, stream => new System.Xml.Serialization.XmlSerializer(typeof(Configuration)).Serialize(stream, config));
    private void CommitConfiguration(Configuration config)
    {
        SaveSettings(config);
        Configuration = config;
        ConfigurationChanged?.Invoke(this, config);
    }
    public override void SaveConfiguration(Configuration config)
    {
        lock (configurationGate)
        {
            if (Startup.State != "ready") throw new InvalidOperationException("Plugin startup is not ready.");
            ValidateConfiguration(config); SaveSettings(config);
        }
    }
    public IEnumerable<PluginPageInfo> GetPages() => [new() { Name = "lyricbridge", EmbeddedResourcePath = "Jellyfin.Plugin.LyricBridge.Web.config.html" }];
}
