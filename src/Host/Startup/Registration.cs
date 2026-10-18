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

public sealed class Registration : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection services, IServerApplicationHost host)
    {
        // Jellyfin registers services before constructing the plugin. Capture once
        // on first configuration access, after host initialization, then retain it.
        var plugin = new Lazy<Plugin>(() => Plugin.Instance
            ?? throw new InvalidOperationException("Jellyfin has not initialized LyricBridge."));
        services.AddSingleton(plugin);
        services.AddSingleton(_ => new ServiceCatalog(() => plugin.Value.Configuration.ServiceSetup));
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
            () => plugin.Value.Configuration.AutoGeneratePronunciation && plugin.Value.Configuration.ServiceSetup.Options.Any(o => o.Capability == "pronunciation" && o.Provider == "Kawazu" && o.Enabled)));
        services.AddSingleton(sp => new PreferenceService(sp.GetRequiredService<Store>(), () => plugin.Value.Configuration.Defaults));
        services.AddSingleton<ITranscriptionRepository>(sp => sp.GetRequiredService<Store>());
        services.AddSingleton<IBoundaryStrategy, LinguisticBoundaries>();
        services.AddSingleton<TranscriptionProvider>();
        services.AddSingleton(sp => new AudioPreparation(sp.GetRequiredService<Store>(), () => sp.GetRequiredService<MediaBrowser.Controller.Library.ILibraryManager>(), () => sp.GetRequiredService<MediaBrowser.Controller.MediaEncoding.IMediaEncoder>()));
        services.AddSingleton<IAudioPreparation>(sp => sp.GetRequiredService<AudioPreparation>());
        services.AddSingleton<IRemoteTaskHandler>(sp => new TranscriptionTask(() => plugin.Value.Configuration.Transcription, sp.GetRequiredService<ITranscriptionRepository>(), sp.GetRequiredService<IAudioPreparation>(), sp.GetRequiredService<TranscriptionProvider>(), sp.GetRequiredService<ServiceCatalog>().Transcription));
        services.AddSingleton<IRemoteTaskHandler>(sp => new BoundaryReviewTask(() => plugin.Value.Configuration.Transcription.ReviewUsesAiService ? plugin.Value.Configuration.Services.First(s => s.Name == "AI") : plugin.Value.Configuration.Transcription.Review, sp.GetRequiredService<ITranscriptionRepository>(), sp.GetRequiredService<TranscriptionProvider>(), sp.GetRequiredService<IBoundaryStrategy>(), sp.GetRequiredService<ServiceCatalog>().Review));
        services.AddSingleton<ManagedLibraryMaintenance>();
        services.AddSingleton<DataManagementService>();
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
            logger: sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<LanguageServices>>(), catalog: sp.GetRequiredService<ServiceCatalog>()));
        services.AddSingleton(sp =>
        {
            var generation = new Generation(() =>
            {
                var configuration = plugin.Value.Configuration;
                return new(configuration.AllowUserRequests, configuration.AutoApproveUserRequests,
                    configuration.UserRequestDailyQuota, configuration.UserRequestActiveCap);
            }, sp.GetRequiredService<Store>(), sp.GetRequiredService<LanguageServices>(),
                sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<Generation>>(), sp.GetServices<IRemoteTaskHandler>());
            generation.ObserveConfiguration(
                handler => plugin.Value.ConfigurationUpdated += handler,
                handler => plugin.Value.ConfigurationUpdated -= handler);
            return generation;
        });
        services.AddSingleton<IHostedService>(sp => sp.GetRequiredService<Generation>());
        services.AddSingleton<Microsoft.AspNetCore.Hosting.IStartupFilter, NativeCache>();
    }
}
