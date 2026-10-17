using LyricBridge;
using Xunit;

public sealed class ServiceSetupTests
{
    private static ServiceSetup Setup() => ServiceSetup.Migrate([new() { Name = "Google" }, new() { Name = "AI", Endpoint = "https://api.example/v1", ApiKey = "private-key", Model = "text-model" }], new() { Enabled = true, Endpoint = "https://api.example/v1", ApiKey = "private-key", Model = "audio-model" });
    [Fact]
    public void TimeoutDefaultsIncludeReviewAndPreserveConfiguredValues()
    {
        Assert.Equal(120, new ServiceConfig { Name = "AI" }.TimeoutSeconds);
        Assert.Equal(120, new ServiceOption().TimeoutSeconds);
        Assert.Equal(120, new TranscriptionConfig().TimeoutSeconds);
        Assert.Equal(120, new TranscriptionConfig().Review.TimeoutSeconds);
        var setup = ServiceSetup.Migrate([new() { Name = "AI", TimeoutSeconds = 45 }], new() { TimeoutSeconds = 300, ReviewUsesAiService = false, Review = new() { Name = "AI", TimeoutSeconds = 90 } });
        Assert.Equal(45, setup.Options.First(o => o.Capability == "translation" && o.Provider == "AI").TimeoutSeconds);
        Assert.Equal(90, setup.Options.Single(o => o.Capability == "boundary-review").TimeoutSeconds);
        Assert.Equal(300, setup.Options.Single(o => o.Capability == "transcription").TimeoutSeconds);
    }
    [Fact]
    public void MigrationIsDeterministicAndSharesOnlyIdenticalConnections()
    {
        var setup = Setup(); setup.Validate();
        Assert.Single(setup.Connections);
        Assert.Equal(Codec.Serialize(setup), Codec.Serialize(Setup()));
        Assert.Equal("audio-model", setup.Options.Single(o => o.Capability == "transcription").Model);
        Assert.Equal("text-model", setup.Options.Single(o => o.Capability == "boundary-review").Model);
        Assert.Contains(setup.Options, o => o.Provider == "Kawazu" && o.ConnectionId == null);
        var t = new TranscriptionConfig { Endpoint = "https://api.example/v1", ApiKey = "other-key" };
        var separate = ServiceSetup.Migrate([new() { Name = "AI", Endpoint = t.Endpoint, ApiKey = "private-key" }], t);
        Assert.Equal(2, separate.Connections.Length);
        Assert.False(separate.Options.Single(o => o.Capability == "transcription").Enabled);
    }
    [Fact]
    public void MissingFieldsRemainDraftsWhileMalformedValuesAreRejected()
    {
        var setup = Setup(); var option = setup.Options.First(o => o.Provider == "AI"); option.Model = "";
        setup.Validate(); Assert.False(setup.Ready(option));
        setup.Connections[0].Endpoint = "https://secret:password@host/v1";
        Assert.Throws<ArgumentException>(() => setup.Validate());
    }
    [Fact]
    public void ExplicitOptionChoosesCorrectModelAndLegacyAmbiguityIsRejected()
    {
        var setup = Setup(); var a = setup.Options.Single(o => o.Id == "legacy-translation-ai");
        var b = Codec.Deserialize<ServiceOption>(Codec.Serialize(a))!; b.Id = "alternative"; b.Name = "Second model"; b.Model = "second-model"; setup.Options = [.. setup.Options, b]; setup.Validate();
        var catalog = new ServiceCatalog(() => setup);
        Assert.Equal("service_choice_required", Assert.Throws<WorkflowException>(() => catalog.Resolve("translation", null, "AI")).Code);
        var request = new GenerationRequest { Kind = "translation", OptionId = b.Id };
        Assert.Equal("second-model", catalog.Language(request).Model);
        Assert.Equal("AI", request.Service); Assert.Equal("Second model", request.OptionName);
        Assert.Throws<WorkflowException>(() => catalog.Resolve("pronunciation", b.Id));
        b.Enabled = false; Assert.Throws<WorkflowException>(() => catalog.Resolve("translation", b.Id));
    }
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
