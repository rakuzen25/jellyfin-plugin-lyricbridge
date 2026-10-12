using LyricBridge;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

public sealed class NativeCacheAdmissionTests
{
    [Theory]
    [InlineData("/System/Info")]
    [InlineData("/LyricBridge/assets/lyricbridge.js")]
    [InlineData("/Audio/not-a-guid/Lyrics")]
    public async Task UnrelatedRoutesDoNotResolveOrOpenLyricStorage(string path)
    {
        using var services = new ServiceCollection().BuildServiceProvider(); var app = new ApplicationBuilder(services);
        new NativeCache().Configure(builder => builder.Run(context => { context.Response.StatusCode = 204; return Task.CompletedTask; }))(app);
        var context = new DefaultHttpContext { RequestServices = services }; context.Request.Method = "GET"; context.Request.Path = path;
        await app.Build()(context); Assert.Equal(204, context.Response.StatusCode);
    }
    [Fact]
    public async Task NativeLyricWorkCapturesItsSongAdmissionBeforeTheResponseCompletes()
    {
        var directory = Path.Combine(Path.GetTempPath(), "lyricbridge-native-admission-" + Guid.NewGuid().ToString("N"));
        var store = new Store(directory); var item = Guid.NewGuid(); var doc = new RichLyrics { Lines = [new() { Id = "line", Text = "fixture" }] };
        store.ApplySelection(item, new(doc, null));
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously); var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        try
        {
            using var services = new ServiceCollection().AddSingleton(store).BuildServiceProvider(); var app = new ApplicationBuilder(services);
            new NativeCache().Configure(builder => builder.Run(async context => { entered.SetResult(); await release.Task; store.SaveDocument(doc); context.Response.StatusCode = 204; }))(app);
            var context = new DefaultHttpContext { RequestServices = services }; context.Request.Method = "GET"; context.Request.Path = "/Audio/" + item.ToString("N") + "/Lyrics";
            var work = Task.Run(() => app.Build()(context)); await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            store.DeleteOriginal(item, doc.Hash); release.SetResult(); await work.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.Null(store.GetDocument(doc.Hash)); Assert.Null(store.Selection(item).Lyrics); Assert.True(store.DiscoverySuppressed(item));
        }
        finally { release.TrySetResult(); SqliteConnection.ClearAllPools(); if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
}
