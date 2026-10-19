using System.Reflection;
using LyricBridge;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Model.Serialization;
using Xunit;

public class TestHost : StorageFixture
{
    public Plugin Plugin { get; }
    public TestHost() => Plugin = CreatePlugin(Root);
    public override GenerationPolicy Policy()
    {
        var c = Plugin.Configuration;
        return new(c.AllowUserRequests, c.AutoApproveUserRequests, c.UserRequestDailyQuota, c.UserRequestActiveCap);
    }
    public static Plugin CreatePlugin(string root)
    {
        Directory.CreateDirectory(root);
        var paths = DispatchProxy.Create<IApplicationPaths, Proxy>();
        ((Proxy)(object)paths).Root = root;
        var serializer = DispatchProxy.Create<IXmlSerializer, Proxy>();
        var plugin = new Plugin(paths, serializer);
        if (plugin.Startup.State == "blocked") throw new InvalidOperationException(plugin.Startup.Message);
        // Unit hosts simulate completed host initialization; startup acceptance uses PluginRuntime.
        typeof(Plugin).GetMethod("SetStartup", BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(plugin, [new PluginStartupStatus("ready", "complete")]);
        plugin.UpdateConfiguration(new Configuration());
        return plugin;
    }
}
public class Proxy : DispatchProxy
{
    public string Root = "";
    protected override object? Invoke(MethodInfo? method, object?[]? args) => method?.ReturnType == typeof(string) ? Root : null;
}

[CollectionDefinition("Host integration", DisableParallelization = true)]
public sealed class HostIntegrationCollection;
