using LyricBridge;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Lyrics;
using System.Reflection;
using System.Text.Json;
using Xunit;

public sealed class AutomaticOriginalTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "lyricbridge-auto-original-" + Guid.NewGuid().ToString("N"));
    private static RichLyrics Lyrics(string text) => new() { Source = "Local", Lines = [new() { Id = "line", Text = text }] };
    private static void Save(Store store, Guid item, RichLyrics lyrics) => store.SaveAutomaticOriginal(item, lyrics, store.Admit(item));

    [Fact]
    public void LoadsDeduplicateAndReplaceOnlyAutomaticCopiesWithoutSelecting()
    {
        var store = new Store(directory); var item = Guid.NewGuid();
        var explicitVersion = Lyrics("explicit"); store.ApplySelection(item, new(explicitVersion, null));
        var snapshot = Codec.Serialize(store.Selection(item));
        var first = Lyrics("first"); Save(store, item, first);
        var saved = store.SavedOriginals(item).Single(v => v.AutoSaved);
        Save(store, item, first); Assert.Equal(saved, store.SavedOriginals(item).Single(v => v.AutoSaved));
        var latest = Lyrics("latest"); Save(store, item, latest);
        Assert.Equal(latest.Hash, store.SavedOriginals(item).Single(v => v.AutoSaved).Hash);
        Assert.Contains(store.SavedOriginals(item), v => v.Hash == explicitVersion.Hash && !v.AutoSaved);
        Assert.Equal(snapshot, Codec.Serialize(store.Selection(item))); Assert.False(store.DiscoverySuppressed(item));
        store.ExpireTransientData(DateTimeOffset.UtcNow.AddDays(2));
        Assert.Null(store.GetDocument(first.Hash)); Assert.NotNull(store.GetDocument(latest.Hash));
        Assert.NotNull(store.GetDocument(explicitVersion.Hash));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void ExplicitSelectionOrImportPromotesAndPreservesTheCopy(bool select)
    {
        var store = new Store(directory); var item = Guid.NewGuid(); var first = Lyrics("first");
        Save(store, item, first);
        if (select) store.SelectOriginal(item, first.Hash); else store.ApplySelection(item, new(first, null));
        Save(store, item, first); Save(store, item, Lyrics("latest"));
        Assert.Contains(store.SavedOriginals(item), v => v.Hash == first.Hash && !v.AutoSaved);
        Assert.Equal(first.Hash, store.Selection(item).Lyrics!.Hash);
    }

    [Fact]
    public void DeletionAndResetFenceOldLoadsButLaterLoadsCanSaveAgain()
    {
        var store = new Store(directory); var item = Guid.NewGuid(); var lyrics = Lyrics("first");
        Save(store, item, lyrics); var stale = store.Admit(item);
        store.DeleteOriginal(item, lyrics.Hash);
        store.SaveAutomaticOriginal(item, lyrics, stale); Assert.Empty(store.SavedOriginals(item));
        Save(store, item, lyrics); Assert.Single(store.SavedOriginals(item));
        stale = store.Admit(item); Assert.True(store.BeginReset()); store.ResetManagedLibrary(); store.EndReset();
        store.SaveAutomaticOriginal(item, lyrics, stale); Assert.Empty(store.SavedOriginals(item));
        Save(store, item, lyrics); Assert.Single(store.SavedOriginals(item));
    }

    [Fact]
    public void ReplacementPreservesSharedDocumentsAndAuxiliaryReferences()
    {
        var store = new Store(directory); var item = Guid.NewGuid(); var other = Guid.NewGuid();
        var shared = Lyrics("shared"); Save(store, item, shared); Save(store, other, shared);
        var referenced = Lyrics("translated"); Save(store, item, referenced);
        store.Put("variant", "translation", new Variant("translation", referenced.Hash, "translation", "en", "fixture", "", new() { ["line"] = "translated" }));
        Save(store, item, Lyrics("latest")); store.ExpireTransientData(DateTimeOffset.UtcNow.AddDays(2));
        Assert.NotNull(store.GetDocument(shared.Hash)); Assert.NotNull(store.GetDocument(referenced.Hash));
        Assert.NotNull(store.Get<Variant>("variant", "translation"));
    }

    [Fact]
    public void LegacySavedOriginalsDefaultToExplicitRetention()
    {
        var original = new SavedOriginal(Guid.NewGuid(), "hash", "Local", "", "title", "artist", false, DateTimeOffset.UtcNow, null, 0);
        var json = Codec.Serialize(original).Replace(",\"autoSaved\":false", "");
        Assert.False(Codec.Deserialize<SavedOriginal>(json)!.AutoSaved);
    }

    [Fact]
    public async Task NativeLoadingSavesBeforePayloadAndPreservesManualPrecedence()
    {
        var store = new Store(directory); var item = new Audio { Id = Guid.NewGuid(), Name = "Fixture" };
        var native = DispatchProxy.Create<ILyricManager, AutomaticNativeProxy>(); var proxy = (AutomaticNativeProxy)(object)native;
        var retrieval = new Retrieval(store, ProviderRegistry.WithSources(), NullLogger<Retrieval>.Instance);
        using var discovery = new Discovery(store, ProviderRegistry.WithSources(), retrieval); using var local = new LocalPronunciation(store);
        var query = new LyricQueryService(native, store, retrieval, discovery, new PreferenceService(store, () => new()), local, new LanguageServices(() => []), () => [], () => false);
        var token = TestContext.Current.CancellationToken;
        var lyrics = await query.Read(item, token); Assert.NotNull(lyrics);
        Assert.Equal(lyrics.Hash, Assert.Single(store.SavedOriginals(item.Id)).Hash);
        var payload = query.Build(item, Guid.NewGuid(), true, new() { State = "ready", Lyrics = lyrics });
        Assert.True(Assert.Single(payload.SavedOriginals).AutoSaved); Assert.Null(store.Selection(item.Id).Lyrics);
        var selection = new SelectionService(store, retrieval, discovery, native, query);
        await selection.Import(item, new(ExistingLocal: true), token);
        Assert.False(Assert.Single(store.SavedOriginals(item.Id)).AutoSaved);
        var reads = proxy.Reads; await query.Read(item, token); Assert.Equal(reads, proxy.Reads);
    }

    [Theory]
    [InlineData("{\"Lyrics\":[]}")]
    [InlineData("{\"Lyrics\":[{\"Text\":\"纯音乐，请欣赏\"}]}")]
    public async Task MissingAndInstrumentalNativeLyricsAreNotSaved(string response)
    {
        var store = new Store(directory); var native = DispatchProxy.Create<ILyricManager, AutomaticNativeProxy>();
        ((AutomaticNativeProxy)(object)native).Response = () => Task.FromResult(response);
        var registry = ProviderRegistry.WithSources(); var retrieval = new Retrieval(store, registry, NullLogger<Retrieval>.Instance);
        using var discovery = new Discovery(store, registry, retrieval); using var local = new LocalPronunciation(store);
        var query = new LyricQueryService(native, store, retrieval, discovery, new PreferenceService(store, () => new()), local, new LanguageServices(() => []), () => [], () => false);
        var item = new Audio { Id = Guid.NewGuid(), Name = "Fixture" };
        Assert.Null(await query.Read(item, TestContext.Current.CancellationToken)); Assert.Empty(store.SavedOriginals(item.Id));
    }

    [Fact]
    public async Task CancellationAndDeletionDuringNativeReadCannotRecreateSavedLyrics()
    {
        var store = new Store(directory); var native = DispatchProxy.Create<ILyricManager, AutomaticNativeProxy>(); var proxy = (AutomaticNativeProxy)(object)native;
        var registry = ProviderRegistry.WithSources(); var retrieval = new Retrieval(store, registry, NullLogger<Retrieval>.Instance);
        using var discovery = new Discovery(store, registry, retrieval); using var local = new LocalPronunciation(store);
        var query = new LyricQueryService(native, store, retrieval, discovery, new PreferenceService(store, () => new()), local, new LanguageServices(() => []), () => [], () => false);
        var item = new Audio { Id = Guid.NewGuid(), Name = "Fixture" }; var token = TestContext.Current.CancellationToken;
        var first = await query.Read(item, token); var pending = new TaskCompletionSource<string>(); proxy.Response = () => pending.Task;
        var read = query.Read(item, token); store.DeleteOriginal(item.Id, first!.Hash);
        pending.SetResult(AutomaticNativeProxy.Lyrics); await read; Assert.Empty(store.SavedOriginals(item.Id));
        pending = new(); using var cancellation = new CancellationTokenSource();
        read = query.Read(item, cancellation.Token); cancellation.Cancel(); pending.SetResult(AutomaticNativeProxy.Lyrics);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => read); Assert.Empty(store.SavedOriginals(item.Id));
        proxy.Response = () => Task.FromResult(AutomaticNativeProxy.Lyrics);
        await query.Read(item, token); Assert.Single(store.SavedOriginals(item.Id));
    }

    public void Dispose() { TestHost.ClearDatabasePools(directory); if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}

public class AutomaticNativeProxy : DispatchProxy
{
    public const string Lyrics = "{\"Lyrics\":[{\"Text\":\"Hello\",\"Start\":1000}]}";
    public Func<Task<string>> Response { get; set; } = () => Task.FromResult(Lyrics);
    public int Reads { get; private set; }
    protected override object? Invoke(MethodInfo? method, object?[]? args)
    {
        if (method!.Name != "GetLyricsAsync") throw new NotSupportedException(method.Name);
        Reads++;
        return typeof(AutomaticNativeProxy).GetMethod(nameof(Decode), BindingFlags.Static | BindingFlags.NonPublic)!.MakeGenericMethod(method.ReturnType.GetGenericArguments()[0]).Invoke(null, [Response()]);
    }
    private static async Task<T?> Decode<T>(Task<string> response) => JsonSerializer.Deserialize<T>(await response);
}
