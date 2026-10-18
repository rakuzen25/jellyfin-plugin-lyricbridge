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

public sealed class ExportWorkflowTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "lyricbridge-export-" + Guid.NewGuid().ToString("N"));
    [Fact]
    public async Task ExportIsReadOnlyForOrdinaryUsersAndImportRestoresCompositionForAdministrator()
    {
        using var store = new Store(directory); var user = Guid.NewGuid();
        var item = new Audio { Id = Guid.NewGuid(), Name = "Fixture" };
        var lyrics = new RichLyrics { Source = "Imported", Title = "Song", Artist = "Artist", Manual = true, Lines = [new() { Id = "one", Text = "中文", Language = "zh", Start = 10000001, End = 20000009, Translations = new() { ["en"] = "Embedded" } }] };
        store.ApplySelection(item.Id, new(lyrics, null));
        var account = new Preferences { TranslationLanguage = "en", OriginalChineseScript = "Traditional" }; store.SaveAccountPreferences(user, account);
        var variant = new Variant("selected", lyrics.Hash, "translation", "en", "Fixture", "", new() { ["one"] = "Chosen" });
        store.Put("variant", variant.Key, variant); Assert.True(store.SelectAuxiliary(LanguageVersionService.ChoiceKey(user, lyrics.Hash, "translation", "en"), lyrics.Hash, "translation", "en", variant.Key));
        Assert.True(store.SaveTiming(item.Id, store.Selection(item.Id), new(lyrics.Hash, TimingService.Fingerprint(lyrics), 0.25)));
        var registry = ProviderRegistry.WithSources(); var retrieval = new Retrieval(store, registry, NullLogger<Retrieval>.Instance);
        using var discovery = new Discovery(store, registry, retrieval); using var local = new LocalPronunciation(store);
        var languages = new LanguageServices(() => []); using var generation = new Generation(() => new(true, true, 5, 3), store, languages);
        var preferences = new PreferenceService(store, () => new());
        var query = new LyricQueryService(null!, store, retrieval, discovery, preferences, local, languages, () => [], () => true);
        var service = new SelectionService(store, retrieval, discovery, null!, query);
        var library = DispatchProxy.Create<ILibraryManager, OriginalLibraryProxy>(); ((OriginalLibraryProxy)(object)library).Item = item;
        var controller = new Api(service, new(store), new(store), query, new(library), preferences, new(store, discovery, generation, local, retrieval), generation, languages, discovery, local, null!, new Lazy<Plugin>(() => TestHost.CreatePlugin(directory)));
        controller.ControllerContext = new() { HttpContext = new DefaultHttpContext() };
        var token = TestContext.Current.CancellationToken;
        Assert.IsType<NotFoundResult>(await controller.ExportPreview(item.Id, new("lyricbridge"), token));
        controller.HttpContext.User = new(new ClaimsIdentity([new Claim("Jellyfin-UserId", user.ToString())], "fixture"));
        Assert.IsType<NotFoundResult>(await controller.ExportPreview(Guid.NewGuid(), new("lyricbridge"), token));
        var before = Snapshot(store);
        var preview = Assert.IsType<ExportPreview>(Assert.IsType<JsonResult>(await controller.ExportPreview(item.Id, new("lyricbridge"), token)).Value);
        var file = Assert.IsType<FileContentResult>(await controller.Export(item.Id, new("lyricbridge", Fingerprint: preview.Fingerprint), token));
        Assert.Equal(before, Snapshot(store)); Assert.Empty(store.ActiveJobs(null));
        var input = new ImportLyricsInput(FileName: file.FileDownloadName, FileBytes: Convert.ToBase64String(file.FileContents));
        Assert.Equal(403, Assert.IsType<JsonResult>(controller.ImportPreview(item.Id, input, token)).StatusCode);
        controller.HttpContext.User = new(new ClaimsIdentity([new Claim("Jellyfin-UserId", user.ToString()), new Claim(ClaimTypes.Role, Jellyfin.Api.Constants.UserRoles.Administrator)], "fixture"));
        store.SaveAccountPreferences(user, new() { TranslationLanguage = "ko", OriginalChineseScript = "Simplified" });
        store.SaveSongPreferences(user, item.Id, new("ja", "fr"));
        var importPreview = Assert.IsType<ImportPreview>(Assert.IsType<JsonResult>(controller.ImportPreview(item.Id, input, token)).Value);
        Assert.Equal("Traditional", importPreview.Document.SongOverrides.OriginalChineseScript);
        Assert.Equal("en", importPreview.Document.SongOverrides.TranslationLanguage);
        Assert.Null(importPreview.Document.SongOverrides.SourceLanguage);
        Assert.Equal(0.25, importPreview.Document.TimingCorrection!.Seconds);
        await controller.Import(item.Id, input, token);
        Assert.Equal("ko", store.AccountPreferences(user)!.TranslationLanguage);
        Assert.Equal("Traditional", store.SongPreferences(user, item.Id).OriginalChineseScript);
        var afterPreview = Assert.IsType<ExportPreview>(Assert.IsType<JsonResult>(await controller.ExportPreview(item.Id, new("lyricbridge"), token)).Value);
        var after = Assert.IsType<FileContentResult>(await controller.Export(item.Id, new("lyricbridge", Fingerprint: afterPreview.Fingerprint), token));
        Assert.Equal(file.FileContents, after.FileContents);
        store.SaveAccountPreferences(user, new() { TranslationLanguage = "en", OriginalChineseScript = "Traditional" });
        await controller.Import(item.Id, input, token);
        Assert.Equal(new SongLanguagePreferences(), store.SongPreferences(user, item.Id));
        await Assert.ThrowsAsync<WorkflowException>(() => controller.Export(item.Id, new("lyricbridge", Fingerprint: preview.Fingerprint), token));
        store.SaveAccountPreferences(user, new() { TranslationLanguage = "en-US", OriginalChineseScript = "Traditional" });
        await controller.Import(item.Id, input, token);
        Assert.Null(store.SongPreferences(user, item.Id).TranslationLanguage);
        var regionalPreview = Assert.IsType<ExportPreview>(Assert.IsType<JsonResult>(await controller.ExportPreview(item.Id, new("lyricbridge"), token)).Value);
        var regionalFile = Assert.IsType<FileContentResult>(await controller.Export(item.Id, new("lyricbridge", Fingerprint: regionalPreview.Fingerprint), token));
        var regional = LyricImport.Parse(new(FileName: regionalFile.FileDownloadName, FileBytes: Convert.ToBase64String(regionalFile.FileContents)), new("Imported", "local", "", "", "", null, 100), token);
        Assert.Equal("Chosen", regional.Native!.Selected.Translation["one"]);

    }
    [Fact]
    public void ImportedSelectionVariantsTimingAndPreferencesRollBackTogether()
    {
        using var store = new Store(directory); var item = Guid.NewGuid(); var user = Guid.NewGuid();
        store.ApplySelection(item, new(new() { Manual = true, Lines = [new() { Id = "old", Text = "Old" }] }, null));
        var native = new NativeLyricDocument(LyricExport.Schema, 1, "100ns", new() { Lines = [new() { Id = "new", Text = "New" }] }, new(new(), new()), new("auto", "en", "Simplified", 0));
        var imported = LyricImport.Parse(new(Text: LyricExport.NativeText(native), Format: "lyricbridge"), new("Imported", "local", "", "", "", null, 100), TestContext.Current.CancellationToken);
        using var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Path.Combine(directory, "index.sqlite") }.ToString()); connection.Open();
        using var command = connection.CreateCommand(); command.CommandText = "CREATE TRIGGER fail_song_preferences BEFORE INSERT ON records WHEN NEW.kind='song-preferences' BEGIN SELECT RAISE(ABORT, 'injected failure'); END"; command.ExecuteNonQuery();
        var before = Snapshot(store);
        Assert.Throws<SqliteException>(() => store.ApplyImport(item, user, imported, new("ja")));
        Assert.Equal(before, Snapshot(store));
    }
    private static string Snapshot(Store store) => Codec.Serialize(new { Documents = store.All<RichLyrics>("document"), Raw = store.All<RawLyrics>("raw"), Originals = store.All<SavedOriginal>("saved-original"), Variants = store.All<Variant>("variant"), Choices = store.All<AuxiliarySelection>("auxiliary-choice"), Timing = store.All<TimingCorrection>("timing-correction"), Preferences = store.All<SongLanguagePreferences>("song-preferences"), Jobs = store.All<Job>("job"), Selected = store.All<RichLyrics>("selected") });
    public void Dispose() { TestHost.ClearDatabasePools(directory); if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
