using LyricBridge;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Hosting;
using Xunit;

[assembly: Xunit.v3.Parallelization(Mode = Xunit.Sdk.ParallelMode.Collections, MaxThreads = 4)]

/// <summary>Owns one test's configuration, workers and storage, in shutdown order.</summary>
public class StorageFixture : IAsyncLifetime
{
    private readonly Stack<IDisposable> resources = new();
    private bool disposed;
    public string Root { get; } = Path.Combine(Path.GetTempPath(), "lyricbridge-test-" + Guid.NewGuid().ToString("N"));
    public virtual GenerationPolicy Policy() => new(false, false, 5, 3);
    public T Own<T>(T resource) where T : IDisposable
    {
        resources.Push(resource);
        return resource;
    }
    public ValueTask InitializeAsync() => ValueTask.CompletedTask;
    public async ValueTask DisposeAsync()
    {
        if (disposed)
            return;
        disposed = true;
        var failures = new List<Exception>();
        foreach (var worker in resources.OfType<IHostedService>())
            try
            {
                await worker.StopAsync(CancellationToken.None);
            }
            catch (Exception error) { failures.Add(error); }
        foreach (var resource in resources)
            try
            {
                resource.Dispose();
            }
            catch (Exception error) { failures.Add(error); }
        try
        {
            ClearDatabasePools(Root);
            if (Directory.Exists(Root))
                Directory.Delete(Root, true);
        }
        catch (Exception error) { failures.Add(error); }
        if (failures.Count != 0)
            throw new AggregateException("Test host cleanup failed", failures);
    }

    // Direct SQL assertions use the default timeout; Store uses ten seconds.
    // Clear only pools for this fixture, including databases whose initialization failed.
    public static void ClearDatabasePools(string root)
    {
        if (!Directory.Exists(root))
            return;
        foreach (var file in Directory.EnumerateFiles(root, "*.sqlite", SearchOption.AllDirectories))
            foreach (var connectionString in new[] {
                new SqliteConnectionStringBuilder { DataSource = file, DefaultTimeout = 10 }.ToString(),
                "Data Source=" + file
            })
            {
                using var connection = new SqliteConnection(connectionString);
                SqliteConnection.ClearPool(connection);
            }
    }
}
