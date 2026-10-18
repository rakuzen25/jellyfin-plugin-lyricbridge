using LyricBridge;
using Xunit;

public sealed class ServiceSetupTests
{
    private static ServiceSetup Setup() => ServiceSetup.Migrate([new() { Name = "Google" }, new() { Name = "AI", Endpoint = "https://api.example/v1", ApiKey = "private-key", Model = "text-model" }], new() { Enabled = true, Endpoint = "https://api.example/v1", ApiKey = "private-key", Model = "audio-model" });
    [Fact]
    public void NamesDoNotChangeOutputProfilesOrExposeCredentials()
    {
        var setup = Setup(); var catalog = new ServiceCatalog(() => setup);
        using var languages = new LanguageServices(() => [], catalog: catalog);
        var request = new GenerationRequest { Kind = "translation", OptionId = "legacy-translation-ai" };
        var profile = languages.Profile(request);
        setup.Connections[0].Name = "Renamed connection"; setup.Options.Single(o => o.Id == request.OptionId).Name = "Renamed option";
        Assert.Equal(profile, languages.Profile(request));
        var visible = Codec.Serialize(catalog.Options()); Assert.DoesNotContain("private-key", visible); Assert.DoesNotContain("api.example", visible);
        Assert.All(catalog.Options(), o => Assert.Equal("Ready", o.Status));
    }
    [Fact]
    public void SavedProfilesAndLegacyJobsSurviveAddingAnotherOption()
    {
        var setup = Setup(); var catalog = new ServiceCatalog(() => setup);
        using var languages = new LanguageServices(() => [], catalog: catalog);
        var request = new GenerationRequest { Service = "AI", Kind = "translation" };
        var legacyProfile = new GenerationProfile("AI", Codec.Hash("https://api.example/v1"), "text-model", "translation", "zh-Hans", "auto", "", 0, 0, LanguageServices.AiPromptVersion);
        var job = new Job { Request = request, Profile = legacyProfile };
        var other = Codec.Deserialize<ServiceOption>(Codec.Serialize(setup.Options.Single(o => o.Id == "legacy-translation-ai")))!; other.Id = "other"; other.Name = "Other"; setup.Options = [.. setup.Options, other];
        languages.Restore(job); Assert.Equal("legacy-translation-ai", request.OptionId); Assert.Equal(legacyProfile, languages.CurrentProfile(request));
        var lyrics = new RichLyrics { Hash = "source" }; var variant = new Variant("version", "source", "translation", "zh-Hans", "AI", "text-model", [], CacheKey: LanguageServices.Key("source", legacyProfile));
        Assert.True(languages.MatchesCurrent(lyrics, variant, "auto"));
        setup.Options = setup.Options.Where(o => o.Provider != "AI").ToArray();
        Assert.False(languages.MatchesCurrent(lyrics, variant, "auto"));
    }
    [Fact]
    public void ConnectionReferencesAndProviderCompatibilityAreValidated()
    {
        var setup = Setup(); setup.Connections = []; Assert.Throws<ArgumentException>(() => setup.Validate());
        setup = Setup(); setup.Options[0].Provider = "DeepL"; Assert.Throws<ArgumentException>(() => setup.Validate());
        setup = Setup(); setup.Options[0].Name = setup.Options.Single(o => o.Id == "legacy-translation-ai").Name; Assert.Throws<ArgumentException>(() => setup.Validate());
    }
    [Fact]
    public void TranscriptionAndReviewResolveIndependentlyOfOtherCapabilities()
    {
        var setup = Setup(); var catalog = new ServiceCatalog(() => setup);
        var audio = new Job { Audio = new(OptionId: "legacy-transcription") };
        Assert.Equal("audio-model", catalog.Transcription(audio).Model);
        Assert.Equal("text-model", catalog.Review(new Job { Review = new("source", "version", new(), "legacy-boundary-review") }).Model);
        setup.Options.Single(o => o.Capability == "transcription").Enabled = false;
        Assert.Throws<WorkflowException>(() => catalog.Transcription(audio));
        Assert.Equal("text-model", catalog.Review(new Job { Review = new("source", "version", new(), "legacy-boundary-review") }).Model);
    }
}
