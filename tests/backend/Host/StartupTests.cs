using System.Reflection;
using LyricBridge;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

public sealed class StartupTests : StorageFixture
{
    [Fact]
    public void CurrentXmlRestartKeepsOpaqueOptionIdsAndUnsupportedXmlRemainsUntouched()
    {
        var first = TestHost.CreatePlugin(Root); var ids = first.Configuration.ServiceSetup.Options.Select(o => o.Id).ToArray();
        first.Configuration.ServiceSetup.Connections[0].ApiKey = "fixture-secret"; first.SaveConfiguration();
        var paths = DispatchProxy.Create<MediaBrowser.Common.Configuration.IApplicationPaths, Proxy>(); ((Proxy)(object)paths).Root = Root;
        var serializer = DispatchProxy.Create<MediaBrowser.Model.Serialization.IXmlSerializer, Proxy>();
        var restarted = new Plugin(paths, serializer);
        Assert.NotEqual("blocked", restarted.Startup.State); Assert.Equal(ids, restarted.Configuration.ServiceSetup.Options.Select(o => o.Id));
        Assert.Throws<InvalidOperationException>(() => restarted.UpdateConfiguration(new Configuration()));
        var xml = File.ReadAllText(restarted.ConfigurationFilePath).Replace("<SchemaVersion>1</SchemaVersion>", "<SchemaVersion>999</SchemaVersion>");
        File.WriteAllText(restarted.ConfigurationFilePath, xml);
        var blocked = new Plugin(paths, serializer);
        Assert.Equal("blocked", blocked.Startup.State); Assert.Equal("settings", blocked.Startup.Phase); Assert.NotNull(blocked.Startup.DiagnosticId);
        Assert.Equal(xml, File.ReadAllText(blocked.ConfigurationFilePath)); Assert.Throws<InvalidOperationException>(() => blocked.SaveConfiguration());
        Assert.Equal(Jellyfin.Api.Constants.UserRoles.Administrator, typeof(UpgradeApi).GetCustomAttribute<AuthorizeAttribute>()!.Roles);
        var result = Assert.IsType<JsonResult>(new UpgradeApi(new(() => blocked)).Startup()); Assert.Same(blocked.Startup, result.Value);
    }
    [Fact]
    public async Task DatabaseFailureBlocksPluginWithoutStartingWorkersAndLeavesStatusReachable()
    {
        var owner = TestHost.CreatePlugin(Root); Directory.CreateDirectory(owner.DataDirectory);
        var path = Path.Combine(owner.DataDirectory, "index.sqlite");
        using (var database = new SqliteConnection("Data Source=" + path))
        {
            database.Open(); using var command = database.CreateCommand(); command.CommandText = "PRAGMA user_version=999; CREATE TABLE preserved(value TEXT); INSERT INTO preserved VALUES('untouched')"; command.ExecuteNonQuery();
        }
        using var store = new Store(() => owner.DataDirectory, () => owner.Upgrades);
        using var services = new ServiceCollection().AddSingleton(store).BuildServiceProvider();
        using var runtime = new PluginRuntime(services, new(() => owner), NullLogger<PluginRuntime>.Instance);
        await runtime.StartAsync(TestContext.Current.CancellationToken);
        for (var i = 0; i < 100 && owner.Startup.State != "blocked"; i++) await Task.Delay(10, TestContext.Current.CancellationToken);
        Assert.Equal("blocked", owner.Startup.State); Assert.Equal("database", owner.Startup.Phase);
        var app = new ApplicationBuilder(services);
        new PluginReadinessFilter(new(() => owner)).Configure(builder => builder.Run(context => { context.Response.StatusCode = 204; return Task.CompletedTask; }))(app);
        foreach (var route in new[] { "/LyricBridge/admin/startup", "/base/LyricBridge/admin/startup", "/LyricBridge/admin/upgrades", "/LyricBridge/assets/lyricbridge.js", "/System/Info/Public" })
        {
            var context = new DefaultHttpContext { RequestServices = services }; context.Request.Path = route;
            await app.Build()(context); Assert.Equal(204, context.Response.StatusCode);
        }
        foreach (var route in new[] { "/LyricBridge/service-options", "/base/LyricBridge/service-options" })
        {
            var blocked = new DefaultHttpContext { RequestServices = services }; blocked.Request.Path = route;
            await app.Build()(blocked); Assert.Equal(503, blocked.Response.StatusCode);
        }
        await runtime.StopAsync(TestContext.Current.CancellationToken);
        using var check = new SqliteConnection("Data Source=" + path); check.Open(); using var query = check.CreateCommand(); query.CommandText = "SELECT value FROM preserved"; Assert.Equal("untouched", query.ExecuteScalar());
    }
}
