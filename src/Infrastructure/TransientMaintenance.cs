using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace LyricBridge;

public sealed class TransientMaintenance(Store store, Retrieval retrieval, ILogger<TransientMaintenance> logger, TimeProvider? timeProvider = null) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var clock = timeProvider ?? TimeProvider.System;
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1), clock);
        var nextStorageCleanup = clock.GetUtcNow();
        do
        {
            var expiredMisses = retrieval.ExpireMissingCache();
            if (expiredMisses > 0)
                logger.LogDebug("LyricBridge removed {Count} expired missing-lyric entries", expiredMisses);
            var now = clock.GetUtcNow();
            if (now < nextStorageCleanup)
                continue;
            nextStorageCleanup = now.AddDays(1);
            try
            {
                var count = store.ExpireTransientData();
                if (count > 0)
                    logger.LogInformation("LyricBridge removed {Count} expired temporary records", count);
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                logger.LogWarning("LyricBridge temporary cleanup failed: {Category}; retained data will be retried next day", error.GetType().Name);
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
