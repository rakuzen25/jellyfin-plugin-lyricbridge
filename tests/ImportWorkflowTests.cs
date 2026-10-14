using System.Reflection;
using System.Security.Claims;
using System.Text;
using LyricBridge;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

public sealed class ImportWorkflowTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "lyricbridge-import-" + Guid.NewGuid().ToString("N"));
    [Fact]
    public async Task PreviewIsReadOnlyImportRevalidatesAndOriginalBytesSurviveDeduplication()
    {
        var store = new Store(directory); var item = new Audio { Id = Guid.NewGuid(), Name = "Fixture" };
        store.ApplySelection(item.Id, new(new() { Lines = [new() { Id = "old", Text = "previous" }], Manual = true }, null));
        var registry = ProviderRegistry.WithSources(); var retrieval = new Retrieval(store, registry, NullLogger<Retrieval>.Instance);
        using var discovery = new Discovery(store, registry, retrieval); using var local = new LocalPronunciation(store);
        var languages = new LanguageServices(() => []); using var generation = new Generation(() => new(true, true, 5, 3), store, languages);
        var preferences = new PreferenceService(store, () => new());
        var query = new LyricQueryService(null!, store, retrieval, discovery, preferences, local, languages, () => [], () => true);
        var service = new SelectionService(store, retrieval, discovery, null!, query);
        var library = DispatchProxy.Create<ILibraryManager, OriginalLibraryProxy>(); ((OriginalLibraryProxy)(object)library).Item = item;
        var maintenance = new ManagedLibraryMaintenance(store, discovery, generation, local, retrieval);
        var controller = new Api(service, new(store), new(store), query, new(library), preferences, maintenance, generation, languages, discovery, local, null!);
        controller.ControllerContext = new() { HttpContext = new DefaultHttpContext() };
        var bytes = Encoding.UTF8.GetBytes("[offset:2000]\n[00:01.00]日本語の歌");
        var input = new ImportLyricsInput(FileName: "original.lrc", FileBytes: Convert.ToBase64String(bytes), Format: "lrc");
        Assert.Equal(403, Assert.IsType<JsonResult>(controller.ImportPreview(item.Id, input, TestContext.Current.CancellationToken)).StatusCode);
        controller.HttpContext.User = new(new ClaimsIdentity([new Claim("Jellyfin-UserId", Guid.NewGuid().ToString()), new Claim(ClaimTypes.Role, Jellyfin.Api.Constants.UserRoles.Administrator)], "fixture"));
        var before = Snapshot(store);
        var preview = Assert.IsType<ImportPreview>(Assert.IsType<JsonResult>(controller.ImportPreview(item.Id, input, TestContext.Current.CancellationToken)).Value);
        Assert.Equal(before, Snapshot(store)); Assert.False(preview.Document.CanSelect); Assert.False(preview.Document.CanGenerate); Assert.False(preview.Document.CanDeleteOriginals);
        Assert.Equal("日本語の歌", Assert.Single(preview.Document.Lyrics!.Lines).Text);
        Assert.Contains(preview.Warnings, w => w.Code == "negative_effective_time");
        Assert.Equal(-10_000_000, preview.Document.Lyrics.Lines[0].Start);
        Assert.Equal("previous", Assert.Single(store.Selection(item.Id).Lyrics!.Lines).Text);
        var bad = input with { FileBytes = Convert.ToBase64String("[00:01.00]valid\n[xx:00]bad"u8.ToArray()) };
        await Assert.ThrowsAsync<WorkflowException>(() => service.Import(item, bad, TestContext.Current.CancellationToken));
        Assert.Equal(before, Snapshot(store));
        using (var canceled = new CancellationTokenSource())
        {
            canceled.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.Import(item, input, canceled.Token));
        }
        Assert.Equal(before, Snapshot(store));
        await service.Import(item, input, TestContext.Current.CancellationToken);
        await service.Import(item, input, TestContext.Current.CancellationToken);
        var selected = store.Selection(item.Id).Lyrics!;
        Assert.Equal(preview.Document.Lyrics.Hash, selected.Hash); Assert.Equal(2, store.SavedOriginals(item.Id).Count);
        var raw = store.Get<RawLyrics>("raw", selected.Hash)!;
        Assert.Equal("[offset:2000]\n[00:01.00]日本語の歌", raw.Original);
        var provenance = System.Text.Json.JsonDocument.Parse(raw.RawResponse).RootElement;
        Assert.Equal(bytes, Convert.FromBase64String(provenance.GetProperty("fileBytes").GetString()!));
        Assert.Equal("original.lrc", provenance.GetProperty("fileName").GetString());
        Assert.Equal("lrc", provenance.GetProperty("formatChoice").GetString());
    }
    private static string Snapshot(Store store) => Codec.Serialize(new { Documents = store.All<RichLyrics>("document"), Raw = store.All<RawLyrics>("raw"), Originals = store.All<SavedOriginal>("saved-original"), Variants = store.All<Variant>("variant"), Jobs = store.All<Job>("job"), Selections = store.All<RichLyrics>("selected"), Instrumental = store.All<InstrumentalEvidence>("instrumental") });
    public void Dispose() { SqliteConnection.ClearAllPools(); if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
