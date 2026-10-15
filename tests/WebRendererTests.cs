using System.Reflection;
using LyricBridge;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

[Collection("Host integration")]
public sealed class WebRendererTests
{
    private const string Revision = "0123456789abcdef";
    [Fact]
    public async Task RegistrationWaitsForHostInitializationAndRetainsItsCapturedPlugin()
    {
        var instance = typeof(Plugin).GetProperty(nameof(Plugin.Instance))!;
        var previous = instance.GetValue(null);
        try
        {
            instance.SetValue(null, null);
            var services = new ServiceCollection().AddLogging();
            new Registration().RegisterServices(services, null!);
            services.AddSingleton<NativeProvider>();
            await using var provider = services.BuildServiceProvider();
            Assert.NotNull(provider.GetRequiredService<NativeProvider>());
            Assert.Null(instance.GetValue(null));
            await using var host = new TestHost();
            Assert.Same(host.Plugin, provider.GetRequiredService<Lazy<Plugin>>().Value);
            await using var other = new TestHost();
            Assert.Same(host.Plugin, provider.GetRequiredService<Lazy<Plugin>>().Value);
            Assert.Equal(host.Plugin.DataDirectory, provider.GetRequiredService<Store>().ActiveStoragePath);
            host.Plugin.UpdateConfiguration(new Configuration { MinimumMatch = 83 });
            Assert.Equal(83, provider.GetRequiredService<Lazy<Plugin>>().Value.Configuration.MinimumMatch);
            Assert.NotSame(other.Plugin, provider.GetRequiredService<Lazy<Plugin>>().Value);
            // Resolve the event-bound worker so provider disposal exercises detachment.
            provider.GetRequiredService<Generation>();
            await provider.DisposeAsync();
        }
        finally { instance.SetValue(null, previous); }
    }

    [Fact]
    public async Task MissingIndexReportsErrorUnlessTransformationIsAvailable()
    {
        var root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        using var direct = new WebRendererIntegration(root, () => true, NullLogger<WebRendererIntegration>.Instance, Revision, () => false);
        Assert.Equal("error", (await direct.Repair(CancellationToken.None)).Severity);
        using var transformation = new WebRendererIntegration(root, () => true, NullLogger<WebRendererIntegration>.Instance, Revision, () => true);
        Assert.Equal("info", (await transformation.Repair(CancellationToken.None)).Severity);
    }

    [Fact]
    public void InjectionIsIdempotentAndScoped()
    {
        const string original = "<html><head><script src=\"other.js\"></script></HEAD><body>fixture</body></html>";
        var html = WebRendererIntegration.Normalize(original, true, Revision);
        Assert.Equal(html, WebRendererIntegration.Normalize(html, true, Revision));
        Assert.Equal(original, WebRendererIntegration.Normalize(html, false, Revision));
        Assert.Contains("other.js", html);
        Assert.Equal(2, html.Split("<script defer").Length - 1);
        Assert.True(html.IndexOf("lyricbridge.css", StringComparison.Ordinal) < html.IndexOf("lyricbridge.js", StringComparison.Ordinal));
        Assert.True(html.IndexOf("lyricbridge.js", StringComparison.Ordinal) < html.IndexOf("jellyfin-lyric-motion.js", StringComparison.Ordinal));
        Assert.Contains("../LyricBridge/assets/lyricbridge.js?v=" + Revision, html);
        Assert.Matches("^[a-f0-9]{16}$", WebRendererIntegration.AssetRevision());
    }
    [Fact]
    public void ReplacesManualAndOldRevisionWithoutDuplicates()
    {
        var manual = "<head>" + WebRendererIntegration.StartMarker + "<script src=\"lyricbridge/lyricbridge.js\"></script>" + WebRendererIntegration.EndMarker + "</head>";
        var html = WebRendererIntegration.Normalize(manual, true, Revision);
        Assert.DoesNotContain("src=\"lyricbridge/", html);
        var replaced = WebRendererIntegration.Normalize(html, true, "fedcba9876543210");
        Assert.DoesNotContain(Revision, replaced);
        Assert.Equal(1, replaced.Split(WebRendererIntegration.StartMarker).Length - 1);
    }
    [Fact]
    public void InvalidHtmlAndRevisionsAreRejectedAndCallbackNeverThrows()
    {
        Assert.Throws<InvalidDataException>(() => WebRendererIntegration.Normalize("<body/>", true, Revision));
        Assert.Throws<InvalidDataException>(() => WebRendererIntegration.Normalize("<head></head>", true, "injected\""));
        Assert.Throws<InvalidDataException>(() => WebRendererIntegration.Normalize(WebRendererIntegration.StartMarker, false, Revision));
        Assert.Equal("", WebRendererIntegration.TransformIndexHtml(null));
        Assert.Equal("<broken>", WebRendererIntegration.TransformIndexHtml(new() { Contents = "<broken>" }));
    }
    [Fact]
    public async Task RepairsPreserveBackupPermissionsAndUnrelatedChanges()
    {
        var root = Path.Combine(Path.GetTempPath(), "lyricbridge-web-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var index = Path.Combine(root, "index.html");
            const string original = "<head></head><body>original</body>";
            File.WriteAllText(index, original);
            if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(index, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.GroupRead);
            var enabled = true;
            using var integration = new WebRendererIntegration(root, () => enabled, NullLogger<WebRendererIntegration>.Instance, Revision, () => false);
            Assert.Equal("direct", (await integration.Repair(Xunit.TestContext.Current.CancellationToken)).Mechanism);
            Assert.Equal("direct", (await integration.Repair(Xunit.TestContext.Current.CancellationToken)).Mechanism);
            Assert.Equal(original, File.ReadAllText(index + ".lyricbridge-backup"));
            if (!OperatingSystem.IsWindows()) Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.GroupRead, File.GetUnixFileMode(index));
            File.AppendAllText(index, "<!-- another plugin -->");
            enabled = false;
            Assert.False((await integration.Repair(Xunit.TestContext.Current.CancellationToken)).Enabled);
            Assert.Equal(original + "<!-- another plugin -->", File.ReadAllText(index));
            Assert.Equal(original, File.ReadAllText(index + ".lyricbridge-backup"));
        }
        finally { Directory.Delete(root, true); }
    }
    [Fact]
    public async Task TransformationRemovesDiskInjectionAndTracksCancellation()
    {
        var root = Path.Combine(Path.GetTempPath(), "lyricbridge-web-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var index = Path.Combine(root, "index.html");
            File.WriteAllText(index, WebRendererIntegration.Normalize("<head></head>", true, Revision));
            var available = false;
            var enabled = true;
            var detected = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            using var integration = new WebRendererIntegration(root, () => enabled, NullLogger<WebRendererIntegration>.Instance, Revision, () => { detected.TrySetResult(); return available; });
            await integration.StartAsync(Xunit.TestContext.Current.CancellationToken);
            await detected.Task.WaitAsync(TimeSpan.FromSeconds(5), Xunit.TestContext.Current.CancellationToken);
            available = true;
            Assert.Equal("file-transformation", (await integration.Repair(Xunit.TestContext.Current.CancellationToken)).Mechanism);
            Assert.Equal("<head></head>", File.ReadAllText(index));
            Assert.Contains(WebRendererIntegration.StartMarker, WebRendererIntegration.TransformIndexHtml(new() { Contents = "<head></head>" }));
            enabled = false;
            Assert.Equal("<head></head>", WebRendererIntegration.TransformIndexHtml(new() { Contents = "<head></head>" }));
            await integration.StopAsync(CancellationToken.None);
            Assert.Equal("<head></head>", WebRendererIntegration.TransformIndexHtml(new() { Contents = "<head></head>" }));
        }
        finally { Directory.Delete(root, true); }
    }
    [Fact]
    public async Task DisposalImmediatelyDetachesServeTimeTransformation()
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var integration = new WebRendererIntegration("/nonexistent-lyricbridge-disposal-fixture", () => true, NullLogger<WebRendererIntegration>.Instance, Revision, () => { entered.TrySetResult(); return true; });
        await integration.StartAsync(Xunit.TestContext.Current.CancellationToken);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5), Xunit.TestContext.Current.CancellationToken);
        Assert.Contains(WebRendererIntegration.StartMarker, WebRendererIntegration.TransformIndexHtml(new() { Contents = "<head></head>" }));
        integration.Dispose();
        Assert.Equal("<head></head>", WebRendererIntegration.TransformIndexHtml(new() { Contents = "<head></head>" }));
    }
    [Fact]
    public void RegistrationUsesTheDocumentedWireContract()
    {
        Assert.True(WebRendererIntegration.RegisterWith(typeof(WebRendererTests).Assembly));
        using var payload = System.Text.Json.JsonDocument.Parse(Jellyfin.Plugin.FileTransformation.PluginInterface.LastRegistration!);
        Assert.Equal("index.html", payload.RootElement.GetProperty("fileNamePattern").GetString());
        Assert.Equal("70a9d327-7e98-4201-88a5-724d39366c40", payload.RootElement.GetProperty("id").GetString());
        Assert.Equal(nameof(WebRendererIntegration.TransformIndexHtml), payload.RootElement.GetProperty("callbackMethod").GetString());
    }
    [Fact]
    public async Task ReadOnlyRootReportsFailureWithoutChangingIndex()
    {
        if (OperatingSystem.IsWindows() || Environment.UserName == "root") return;
        var root = Path.Combine(Path.GetTempPath(), "lyricbridge-web-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        var index = Path.Combine(root, "index.html");
        File.WriteAllText(index, "<head></head>");
        File.SetUnixFileMode(root, UnixFileMode.UserRead | UnixFileMode.UserExecute);
        try
        {
            using var integration = new WebRendererIntegration(root, () => true, NullLogger<WebRendererIntegration>.Instance, Revision, () => false);
            Assert.Equal("none", (await integration.Repair(Xunit.TestContext.Current.CancellationToken)).Mechanism);
            Assert.Equal("<head></head>", File.ReadAllText(index));
        }
        finally
        {
            File.SetUnixFileMode(root, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            Directory.Delete(root, true);
        }
    }
    [Fact]
    public async Task MissingIndexAndFailedRegistrationDoNotFailServer()
    {
        using var integration = new WebRendererIntegration("/nonexistent-lyricbridge-fixture", () => true, NullLogger<WebRendererIntegration>.Instance, Revision, () => throw new InvalidOperationException());
        Assert.Equal("none", (await integration.Repair(Xunit.TestContext.Current.CancellationToken)).Mechanism);
        Assert.False(WebRendererIntegration.RegisterWith(typeof(string).Assembly));
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => integration.Repair(cancellation.Token));
    }
}
