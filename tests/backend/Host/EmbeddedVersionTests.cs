using LyricBridge;
using MediaBrowser.Controller.Entities.Audio;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

public sealed class EmbeddedVersionTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "lyricbridge-embedded-" + Guid.NewGuid().ToString("N"));
    [Fact]
    public void AvailabilityMatchesLanguageAndIncludesBackgroundVocals()
    {
        var lyrics = new RichLyrics { Lines = [new() { Id = "main", Text = "main", Pronunciation = " \u200B\uFEFF", Background = new() { Id = "bg", Text = "background", Translations = new() { ["zh"] = "歌曲", ["en"] = "hello" }, Pronunciation = "background" } }] };
        Assert.True(EmbeddedVersions.Available(lyrics, "translation", "zh-Hant"));
        Assert.True(EmbeddedVersions.Available(lyrics, "pronunciation", ""));
        Assert.False(EmbeddedVersions.Available(lyrics, "translation", "fr"));
        Assert.False(EmbeddedVersions.HasText(" \u200B\u200F\u2066\uFEFF"));
        Assert.Equal("auto", EmbeddedVersions.Choice(lyrics, "translation", "fr", "provider"));
        Assert.Equal("provider", EmbeddedVersions.Choice(lyrics, "translation", "en", "provider"));
    }
    [Fact]
    public void SelectingEmbeddedRowsValidatesAvailabilityWithoutCreatingVariants()
    {
        var store = new Store(directory); var user = Guid.NewGuid();
        var lyrics = new RichLyrics { Source = "QQ", Lines = [new() { Id = "line", Text = "original", Translations = new() { ["en"] = "translation" } }] };
        lyrics.Hash = Codec.ContentHash(lyrics); store.SaveDocument(lyrics);
        var service = new LanguageVersionService(store);
        service.Select(user, lyrics, new(lyrics.Hash, "translation", "provider"), "en");
        Assert.Equal("provider", store.AuxiliaryChoice(user, lyrics.Hash, "translation", "en")!.Key);
        Assert.Equal("language_version_unavailable", Assert.Throws<WorkflowException>(() => service.Select(user, lyrics, new(lyrics.Hash, "translation", "provider"), "fr")).Code);
        Assert.Throws<WorkflowException>(() => service.Select(user, lyrics, new(lyrics.Hash, "pronunciation", "provider"), ""));
        Assert.Throws<WorkflowException>(() => service.Delete(lyrics, new(lyrics.Hash, "translation", "provider")));
        Assert.Empty(store.Versions(lyrics.Hash)); Assert.Equal("translation", store.GetDocument(lyrics.Hash)!.Lines[0].Translations["en"]);
    }
    [Fact]
    public void ReadOnlyPayloadFallsBackToAutomaticWithoutWriting()
    {
        var store = new Store(directory); var item = new Audio { Id = Guid.NewGuid(), Name = "Fixture" }; var user = Guid.NewGuid();
        var lyrics = new RichLyrics { Source = "Imported", Lines = [new() { Id = "line", Text = "original" }] }; lyrics.Hash = Codec.ContentHash(lyrics);
        store.Put("auxiliary-choice", LanguageVersionService.ChoiceKey(user, lyrics.Hash, "translation", "zh-Hans"), new AuxiliarySelection("provider"));
        store.Put("auxiliary-choice", LanguageVersionService.ChoiceKey(user, lyrics.Hash, "pronunciation", ""), new AuxiliarySelection("provider"));
        var before = Codec.Serialize(store.All<AuxiliarySelection>("auxiliary-choice"));
        var registry = ProviderRegistry.WithSources(); var retrieval = new Retrieval(store, registry, NullLogger<Retrieval>.Instance);
        using var discovery = new Discovery(store, registry, retrieval); using var local = new LocalPronunciation(store);
        var query = new LyricQueryService(null!, store, retrieval, discovery, new PreferenceService(store, () => new()), local, new LanguageServices(ServiceFixtures.Catalog(() => [])), () => [], () => false);
        var payload = query.Build(item, user, true, new() { State = "ready", Lyrics = lyrics }, readOnly: true);
        Assert.Equal("auto", payload.AuxiliaryChoices.Translation); Assert.Equal("auto", payload.AuxiliaryChoices.Pronunciation);
        Assert.Equal(before, Codec.Serialize(store.All<AuxiliarySelection>("auxiliary-choice"))); Assert.Null(store.GetDocument(lyrics.Hash));
        Assert.Empty(store.Versions(lyrics.Hash)); Assert.Empty(store.SavedOriginals(item.Id));
    }
    [Fact]
    public void AdministratorCanDisableAutomaticPronunciationWithoutBlockingManualWork()
    {
        var store = new Store(directory); var item = new Audio { Id = Guid.NewGuid(), Name = "Japanese" }; var user = Guid.NewGuid();
        var lyrics = new RichLyrics { Lines = [new() { Id = "line", Text = "こんにちは", Language = "ja" }] }; lyrics.Hash = Codec.ContentHash(lyrics);
        var registry = ProviderRegistry.WithSources(); var retrieval = new Retrieval(store, registry, NullLogger<Retrieval>.Instance);
        using var discovery = new Discovery(store, registry, retrieval); using var local = new LocalPronunciation(store);
        var enabled = false;
        var query = new LyricQueryService(null!, store, retrieval, discovery, new PreferenceService(store, () => new()), local, new LanguageServices(ServiceFixtures.Catalog(() => [])), () => [], () => false, () => enabled);
        query.Build(item, user, true, new() { State = "ready", Lyrics = lyrics });
        Assert.Equal("unavailable", local.Status(lyrics, new()).State);
        Assert.Equal("queued", local.Ensure(lyrics, new(), true).State);
        enabled = true;
        query.Build(item, user, true, new() { State = "ready", Lyrics = lyrics });
        Assert.Equal("queued", local.Status(lyrics, new()).State);
    }
    public void Dispose() { TestHost.ClearDatabasePools(directory); if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
