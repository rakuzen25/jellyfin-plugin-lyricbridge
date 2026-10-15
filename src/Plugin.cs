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
public sealed class Plugin : BasePlugin<Configuration>, IHasWebPages
{
    public static Plugin Instance { get; private set; } = null!;
    public event Action? ConfigurationUpdated;
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
        PreferenceService.Validate(value.Defaults);
        base.UpdateConfiguration(configuration);
        ConfigurationUpdated?.Invoke();
    }
    public IEnumerable<PluginPageInfo> GetPages() => [new() { Name = "lyricbridge", EmbeddedResourcePath = "Jellyfin.Plugin.LyricBridge.Web.config.html" }];
}
public sealed class Registration : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection services, IServerApplicationHost host)
    {
        // Jellyfin registers services before constructing the plugin. Capture once
        // on first configuration access, after host initialization, then retain it.
        var plugin = new Lazy<Plugin>(() => Plugin.Instance
            ?? throw new InvalidOperationException("Jellyfin has not initialized LyricBridge."));
        services.AddSingleton(plugin);
        services.AddSingleton<TimeProvider>(TimeProvider.System);
        services.AddSingleton<WebRendererIntegration>();
        services.AddHostedService(sp => sp.GetRequiredService<WebRendererIntegration>());
        services.AddSingleton<LibraryAccess>();
        services.AddSingleton<ISelectionRepository>(sp => sp.GetRequiredService<Store>());
        services.AddSingleton<SelectionService>();
        services.AddSingleton(sp => new LanguageVersionService(sp.GetRequiredService<Store>()));
        services.AddSingleton(sp => new TimingService(sp.GetRequiredService<Store>()));
        services.AddSingleton(sp => new LyricQueryService(
            sp.GetRequiredService<MediaBrowser.Controller.Lyrics.ILyricManager>(),
            sp.GetRequiredService<Store>(), sp.GetRequiredService<Retrieval>(),
            sp.GetRequiredService<Discovery>(), sp.GetRequiredService<PreferenceService>(),
            sp.GetRequiredService<LocalPronunciation>(), sp.GetRequiredService<LanguageServices>(),
            () => plugin.Value.Configuration.Services.Select(s => s.Name).ToArray(),
            () => plugin.Value.Configuration.AllowUserRequests,
            () => plugin.Value.Configuration.AutoGeneratePronunciation));
        services.AddSingleton(sp => new PreferenceService(sp.GetRequiredService<Store>(), () => plugin.Value.Configuration.Defaults));
        services.AddSingleton<ManagedLibraryMaintenance>();
        services.AddHostedService<TransientMaintenance>();
        services.AddSingleton(sp => new Discovery(
            sp.GetRequiredService<Store>(), sp.GetRequiredService<ProviderRegistry>(),
            sp.GetRequiredService<Retrieval>(), () => plugin.Value.Configuration.MinimumMatch));
        services.AddSingleton<LocalPronunciation>();
        services.AddHostedService(sp => sp.GetRequiredService<LocalPronunciation>());
        services.AddSingleton(_ => new Store(() => string.IsNullOrWhiteSpace(plugin.Value.Configuration.StoragePath)
            ? plugin.Value.DataDirectory : plugin.Value.Configuration.StoragePath));
        services.AddSingleton(_ => new ProviderRegistry(() => plugin.Value.Configuration.Sources));
        services.AddSingleton(sp => new Retrieval(
            sp.GetRequiredService<Store>(), sp.GetRequiredService<ProviderRegistry>(),
            sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<Retrieval>>(),
            () => plugin.Value.Configuration.MinimumMatch, sp.GetRequiredService<TimeProvider>()));
        services.AddSingleton(sp => new LanguageServices(
            () => plugin.Value.Configuration.Services,
            logger: sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<LanguageServices>>()));
        services.AddSingleton(sp =>
        {
            var generation = new Generation(() =>
            {
                var configuration = plugin.Value.Configuration;
                return new(configuration.AllowUserRequests, configuration.AutoApproveUserRequests,
                    configuration.UserRequestDailyQuota, configuration.UserRequestActiveCap);
            }, sp.GetRequiredService<Store>(), sp.GetRequiredService<LanguageServices>(),
                sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<Generation>>());
            generation.ObserveConfiguration(
                handler => plugin.Value.ConfigurationUpdated += handler,
                handler => plugin.Value.ConfigurationUpdated -= handler);
            return generation;
        });
        services.AddSingleton<IHostedService>(sp => sp.GetRequiredService<Generation>());
        services.AddSingleton<Microsoft.AspNetCore.Hosting.IStartupFilter, NativeCache>();
    }
}
