using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace LyricBridge;

public sealed record PluginStartupStatus(string State, string Phase, string? Message = null, string? DiagnosticId = null, string? Path = null);

/// <summary>Owns readiness and worker lifetime. No worker is resolved until persisted state is current.</summary>
public sealed class PluginRuntime(IServiceProvider services, Lazy<Plugin> plugin, ILogger<PluginRuntime> logger) : BackgroundService
{
    private readonly List<IHostedService> started = [];
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var owner = plugin.Value;
        try
        {
            if (owner.Startup.State != "blocked")
            {
                owner.SetStartup(new("initializing", "database", Path: Path.Combine(owner.ActiveDirectory, "index.sqlite")));
                services.GetRequiredService<Store>().Initialize();
                owner.Upgrades.Ready();
                owner.SetStartup(new("ready", "complete"));
                foreach (var worker in new IHostedService[] { services.GetRequiredService<WebRendererIntegration>(), services.GetRequiredService<Generation>(), services.GetRequiredService<LocalPronunciation>(), services.GetRequiredService<TransientMaintenance>() })
                {
                    started.Add(worker); await worker.StartAsync(stoppingToken);
                }
            }
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            owner.BlockStartup(error);
            await StopWorkers(CancellationToken.None);
        }
        using var timer = new PeriodicTimer(TimeSpan.FromDays(1));
        do
        {
            try { owner.Upgrades.Expire(); }
            catch (Exception error) when (error is not OperationCanceledException) { logger.LogWarning(error, "LyricBridge upgrade backup cleanup failed; retrying next day"); }
            var tick = timer.WaitForNextTickAsync(stoppingToken).AsTask();
            var workers = started.OfType<BackgroundService>().Select(worker => worker.ExecuteTask!).ToArray();
            if (workers.Length > 0)
            {
                var completed = await Task.WhenAny(workers.Append(tick));
                if (completed != tick && !stoppingToken.IsCancellationRequested)
                {
                    owner.SetStartup(new("ready", "workers"));
                    owner.BlockStartup(completed.Exception?.GetBaseException() ?? new InvalidOperationException("A plugin worker stopped unexpectedly."));
                    await StopWorkers(CancellationToken.None);
                }
            }
            if (!await tick) break;
        } while (!stoppingToken.IsCancellationRequested);
    }
    private async Task StopWorkers(CancellationToken cancellationToken)
    {
        foreach (var worker in started.AsEnumerable().Reverse())
        {
            try { await worker.StopAsync(cancellationToken); }
            catch (Exception error) when (error is not OperationCanceledException) { logger.LogWarning(error, "LyricBridge worker shutdown failed"); }
        }
        started.Clear();
    }
    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        await base.StopAsync(cancellationToken);
        await StopWorkers(cancellationToken);
    }
}

/// <summary>Runs before controller activation, including when state cannot be loaded.</summary>
public sealed class PluginReadinessFilter(Lazy<Plugin> plugin) : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.Use(async (context, following) =>
        {
            var path = context.Request.Path;
            // Plugin startup filters can run before Jellyfin removes its configured base URL.
            var prefix = path.Value?.LastIndexOf("/LyricBridge/", StringComparison.OrdinalIgnoreCase) ?? -1;
            if (prefix > 0) path = new PathString(path.Value![prefix..]);
            if (path.StartsWithSegments("/LyricBridge") && !path.StartsWithSegments("/LyricBridge/assets") && !path.StartsWithSegments("/LyricBridge/admin/startup") && !path.StartsWithSegments("/LyricBridge/admin/upgrades") && plugin.Value.Startup.State != "ready")
            {
                context.Response.StatusCode = 503;
                await context.Response.WriteAsJsonAsync(new { error = SafeError.Create("plugin_not_ready", "LyricBridge is unavailable. Ask an administrator to inspect plugin startup status.", true) }, Codec.Json, context.RequestAborted);
                return;
            }
            await following();
        });
        next(app);
    };
}
