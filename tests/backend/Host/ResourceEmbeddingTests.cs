using LyricBridge;
using Xunit;

public sealed class ResourceEmbeddingTests
{
    [Fact]
    public void PluginResourcesExcludeDevelopmentDemo()
    {
        var resources = typeof(Plugin).Assembly.GetManifestResourceNames();
        Xunit.Assert.Contains(resources, name => name.EndsWith(".config.html", StringComparison.Ordinal));
        Xunit.Assert.DoesNotContain(resources, name => name.EndsWith(".demo.html", StringComparison.Ordinal)
            || name.EndsWith(".demo.wav", StringComparison.Ordinal));
    }

}
