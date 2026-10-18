using System.Reflection;
using System.Security.Claims;
using LyricBridge;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

public class OriginalLibraryProxy : DispatchProxy
{
    public Audio? Item;
    protected override object? Invoke(MethodInfo? method, object?[]? args) => method?.Name == "GetItemById" && args?[0] is Guid id && id == Item?.Id ? Item : null;
}
public sealed class SavedOriginalApiTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "lyricbridge-original-api-" + Guid.NewGuid().ToString("N"));
    [Fact]
    public void PreviewIsReadOnlyAndMutationsRequireAdministratorAndExplicitConfirmation()
    {
        var store = new Store(directory); var item = new Audio { Id = Guid.NewGuid(), Name = "Fixture" };
        var first = new RichLyrics { Source = "Imported", Lines = [new() { Id = "line", Text = "日本語", Language = "ja" }], Manual = true };
        var second = new RichLyrics { Source = "Provider", Lines = [new() { Id = "second", Text = "second", Language = "en" }], Manual = true };
        store.ApplySelection(item.Id, new(first, null)); store.ApplySelection(item.Id, new(second, null));
        var library = DispatchProxy.Create<ILibraryManager, OriginalLibraryProxy>(); ((OriginalLibraryProxy)(object)library).Item = item;
        var registry = ProviderRegistry.WithSources(); var retrieval = new Retrieval(store, registry, NullLogger<Retrieval>.Instance);
        using var discovery = new Discovery(store, registry, retrieval); using var local = new LocalPronunciation(store);
        var languages = new LanguageServices(() => []); using var generation = new Generation(() => new(true, true, 5, 3), store, languages);
        var preferences = new PreferenceService(store, () => new());
        var query = new LyricQueryService(null!, store, retrieval, discovery, preferences, local, languages, () => [], () => true);
        var maintenance = new ManagedLibraryMaintenance(store, discovery, generation, local, retrieval);
        var controller = new Api(new(store, retrieval, discovery, null!, query), new(store), new(store), query, new(library), preferences, maintenance, generation, languages, discovery, local, null!, new Lazy<Plugin>(() => TestHost.CreatePlugin(directory)));
        controller.ControllerContext = new() { HttpContext = new DefaultHttpContext() };
        var deniedSelect = Assert.IsType<JsonResult>(controller.SelectOriginal(item.Id, first.Hash)); Assert.Equal(403, deniedSelect.StatusCode);
        var deniedDelete = Assert.IsType<JsonResult>(controller.DeleteOriginal(item.Id, first.Hash, new(true, store.SavedOriginals(item.Id).Single(o => o.Hash == first.Hash).Revision))); Assert.Equal(403, deniedDelete.StatusCode);
        Assert.Equal(2, store.SavedOriginals(item.Id).Count); Assert.Equal(second.Hash, store.Selection(item.Id).Lyrics!.Hash);
        controller.HttpContext.User = new(new ClaimsIdentity([new Claim("Jellyfin-UserId", Guid.NewGuid().ToString())], "fixture"));
        Assert.Equal(2, Assert.IsAssignableFrom<IReadOnlyList<SavedOriginal>>(Assert.IsType<JsonResult>(controller.Originals(item.Id)).Value).Count);
        var before = Snapshot(store);
        var preview = Assert.IsType<LyricPayload>(Assert.IsType<JsonResult>(controller.OriginalPreview(item.Id, first.Hash)).Value);
        Assert.Equal(first.Hash, preview.Lyrics!.Hash); Assert.False(preview.CanGenerate); Assert.False(preview.CanSelect); Assert.False(preview.CanDeleteOriginals); Assert.Equal("unavailable", preview.Pronunciation!.State);
        Assert.Equal(before, Snapshot(store)); Assert.Equal(second.Hash, store.Selection(item.Id).Lyrics!.Hash);
        Assert.IsType<NotFoundResult>(controller.Originals(Guid.NewGuid()));
        controller.HttpContext.User = new(new ClaimsIdentity([new Claim(ClaimTypes.Role, Jellyfin.Api.Constants.UserRoles.Administrator)], "fixture"));
        Assert.Equal(400, Assert.IsType<JsonResult>(controller.DeleteOriginal(item.Id, first.Hash, new(false))).StatusCode);
        Assert.IsType<JsonResult>(controller.SelectOriginal(item.Id, first.Hash)); Assert.Equal(first.Hash, store.Selection(item.Id).Lyrics!.Hash);
        // The HTTP action filter leaves a request scope active through deletion.
        using var operation = store.Operation(store.Admit(item.Id));
        Assert.IsType<JsonResult>(controller.DeleteOriginal(item.Id, first.Hash, new(true, store.SavedOriginals(item.Id).Single(o => o.Hash == first.Hash).Revision)));
        Assert.Equal(second.Hash, store.Selection(item.Id).Lyrics!.Hash); Assert.False(store.DiscoverySuppressed(item.Id)); Assert.Single(store.SavedOriginals(item.Id));
    }
    [Fact]
    public async Task MultipleActualImportsUseDistinctContentHashesAndKeepTheirRawInput()
    {
        var store = new Store(directory); var registry = ProviderRegistry.WithSources(); var retrieval = new Retrieval(store, registry, NullLogger<Retrieval>.Instance);
        using var discovery = new Discovery(store, registry, retrieval);
        var service = new SelectionService(store, retrieval, discovery, null!, null!); var item = new Audio { Id = Guid.NewGuid(), Name = "Fixture" };
        await service.Import(item, new("[00:01.00]first", false), Xunit.TestContext.Current.CancellationToken); var first = store.Selection(item.Id).Lyrics!.Hash;
        await service.Import(item, new("[00:02.00]second", false), Xunit.TestContext.Current.CancellationToken); var second = store.Selection(item.Id).Lyrics!.Hash;
        await service.Import(item, new("[00:02.00]second", false), Xunit.TestContext.Current.CancellationToken);
        Assert.NotEqual(first, second); Assert.Equal(2, store.SavedOriginals(item.Id).Count);
        Assert.Equal("[00:01.00]first", store.Get<RawLyrics>("raw", first)!.Original);
        Assert.Equal("[00:02.00]second", store.Get<RawLyrics>("raw", second)!.Original);
        store.SelectOriginal(item.Id, first); Assert.Equal(first, store.Selection(item.Id).Lyrics!.Hash);
    }
    private static string Snapshot(Store store) => Codec.Serialize(new { Documents = store.All<RichLyrics>("document"), Variants = store.All<Variant>("variant"), Originals = store.All<SavedOriginal>("saved-original"), Jobs = store.All<Job>("job"), Selections = store.All<RichLyrics>("selected"), Choices = store.All<AuxiliarySelection>("auxiliary-choice") });
    public void Dispose() { TestHost.ClearDatabasePools(directory); if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
