using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace LyricBridge;

public sealed class TransientMaintenance(Store store, ILogger<TransientMaintenance> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromDays(1));
        do
        {
            try
            {
                var count = store.ExpireTransientData();
                if (count > 0) logger.LogInformation("LyricBridge removed {Count} expired temporary records", count);
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                logger.LogWarning("LyricBridge temporary cleanup failed: {Category}; retained data will be retried next day", error.GetType().Name);
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
